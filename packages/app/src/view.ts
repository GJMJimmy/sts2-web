// The logical viewport (Godot's Window.ContentScaleSize). Every position in the app is written in the 1920 × 1080 frame
// the scenes were made in; the viewport is that frame grown (or cut) evenly on both sides, so what the original anchors
// to the centre stays as written and what it anchors to an edge moves by ox / oy (style.css "anchors").
import type { Application } from 'pixi.js';
import { G } from './game';

/**
 * w × h, and the frame's offset inside it: the visible rect is [−ox, 1920 + ox] × [−oy, 1080 + oy] (ox < 0 when narrower).
 * `narrow`: how far below 16:9 it is, 0 at 16:9 and wider to 1 at 4:3 — what the backgrounds' own scripts go by
 * (NMapBg, NCharacterSelectScreenBg, NCombatSceneContainer; they read the window's ratio, which is the viewport's here).
 */
export const view = { w: 1920, h: 1080, ox: 0, oy: 0, narrow: 0 };
/**
 * A touch device held upright shows the stage turned a quarter (its top along the screen's right edge) rather than a
 * tiny letterboxed one: the player turns the device, not the browser.
 */
export let turned = false;

/** The viewport's edges in frame coordinates. */
export const edge = {
  get l() { return -view.ox; }, get r() { return 1920 + view.ox; },
  get t() { return -view.oy; }, get b() { return 1080 + view.oy; },
};
/** Its corners, clockwise from the top left: a quad over the whole screen. */
export const corners = () => [edge.l, edge.t, edge.r, edge.t, edge.r, edge.b, edge.l, edge.b];
/** The frame coordinate a fraction of the way across / down the viewport (GetViewportRect().Size × f). */
export const fracX = (f: number) => f * view.w - view.ox, fracY = (f: number) => f * view.h - view.oy;
/** A frame position the original anchors to the `l`eft / `r`ight and `t`op / `b`ottom edge (neither: the centre). */
export const anchored = (x: number, y: number, to: string): [number, number] =>
  [x + (to.includes('l') ? -view.ox : to.includes('r') ? view.ox : 0), y + (to.includes('t') ? -view.oy : to.includes('b') ? view.oy : 0)];

/** NMapBg.OnWindowChange: the map's paper hangs 1620 px above the top at 16:9, easing (Cubic Out) to 1540 at 4:3. */
export const mapDy = () => 80 * view.narrow ** 3;

// NGame.ApplyDisplaySettings: the fixed ratios are letterboxed (ContentScaleAspect.Keep) at these sizes
const FIXED: Record<string, [number, number]> = { FourByThree: [1680, 1260], SixteenByTen: [1920, 1200], SixteenByNine: [1920, 1080], TwentyOneByNine: [2580, 1080] };
/**
 * NGlobalUi.OnWindowChange under AspectRatioSetting.Auto: Expand from 1680 × 1080 between 4:3 and 2580:1080 (the
 * height stays 1080 down to 14:9, then the width stays 1680), KeepHeight at 1680 × 1260 / KeepWidth at 2580 × 1080
 * (letterboxed) outside.
 */
export function viewSize(setting: string, winW: number, winH: number): [number, number] {
  if (setting !== 'Auto') return FIXED[setting] ?? FIXED.SixteenByNine;
  const r = Math.min(Math.max(winW / winH, 4 / 3), 2580 / 1080);
  return r >= 1680 / 1080 ? [1080 * r, 1080] : [1680, 1680 / r];
}

const apps = new Set<Application>(), listeners = new Set<() => void>();
function place(a: Application) {
  a.renderer.resize(view.w, view.h);
  a.stage.position.set(view.ox, view.oy);
}
/** A Pixi canvas over the whole viewport, drawing in frame coordinates (style.css .view-canvas places it). */
export function fullView(a: Application) { apps.add(a); a.canvas.classList.add('view-canvas'); place(a); return a; }
/** For layouts that keep what they computed from the viewport. */
export function onViewChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Fits the stage to the window: on load, on resize and when SettingsSave.AspectRatioSetting changes. */
export function fit() {
  turned = window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches;
  const [winW, winH] = turned ? [window.innerHeight, window.innerWidth] : [window.innerWidth, window.innerHeight];
  let setting = 'SixteenByNine';
  try { setting = G.AspectRatioSetting[G.SaveManager.Instance.SettingsSave.AspectRatioSetting] ?? setting; } catch { /* the saves are not loaded yet */ }
  const [w, h] = viewSize(setting, winW, winH);
  const st = document.documentElement.style;
  st.setProperty('--scale', String(Math.min(winW / w, winH / h)));
  st.setProperty('--turn', turned ? '90deg' : '0deg');
  // whole, even sizes: the canvases are that many pixels and the frame's offset is a whole pixel
  const cw = 2 * Math.ceil(w / 2 - 1e-6), ch = 2 * Math.ceil(h / 2 - 1e-6);
  if (cw === view.w && ch === view.h) return;
  Object.assign(view, { w: cw, h: ch, ox: (cw - 1920) / 2, oy: (ch - 1080) / 2, narrow: Math.min(1, Math.max(0, (16 / 9 - w / h) / (16 / 9 - 4 / 3))) });
  st.setProperty('--ox', `${view.ox}px`);
  st.setProperty('--oy', `${view.oy}px`);
  st.setProperty('--map-dy', `${mapDy()}px`);
  for (const a of apps) place(a);
  for (const fn of listeners) fn();
}
