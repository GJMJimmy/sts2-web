// Minimal Godot API surface the rule layer touches. Scene-graph types stay as generated stubs; the render layer fills them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { provide, ext, str, hash, compare, Enumerator, dummy, round } from './core';
import { Dictionary } from './collections';
import { WebTween, onFrame } from './tween';

export class Vector2 {
  constructor(public X = 0, public Y = 0) {}
  static $default() { return new Vector2(); }
  static get Zero() { return new Vector2(0, 0); }
  static get One() { return new Vector2(1, 1); }
  static get Up() { return new Vector2(0, -1); }
  static get Down() { return new Vector2(0, 1); }
  static get Left() { return new Vector2(-1, 0); }
  static get Right() { return new Vector2(1, 0); }
  Length() { return Math.hypot(this.X, this.Y); }
  LengthSquared() { return this.X * this.X + this.Y * this.Y; }
  Normalized() { const l = this.Length() || 1; return new Vector2(this.X / l, this.Y / l); }
  DistanceTo(o: Vector2) { return Math.hypot(this.X - o.X, this.Y - o.Y); }
  DistanceSquaredTo(o: Vector2) { return (this.X - o.X) ** 2 + (this.Y - o.Y) ** 2; }
  Lerp(o: Vector2, t: number) { return new Vector2(this.X + (o.X - this.X) * t, this.Y + (o.Y - this.Y) * t); }
  Angle() { return Math.atan2(this.Y, this.X); }
  AngleTo(o: Vector2) { return Math.atan2(this.X * o.Y - this.Y * o.X, this.X * o.X + this.Y * o.Y); }
  AngleToPoint(o: Vector2) { return Math.atan2(o.Y - this.Y, o.X - this.X); }
  DirectionTo(o: Vector2) { return new Vector2(o.X - this.X, o.Y - this.Y).Normalized(); }
  Rotated(a: number) { const c = Math.cos(a), s = Math.sin(a); return new Vector2(this.X * c - this.Y * s, this.X * s + this.Y * c); }
  Dot(o: Vector2) { return this.X * o.X + this.Y * o.Y; }
  Abs() { return new Vector2(Math.abs(this.X), Math.abs(this.Y)); }
  Round() { return new Vector2(round(this.X), round(this.Y)); } // MathF.Round: half to even
  Floor() { return new Vector2(Math.floor(this.X), Math.floor(this.Y)); }
  Equals(o: any) { return o instanceof Vector2 && o.X === this.X && o.Y === this.Y; }
  GetHashCode() { return hash(this.X * 31 + this.Y); }
  $key() { return `v${this.X},${this.Y}`; }
  $clone() { return new Vector2(this.X, this.Y); }
  ToString() { return `(${str(this.X)}, ${str(this.Y)})`; }
  static op_Addition(a: Vector2, b: Vector2) { return new Vector2(a.X + b.X, a.Y + b.Y); }
  static op_Subtraction(a: Vector2, b: Vector2) { return new Vector2(a.X - b.X, a.Y - b.Y); }
  static op_Multiply(a: any, b: any) { return typeof a === 'number' ? new Vector2(a * b.X, a * b.Y) : typeof b === 'number' ? new Vector2(a.X * b, a.Y * b) : new Vector2(a.X * b.X, a.Y * b.Y); }
  static op_Division(a: Vector2, b: any) { return typeof b === 'number' ? new Vector2(a.X / b, a.Y / b) : new Vector2(a.X / b.X, a.Y / b.Y); }
  static op_UnaryNegation(a: Vector2) { return new Vector2(-a.X, -a.Y); }
  static op_Equality(a: Vector2, b: Vector2) { return a?.X === b?.X && a?.Y === b?.Y; }
  static op_Inequality(a: Vector2, b: Vector2) { return !Vector2.op_Equality(a, b); }
}
export class Vector2I extends Vector2 {
  static $default() { return new Vector2I(); }
  static get Zero() { return new Vector2I(0, 0); }
  $key() { return `vi${this.X},${this.Y}`; }
  static op_Addition(a: Vector2I, b: Vector2I) { return new Vector2I(a.X + b.X, a.Y + b.Y); }
  static op_Subtraction(a: Vector2I, b: Vector2I) { return new Vector2I(a.X - b.X, a.Y - b.Y); }
  static op_Equality(a: Vector2I, b: Vector2I) { return a?.X === b?.X && a?.Y === b?.Y; }
  static op_Inequality(a: Vector2I, b: Vector2I) { return !Vector2I.op_Equality(a, b); }
  CompareTo(o: Vector2I) { return compare(this.X, o.X) || compare(this.Y, o.Y); }
}
export class Color {
  constructor(public R = 0, public G = 0, public B = 0, public A = 1) {
    if (typeof R === 'string') { const c = Color.FromHtml(R); this.R = c.R; this.G = c.G; this.B = c.B; this.A = typeof G === 'number' && arguments.length === 2 ? G : c.A; }
  }
  static $default() { return new Color(0, 0, 0, 0); }
  static FromHtml(s: string) {
    const h = s.replace('#', '');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return h.length >= 8 ? new Color(n(0), n(2), n(4), n(6)) : new Color(n(0), n(2), n(4), 1);
  }
  static Color8(r: number, g: number, b: number, a = 255) { return new Color(r / 255, g / 255, b / 255, a / 255); }
  Lerp(o: Color, t: number) { return new Color(this.R + (o.R - this.R) * t, this.G + (o.G - this.G) * t, this.B + (o.B - this.B) * t, this.A + (o.A - this.A) * t); }
  ToHtml(alpha = true) { const x = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return x(this.R) + x(this.G) + x(this.B) + (alpha ? x(this.A) : ''); }
  Equals(o: any) { return o instanceof Color && o.R === this.R && o.G === this.G && o.B === this.B && o.A === this.A; }
  $key() { return 'c' + this.ToHtml(); }
  $clone() { return new Color(this.R, this.G, this.B, this.A); }
  ToString() { return `(${this.R}, ${this.G}, ${this.B}, ${this.A})`; }
  static op_Multiply(a: any, b: any) { return typeof b === 'number' ? new Color(a.R * b, a.G * b, a.B * b, a.A * b) : new Color(a.R * b.R, a.G * b.G, a.B * b.B, a.A * b.A); }
  static op_Equality(a: Color, b: Color) { return !!a && a.Equals(b); }
  static op_Inequality(a: Color, b: Color) { return !Color.op_Equality(a, b); }
}
provide('Godot.Vector2', Vector2);
provide('Godot.Vector2I', Vector2I);
provide('Godot.Color', Color);
provide('Godot.Colors', new Proxy({}, { get: (_t, p) => (typeof p === 'string' ? namedColor(p) : undefined) }));
function namedColor(n: string) {
  const m: Record<string, string> = { White: 'ffffff', Black: '000000', Red: 'ff0000', Green: '00ff00', Blue: '0000ff', Yellow: 'ffff00', Gold: 'ffd700', Gray: 'bebebe', Transparent: '00000000', Orange: 'ffa500', Purple: 'a020f0' };
  return Color.FromHtml(m[n] ?? 'ffffff');
}

provide('Godot.Mathf', {
  Pi: Math.PI, Tau: Math.PI * 2, Inf: Infinity, E: Math.E, Epsilon: 1e-6,
  Abs: Math.abs, Sign: Math.sign, Sqrt: Math.sqrt, Pow: Math.pow, Sin: Math.sin, Cos: Math.cos, Atan2: Math.atan2, Exp: Math.exp, Log: Math.log,
  Floor: Math.floor, Ceil: Math.ceil, Round: (x: number) => round(x), FloorToInt: Math.floor, CeilToInt: Math.ceil, RoundToInt: (x: number) => round(x), // MathF.Round: half to even
  Min: Math.min, Max: Math.max, Clamp: (v: number, a: number, b: number) => Math.min(Math.max(v, a), b),
  Lerp: (a: number, b: number, t: number) => a + (b - a) * t, InverseLerp: (a: number, b: number, v: number) => (v - a) / (b - a),
  Remap: (v: number, a: number, b: number, c: number, d: number) => c + ((v - a) / (b - a)) * (d - c),
  MoveToward: (a: number, b: number, d: number) => (Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d),
  DegToRad: (d: number) => (d * Math.PI) / 180, RadToDeg: (r: number) => (r * 180) / Math.PI,
  IsEqualApprox: (a: number, b: number) => Math.abs(a - b) < 1e-5, IsZeroApprox: (a: number) => Math.abs(a) < 1e-5,
  PosMod: (a: number, b: number) => ((a % b) + b) % b, Wrap: (v: number, a: number, b: number) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a)),
  SmoothStep: (a: number, b: number, v: number) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); },
  Snapped: (v: number, s: number) => (s ? Math.round(v / s) * s : v),
});
const defaultSink = (l: string, m: string) => (l === 'error' ? console.error(m) : l === 'warn' ? console.warn(m) : undefined);
let logSink: (level: string, msg: string) => void = defaultSink;
/** Route Godot GD.Print* output; null restores the console default. */
export function setGodotLogSink(f: ((level: string, msg: string) => void) | null) { logSink = f ?? defaultSink; }
provide('Godot.GD', {
  Print: (...a: any[]) => logSink('info', a.map(str).join('')),
  PrintRich: (...a: any[]) => logSink('info', a.map(str).join('')),
  PrintErr: (...a: any[]) => logSink('error', a.map(str).join('')),
  PushError: (...a: any[]) => logSink('error', a.map(str).join('')),
  PushWarning: (...a: any[]) => logSink('warn', a.map(str).join('')),
  Randf: () => Math.random(), Randi: () => (Math.random() * 4294967296) >>> 0, RandRange: (a: number, b: number) => a + Math.random() * (b - a),
  Load: () => null, IsInstanceValid: (o: any) => o != null,
});

// ------------------------------------------------------------------ SceneTree timers (Cmd.Wait) & frames
class SceneTreeTimer {
  Timeout: any = null;
  constructor(sec: number) { setTimeout(() => this.Timeout?.(), Math.max(0, sec * 1000 * timeScale)); }
  ToSignal(src: any, sig: any) { return toSignal(src ?? this, sig); }
}
/**
 * GodotObject.ToSignal(source, signal) as an awaitable Task: a timer's "timeout" completes when it fires; every other
 * signal (process_frame, animation/tween ends on inert nodes) completes on the next animation frame.
 */
export function toSignal(src: any, sig: any) {
  const name = String(sig?.s ?? sig ?? '').toLowerCase();
  if (src instanceof WebTween && name === 'finished') {
    const t = new (ext('System.Threading.Tasks.Task'))();
    src.whenFinished(() => t.$done(1));
    return t;
  }
  if (src instanceof SceneTreeTimer || name === 'timeout') {
    const Task = ext('System.Threading.Tasks.Task');
    const t = new Task();
    const prev = src?.Timeout;
    if (src) src.Timeout = () => { prev?.(); t.$done(1); };
    else t.$done(1);
    return t;
  }
  return nextFrame();
}
WebTween.toSignal = toSignal;
let timeScale = 1;
export function setTimeScale(s: number) { timeScale = s; }
const rootNode = {
  GetProcessDeltaTime: () => 1 / 60,
  GetPhysicsProcessDeltaTime: () => 1 / 60,
  GetViewport: () => rootNode,
  GetVisibleRect: () => ({ Size: new Vector2(1920, 1080), Position: new Vector2() }),
  GetTree: () => tree,
  IsInsideTree: () => true,
  GetChildren: () => [],
  Size: new Vector2I(1920, 1080),
};
const tree: any = {
  CreateTimer: (sec: number) => new SceneTreeTimer(sec),
  ProcessFrame: null as any,
  get Root() { return rootNode; },
  ToSignal: (src: any, sig: any) => toSignal(src, sig),
  CreateTween: () => new WebTween(),
  Paused: false,
};
export function nextFrame() {
  const Task = ext('System.Threading.Tasks.Task');
  const t = new Task();
  onFrame(() => { t.$done(1); return false; });
  return t;
}
provide('Godot.SceneTree', Object.assign(function SceneTree() {}, { SignalName: { ProcessFrame: 'process_frame' } }));
provide('Godot.SceneTree+SignalName', { ProcessFrame: 'process_frame' });
provide('Godot.Engine', { GetMainLoop: () => tree, IsEditorHint: () => false, GetFramesDrawn: () => 0, get TimeScale() { return timeScale; }, set TimeScale(v: number) { timeScale = v; }, GetVersionInfo: () => new Dictionary(), MaxFps: 60 });
provide('Godot.OS', { GetCmdlineArgs: () => [], GetCmdlineUserArgs: () => [], GetName: () => 'Web', HasFeature: (f: string) => f === 'web' || f === 'release', IsDebugBuild: () => false, GetLocale: () => 'en', GetLocaleLanguage: () => 'en', GetUserDataDir: () => '/user', GetExecutablePath: () => '/', GetProcessorCount: () => 1, GetUniqueId: () => 'web', ShellOpen() {}, GetStaticMemoryUsage: () => 0, IsStdOutVerbose: () => false, GetModelName: () => 'Web', GetVersion: () => '1' });
provide('Godot.Time', { GetTicksMsec: () => Math.trunc(performance.now()), GetTicksUsec: () => Math.trunc(performance.now() * 1000), GetUnixTimeFromSystem: () => Date.now() / 1000, GetDatetimeStringFromSystem: () => new Date().toISOString() });
provide('Godot.StringName', class StringName { constructor(public s = '') {} ToString() { return this.s; } });
provide('Godot.NodePath', class NodePath { constructor(public s = '') {} ToString() { return this.s; } });
class Callable {
  constructor(public Delegate: any) {}
  /** Callable.From(fn) / Callable.From<T>(fn): the transpiler passes generic type arguments first. */
  static From(...a: any[]) { return new Callable(a[a.length - 1]); }
  Call(...a: any[]) { return this.Delegate?.(...a); }
  CallDeferred(...a: any[]) { setTimeout(() => this.Delegate?.(...a), 0); }
  Invoke(...a: any[]) { return this.Delegate?.(...a); }
}
provide('Godot.Callable', Callable);
provide('Godot.Variant', { From: (v: any) => v, CreateFrom: (v: any) => v });
provide('Godot.Collections.Array', Array);
provide('Godot.Collections.Array`1', Array);
provide('Godot.Collections.Dictionary', Dictionary);
provide('Godot.Collections.Dictionary`2', Dictionary);
provide('Godot.ProjectSettings', { GlobalizePath: (p: string) => p, GetSetting: () => null, HasSetting: () => false });
// Scenes/textures are never really loaded: the web front end renders from its own asset index.
// A loaded scene instantiates to an inert stub node so VFX/UI code in the rule layer runs as no-ops.
// an instance's SceneFilePath is its scene (Node.SceneFilePath): web views that receive it play that scene
class PackedScene {
  constructor(public ResourcePath = '') {}
  Instantiate(T: any) { const n = dummy(T ?? ext('Godot.Node')); if (n && this.ResourcePath) n.SceneFilePath = this.ResourcePath; return n; }
  CanInstantiate() { return true; }
}
provide('Godot.PackedScene', PackedScene);
/** A loaded resource stand-in; it keeps its path (the web views resolve textures by it). */
function loadedResource(T: any, path: string) {
  const r = dummy(typeof T === 'function' ? T : ext('Godot.Resource'));
  if (r) try { Object.defineProperty(r, 'ResourcePath', { value: String(path), configurable: true }); } catch { /* frozen stub */ }
  return r;
}
provide('Godot.ResourceLoader', { Exists: (p: string) => true, Load: (T: any, path: string) => (/\.tscn$/.test(String(path)) ? new PackedScene(path) : loadedResource(T, path)), LoadThreadedRequest: () => 0, LoadThreadedGetStatus: () => 3, LoadThreadedGet: () => null, CacheMode: { Reuse: 1, Ignore: 0, Replace: 2 } });
provide('Godot.ResourceLoader+CacheMode', { Ignore: 0, Reuse: 1, Replace: 2 });
provide('Godot.TranslationServer', { GetLocale: () => 'en', SetLocale() {} });
provide('Godot.DisplayServer', { WindowGetSize: () => new Vector2I(1920, 1080), ScreenGetSize: () => new Vector2I(1920, 1080), WindowSetTitle() {}, GetName: () => 'web', ClipboardSet() {} });
provide('Godot.Input', { IsKeyPressed: () => false, IsActionPressed: () => false, GetMousePosition: () => new Vector2(), MouseMode: 0, GetConnectedJoypads: () => [] });

// ------------------------------------------------------------------ persistent files: user:// → IndexedDB / localStorage / memory
// The rule layer does synchronous file IO, so files live in memory: `vfs.mount()` (browser boot) loads them from
// IndexedDB and every write is then persisted asynchronously. Before mounting, or where IndexedDB is unavailable,
// localStorage is used directly; where that throws too (some privacy modes) saves last for the session only.
let mem = new Map<string, string>();
const storage: Storage | null = (() => { try { const s = typeof localStorage !== 'undefined' ? localStorage : null; s?.getItem(''); return s; } catch { return null; } })();
const LS_PREFIX = 'sts2fs:';
let writeError: ((path: string, err: unknown) => void) | null = null;
/** Host hook for failed writes (quota exceeded): the save code sees an IOException and keeps the previous file. */
export function setStorageErrorHandler(f: ((path: string, err: unknown) => void) | null) { writeError = f; }
let db: IDBDatabase | null = null;
const lsKeys = (prefix = LS_PREFIX) => (storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter((k) => k.startsWith(prefix)) : []);
// Writes made while the page unloads (the quit saves) may never commit to IndexedDB: they are also journaled to
// localStorage synchronously (put: J + path → text, delete: J + path → DEL) and replayed over IndexedDB by the next mount.
const JOURNAL = 'sts2fs-j:', DEL = '\u0000deleted';
let journaling = false;
function journal(p: string, s: string | null) {
  if (!journaling || !storage) return;
  try { storage.setItem(JOURNAL + p, s ?? DEL); } catch { /* quota: best effort */ }
}
/** Queue a put (s) or delete (null); IndexedDB runs transactions on one store in creation order. */
function persist(p: string, s: string | null) {
  const tx = db!.transaction('files', 'readwrite');
  const st = tx.objectStore('files');
  if (s === null) st.delete(p); else st.put(s, p);
  tx.onerror = () => writeError?.(p, tx.error);
  tx.onabort = () => writeError?.(p, tx.error);
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
export const vfs = {
  get persistent() { return db !== null || storage !== null; },
  get backend() { return db ? 'indexeddb' : storage ? 'localstorage' : 'memory'; },
  read(p: string): string | null { return !db && storage ? storage.getItem(LS_PREFIX + p) : mem.get(p) ?? null; },
  write(p: string, s: string) {
    if (db) { mem.set(p, s); persist(p, s); journal(p, s); return; }
    if (!storage) { mem.set(p, s); return; }
    try { storage.setItem(LS_PREFIX + p, s); } catch (e) {
      writeError?.(p, e);
      throw new (ext('System.IO.IOException') as any)(`Could not write ${p}: ${(e as Error)?.name === 'QuotaExceededError' ? 'browser storage is full' : String(e)}`);
    }
  },
  remove(p: string) {
    if (db) { mem.delete(p); persist(p, null); journal(p, null); } else if (storage) storage.removeItem(LS_PREFIX + p); else mem.delete(p);
  },
  exists(p: string) { return this.read(p) !== null; },
  /** pagehide: journal what is written from now on; pageshow (back from the bfcache): the writes committed, drop it. */
  setUnloading(on: boolean) { journaling = on; if (!on) for (const k of lsKeys(JOURNAL)) storage!.removeItem(k); },
  list(dir: string): string[] {
    const pre = dir.endsWith('/') ? dir : dir + '/';
    const keys = !db && storage ? lsKeys().map((k) => k.slice(LS_PREFIX.length)) : [...mem.keys()];
    return keys.filter((k) => k.startsWith(pre));
  },
  /** Switch to IndexedDB (all files read into memory); saves kept in localStorage by earlier versions move over once. */
  async mount(): Promise<void> {
    if (db || typeof indexedDB === 'undefined') return;
    try {
      const open = indexedDB.open('sts2fs', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('files');
      const d = await req(open);
      const st = d.transaction('files').objectStore('files');
      const [keys, vals] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
      const files = new Map(keys.map((k, i) => [String(k), vals[i] as string]));
      const legacy = lsKeys(), journaled = lsKeys(JOURNAL);
      if (legacy.length || journaled.length) {
        const tx = d.transaction('files', 'readwrite');
        for (const k of legacy) { const p = k.slice(LS_PREFIX.length); if (!files.has(p)) { const v = storage!.getItem(k)!; files.set(p, v); tx.objectStore('files').put(v, p); } }
        for (const k of journaled) {
          const p = k.slice(JOURNAL.length), v = storage!.getItem(k)!;
          if (v === DEL) { files.delete(p); tx.objectStore('files').delete(p); } else { files.set(p, v); tx.objectStore('files').put(v, p); }
        }
        await new Promise<void>((ok, fail) => { tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error); });
        for (const k of [...legacy, ...journaled]) storage!.removeItem(k);
      }
      mem = files;
      db = d;
    } catch (e) { console.warn('IndexedDB unavailable, saves stay in localStorage', e); }
  },
};
// res:// (and bare relative) paths are read-only game resources supplied by the host (disk in tests, fetched assets in the browser)
let resReader: (path: string) => string | null = () => null;
let resLister: (dir: string) => string[] = () => [];
export function setResourceReader(f: (path: string) => string | null) { resReader = f; }
export function setResourceLister(f: (dir: string) => string[]) { resLister = f; }
const isUser = (p: string) => p.startsWith('user://');
const resPath = (p: string) => p.replace(/^res:\/\//, '').replace(/^\/+/, '');
export function readResource(p: string) { return resReader(resPath(p)); }

const ModeFlags = { Read: 1, Write: 2, ReadWrite: 3, WriteRead: 7 };
class FileAccess {
  private buf = '';
  private pos = 0;
  constructor(private path: string, private mode: number, content?: string) { if (mode & 1) this.buf = content ?? vfs.read(path) ?? ''; }
  static ModeFlags = ModeFlags;
  static Open(path: string, mode: number) {
    if (!isUser(path)) { const s = mode === ModeFlags.Read ? readResource(path) : null; return s === null ? null : new FileAccess(path, mode, s); }
    if (mode === ModeFlags.Read && !vfs.exists(path)) return null;
    return new FileAccess(path, mode);
  }
  static FileExists(p: string) { return isUser(p) ? vfs.exists(p) : readResource(p) !== null; }
  static GetOpenError() { return 0; }
  static GetFileAsString(p: string) { return vfs.read(p) ?? ''; }
  static GetModifiedTime() { return Math.floor(Date.now() / 1000); }
  GetAsText() { return this.buf; }
  GetLine() { const i = this.buf.indexOf('\n', this.pos); const s = this.buf.slice(this.pos, i < 0 ? undefined : i); this.pos = i < 0 ? this.buf.length : i + 1; return s; }
  EofReached() { return this.pos >= this.buf.length; }
  GetPosition() { return this.pos; }
  GetLength() { return this.buf.length; }
  // user:// files hold text; byte APIs are UTF-8 (saves are JSON written via Encoding.UTF8 bytes)
  GetBuffer(n: number) { const b = new TextEncoder().encode(this.buf); const out = Array.from(b.subarray(this.pos, this.pos + n)); this.pos += out.length; return out; }
  StoreString(s: string) { this.buf += s; }
  StoreLine(s: string) { this.buf += s + '\n'; }
  StoreBuffer(b: number[]) { this.buf += new TextDecoder().decode(Uint8Array.from(b)); }
  private closed = false;
  Flush() { if (this.mode & 2 && !this.closed) vfs.write(this.path, this.buf); }
  // a closed file writes nothing more: `using` disposes after Close + rename, which must not re-create the .tmp
  Close() { this.Flush(); this.closed = true; }
  Dispose() { this.Close(); }
}
provide('Godot.FileAccess', FileAccess);
provide('Godot.FileAccess+ModeFlags', ModeFlags);
class DirAccess {
  constructor(private dir: string) {}
  static Open(d: string) { return new DirAccess(d); }
  static DirExistsAbsolute() { return true; }
  static MakeDirRecursiveAbsolute() { return 0; }
  static MakeDirAbsolute() { return 0; }
  static RemoveAbsolute(p: string) { vfs.remove(p); return 0; }
  // Godot returns an Error code (1 = FAILED) instead of throwing; the source stays when the target cannot be written
  static RenameAbsolute(a: string, b: string) { const s = vfs.read(a); if (s === null) return 7; try { vfs.write(b, s); } catch { return 1; } vfs.remove(a); return 0; }
  static CopyAbsolute(a: string, b: string) { const s = vfs.read(a); if (s === null) return 7; try { vfs.write(b, s); } catch { return 1; } return 0; }
  static GetFilesAt(d: string) { if (!isUser(d)) return resLister(resPath(d)); return vfs.list(d).map((k) => k.slice(d.length).replace(/^\//, '')).filter((k) => !k.includes('/')); }
  static GetDirectoriesAt(d: string) { return [...new Set(vfs.list(d).map((k) => k.slice(d.length).replace(/^\//, '')).filter((k) => k.includes('/')).map((k) => k.split('/')[0]))]; }
  FileExists(p: string) { return vfs.exists(p.startsWith('user://') ? p : this.dir + '/' + p); }
  DirExists() { return true; }
  MakeDirRecursive() { return 0; }
  MakeDir() { return 0; }
  Remove(p: string) { vfs.remove(p.startsWith('user://') ? p : this.dir + '/' + p); return 0; }
  Rename(a: string, b: string) { return DirAccess.RenameAbsolute(this.dir + '/' + a, this.dir + '/' + b); }
  GetFiles() { return DirAccess.GetFilesAt(this.dir); }
  static DirExists(d: string) { return true; }
  GetDirectories() { return DirAccess.GetDirectoriesAt(this.dir); }
  private entries: string[] = [];
  ListDirBegin() { this.entries = [...DirAccess.GetFilesAt(this.dir)]; return 0; }
  GetNext() { return this.entries.shift() ?? ''; }
  CurrentIsDir() { return false; }
  ListDirEnd() {}
  Dispose() {}
}
provide('Godot.DirAccess', DirAccess);
provide('Godot.Json', { Stringify: (v: any) => JSON.stringify(v), ParseString: (s: string) => JSON.parse(s) });
export { Enumerator };
