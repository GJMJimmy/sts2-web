// Hand-written System.* surface used by the rule layer (see src/gen/bcl-uses.txt).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { provide, ext, str, fmt, fmtNum, cs, compare, compareStr, compareOrdinal, equals, hash, idHash, iter, round, enumStr, enumValues, isI, T, types, Enumerator, dm, charsToStr, span } from './core';
import { Task, TaskCompletionSource, CancellationToken, CancellationTokenSource } from './task';
import { Dictionary, HashSet, Queue, Stack, LinkedList } from './collections';
import { Enumerable } from './linq';

function def(proto: any, name: string, value: any) {
  Object.defineProperty(proto, name, { value, configurable: true, writable: true, enumerable: false });
}
function getter(proto: any, name: string, get: () => any) {
  Object.defineProperty(proto, name, { get, configurable: true, enumerable: false });
}

// ------------------------------------------------------------------ System.Object on every JS value
const O = Object.prototype as any;
def(O, 'Equals', function (this: any, o: any) { return this === o; });
def(O, 'GetHashCode', function (this: any) { return idHash(this); });
def(O, 'GetType', function (this: any) { return this.constructor; });
def(O, 'ToString', function (this: any) { return this.constructor?.$fullName ?? this.constructor?.name ?? 'Object'; });
def(O, 'MemberwiseClone', function (this: any) { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); });

const N = Number.prototype as any;
def(N, 'ToString', function (this: number, f?: any) { return typeof f === 'string' ? fmtNum(+this, f) : str(+this); });
def(N, 'Equals', function (this: number, o: any) { return +this === o; });
def(N, 'CompareTo', function (this: number, o: any) { return compare(+this, o); });
def(N, 'GetHashCode', function (this: number) { return hash(+this); });
// IConvertible (SmartFormat's plural/cond formatters convert through it)
def(N, 'ToDecimal', function (this: number) { return dm(+this); });
def(N, 'ToDouble', function (this: number) { return +this; });
def(N, 'ToSingle', function (this: number) { return Math.fround(+this); });
def(N, 'ToInt32', function (this: number) { return round(+this) | 0; }); // Convert rounds half to even
def(N, 'ToInt64', function (this: number) { return round(+this); });
def(N, 'ToBoolean', function (this: number) { return +this !== 0; });
const B = Boolean.prototype as any;
def(B, 'ToString', function (this: boolean) { return this.valueOf() ? 'True' : 'False'; });
def(B, 'Equals', function (this: boolean, o: any) { return this.valueOf() === o; });
def(B, 'CompareTo', function (this: boolean, o: any) { return (this.valueOf() ? 1 : 0) - (o ? 1 : 0); });

// ------------------------------------------------------------------ System.String
const S = String.prototype as any;
const cmpMode = (c: any) => c === 1 || c === 3 || c === 5; // *IgnoreCase comparisons
const lc = (s: string, c: any) => (cmpMode(c) ? s.toLowerCase() : s);
def(S, 'Contains', function (this: string, v: any, c?: any) { return lc(this, c).includes(lc(cs(v), c)); });
def(S, 'StartsWith', function (this: string, v: any, c?: any) { return lc(this, c).startsWith(lc(cs(v), c)); });
def(S, 'EndsWith', function (this: string, v: any, c?: any) { return lc(this, c).endsWith(lc(cs(v), c)); });
// IndexOf(value[, startIndex[, count]]); the rule layer never uses the StringComparison overloads.
def(S, 'IndexOf', function (this: string, v: any, start = 0, count?: number) {
  const i = this.indexOf(cs(v), start);
  return count === undefined || i < 0 || i + cs(v).length <= start + count ? i : -1;
});
def(S, 'IndexOfAny', function (this: string, chars: number[]) { let best = -1; for (const c of chars) { const i = this.indexOf(cs(c)); if (i >= 0 && (best < 0 || i < best)) best = i; } return best; });
def(S, 'LastIndexOf', function (this: string, v: any) { return this.lastIndexOf(cs(v)); });
def(S, 'Substring', function (this: string, i: number, n?: number) {
  if (i < 0 || i > this.length || (n !== undefined && (n < 0 || i + n > this.length))) throw new (ext('System.ArgumentOutOfRangeException'))('startIndex/length');
  return n === undefined ? this.substring(i) : this.substr(i, n);
});
def(S, 'Replace', function (this: string, a: any, b: any) { return this.split(cs(a)).join(b == null ? '' : cs(b)); });
def(S, 'Split', function (this: string, sep?: any, a?: any, b?: any) {
  let seps: string[];
  if (sep == null) seps = [' ', '\t', '\n', '\r'];
  else if (Array.isArray(sep)) seps = sep.map(cs);
  else seps = [cs(sep)];
  let count = Infinity, opts = 0;
  if (b !== undefined) { count = a; opts = b; } else if (a !== undefined) opts = a;
  let parts: string[] = [this];
  for (const s of seps) if (s !== '') parts = parts.flatMap((p) => p.split(s));
  if (opts & 2) parts = parts.map((p) => p.trim());
  if (opts & 1) parts = parts.filter((p) => p !== '');
  if (parts.length > count) parts = [...parts.slice(0, count - 1), parts.slice(count - 1).join(seps[0])];
  return parts;
});
const trimSet = (chars: any[] | undefined) => (chars && chars.length ? chars.map(cs) : null);
function trimImpl(s: string, chars: any, start: boolean, end: boolean) {
  const set = trimSet(chars === undefined ? undefined : Array.isArray(chars) ? chars : [chars]);
  if (!set) return start && end ? s.trim() : start ? s.trimStart() : s.trimEnd();
  let a = 0, b = s.length;
  if (start) while (a < b && set.includes(s[a])) a++;
  if (end) while (b > a && set.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
def(S, 'Trim', function (this: string, ...c: any[]) { return trimImpl(this, c.length > 1 ? c : c[0], true, true); });
def(S, 'TrimStart', function (this: string, ...c: any[]) { return trimImpl(this, c.length > 1 ? c : c[0], true, false); });
def(S, 'TrimEnd', function (this: string, ...c: any[]) { return trimImpl(this, c.length > 1 ? c : c[0], false, true); });
def(S, 'ToLower', function (this: string) { return this.toLowerCase(); });
def(S, 'ToUpper', function (this: string) { return this.toUpperCase(); });
def(S, 'ToLowerInvariant', function (this: string) { return this.toLowerCase(); });
def(S, 'ToUpperInvariant', function (this: string) { return this.toUpperCase(); });
def(S, 'PadLeft', function (this: string, n: number, c?: any) { return this.padStart(n, c === undefined ? ' ' : cs(c)); });
def(S, 'PadRight', function (this: string, n: number, c?: any) { return this.padEnd(n, c === undefined ? ' ' : cs(c)); });
def(S, 'Insert', function (this: string, i: number, v: string) { return this.slice(0, i) + v + this.slice(i); });
def(S, 'Remove', function (this: string, i: number, n?: number) { return n === undefined ? this.slice(0, i) : this.slice(0, i) + this.slice(i + n); });
def(S, 'Equals', function (this: string, o: any, c?: any) { return typeof o === 'string' && lc(this.valueOf(), c) === lc(o, c); });
def(S, 'CompareTo', function (this: string, o: any) { return compare(this.valueOf(), o); });
def(S, 'GetHashCode', function (this: string) { return hash(this.valueOf()); });
def(S, 'ToString', function (this: string) { return this.valueOf(); });
def(S, 'ToCharArray', function (this: string) { return Array.from(this, (c) => c.charCodeAt(0)); });
def(S, 'Normalize', function (this: string) { return this.normalize(); });
def(S, 'IsNormalized', function () { return true; });
def(S, 'GetEnumerator', function (this: string) { return new Enumerator(Array.from(this, (c) => c.charCodeAt(0))); });

const StringStatics = {
  $name: 'String',
  Empty: '',
  IsNullOrEmpty: (s: any) => s == null || s === '',
  IsNullOrWhiteSpace: (s: any) => s == null || s.trim() === '',
  Join: (sep: any, a: any, ...rest: any[]) => {
    const items = rest.length ? [a, ...rest] : Array.isArray(a) ? a : Array.from(iter(a));
    return items.map((x: any) => str(x)).join(cs(sep));
  },
  Concat: (...a: any[]) => (a.length === 1 && a[0] != null && typeof a[0] === 'object' ? Array.from(iter(a[0])) : a).map((x: any) => str(x)).join(''),
  Format: (f: string, ...args: any[]) => {
    const a = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const provider = typeof f !== 'string' ? (f = a.shift()) : null;
    void provider;
    return f.replace(/\{\{|\}\}|\{(\d+)(?:,(-?\d+))?(?::([^}]*))?\}/g, (m, i, al, fm) => (m === '{{' ? '{' : m === '}}' ? '}' : fmt(a[+i], fm ?? null, al ? +al : 0)));
  },
  Compare: (a: any, b: any, c?: any) => compareStr(a, b, c),
  CompareOrdinal: (a: any, b: any) => (a == null || b == null ? compare(a, b) : compareOrdinal(a, b)),
  Equals: (a: any, b: any, c?: any) => (a == null || b == null ? a === b : lc(a, c) === lc(b, c)),
  new: (c: any, n: number) => cs(c).repeat(n),
};
provide('System.String', StringStatics);

export class StringBuilder {
  s = '';
  constructor(init?: any) { if (typeof init === 'string') this.s = init; }
  get Length() { return this.s.length; }
  set Length(n: number) { this.s = this.s.slice(0, n).padEnd(n, '\0'); }
  /** Append(value) / Append(char as string, repeatCount) / Append(string|char[] as string, startIndex, count); the transpiler turns char arguments into strings. */
  Append(x: any, a?: number, b?: number) {
    if (isHandlerRef(x)) return this; // Append(ref handler): the handler already wrote into this builder
    this.s += b !== undefined ? str(x).substr(a!, b) : a !== undefined ? str(x).repeat(a) : str(x); return this; }
  AppendChar(c: number) { this.s += cs(c); return this; }
  AppendLine(x?: any) { this.s += (x === undefined || isHandlerRef(x) ? '' : str(x)) + '\n'; return this; }
  AppendFormat(f: string, ...a: any[]) { this.s += StringStatics.Format(f, ...a); return this; }
  AppendJoin(sep: any, items: any) { this.s += StringStatics.Join(sep, items); return this; }
  Insert(i: number, x: any) { this.s = this.s.slice(0, i) + str(x) + this.s.slice(i); return this; }
  Remove(i: number, n: number) { this.s = this.s.slice(0, i) + this.s.slice(i + n); return this; }
  Replace(a: any, b: any) { this.s = this.s.split(cs(a)).join(cs(b)); return this; }
  Clear() { this.s = ''; return this; }
  get_Item(i: number) { return this.s.charCodeAt(i); }
  ToString() { return this.s; }
}
provide('System.Text.StringBuilder', StringBuilder);
class AppendInterpolatedStringHandler {
  constructor(_a: number, _b: number, public sb: StringBuilder) {}
  AppendLiteral(s: string) { this.sb.s += s; }
  AppendFormatted(v: any, a?: any, b?: any) { this.sb.s += typeof a === 'string' ? fmt(v, a) : typeof b === 'string' ? fmt(v, b, a) : str(v); }
}
const isHandlerRef = (x: any) => x instanceof AppendInterpolatedStringHandler || x?.v instanceof AppendInterpolatedStringHandler;
provide('System.Text.StringBuilder+AppendInterpolatedStringHandler', AppendInterpolatedStringHandler);

// ------------------------------------------------------------------ Char / Convert / numbers
provide('System.Char', {
  $name: 'Char',
  IsLetter: (c: number) => /\p{L}/u.test(cs(c)),
  IsDigit: (c: number) => c >= 48 && c <= 57,
  IsLetterOrDigit: (c: number) => /[\p{L}\p{N}]/u.test(cs(c)),
  IsUpper: (c: number) => cs(c) !== cs(c).toLowerCase(),
  IsLower: (c: number) => cs(c) !== cs(c).toUpperCase(),
  IsWhiteSpace: (c: number) => /\s/.test(cs(c)),
  IsPunctuation: (c: number) => /\p{P}/u.test(cs(c)),
  ToUpper: (c: number) => cs(c).toUpperCase().charCodeAt(0),
  ToLower: (c: number) => cs(c).toLowerCase().charCodeAt(0),
  ToUpperInvariant: (c: number) => cs(c).toUpperCase().charCodeAt(0),
  ToLowerInvariant: (c: number) => cs(c).toLowerCase().charCodeAt(0),
  MaxValue: 0xffff,
  MinValue: 0,
});
const parseNum = (s: any) => { const v = Number(String(s).trim()); if (String(s).trim() === '' || Number.isNaN(v)) throw new (ext('System.FormatException'))(`Input string '${s}' was not in a correct format.`); return v; };
const tryParse = (int: boolean) => (s: any, ...rest: any[]) => {
  const out = rest[rest.length - 1];
  const t = s == null ? '' : String(s).trim();
  const v = Number(t);
  const ok = t !== '' && !Number.isNaN(v) && (!int || Number.isInteger(v));
  out.v = ok ? v : 0;
  return ok;
};
const numStatics = (name: string, int: boolean, min: number, max: number) => ({
  $name: name, MinValue: min, MaxValue: max,
  Parse: (s: any) => { const v = parseNum(s); if (int && !Number.isInteger(v)) throw new (ext('System.FormatException'))(`Input string '${s}' was not in a correct format.`); return v; },
  TryParse: tryParse(int),
  Max: (a: number, b: number) => Math.max(a, b),
  Min: (a: number, b: number) => Math.min(a, b),
  Clamp: (v: number, a: number, b: number) => Math.min(Math.max(v, a), b),
  Abs: Math.abs,
  IsNaN: Number.isNaN,
  IsInfinity: (v: number) => !Number.isFinite(v) && !Number.isNaN(v),
  IsPositiveInfinity: (v: number) => v === Infinity,
  PositiveInfinity: Infinity, NegativeInfinity: -Infinity, NaN, Epsilon: 1.401298e-45,
  Round: (x: number, d = 0, m = 0) => round(x, d, m),
  Floor: Math.floor, Ceiling: Math.ceil, Truncate: Math.trunc,
});
provide('System.Int32', numStatics('Int32', true, -2147483648, 2147483647));
provide('System.Int64', numStatics('Int64', true, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
provide('System.UInt32', numStatics('UInt32', true, 0, 4294967295));
provide('System.UInt64', numStatics('UInt64', true, 0, Number.MAX_SAFE_INTEGER));
provide('System.Int16', numStatics('Int16', true, -32768, 32767));
provide('System.Byte', numStatics('Byte', true, 0, 255));
provide('System.Single', numStatics('Single', false, -3.4028234663852886e38, 3.4028234663852886e38));
provide('System.Double', numStatics('Double', false, -Number.MAX_VALUE, Number.MAX_VALUE));
provide('System.Decimal', numStatics('Decimal', false, -79228162514264337593543950335, 79228162514264337593543950335));
provide('System.Boolean', { $name: 'Boolean', Parse: (s: string) => /^\s*true\s*$/i.test(s), TryParse: (s: any, out: any) => { const t = String(s ?? '').trim().toLowerCase(); out.v = t === 'true'; return t === 'true' || t === 'false'; }, TrueString: 'True', FalseString: 'False' });
const toInt = (v: any) => (typeof v === 'string' ? parseNum(v) : typeof v === 'boolean' ? (v ? 1 : 0) : round(+v));
provide('System.Convert', {
  $name: 'Convert',
  ToInt32: toInt, ToInt64: toInt, ToInt16: toInt, ToUInt32: toInt, ToUInt64: toInt, ToUInt16: toInt, ToByte: toInt, ToSByte: toInt,
  ToDouble: (v: any) => (typeof v === 'string' ? parseNum(v) : +v), ToSingle: (v: any) => (typeof v === 'string' ? parseNum(v) : +v),
  ToDecimal: (v: any) => dm(typeof v === 'string' ? parseNum(v) : +v),
  ToBoolean: (v: any) => (typeof v === 'string' ? /^\s*true\s*$/i.test(v) : !!v),
  ToString: (v: any, f?: any) => (typeof f === 'number' ? (v >>> 0).toString(f) : str(v)),
  ChangeType: (v: any, t: any) => (t?.$prim === 'number' ? +v : t?.$prim === 'string' ? str(v) : t?.$prim === 'boolean' ? !!v : v),
  ToBase64String: (bytes: number[]) => btoa(charsToStr(bytes)),
  FromBase64String: (s: string) => Array.from(atob(s), (c) => c.charCodeAt(0)),
});

// ------------------------------------------------------------------ Math
provide('System.Math', {
  $name: 'Math',
  PI: Math.PI, E: Math.E, Tau: Math.PI * 2,
  Abs: Math.abs, Sign: Math.sign, Sqrt: Math.sqrt, Pow: Math.pow, Exp: Math.exp,
  Log: (x: number, b?: number) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)), Log2: Math.log2, Log10: Math.log10,
  Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Atan: Math.atan, Atan2: Math.atan2, Asin: Math.asin, Acos: Math.acos,
  Floor: Math.floor, Ceiling: Math.ceil, Truncate: Math.trunc,
  Max: (a: number, b: number) => (a > b ? a : b), Min: (a: number, b: number) => (a < b ? a : b),
  Clamp: (v: number, lo: number, hi: number) => { if (lo > hi) throw new (ext('System.ArgumentException'))(`'${lo}' cannot be greater than ${hi}.`); return v < lo ? lo : v > hi ? hi : v; },
  Round: (x: number, a?: number, b?: number) => (b !== undefined ? round(x, a, b) : round(x, a ?? 0, 0)),
  DivRem: (a: number, b: number, out?: any) => { const q = Math.trunc(a / b); if (out) { out.v = a - q * b; return q; } return [q, a - q * b]; },
  BigMul: (a: number, b: number) => a * b,
});
provide('System.MathF', ext('System.Math'));

// ------------------------------------------------------------------ System.Random (exact .NET Net5CompatSeedImpl port)
const MBIG = 2147483647, MSEED = 161803398;
export class Random {
  private seedArray = new Int32Array(56);
  private inext = 0;
  private inextp = 21;
  private unseeded = false;
  constructor(seed?: number) {
    if (seed === undefined) { seed = (Math.random() * 2147483647) | 0; this.unseeded = true; }
    const sa = this.seedArray;
    const subtraction = seed === -2147483648 ? MBIG : Math.abs(seed);
    let mj = MSEED - subtraction;
    sa[55] = mj;
    let mk = 1, ii = 0;
    for (let i = 1; i < 55; i++) {
      if ((ii += 21) >= 55) ii -= 55;
      sa[ii] = mk;
      mk = mj - mk;
      if (mk < 0) mk += MBIG;
      mj = sa[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let n = i + 30;
        if (n >= 55) n -= 55;
        sa[i] -= sa[1 + n];
        if (sa[i] < 0) sa[i] += MBIG;
      }
    }
  }
  private internalSample(): number {
    let a = this.inext, b = this.inextp;
    if (++a >= 56) a = 1;
    if (++b >= 56) b = 1;
    let r = this.seedArray[a] - this.seedArray[b];
    if (r === MBIG) r--;
    if (r < 0) r += MBIG;
    this.seedArray[a] = r;
    this.inext = a;
    this.inextp = b;
    return r;
  }
  private sample() { return this.internalSample() * (1.0 / MBIG); }
  private largeRangeSample() {
    let r = this.internalSample();
    if (this.internalSample() % 2 === 0) r = -r;
    return (r + (MBIG - 1)) / (2.0 * MBIG - 1);
  }
  Next(a?: number, b?: number): number {
    if (a === undefined) return this.internalSample();
    if (b === undefined) { if (a < 0) throw new (ext('System.ArgumentOutOfRangeException'))('maxValue'); return Math.trunc(this.sample() * a); }
    if (a > b) throw new (ext('System.ArgumentOutOfRangeException'))('minValue');
    const range = b - a;
    return range <= 2147483647 ? Math.trunc(this.sample() * range) + a : Math.trunc(this.largeRangeSample() * range + a);
  }
  NextDouble() { return this.sample(); }
  NextSingle() { return this.sample(); }
  NextInt64(a?: number, b?: number) { return this.Next(a, b); }
  NextBytes(buf: number[]) { for (let i = 0; i < buf.length; i++) buf[i] = this.internalSample() % 256; }
  Shuffle(a: any[]) { for (let i = a.length - 1; i > 0; i--) { const j = this.Next(i + 1); [a[i], a[j]] = [a[j], a[i]]; } }
  static get Shared() { return sharedRandom; }
}
const sharedRandom = new Random();
provide('System.Random', Random);

// ------------------------------------------------------------------ Enum & Type
provide('System.Enum', {
  $name: 'Enum',
  GetValues: (e: any) => enumValues(e),
  GetValuesAsUnderlyingType: (e: any) => enumValues(e),
  GetNames: (e: any) => enumValues(e).map((v) => e[v]),
  GetName: (e: any, v: number) => e[v] ?? null,
  IsDefined: (e: any, v: any) => (typeof v === 'string' ? typeof e[v] === 'number' : typeof e[v] === 'string'),
  Parse: (e: any, s: any, ignoreCase?: any) => { const r = parseEnum(e, s, !!ignoreCase); if (r === undefined) throw new (ext('System.ArgumentException'))(`Requested value '${s}' was not found.`); return r; },
  TryParse: (e: any, s: any, ...rest: any[]) => { const out = rest[rest.length - 1]; const r = parseEnum(e, s, rest.length > 1 && !!rest[0]); out.v = r ?? 0; return r !== undefined; },
  ToObject: (_e: any, v: number) => v,
  GetUnderlyingType: () => T.Int32,
  Format: (e: any, v: number) => enumStr(e, v),
});
function parseEnum(e: any, s: any, ignoreCase: boolean): number | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  if (/^-?\d+$/.test(t)) return +t;
  let v = 0;
  for (const part of t.split(',').map((x) => x.trim())) {
    const key = Object.keys(e).find((k) => typeof e[k] === 'number' && (ignoreCase ? k.toLowerCase() === part.toLowerCase() : k === part));
    if (key === undefined) return undefined;
    v |= e[key];
  }
  return v;
}
const F = Function.prototype as any;
const hasOwnFlag = (t: any, k: string) => Object.hasOwn(t, k) && !!t[k];
getter(F, 'Name', function (this: any) { return this.$name ?? this.name; });
getter(F, 'FullName', function (this: any) { return this.$fullName ?? this.$name ?? this.name; });
getter(F, 'Namespace', function (this: any) { const f = this.$fullName ?? ''; return f.slice(0, f.lastIndexOf('.')); });
getter(F, 'IsAbstract', function (this: any) { return hasOwnFlag(this, '$abstract') || !!this.$iface; });
getter(F, 'IsInterface', function (this: any) { return !!this.$iface; });
getter(F, 'IsEnum', function (this: any) { return !!this.$enum; });
getter(F, 'IsClass', function (this: any) { return !this.$iface && !this.$struct && !this.$prim; });
getter(F, 'IsValueType', function (this: any) { return !!this.$struct || !!this.$enum || (this.$prim && this.$prim !== 'string' && this.$prim !== 'object'); });
getter(F, 'IsGenericType', function () { return false; });
getter(F, 'IsSealed', function () { return false; });
getter(F, 'BaseType', function (this: any) { const p = Object.getPrototypeOf(this); return p && p !== Function.prototype ? p : null; });
getter(F, 'Assembly', function () { return { GetName: () => ({ Name: 'sts2' }), FullName: 'sts2' }; });
getter(F, 'TypeHandle', function (this: any) { return this; });
def(F, 'IsSubclassOf', function (this: any, t: any) { return this !== t && typeof t === 'function' && this.prototype instanceof t; });
def(F, 'IsAssignableFrom', function (this: any, c: any) {
  if (c == null) return false;
  if (c === this) return true;
  if (this.$iface) return isI(Object.create(c.prototype), this);
  return typeof c === 'function' && c.prototype instanceof this;
});
def(F, 'IsInstanceOfType', function (this: any, o: any) { return o instanceof this; });
def(F, 'GetInterfaces', function (this: any) { const out: any[] = []; for (let c = this; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) if (Object.hasOwn(c, '$ifaces')) for (const i of c.$ifaces) if (!out.includes(i)) out.push(i); return out; });
def(F, 'GetElementType', function () { return null; });
def(F, 'GetGenericArguments', function () { return []; });
def(F, 'GetProperties', function () { return []; });
def(F, 'GetProperty', function () { return null; });
def(F, 'GetMethod', function () { return null; });
def(F, 'GetFields', function () { return []; });
def(F, 'GetCustomAttribute', function () { return null; });
def(F, 'GetCustomAttributes', function () { return []; });
provide('System.Reflection.IntrospectionExtensions', { GetTypeInfo: (t: any) => t });
provide('System.Type', { $name: 'Type', GetType: (name: string) => types.get(name) ?? null, EmptyTypes: [] });
provide('System.Activator', { $name: 'Activator', CreateInstance: (t: any, ...args: any[]) => { if (typeof t?.$new === 'function' && Object.hasOwn(t, '$new')) return t.$new(); if (t?.$prim) return t.$default; if (typeof t?.$default === 'function') return t.$default(); const o = new t(...args); return o; } });

// ------------------------------------------------------------------ Object / misc statics
provide('System.Object', { $name: 'Object', Equals: equals, ReferenceEquals: (a: any, b: any) => a === b });
provide('System.ArgumentNullException', null as any);
provide('System.Runtime.CompilerServices.RuntimeHelpers', { $name: 'RuntimeHelpers', GetHashCode: idHash, EnsureSufficientExecutionStack() {}, PrepareMethod() {} });
provide('System.Runtime.InteropServices.CollectionsMarshal', { $name: 'CollectionsMarshal', SetCount: (l: any[], n: number) => { const old = l.length; l.length = n; for (let i = old; i < n; i++) l[i] = null; }, AsSpan: (l: any[]) => span(l) }); // a live view: `a.CopyTo(span.Slice(i, n))` writes into the list
provide('System.Collections.Generic.EqualityComparer`1', { $name: 'EqualityComparer', Default: { Equals: equals, GetHashCode: hash } });
provide('System.Collections.Generic.Comparer`1', { $name: 'Comparer', Default: { Compare: compare } });
const cultureCmp = (ic: boolean) => ({ Compare: (a: string, b: string) => compareStr(a, b, ic), Equals: (a: string, b: string) => compareStr(a, b, ic) === 0, GetHashCode: (a: string) => hash(ic ? a?.toUpperCase() : a) });
provide('System.StringComparer', {
  $name: 'StringComparer',
  Ordinal: { Compare: (a: string, b: string) => compareStr(a, b, 4), Equals: (a: any, b: any) => a === b, GetHashCode: hash },
  OrdinalIgnoreCase: { Compare: (a: string, b: string) => compareStr(a, b, 5), Equals: (a: string, b: string) => a?.toUpperCase() === b?.toUpperCase(), GetHashCode: (a: string) => hash(a?.toUpperCase()) },
  InvariantCulture: cultureCmp(false), InvariantCultureIgnoreCase: cultureCmp(true), CurrentCulture: cultureCmp(false), CurrentCultureIgnoreCase: cultureCmp(true),
});
provide('System.Lazy`1', class Lazy { private v: any; private done = false; constructor(private f: () => any) {} get Value() { if (!this.done) { this.v = this.f(); this.done = true; } return this.v; } get IsValueCreated() { return this.done; } });
provide('System.Threading.Lock', class Lock { EnterScope() { return { Dispose() {} }; } Enter() {} Exit() {} });
provide('System.Threading.Monitor', { Enter() {}, Exit() {} });
provide('System.Threading.Interlocked', { Increment: (r: any) => ++r.v, Decrement: (r: any) => --r.v, Exchange: (r: any, v: any) => { const o = r.v; r.v = v; return o; }, CompareExchange: (r: any, v: any, c: any) => { const o = r.v; if (o === c) r.v = v; return o; } });
provide('System.Tuple', { Create: (...a: any[]) => a });
provide('System.ValueTuple', { Create: (...a: any[]) => a });
provide('System.Environment', { $name: 'Environment', NewLine: '\n', GetCommandLineArgs: () => [], GetEnvironmentVariable: () => null, GetFolderPath: () => '/user', get TickCount() { return Math.trunc(performance.now()); }, get TickCount64() { return Math.trunc(performance.now()); }, ProcessorCount: 1, get StackTrace() { return new Error().stack ?? ''; }, MachineName: 'web', OSVersion: { ToString: () => 'Web' }, Is64BitProcess: true });
provide('System.GC', { Collect() {}, GetTotalMemory: () => 0, SuppressFinalize() {}, KeepAlive() {}, ReRegisterForFinalize() {} });
provide('System.Diagnostics.Stopwatch', class Stopwatch { private t0 = 0; private acc = 0; private running = false; static StartNew() { const s = new Stopwatch(); s.Start(); return s; } static GetTimestamp() { return performance.now() * 1e4; } static Frequency = 1e7; Start() { if (!this.running) { this.t0 = performance.now(); this.running = true; } } Stop() { if (this.running) { this.acc += performance.now() - this.t0; this.running = false; } } Reset() { this.acc = 0; this.running = false; } Restart() { this.acc = 0; this.t0 = performance.now(); this.running = true; } get ElapsedMilliseconds() { return Math.trunc(this.ms()); } get Elapsed() { return TimeSpan.FromMilliseconds(this.ms()); } get IsRunning() { return this.running; } private ms() { return this.acc + (this.running ? performance.now() - this.t0 : 0); } });
provide('System.Diagnostics.StackTrace', class { constructor() {} GetFrames() { return []; } ToString() { return new Error().stack ?? ''; } });
provide('System.Diagnostics.StackFrame', class { GetFileName() { return ''; } GetFileLineNumber() { return 0; } GetMethod() { return null; } });
provide('System.Diagnostics.Debug', { Assert() {}, WriteLine() {}, Print() {} });
provide('System.Console', { WriteLine: (...a: any[]) => console.log(...a.map(str)), Write: (...a: any[]) => console.log(...a.map(str)) });
provide('System.Globalization.CultureInfo', Object.assign(class CultureInfo { constructor(public Name = '') {} get ThreeLetterISOLanguageName() { return 'eng'; } get TwoLetterISOLanguageName() { return 'en'; } }, { InvariantCulture: { Name: '', NumberFormat: {} }, CurrentCulture: { Name: 'en-US' }, GetCultureInfo: (n: string) => ({ Name: n, ThreeLetterISOLanguageName: 'eng', TwoLetterISOLanguageName: n.slice(0, 2) }), GetCultures: () => [] }));

export class TimeSpan {
  constructor(public ms = 0) {}
  static FromMilliseconds(n: number) { return new TimeSpan(n); }
  static FromSeconds(n: number) { return new TimeSpan(n * 1000); }
  static FromMinutes(n: number) { return new TimeSpan(n * 60000); }
  static FromHours(n: number) { return new TimeSpan(n * 3600000); }
  static FromDays(n: number) { return new TimeSpan(n * 86400000); }
  static FromTicks(n: number) { return new TimeSpan(n / 1e4); }
  static get Zero() { return new TimeSpan(0); }
  static $default() { return new TimeSpan(0); }
  get TotalMilliseconds() { return this.ms; }
  get TotalSeconds() { return this.ms / 1000; }
  get TotalMinutes() { return this.ms / 60000; }
  get TotalHours() { return this.ms / 3600000; }
  get TotalDays() { return this.ms / 86400000; }
  get Ticks() { return this.ms * 1e4; }
  get Milliseconds() { return Math.trunc(this.ms) % 1000; }
  get Seconds() { return Math.trunc(this.ms / 1000) % 60; }
  get Minutes() { return Math.trunc(this.ms / 60000) % 60; }
  get Hours() { return Math.trunc(this.ms / 3600000) % 24; }
  get Days() { return Math.trunc(this.ms / 86400000); }
  Add(o: TimeSpan) { return new TimeSpan(this.ms + o.ms); }
  Subtract(o: TimeSpan) { return new TimeSpan(this.ms - o.ms); }
  CompareTo(o: TimeSpan) { return compare(this.ms, o.ms); }
  Equals(o: any) { return o instanceof TimeSpan && o.ms === this.ms; }
  $key() { return 'ts' + this.ms; }
  static op_Addition(a: TimeSpan, b: TimeSpan) { return a.Add(b); }
  static op_Subtraction(a: TimeSpan, b: TimeSpan) { return a.Subtract(b); }
  static op_GreaterThan(a: TimeSpan, b: TimeSpan) { return a.ms > b.ms; }
  static op_LessThan(a: TimeSpan, b: TimeSpan) { return a.ms < b.ms; }
  static op_GreaterThanOrEqual(a: TimeSpan, b: TimeSpan) { return a.ms >= b.ms; }
  static op_LessThanOrEqual(a: TimeSpan, b: TimeSpan) { return a.ms <= b.ms; }
  static op_Equality(a: TimeSpan, b: TimeSpan) { return a?.ms === b?.ms; }
  ToString(f?: string) {
    const t = Math.abs(this.ms);
    const h = Math.trunc(t / 3600000), m = Math.trunc(t / 60000) % 60, s = Math.trunc(t / 1000) % 60;
    if (f) return f.replace(/\\/g, '').replace('hh', String(h % 24).padStart(2, '0')).replace('mm', String(m).padStart(2, '0')).replace('ss', String(s).padStart(2, '0')).replace(/%?h/, String(h)).replace(/%?m/, String(m));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}
provide('System.TimeSpan', TimeSpan);
export class DateTime {
  constructor(public ms = 0) {}
  static get Now() { return new DateTime(Date.now()); }
  static get UtcNow() { return new DateTime(Date.now()); }
  static get Today() { const d = new Date(); d.setHours(0, 0, 0, 0); return new DateTime(d.getTime()); }
  static get MinValue() { return new DateTime(-62135596800000); }
  static get MaxValue() { return new DateTime(253402300799999); }
  static $default() { return DateTime.MinValue; }
  static UnixEpoch = new DateTime(0);
  static Parse(s: string) { return new DateTime(Date.parse(s)); }
  static TryParse(s: string, ...rest: any[]) { const v = Date.parse(s); rest[rest.length - 1].v = new DateTime(v); return !Number.isNaN(v); }
  get Year() { return new Date(this.ms).getUTCFullYear(); }
  get Month() { return new Date(this.ms).getUTCMonth() + 1; }
  get Day() { return new Date(this.ms).getUTCDate(); }
  get Hour() { return new Date(this.ms).getUTCHours(); }
  get Minute() { return new Date(this.ms).getUTCMinutes(); }
  get Second() { return new Date(this.ms).getUTCSeconds(); }
  get DayOfYear() { const d = new Date(this.ms); return Math.floor((this.ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1; }
  get DayOfWeek() { return new Date(this.ms).getUTCDay(); }
  get Date() { const d = new Date(this.ms); return new DateTime(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  get Ticks() { return (this.ms + 62135596800000) * 1e4; }
  AddDays(n: number) { return new DateTime(this.ms + n * 86400000); }
  AddSeconds(n: number) { return new DateTime(this.ms + n * 1000); }
  AddMilliseconds(n: number) { return new DateTime(this.ms + n); }
  AddHours(n: number) { return new DateTime(this.ms + n * 3600000); }
  Subtract(o: any) { return o instanceof DateTime ? new TimeSpan(this.ms - o.ms) : new DateTime(this.ms - o.ms); }
  ToUniversalTime() { return this; }
  ToLocalTime() { return this; }
  CompareTo(o: DateTime) { return compare(this.ms, o.ms); }
  Equals(o: any) { return o instanceof DateTime && o.ms === this.ms; }
  $key() { return 'dt' + this.ms; }
  ToString(f?: string) { const d = new Date(this.ms); if (!f) return d.toISOString(); return f.replace('yyyy', String(d.getUTCFullYear())).replace('MM', String(d.getUTCMonth() + 1).padStart(2, '0')).replace('dd', String(d.getUTCDate()).padStart(2, '0')).replace('HH', String(d.getUTCHours()).padStart(2, '0')).replace('mm', String(d.getUTCMinutes()).padStart(2, '0')).replace('ss', String(d.getUTCSeconds()).padStart(2, '0')); }
  static op_Subtraction(a: DateTime, b: any) { return a.Subtract(b); }
  static op_GreaterThan(a: DateTime, b: DateTime) { return a.ms > b.ms; }
  static op_LessThan(a: DateTime, b: DateTime) { return a.ms < b.ms; }
  static op_Equality(a: DateTime, b: DateTime) { return a?.ms === b?.ms; }
  static op_Inequality(a: DateTime, b: DateTime) { return a?.ms !== b?.ms; }
  static op_GreaterThanOrEqual(a: DateTime, b: DateTime) { return a.ms >= b.ms; }
  static op_LessThanOrEqual(a: DateTime, b: DateTime) { return a.ms <= b.ms; }
  static op_Addition(a: DateTime, b: TimeSpan) { return new DateTime(a.ms + b.ms); }
}
provide('System.DateTime', DateTime);
provide('System.DateTimeOffset', Object.assign(class DateTimeOffset extends DateTime {
  static get Now() { return new DateTimeOffset(Date.now()); }
  static get UtcNow() { return new DateTimeOffset(Date.now()); }
  static FromUnixTimeSeconds(s: number) { return new DateTimeOffset(s * 1000); }
  static FromUnixTimeMilliseconds(s: number) { return new DateTimeOffset(s); }
  ToUnixTimeSeconds() { return Math.floor(this.ms / 1000); }
  ToUnixTimeMilliseconds() { return this.ms; }
  get UtcDateTime() { return new DateTime(this.ms); }
  get DateTime() { return new DateTime(this.ms); }
  get LocalDateTime() { return new DateTime(this.ms); }
}, {}));
provide('System.Guid', class Guid { constructor(public s = '00000000-0000-0000-0000-000000000000') {} static NewGuid() { return new Guid(crypto.randomUUID()); } static Empty = new Guid(); ToString() { return this.s; } Equals(o: any) { return o?.s === this.s; } $key() { return this.s; } });

// ------------------------------------------------------------------ Tasks & collections
provide('System.Threading.Tasks.Task', Task);
provide('System.Threading.Tasks.Task`1', Task);
provide('System.Threading.Tasks.ValueTask', Task);
provide('System.Threading.Tasks.TaskCompletionSource', TaskCompletionSource);
provide('System.Threading.Tasks.TaskCompletionSource`1', TaskCompletionSource);
provide('System.Threading.CancellationToken', CancellationToken);
provide('System.Threading.CancellationTokenSource', CancellationTokenSource);
provide('System.Collections.Generic.Dictionary`2', Dictionary);
provide('System.Collections.Generic.SortedDictionary`2', Dictionary);
provide('System.Collections.Concurrent.ConcurrentDictionary`2', Dictionary);
provide('System.Collections.Generic.HashSet`1', HashSet);
provide('System.Collections.Generic.SortedSet`1', HashSet);
provide('System.Collections.Generic.Queue`1', Queue);
provide('System.Collections.Concurrent.ConcurrentQueue`1', Queue);
provide('System.Collections.Generic.Stack`1', Stack);
provide('System.Collections.Generic.LinkedList`1', LinkedList);
provide('System.Collections.Generic.List`1', Array);
provide('System.Linq.Enumerable', Enumerable);
provide('System.Collections.Generic.CollectionExtensions', {
  GetValueOrDefault: (d: any, k: any, def: any = null) => { const out = { v: undefined }; return d.TryGetValue(k, out) ? out.v : def; },
  TryAdd: (d: any, k: any, v: any) => d.TryAdd(k, v),
  Remove: (d: any, k: any, out: any) => d.Remove(k, out),
  AsReadOnly: (x: any) => x,
});
provide('System.Array', {
  $name: 'Array',
  Empty: () => [],
  IndexOf: (a: any[], x: any) => (a as any).IndexOf(x),
  Exists: (a: any[], p: any) => a.some((x) => p(x)),
  Find: (a: any[], p: any) => (a as any).Find(p),
  FindIndex: (a: any[], p: any) => a.findIndex((x) => p(x)),
  FindAll: (a: any[], p: any) => a.filter((x) => p(x)),
  LastIndexOf: (a: any[], x: any) => a.lastIndexOf(x),
  Clear: (a: any[], i = 0, n = a.length - i) => { for (let k = i; k < i + n; k++) a[k] = null; },
  Copy: (src: any[], a: any, b?: any, c?: any, d?: any) => { if (c === undefined) { for (let i = 0; i < b; i++) a[i] = src[i]; } else { for (let i = 0; i < d; i++) c[b + i] = src[a + i]; } },
  Resize: (r: any, n: number) => { r.v = (r.v ?? []).slice(0, n); while (r.v.length < n) r.v.push(null); },
  Sort: (a: any[], c?: any) => (a as any).Sort(c),
  Reverse: (a: any[]) => a.reverse(),
  CreateInstance: (_t: any, n: number) => new Array(n).fill(null),
  ConvertAll: (a: any[], f: any) => a.map((x) => f(x)),
  TrueForAll: (a: any[], p: any) => a.every((x) => p(x)),
});

// ------------------------------------------------------------------ exceptions
export class Exception extends Error {
  InnerException: any = null;
  Data = new Dictionary();
  constructor(message?: any, inner?: any) {
    // AggregateException(Exception) / (IEnumerable<Exception>): the inner exception(s) come first
    const inners = message instanceof Error ? [message] : Array.isArray(message) ? message : null;
    super(inners ? `One or more errors occurred.${inners.map((e: any) => ` (${e?.message ?? e})`).join('')}` : message ?? '');
    this.name = (new.target as any).$name ?? new.target.name;
    this.InnerException = inner ?? inners?.[0] ?? null;
    if (inners) this.$inners = inners;
  }
  $inners: any[] | null = null;
  static $name = 'Exception';
  static $fullName = 'System.Exception';
  static $extCtor(this: any, message?: any, inner?: any) {
    if (typeof message === 'string') this.message = message;
    else if (message instanceof Error) this.InnerException = message;
    if (inner !== undefined) this.InnerException = inner;
  }
  get Message() { return this.message; }
  get StackTrace() { return this.stack ?? ''; }
  get Source() { return 'sts2'; }
  GetBaseException() { let e: any = this; while (e.InnerException) e = e.InnerException; return e; }
  ToString() { return `${(this.constructor as any).$fullName}: ${this.message}\n${this.stack ?? ''}`; }
}
const exNames: [string, string][] = [
  ['System.SystemException', 'System.Exception'], ['System.ApplicationException', 'System.Exception'],
  ['System.InvalidOperationException', 'System.SystemException'], ['System.ArgumentException', 'System.SystemException'],
  ['System.ArgumentNullException', 'System.ArgumentException'], ['System.ArgumentOutOfRangeException', 'System.ArgumentException'],
  ['System.NullReferenceException', 'System.SystemException'], ['System.NotImplementedException', 'System.SystemException'],
  ['System.NotSupportedException', 'System.SystemException'], ['System.IndexOutOfRangeException', 'System.SystemException'],
  ['System.InvalidCastException', 'System.SystemException'], ['System.FormatException', 'System.SystemException'],
  ['System.OverflowException', 'System.SystemException'], ['System.DivideByZeroException', 'System.SystemException'],
  ['System.TimeoutException', 'System.SystemException'], ['System.InvalidProgramException', 'System.SystemException'],
  ['System.OperationCanceledException', 'System.SystemException'], ['System.Threading.Tasks.TaskCanceledException', 'System.OperationCanceledException'],
  ['System.Collections.Generic.KeyNotFoundException', 'System.SystemException'], ['System.IO.IOException', 'System.SystemException'],
  ['System.IO.FileNotFoundException', 'System.IO.IOException'], ['System.IO.DirectoryNotFoundException', 'System.IO.IOException'],
  ['System.UnauthorizedAccessException', 'System.SystemException'], ['System.ComponentModel.InvalidEnumArgumentException', 'System.ArgumentException'],
  ['System.Runtime.CompilerServices.SwitchExpressionException', 'System.InvalidOperationException'], ['System.Text.Json.JsonException', 'System.Exception'],
  ['System.ObjectDisposedException', 'System.InvalidOperationException'], ['System.AggregateException', 'System.Exception'],
  ['System.Net.Http.HttpRequestException', 'System.Exception'], ['System.StackOverflowException', 'System.SystemException'],
];
provide('System.Exception', Exception);
for (const [name, base] of exNames) {
  const Base = ext(base);
  const short = name.split('.').pop()!;
  const C = { [short]: class extends Base {} }[short] as any;
  C.$name = short;
  C.$fullName = name;
  if (short === 'ArgumentNullException' || short === 'ArgumentOutOfRangeException') {
    C.ThrowIfNull = (v: any, n?: string) => { if (v == null) throw new C(`Value cannot be null. (Parameter '${n}')`); };
    C.ThrowIfNegative = (v: number, n?: string) => { if (v < 0) throw new C(`${n} must be non-negative`); };
    C.ThrowIfZero = (v: number, n?: string) => { if (v === 0) throw new C(`${n} must be non-zero`); };
    C.ThrowIfGreaterThan = (v: number, o: number, n?: string) => { if (v > o) throw new C(`${n} too large`); };
    C.ThrowIfLessThan = (v: number, o: number, n?: string) => { if (v < o) throw new C(`${n} too small`); };
    C.ThrowIfNegativeOrZero = (v: number, n?: string) => { if (v <= 0) throw new C(`${n} must be positive`); };
  }
  if (short === 'ArgumentException') {
    C.ThrowIfNullOrEmpty = (v: any, n?: string) => { if (v == null || v === '') throw new C(`The value cannot be an empty string. (Parameter '${n}')`); };
    C.ThrowIfNullOrWhiteSpace = (v: any, n?: string) => { if (v == null || String(v).trim() === '') throw new C(`The value cannot be empty. (Parameter '${n}')`); };
  }
  if (short === 'ObjectDisposedException') C.ThrowIf = (c: boolean, o: any) => { if (c) throw new C(String(o)); };
  if (short === 'AggregateException') Object.defineProperty(C.prototype, 'InnerExceptions', { get() { return this.$inners ?? (this.InnerException ? [this.InnerException] : []); } });
  provide(name, C);
}
// JS runtime errors should be catchable as .NET exceptions
// Native JS errors (TypeError from a runtime gap) reach .NET code as exceptions: Exception.ToString() prints message + stack
Object.defineProperty(Error.prototype, 'ToString', { value(this: Error) { return `${this.name}: ${this.message}\n${this.stack ?? ''}`; }, configurable: true, writable: true });
for (const k of ['Message', 'StackTrace', 'InnerException']) if (!(k in Error.prototype)) Object.defineProperty(Error.prototype, k, { get(this: Error) { return k === 'Message' ? this.message : k === 'StackTrace' ? this.stack : null; }, configurable: true });

// ------------------------------------------------------------------ IO / paths (browser: in-memory; persistence via Godot FileAccess shim)
const pathJoin = (...parts: string[]) => parts.filter((p) => p != null && p !== '').join('/').replace(/\/+/g, '/');
provide('System.IO.Path', {
  $name: 'Path',
  Combine: (...p: any[]) => pathJoin(...(p.length === 1 && Array.isArray(p[0]) ? p[0] : p)),
  Join: (...p: any[]) => pathJoin(...p),
  GetFileName: (p: string) => p?.split('/').pop() ?? '',
  GetFileNameWithoutExtension: (p: string) => (p?.split('/').pop() ?? '').replace(/\.[^.]*$/, ''),
  GetExtension: (p: string) => /\.[^./]*$/.exec(p ?? '')?.[0] ?? '',
  GetDirectoryName: (p: string) => (p?.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''),
  ChangeExtension: (p: string, e: string) => p.replace(/\.[^./]*$/, '') + (e.startsWith('.') ? e : '.' + e),
  DirectorySeparatorChar: 47,
  GetTempPath: () => '/tmp',
  GetFullPath: (p: string) => p,
});
const memfs = new Map<string, string>();
provide('System.IO.File', {
  Exists: (p: string) => memfs.has(p), ReadAllText: (p: string) => memfs.get(p) ?? '', WriteAllText: (p: string, s: string) => void memfs.set(p, s),
  Delete: (p: string) => void memfs.delete(p), Copy: (a: string, b: string) => void memfs.set(b, memfs.get(a) ?? ''), Move: (a: string, b: string) => { memfs.set(b, memfs.get(a) ?? ''); memfs.delete(a); },
  SetLastWriteTimeUtc() {}, ReadAllBytes: () => [], WriteAllBytes() {}, AppendAllText: (p: string, s: string) => void memfs.set(p, (memfs.get(p) ?? '') + s),
});
provide('System.IO.Directory', { Exists: () => true, CreateDirectory: () => ({}), Delete() {}, GetDirectories: () => [], GetFiles: () => [], Move() {}, EnumerateFiles: () => [] });

// Reflection bits used by stack-trace helpers
provide('System.Reflection.MemberInfo', {});
export { Enumerable };
export { enumStr };

// ------------------------------------------------------------------ reflection over emitted metadata ($attrs / $members)
export function extAttr(cls: any, args: any[], named: Record<string, any>) {
  const o = Object.create(cls?.prototype ?? Object.prototype);
  o.$args = args;
  // unimplemented BCL attribute types are placeholder proxies whose prototype.constructor is the bare target: keep the name here
  o.$attrType = cls?.$fullName;
  return Object.assign(o, named);
}
export const attrTypeName = (a: any): string | undefined => a?.$attrType ?? a?.constructor?.$fullName;
function attrMatch(a: any, t: any) {
  if (t == null) return true;
  if (a instanceof t) return true;
  const n = attrTypeName(a);
  return n !== undefined && n === t.$fullName;
}
function ownAttrs(c: any): any[] {
  return c && Object.hasOwn(c, '$attrs') || (c && Object.getOwnPropertyDescriptor(c, '$attrs')) ? c.$attrs ?? [] : [];
}
class PropertyInfo {
  constructor(public Name: string, public PropertyType: any, public DeclaringType: any, private attrs: any[], public $kind: string) {}
  get CanRead() { return true; }
  get CanWrite() { return true; }
  get MemberType() { return this.$kind === 'p' ? 16 : 4; }
  get FieldType() { return this.PropertyType; }
  GetValue(o: any) { return o[this.Name]; }
  SetValue(o: any, v: any) { o[this.Name] = v; }
  GetCustomAttributes(t?: any) { return this.attrs.filter((a) => attrMatch(a, t)); }
  GetCustomAttribute(t: any) { return this.attrs.find((a) => attrMatch(a, t)) ?? null; }
  IsDefined(t: any) { return this.attrs.some((a) => attrMatch(a, t)); }
  // SmartFormat's ReflectionSource reads properties through their getter MethodInfo
  GetGetMethod() { const name = this.Name; return { GetParameters: () => [], ReturnType: this.PropertyType, Invoke: (o: any) => o[name] }; }
  ToString() { return this.Name; }
}
const propCache = new WeakMap<object, PropertyInfo[]>();
function propsOf(t: any): PropertyInfo[] {
  let r = propCache.get(t);
  if (r) return r;
  r = [];
  const seen = new Set<string>();
  for (let c = t; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (!Object.hasOwn(c, '$members')) continue;
    const ms = c.$members();
    for (const [name, m] of Object.entries<any>(ms)) {
      if (seen.has(name)) continue;
      seen.add(name);
      r.push(new PropertyInfo(name, m.t, c, m.a, m.k));
    }
  }
  propCache.set(t, r);
  return r;
}
const Fp = Function.prototype as any;
const fdef = (name: string, value: any) => Object.defineProperty(Fp, name, { value, configurable: true, writable: true, enumerable: false });
fdef('GetCustomAttributes', function (this: any, a?: any, b?: any) {
  const t = typeof a === 'boolean' ? null : a;
  const inherit = typeof a === 'boolean' ? a : b ?? true;
  const out: any[] = [];
  for (let c = this; c && c !== Function.prototype; c = inherit ? Object.getPrototypeOf(c) : null) out.push(...ownAttrs(c).filter((x: any) => attrMatch(x, t)));
  return out;
});
fdef('GetCustomAttribute', function (this: any, t: any, inherit = true) { return this.GetCustomAttributes(t, inherit)[0] ?? null; });
fdef('IsDefined', function (this: any, t: any, inherit = true) { return this.GetCustomAttributes(t, inherit).length > 0; });
fdef('GetProperties', function (this: any) { return propsOf(this).filter((p) => p.$kind === 'p'); });
fdef('GetFields', function (this: any) { return propsOf(this).filter((p) => p.$kind === 'f'); });
// Metadata only covers attributed members; SmartFormat's ReflectionSource needs any public getter, so add prototype getters.
const membersCache = new WeakMap<object, PropertyInfo[]>();
fdef('GetMembers', function (this: any) {
  let r = membersCache.get(this);
  if (r) return r;
  r = [...propsOf(this)];
  const seen = new Set(r.map((p) => p.Name));
  for (let proto = this.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto))
    for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(proto)))
      if (d.get && !seen.has(name) && /^[A-Z]/.test(name)) { seen.add(name); r.push(new PropertyInfo(name, null, this, [], 'p')); }
  membersCache.set(this, r);
  return r;
});
fdef('GetProperty', function (this: any, n: string) { return propsOf(this).find((p) => p.Name === n) ?? null; });
fdef('GetField', function (this: any, n: string) { return propsOf(this).find((p) => p.Name === n) ?? null; });
provide('System.Reflection.PropertyInfo', PropertyInfo);
provide('System.Reflection.CustomAttributeExtensions', {
  GetCustomAttribute: (t: any, m: any) => (typeof m?.GetCustomAttribute === 'function' ? m.GetCustomAttribute(t) : null),
  GetCustomAttributes: (t: any, m: any) => (typeof m?.GetCustomAttributes === 'function' ? m.GetCustomAttributes(t) : []),
  IsDefined: (m: any, t: any) => (typeof m?.IsDefined === 'function' ? m.IsDefined(t) : false),
});
provide('System.AppDomain', { CurrentDomain: { GetAssemblies: () => [], AssemblyResolve: null, BaseDirectory: '/', FriendlyName: 'sts2' } });
provide('System.Reflection.Assembly', { GetExecutingAssembly: () => ({ GetName: () => ({ Name: 'sts2', Version: { ToString: () => '0.98.3' } }), GetTypes: () => [], Location: '/' }), GetEntryAssembly: () => null, LoadFrom: () => null });

// ------------------------------------------------------------------ Regex (.NET pattern dialect is close to JS for the patterns the game uses)
const RX_IGNORECASE = 1, RX_MULTILINE = 2, RX_EXPLICITCAPTURE = 4, RX_SINGLELINE = 16, RX_IGNOREWS = 32;
class Group {
  constructor(public Value: string, public Success: boolean, public Index: number, private caps?: Group[]) {}
  get Length() { return this.Value.length; }
  ToString() { return this.Value; }
  /** Every capture of a group inside a repeated `(?:…)+` (see Regex.rep); otherwise just the last one. */
  get Captures() { return this.caps ?? (this.Success ? [new Group(this.Value, true, this.Index)] : []); }
}
class Match extends Group {
  Groups: any;
  /** `off`: where `input` sits in the caller's string (Match(s, beginning, length) matches a substring). */
  constructor(private m: RegExpExecArray | null, private rx: Regex, private input: string, private off = 0) {
    super(m?.[0] ?? '', !!m, (m?.index ?? 0) + off);
    const caps = m ? rx.$captures(input, m, off) : null;
    const at = (i: number) => (m as any)?.indices?.[i]?.[0] ?? m?.index ?? 0;
    const gs: Group[] = m ? Array.from(m, (v, i) => new Group(v ?? '', v !== undefined, at(i) + off, caps?.[i])) : [];
    const named = (m as any)?.indices?.groups ?? {};
    this.Groups = Object.assign(gs, {
      get_Item: (k: any) => {
        if (typeof k === 'number') return gs[k] ?? new Group('', false, 0);
        const v = m?.groups?.[k];
        return v !== undefined ? new Group(v, true, (named[k]?.[0] ?? 0) + off) : new Group('', false, 0);
      },
    });
  }
  NextMatch() { return this.rx.$next(this.input, this.Index - this.off + Math.max(1, this.Length), this.off); }
}
/** .NET-only pattern syntax: `x` mode (whitespace/comments), ExplicitCapture, \A \z \Z, (?<name>…). */
function translatePattern(p: string, options: number) {
  let out = '';
  for (let i = 0, cls = false; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') { const n = p[i + 1] ?? ''; out += cls ? c + n : n === 'A' ? '^' : n === 'z' ? '$' : n === 'Z' ? '(?=\\n?$)' : c + n; i++; continue; }
    if (cls) { if (c === ']') cls = false; out += c; continue; }
    if (c === '[') { cls = true; out += c; if (p[i + 1] === '^') out += p[++i]; if (p[i + 1] === ']') out += '\\' + p[++i]; continue; }
    if (options & RX_IGNOREWS) {
      if (/\s/.test(c)) continue;
      if (c === '#') { while (i < p.length && p[i] !== '\n') i++; continue; }
    }
    if (c === '(' && p[i + 1] !== '?' && options & RX_EXPLICITCAPTURE) { out += '(?:'; continue; }
    out += c;
  }
  return out;
}
const countGroups = (p: string) => { try { return new RegExp(p + '|').exec('')!.length - 1; } catch { return 0; } };
export class Regex {
  private re: RegExp;
  constructor(pattern: string, options = 0) {
    let flags = 'gud';
    if (options & RX_IGNORECASE) flags += 'i';
    if (options & RX_MULTILINE) flags += 'm';
    if (options & RX_SINGLELINE) flags += 's';
    const p = translatePattern(pattern, options);
    try { this.re = new RegExp(p, flags); } catch { flags = flags.replace('u', ''); this.re = new RegExp(p, flags); }
    this.src = p; this.flags = flags; this.hasG = /\\G/.test(p);
    // `^(?:BODY)+…`: JS keeps only the last iteration's groups, .NET's Captures has all of them (SmartFormat conditions)
    const r = /^\^?\(\?:/.exec(p);
    if (r) {
      let depth = 0, end = -1;
      for (let i = r[0].length - 3, cls = false; i < p.length; i++) {
        const c = p[i];
        if (c === '\\') { i++; continue; }
        if (cls) { if (c === ']') cls = false; continue; }
        if (c === '[') cls = true;
        else if (c === '(') depth++;
        else if (c === ')' && --depth === 0) { end = i; break; }
      }
      if (end > 0 && /[+*]/.test(p[end + 1] ?? '')) {
        const body = p.slice(r[0].length, end);
        try { this.rep = { body: new RegExp(body, flags.replace('g', 'y')), n: countGroups(body) }; } catch { /* no captures emulation */ }
      }
    }
  }
  private rep: { body: RegExp; n: number } | null = null;
  /** Per-group capture lists for groups 1..n of a repeated leading body. */
  $captures(input: string, m: RegExpExecArray, off: number): (Group[] | undefined)[] | null {
    if (!this.rep) return null;
    const out: Group[][] = Array.from({ length: this.rep.n + 1 }, () => []);
    const b = this.rep.body, end = m.index + m[0].length;
    for (let pos = m.index; pos < end;) {
      b.lastIndex = pos;
      const x = b.exec(input);
      if (!x || !x[0].length || x.index + x[0].length > end) break;
      for (let g = 1; g <= this.rep.n; g++) if (x[g] !== undefined) out[g].push(new Group(x[g], true, ((x as any).indices?.[g]?.[0] ?? x.index) + off));
      pos = x.index + x[0].length;
    }
    return out.map((l, i) => (i === 0 || !l.length ? undefined : l));
  }
  // .NET's \G ("where this scan started") has no JS equivalent: bake the start offset into a fixed-length lookbehind per scan.
  private src = ''; private flags = ''; private hasG = false;
  private reAt(from: number): RegExp {
    if (!this.hasG) return this.re;
    const p = this.src.replace(/\\G/g, `(?<=^[\\s\\S]{${from}})`);
    try { return new RegExp(p, this.flags); } catch { return new RegExp(p, this.flags.replace('u', '')); }
  }
  private *scan(s: string) {
    for (let from = 0; from <= s.length;) {
      const re = this.reAt(from); re.lastIndex = from;
      const m = re.exec(s); if (!m) return;
      yield m;
      from = m.index + (m[0].length || 1);
    }
  }
  static $cache = new Map<string, Regex>();
  static get(p: string, o = 0) { const k = o + p; let r = Regex.$cache.get(k); if (!r) Regex.$cache.set(k, (r = new Regex(p, o))); return r; }
  $next(input: string, from: number, off = 0) { const re = this.reAt(from); re.lastIndex = from; return new Match(from > input.length ? null : re.exec(input), this, input, off); }
  IsMatch(s: string) { this.re.lastIndex = 0; return this.re.test(s); }
  /** Match(s, startat) keeps `^` at 0; Match(s, beginning, length) searches s.Substring(beginning, length) with `^` at beginning. */
  Match(s: string, start = 0, length?: number) { return length === undefined ? this.$next(s, start) : this.$next(s.substr(start, length), 0, start); }
  Matches(s: string) { if (this.hasG) return Array.from(this.scan(s), (m) => new Match(m, this, s)); this.re.lastIndex = 0; return Array.from(s.matchAll(this.re), (m) => new Match(m as RegExpExecArray, this, s)); }
  Replace(s: string, rep: any) {
    if (this.hasG) {
      let out = '', last = 0;
      for (const m of this.scan(s)) {
        const r = typeof rep === 'function' ? str(rep(new Match(m, this, s))) : String(rep).replace(/\$\$|\$(\d+)|\$\{(\w+)\}/g, (t, d, n) => (t === '$$' ? '$' : d ? m[+d] ?? '' : m.groups?.[n] ?? ''));
        out += s.slice(last, m.index) + r; last = m.index + m[0].length;
      }
      return out + s.slice(last);
    }
    this.re.lastIndex = 0; return typeof rep === 'function' ? s.replace(this.re, (...a: any[]) => { const m = a[a.length - 1] && typeof a[a.length - 1] === 'object' ? a : null; void m; const exec = [...a.slice(0, -2)] as any; exec.index = a[a.length - 2]; return str(rep(new Match(exec, this, s))); }) : s.replace(this.re, String(rep).replace(/\$\{(\w+)\}/g, '$<$1>')); }
  Split(s: string) { return s.split(this.re); }
  static IsMatch(s: string, p: string, o = 0) { return Regex.get(p, o).IsMatch(s); }
  static Match(s: string, p: string, o = 0) { return Regex.get(p, o).Match(s); }
  static Matches(s: string, p: string, o = 0) { return Regex.get(p, o).Matches(s); }
  static Replace(s: string, p: string, r: any, o = 0) { return Regex.get(p, o).Replace(s, r); }
  static Split(s: string, p: string, o = 0) { return Regex.get(p, o).Split(s); }
  static Escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
}
provide('System.Text.RegularExpressions.Regex', Regex);
provide('System.Attribute', class Attribute { static $name = 'Attribute'; static $fullName = 'System.Attribute'; });
provide('System.EventArgs', class EventArgs { static Empty = new EventArgs(); });
// neutral cultures for the game's 14 languages (LocManager maps three-letter codes through this list)
const cultures = [['en', 'eng'], ['de', 'deu'], ['fr', 'fra'], ['it', 'ita'], ['ja', 'jpn'], ['ko', 'kor'], ['pl', 'pol'], ['ru', 'rus'], ['th', 'tha'], ['tr', 'tur'], ['es', 'spa'], ['pt', 'por'], ['zh', 'zho'], ['nl', 'nld'], ['el', 'ell']];
class CultureInfoImpl {
  constructor(public Name: string, public ThreeLetterISOLanguageName = cultures.find((c) => c[0] === Name.split('-')[0])?.[1] ?? 'eng') {}
  get TwoLetterISOLanguageName() { return this.Name.split('-')[0] || 'en'; }
  get IetfLanguageTag() { return this.Name; }
  get DisplayName() { return this.Name; }
  get NativeName() { return this.Name; }
  get EnglishName() { return this.Name; }
  get NumberFormat() { return { NumberDecimalSeparator: '.', NumberGroupSeparator: ',' }; }
  get CompareInfo() { return { Compare: (a: string, b: string, opt = 0) => (a ?? '').localeCompare(b ?? '', this.Name || undefined, { sensitivity: opt & 1 ? 'accent' : 'variant' }) }; }
  get TextInfo() { return { ToTitleCase: (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()), ToLower: (s: string) => s.toLowerCase(), ToUpper: (s: string) => s.toUpperCase() }; }
  get Parent() { return new CultureInfoImpl(this.TwoLetterISOLanguageName); }
  ToString() { return this.Name; }
  GetFormat() { return null; }
  Equals(o: any) { return o?.Name === this.Name; }
  static InvariantCulture = new CultureInfoImpl('', 'ivl');
  static CurrentCulture = new CultureInfoImpl('en-US');
  static CurrentUICulture = new CultureInfoImpl('en-US');
  static GetCultureInfo(n: string) { return new CultureInfoImpl(n); }
  static GetCultures() { return cultures.map(([n, t]) => new CultureInfoImpl(n, t)); }
}
provide('System.Globalization.CultureInfo', CultureInfoImpl);

// ------------------------------------------------------------------ hashing / binary helpers (net checksums)
const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
const rotl = (x: number, r: number) => ((x << r) | (x >>> (32 - r))) >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
export class XxHash32 {
  private v = [0, 0, 0, 0];
  private buf: number[] = [];
  private total = 0;
  constructor(private seed = 0) { this.Reset(); }
  Reset() { const s = this.seed >>> 0; this.v = [(s + P1 + P2) >>> 0, (s + P2) >>> 0, s, (s - P1) >>> 0]; this.buf = []; this.total = 0; }
  private round(acc: number, lane: number) { return mul(rotl((acc + mul(lane, P2)) >>> 0, 13), P1); }
  Append(bytes: number[]) {
    this.total += bytes.length;
    for (const b of bytes) {
      this.buf.push(b & 255);
      if (this.buf.length === 16) {
        for (let i = 0; i < 4; i++) { const o = i * 4; const lane = (this.buf[o] | (this.buf[o + 1] << 8) | (this.buf[o + 2] << 16) | (this.buf[o + 3] << 24)) >>> 0; this.v[i] = this.round(this.v[i], lane); }
        this.buf = [];
      }
    }
  }
  GetCurrentHashAsUInt32() {
    let acc = this.total >= 16 ? (rotl(this.v[0], 1) + rotl(this.v[1], 7) + rotl(this.v[2], 12) + rotl(this.v[3], 18)) >>> 0 : (this.seed + P5) >>> 0;
    acc = (acc + this.total) >>> 0;
    let i = 0;
    for (; i + 4 <= this.buf.length; i += 4) { const w = (this.buf[i] | (this.buf[i + 1] << 8) | (this.buf[i + 2] << 16) | (this.buf[i + 3] << 24)) >>> 0; acc = mul(rotl((acc + mul(w, P3)) >>> 0, 17), P4); }
    for (; i < this.buf.length; i++) acc = mul(rotl((acc + mul(this.buf[i], P5)) >>> 0, 11), P1);
    acc ^= acc >>> 15; acc = mul(acc, P2); acc ^= acc >>> 13; acc = mul(acc, P3); acc ^= acc >>> 16;
    return acc >>> 0;
  }
  GetCurrentHash() { const h = this.GetCurrentHashAsUInt32(); return [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255]; }
  static HashToUInt32(bytes: number[], seed = 0) { const x = new XxHash32(seed); x.Append(Array.from(bytes)); return x.GetCurrentHashAsUInt32(); }
  static Hash(bytes: number[]) { const x = new XxHash32(); x.Append(Array.from(bytes)); return x.GetCurrentHash(); }
}
provide('System.IO.Hashing.XxHash32', XxHash32);
const utf8 = new TextEncoder();
provide('System.Text.Encoding', {
  UTF8: {
    GetBytes: (s: any, a?: any, b?: any, arr?: any, off?: any) => {
      if (typeof s === 'string' && arr !== undefined) { const bytes = utf8.encode(s.substr(a, b)); for (let i = 0; i < bytes.length; i++) arr[off + i] = bytes[i]; return bytes.length; }
      return Array.from(utf8.encode(typeof s === 'string' ? s : charsToStr(s)));
    },
    GetString: (bytes: number[], a = 0, n = bytes.length - a) => new TextDecoder().decode(new Uint8Array(bytes.slice(a, a + n))),
    GetByteCount: (s: string) => utf8.encode(s).length,
  },
  ASCII: { GetBytes: (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 127), GetString: (b: number[]) => charsToStr(b) },
  Unicode: { GetBytes: (s: string) => Array.from(s).flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]) },
});
const le = (arr: number[], v: number, n: number, off = 0) => { for (let i = 0; i < n; i++) arr[off + i] = Math.floor(v / 2 ** (8 * i)) & 255; };
const rle = (arr: number[], n: number, signed: boolean) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + (arr[i] & 255); if (signed && v >= 2 ** (8 * n - 1)) v -= 2 ** (8 * n); return v; };
provide('System.Buffers.Binary.BinaryPrimitives', {
  WriteInt32LittleEndian: (a: number[], v: number) => le(a, v >>> 0, 4), WriteUInt32LittleEndian: (a: number[], v: number) => le(a, v >>> 0, 4),
  WriteInt16LittleEndian: (a: number[], v: number) => le(a, v & 0xffff, 2), WriteUInt16LittleEndian: (a: number[], v: number) => le(a, v & 0xffff, 2),
  WriteInt64LittleEndian: (a: number[], v: number) => le(a, v, 8), WriteUInt64LittleEndian: (a: number[], v: number) => le(a, v, 8),
  ReadInt32LittleEndian: (a: number[]) => rle(a, 4, true), ReadUInt32LittleEndian: (a: number[]) => rle(a, 4, false),
  ReadInt16LittleEndian: (a: number[]) => rle(a, 2, true), ReadUInt16LittleEndian: (a: number[]) => rle(a, 2, false),
  ReadInt64LittleEndian: (a: number[]) => rle(a, 8, true), ReadUInt64LittleEndian: (a: number[]) => rle(a, 8, false),
  WriteSingleLittleEndian: (a: number[], v: number) => { const b = new Uint8Array(new Float32Array([v]).buffer); b.forEach((x, i) => (a[i] = x)); },
  ReadSingleLittleEndian: (a: number[]) => new Float32Array(new Uint8Array(a.slice(0, 4)).buffer)[0],
});
Object.defineProperty(Array.prototype, 'AsSpan', { value(this: any[], a?: number, b?: number) { return a === undefined ? this : this.slice(a, b === undefined ? undefined : a + b); }, configurable: true, writable: true, enumerable: false });
provide('System.Collections.Concurrent.ConcurrentStack`1', Stack);
provide('System.Collections.Concurrent.ConcurrentBag`1', Array);
provide('System.Collections.Concurrent.BlockingCollection`1', Queue);
provide('System.Threading.ThreadLocal`1', class ThreadLocal { Value: any; constructor(f?: () => any) { this.Value = f?.(); } Dispose() {} });
