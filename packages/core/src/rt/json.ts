// System.Text.Json subset. The game's source-generated JsonSerializerContexts are replaced by name-based descriptors.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { provide, types, iter, ext } from './core';
import { attrTypeName } from './bcl';
import { Dictionary, HashSet } from './collections';

export function jsonContext(ctxName: string): any {
  return new Proxy({}, {
    get(_t, p) {
      if (p === 'WithAddedModifier') return () => jsonContext(ctxName);
      if (typeof p !== 'string' || p === 'then') return undefined;
      return { $jsonTypeName: p, $context: ctxName };
    },
  });
}
function typeByName(name: string): any {
  for (const t of types.values()) if (t.$name === name) return t;
  return null;
}
function fromJson(raw: any, T: any, name?: string): any {
  if (raw === null || raw === undefined) return null;
  if (name) {
    if (/^(Dictionary|IDictionary|IReadOnlyDictionary)/.test(name)) return new Dictionary(Object.entries(raw));
    if (/^(List|IList|IEnumerable|Array)/.test(name) || name.endsWith('Array')) return Array.from(raw);
    if (/^HashSet/.test(name)) return new HashSet(raw);
    const t = typeByName(name);
    if (t) return hydrate(raw, t);
    return raw;
  }
  if (T && typeof T === 'function' && T.$name && !T.$prim) return hydrate(raw, T);
  return raw;
}
/** Best-effort: create T and copy JSON fields onto matching properties (JsonPropertyName metadata when present). */
function hydrate(raw: any, T: any): any {
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = typeof T.$new === 'function' && Object.hasOwn(T, '$new') ? T.$new() : new T();
  const props = typeof T.GetProperties === 'function' ? T.GetProperties() : [];
  const byJson = new Map<string, any>();
  for (const p of props) {
    const a = p.GetCustomAttributes().find((x: any) => x?.constructor?.$name === 'JsonPropertyNameAttribute');
    byJson.set(a?.$args?.[0] ?? a?.Name ?? p.Name, p);
  }
  for (const [k, v] of Object.entries(raw)) {
    const p = byJson.get(k);
    const target = p?.Name ?? k.replace(/(^|_)(\w)/g, (_m, _a, c) => c.toUpperCase());
    o[target] = p ? fromJson(v, p.PropertyType) : v;
  }
  return o;
}
export function toJson(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(toJson);
  if (v instanceof Dictionary) { const o: any = {}; for (const [k, x] of v) o[String(k)] = toJson(x); return o; }
  if (v instanceof HashSet) return Array.from(v, toJson);
  if (typeof v.$key === 'function' && typeof v.ToString === 'function' && v.constructor?.$record) return v.ToString();
  const o: any = {};
  for (const k of Object.keys(v)) if (!k.startsWith('$')) o[k.replace(/^\$_/, '')] = toJson(v[k]);
  return o;
}
// ------------------------------------------------------------------ snapshot serializer (typed JSON for save files)
/** Serialize an object graph of transpiled classes to JSON-safe data, tagging class instances with their full name. */
interface JsonMember { k: string; conv?: string }
const jsonMemberCache = new WeakMap<object, JsonMember[] | null>();
/** Members System.Text.Json would write ([JsonPropertyName]/[JsonInclude]) and their [JsonConverter]; null when the class declares none. */
function jsonMembers(C: any): JsonMember[] | null {
  if (typeof C !== 'function') return null;
  if (jsonMemberCache.has(C)) return jsonMemberCache.get(C)!;
  const out: JsonMember[] = [];
  for (let c = C; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (!Object.hasOwn(c, '$members')) continue;
    for (const [name, m] of Object.entries<any>(c.$members())) {
      if (out.some((x) => x.k === name) || !m.a.some((a: any) => /JsonPropertyName|JsonInclude/.test(attrTypeName(a) ?? ''))) continue;
      const conv = m.a.find((a: any) => /JsonConverterAttribute$/.test(attrTypeName(a) ?? ''))?.$args?.[0]?.$fullName;
      out.push(conv ? { k: name, conv } : { k: name });
    }
  }
  const r = out.length ? out : null;
  jsonMemberCache.set(C, r);
  return r;
}
/**
 * Member-level [JsonConverter]s whose default walk would be wrong. LocStringVariablesJsonConverter stores DynamicVars
 * (which point back at live models) as SerializableDynamicVar records.
 */
const converters: Record<string, { write(v: any): any; read(v: any): any }> = {
  'MegaCrit.Sts2.Core.Localization.LocStringVariablesJsonConverter': {
    write(d: any) {
      if (!d) return null;
      const SDV = types.get('MegaCrit.Sts2.Core.Localization.SerializableDynamicVar');
      const DV = types.get('MegaCrit.Sts2.Core.Localization.DynamicVars.DynamicVar');
      const out = new Dictionary();
      for (const [k, v] of d) {
        const s = SDV?.FromDynamicVar(v);
        if (s != null && (s.type !== 1 /* BaseDynamic */ || v?.constructor === DV)) out.set_Item(k, s); // BaseDynamic only for plain DynamicVar
      }
      return out;
    },
    read(d: any) {
      if (!d) return null;
      const out = new Dictionary();
      for (const [k, v] of d) out.set_Item(k, v?.ToDynamicVar?.(k) ?? v);
      return out;
    },
  },
};
const memberConverter = (C: any, k: string) => { const c = jsonMembers(C)?.find((m) => m.k === k)?.conv; return c ? converters[c] : undefined; };
/**
 * Serialize an object graph of transpiled classes to JSON-safe data, tagging class instances with their full name.
 * Save DTOs are trees; a cycle or a runaway graph means a live model leaked into a DTO, so fail loudly with its path.
 */
export function snapshot(root: any): any {
  const stack = new Set<any>();
  let budget = 500_000;
  const walk = (v: any, path: string): any => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'function') return v.$fullName ? { $type: v.$fullName } : null;
    if (--budget < 0) throw new Error(`snapshot: graph too large at ${path}`);
    if (stack.has(v)) throw new Error(`snapshot: cycle at ${path} (${v.constructor?.$fullName ?? v.constructor?.name})`);
    stack.add(v);
    try {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
      if (v instanceof Dictionary) return { $d: Array.from(v, ([k, x]) => [walk(k, path + '.key'), walk(x, `${path}[${String(k)}]`)]) };
      if (v instanceof HashSet) return { $h: Array.from(v, (x) => walk(x, path + '{}')) };
      const C = v.constructor;
      const o: any = {};
      if (C?.$fullName && types.get(C.$fullName) === C) o.$t = C.$fullName;
      const members = jsonMembers(C);
      for (const k of members ? members.map((m) => m.k) : Object.keys(v)) {
        let x = v[k];
        if (typeof x === 'function' && !x.$fullName) continue;
        const conv = members && memberConverter(C, k);
        if (conv) x = conv.write(x);
        o[k] = walk(x, `${path}.${k}`);
      }
      return o;
    } finally {
      stack.delete(v);
    }
  };
  return walk(root, '$');
}
/** Set a restored member: get-only auto-properties are written through their `$_Name` backing field. */
function assignMember(o: any, k: string, v: any) {
  for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, k);
    if (!d) continue;
    // get-only: an auto-property's `$_Name` backing field, or a primary-constructor parameter (`LocTable => locTable`)
    if (d.get && !d.set) { o['$_' + k] = v; o['$p_' + k[0].toLowerCase() + k.slice(1)] = v; return; }
    break;
  }
  o[k] = v;
}
export function restore(raw: any): any {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return raw;
  if (Array.isArray(raw)) return raw.map(restore);
  if ('$n' in raw) return Number(raw.$n);
  if ('$type' in raw) return types.get(raw.$type) ?? null;
  if ('$d' in raw) { const d = new Dictionary(); for (const [k, x] of raw.$d) d.set_Item(restore(k), restore(x)); return d; }
  if ('$h' in raw) return new HashSet(raw.$h.map(restore));
  const C = raw.$t ? types.get(raw.$t) : null;
  // Like System.Text.Json: run the parameterless constructor (field initializers), then assign the saved members.
  let o: any = null;
  if (C && Object.hasOwn(C, '$new')) { try { o = C.$new(); } catch { o = null; } }
  if (!o && C) {
    // no parameterless constructor (primary-constructor classes): allocate and run the field initializers, base first
    o = Object.create(C.prototype);
    const chain: any[] = [];
    for (let c = C; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) chain.unshift(c);
    for (const c of chain) { const fi = c.prototype?.['$fi_' + c.$name]; if (typeof fi === 'function' && Object.hasOwn(c.prototype, '$fi_' + c.$name)) { try { fi.call(o); } catch { /* best effort */ } } }
  }
  o ??= {};
  for (const [k, x] of Object.entries(raw)) {
    if (k === '$t') continue;
    const conv = C && memberConverter(C, k);
    assignMember(o, k, conv ? conv.read(restore(x)) : restore(x));
  }
  return o;
}

export const JsonSerializer = {
  Deserialize(...args: any[]) {
    let T: any = null;
    if (typeof args[0] === 'function' || args[0]?.$prim) T = args.shift();
    const [text, info] = args;
    const raw = typeof text === 'string' ? JSON.parse(text) : text;
    if (info?.$type || raw?.$t) return restore(raw);
    return fromJson(raw, T, info?.$jsonTypeName);
  },
  Serialize(...args: any[]) {
    if (typeof args[0] === 'function' || args[0]?.$prim) args.shift();
    if (args[0] instanceof MemoryStream) { JsonSerializer.SerializeAsync(...args); return; }
    if (args[1]?.$type) return JSON.stringify(snapshot(args[0]));
    return JSON.stringify(toJson(args[0]), null, 2);
  },
  SerializeAsync(...args: any[]) {
    if (typeof args[0] === 'function' || args[0]?.$prim) args.shift(); // generic <T> argument
    const [stream, data, info] = args;
    stream.$s = info?.$type ? JSON.stringify(snapshot(data)) : JSON.stringify(toJson(data));
    return (ext('System.Threading.Tasks.Task') as any).CompletedTask;
  },
  SerializeToNode(...args: any[]) { if (typeof args[0] === 'function') args.shift(); return toJson(args[0]); },
};
provide('System.Text.Json.JsonSerializer', JsonSerializer);
provide('System.Text.Json.JsonSerializerOptions', class JsonSerializerOptions {
  Converters: any[] = []; WriteIndented = false; PropertyNamingPolicy: any = null; TypeInfoResolver: any = null; Encoder: any = null; TypeInfoResolverChain: any[] = [];
  GetTypeInfo(t: any) { return { $type: t, Kind: 1, Properties: [], Type: t }; }
  static get Default() { return new (ext('System.Text.Json.JsonSerializerOptions'))(); }
});
provide('System.Text.Encodings.Web.JavaScriptEncoder', { UnsafeRelaxedJsonEscaping: {}, Default: {} });
class MemoryStream { $s = ""; Position = 0; get Length() { return this.$s.length; } Seek(o: number) { this.Position = Number(o); return this.Position; } ToArray() { return Array.from(new TextEncoder().encode(this.$s)); } Dispose() {} Flush() {} Close() {} Write() {} }
provide('System.IO.MemoryStream', MemoryStream);
provide('System.IO.StreamReader', class StreamReader { constructor(private st: any) {} ReadToEnd() { return this.st?.$s ?? ''; } ReadToEndAsync() { return (ext('System.Threading.Tasks.Task') as any).FromResult(this.ReadToEnd()); } Dispose() {} });
provide('System.Text.Json.JsonNamingPolicy', { SnakeCaseLower: { ConvertName: (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() }, CamelCase: { ConvertName: (n: string) => n[0].toLowerCase() + n.slice(1) } });
provide('System.Text.Json.Nodes.JsonNode', { Parse: (s: string) => JSON.parse(s) });
provide('System.Text.Json.Nodes.JsonObject', class JsonObject { constructor(src?: any) { if (src) for (const [k, v] of iter(src)) (this as any)[k] = v; } });
provide('System.Text.Json.Nodes.JsonArray', Array);
provide('System.Text.Json.Serialization.Metadata.JsonTypeInfoResolver', { WithAddedModifier: (r: any) => r, Combine: (...r: any[]) => r[0] });
provide('System.Text.Json.Serialization.Metadata.JsonTypeInfo', { CreateJsonTypeInfo: (t: any) => ({ $type: t, Properties: [] }) });
