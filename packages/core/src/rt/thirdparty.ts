// Shims for third-party libraries referenced by transpiled SmartFormat (ZString) and friends.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { provide, str, cs } from './core';

/** SmartFormat.ZString.ZStringBuilder: a pooled UTF-16 builder in .NET; a plain string accumulator here. */
class ZStringBuilder {
  s = '';
  constructor(_disposeImmediately?: boolean) {}
  get Length() { return this.s.length; }
  Grow() {}
  Append(x: any, a?: any, b?: any) {
    if (typeof x === 'number' && typeof a === 'number' && b === undefined && this.$char) this.s += cs(x).repeat(a);
    else if (typeof x === 'string' && typeof a === 'number' && typeof b === 'number') this.s += x.substr(a, b);
    else this.s += typeof x === 'string' ? x : str(x);
    return this;
  }
  $char = false;
  AppendLine(x?: any) { this.s += (x == null ? '' : str(x)) + '\n'; return this; }
  Insert(i: number, x: any) { this.s = this.s.slice(0, i) + str(x) + this.s.slice(i); return this; }
  Replace(a: any, b: any) { this.s = this.s.split(cs(a)).join(cs(b)); return this; }
  Remove(i: number, n: number) { this.s = this.s.slice(0, i) + this.s.slice(i + n); return this; }
  AsSpan() { return this.s; }
  AsMemory() { return this.s; }
  Clear() { this.s = ''; }
  Dispose() {}
  ToString() { return this.s; }
}
provide('SmartFormat.ZString.ZStringBuilder', ZStringBuilder);
provide('System.ReadOnlySpan`1', { Empty: '' });
provide('System.Span`1', { Empty: '' });
provide('System.MemoryExtensions', {
  AsSpan: (s: any, a?: number, b?: number) => (typeof s === 'string' ? (a === undefined ? s : b === undefined ? s.slice(a) : s.substr(a, b)) : a === undefined ? s : s.slice(a, b === undefined ? undefined : a + b)),
  Trim: (s: any) => (typeof s === 'string' ? s.trim() : s),
  TrimStart: (s: any) => (typeof s === 'string' ? s.trimStart() : s),
  TrimEnd: (s: any) => (typeof s === 'string' ? s.trimEnd() : s),
  SequenceEqual: (a: any, b: any) => (typeof a === 'string' ? a === b : a.length === b.length && a.every((x: any, i: number) => x === b[i])),
  Equals: (a: any, b: any, c?: number) => (c === 5 || c === 1 || c === 3 ? String(a).toLowerCase() === String(b).toLowerCase() : a === b),
  IndexOf: (s: any, v: any) => (typeof s === 'string' ? s.indexOf(cs(v)) : s.indexOf(v)),
  Contains: (s: any, v: any) => (typeof s === 'string' ? s.includes(cs(v)) : s.includes(v)),
  StartsWith: (s: any, v: any) => String(s).startsWith(cs(v)),
  EndsWith: (s: any, v: any) => String(s).endsWith(cs(v)),
  IsWhiteSpace: (s: any) => String(s).trim() === '',
  ToString: (s: any) => String(s),
});
// span-ish helpers on strings
for (const [k, f] of Object.entries({
  AsSpan(this: string, a?: number, b?: number) { return a === undefined ? this.valueOf() : b === undefined ? this.slice(a) : this.substr(a, b); },
  Slice(this: string, a: number, b?: number) { return b === undefined ? this.slice(a) : this.substr(a, b); },
  AsMemory(this: string) { return this.valueOf(); },
  get_Item(this: string, i: number) { return this.charCodeAt(i); },
  SequenceEqual(this: string, o: any) { return this.valueOf() === String(o); },
  IsEmpty: undefined,
})) if (f) Object.defineProperty(String.prototype, k, { value: f, configurable: true, writable: true, enumerable: false });
Object.defineProperty(String.prototype, 'IsEmpty', { get(this: string) { return this.length === 0; }, configurable: true });
Object.defineProperty(Array.prototype, 'IsEmpty', { get(this: any[]) { return this.length === 0; }, configurable: true });

// System.Buffers.ArrayPool<T>: pooling buys nothing in JS; hand out fresh arrays.
const pool = { Rent: (n: number) => new Array(n).fill(0), Return() {} };
provide('System.Buffers.ArrayPool`1', { Create: () => pool, Shared: pool });
