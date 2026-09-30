// System.Linq.Enumerable — lazy like .NET (deferred execution), over any JS iterable.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { compare, comparer, equals, ext, iter, keyOf, isT, Enumerator } from './core';
import { Dictionary, HashSet } from './collections';

type It = Iterable<any>;
const lazy = (f: () => Iterator<any>): It => ({ [Symbol.iterator]: f });
function* g<T>(it: It): Generator<T> { yield* iter(it) as any; }
const noElems = () => { throw new (ext('System.InvalidOperationException'))('Sequence contains no elements'); };
const noMatch = () => { throw new (ext('System.InvalidOperationException'))('Sequence contains no matching element'); };
const tooMany = () => { throw new (ext('System.InvalidOperationException'))('Sequence contains more than one element'); };

class Grouping<K, V> extends Array<V> {
  constructor(public Key: K) { super(); }
  static get [Symbol.species]() { return Array; }
}

class Ordered implements It {
  constructor(public src: It, public keys: { f: (x: any) => any; desc: boolean; cmp: (a: any, b: any) => number }[]) {}
  [Symbol.iterator]() {
    const arr = Array.from(iter(this.src));
    const ks = this.keys;
    const keyed = arr.map((v, i) => ({ v, i, k: ks.map((k) => k.f(v)) }));
    keyed.sort((a, b) => {
      for (let j = 0; j < ks.length; j++) {
        const c = ks[j].cmp(a.k[j], b.k[j]);
        if (c) return ks[j].desc ? -c : c;
      }
      return a.i - b.i;
    });
    return keyed.map((x) => x.v)[Symbol.iterator]();
  }
}

export const Enumerable = {
  Where: (s: It, p: (x: any, i: number) => boolean) => lazy(function* () { let i = 0; for (const x of iter(s)) if (p(x, i++)) yield x; }),
  Select: (s: It, f: (x: any, i: number) => any) => lazy(function* () { let i = 0; for (const x of iter(s)) yield f(x, i++); }),
  SelectMany: (s: It, f: (x: any, i: number) => It, r?: (x: any, y: any) => any) => lazy(function* () { let i = 0; for (const x of iter(s)) for (const y of iter(f(x, i++))) yield r ? r(x, y) : y; }),
  OfType: (t: any, s: It) => lazy(function* () { for (const x of iter(s)) if (isT(x, t)) yield x; }),
  Cast: (_t: any, s: It) => s,
  Concat: (a: It, b: It) => lazy(function* () { yield* iter(a); yield* iter(b); }),
  Append: (s: It, x: any) => lazy(function* () { yield* iter(s); yield x; }),
  Prepend: (s: It, x: any) => lazy(function* () { yield x; yield* iter(s); }),
  Take: (s: It, n: number) => lazy(function* () { if (n <= 0) return; let i = 0; for (const x of iter(s)) { yield x; if (++i >= n) return; } }),
  TakeLast: (s: It, n: number) => lazy(() => Array.from(iter(s)).slice(Math.max(0, Array.from(iter(s)).length - n))[Symbol.iterator]()),
  TakeWhile: (s: It, p: (x: any, i: number) => boolean) => lazy(function* () { let i = 0; for (const x of iter(s)) { if (!p(x, i++)) return; yield x; } }),
  Skip: (s: It, n: number) => lazy(function* () { let i = 0; for (const x of iter(s)) if (i++ >= n) yield x; }),
  SkipLast: (s: It, n: number) => lazy(() => { const a = Array.from(iter(s)); return a.slice(0, Math.max(0, a.length - n))[Symbol.iterator](); }),
  SkipWhile: (s: It, p: (x: any, i: number) => boolean) => lazy(function* () { let i = 0, skipping = true; for (const x of iter(s)) { if (skipping && p(x, i++)) continue; skipping = false; yield x; } }),
  Reverse: (s: It) => lazy(() => Array.from(iter(s)).reverse()[Symbol.iterator]()),
  Distinct: (s: It) => lazy(function* () { const seen = new HashSet(); for (const x of iter(s)) if (seen.Add(x)) yield x; }),
  DistinctBy: (s: It, f: (x: any) => any) => lazy(function* () { const seen = new HashSet(); for (const x of iter(s)) if (seen.Add(f(x))) yield x; }),
  Except: (a: It, b: It) => lazy(function* () { const ex = new HashSet(b); for (const x of iter(a)) if (ex.Add(x)) yield x; }),
  Intersect: (a: It, b: It) => lazy(function* () { const inb = new HashSet(b); for (const x of iter(a)) if (inb.Remove(x)) yield x; }),
  Union: (a: It, b: It) => lazy(function* () { const seen = new HashSet(); for (const x of iter(a)) if (seen.Add(x)) yield x; for (const x of iter(b)) if (seen.Add(x)) yield x; }),
  Zip: (a: It, b: It, f?: (x: any, y: any) => any) => lazy(function* () { const ib = iter(b)[Symbol.iterator](); for (const x of iter(a)) { const r = ib.next(); if (r.done) return; yield f ? f(x, r.value) : [x, r.value]; } }),
  OrderBy: (s: It, f: (x: any) => any, c?: any) => new Ordered(s, [{ f, desc: false, cmp: comparer(c) }]),
  OrderByDescending: (s: It, f: (x: any) => any, c?: any) => new Ordered(s, [{ f, desc: true, cmp: comparer(c) }]),
  ThenBy: (s: Ordered, f: (x: any) => any, c?: any) => new Ordered(s.src, [...s.keys, { f, desc: false, cmp: comparer(c) }]),
  ThenByDescending: (s: Ordered, f: (x: any) => any, c?: any) => new Ordered(s.src, [...s.keys, { f, desc: true, cmp: comparer(c) }]),
  Order: (s: It, c?: any) => new Ordered(s, [{ f: (x) => x, desc: false, cmp: comparer(c) }]),
  OrderDescending: (s: It, c?: any) => new Ordered(s, [{ f: (x) => x, desc: true, cmp: comparer(c) }]),
  GroupBy: (s: It, kf: (x: any) => any, ef?: (x: any) => any, rf?: (k: any, g: any) => any) => lazy(() => {
    const m = new Map<any, Grouping<any, any>>();
    for (const x of iter(s)) { const k = kf(x); const n = keyOf(k); let gr = m.get(n); if (!gr) m.set(n, (gr = new Grouping(k))); gr.push(ef && ef.length === 1 ? ef(x) : x); }
    const out = Array.from(m.values());
    return (rf ? out.map((gr) => rf(gr.Key, gr)) : out)[Symbol.iterator]();
  }),
  ToList: (s: It) => Array.from(iter(s)),
  ToArray: (s: It) => Array.from(iter(s)),
  ToHashSet: (s: It) => new HashSet(s),
  ToDictionary: (s: It, kf: (x: any) => any, vf?: (x: any) => any) => { const d = new Dictionary(); for (const x of iter(s)) d.Add(kf(x), vf ? vf(x) : x); return d; },
  ToLookup: (s: It, kf: (x: any) => any, vf?: (x: any) => any) => { const d = new Dictionary(); for (const x of iter(s)) { const k = kf(x); let a = d.GetValueOrDefault(k); if (!a) d.Add(k, (a = new Grouping(k))); a.push(vf ? vf(x) : x); } return d; },
  AsEnumerable: (s: It) => s,
  Any: (s: It, p?: (x: any) => boolean) => { for (const x of iter(s)) if (!p || p(x)) return true; return false; },
  All: (s: It, p: (x: any) => boolean) => { for (const x of iter(s)) if (!p(x)) return false; return true; },
  Contains: (s: It, v: any) => { if (Array.isArray(s)) return (s as any).Contains(v); for (const x of iter(s)) if (equals(x, v)) return true; return false; },
  Count: (s: It, p?: (x: any) => boolean) => { if (!p && Array.isArray(s)) return s.length; let n = 0; for (const x of iter(s)) if (!p || p(x)) n++; return n; },
  LongCount: (s: It, p?: (x: any) => boolean) => Enumerable.Count(s, p),
  First: (s: It, p?: (x: any) => boolean) => { for (const x of iter(s)) if (!p || p(x)) return x; return p ? noMatch() : noElems(); },
  FirstOrDefault: (s: It, p?: any, d: any = null) => { if (p != null && typeof p !== 'function') { d = p; p = undefined; } for (const x of iter(s)) if (!p || p(x)) return x; return d; },
  Last: (s: It, p?: (x: any) => boolean) => { let found = false, r: any; for (const x of iter(s)) if (!p || p(x)) { found = true; r = x; } return found ? r : p ? noMatch() : noElems(); },
  LastOrDefault: (s: It, p?: any, d: any = null) => { if (p != null && typeof p !== 'function') { d = p; p = undefined; } let r = d; for (const x of iter(s)) if (!p || p(x)) r = x; return r; },
  Single: (s: It, p?: (x: any) => boolean) => { let n = 0, r: any; for (const x of iter(s)) if (!p || p(x)) { if (++n > 1) tooMany(); r = x; } return n ? r : p ? noMatch() : noElems(); },
  SingleOrDefault: (s: It, p?: (x: any) => boolean) => { let n = 0, r: any = null; for (const x of iter(s)) if (!p || p(x)) { if (++n > 1) tooMany(); r = x; } return r; },
  ElementAt: (s: It, i: number) => { if (Array.isArray(s)) { if (i < 0 || i >= s.length) throw new (ext('System.ArgumentOutOfRangeException'))('index'); return s[i]; } let k = 0; for (const x of iter(s)) if (k++ === i) return x; throw new (ext('System.ArgumentOutOfRangeException'))('index'); },
  ElementAtOrDefault: (s: It, i: number) => { let k = 0; for (const x of iter(s)) if (k++ === i) return x; return null; },
  DefaultIfEmpty: (s: It, d: any = null) => lazy(function* () { let any = false; for (const x of iter(s)) { any = true; yield x; } if (!any) yield d; }),
  Sum: (s: It, f?: (x: any) => number) => { let t = 0; for (const x of iter(s)) t += f ? f(x) ?? 0 : x ?? 0; return t; },
  Average: (s: It, f?: (x: any) => number) => { let t = 0, n = 0; for (const x of iter(s)) { t += f ? f(x) : x; n++; } if (!n) noElems(); return t / n; },
  Min: (s: It, f?: (x: any) => any) => { let r: any, any = false; for (const x of iter(s)) { const v = f ? f(x) : x; if (v == null) continue; if (!any || compare(v, r) < 0) r = v; any = true; } if (!any) { const probe = Array.from(iter(s)); if (probe.length === 0) noElems(); return null; } return r; },
  Max: (s: It, f?: (x: any) => any) => { let r: any, any = false; for (const x of iter(s)) { const v = f ? f(x) : x; if (v == null) continue; if (!any || compare(v, r) > 0) r = v; any = true; } if (!any) { const probe = Array.from(iter(s)); if (probe.length === 0) noElems(); return null; } return r; },
  MinBy: (s: It, f: (x: any) => any) => { let r: any = null, rk: any, any = false; for (const x of iter(s)) { const k = f(x); if (!any || compare(k, rk) < 0) { r = x; rk = k; any = true; } } return r; },
  MaxBy: (s: It, f: (x: any) => any) => { let r: any = null, rk: any, any = false; for (const x of iter(s)) { const k = f(x); if (!any || compare(k, rk) > 0) { r = x; rk = k; any = true; } } return r; },
  Aggregate: (s: It, a: any, b?: any, c?: any) => { if (typeof a === 'function') { let first = true, acc: any; for (const x of iter(s)) { if (first) { acc = x; first = false; } else acc = a(acc, x); } if (first) noElems(); return acc; } let acc = a; for (const x of iter(s)) acc = b(acc, x); return c ? c(acc) : acc; },
  SequenceEqual: (a: It, b: It) => { const x = Array.from(iter(a)), y = Array.from(iter(b)); return x.length === y.length && x.every((v, i) => equals(v, y[i])); },
  Range: (start: number, n: number) => lazy(function* () { for (let i = 0; i < n; i++) yield start + i; }),
  Repeat: (x: any, n: number) => lazy(function* () { for (let i = 0; i < n; i++) yield x; }),
  Empty: () => [],
  Chunk: (s: It, n: number) => lazy(function* () { let c: any[] = []; for (const x of iter(s)) { c.push(x); if (c.length === n) { yield c; c = []; } } if (c.length) yield c; }),
  TryGetNonEnumeratedCount: (s: any, out: { v: any }) => { if (Array.isArray(s)) { out.v = s.length; return true; } if (s?.Count !== undefined) { out.v = s.Count; return true; } out.v = 0; return false; },
};

// GetEnumerator on lazy sequences produced by LINQ / iterator methods
for (const C of [Ordered]) Object.defineProperty(C.prototype, 'GetEnumerator', { value(this: any) { return new Enumerator(this); } });
export { g as _g };
