// Tiny UI store: views mutate fields and call invalidate(); a rAF loop re-renders when dirty or while animating.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { $ } from './game';
export type Screen = 'boot' | 'menu' | 'run' | 'gameover' | 'library' | 'relics' | 'potions' | 'history'
  | 'stats' | 'credits';
export type MenuSubmenu = 'singleplayer' | 'charselect' | 'settings' | 'compendium' | 'timeline' | 'daily' | 'custom' | 'profile';
export const ui = {
  screen: 'boot' as Screen,
  room: null as any,         // current room view (bridge object)
  mapOpen: false,
  overlays: [] as any[],     // stacked overlay views (rewards, card pickers, ...)
  toast: '' as string,
  gameOver: null as any,
  live: false,               // combat: periodic safety-net re-render (see loop)
  cardsView: null as null | { kind: 'deck' | 'draw' | 'discard' | 'exhaust' }, // NDeckViewScreen / NCardPileScreen
  pauseOpen: false,          // NPauseMenu
  subscreen: null as Screen | null, // a compendium screen opened from the pause menu, over the run
  menuStack: [] as MenuSubmenu[], // NMainMenuSubmenuStack: submenus over the (blurred) main menu
  potionMenu: null as any,   // potion whose Drink/Throw/Discard popup is open
};
let dirty = true;
let render: () => void = () => {};
export function setRenderer(r: () => void) { render = r; }
export function invalidate() { dirty = true; }
// Views call invalidate(); in combat the game's CombatStateTracker.CombatStateChanged does too (bridge.ts), like NCombatUi.
// `live` only adds a 4 Hz refresh as a safety net for state nothing reports (instead of re-rendering every frame).
const LIVE_MS = 250;
let lastRender = 0;
function loop(t: number) {
  requestAnimationFrame(loop); // first: a throwing render must not stop the loop (the UI would freeze for good)
  if (dirty || (ui.live && t - lastRender >= LIVE_MS)) {
    dirty = false;
    lastRender = t;
    try { render(); } catch (e) { console.error('render failed', e); }
  }
}
export function startLoop() { requestAnimationFrame(loop); }
/** Back button of menu-side screens: to the pause menu when opened over a run, else to the main menu. */
export function leaveScreen() { if (ui.subscreen) ui.subscreen = null; else ui.screen = 'menu'; invalidate(); }
// ------------------------------------------------------------------ NOverlayStack
// Overlays stack in ui.overlays; one shared backstop (run.tscn OverlayBackstop, black .85) sits under the top one. It
// fades in (0.5 s Cubic Out) for the first overlay and out when the last leaves; stacked screens switch it instantly.
// Screens hear AfterOverlayOpened / Shown / Hidden / Closed; a screen without its own Hidden / Shown is hidden.
export const backstop = { A: 0 };
let backstopTween: any = null;
function paintBackstop() { const el = document.querySelector<HTMLElement>('.overlay-backstop'); if (el) el.style.opacity = String(backstop.A); }
function setBackstop(a: number) { backstopTween?.Kill(); backstopTween = null; backstop.A = a; paintBackstop(); invalidate(); }
function fadeBackstop(a: number) {
  backstopTween?.Kill();
  const t = (backstopTween = new $.WebTween());
  t.TweenProperty(backstop, 'a', a, 0.5).SetEase(1).SetTrans(7);
  $.onFrame(() => { paintBackstop(); return t.IsValid(); });
  t.whenFinished(() => { paintBackstop(); invalidate(); });
}
const sharedBackstop = (o: any) => o?.UseSharedBackstop ?? true;
const topOverlay = () => ui.overlays[ui.overlays.length - 1] ?? null;
const shown = (o: any) => { if (o.AfterOverlayShown) o.AfterOverlayShown(); else o.$hidden = false; };
const hidden = (o: any) => { if (o.AfterOverlayHidden) o.AfterOverlayHidden(); else o.$hidden = true; };
export function showBackstop() { const o = topOverlay(); if (!o || sharedBackstop(o)) fadeBackstop(1); }
export function hideBackstop() {
  const o = topOverlay();
  if (o && !sharedBackstop(o)) return;
  if (ui.overlays.length <= 1) fadeBackstop(0); else setBackstop(0);
}
export function pushOverlay(o: any) {
  const prev = topOverlay();
  if (prev) hidden(prev);
  ui.overlays.push(o);
  o.AfterOverlayOpened?.();
  shown(o);
  if (!sharedBackstop(o)) setBackstop(0);
  else if (ui.overlays.length === 1) showBackstop();
  else setBackstop(1);
  invalidate();
}
export function popOverlay(o: any) {
  if (!ui.overlays.includes(o)) return;
  const wasTop = o === topOverlay();
  if (wasTop) { hideBackstop(); hidden(o); }
  o.AfterOverlayClosed?.();
  ui.overlays = ui.overlays.filter((x) => x !== o);
  if (wasTop) {
    const t = topOverlay();
    if (t) { if (sharedBackstop(t)) setBackstop(1); else hideBackstop(); shown(t); }
    else hideBackstop();
  }
  invalidate();
}
/** NMapScreen.Opened / Closed → NOverlayStack.HideOverlays / ShowOverlays. */
export function hideOverlays() { setBackstop(0); const t = topOverlay(); if (t) hidden(t); }
export function showOverlays() {
  const t = topOverlay();
  if (t && !ui.mapOpen) { setBackstop(sharedBackstop(t) ? 1 : 0); shown(t); }
}
export function clearOverlays() { for (let o = topOverlay(); o; o = topOverlay()) popOverlay(o); }

/** NRelicInventory.AnimateRelic / NPotionContainer.AnimatePotion: the newest acquire animation per model (drawn by the top bar). */
export const acquired = new Map<any, { from: [number, number] | null; scale: number; gen: number }>();
let acquiredGen = 0;
export function animateAcquired(model: any, start?: any, scale?: any) {
  acquired.set(model, { from: start ? [start.X, start.Y] : null, scale: scale?.X ?? 1, gen: ++acquiredGen });
  invalidate();
}
