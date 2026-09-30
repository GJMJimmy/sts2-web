#!/usr/bin/env python3
"""FMOD Studio banks -> assets/audio/events.json: event path -> timeline / action sheet / parameter-sheet instruments -> samples.

Reverse-engineered bank layout (FMT version 0x8e, FMOD Studio 2.x), all little-endian:
  RIFF 'FEV ' > LIST PROJ > LIST <plural> (EVTS, TLNS, MUIS, WAIS, ...) > LCNT + one LIST per object (EVNT, TMLN, MUIT, ...)
  or flat chunks (CTRL, CURV, MAP, WAV). An object's first chunk (EVTB, TLNB, MUIB, ...) starts with its GUID (MODB: at +2).
  Arrays: u16 h; h&1 -> n=h>>1 fixed-size elements (u16 size follows when n); else n var-size elements, each u16 size + data.
  Master.strings.bank STDT: radix tree of paths (nodes u24 label|u8 char|u24 child|u8 n, sorted GUID table, label pool,
    GUID -> leaf node u24 table, node -> parent u24 table).
  Timeline positions and lengths are samples at 48 kHz. See comments below for each object's fields."""
import json, os, struct, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import Pck, PCK_DEFAULT

OUT = 'assets/audio'

def G(b): return str(uuid.UUID(bytes_le=bytes(b)))
ZERO = G(bytes(16))
def u16(b, o): return struct.unpack_from('<H', b, o)[0]
def u32(b, o): return struct.unpack_from('<I', b, o)[0]
def i32(b, o): return struct.unpack_from('<i', b, o)[0]
def f32(b, o): return struct.unpack_from('<f', b, o)[0]
def u24(b, o): return int.from_bytes(b[o:o + 3], 'little')

def arr(b, o):
    """-> (elements, next offset)"""
    h = u16(b, o); o += 2; n = h >> 1
    if h & 1:
        if not n: return [], o
        es = u16(b, o); o += 2
        return [b[o + i * es:o + (i + 1) * es] for i in range(n)], o + n * es
    out = []
    for _ in range(n):
        s = u16(b, o); out.append(b[o + 2:o + 2 + s]); o += 2 + s
    return out, o

def chunks(b, o, e):
    while o + 8 <= e:
        cid = b[o:o + 4].decode('latin1'); size = u32(b, o + 4); body = o + 8
        if cid in ('RIFF', 'LIST'): yield 'LIST:' + b[body:body + 4].decode('latin1'), body + 4, body + size
        else: yield cid, body, body + size
        o = body + size + (size & 1)

def tree(b, o, e):
    return [(c, tree(b, s, t) if c.startswith('LIST:') else b[s:t]) for c, s, t in chunks(b, o, e)]

class Obj:
    def __init__(self, kind, bank, parts): self.kind, self.bank, self.parts = kind, bank, parts
    def __getitem__(self, k): return self.parts[k]
    def get(self, k): return self.parts.get(k)

def load_objects(bank, data, objs):
    (_, s, e), = [c for c in chunks(data, 0, len(data)) if c[0] == 'LIST:FEV ']
    for cid, s2, e2 in chunks(data, s, e):
        if cid != 'LIST:PROJ': continue
        for c3, s3, e3 in chunks(data, s2, e2):
            if not c3.startswith('LIST:'): continue
            for c4, s4, e4 in chunks(data, s3, e3):
                if c4 == 'LCNT': continue
                if c4.startswith('LIST:'):
                    parts = dict(tree(data, s4, e4)); first, body = next((k, v) for k, v in parts.items() if isinstance(v, bytes))
                    o = Obj(c4[5:].strip(), bank, parts); gid = G(body[2:18] if first == 'MODB' else body[:16])
                else:
                    o = Obj(c4.strip(), bank, {c4: data[s4:e4]}); gid = G(data[s4:s4 + 16])
                    if c4 == 'CURV': gid = 'curve:' + gid  # an automation's curve shares its controller's guid
                objs.setdefault(gid, o)

def strings(stdt):
    """Master.strings.bank STDT -> {guid: path}"""
    nn = u16(stdt, 4) >> 1
    nodes = [(u24(stdt, 8 + i * 8), stdt[8 + i * 8 + 3]) for i in range(nn)]
    o = 8 + nn * 8; ng = u16(stdt, o) >> 1; o += 4
    guids = [stdt[o + 16 * i:o + 16 * i + 16] for i in range(ng)]; o += 16 * ng
    ps = u16(stdt, o); o += 2; pool = stdt[o:o + ps]; o += ps
    nl = u16(stdt, o); o += 2; leaf = [u24(stdt, o + 3 * i) for i in range(nl)]; o += 3 * nl
    npar = u16(stdt, o); o += 2; par = [u24(stdt, o + 3 * i) for i in range(npar)]; o += 3 * npar
    assert o == len(stdt), 'STDT layout changed'
    def label(n):
        a, ch = nodes[n]
        return (chr(ch) if ch else '') if a == 0xffffff else pool[a:pool.index(b'\0', a)].decode()
    def path(n):
        s = []
        while n != 0xffffff: s.append(label(n)); n = par[n]
        return ''.join(reversed(s))
    return {G(g): path(leaf[i]) for i, g in enumerate(guids)}

def fsb_names(data):
    """Subsound names of the bank's FSB5 (SND chunk), in subsound order."""
    i = data.find(b'SND ')
    if i < 0: return []
    b = data[data.find(b'FSB5', i):]
    ver, num, shs, nts = struct.unpack_from('<4I', b, 4)
    o = hdr = 0x3c if ver == 1 else 0x40
    for _ in range(num):
        extra = struct.unpack_from('<Q', b, o)[0] & 1; o += 8
        while extra:
            c = u32(b, o); o += 4 + ((c >> 1) & 0xffffff); extra = c & 1
    assert o == hdr + shs
    return [b[hdr + shs + u32(b, hdr + shs + 4 * k):b.index(b'\0', hdr + shs + u32(b, hdr + shs + 4 * k))].decode() if nts else '' for k in range(num)]

def sample_files(bank, names):
    """Same naming as tools/audio.py extract_bank: <bank>/<stream name>[_rr<k>].ogg, empty names -> subsong number."""
    names = [n or str(i + 1) for i, n in enumerate(names)]
    count = {n: names.count(n) for n in names}; k = {}; out = []
    for n in names:
        k[n] = k.get(n, 0) + 1
        out.append(f'{bank}/' + (f'{n}_rr{k[n]}' if count[n] > 1 else n) + '.ogg')
    return out

def build(pck):
    objs, files = {}, {}
    for p in pck.paths(lambda p: p.endswith('.bank')):
        bank = os.path.basename(p)[:-5]; data = pck.read(p)
        if bank.endswith('.strings'):
            i = data.find(b'STDT'); names = strings(data[i + 8:i + 8 + u32(data, i + 4)])
            continue
        load_objects(bank, data, objs); files[bank] = sample_files(bank, fsb_names(data))
    return names, objs, files

# ------------------------------------------------------------------ objects -> JSON
def db(names, objs, files):
    params = {}  # PRMB: guid, u32 flags (1 global, 0x20 labelled), u32, u16 len + name, f32 min, max, default, 3 f32 (seek speeds), [labels]
    for g, o in objs.items():
        if o.kind != 'PARM': continue
        d = o['PRMB']; fl = u32(d, 16); nl = u16(d, 24); nm = d[26:26 + nl].decode(); q = 26 + nl
        p = dict(name=nm, min=f32(d, q), max=f32(d, q + 4), default=f32(d, q + 8))
        if fl & 1: p['global'] = 1
        if fl & 0x20: p['labels'] = [e[2:].decode() for e in arr(d, q + 24)[0]]
        params[g] = p
    buspath = {g: n for g, n in names.items() if n.startswith('bus:/')}

    def bus_hdr(g):  # IBSB/GBSB/MBSB/RBSB: guid, u16, parent bus guid, ...
        o = objs.get(g)
        return o and next(v for k, v in o.parts.items() if k.endswith('SB'))
    def bus_vol(g):  # BUS: u32, u32, effect guids, effect guids, u16, f32 volume dB
        b = objs[g]['BUS ']; o = arr(b, arr(b, 8)[1])[1]
        return f32(b, o + 2)
    def chain_db(g):  # instrument output (track / event master) -> event master
        v = 0.0
        while g in objs and objs[g].kind in ('GBUS', 'MBUS', 'RBUS'):
            v += bus_vol(g); g = G(bus_hdr(g)[18:34])
        return v

    def map_y(g, y):  # MAP: guid, [f32 x, f32 y]: property UI units -> value (volume: fader position -> dB)
        pts = [struct.unpack_from('<ff', e) for e in arr(objs[g]['MAP '], 16)[0]] if g in objs else []
        if not pts: return y
        if y <= pts[0][0]: return pts[0][1]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if y <= x1: return y0 + (y1 - y0) * (y - x0) / ((x1 - x0) or 1)
        return pts[-1][1]

    def vol_autos(owner, x):
        """Volume automation driven by a parameter sheet / timeline -> {target guid: [[x, dB], ...]}. <owner> CTRO: [controller
        guids]; CTRL: guid, target guid, guid, u32; CURV (same guid as its controller): guid, controller guid, [x (f32 parameter
        value | u32 timeline position), f32 y, f32 shape, u32]; the target's PROP 0 lists the controller and the MAP y goes through.
        ponytail: volume only, linear between points (curve shapes, pitch / send / effect automation skipped)."""
        out = {}
        for c in arr(owner.get('CTRO') or b'\x01\x00', 0)[0]:
            c = G(c); cv = objs.get('curve:' + c)
            tgt = G(objs[c]['CTRL'][16:32]) if c in objs and cv else ZERO
            mp = next((G(b[8:24]) for k, b in (objs[tgt].get('LIST:PRPS') or [] if tgt in objs else []) if k == 'PROP' and u32(b, 0) == 0
                       and c in {G(e) for e in arr(b, 24)[0]}), None)
            pts = [[round(x(e), 4), round(map_y(mp, f32(e, 4)), 2)] for e in arr(cv['CURV'], 32)[0]] if mp else []
            if pts: out[tgt] = pts
        return out

    def props(o):  # PROP: u32 property (0 volume, 1 pitch), u16, u16, MAP guid, [automation guids], [modulator guids]
        out = {}
        for c, b in o.get('LIST:PRPS') or []:
            if c != 'PROP': continue
            for e in arr(b, arr(b, 24)[1])[0]:
                m = objs.get(G(e))
                if m and m.kind == 'MODU': out.setdefault(u32(b, 0), []).append(m['MODB'][34:])
        return out

    def cond(c):
        """INST/TRNB condition bytecode: 0x11 guid (push parameter), 0x5?20 f32 lo f32 hi (range test: bit8 negate,
        bit9 exclusive hi), 0x1?02 (and 0x10 / or 0x11), 0x30 (apply). -> [name, lo, hi, flags] | ['&'|'|', a, b]"""
        st, i = [], 0
        while i < len(c):
            op = u32(c, i)
            if op == 0x11: st.append(params[G(c[i + 4:i + 20])]['name']); i += 20
            elif op & 0xff == 0x20: st.append([st.pop(), round(f32(c, i + 4), 4), round(f32(c, i + 8), 4), (op >> 8) & 3]); i += 12
            elif op & 0xff == 0x02: st.append('&' if op >> 8 == 0x10 else '|'); i += 4
            elif op == 0x30: b_, op_, a_ = st.pop(), st.pop(), st.pop(); st.append([op_, a_, b_]); i += 4
            else: raise ValueError(f'condition opcode {op:#x}')
        assert len(st) == 1
        return st[0]

    nested = {}
    def event_key(g):
        if g in names: return names[g]
        k = '#' + g[:8]
        if k not in nested: nested[k] = None; nested[k] = event(g)
        return k

    missing = []
    def inst(g, top, ec):
        """Instrument -> dict. INST (shared by every instrument kind): guid of the owning timeline, f32 volume dB, f32 pitch
        (semitones), i32 loop count (-1 = loop), ..., f32 probability (+36), ..., u16 + output bus guid (+84), ..., u32 condition
        length (+126) + condition."""
        if g == ZERO or g not in objs or 'INST' not in objs[g].parts: return None  # SLNI: silence
        o = objs[g]; d = o['INST']; r = {}
        vol = f32(d, 16) + (chain_db(G(d[86:102])) if top else 0)
        if abs(vol) > 0.01: r['vol'] = round(vol, 2)
        if f32(d, 20): r['pitch'] = round(f32(d, 20), 3)
        if i32(d, 24) == -1: r['loop'] = 1
        if round(f32(d, 36)) != 100: r['prob'] = round(f32(d, 36), 2)
        cl = u32(d, 126)
        if cl: r['cond'] = cond(d[130:130 + cl])
        auto, b = list(ec['autos'].get(g, [])), G(d[86:102])
        while top and b in objs and objs[b].kind in ('GBUS', 'MBUS', 'RBUS'): auto += ec['autos'].get(b, []); b = G(bus_hdr(b)[18:34])
        if auto: r['auto'] = auto
        if top:  # timeline-automated tracks (or the instrument itself) it plays through
            k = ec['track'](G(d[86:102]))
            if g in ec['tauto']: ec['tracks']['i' + g[:8]] = [k, ec['tauto'][g]]; k = 'i' + g[:8]
            if k: r['trk'] = k
        for prop, mods in props(o).items():  # MODB: u16, guid, owner guid, u32 property, u32 type (0 AHDSR, 1 random), ...
            for m in mods:
                typ = u32(m, 4)
                if typ == 1 and prop in (0, 1):  # random: u32, f32 amount (volume dB; pitch % of the 48 semitone range)
                    r['rv' if prop == 0 else 'rp'] = round(f32(m, 12) * (1 if prop == 0 else 0.48), 3)
                elif typ == 0 and prop == 0:  # AHDSR: u32, f32 initial, peak, sustain dB, attack, hold, decay, release ms, 3 shapes, final
                    a, rel = f32(m, 24), f32(m, 36)
                    if a: r['att'] = round(a)
                    if rel: r['rel'] = round(rel)
        if o.kind == 'WAIT':  # WAIB: guid, WAV guid. WAV: guid, u32, u16 FSB index, u32 subsound, u32 loading mode
            w = objs[G(o['WAIB'][16:32])]['WAV ']; sub = u32(w, 22)
            r['f'] = files[objs[G(o['WAIB'][16:32])].bank][sub]
        elif o.kind in ('MUIT', 'SPIT'):  # PLST: u32 mode (0 sequential, 1 random, 2 shuffle — inferred), u32, [guid, f32 weight %]
            pl = o['PLST']; ents, _ = arr(pl, 8)
            r['pl'] = [inst(G(e[:16]), False, ec) for e in ents]
            ws = [round(f32(e, 16), 3) for e in ents]
            if len(set(ws)) > 1: r['w'] = ws
            if len(ents) > 1: r['mode'] = u32(pl, 0)
            if o.kind == 'SPIT':  # SPIB: guid, u32 polyphony, u32, f32 spawn interval min, max (s — inferred), u32, f32 spawn rate %
                s = o['SPIB']; r['sc'] = [u32(s, 16), f32(s, 24), f32(s, 28)]
        elif o.kind == 'EVIT':  # EVIB: guid, event guid, f32, [parameter bindings]
            r['ev'] = event_key(G(o['EVIB'][16:32]))
        elif o.kind == 'CMDI':  # CMDB: guid, u32 type (2 = set parameter), target guid, f32 value
            c = o['CMDB']
            if u32(c, 16) == 2: r['set'] = [params[G(c[20:36])]['name'], f32(c, 36)]
        elif o.kind != 'SLNI': missing.append(o.kind)  # SLNI: silence instrument, plays nothing
        return r

    def event(g):
        """EVTB: guid, 16 bytes, timeline guid, input bus guid, master bus guid, i32 max instances, u32, 5 bytes,
        [parameter-sheet guids], 16 bytes, u32 flags, [track guids], [parameter ids], [action-sheet instrument guids], f32, f32."""
        o = objs[g]; d = o['EVTB']; ev = {}
        tl, ibus, mbus = G(d[32:48]), G(d[48:64]), G(d[64:80])
        out = buspath.get(G(bus_hdr(ibus)[18:34]), '') if ibus in objs else ''
        ev['bus'] = 'music' if out.startswith('bus:/master/music') else 'amb' if out.startswith('bus:/master/ambience') else 'sfx'
        sheets, q = arr(d, 93); q += 20
        ec = dict(autos={}, tauto=vol_autos(objs[tl], lambda e: u32(e, 0)), tracks={})
        for s in sheets:
            pm = objs[G(s)]; pname = params[G(pm['PMLB'][16:32])]['name']
            for tgt, pts in vol_autos(pm, lambda e: f32(e, 0)).items(): ec['autos'].setdefault(tgt, []).append([pname, pts])
        def track(b):  # nearest timeline-automated bus from b up to the event master -> key ('' none); registers it and its parents
            while b in objs and objs[b].kind in ('GBUS', 'MBUS', 'RBUS') and b not in ec['tauto']: b = G(bus_hdr(b)[18:34])
            if b not in ec['tauto']: return ''
            if b[:8] not in ec['tracks']: ec['tracks'][b[:8]] = [track(G(bus_hdr(b)[18:34])), ec['tauto'][b]]
            return b[:8]
        ec['track'] = track
        _, q = arr(d, q); _, q = arr(d, q); action, q = arr(d, q)
        for m in props(objs[mbus]).get(0, []):
            if u32(m, 4) == 0 and f32(m, 36): ev['rel'] = round(f32(m, 36))
        placed = set()
        # TLNB: guid, [async instrument, u32 start, u32 length], [sync ...], [], [marker / region: guid, u32 pos, u16 len + name,
        # u32 length], [tempo: guid, u32 beats per bar, u32 note value, u32 pos, f32 bpm]
        t = objs[tl]['TLNB']; A, q = arr(t, 16); B, q = arr(t, q); _, q = arr(t, q); M, q = arr(t, q); T, q = arr(t, q)
        end = 0
        for key, lst in (('async', A), ('sync', B)):
            if lst:
                ev[key] = [[inst(G(e[:16]), True, ec), u32(e, 16), u32(e, 20)] for e in lst]
                placed |= {G(e[:16]) for e in lst}; end = max(end, *(u32(e, 16) + u32(e, 20) for e in lst))
        marks = {}
        for m in M:
            nl = u16(m, 20); marks[G(m[:16])] = (u32(m, 16), u32(m, 22 + nl)); end = max(end, u32(m, 16) + u32(m, 22 + nl))
        if T: ev['tempo'] = [[u32(e, 24), round(f32(e, 28), 3), u32(e, 16), u32(e, 20)] for e in T]
        # TRAN > TRNB: guid, destination marker / region guid, u32 from, u32 to, u32 length + condition, u32 quantization unit
        # (1 beat, 2 bar — inferred), u32 count, f32 probability %, u32 kind (0 transition region, 1 transition marker, 2 loop region,
        # 4 transition region keeping the relative position); TRTL (transition timeline): u32 length (crossfade), [controller guid,
        # curve guid], [instrument guid, u32 start, u32 length] x 2 (stingers, set-parameter commands), bus fade curves.
        trs = []
        for c, b in objs[tl].get('LIST:TRNS') or []:
            if c == 'LCNT': continue
            tp = dict(b); tb = tp['TRNB']; cl = u32(tb, 40); q1, q2, prob, kind = struct.unpack_from('<IIfI', tb, 44 + cl)
            dest = marks.get(G(tb[16:32]))
            if dest is None: continue
            tr = [kind, u32(tb, 32), u32(tb, 36), dest[0]]
            extra = {}
            if cl: extra['cond'] = cond(tb[44:44 + cl])
            if q1: extra['q'] = [q1, q2]
            if round(prob) != 100: extra['prob'] = round(prob, 2)
            tt = tp.get('TRTL', b'')
            if len(tt) >= 4 and u32(tt, 0): extra['fade'] = u32(tt, 0)
            if len(tt) >= 10:
                _, q = arr(tt, 4); i2, q = arr(tt, q); i3, q = arr(tt, q)
                ins = [[inst(G(e[:16]), True, ec), u32(e, 16), u32(e, 20)] for e in i2 + i3 if len(e) == 24]
                if ins: extra['ins'] = ins
            trs.append(tr + ([extra] if extra else []))
        if trs: ev['tr'] = trs
        if end: ev['len'] = end
        if action: ev['action'] = [inst(G(e), True, ec) for e in action]
        sheet = []  # PMLB: guid, parameter guid, [instrument guids whose trigger condition reads it]; instruments only listed here sit on a parameter sheet
        for s in sheets:
            for e in arr(objs[G(s)]['PMLB'], 32)[0]:
                if G(e) not in placed: placed.add(G(e)); sheet.append(inst(G(e), True, ec))
        if sheet: ev['sheet'] = sheet
        if ec['tracks']: ev['tracks'] = ec['tracks']  # {key: [parent key, [[timeline position, dB], ...]]}
        return ev

    events = {n: event(g) for g, n in sorted(names.items(), key=lambda x: x[1]) if n.startswith('event:/') and g in objs}
    pout = {p.pop('name'): p for p in params.values()}
    return dict(params=pout, events=events, nested=nested), missing

def main():
    names, objs, files = build(Pck(PCK_DEFAULT))
    out, missing = db(names, objs, files)
    have = {os.path.relpath(os.path.join(d, f), OUT) for d, _, fs in os.walk(OUT) for f in fs if f.endswith('.ogg')}
    have |= {k for bank in json.load(open(os.path.join(OUT, 'manifest.json'))).values() for k in bank.get('aliases', {})}
    used = set()
    def walk(x):
        if isinstance(x, dict):
            if 'f' in x: used.add(x['f'])
            for v in x.values(): walk(v)
        elif isinstance(x, list):
            for v in x: walk(v)
    walk(out)
    absent = sorted(used - have)
    json.dump(out, open(os.path.join(OUT, 'events.json'), 'w'), separators=(',', ':'))
    print(f"{len(out['events'])} events, {len(out['nested'])} nested, {len(out['params'])} parameters, {len(used)} samples "
          f"({len(absent)} not extracted), unhandled instrument kinds {sorted(set(missing))} -> {OUT}/events.json "
          f"({os.path.getsize(os.path.join(OUT, 'events.json')) // 1024} KB)")
    for f in absent[:10]: print('  missing sample', f)

if __name__ == '__main__': main()
