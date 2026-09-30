#!/usr/bin/env python3
"""Decode Godot 4.x binary-tokenized GDScript (.gdc, GDScriptTokenizerBuffer) back to source.

Layout: b'GDSC' | u32 version | u32 decompressed size (0 = raw) | zstd(contents)
contents: u32 identifiers, constants, line entries, tokens
          identifiers: u32 len + len * u32 (UTF-32, each byte ^ 0xb6)
          constants:   Godot Variant binary encoding (encode_variant, no objects)
          lines:  (u32 token index, u32 line) * n  -- only tokens that start a new line
          columns:(u32 token index, u32 column) * n
          tokens: 1-byte type, or u32 (type | payload << 8 | 0x80) when bit 0x80 is set; then u32 end_line
NEWLINE/INDENT/DEDENT are not stored: they come back from the line/column tables. Comments and the
original spelling of literals (hex ints, exponent floats, quote style) are lost in the binary format.
"""
import struct, sys
import zstandard

# GDScriptTokenizer::Token::Type (4.3/4.4 = v100; 4.5 inserts PERIOD_PERIOD_PERIOD = v101)
_TYPES = ('EMPTY ANNOTATION IDENTIFIER LITERAL '
          'LESS LESS_EQUAL GREATER GREATER_EQUAL EQUAL_EQUAL BANG_EQUAL '
          'AND OR NOT AMPERSAND_AMPERSAND PIPE_PIPE BANG '
          'AMPERSAND PIPE TILDE CARET LESS_LESS GREATER_GREATER '
          'PLUS MINUS STAR STAR_STAR SLASH PERCENT '
          'EQUAL PLUS_EQUAL MINUS_EQUAL STAR_EQUAL STAR_STAR_EQUAL SLASH_EQUAL PERCENT_EQUAL '
          'LESS_LESS_EQUAL GREATER_GREATER_EQUAL AMPERSAND_EQUAL PIPE_EQUAL CARET_EQUAL '
          'IF ELIF ELSE FOR WHILE BREAK CONTINUE PASS RETURN MATCH WHEN '
          'AS ASSERT AWAIT BREAKPOINT CLASS CLASS_NAME CONST ENUM EXTENDS FUNC IN IS NAMESPACE PRELOAD '
          'SELF SIGNAL STATIC SUPER TRAIT VAR VOID YIELD '
          'BRACKET_OPEN BRACKET_CLOSE BRACE_OPEN BRACE_CLOSE PARENTHESIS_OPEN PARENTHESIS_CLOSE '
          'COMMA SEMICOLON PERIOD PERIOD_PERIOD PERIOD_PERIOD_PERIOD COLON DOLLAR FORWARD_ARROW UNDERSCORE '
          'NEWLINE INDENT DEDENT CONST_PI CONST_TAU CONST_INF CONST_NAN '
          'VCS_CONFLICT_MARKER BACKTICK QUESTION_MARK ERROR TK_EOF').split()
TYPES = {101: _TYPES, 100: tuple(t for t in _TYPES if t != 'PERIOD_PERIOD_PERIOD')}

TEXT = dict(
    LESS='<', LESS_EQUAL='<=', GREATER='>', GREATER_EQUAL='>=', EQUAL_EQUAL='==', BANG_EQUAL='!=',
    AND='and', OR='or', NOT='not', AMPERSAND_AMPERSAND='&&', PIPE_PIPE='||', BANG='!',
    AMPERSAND='&', PIPE='|', TILDE='~', CARET='^', LESS_LESS='<<', GREATER_GREATER='>>',
    PLUS='+', MINUS='-', STAR='*', STAR_STAR='**', SLASH='/', PERCENT='%',
    EQUAL='=', PLUS_EQUAL='+=', MINUS_EQUAL='-=', STAR_EQUAL='*=', STAR_STAR_EQUAL='**=', SLASH_EQUAL='/=',
    PERCENT_EQUAL='%=', LESS_LESS_EQUAL='<<=', GREATER_GREATER_EQUAL='>>=', AMPERSAND_EQUAL='&=',
    PIPE_EQUAL='|=', CARET_EQUAL='^=',
    BRACKET_OPEN='[', BRACKET_CLOSE=']', BRACE_OPEN='{', BRACE_CLOSE='}', PARENTHESIS_OPEN='(',
    PARENTHESIS_CLOSE=')', COMMA=',', SEMICOLON=';', PERIOD='.', PERIOD_PERIOD='..', PERIOD_PERIOD_PERIOD='...',
    COLON=':', DOLLAR='$', FORWARD_ARROW='->', UNDERSCORE='_',
    CONST_PI='PI', CONST_TAU='TAU', CONST_INF='INF', CONST_NAN='NAN', BACKTICK='`', QUESTION_MARK='?')
BINARY = {'LESS', 'LESS_EQUAL', 'GREATER', 'GREATER_EQUAL', 'EQUAL_EQUAL', 'BANG_EQUAL', 'AND', 'OR',
          'AMPERSAND_AMPERSAND', 'PIPE_PIPE', 'AMPERSAND', 'PIPE', 'CARET', 'LESS_LESS', 'GREATER_GREATER',
          'PLUS', 'MINUS', 'STAR', 'STAR_STAR', 'SLASH', 'PERCENT', 'EQUAL', 'PLUS_EQUAL', 'MINUS_EQUAL',
          'STAR_EQUAL', 'STAR_STAR_EQUAL', 'SLASH_EQUAL', 'PERCENT_EQUAL', 'LESS_LESS_EQUAL',
          'GREATER_GREATER_EQUAL', 'AMPERSAND_EQUAL', 'PIPE_EQUAL', 'CARET_EQUAL', 'FORWARD_ARROW',
          'IN', 'IS', 'AS', 'IF', 'ELSE', 'NOT'}
# after these a +/-/% is unary and a ( is not a call
OPERAND_END = {'IDENTIFIER', 'LITERAL', 'PARENTHESIS_CLOSE', 'BRACKET_CLOSE', 'BRACE_CLOSE', 'SELF',
               'CONST_PI', 'CONST_TAU', 'CONST_INF', 'CONST_NAN', 'UNDERSCORE', 'SUPER', 'PRELOAD'}
NO_SPACE_BEFORE = {'COMMA', 'PARENTHESIS_CLOSE', 'BRACKET_CLOSE', 'PERIOD', 'COLON', 'SEMICOLON'}


class Reader:
    def __init__(self, b): self.b, self.p = b, 0
    def u32(self): v = struct.unpack_from('<I', self.b, self.p)[0]; self.p += 4; return v
    def take(self, n): v = self.b[self.p:self.p + n]; self.p += n; return v
    def utf8(self):
        n = self.u32(); s = self.take(n).decode('utf-8'); self.p += -n % 4; return s


class Lit:  # typed wrapper so StringName/NodePath keep their prefix
    def __init__(self, kind, v): self.kind, self.v = kind, v


def variant(r):
    """Subset of marshalls.cpp decode_variant that tokenizer literals can hold."""
    h = r.u32(); t = h & 0xff; f64 = h & (1 << 16)
    if t == 0: return None
    if t == 1: return bool(r.u32())
    if t == 2: return struct.unpack('<q' if f64 else '<i', r.take(8 if f64 else 4))[0]
    if t == 3: return struct.unpack('<d' if f64 else '<f', r.take(8 if f64 else 4))[0]
    if t == 4: return r.utf8()
    if t == 21: return Lit('&', r.utf8())
    if t == 22:  # NodePath: names | 0x80000000, subnames, flags(1 = absolute), then strings
        names = r.u32() & 0x7fffffff; subs = r.u32(); flags = r.u32()
        parts = [r.utf8() for _ in range(names + subs)]
        s = ('/' if flags & 1 else '') + '/'.join(parts[:names]) + ''.join(':' + x for x in parts[names:])
        return Lit('^', s)
    raise ValueError(f'unsupported constant Variant type {t}')


def parse(data):
    assert data[:4] == b'GDSC', 'not a GDScript binary'
    ver, size = struct.unpack_from('<II', data, 4)
    assert ver in TYPES, f'unsupported tokenizer version {ver}'
    body = data[12:] if size == 0 else zstandard.ZstdDecompressor().decompress(data[12:], max_output_size=size)
    r = Reader(body); n_id, n_const, n_lines, n_tok = r.u32(), r.u32(), r.u32(), r.u32()
    ids = []
    for _ in range(n_id):
        n = r.u32(); raw = bytes(c ^ 0xb6 for c in r.take(4 * n))
        ids.append(''.join(chr(c) for c in struct.unpack(f'<{n}I', raw)))
    consts = [variant(r) for _ in range(n_const)]
    lines = dict(struct.unpack('<II', r.take(8)) for _ in range(n_lines))
    cols = dict(struct.unpack('<II', r.take(8)) for _ in range(n_lines))
    names = TYPES[ver]; toks = []
    for _ in range(n_tok):
        if r.b[r.p] & 0x80: v = r.u32() & ~0x80
        else: v = r.b[r.p]; r.p += 1
        r.u32()  # end_line (only used for multi-line tokens; start lines come from `lines`)
        kind = names[v & 0x7f]; arg = v >> 8
        toks.append((kind, ids[arg] if kind in ('IDENTIFIER', 'ANNOTATION') else consts[arg] if kind in ('LITERAL', 'ERROR') else None))
    assert r.p == len(body), f'{len(body) - r.p} trailing bytes'
    return ver, toks, lines, cols


def lit_text(v):
    if v is None: return 'null'
    if v is True: return 'true'
    if v is False: return 'false'
    if isinstance(v, int): return str(v)
    if isinstance(v, float):
        if v != v: return 'NAN'
        if v in (float('inf'), float('-inf')): return ('-' if v < 0 else '') + 'INF'
        s = repr(v); return s if ('.' in s or 'e' in s) else s + '.0'
    prefix = ''
    if isinstance(v, Lit): prefix, v = v.kind, v.v
    return prefix + '"' + v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\t', '\\t').replace('\r', '\\r') + '"'


def tok_text(kind, arg):
    if kind in ('IDENTIFIER', 'ANNOTATION'): return arg
    if kind == 'LITERAL': return lit_text(arg)
    return TEXT.get(kind) or kind.lower()


def decompile(data):
    ver, toks, lines, cols = parse(data)
    out = {}  # line number -> text
    line = 1; cur = ''; prev = None; prev_unary = False; node_path = False
    for i, (kind, arg) in enumerate(toks):
        if i in lines:
            # columns count a tab as 4 (GDScriptTokenizerText tab_size); every script here is tab-indented
            # (all line-start columns are 1 + 4k), so this also restores lambda bodies and continuation lines
            out[line] = cur; line = lines[i]; cur = '\t' * ((cols[i] - 1) // 4) + ' ' * ((cols[i] - 1) % 4); prev = None
        t = tok_text(kind, arg)
        unary = prev is None or prev not in OPERAND_END
        if kind == 'DOLLAR': node_path = True
        elif node_path and kind not in ('IDENTIFIER', 'SLASH', 'LITERAL', 'PERCENT', 'COLON'): node_path = False
        if prev is None: sep = ''
        elif prev == 'DOLLAR' or (node_path and (kind == 'SLASH' or prev == 'SLASH' or kind == 'PERCENT' or prev == 'PERCENT')): sep = ''
        elif kind in NO_SPACE_BEFORE: sep = ''
        elif prev == 'PERIOD' or prev in ('PARENTHESIS_OPEN', 'BRACKET_OPEN'): sep = ''
        elif kind == 'PARENTHESIS_OPEN' and prev in ('IDENTIFIER', 'PARENTHESIS_CLOSE', 'BRACKET_CLOSE', 'SUPER', 'PRELOAD', 'ANNOTATION', 'FUNC', 'SELF'): sep = ''
        elif kind == 'BRACKET_OPEN' and prev in OPERAND_END: sep = ''
        elif prev in ('MINUS', 'PLUS', 'TILDE', 'BANG', 'PERCENT') and prev_unary: sep = ''
        elif prev == 'COLON' and kind == 'EQUAL': sep = ''  # :=
        elif kind == 'BRACKET_CLOSE' or kind == 'BRACE_CLOSE': sep = ' ' if prev != 'BRACE_OPEN' and kind == 'BRACE_CLOSE' else ''
        else: sep = ' '
        if kind == 'EQUAL' and prev == 'COLON': cur = cur[:-1] + ' :'  # `var x := 1`
        cur += sep + t
        prev_unary = unary and kind in ('MINUS', 'PLUS', 'TILDE', 'BANG', 'PERCENT')
        prev = kind
    out[line] = cur
    last = max(out)
    return '\n'.join(out.get(n, '') for n in range(1, last + 1)).rstrip() + '\n'


if __name__ == '__main__':
    if len(sys.argv) > 1:
        for p in sys.argv[1:]: sys.stdout.write(decompile(open(p, 'rb').read()))
    else:  # self-check against a hand-built v101 buffer: `extends Node\nvar a := -1\n`
        ids = ['Node', 'a']; body = struct.pack('<4I', 2, 1, 1, 6)
        for s in ids: body += struct.pack('<I', len(s)) + bytes(b ^ 0xb6 for b in struct.pack(f'<{len(s)}I', *map(ord, s)))
        body += struct.pack('<Ii', 2, 1) + struct.pack('<II', 2, 2) + struct.pack('<II', 2, 1)
        n = _TYPES.index
        for v in (n('EXTENDS'), n('IDENTIFIER'), n('VAR'), n('IDENTIFIER') | 1 << 8, n('COLON'), n('EQUAL'), n('MINUS'), n('LITERAL')):
            body += struct.pack('<II', v | 0x80, 1)
        body = struct.pack('<4I', 2, 1, 1, 8) + body[16:]
        src = decompile(b'GDSC' + struct.pack('<II', 101, 0) + body)
        assert src == 'extends Node\nvar a := -1\n', repr(src)
        print('ok')
