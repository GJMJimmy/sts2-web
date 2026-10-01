// NScreenShake (game.tscn's ScreenShake node): the punch (NGame.ScreenShake), the rumble (ScreenRumble) and the
// persistent trauma (ScreenShakeTrauma) offsets, combined every frame and written as a translation of the current
// room's shake target — the elements marked `data-shake` (combat: the stage and the creatures, i.e.
// CombatSceneContainer; the HUD, hand, top bar and combat VFX stay still). Offsets are in 1920×1080 design px.
// Also NHitStop (NGame.DoHitStop): the engine time scale dip.
import { Ticker } from 'pixi.js';
import { G, $ } from '../game';
import { getApp } from '../render/stage';
import { godotNoise } from '../render/noise';

const perlin = new Map<number, (x: number, y: number) => number>();
/**
 * FastNoiseLite.GetNoise1D(x) of a `new FastNoiseLite()` set to Perlin (Godot's default FBM: 5 octaves, lacunarity 2,
 * gain 0.5) with frequency 1 (callers scale x by theirs) and the given Seed.
 */
export function noise(x: number, seed = 0) {
  let n = perlin.get(seed);
  if (!n) perlin.set(seed, (n = godotNoise({ noise_type: 3, seed, frequency: 1 }).get2d));
  return n(x, 0);
}
const F = Math.fround; // the C# float arithmetic on the noise inputs

// NScreenShake._Ready tables, by ShakeStrength (None..TooMuch) and ShakeDuration (None..Forever)
const STRENGTH = [0, 2, 5, 20, 40, 80];
const TRAUMA = [0, 0.07, 0.2, 0.4, 0.6, 1];
const DURATION = [0, 0.3, 0.8, 1.2, 999999];
/** NScreenshakePaginator.GetShakeMultiplier: None / Some / Normal / Lots / CAAAW. */
const multiplier = () => [0, 0.5, 1, 2, 4][G.SaveManager.Instance?.PrefsSave?.ScreenShakeOptionIndex ?? 2] ?? 1;
const cubicOut = (p: number) => (p - 1) ** 3 + 1;

let punch: { a: number; t: number; r: number; dx: number; dy: number } | null = null;
let rumble: { a: number; t: number; r: number; seed: number; freq: number; drunk: boolean; ox: number; oy: number } | null = null;
let trauma = 0, traumaMs = 0;
const traumaSeed = Math.floor(Math.random() * 999999); // ScreenTraumaRumble: Seed = Rng.Chaotic.NextInt(999999)
let running = false;
/** The shake target's current translation (design px), for what draws in it but must hold still (render/vfx-attacks). */
export const shakeOffset = { x: 0, y: 0 };

function frame(dt: number) {
  let x = 0, y = 0;
  if (rumble) {
    const r = rumble;
    r.r -= dt;
    const e = cubicOut(Math.max(r.r, 0) / r.t);
    const n1 = noise(F(F(r.r) + r.seed) * r.freq), n2 = noise(F(F(F(r.r) + r.seed) + r.seed) * r.freq);
    if (r.drunk) { const k = Math.min(Math.max(dt * 10, 0), 1); r.ox += (n1 - r.ox) * k; r.oy += (n2 - r.oy) * k; x = r.ox * r.a * e; y = r.oy * r.a * e; }
    else { x = n1 * r.a * e; y = n2 * r.a * e; }
    if (r.r < 0) rumble = null;
  }
  if (punch) {
    // ScreenPunchInstance: a cosine at 60 rad/s along one direction, envelope CubicOut(remaining / duration)
    const p = punch;
    p.r -= dt;
    const c = Math.cos(p.r * 60) * p.a * cubicOut(p.r / p.t);
    x = c * p.dx; y = c * p.dy;
    if (p.r < 0) punch = null;
  }
  if (trauma > 0) {
    traumaMs += dt * 1000;
    const a = trauma ** 1.5 * 200 * multiplier();
    let tx = noise(F(F(traumaMs) + 100) * 0.01, traumaSeed) * a, ty = noise(F(F(traumaMs) + 300) * 0.01, traumaSeed) * a;
    const len = Math.hypot(tx, ty);
    if (len > 50) { tx *= 50 / len; ty *= 50 / len; }
    x += tx; y += ty;
    trauma = Math.max(trauma - 2 * dt, 0);
  }
  const idle = !punch && !rumble && trauma <= 0;
  document.querySelectorAll<HTMLElement>('[data-shake]').forEach((el) => { el.style.translate = idle ? '' : `${x}px ${y}px`; });
  shakeOffset.x = idle ? 0 : x; shakeOffset.y = idle ? 0 : y;
  running = !idle;
  return running;
}
const start = () => { if (!running) { running = true; $.onFrame(frame); } };

/** NGame.ScreenShake(strength, duration, degAngle): a new punch replaces the running one (random angle if < 0). */
export function screenShake(strength: number, duration = 1, degAngle = -1) {
  const s = STRENGTH[strength] ?? 0, m = multiplier();
  if (!s || !m) return;
  const deg = degAngle < 0 ? Math.random() * 360 : degAngle, t = DURATION[duration] ?? 0.3;
  punch = { a: s * m, t, r: t, dx: Math.cos((deg * Math.PI) / 180), dy: Math.sin((deg * Math.PI) / 180) };
  start();
}
/** NGame.ScreenRumble(strength, duration, style): 2-D noise (Rumble: frequency 6, × 0.5; Drunk: 0.1, × 5, smoothed). */
export function screenRumble(strength: number, duration = 1, style = 1) {
  const s = STRENGTH[strength] ?? 0, m = multiplier(), drunk = style === 2, t = DURATION[duration] ?? 0.3;
  if (!s || !m || !style) return;
  rumble = { a: s * m * (drunk ? 5 : 0.5), t, r: t, seed: F(Math.random() * 99999), freq: drunk ? 0.1 : 6, drunk, ox: 0, oy: 0 };
  start();
}
/** NGame.ScreenShakeTrauma(strength): trauma accumulates (capped at 1) and decays at 2 per second. */
export function screenShakeTrauma(strength: number) {
  trauma = Math.min(trauma + (TRAUMA[strength] ?? 0), 1);
  start();
}

/** Engine.SetTimeScale: process frames (tweens, shakes), Spine skeletons (the shared ticker) and the stage's particles. */
function setTimeScale(k: number) {
  $.setEngineTimeScale(k);
  Ticker.shared.speed = k;
  void getApp().then((a) => { a.ticker.speed = k; });
}
// Ease.Functions by ShakeStrength (VeryWeak CircIn, Weak SineIn, Medium QuadIn, Strong QuartIn, TooMuch ExpoIn) and
// seconds by ShakeDuration (Short .15, Normal .3, Long .6, Forever 2)
const HIT_EASE = [-1, 15, 12, 0, 6, 18], HIT_SECONDS = [0, 0.15, 0.3, 0.6, 2];
let hitStopGen = 0;
/**
 * NHitStop.DoHitStop: the time scale drops to 0.1 and eases back up to 1 over the duration, measured in real time; a new
 * hit stop cancels the running one. ponytail: SceneTreeTimers (Cmd.Wait) keep real time rather than stretching.
 */
export function hitStop(strength: number, duration: number) {
  const fn = HIT_EASE[strength] ?? -1, seconds = HIT_SECONDS[duration] ?? 0;
  if (fn < 0 || !seconds) return;
  const gen = ++hitStopGen;
  setTimeScale(0.1);
  let last = performance.now(), timer = 0;
  const step = () => {
    if (gen !== hitStopGen) return;
    const now = performance.now();
    timer += (now - last) / 1000;
    last = now;
    if (timer > seconds) { setTimeScale(1); return; }
    setTimeScale(Math.min(0.1 + G.Ease.Interpolate(timer / seconds, fn) * 0.9, 1));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
