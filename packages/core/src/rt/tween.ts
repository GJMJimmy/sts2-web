// Godot's frame loop and Tween, for the rule layer's node choreography (CardPileCmd waits on its card tweens) and the
// web views that stand in for the scene nodes. Property tweens write the target's properties every frame.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------------ process frames
const frameFns = new Set<(dt: number) => boolean | void>();
let pending = false, last = 0;
/** Engine.TimeScale for process frames (NHitStop): every frame callback gets the scaled delta. */
let engineScale = 1;
export function setEngineTimeScale(s: number) { engineScale = s; }
const schedule = (f: (now: number) => void) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(() => f(performance.now()), 16);
function loop(now: number) {
  const dt = (last ? Math.max(0, (now - last) / 1000) : 1 / 60) * engineScale;
  last = now;
  for (const f of [...frameFns]) {
    let keep: boolean | void;
    try { keep = f(dt); } catch (e) { console.error(e); keep = false; }
    if (keep === false) frameFns.delete(f);
  }
  if (frameFns.size) schedule(loop);
  else { pending = false; last = 0; }
}
/** Run `f(delta)` every process frame until it returns false (or the returned stop function is called). */
export function onFrame(f: (dt: number) => boolean | void): () => void {
  frameFns.add(f);
  if (!pending) { pending = true; schedule(loop); }
  return () => { frameFns.delete(f); };
}

// ------------------------------------------------------------------ easing (Tween.TransitionType × Tween.EaseType)
const PI = Math.PI;
function bounceOut(t: number) {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}
function springOut(t: number) {
  const s = 1 - t;
  return (Math.sin(t * PI * (0.2 + 2.5 * t * t * t)) * Math.pow(s, 2.2) + t) * (1 + 1.2 * s);
}
/** Ease-in curves, in TransitionType order (LINEAR, SINE, QUINT, QUART, QUAD, EXPO, ELASTIC, CUBIC, CIRC, BOUNCE, BACK, SPRING). */
const IN: ((t: number) => number)[] = [
  (t) => t,
  (t) => 1 - Math.cos((t * PI) / 2),
  (t) => t ** 5,
  (t) => t ** 4,
  (t) => t * t,
  (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)) - 0.001),
  (t) => (t === 0 || t === 1 ? t : -(Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1 - 0.075) * 2 * PI) / 0.3))),
  (t) => t ** 3,
  (t) => -(Math.sqrt(1 - t * t) - 1),
  (t) => 1 - bounceOut(1 - t),
  (t) => t * t * (2.70158 * t - 1.70158),
  (t) => 1 - springOut(1 - t),
];
/** Tween.InterpolateValue's easing: trans (TransitionType), ease (EaseType IN, OUT, IN_OUT, OUT_IN). */
export function ease(trans: number, easeType: number, t: number): number {
  const fin = IN[trans] ?? IN[0];
  const fout = trans === 9 ? bounceOut : trans === 11 ? springOut : (x: number) => 1 - fin(1 - x);
  switch (easeType) {
    case 0: return fin(t);
    case 1: return fout(t);
    case 3: return t < 0.5 ? fout(t * 2) / 2 : fin(t * 2 - 1) / 2 + 0.5;
    default: return t < 0.5 ? fin(t * 2) / 2 : fout(t * 2 - 1) / 2 + 0.5;
  }
}

// ------------------------------------------------------------------ property paths ("position", "modulate:a", …)
const pascal = (s: string) => s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
function getPath(obj: any, path: string) {
  const [p, sub] = String(path).split(':');
  const v = obj?.[pascal(p)];
  return sub ? v?.[sub.toUpperCase()] : v;
}
function setPath(obj: any, path: string, value: any) {
  const [p, sub] = String(path).split(':');
  const key = pascal(p);
  if (!sub) { obj[key] = value; return; }
  const cur = obj[key];
  const next = cur?.$clone ? cur.$clone() : { ...cur };
  next[sub.toUpperCase()] = value;
  obj[key] = next;
}
function mix(a: any, b: any, t: number): any {
  if (typeof b === 'number' || typeof a === 'number') return (a ?? 0) + ((b ?? 0) - (a ?? 0)) * t;
  if (b && 'R' in b) { const C = b.constructor; return new C(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t, a.A + (b.A - a.A) * t); }
  if (b && 'X' in b) { const V = b.constructor; return new V(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t); }
  return t < 1 ? a : b;
}
function plus(a: any, b: any): any {
  if (typeof b === 'number') return (a ?? 0) + b;
  if (b && 'R' in b) { const C = b.constructor; return new C(a.R + b.R, a.G + b.G, a.B + b.B, a.A + b.A); }
  if (b && 'X' in b) { const V = b.constructor; return new V(a.X + b.X, a.Y + b.Y); }
  return b;
}
const call = (c: any, ...a: any[]) => (typeof c === 'function' ? c(...a) : c?.Call?.(...a));

// ------------------------------------------------------------------ Tween
/** One tweener: starts `delay` after its step begins and runs for `dur` seconds. */
class Tweener {
  delay = 0;
  trans: number | undefined;
  easeType: number | undefined;
  from: any = undefined;
  relative = false;
  begun = false;
  ended = false;
  constructor(public tween: WebTween, public dur: number, public begin: () => void, public run: (t: number) => void) {}
  SetDelay(d: number) { this.delay = d; return this; }
  SetTrans(t: number) { this.trans = t; return this; }
  SetEase(e: number) { this.easeType = e; return this; }
  From(v: any) { this.from = v; return this; }
  FromCurrent() { this.from = FROM_CURRENT; return this; }
  AsRelative() { this.relative = true; return this; }
  eased(t: number) { return ease(this.trans ?? this.tween.trans, this.easeType ?? this.tween.easeType, t); }
}
const FROM_CURRENT = Symbol('current');

/**
 * Godot 4 Tween: tweeners run one step after another; SetParallel / Parallel() join the previous step, Chain() starts
 * a new one. It starts on the next frame (or Play()), and is invalid once finished or killed.
 */
export class WebTween {
  private steps: Tweener[][] = [];
  private par = false;
  private joinNext = false;
  private chainNext = false;
  private idx = 0;
  private stepTime = 0;
  private state: 'running' | 'paused' | 'done' | 'dead' = 'running';
  private started = false;
  private waiters: (() => void)[] = [];
  trans = 0;
  easeType = 2;
  /** Tween.Finished (C# event). */
  Finished: any = null;
  constructor() {
    queueMicrotask(() => this.start());
  }
  private start() {
    if (this.started || this.state !== 'running') return;
    this.started = true;
    onFrame((dt) => this.advance(dt));
  }
  private add(tw: Tweener) {
    const join = this.steps.length > 0 && !this.chainNext && (this.joinNext || this.par);
    if (join) this.steps[this.steps.length - 1].push(tw);
    else this.steps.push([tw]);
    this.joinNext = this.chainNext = false;
    return tw;
  }
  /** Step the tween by dt seconds; false once it has finished (or was killed). */
  private advance(dt: number): boolean {
    if (this.state === 'dead' || this.state === 'done') return false;
    if (this.state === 'paused') return true;
    let rem = dt;
    while (this.idx < this.steps.length) {
      const step = this.steps[this.idx];
      this.stepTime += rem;
      let len = 0, open = false;
      for (const tw of step) {
        len = Math.max(len, tw.delay + tw.dur);
        const local = this.stepTime - tw.delay;
        if (tw.ended || local < 0) { open ||= !tw.ended; continue; }
        try {
          if (!tw.begun) { tw.begun = true; tw.begin(); }
          tw.run(tw.dur > 0 ? Math.min(1, local / tw.dur) : 1);
        } catch (e) { console.error('[tween]', e); }
        if (local >= tw.dur) tw.ended = true;
        else open = true;
        if ((this.state as string) === 'dead') return false; // a callback killed it
      }
      if (open) return true;
      rem = Math.max(0, this.stepTime - len);
      this.stepTime = 0;
      this.idx++;
    }
    this.finish();
    return false;
  }
  private finish() {
    this.state = 'done';
    call(this.Finished);
    for (const w of this.waiters.splice(0)) w();
  }
  /** Resolves when the tween finishes (never, if it is killed first). */
  whenFinished(done: () => void) {
    if (this.state === 'done') done();
    else this.waiters.push(done);
  }

  TweenProperty(obj: any, path: any, final: any, dur: number) {
    const p = String(path), atCreation = getPath(obj, p);
    let from: any, to: any;
    const tw: Tweener = new Tweener(this, dur, () => {
      from = tw.from === FROM_CURRENT ? atCreation : tw.from === undefined ? getPath(obj, p) : tw.from;
      to = tw.relative ? plus(from, final) : final;
    }, (t) => setPath(obj, p, mix(from, to, tw.eased(t))));
    return this.add(tw);
  }
  TweenMethod(method: any, from: any, to: any, dur: number) {
    const tw: Tweener = new Tweener(this, dur, () => {}, (t) => call(method, mix(from, to, tw.eased(t))));
    return this.add(tw);
  }
  TweenCallback(cb: any) {
    return this.add(new Tweener(this, 0, () => call(cb), () => {}));
  }
  TweenInterval(d: number) {
    return this.add(new Tweener(this, d, () => {}, () => {}));
  }
  SetParallel(p = true) { this.par = p; return this; }
  Parallel() { this.joinNext = true; return this; }
  Chain() { this.chainNext = true; return this; }
  SetTrans(t: number) { this.trans = t; return this; }
  SetEase(e: number) { this.easeType = e; return this; }
  SetLoops() { return this; } // ponytail: loops unsupported (the rule layer never loops a tween)
  SetProcessMode() { return this; }
  SetPauseMode() { return this; }
  SetIgnoreTimeScale() { return this; }
  SetSpeedScale() { return this; }
  BindNode() { return this; }
  Play() {
    if (this.state === 'paused') this.state = 'running';
    this.start();
  }
  Pause() { if (this.state === 'running') this.state = 'paused'; }
  Stop() { this.Pause(); this.idx = 0; this.stepTime = 0; for (const s of this.steps) for (const tw of s) tw.begun = tw.ended = false; }
  Kill() { if (this.state !== 'done') this.state = 'dead'; }
  IsValid() { return this.state === 'running' || this.state === 'paused'; }
  IsRunning() { return this.state === 'running'; }
  /** Tween.CustomStep (TweenHelper.FastForwardToCompletion steps 999 s). */
  CustomStep(dt: number) {
    if (!this.IsValid()) return false;
    const was = this.state;
    this.state = 'running';
    const alive = this.advance(dt);
    if (alive && was === 'paused') this.state = 'paused';
    return alive;
  }
  GetTotalElapsedTime() { return 0; }
  /** GodotObject.ToSignal (tween.ToSignal(tween, Finished)); rt/godot.ts installs the implementation. */
  ToSignal(src: any, sig: any) { return WebTween.toSignal(src, sig); }
  static toSignal: (src: any, sig: any) => any = () => null;
}
