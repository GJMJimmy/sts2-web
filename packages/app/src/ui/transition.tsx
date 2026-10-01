// NTransition (NGame's GameTransitionRect, above the whole run): between rooms a soft-edged black gradient sweeps down
// over the screen while a flat black fades in (RoomFadeOut); the next room fades the flat black out (RoomFadeIn).
// Instant mode hides the rect (FadeOut / FadeIn set Visible = false there), though RoomFadeIn still waits out its
// tween. The rect is 2560 × 1200 at (−320, −60); the gradient texture (transparent at the bottom,
// opaque from 57.5 % up) is 2400 tall and slides from y −2564 to 0 inside it.
// The rect itself (GameTransitionRect, black) draws through its material: fade_transition (alpha = threshold) or a
// character's texture_transition wipe (alpha = step(1 − tex.r, mix(−0.1, 1.1, threshold))), for FadeOut / FadeIn
// between the main menu and a run.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'preact/hooks';
import { G, $ } from '../game';
import { imageUrl } from '../assets';

const TR = { Quad: 4 }, EZ = { In: 0, Out: 1 };
const FADE = 'res://materials/transitions/fade_transition_mat.tres';
const s = { GradY: -2564, GradA: 0, SimpleA: 0, visible: true, Th: 0, mat: FADE };
let tween: any = null;
let paint: (() => void) | null = null;
let wipe: { path: string; w: Wipe | null } | null = null;
/** materials/transitions/<x>_transition_mat → its texture (Defect and Regent use Ironclad's). */
const wipeTexture = (mat: string) => {
  const id = /(\w+)_transition_mat/.exec(mat)?.[1] ?? '';
  return `images/ui/transitions/${['silent', 'necrobinder', 'fight', 'game_over'].includes(id) ? id : 'ironclad'}_transition.png`;
};
/** Frame-driven threshold loop of NTransition.FadeOut / FadeIn (threshold per process frame, not a tween). */
function thresholdLoop(time: number, f: (left: number) => number, onProgress?: (k: number) => void): Promise<void> {
  let t = 0;
  return new Promise((done) => $.onFrame((dt: number) => {
    if (t >= time) { done(); return false; }
    s.Th = f(time - t);
    t += dt;
    onProgress?.(t / time);
    paint?.();
    return true;
  }));
}
const fastMode = () => { try { return G.SaveManager.Instance.PrefsSave.FastMode; } catch { return G.FastModeType.Normal; } };
function play(t: any): Promise<void> {
  tween = t;
  const stop = $.onFrame(() => { paint?.(); return t === tween && t.IsValid(); });
  return new Promise((done) => t.whenFinished(() => { stop(); paint?.(); done(); }));
}

export const transitionView = {
  InTransition: false,
  async RoomFadeOut() {
    this.InTransition = true;
    const F = G.FastModeType, mode = fastMode();
    if (mode === F.Instant) { s.visible = false; return; }
    s.visible = true;
    s.SimpleA = 0; s.GradA = 1; s.GradY = -2564;
    tween?.Kill();
    const t = new $.WebTween().SetParallel();
    if (mode === F.Normal) {
      t.TweenProperty(s, 'grad_y', 0, 0.6).SetDelay(0.5);
      t.TweenProperty(s, 'simple_a', 1, 0.6).SetDelay(0.5);
    } else if (mode === F.Fast) t.TweenProperty(s, 'simple_a', 1, 0.3).SetEase(EZ.Out).SetTrans(TR.Quad).SetDelay(0.3);
    else t.TweenInterval(0);
    await play(t);
  },
  async RoomFadeIn(_showTransition = true) {
    const F = G.FastModeType, mode = fastMode();
    s.visible = mode !== F.Instant;
    s.Th = 0;
    s.GradA = 0;
    s.SimpleA = 1; // unconditionally, as the original does after its showTransition check
    tween?.Kill();
    const t = new $.WebTween().SetParallel();
    if (mode === F.Fast) t.TweenProperty(s, 'simple_a', 0, 0.3);
    else {
      t.TweenProperty(s, 'simple_a', 0, 0.8);
      t.TweenCallback(() => { this.InTransition = false; }).SetDelay(0.2);
    }
    await play(t);
    this.InTransition = false;
  },
  /** NTransition.FadeOut: the flat black fades in (QuadIn) while the material's threshold runs 1 − (time − t). */
  async FadeOut(time = 0.8, mat = FADE) {
    this.InTransition = true;
    if (fastMode() === G.FastModeType.Instant) { s.visible = false; paint?.(); return; }
    s.visible = true;
    s.SimpleA = 0;
    tween?.Kill();
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(s, 'simple_a', 1, time).SetEase(EZ.In).SetTrans(TR.Quad);
    void play(t);
    if (s.Th === 1) return;
    setMat(mat);
    s.Th = 0;
    await thresholdLoop(time, (left) => 1 - left);
    s.Th = 1;
    paint?.();
  },
  /** NTransition.FadeIn: the flat black goes; the material's threshold runs CubicIn(time − t) down to 0. */
  async FadeIn(time = 0.8, mat = FADE) {
    if (fastMode() === G.FastModeType.Instant) { s.visible = false; this.InTransition = false; paint?.(); return; }
    tween?.Kill();
    s.SimpleA = 0;
    if (s.Th === 0) { this.InTransition = false; paint?.(); return; }
    setMat(mat);
    s.Th = 1;
    await thresholdLoop(time, (left) => left * left * left, (k) => { if (k > 0.75) this.InTransition = false; });
    this.InTransition = false;
    s.Th = 0;
    paint?.();
  },
};
function setMat(mat: string) {
  s.mat = mat;
  if (mat === FADE || wipe?.path === mat) return;
  const w: { path: string; w: Wipe | null } = (wipe = { path: mat, w: null });
  void textureWipe(wipeTexture(mat), [0, 0, 0], 255).then((x) => { w.w = x; paint?.(); });
}

export interface Wipe { canvas: HTMLCanvasElement; draw: (t: number) => void }
/** texture_transition's alpha = step(1 − r, mix(−0.1, 1.1, t)) · `a` in colour `rgb`, on a canvas the texture's size. */
export function textureWipe(path: string, rgb: number[], a: number): Promise<Wipe | null> {
  return new Promise((done) => {
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth, h = im.naturalHeight;
      const src = document.createElement('canvas');
      src.width = w; src.height = h;
      const sg = src.getContext('2d', { willReadFrequently: true })!;
      sg.drawImage(im, 0, 0);
      const r = sg.getImageData(0, 0, w, h).data;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d')!;
      const out = g.createImageData(w, h), o = out.data;
      for (let i = 0; i < o.length; i += 4) { o[i] = rgb[0]; o[i + 1] = rgb[1]; o[i + 2] = rgb[2]; }
      done({ canvas, draw: (t) => {
        const remap = -0.1 + 1.2 * t;
        for (let i = 0; i < o.length; i += 4) o[i + 3] = 1 - r[i] / 255 <= remap ? a : 0;
        g.putImageData(out, 0, 0);
      } });
    };
    im.onerror = () => done(null);
    im.src = imageUrl(path) ?? '';
  });
}

/** The curtain, drawn above the run UI. It blocks input while opaque (MouseFilter.Stop after a fade out). */
export function TransitionLayer() {
  const grad = useRef<HTMLDivElement>(null), flat = useRef<HTMLDivElement>(null), rect = useRef<HTMLDivElement>(null);
  useEffect(() => {
    paint = () => {
      if (grad.current) { grad.current.style.opacity = String(s.GradA); grad.current.style.transform = `translateY(${s.GradY}px)`; }
      if (flat.current) flat.current.style.opacity = String(s.SimpleA);
      // the rect's own material: fade = alpha threshold; a wipe texture = its canvas redrawn at the threshold
      const w = s.mat !== FADE ? wipe?.w : null;
      const el = rect.current;
      if (el) {
        el.style.background = s.mat === FADE ? `rgba(0, 0, 0, ${Math.min(1, s.Th)})` : 'none';
        if (w && w.canvas.parentElement !== el) { el.replaceChildren(w.canvas); w.canvas.className = 'transition-wipe'; }
        if (!w) el.replaceChildren();
        if (w) w.draw(s.Th);
      }
      const shown = s.Th > 0 && (s.mat === FADE || !!w);
      const root = grad.current?.parentElement;
      if (root) root.style.visibility = s.visible && (shown || s.GradA > 0 || s.SimpleA > 0) ? 'visible' : 'hidden';
      if (root) root.style.pointerEvents = s.visible && s.Th >= 1 ? 'auto' : 'none'; // MouseFilter.Stop after a FadeOut
    };
    paint();
    return () => { paint = null; };
  }, []);
  return (
    <div class="viewport transition-viewport">
      <div class="stage-root transition-root">
        <div class="transition-rect">
          <div class="transition-mat" ref={rect} />
          <div class="transition-gradient" ref={grad} />
          <div class="transition-flat" ref={flat} />
        </div>
      </div>
    </div>
  );
}
