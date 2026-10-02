// Web audio for FMOD events. The banks were extracted to per-sample Opus files (tools/audio.py) and their event data
// decoded into assets/audio/events.json (tools/fmod_bank.py): action sheets, timelines (sync / async instruments,
// loop regions, transition markers / regions with parameter conditions and quantization), parameter sheets, multi /
// scatterer / nested-event / command instruments. A small timeline engine below plays them on Web Audio; an event
// missing from events.json falls back to sample-name matching (logged once).
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = 'assets/audio/';
let files: string[] = [];
/** Streams identical to one in another bank are stored once (tools/audio.py): bank path → stored file. */
let aliases: Record<string, string> = {};
let ctx: AudioContext | null = null;
const bus: Record<'master' | 'music' | 'sfx' | 'amb', GainNode | null> = { master: null, music: null, sfx: null, amb: null };
const vols = { master: 0.5, music: 0.5, sfx: 0.5, amb: 0.5 };

export async function loadAudioIndex() {
  try {
    const idx = await (await fetch(BASE + 'index.json')).json();
    aliases = idx.aliases ?? {};
    files = [...idx.files, ...Object.keys(aliases)].sort();
  } catch { files = []; }
  try { db = JSON.parse((await import('../../../assets/audio/events.json?raw')).default); } catch { db = null; } // a js/ chunk, see loadAssetIndex
  (window as any).__audio = audioState;
  const unlock = () => { ensureCtx()?.resume(); };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}
function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try { ctx = new AudioContext(); } catch { return null; }
  bus.master = ctx.createGain(); bus.master.connect(ctx.destination);
  for (const k of ['music', 'sfx', 'amb'] as const) { bus[k] = ctx.createGain(); bus[k]!.connect(bus.master); }
  applyVolumes();
  return ctx;
}
/** SettingsSave volumes (0..1). NAudioManager.Set*Vol hands the proxy Mathf.Pow(volume, 2) as the FMOD bus volume (linear gain). */
export function setVolumes(v: Partial<typeof vols>) { Object.assign(vols, v); applyVolumes(); }
function applyVolumes() {
  if (!ctx) return;
  for (const k of ['master', 'music', 'sfx', 'amb'] as const) bus[k]!.gain.value = vols[k] ** 2;
}

// Short SFX stay decoded; music/ambience stems (minutes of PCM each) are decoded per use so they can be freed.
const buffers = new Map<string, Promise<AudioBuffer | null>>();
function buffer(file: string, keep: boolean): Promise<AudioBuffer | null> {
  let p = buffers.get(file);
  if (!p) {
    const c = ensureCtx();
    p = !c ? Promise.resolve(null) : fetch(BASE + (aliases[file] ?? file).split('/').map(encodeURIComponent).join('/')).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).catch(() => null);
    if (keep) buffers.set(file, p);
  }
  return p;
}
function play(file: string, out: GainNode | null, opts: { loop?: boolean; volume?: number; rate?: number } = {}) {
  const c = ensureCtx();
  if (!c || !out) return null;
  const g = c.createGain();
  g.gain.value = opts.volume ?? 1;
  g.connect(out);
  const h = { src: null as AudioBufferSourceNode | null, gain: g, stopped: false };
  buffer(file, out === bus.sfx).then((b) => {
    if (!b || h.stopped) return;
    const s = c.createBufferSource();
    s.buffer = b; s.loop = !!opts.loop; s.playbackRate.value = opts.rate ?? 1;
    s.connect(g); s.start();
    h.src = s;
  });
  return h;
}
type Handle = NonNullable<ReturnType<typeof play>>;
function fadeOut(h: Handle | null, secs = 1) {
  if (!h || !ctx) return;
  h.stopped = true;
  h.gain.gain.setTargetAtTime(0, ctx.currentTime, secs / 4);
  setTimeout(() => { try { h.src?.stop(); } catch { /* already stopped */ } h.src?.disconnect(); h.src = null; h.gain.disconnect(); }, secs * 1000 + 200);
}

// ------------------------------------------------------------------ name matching
const STOP = new Set(['sts', 'sts1', 'sts2', 'sfx', 'event', 'the', 'a', 'of', 'and', 'mx', 'ogg']);
const toks = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t) && !/^(rr|v|layer)?\d+$/.test(t));
const name = (f: string) => f.slice(f.lastIndexOf('/') + 1, -4);
/** Sample identity without round-robin / version suffixes (layers stay distinct). */
const variantKey = (f: string) => name(f).toLowerCase().replace(/[_-]?rr\d+/g, '').replace(/[_-]?v\d+(-\d+)?/g, '');
const layerKey = (f: string) => variantKey(f).replace(/[_-]?layer\d+/g, '');
let tokCache: { f: string; t: Set<string>; j: string; d: Set<string> }[] | null = null;
/** Sample words misspelled in the banks (sts2_sfx_defect_lighting_channel = defect_lightning_channel). */
const SAMPLE_FIX: Record<string, string> = { lighting: 'lightning' };
function sampleToks() {
  return (tokCache ??= files.map((f) => ({ f, t: new Set(toks(name(f)).map((x) => SAMPLE_FIX[x] ?? x)), j: name(f).toLowerCase().replace(/[^a-z0-9]/g, ''), d: new Set(toks(f.slice(0, f.lastIndexOf('/')))) })));
}
/** Event words that the sample names spell differently. */
const SYN: Record<string, string> = { silk: 'web', workbug: 'workerbug', game: 'death', over: 'stinger' };
/** Compound or stemmed spellings: fan_of_knives ~ fanofknives, slumbering ~ SlumberBeetle, wake_up ~ wakeup. */
const inName = (x: string, j: string) => x.length >= 4 && (j.includes(x) || j.includes(x.slice(0, Math.max(5, x.length - 3))));

const sfxCache = new Map<string, string[][]>();
/** Name-matching fallback: event path → groups of interchangeable files, one group per layer. */
function matchSfx(event: string): string[][] {
  let r = sfxCache.get(event);
  if (r) return r;
  const path = event.replace(/^event:\//, '');
  const segs = path.split('/');
  const syn = (s: string) => new Set(toks(s).map((x) => SYN[x] ?? x));
  const all = syn(path), last = syn(segs[segs.length - 1]), owner = syn(segs[segs.length - 2] ?? '');
  // a word inside another of the event's words (slime / slimed) is only matched exactly
  const loose = [...last].filter((x) => ![...all].some((y) => y !== x && y.includes(x)));
  let best = { s: 0, f: '' };
  for (const { f, t, j, d } of sampleToks()) {
    if (!t.size || /^act\d|^Master\//.test(f)) continue; // music banks
    let exact = 0, near = 0, ctxHits = 0;
    for (const x of last) if (t.has(x)) exact++; else if (loose.includes(x) && inName(x, j)) near++;
    if (!exact && near < 2) continue;
    for (const x of all) if (t.has(x) || d.has(x) || inName(x, j)) ctxHits++;
    // the event's folder (monster / character) named in the sample outweighs a sibling's similar action
    const own = [...owner].some((x) => t.has(x) || inName(x, j));
    const s = (exact + 0.8 * near) / Math.max(last.size, 1) + (0.3 * ctxHits) / t.size + (own ? 0.3 : 0);
    if (s > best.s) best = { s, f };
  }
  r = [];
  if (best.s >= 0.5) {
    const lk = layerKey(best.f), dir = best.f.slice(0, best.f.lastIndexOf('/'));
    const byVariant = new Map<string, string[]>();
    for (const f of files) if (f.startsWith(dir + '/') && layerKey(f) === lk) (byVariant.get(variantKey(f)) ?? byVariant.set(variantKey(f), []).get(variantKey(f))!).push(f);
    r = [...byVariant.values()];
  }
  sfxCache.set(event, r);
  return r;
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ FMOD event engine (events.json, see tools/fmod_bank.py)
const RATE = 48000; // FMOD timeline positions / lengths: samples at 48 kHz
const TICK = 50, AHEAD = 0.2; // scheduler period (ms) and look-ahead (s)
type Cond = [string, number, number, number] | ['&' | '|', Cond, Cond];
/** Instrument: sample (f), multi (pl + mode / w), scatterer (sc = polyphony, spawn interval s), nested event (ev), set-parameter command (set). */
interface Ins { f?: string; pl?: (Ins | null)[]; w?: number[]; mode?: number; sc?: [number, number, number]; ev?: string; set?: [string, number];
  vol?: number; pitch?: number; loop?: 1; prob?: number; cond?: Cond; rv?: number; rp?: number; att?: number; rel?: number;
  /** parameter-sheet volume automation (the instrument's and its tracks'): [parameter, [[value, dB], ...]] */
  auto?: [string, [number, number][]][];
  /** timeline-automated track it plays through (Ev.tracks) */
  trk?: string }
type Placed = [Ins | null, number, number];
/** [kind (0 region, 1 marker, 2 loop end, 4 region keeping the relative position), from, to, destination, extra: condition,
 * quantization [unit, count], probability %, transition timeline length (crossfade) and the instruments on it] */
type Tr = [number, number, number, number, { cond?: Cond; q?: [number, number]; prob?: number; fade?: number; ins?: Placed[] }?];
interface Ev { bus: 'music' | 'sfx' | 'amb'; action?: (Ins | null)[]; sync?: Placed[]; async?: Placed[]; sheet?: (Ins | null)[];
  tr?: Tr[]; tempo?: [number, number, number, number][]; len?: number; rel?: number;
  /** tracks with timeline volume automation: key → [parent track key, [[timeline position, dB], ...]] */
  tracks?: Record<string, [string, [number, number][]]> }
interface Db { params: Record<string, { min: number; max: number; default: number; global?: 1; labels?: string[] }>; events: Record<string, Ev>; nested: Record<string, Ev> }
let db: Db | null = null;
/** For node scripts (tools/fmod_events.mjs): use an events.json read from disk. */
export function useEventDb(d: Db) { db = d; }
const globals = new Map<string, number>();
const gain = (v: number) => 10 ** (v / 20);
const rnd = Math.random;

/** INST / TRNB trigger condition: [parameter, lo, hi, flags (1 negate, 2 hi exclusive)] or ['&' | '|', a, b]. */
export function testCond(c: Cond, get: (n: string) => number): boolean {
  if (c[0] === '&') return testCond(c[1] as Cond, get) && testCond(c[2] as Cond, get);
  if (c[0] === '|') return testCond(c[1] as Cond, get) || testCond(c[2] as Cond, get);
  const [n, lo, hi, fl] = c as [string, number, number, number], v = get(n);
  const r = v >= lo && (fl & 2 ? v < hi : v <= hi);
  return fl & 1 ? !r : r;
}
/** Multi / scatterer playlist entry. Modes (inferred from the banks): 0 sequential, 1 random, 2 shuffle (no immediate repeat). */
const lastPick = new WeakMap<Ins, number>();
function pickEntry(m: Ins): Ins | null {
  const pl = m.pl ?? [];
  if (pl.length < 2) return pl[0] ?? null;
  const last = lastPick.get(m) ?? -1;
  let i = (last + 1) % pl.length;
  if (m.mode) {
    const cand = pl.map((_, k) => k).filter((k) => m.mode !== 2 || k !== last), w = cand.map((k) => m.w?.[k] ?? 1);
    let r = rnd() * w.reduce((a, b) => a + b, 0), j = 0;
    while (j < cand.length - 1 && (r -= w[j]) >= 0) j++;
    i = cand[j];
  }
  lastPick.set(m, i);
  return pl[i];
}

interface Voice { alive(): boolean; end(t: number, secs: number): void; untrigger(t: number): void; fadeOut(t: number): void }
const NOVOICE: Voice = { alive: () => false, end() {}, untrigger() {}, fadeOut() {} };
const curveAt = (pts: [number, number][], x: number) => {
  let i = 0;
  while (i < pts.length - 1 && x > pts[i + 1][0]) i++;
  const [x0, y0] = pts[i], [x1, y1] = pts[Math.min(i + 1, pts.length - 1)];
  return x <= x0 || x1 === x0 ? y0 : x >= x1 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
};
const autoGain = (host: Instance, ins: Ins) => gain((ins.auto ?? []).reduce((a, [n, pts]) => a + curveAt(pts, host.get(n)), 0));
const at = (t: number, f: () => void) => setTimeout(f, Math.max(0, (t - (ctx?.currentTime ?? 0)) * 1000));

/** One triggered instrument. offset: seconds into it (sync instruments entered mid-region); fadeIn: transition crossfade;
 * lock: sync instrument, a sample decoded late starts further in to stay on the timeline. */
function voice(host: Instance, ins: Ins | null, t: number, offset: number, out: AudioNode, rate = 1, fadeIn = 0, lock = false): Voice {
  const c = ctx!;
  if (!ins || (ins.prob != null && rnd() * 100 >= ins.prob)) return NOVOICE;
  if (ins.set) { host.setParam(ins.set[0], ins.set[1]); return NOVOICE; }
  const g = c.createGain(), fade = c.createGain(); // level + AHDSR attack | release / stop fades
  const auto = ins.auto ? c.createGain() : null; // parameter automation, followed while the voice lives
  if (auto) { auto.gain.value = autoGain(host, ins); g.connect(auto); auto.connect(fade); } else g.connect(fade);
  fade.connect(out);
  const lvl = gain((ins.vol ?? 0) - (ins.rv ? rnd() * ins.rv : 0)), att = Math.max((ins.att ?? 0) / 1000, fadeIn);
  if (att > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + att); } else g.gain.value = lvl;
  // random pitch: ± half the amount (semitones)
  rate *= 2 ** (((ins.pitch ?? 0) + (ins.rp ? (rnd() - 0.5) * ins.rp : 0)) / 12);
  const inner = ins.f ? sampleVoice(host, ins.f, t, offset, !!ins.loop, rate, g, lock)
    : ins.sc ? scatterVoice(host, ins, t, rate, g)
      : ins.pl ? voice(host, pickEntry(ins), t, offset, g, rate, 0, lock)
        : ins.ev ? nestedVoice(host, ins.ev, t, g) : NOVOICE;
  let endAt = Infinity;
  const end = (t2: number, secs: number) => {
    if (endAt <= t2 + secs) return;
    const s = Math.max(t2, c.currentTime);
    if (endAt === Infinity) { fade.gain.setValueAtTime(1, s); fade.gain.linearRampToValueAtTime(0, s + Math.max(secs, 0.005)); }
    endAt = s + secs;
    inner.end(endAt + 0.005, 0);
    at(endAt + 0.1, () => { if (!inner.alive()) { fade.disconnect(); g.disconnect(); } });
  };
  const rel = (ins.rel ?? 0) / 1000;
  const v: Voice = {
    alive: () => inner.alive() && c.currentTime < endAt,
    end,
    untrigger: (t2) => (rel ? end(t2, rel) : inner.untrigger(t2)),
    fadeOut: (t2) => (rel ? end(t2, rel) : inner.fadeOut(t2)),
  };
  if (auto) host.autos.set(v, () => auto.gain.setTargetAtTime(autoGain(host, ins), c.currentTime, 0.03));
  return v;
}
function sampleVoice(host: Instance, file: string, t: number, offset: number, loop: boolean, rate: number, out: AudioNode, lock: boolean): Voice {
  const c = ctx!;
  let src: AudioBufferSourceNode | null = null, done = false, stopAt = Infinity;
  host.files.add(file);
  buffer(file, true).then((b) => {
    if (!b || done || c.currentTime >= stopAt) { done = true; return; }
    let start = t, off = offset;
    if (c.currentTime > start) { if (lock) off += c.currentTime - start; start = c.currentTime; }
    if (loop) off %= b.duration; else if (off >= b.duration) { done = true; return; }
    src = c.createBufferSource();
    src.buffer = b; src.loop = loop; src.playbackRate.value = rate;
    src.connect(out); src.onended = () => { done = true; src?.disconnect(); sounding.set(file, (sounding.get(file) ?? 1) - 1); };
    src.start(start, off); sounding.set(file, (sounding.get(file) ?? 0) + 1);
    if (stopAt < Infinity) src.stop(Math.max(stopAt, start));
  });
  const end = (t2: number) => { stopAt = Math.min(stopAt, t2); try { src?.stop(Math.max(stopAt, c.currentTime)); } catch { /* stopped */ } };
  return {
    alive: () => !done,
    end,
    untrigger: (t2) => { if (loop) at(t2, () => { if (src) src.loop = false; }); }, // async loop: play the current pass out
    fadeOut: (t2) => end(t2 + 0.005),
  };
}
function scatterVoice(host: Instance, ins: Ins, t: number, rate: number, out: AudioNode): Voice {
  const [poly, lo, hi] = ins.sc!, kids = new Set<Voice>();
  let on = true, timer: ReturnType<typeof setTimeout> | undefined;
  // ponytail: spawn interval taken as seconds, scatter distance / 3D position ignored
  const spawn = () => {
    if (!on) return;
    for (const k of kids) if (!k.alive()) kids.delete(k);
    if (kids.size < poly) kids.add(voice(host, pickEntry(ins), Math.max(ctx!.currentTime, t), 0, out, rate));
    timer = setTimeout(spawn, (lo + rnd() * (hi - lo)) * 1000);
  };
  timer = at(t, spawn);
  const off = () => { on = false; clearTimeout(timer); };
  return {
    alive: () => on || [...kids].some((k) => k.alive()),
    end: (t2, s) => { off(); for (const k of kids) k.end(t2, s); },
    untrigger: off,
    fadeOut: (t2) => { off(); for (const k of kids) k.fadeOut(t2); },
  };
}
function nestedVoice(host: Instance, key: string, t: number, out: AudioNode): Voice {
  const ev = db!.events[key] ?? db!.nested[key];
  if (!ev) return NOVOICE;
  const child = new Instance(key, ev, out, host);
  child.begin(t);
  return { alive: () => !child.done, end: (t2) => child.stop(false, t2), untrigger: (t2) => child.stop(true, t2), fadeOut: (t2) => child.stop(true, t2) };
}

function prefetch(host: Instance, i: Ins | null) {
  if (!i) return;
  if (i.f) { host.files.add(i.f); buffer(i.f, true); }
  for (const x of i.pl ?? []) prefetch(host, x);
}

const live = new Set<Instance>();
const sounding = new Map<string, number>(); // sample → sources started and not ended (audioState)
let ticker: ReturnType<typeof setInterval> | undefined;
/** One FMOD event instance: its timeline cursor, triggered instruments and local parameters. */
class Instance {
  path: string; ev: Ev; out: GainNode; parent: Instance | null;
  params = new Map<string, number>(); files = new Set<string>();
  done = false; stopped = false;
  t0 = -1; pos0 = 0; schedT = 0; schedP = 0; lastP = -1; cursor: boolean; fadeIn = 0;
  tracks = new Map<string, GainNode>(); trackHold = 0;
  busy = false; again = false; jumpT = -1; jumpN = 0;
  placed = new Map<Placed, Voice>(); loose = new Set<Voice>(); sheetOn = new Map<Ins, Voice>(); autos = new Map<Voice, () => void>();
  pend: { pos: number; tr: Tr } | null = null;
  syncSet: Set<Placed>; allPlaced: Placed[];
  constructor(path: string, ev: Ev, dest: AudioNode, parent: Instance | null = null, volume = 1) {
    this.path = path; this.ev = ev; this.parent = parent;
    this.out = ctx!.createGain(); this.out.gain.value = volume; this.out.connect(dest);
    this.cursor = !!ev.len; this.syncSet = new Set(ev.sync); this.allPlaced = [...(ev.sync ?? []), ...(ev.async ?? [])];
    for (const k of Object.keys(ev.tracks ?? {})) this.track(k);
    live.add(this);
    ticker ??= setInterval(() => { for (const i of [...live]) i.update(); if (!live.size) { clearInterval(ticker); ticker = undefined; } }, TICK);
  }
  get(n: string): number { return this.params.get(n) ?? (this.parent ? this.parent.get(n) : globals.get(n) ?? db?.params[n]?.default ?? 0); }
  setParam(n: string, v: number) {
    if (db?.params[n]?.global) { setGlobal(n, v); return; }
    this.params.set(n, v); this.update();
  }
  begin(t: number) { this.t0 = this.schedT = t; this.startActions(); this.update(); }
  startActions() { for (const i of this.ev.action ?? []) this.loose.add(voice(this, i, this.t0, 0, this.track(i?.trk))); }
  /** Track gain node following its timeline volume automation (scheduled per step). */
  track(k?: string): AudioNode {
    const def = k ? this.ev.tracks?.[k] : undefined;
    if (!def) return this.out;
    let n = this.tracks.get(k!);
    if (!n) { n = ctx!.createGain(); n.gain.value = gain(curveAt(def[1], 0)); n.connect(this.track(def[0])); this.tracks.set(k!, n); }
    return n;
  }
  /** Track automation over the cursor segment p (time t) → p2 (t2). */
  automate(p: number, t: number, p2: number, t2: number) {
    for (const [k, n] of this.tracks) {
      const pts = this.ev.tracks![k][1];
      if (t >= this.trackHold) n.gain.setValueAtTime(gain(curveAt(pts, p)), t);
      if (t2 > this.trackHold) n.gain.linearRampToValueAtTime(gain(curveAt(pts, p2)), t2);
    }
  }
  pos(t: number) { return this.pos0 + (t - this.t0) * RATE; }
  voices() { return [...this.placed.values(), ...this.loose, ...this.sheetOn.values()]; }
  update() {
    // re-entry (a command instrument setting a parameter mid-step): run again once this pass is done
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try { this.pass(); } finally { this.busy = false; }
    if (this.again) { this.again = false; queueMicrotask(() => this.update()); }
  }
  pass() {
    if (this.done || !ctx) return;
    const now = ctx.currentTime;
    for (const v of this.loose) if (!v.alive()) this.loose.delete(v);
    for (const [v, f] of this.autos) if (v.alive()) f(); else this.autos.delete(v);
    if (!this.stopped) {
      if (this.t0 < 0) { this.t0 = this.schedT = now + 0.02; this.startActions(); }
      const get = (n: string) => this.get(n);
      for (const i of this.ev.sheet ?? []) { // parameter-sheet instruments: triggered while their condition holds
        if (!i) continue;
        const on = !i.cond || testCond(i.cond, get), v = this.sheetOn.get(i);
        if (on && !v) this.sheetOn.set(i, voice(this, i, Math.max(now, this.t0), 0, this.track(i.trk)));
        else if (!on && v) { v.untrigger(now); this.loose.add(v); this.sheetOn.delete(i); }
      }
      for (let n = 0; this.cursor && this.schedT < now + AHEAD && n < 64; n++) this.step(now + AHEAD);
    }
    if (!this.cursor && !this.voices().some((v) => v.alive())) this.dispose();
  }
  step(horizon: number) {
    const t = this.schedT, p = this.schedP, len = this.ev.len ?? 0;
    if (this.jumpT !== t) { this.jumpT = t; this.jumpN = 0; }
    // re-stepped from the destination at the same time; a jump cycle without time passing stops after a few hops
    if (this.jumpN < 8 && this.jumps(p, t)) { this.jumpN++; return; }
    this.trigger(p, t);
    this.lastP = p;
    if (p >= len) { this.cursor = false; return; }
    let nb = len;
    const cons = (x: number) => { if (x > p && x < nb) nb = x; };
    for (const [, s, l] of this.allPlaced) { cons(s); cons(s + l); }
    for (const tr of this.ev.tr ?? []) cons(tr[1]);
    for (const [, pts] of Object.values(this.ev.tracks ?? {})) for (const [x] of pts) cons(x);
    if (this.pend) cons(this.pend.pos);
    const tb = this.t0 + (nb - this.pos0) / RATE;
    if (tb <= horizon) { this.schedT = tb; this.schedP = nb; } else { this.schedT = horizon; this.schedP = this.pos(horizon); }
    this.automate(p, t, this.schedP, this.schedT);
  }
  /** Transitions at position p (time t): markers / loop ends crossed, pending quantized jumps, regions whose condition holds. */
  jumps(p: number, t: number): boolean {
    const get = (n: string) => this.get(n), ok = (tr: Tr) => !tr[4]?.cond || testCond(tr[4].cond, get);
    const dest = (tr: Tr, x: number) => (tr[0] === 4 ? tr[3] + x - tr[1] : tr[3]);
    if (this.pend && this.pend.pos <= p) { const tr = this.pend.tr; this.pend = null; if (ok(tr)) return this.jump(t, dest(tr, p), tr[4]); }
    for (const tr of this.ev.tr ?? []) {
      const [kind, from, to] = tr;
      if (kind === 1 || kind === 2) { if (this.lastP < from && from <= p && ok(tr)) return this.jump(t, dest(tr, p), tr[4]); continue; }
      if (p < from || p > to || !ok(tr)) continue;
      if (!tr[4]?.q) return this.jump(t, dest(tr, p), tr[4]);
      const g = this.grid(p, tr[4].q);
      if (g <= to && (!this.pend || g < this.pend.pos)) this.pend = { pos: g, tr };
    }
    return false;
  }
  /** Next quantization point (unit 1 beat, 2 bar — inferred) from the tempo markers. */
  grid(p: number, [unit, n]: [number, number]): number {
    const tm = (this.ev.tempo ?? []).filter((x) => x[0] <= p).pop() ?? this.ev.tempo?.[0];
    if (!tm) return p;
    const step = (RATE * 60 / tm[1]) * (unit === 2 ? tm[2] : 1) * Math.max(1, n);
    return tm[0] + Math.ceil((p - tm[0]) / step - 1e-6) * step;
  }
  jump(t: number, d: number, x?: Tr[4]): true {
    const fade = x?.fade ?? 0;
    const f = Math.max(fade / RATE, 0.005);
    for (const [pl, v] of [...this.placed]) {
      const sync = this.syncSet.has(pl);
      if (!sync && d >= pl[1] && d < pl[1] + pl[2]) continue; // async instruments still under the cursor keep playing
      if (sync) v.end(t, f); else v.untrigger(t);
      this.loose.add(v); this.placed.delete(pl);
    }
    this.pos0 = this.schedP = this.lastP = d; this.t0 = this.schedT = t; this.pend = null; this.fadeIn = fade ? f : 0;
    for (const [k, n] of this.tracks) { // tracks move to their level at the destination over the transition
      n.gain.cancelScheduledValues(t);
      n.gain.linearRampToValueAtTime(gain(curveAt(this.ev.tracks![k][1], d + f * RATE)), t + f);
    }
    this.trackHold = t + f;
    for (const [ins, s, l] of x?.ins ?? []) { // transition timeline: stingers, set-parameter commands
      const v = voice(this, ins, t + s / RATE, 0, this.track(ins?.trk));
      v.end(t + (s + l) / RATE, 0.005);
      this.loose.add(v);
    }
    return true;
  }
  trigger(p: number, t: number) {
    const get = (n: string) => this.get(n);
    for (const pl of this.allPlaced) {
      const [ins, s, l] = pl, sync = this.syncSet.has(pl), v = this.placed.get(pl);
      const want = !!ins && p >= s && p < s + l && (!ins.cond || testCond(ins.cond, get));
      if (want && !v) this.placed.set(pl, voice(this, ins, t, sync ? (p - s) / RATE : 0, this.track(ins.trk), 1, sync ? this.fadeIn : 0, sync));
      else if (!v && ins && s > p && s < p + 10 * RATE) prefetch(this, ins); // decode what the cursor reaches soon
      else if (!want && v) { if (sync) v.end(t, 0.005); else v.untrigger(t); this.loose.add(v); this.placed.delete(pl); }
    }
    this.fadeIn = 0;
  }
  /** fade: FMOD_STUDIO_STOP_ALLOWFADEOUT (AHDSR releases play out), else STOP_IMMEDIATE. */
  stop(fade: boolean, t = ctx?.currentTime ?? 0) {
    if (this.stopped || this.done) return;
    this.stopped = true; this.cursor = false;
    const rel = fade ? (this.ev.rel ?? 0) / 1000 : 0;
    for (const v of this.voices()) if (fade && !rel) v.fadeOut(t); else v.end(t, rel || 0.01);
  }
  dispose() {
    this.done = true; live.delete(this);
    setTimeout(() => this.out.disconnect(), 100);
    // music / ambience stems are minutes of PCM: drop them once no live instance uses them
    for (const f of this.files) buffers.get(f)?.then((b) => { if (b && b.duration > 20 && ![...live].some((i) => i.files.has(f))) buffers.delete(f); });
  }
}
function setGlobal(n: string, v: number) { globals.set(n, v); for (const i of [...live]) i.update(); }
function startEvent(path: string, volume = 1, params?: Record<string, number>): Instance | null {
  const ev = db?.events[path], c = ensureCtx();
  if (!ev || !c) return null;
  const i = new Instance(path, ev, bus[ev.bus]!, null, volume);
  for (const [k, v] of Object.entries(params ?? {})) i.params.set(k, v);
  queueMicrotask(() => i.update()); // like FMOD's next update: parameters set right after the start call apply first
  return i;
}
const fellBack = new Set<string>();
function fallback(event: string): string[][] {
  if (!fellBack.has(event)) { fellBack.add(event); console.info(`[audio] ${event}: not in events.json, sample-name match`); }
  return matchSfx(event);
}
/** Parameter label (FMOD set_parameter_by_name_with_label) or value. */
const paramValue = (n: string, v: number | string) => (typeof v === 'number' ? v : Math.max(0, db?.params[n]?.labels?.indexOf(v) ?? 0));

/** event path → sample groups: one group per top-level instrument (events.json), else the name-matching fallback. */
export function resolveSfx(event: string): string[][] {
  const ev = db?.events[event];
  if (!ev) return matchSfx(event);
  const seen = new Set<string>();
  const walk = (i: Ins | null, acc: string[]): string[] => {
    if (!i) return acc;
    if (i.f) acc.push(i.f);
    for (const x of i.pl ?? []) walk(x, acc);
    const n = i.ev && !seen.has(i.ev) && (seen.add(i.ev), db!.events[i.ev] ?? db!.nested[i.ev]);
    if (n) for (const x of [...(n.action ?? []), ...(n.sheet ?? []), ...[...(n.sync ?? []), ...(n.async ?? [])].map((p) => p[0])]) walk(x, acc);
    return acc;
  };
  return [...(ev.action ?? []), ...(ev.sheet ?? []), ...[...(ev.sync ?? []), ...(ev.async ?? [])].map((p) => p[0])].map((i) => walk(i, [])).filter((g) => g.length);
}
/** Page-side inspection (window.__audio()): running instances, their timeline positions and parameters, sounding samples. */
export function audioState() {
  const t = ctx?.currentTime ?? 0;
  return {
    ctx: ctx?.state ?? 'none', time: t, globals: Object.fromEntries(globals), music: musicPath, ambience: ambPath,
    loops: [...loops.keys()], fallbacks: [...fellBack],
    instances: [...live].map((i) => ({ path: i.path, bus: i.ev.bus, nested: !!i.parent, stopped: i.stopped, pos: i.t0 < 0 ? 0 : +(i.pos(t) / RATE).toFixed(2), params: Object.fromEntries(i.params),
      tracks: Object.fromEntries([...i.tracks].map(([k, n]) => [k, +n.gain.value.toFixed(3)])) })),
    sounding: [...sounding].filter(([, n]) => n > 0).map(([f]) => f),
  };
}
/** tools/fmod_events.mjs: what an event triggers at its start for the given parameters. */
export function describeEvent(path: string, params: Record<string, number> = {}): string[] {
  const ev = db?.events[path];
  if (!ev) return [`${path}: not in events.json`];
  const get = (n: string) => params[n] ?? globals.get(n) ?? db!.params[n]?.default ?? 0;
  const show = (i: Ins | null): string => !i ? 'silence' : [i.cond ? `${testCond(i.cond, get) ? 'ON ' : 'off'} ${JSON.stringify(i.cond)}` : '',
    i.vol ? `${i.vol} dB` : '', i.auto ? `auto ${i.auto.map(([n, p]) => `${n}=${get(n)}→${curveAt(p, get(n))} dB`).join(' ')}` : '', i.loop ? 'loop' : '', i.rp ? `±${i.rp / 2} st` : '', i.rv ? `-${i.rv} dB rnd` : '', i.sc ? `scatter ${JSON.stringify(i.sc)}` : '',
    i.set ? `set ${i.set.join('=')}` : '', i.f ?? '', i.ev ? `event ${i.ev}` : '', i.pl ? `${['sequential', 'random', 'shuffle'][i.mode ?? 0]} [${i.pl.map(show).join(' | ')}]` : ''].filter(Boolean).join(' ');
  const sec = (x: number) => `${(x / RATE).toFixed(2)}s`;
  return [`${path} → bus ${ev.bus}${ev.len ? `, timeline ${sec(ev.len)}` : ''}`,
    ...(ev.action ?? []).map((i) => `  action ${show(i)}`), ...(ev.sheet ?? []).map((i) => `  sheet ${show(i)}`),
    ...(ev.sync ?? []).map(([i, s, l]) => `  sync ${sec(s)}+${sec(l)} ${show(i)}`), ...(ev.async ?? []).map(([i, s, l]) => `  async ${sec(s)}+${sec(l)} ${show(i)}`),
    ...(ev.tr ?? []).filter((tr) => !tr[4]?.cond || testCond(tr[4].cond, get)).map((tr) => `  ${['region', 'marker', 'loop', '', 'region(rel)'][tr[0]]} ${sec(tr[1])}${tr[2] !== tr[1] ? '-' + sec(tr[2]) : ''} → ${sec(tr[3])}${tr[4]?.q ? ' q' + tr[4].q : ''}`)];
}

export function playOneShot(event: string, volume = 1, params?: Record<string, number>) {
  if (!event) return;
  if (startEvent(event, volume, params)) return;
  for (const g of fallback(event)) play(pick(g), bus.sfx, { volume });
}
// audio_manager_proxy.gd: every play_loop starts another instance of the event; stop_loop / set_param act on the oldest one
const loops = new Map<string, { i: Instance | null; h: Handle[]; loopParam: boolean }[]>();
export function playLoop(event: string, usesLoopParam = true) {
  if (!event) return;
  const i = startEvent(event), h = i ? [] : fallback(event).map((g) => play(pick(g), bus.sfx, { loop: true })).filter(Boolean) as Handle[];
  (loops.get(event) ?? loops.set(event, []).get(event)!).push({ i, h, loopParam: usesLoopParam });
}
export function stopLoop(event: string) {
  const arr = loops.get(event), inst = arr?.shift();
  if (!inst) return;
  if (!arr!.length) loops.delete(event);
  // usesLoopParam: set_parameter_by_name("loop", 1) lets the event leave its loop region; otherwise stop(1) = STOP_IMMEDIATE
  if (inst.i) { if (inst.loopParam) inst.i.setParam('loop', 1); else inst.i.stop(false); }
  for (const h of inst.h) fadeOut(h, inst.loopParam ? 0.3 : 0);
}
export function stopAllLoops() { for (const [k, arr] of [...loops]) for (let i = arr.length; i > 0; i--) stopLoop(k); }
/** audio_manager_proxy.set_param: a parameter of the oldest running loop of that event. */
export function setLoopParam(event: string, name: string, value: number) { loops.get(event)?.[0]?.i?.setParam(name, value); }

// ------------------------------------------------------------------ music / ambience (one instance each, like the proxies)
let music: Instance | null = null, musicPath = '';
export function playMusic(event: string) {
  if (musicPath === event && music && !music.stopped) return;
  stopMusic();
  musicPath = event;
  music = startEvent(event);
  if (!music && event) fallback(event);
}
/** stop(0) = FMOD_STUDIO_STOP_ALLOWFADEOUT */
export function stopMusic() { music?.stop(true); music = null; musicPath = ''; }
/** Global "Progress" (NRunMusicController.MusicProgressTrack: Init, Enemy, Merchant, Rest, Unknown, Treasure, Elite, CombatEnd, Elite2, MerchantEnd). */
export function setMusicProgress(progress: number) { setGlobal('Progress', progress); }
/** update_music_parameter: a local parameter of the music event (value or label). */
export function setMusicParam(name: string, value: number | string) { music?.setParam(name, paramValue(name, value)); }
/** NAudioManager.UpdateMusicParameter("menu_progress", …) on menu_update. */
export function setMenuProgress(p: 'main' | 'timeline') { setMusicParam('menu_progress', p); }

let amb: Instance | null = null, ambPath = '', ambH: Handle[] = [];
export function setAmbience(event: string) {
  if (ambPath === event) return;
  amb?.stop(true); amb = null;
  for (const h of ambH) fadeOut(h, 2);
  ambPath = event;
  amb = event ? startEvent(event) : null;
  ambH = event && !amb ? fallback(event).map((g) => play(pick(g), bus.amb, { loop: true })).filter(Boolean) as Handle[] : [];
}
/** update_campfire_ambience: the act ambience's "Campfire" parameter (NRunMusicController.CampfireState: 0 On, 1 Off). */
export function setCampfire(state: number) { amb?.setParam('Campfire', state); }
export function stopAmbience() { setAmbience(''); }

// ------------------------------------------------------------------ NDebugAudioManager: plain files from res://debug_audio
let debugIndex: Promise<Record<string, string[]>> | null = null;
let debugId = 0;
const debugPlaying = new Map<number, Handle>();
/** NDebugAudioManager.GetRandomPitchScale: PitchVariance None / Small / Medium / Large / TooMuch → 1 ± 0, 0.02, 0.05, 0.1, 0.2. */
const PITCH = [0, 0.02, 0.05, 0.1, 0.2];
export function playDebug(name: string, volume = 1, variance = 0): number {
  const id = ++debugId;
  const k = PITCH[variance] ?? 0, rate = k ? 1 + (Math.random() * 2 - 1) * k : 1; // AudioStreamPlayer.PitchScale
  (debugIndex ??= fetch(BASE + 'debug/index.json').then((r) => r.json()).catch(() => ({}))).then((idx) => {
    const files = idx[name] ?? [];
    const h = files.length ? play('debug/' + pick(files), bus.sfx, { volume, rate }) : null;
    if (h) debugPlaying.set(id, h);
  });
  return id;
}
export function stopDebug(id: number, fade = 0.5) { fadeOut(debugPlaying.get(id) ?? null, fade); debugPlaying.delete(id); }
