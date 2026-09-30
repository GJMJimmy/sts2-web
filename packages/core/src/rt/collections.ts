// System.Collections.Generic on top of JS. List<T> and arrays are plain JS arrays with C# methods patched in.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { compare, comparer, equals, ext, iter, keyOf, Enumerator, provide } from './core';

function err(key: string, msg: string): never {
  throw new (ext(key))(msg);
}

// ------------------------------------------------------------------ Dictionary / HashSet
/**
 * .NET Dictionary/HashSet enumeration order: entries live in an array and removals push their slot onto a LIFO free
 * list that the next add reuses, so after a removal a new key enumerates where the removed one was (a JS Map would
 * append it). Seeded picks from enumerated keys depend on this.
 */
class Slots<E> {
  map = new Map<any, { e: E; i: number }>();
  slots: (E | undefined)[] = [];
  free: number[] = [];
  get size() { return this.map.size; }
  get(n: any) { return this.map.get(n)?.e; }
  has(n: any) { return this.map.has(n); }
  add(n: any, e: E) {
    const i = this.free.length ? this.free.pop()! : this.slots.length;
    this.slots[i] = e;
    this.map.set(n, { e, i });
  }
  delete(n: any) {
    const x = this.map.get(n);
    if (!x) return false;
    this.map.delete(n);
    this.slots[x.i] = undefined;
    this.free.push(x.i);
    return true;
  }
  clear() { this.map.clear(); this.slots = []; this.free = []; }
  /** Snapshot in slot order (enumerating while mutating stays safe). */
  values(): E[] { return this.slots.filter((e): e is E => e !== undefined); }
  /** TrimExcess: compacts the entry array in order. */
  compact() { const all = Array.from(this.map).sort((a, b) => a[1].i - b[1].i); this.clear(); for (const [n, x] of all) this.add(n, x.e); }
}

export class Dictionary<K = any, V = any> implements Iterable<[K, V]> {
  m = new Slots<[K, V]>();
  constructor(src?: any, _comparer?: any) {
    if (src != null && typeof src === 'object' && (typeof src[Symbol.iterator] === 'function' || typeof src.GetEnumerator === 'function'))
      for (const kv of iter(src)) this.Add(kv[0], kv[1]);
  }
  get Count() { return this.m.size; }
  get Keys(): K[] { return this.m.values().map((e) => e[0]); }
  get Values(): V[] { return this.m.values().map((e) => e[1]); }
  Add(k: K, v: V) {
    if (k == null) err('System.ArgumentNullException', 'Value cannot be null. (Parameter \'key\')');
    const n = keyOf(k);
    if (this.m.has(n)) err('System.ArgumentException', `An item with the same key has already been added. Key: ${String(k)}`);
    this.m.add(n, [k, v]);
  }
  TryAdd(k: K, v: V) {
    const n = keyOf(k);
    if (this.m.has(n)) return false;
    this.m.add(n, [k, v]);
    return true;
  }
  get_Item(k: K): V {
    const e = this.m.get(keyOf(k));
    if (!e) err('System.Collections.Generic.KeyNotFoundException', `The given key '${String(k)}' was not present in the dictionary.`);
    return e![1];
  }
  set_Item(k: K, v: V) {
    if (k == null) err('System.ArgumentNullException', 'key');
    const n = keyOf(k);
    const e = this.m.get(n);
    if (e) e[1] = v;
    else this.m.add(n, [k, v]);
    return v;
  }
  ContainsKey(k: K) { return k != null && this.m.has(keyOf(k)); }
  ContainsValue(v: V) { for (const e of this.m.values()) if (equals(e[1], v)) return true; return false; }
  TryGetValue(k: K, out: { v: any }) {
    const e = k == null ? undefined : this.m.get(keyOf(k));
    out.v = e ? e[1] : undefined;
    return !!e;
  }
  Remove(k: K, out?: { v: any }) {
    const n = keyOf(k);
    const e = this.m.get(n);
    if (out) out.v = e?.[1];
    return this.m.delete(n);
  }
  TryRemove(k: K, out?: { v: any }) { return this.Remove(k, out); }
  GetOrAdd(k: K, f: any) {
    const n = keyOf(k);
    const e = this.m.get(n);
    if (e) return e[1];
    const v = typeof f === 'function' ? f(k) : f;
    this.m.add(n, [k, v]);
    return v;
  }
  AddOrUpdate(k: K, add: any, upd: (k: K, v: V) => V) {
    const n = keyOf(k);
    const e = this.m.get(n);
    const v = e ? upd(k, e[1]) : typeof add === 'function' ? add(k) : add;
    if (e) e[1] = v;
    else this.m.add(n, [k, v]);
    return v;
  }
  GetValueOrDefault(k: K, d?: V) { const e = this.m.get(keyOf(k)); return e ? e[1] : d; }
  Clear() { this.m.clear(); }
  EnsureCapacity() { return 0; }
  TrimExcess() { this.m.compact(); }
  *[Symbol.iterator](): Iterator<[K, V]> {
    for (const e of this.m.values()) yield [e[0], e[1]];
  }
  GetEnumerator() { return new Enumerator(this); }
}

export class HashSet<T = any> implements Iterable<T> {
  m = new Slots<T>();
  constructor(src?: any, _comparer?: any) {
    if (src != null && typeof src === 'object' && (typeof src[Symbol.iterator] === 'function' || typeof src.GetEnumerator === 'function')) for (const x of iter(src)) this.Add(x);
  }
  get Count() { return this.m.size; }
  Add(x: T) {
    const n = keyOf(x);
    if (this.m.has(n)) return false;
    this.m.add(n, x);
    return true;
  }
  Contains(x: T) { return this.m.has(keyOf(x)); }
  Remove(x: T) { return this.m.delete(keyOf(x)); }
  RemoveWhere(p: (x: T) => boolean) { let n = 0; for (const v of this.m.values()) if (p(v)) { this.m.delete(keyOf(v)); n++; } return n; }
  Clear() { this.m.clear(); }
  UnionWith(o: any) { for (const x of iter(o)) this.Add(x); }
  ExceptWith(o: any) { for (const x of iter(o)) this.Remove(x); }
  IntersectWith(o: any) { const keep = new HashSet(o); for (const v of this.m.values()) if (!keep.Contains(v)) this.m.delete(keyOf(v)); }
  SymmetricExceptWith(o: any) { for (const x of new HashSet(o)) if (!this.Remove(x)) this.Add(x); }
  IsSubsetOf(o: any) { const s = new HashSet(o); for (const x of this) if (!s.Contains(x)) return false; return true; }
  IsSupersetOf(o: any) { for (const x of iter(o)) if (!this.Contains(x)) return false; return true; }
  Overlaps(o: any) { for (const x of iter(o)) if (this.Contains(x)) return true; return false; }
  SetEquals(o: any) { const s = new HashSet(o); return s.Count === this.Count && this.IsSubsetOf(s); }
  TryGetValue(x: T, out: { v: any }) { const n = keyOf(x); out.v = this.m.get(n); return this.m.has(n); }
  CopyTo(arr: T[], idx = 0) { for (const x of this) arr[idx++] = x; }
  TrimExcess() { this.m.compact(); }
  *[Symbol.iterator](): Iterator<T> { yield* this.m.values(); }
  GetEnumerator() { return new Enumerator(this); }
}

export class Queue<T = any> implements Iterable<T> {
  a: T[] = [];
  constructor(src?: any) { if (src != null && typeof src === 'object') this.a = Array.from(iter(src)); }
  get Count() { return this.a.length; }
  Enqueue(x: T) { this.a.push(x); }
  Dequeue(): T { if (!this.a.length) err('System.InvalidOperationException', 'Queue empty.'); return this.a.shift()!; }
  TryDequeue(out: { v: any }) { if (!this.a.length) { out.v = undefined; return false; } out.v = this.a.shift(); return true; }
  Peek(): T { if (!this.a.length) err('System.InvalidOperationException', 'Queue empty.'); return this.a[0]; }
  TryPeek(out: { v: any }) { out.v = this.a[0]; return this.a.length > 0; }
  Contains(x: T) { return this.a.some((y) => equals(y, x)); }
  Clear() { this.a.length = 0; }
  ToArray() { return this.a.slice(); }
  [Symbol.iterator]() { return this.a.slice()[Symbol.iterator](); }
  GetEnumerator() { return new Enumerator(this); }
}

export class Stack<T = any> implements Iterable<T> {
  a: T[] = [];
  constructor(src?: any) { if (src != null && typeof src === 'object') for (const x of iter(src)) this.a.push(x); }
  get Count() { return this.a.length; }
  Push(x: T) { this.a.push(x); }
  Pop(): T { if (!this.a.length) err('System.InvalidOperationException', 'Stack empty.'); return this.a.pop()!; }
  TryPop(out: { v: any }) { if (!this.a.length) { out.v = undefined; return false; } out.v = this.a.pop(); return true; }
  Peek(): T { if (!this.a.length) err('System.InvalidOperationException', 'Stack empty.'); return this.a[this.a.length - 1]; }
  TryPeek(out: { v: any }) { out.v = this.a[this.a.length - 1]; return this.a.length > 0; }
  Contains(x: T) { return this.a.some((y) => equals(y, x)); }
  Clear() { this.a.length = 0; }
  ToArray() { return this.a.slice().reverse(); }
  [Symbol.iterator]() { return this.a.slice().reverse()[Symbol.iterator](); }
  GetEnumerator() { return new Enumerator(this); }
}

export class LinkedList<T = any> implements Iterable<T> {
  a: T[] = [];
  get Count() { return this.a.length; }
  get First() { return this.a.length ? { Value: this.a[0] } : null; }
  get Last() { return this.a.length ? { Value: this.a[this.a.length - 1] } : null; }
  AddLast(x: T) { this.a.push(x); }
  AddFirst(x: T) { this.a.unshift(x); }
  RemoveFirst() { this.a.shift(); }
  RemoveLast() { this.a.pop(); }
  Remove(x: T) { const i = this.a.findIndex((y) => equals(y, x)); if (i >= 0) this.a.splice(i, 1); return i >= 0; }
  Contains(x: T) { return this.a.some((y) => equals(y, x)); }
  Clear() { this.a.length = 0; }
  [Symbol.iterator]() { return this.a.slice()[Symbol.iterator](); }
}

// ------------------------------------------------------------------ Array/List<T> patches
function def(proto: any, name: string, value: any) {
  Object.defineProperty(proto, name, { value, configurable: true, writable: true, enumerable: false });
}
function getter(proto: any, name: string, get: () => any) {
  Object.defineProperty(proto, name, { get, configurable: true, enumerable: false });
}
const A = Array.prototype as any;
getter(A, 'Count', function (this: any[]) { return this.length; });
getter(A, 'Length', function (this: any[]) { return this.length; });
getter(A, 'Capacity', function (this: any[]) { return this.length; });
def(A, 'Add', function (this: any[], x: any) { this.push(x); });
def(A, 'AddRange', function (this: any[], xs: any) { for (const x of Array.from(iter(xs))) this.push(x); });
def(A, 'Insert', function (this: any[], i: number, x: any) { if (i < 0 || i > this.length) err('System.ArgumentOutOfRangeException', 'index'); this.splice(i, 0, x); });
def(A, 'InsertRange', function (this: any[], i: number, xs: any) { this.splice(i, 0, ...Array.from(iter(xs))); });
def(A, 'Remove', function (this: any[], x: any) { const i = this.findIndex((y) => equals(y, x)); if (i < 0) return false; this.splice(i, 1); return true; });
def(A, 'RemoveAt', function (this: any[], i: number) { if (i < 0 || i >= this.length) err('System.ArgumentOutOfRangeException', `Index was out of range. (index ${i}, count ${this.length})`); this.splice(i, 1); });
def(A, 'RemoveRange', function (this: any[], i: number, n: number) { this.splice(i, n); });
def(A, 'RemoveAll', function (this: any[], p: (x: any) => boolean) { let w = 0, n = 0; for (let r = 0; r < this.length; r++) { if (p(this[r])) n++; else this[w++] = this[r]; } this.length = w; return n; });
def(A, 'Clear', function (this: any[]) { this.length = 0; });
def(A, 'Contains', function (this: any[], x: any) { for (const y of this) if (equals(y, x)) return true; return false; });
def(A, 'IndexOf', function (this: any[], x: any, start = 0) { for (let i = start; i < this.length; i++) if (equals(this[i], x)) return i; return -1; });
def(A, 'LastIndexOf', function (this: any[], x: any) { for (let i = this.length - 1; i >= 0; i--) if (equals(this[i], x)) return i; return -1; });
def(A, 'Find', function (this: any[], p: (x: any) => boolean) { for (const x of this) if (p(x)) return x; return null; });
def(A, 'FindLast', function (this: any[], p: (x: any) => boolean) { for (let i = this.length - 1; i >= 0; i--) if (p(this[i])) return this[i]; return null; });
def(A, 'FindIndex', function (this: any[], a: any, b?: any) { const [start, p] = typeof a === 'function' ? [0, a] : [a, b]; for (let i = start; i < this.length; i++) if (p(this[i])) return i; return -1; });
def(A, 'FindLastIndex', function (this: any[], p: (x: any) => boolean) { for (let i = this.length - 1; i >= 0; i--) if (p(this[i])) return i; return -1; });
def(A, 'FindAll', function (this: any[], p: (x: any) => boolean) { return this.filter((x) => p(x)); });
def(A, 'Exists', function (this: any[], p: (x: any) => boolean) { return this.some((x) => p(x)); });
def(A, 'TrueForAll', function (this: any[], p: (x: any) => boolean) { return this.every((x) => p(x)); });
def(A, 'ForEach', function (this: any[], f: (x: any) => void) { for (const x of this.slice()) f(x); });
def(A, 'ConvertAll', function (this: any[], f: (x: any) => any) { return this.map((x) => f(x)); });
def(A, 'GetRange', function (this: any[], i: number, n: number) { return this.slice(i, i + n); });
def(A, 'Slice', function (this: any[], i: number, n: number) { return this.slice(i, i + n); });
def(A, 'ToArray', function (this: any[]) { return this.slice(); });
def(A, 'AsReadOnly', function (this: any[]) { return this; });
def(A, 'AsSpan', function (this: any[]) { return this; });
def(A, 'Clone', function (this: any[]) { return this.slice(); });
def(A, 'CopyTo', function (this: any[], a: any, b?: any, c?: any, d?: any) {
  if (Array.isArray(a)) { const dst = a; const at = b ?? 0; for (let i = 0; i < this.length; i++) dst[at + i] = this[i]; }
  else { const src = a; const dst = b; for (let i = 0; i < d; i++) dst[c + i] = this[src + i]; }
});
def(A, 'Reverse', function (this: any[], i?: number, n?: number) {
  if (i === undefined) { this.reverse(); return; }
  const part = this.slice(i, i + n!).reverse();
  for (let k = 0; k < part.length; k++) this[i + k] = part[k];
});
def(A, 'Sort', function (this: any[], a?: any, b?: any, c?: any) {
  // List.Sort(), Sort(Comparison), Sort(IComparer), Sort(index, count, IComparer)
  if (typeof a === 'number') { const part = this.slice(a, a + b); part.sort(comparer(c)); for (let k = 0; k < part.length; k++) this[a + k] = part[k]; return; }
  introSort(this, comparer(a));
});
def(A, 'BinarySearch', function (this: any[], x: any, cmp?: any) {
  const c = comparer(cmp); let lo = 0, hi = this.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; const r = c(this[mid], x); if (r === 0) return mid; if (r < 0) lo = mid + 1; else hi = mid - 1; }
  return ~lo;
});
def(A, 'GetLength', function (this: any[], d: number) { return d === 0 ? this.length : (this[0]?.length ?? 0); });
def(A, 'GetEnumerator', function (this: any[]) { return new Enumerator(this); });
def(A, 'get_Item', function (this: any[], i: number) { if (i < 0 || i >= this.length) err('System.ArgumentOutOfRangeException', `Index ${i} out of range`); return this[i]; });
def(A, 'set_Item', function (this: any[], i: number, v: any) { this[i] = v; return v; });
def(A, 'EnsureCapacity', function () { return 0; });
def(A, 'TrimExcess', function () {});

/**
 * .NET List<T>.Sort is an unstable introspective sort. Porting it keeps equal-key ordering identical to the game.
 * (ArraySortHelper<T>.IntrospectiveSort, .NET 5+)
 */
export function introSort(keys: any[], cmp: (a: any, b: any) => number) {
  const n = keys.length;
  if (n < 2) return;
  const swapIfGreater = (i: number, j: number) => {
    if (i !== j && cmp(keys[i], keys[j]) > 0) { const t = keys[i]; keys[i] = keys[j]; keys[j] = t; }
  };
  const swap = (i: number, j: number) => { const t = keys[i]; keys[i] = keys[j]; keys[j] = t; };
  const insertionSort = (lo: number, hi: number) => {
    for (let i = lo; i < hi; i++) {
      let j = i;
      const t = keys[i + 1];
      while (j >= lo && cmp(t, keys[j]) < 0) { keys[j + 1] = keys[j]; j--; }
      keys[j + 1] = t;
    }
  };
  const downHeap = (i: number, n2: number, lo: number) => {
    const d = keys[lo + i - 1];
    while (i <= n2 >> 1) {
      let child = 2 * i;
      if (child < n2 && cmp(keys[lo + child - 1], keys[lo + child]) < 0) child++;
      if (!(cmp(d, keys[lo + child - 1]) < 0)) break;
      keys[lo + i - 1] = keys[lo + child - 1];
      i = child;
    }
    keys[lo + i - 1] = d;
  };
  const heapSort = (lo: number, hi: number) => {
    const n2 = hi - lo + 1;
    for (let i = n2 >> 1; i >= 1; i--) downHeap(i, n2, lo);
    for (let i = n2; i > 1; i--) { swap(lo, lo + i - 1); downHeap(1, i - 1, lo); }
  };
  const pickPivotAndPartition = (lo: number, hi: number) => {
    const mid = lo + ((hi - lo) >> 1);
    swapIfGreater(lo, mid);
    swapIfGreater(lo, hi);
    swapIfGreater(mid, hi);
    const pivot = keys[mid];
    swap(mid, hi - 1);
    let left = lo, right = hi - 1;
    while (left < right) {
      while (cmp(keys[++left], pivot) < 0);
      while (cmp(pivot, keys[--right]) < 0);
      if (left >= right) break;
      swap(left, right);
    }
    if (left !== hi - 1) swap(left, hi - 1);
    return left;
  };
  const introSortRec = (lo: number, hi: number, depth: number) => {
    while (hi > lo) {
      const size = hi - lo + 1;
      if (size <= 16) {
        if (size === 1) return;
        if (size === 2) { swapIfGreater(lo, hi); return; }
        if (size === 3) { swapIfGreater(lo, hi - 1); swapIfGreater(lo, hi); swapIfGreater(hi - 1, hi); return; }
        insertionSort(lo, hi);
        return;
      }
      if (depth === 0) { heapSort(lo, hi); return; }
      depth--;
      const p = pickPivotAndPartition(lo, hi);
      introSortRec(p + 1, hi, depth);
      hi = p - 1;
    }
  };
  introSortRec(0, n - 1, 2 * (Math.floor(Math.log2(n)) + 1));
}

export function sortStable(a: any[], cmp?: any) {
  return a.sort(comparer(cmp) ?? compare);
}
// KeyValuePair<K,V> values are emitted as [key, value] pairs.
provide('System.Collections.Generic.KeyValuePair`2', { $name: 'KeyValuePair', $prim: undefined, $is: (v: any) => Array.isArray(v) && v.length === 2, Create: (k: any, v: any) => [k, v] });
// KeyValuePair / ValueTuple are arrays; C# `kv.Deconstruct(out k, out v)`
def(A, 'Deconstruct', function (this: any[], ...outs: { v: any }[]) { outs.forEach((o, i) => (o.v = this[i])); });
