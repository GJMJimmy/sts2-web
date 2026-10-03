// NTimelineScreen (scenes/timeline_screen/timeline_screen.tscn), a submenu over the blurred main menu: era columns of
// NEpochSlots over the gold line in a ×1.2 zoomed, draggable strip; NEpochInspectScreen (the portrait flying out of its
// slot, the chains breaking on a reveal, the typewritten story); the NUnlockScreens an epoch's QueueUnlocks queues
// (cards, relics, potions, a character, misc text, the timeline expanding itself); NTimelineTutorial the first time.
// DOM draws the UI; the stars go on the menu's Pixi canvas, the chains / their particles / unlock bursts / the unlocked
// character's skeleton on a small Pixi canvas of their own between the inspect portrait and its texts.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Application, Container, Matrix } from 'pixi.js';
import { G, $, N, list } from '../game';
import { invalidate } from '../store';
import { atlasFrame, frameStyle, imageUrl } from '../assets';
import { loc, locv } from '../i18n';
import { playOneShot, setMenuProgress } from '../audio';
import { tint } from '../filters';
import { Card, useFit } from './card';
import { RichText, glyphs } from './richtext';
import { setTips, setTip, hoverTipsOf, logicalRect } from './tooltip';
import { pushMenu, popMenu } from './menu';
import { BackButton } from './buttons';
import { CommonBanner } from './overlays';
import { RewardGlows } from './reward-glow';
import { getApp, creatureSpine } from '../render/stage';
import { loadScene, buildScene, rootMatrix, sceneTexture } from '../render/scene';
import { loadShader, QuadBatch } from '../render/canvas';
import { noiseRGBA } from '../render/noise';
import './timeline.css';
import { fullView, view, edge, fracX, onViewChange } from '../view';
import { renderResolution } from '../render/quality';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (ls: any) => safe(() => (typeof ls === 'string' ? ls : ls?.GetFormattedText?.() ?? String(ls ?? '')), '');
const sfx = (n: string) => playOneShot(`event:/sfx/ui/timeline/${n}`);
const hoverSfx = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
const clickSfx = () => playOneShot('event:/sfx/ui/clicks/ui_click');
const img = (p: string) => imageUrl(p) ?? '';
const wait = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const E = {
  back: 'cubic-bezier(0.34, 1.56, 0.64, 1)', expo: 'cubic-bezier(0.16, 1, 0.3, 1)', cubic: 'cubic-bezier(0.33, 1, 0.68, 1)',
  cubicInOut: 'cubic-bezier(0.65, 0, 0.35, 1)', quad: 'cubic-bezier(0.5, 1, 0.89, 1)',
};
const TR = { Linear: 0, Expo: 5, Cubic: 7 }, EZ = { Out: 1, InOut: 2 };
/** Element.animate with fill both (Godot tweens hold their end values). */
const anim = (el: Element | null | undefined, kf: Keyframe[], s: number, easing = 'linear', delay = 0) =>
  el?.animate(kf, { duration: s * 1000, easing, delay: delay * 1000, fill: 'both' });
const sm = () => G.SaveManager.Instance;
const progress = () => sm().Progress;
const ES = { NoSlot: 1, NotObtained: 2, ObtainedNoSlot: 3, Obtained: 4, Revealed: 5 };
/** EpochSlotState (Complete 1, Obtained 2, NotObtained 3) → the web's names. */
type SlotState = 'complete' | 'obtained' | 'locked';
const slotState = (n: number): SlotState => (n === 1 ? 'complete' : n === 2 ? 'obtained' : 'locked');

// ------------------------------------------------------------------ model
interface Slot {
  id: string; model: any; pos: number; state: SlotState;
  /** SpawnSlot: seconds before the rise starts, once scheduled (the slot is drawn from then on) */
  delay: number | null;
  spawned: boolean;
  /** outline: EnableHighlight (purple, pulsing), the faint blue ring, or transparent (revealed this session) */
  outline: 'none' | 'purple' | 'blue';
  highlight: boolean;
  hover: boolean;
  outlineEl?: HTMLElement | null; offEl?: HTMLElement | null; off?: boolean;
}
interface Col { era: number; slots: Slot[]; X: number; icon: boolean; el?: HTMLElement | null }
type Unlock =
  | { kind: 'cards'; items: any[] } | { kind: 'relics'; items: any[] } | { kind: 'potions'; items: any[] }
  | { kind: 'character'; char: any; epoch: any } | { kind: 'misc'; text: string } | { kind: 'timeline'; eras: any[] };
type Screen = Unlock & { key: number; closing: boolean; confirm: boolean; fx?: Container | null };
interface Insp {
  gen: number; epoch: any; from: number[]; reveal: boolean; page: number;
  label: string; closeOn: boolean; closing: boolean; hasStory: boolean;
  prev: any; next: any;
}

const tl = {
  gen: 0,
  cols: [] as Col[],
  Mx: -960, target: -960, drag: false, lerping: false,
  SlotsA: 1, LineA: 0, LineW: 0, BackstopA: 1,
  backstop: false, input: false, back: false, draggable: false,
  reminder: '' as '' | 'in' | 'out', reminderText: '',
  insp: null as Insp | null,
  screens: [] as Screen[],
  tutorial: null as null | { closing: boolean; enabled: boolean },
  hovered: null as Slot | null, tipAt: [0, 0],
  tweens: [] as any[],
};
let screenKey = 0, inspGen = 0;

const NTimelineScreen = N('Screens.Timeline.NTimelineScreen');
/** The rule layer's view of the screen: epochs' QueueUnlocks fill the unlock-screen queue through these. */
class TimelineView extends NTimelineScreen {
  queue: Unlock[] = [];
  QueueMiscUnlock(text: any) { this.queue.push({ kind: 'misc', text: String(text ?? '') }); }
  QueueCharacterUnlock(T: any, epoch: any) { this.queue.push({ kind: 'character', char: G.ModelDb.Character(T), epoch }); }
  QueueCardUnlock(cards: any) { this.queue.push({ kind: 'cards', items: list(cards) }); }
  QueueRelicUnlock(relics: any) { this.queue.push({ kind: 'relics', items: list(relics) }); }
  QueuePotionUnlock(potions: any) { this.queue.push({ kind: 'potions', items: list(potions) }); }
  QueueTimelineExpansion(eras: any) { this.queue.push({ kind: 'timeline', eras: list(eras) }); }
  AddEpochSlots() { return $.Task.CompletedTask; }
  IsScreenQueued() { return this.queue.length > 0; }
  OpenQueuedScreen() { openQueuedScreen(); }
  EnableInput() { enableInput(); }
  DisableInput() { disableInput(); }
}
export const timeline = new TimelineView();

/** NMainMenu.OpenTimelineScreen: menu_progress "timeline", then the submenu. */
export function openTimeline() {
  setMenuProgress('timeline');
  pushMenu('timeline');
}
/** NMainMenu.OpenTimelineFromGameOverScreen: half a second (none in Instant mode), no music change. */
export async function openTimelineFromGameOver() {
  if (safe(() => sm().PrefsSave.FastMode !== G.FastModeType.Instant, true)) await wait(0.5);
  pushMenu('timeline');
}
/** Obtained epochs waiting to be revealed (NMainMenu's notification dot and gating). */
export const revealableCount = () => safe(() => sm().GetDiscoveredEpochCount(), 0);
const neowId = () => G.EpochModel.GetId$Type(G.NeowEpoch);
const toSlot = (d: any): { model: any; state: SlotState } => ({ model: d.Model, state: slotState(d.State) });

// ------------------------------------------------------------------ layout (WhatsMoved's local space)
const colLeft = (i: number, n: number) => 960 - (n * 226 - 64) / 2 + 226 * i;
const slotsWidth = () => Math.max(0, tl.cols.length * 226 - 64);
/** A slot's top-left on screen: WhatsZoomed at (960, 552), pivot (0, 240), ×1.2; WhatsMoved at (Mx, −540). */
function slotScreen(col: Col, k: number): [number, number] {
  return [960 + 1.2 * (col.X + tl.Mx), 1.2 * (699 - 112 * k) - 144];
}
const tween = () => { const t = new $.WebTween(); tl.tweens.push(t); return t; };

// ------------------------------------------------------------------ NTimelineScreen flow
function resetScreen() {
  for (const t of tl.tweens) t.Kill();
  Object.assign(tl, {
    gen: tl.gen + 1, cols: [], Mx: -960, SlotsA: 1, target: -960, drag: false, lerping: false, LineA: 0, LineW: 0, BackstopA: 1,
    backstop: false, input: false, back: false, reminder: '', insp: null, screens: [], tutorial: null, hovered: null, tweens: [],
  });
  timeline.queue = [];
}
/** OnSubmenuOpened. */
function onOpened() {
  NTimelineScreen.Instance = timeline;
  resetScreen();
  disableInput();
  const neow = list(progress().Epochs).find((e: any) => e.Id === neowId());
  if (!neow || neow.State === ES.NoSlot || neow.State === ES.NotObtained) progress().ObtainEpoch(neowId());
  const gen = tl.gen;
  if (safe(() => sm().IsNeowDiscovered(), false)) {
    // FirstTimeLogic: the tutorial a frame later; HideBackButtonImmediately
    void nextFrame().then(() => {
      if (gen !== tl.gen) return;
      tl.tutorial = { closing: false, enabled: false };
      sfx('ui_timeline_unlock');
      invalidate();
    });
  } else {
    sfx('ui_timeline_open');
    void initScreen();
  }
  tl.draggable = list(progress().Epochs).length > 4;
  safe(() => G.AchievementsHelper.CheckTimelineComplete(), null);
  invalidate();
}
function onClosed() {
  resetScreen();
  setTip(null);
}

async function initScreen() {
  const gen = tl.gen;
  tween().TweenProperty(tl, 'line_a', 1, 0.5);
  const data = list(progress().Epochs).filter((e: any) => e.State !== ES.ObtainedNoSlot)
    .map((e: any) => ({ model: G.EpochModel.Get$String(e.Id), state: 'locked' as SlotState }))
    .sort((a: any, b: any) => a.model.EraPosition - b.model.EraPosition);
  await addEpochSlots(data, false);
  if (gen !== tl.gen) return;
  for (const e of list(progress().Epochs)) {
    if (e.State <= ES.ObtainedNoSlot) continue;
    const s = findSlot(e.Id);
    if (s) setState(s, e.State >= ES.Revealed ? 'complete' : 'obtained');
  }
  invalidate();
  void navigateToRevealableSlot();
}
const findSlot = (id: string) => { for (const c of tl.cols) for (const s of c.slots) if (s.id === id) return s; return null; };

/** NavigateToRevealableSlot: centre the obtained slot nearest the start (2.5 s, InOut Cubic), then input. */
async function navigateToRevealableSlot() {
  const gen = tl.gen;
  if (revealableCount() === 0) { enableInput(); return; }
  await nextFrame();
  if (gen !== tl.gen) return;
  const init = 960 + 1.2 * tl.Mx;
  let best: Col | null = null, dist = Infinity;
  for (const c of tl.cols) for (const s of c.slots) {
    if (s.state !== 'obtained') continue;
    const d = Math.abs(init - slotScreen(c, 0)[0]);
    if (d < dist) { dist = d; best = c; }
  }
  if (best) {
    // LerpToSlot: the slot's left edge to screen x 864
    tl.lerping = true;
    const t = tween();
    t.TweenProperty(tl, 'mx', (864 - 960) / 1.2 - best.X, 2.5).SetEase(EZ.InOut).SetTrans(TR.Cubic);
    await new Promise<void>((r) => t.whenFinished(r));
    if (gen !== tl.gen) return;
    tl.lerping = false;
    tl.target = tl.Mx;
  }
  enableInput();
}

/** AddEpochSlots: new columns in era order, slots bottom-up by EraPosition; animated = an expansion or the first slot. */
async function addEpochSlots(data: { model: any; state: SlotState }[], animated: boolean) {
  const gen = tl.gen;
  const fresh: Col[] = [];
  const old = new Map(tl.cols.map((c) => [c, c.X]));
  for (const d of data) {
    const era = d.model.Era;
    let col = tl.cols.find((c) => c.era === era);
    if (!col) { col = { era, slots: [], X: 0, icon: false }; tl.cols.push(col); fresh.push(col); }
    col.slots.push({ id: d.model.Id, model: d.model, pos: d.model.EraPosition, state: d.state, delay: null, spawned: false, outline: 'none', highlight: false, hover: false });
    col.slots.sort((a, b) => a.pos - b.pos);
  }
  tl.cols.sort((a, b) => a.era - b.era);
  const n = tl.cols.length;
  tl.cols.forEach((c, i) => { c.X = colLeft(i, n); });
  if (animated) {
    // SaveBeforeAnimationPosition: the old columns stay where they were, then glide to their new places (2 s)
    for (const [c, x] of old) {
      const to = c.X;
      c.X = x;
      void nextFrame().then(() => { if (gen === tl.gen) tween().TweenProperty(c, 'x', to, 2).SetEase(EZ.InOut).SetTrans(TR.Cubic); });
    }
    invalidate();
    // GrowTimelineAndAddEraIcons
    if (fresh.length) {
      const t = tween().SetParallel();
      t.TweenProperty(tl, 'line_a', 1, 0.5);
      t.TweenProperty(tl, 'line_w', n * 226, 2).SetEase(EZ.InOut).SetTrans(TR.Cubic);
      await new Promise<void>((r) => t.whenFinished(r));
      if (gen !== tl.gen) return;
      for (const c of fresh) c.icon = true;
    }
    for (const c of tl.cols) spawnSlots(c, true);
  } else {
    if (!fresh.length) return;
    tl.LineW = n * 226;
    for (const c of fresh) c.icon = true;
    for (const c of tl.cols) spawnSlots(c, false);
  }
  invalidate();
}
/** NEraColumn.SpawnSlots: every unspawned slot rises (one after another when animated). */
function spawnSlots(c: Col, animated: boolean) {
  let at = 0;
  for (const s of c.slots) {
    if (s.delay != null) continue;
    const r = Math.random() * 0.3;
    s.delay = (animated ? at : 0) + r;
    if (animated) at += r + 0.5;
    const gen = tl.gen;
    setTimeout(() => { if (gen === tl.gen) slotSpawned(s); }, (s.delay + 0.5) * 1000);
  }
}
function slotSpawned(s: Slot) {
  s.spawned = true;
  if (s.state === 'obtained') { s.highlight = true; s.outline = 'purple'; } else s.outline = 'blue';
  invalidate();
}
/** NEpochSlot.SetState. */
function setState(s: Slot, st: SlotState) {
  s.state = st;
  if (st === 'complete') { s.highlight = false; s.outline = s.spawned ? 'none' : s.outline; }
}

function disableInput() { tl.input = false; tl.drag = false; invalidate(); }
/** EnableInput: nothing while an unlock screen is queued; otherwise the back button rules and input. */
function enableInput() {
  if (timeline.queue.length) return;
  refreshBackButton();
  tl.input = true;
  invalidate();
}
/** RefreshBackButton: leaving is blocked while an epoch waits to be revealed (the reminder pulses with 2+ columns). */
function refreshBackButton() {
  const n = revealableCount();
  if (n > 0) {
    if (tl.cols.length > 1) { tl.reminder = 'in'; tl.reminderText = locv('timeline', 'REMINDER_TEXT', { RevealableEpochCount: n }); }
    tl.back = false;
  } else tl.back = true;
  invalidate();
}
let bsTween: any = null;
function showBackstopAndHideUi() {
  tl.backstop = true;
  bsTween?.Kill();
  const t = (bsTween = tween().SetParallel());
  t.TweenProperty(tl, 'slots_a', 0.1, 0.4);
  t.TweenProperty(tl, 'backstop_a', 0.5, 0.4);
  tl.back = false;
  if (tl.reminder) tl.reminder = 'out';
  invalidate();
}
async function hideBackstopAndShowUi(showBack: boolean) {
  const gen = tl.gen;
  bsTween?.CustomStep(999); // FastForwardToCompletion
  const t = (bsTween = tween().SetParallel());
  t.TweenProperty(tl, 'slots_a', 1, 0.4).SetEase(EZ.Out).SetTrans(TR.Cubic);
  t.TweenProperty(tl, 'backstop_a', 0, 0.4).SetEase(EZ.Out).SetTrans(TR.Cubic);
  if (showBack) refreshBackButton();
  await new Promise<void>((r) => t.whenFinished(r));
  if (gen === tl.gen) { tl.backstop = false; invalidate(); }
}
function leave() {
  playOneShot('event:/sfx/ui/map/map_close');
  setTip(null);
  popMenu();
  setMenuProgress('main');
}

// ------------------------------------------------------------------ slots: reveal / inspect
function onSlotRelease(c: Col, s: Slot) {
  if (s.state === 'obtained') {
    disableInput();
    // RevealEpoch
    s.state = 'complete';
    s.highlight = false;
    s.outline = 'none';
    sm().RevealEpoch(s.id, false);
    openInspect(c, s, true);
  } else if (s.state === 'complete') {
    disableInput();
    openInspect(c, s, false);
  }
}
function openInspect(c: Col, s: Slot, reveal: boolean) {
  setTip(null);
  tl.hovered = null;
  const [x, y] = slotScreen(c, c.slots.indexOf(s));
  sfx('ui_timeline_open_epoch');
  showBackstopAndHideUi();
  const epoch = s.model;
  tl.insp = { gen: ++inspGen, epoch, from: [x, y, 194.4, 120], reveal, page: 0, label: '', closeOn: false, closing: false, hasStory: false, prev: null, next: null };
  refreshInspect(tl.insp, epoch);
  if (reveal) {
    // UnlockAnimation's setup (HidePaginators: the arrows stay hidden)
    timeline.queue = [];
    epoch.QueueUnlocks();
    sm().SaveProgressFile();
    tl.insp.label = loc('timeline', 'EPOCH_INSPECT.continueButton');
    void chainsAnimation(tl.insp);
  } else tl.insp.label = loc('timeline', 'EPOCH_INSPECT.closeButton');
  invalidate();
}
function refreshInspect(v: Insp, epoch: any) {
  v.epoch = epoch;
  v.hasStory = safe(() => epoch.StoryTitle, null) != null;
  v.prev = v.hasStory ? safe(() => G.StoryModel.PrevChapter(epoch), null) : null;
  v.next = v.hasStory ? safe(() => G.StoryModel.NextChapter(epoch), null) : null;
}
/** NEpochInspectScreen.Close: the next unlock screen (the backstop stays) or back to the timeline. */
function closeInspect() {
  const v = tl.insp;
  if (!v || v.closing) return;
  v.closing = true;
  v.closeOn = false;
  if (timeline.queue.length) openQueuedScreen();
  else { enableInput(); void hideBackstopAndShowUi(true); }
  const gen = tl.gen;
  setTimeout(() => {
    if (gen !== tl.gen || tl.insp !== v) return;
    tl.insp = null;
    if (v.reveal) safe(() => G.AchievementsHelper.CheckTimelineComplete(), null);
    invalidate();
  }, 500);
  invalidate();
}
function page(v: Insp, epoch: any) {
  if (!epoch) return;
  refreshInspect(v, epoch);
  v.page++;
  invalidate();
}

// ------------------------------------------------------------------ unlock screens
function openQueuedScreen() {
  const u = timeline.queue.shift();
  if (!u) return;
  const s: Screen = { ...u, key: ++screenKey, closing: false, confirm: false } as Screen;
  tl.screens = [...tl.screens, s];
  // NUnlockScreen.Open
  disableInput();
  const gen = tl.gen;
  setTimeout(() => { if (gen === tl.gen) { s.confirm = true; invalidate(); } }, 500);
  if (s.kind !== 'timeline') sfx('ui_timeline_unlock');
  else void animateExpansion(s);
  invalidate();
}
async function closeScreen(s: Screen) {
  if (s.closing) return;
  const gen = tl.gen;
  s.closing = true;
  s.confirm = false;
  if (s.kind !== 'timeline') enableInput(); // OnScreenClose
  const done = () => { if (gen === tl.gen) { tl.screens = tl.screens.filter((x) => x !== s); invalidate(); } };
  invalidate();
  if (!timeline.queue.length) { await hideBackstopAndShowUi(true); done(); }
  else { openQueuedScreen(); done(); }
}
/** NUnlockTimelineScreen.AnimateExpansion. */
async function animateExpansion(s: Extract<Screen, { kind: 'timeline' }>) {
  const gen = tl.gen;
  await hideBackstopAndShowUi(false);
  if (gen !== tl.gen) return;
  const eras = [...s.eras].sort((a: any, b: any) => a.EraPosition - b.EraPosition);
  await addEpochSlots(eras.map(toSlot), true);
  if (gen !== tl.gen) return;
  tl.draggable = list(progress().Epochs).length > 4;
  await closeScreen(s);
  enableInput();
}

// ------------------------------------------------------------------ tutorial
async function closeTutorial() {
  const t = tl.tutorial;
  if (!t || t.closing) return;
  t.closing = true;
  t.enabled = false;
  invalidate();
  const gen = tl.gen;
  await wait(0.5);
  if (gen !== tl.gen) return;
  tl.tutorial = null;
  // SpawnFirstTimeTimeline
  sfx('ui_timeline_open');
  await addEpochSlots([{ model: G.EpochModel.Get$String(neowId()), state: 'obtained' }], true);
  if (gen !== tl.gen) return;
  sm().UnlockSlot(neowId());
  enableInput();
}

// ------------------------------------------------------------------ the screen
export function Timeline() {
  const refs = { wm: useRef<HTMLDivElement>(null), slots: useRef<HTMLDivElement>(null), line: useRef<HTMLDivElement>(null), lineBox: useRef<HTMLDivElement>(null), backstop: useRef<HTMLDivElement>(null) };
  useEffect(() => {
    onOpened();
    const stopFrame = $.onFrame((dt: number) => { frame(dt, refs); return true; });
    const stopStars = mountStars();
    // _Ready (once per main menu, the screen being cached): SlotsContainer fades in over 1 s
    const menuEl = document.querySelector('.screen.menu');
    if (menuEl !== readyMenu) { readyMenu = menuEl; tl.SlotsA = 0; tween().TweenProperty(tl, 'slots_a', 1, 1); }
    return () => { stopFrame(); stopStars(); onClosed(); };
  }, []);
  const wheel = (e: WheelEvent) => {
    if (!tl.input || !tl.draggable) return;
    // ScrollHelper-less: WheelUp / WheelRight −50, WheelDown / WheelLeft +50, fired on press and release; pixels 1:1
    const notch = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (notch) tl.target += (e.deltaY > 0 ? 100 : e.deltaY < 0 ? -100 : 0) + (e.deltaX > 0 ? -100 : e.deltaX < 0 ? 100 : 0);
    else tl.target += e.deltaY - e.deltaX;
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !tl.input || !tl.draggable) return;
    tl.drag = true;
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
    const move = (m: PointerEvent) => { if (tl.drag) tl.target += m.movementX / k; };
    const up = () => { tl.drag = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div class="timeline">
      <div class="tl-bg" />
      <div class={'tl-reminder ' + tl.reminder}><RichText text={tl.reminderText} /></div>
      <div class="tl-slots" ref={refs.slots} style={{ opacity: tl.SlotsA }} onWheel={wheel} onPointerDown={down}>
        <div class="tl-zoom">
          <div class="tl-moved" ref={refs.wm} style={{ left: `${tl.Mx}px` }}>
            <div class="tl-line-box" ref={refs.lineBox} style={{ opacity: tl.LineA, width: `${tl.LineW + 128}px`, maskImage: `url(${noiseMask()})`, WebkitMaskImage: `url(${noiseMask()})` }}>
              <div class="tl-line-fade left" />
              <div class="tl-line" ref={refs.line} />
              <div class="tl-line-fade right" />
            </div>
            {tl.cols.map((c) => <Column key={c.era} c={c} />)}
          </div>
        </div>
      </div>
      <div class="tl-edge left" />
      <div class="tl-edge right" />
      <div class="tl-offscreen-holder">
        {tl.cols.flatMap((c) => c.slots.filter((s) => s.highlight).map((s) => <Offscreen key={s.id} s={s} />))}
      </div>
      <BackButton enabled={tl.back && !tl.tutorial} onClick={leave} />
      {!tl.input && <div class="tl-input-blocker" />}
      {tl.backstop && <div class="tl-backstop" ref={refs.backstop} style={{ opacity: 0.502 * tl.BackstopA }} />}
      {tl.insp && <InspectUnder key={tl.insp.gen} v={tl.insp} />}
      <FxLayer />
      {tl.insp && <InspectOver key={tl.insp.gen} v={tl.insp} />}
      {tl.screens.map((s) => <UnlockScreen key={s.key} s={s} />)}
      {tl.tutorial && <Tutorial t={tl.tutorial} />}
    </div>
  );
}
let readyMenu: Element | null = null;
/**
 * LineMask's NoiseTexture2D (timeline_screen.tscn: 256², seamless, simplex seed 100 at frequency 0.25, ramped white
 * α 1 → 0.502), tiled over the line and clipping it by its alpha.
 */
let noiseUrl = '';
function noiseMask() {
  if (noiseUrl) return noiseUrl;
  const { width, height, rgba } = noiseRGBA({ width: 256, height: 256, seamless: true, noise: { noise_type: 0, seed: 100, frequency: 0.25 }, color_ramp: { offsets: [0, 1], colors: [[1, 1, 1, 1], [1, 1, 1, 0.501961]] } });
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  cv.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return (noiseUrl = cv.toDataURL());
}

/** NSlotsContainer._Process (scroll lerp, spring back inside the slots' span) and the per-frame paint. */
function frame(dt: number, refs: any) {
  if (!tl.lerping) tl.Mx += (tl.target - tl.Mx) * Math.min(1, dt * 20);
  if (!tl.drag) {
    const w = slotsWidth(), lo = -960 - w / 2, hi = -960 + w / 2;
    if (tl.target < lo) tl.target += (lo - tl.target) * Math.min(1, dt * 36);
    else if (tl.target > hi) tl.target += (hi - tl.target) * Math.min(1, dt * 36);
  }
  if (refs.wm.current) refs.wm.current.style.left = `${tl.Mx}px`;
  if (refs.slots.current) refs.slots.current.style.opacity = String(tl.SlotsA);
  if (refs.lineBox.current) { refs.lineBox.current.style.opacity = String(tl.LineA); refs.lineBox.current.style.width = `${tl.LineW + 128}px`; }
  if (refs.backstop.current) refs.backstop.current.style.opacity = String(0.502 * tl.BackstopA);
  const pulse = (Math.sin(performance.now() * 0.005) + 2) * 0.25;
  for (const c of tl.cols) {
    if (c.el) c.el.style.left = `${c.X}px`;
    c.slots.forEach((s, k) => {
      if (s.highlight && !s.hover && s.outlineEl) s.outlineEl.style.opacity = String(pulse);
      if (s.highlight && s.offEl) {
        // NEpochOffscreenVfx: at the screen edge beside a slot that is out of view
        const [x, y] = slotScreen(c, k);
        const out = x < edge.l || x > edge.r;
        if (out !== !!s.off) {
          s.off = out;
          s.offEl.classList.toggle('on', out);
          if (out) { s.offEl.style.left = `${x < edge.l ? edge.l : edge.r}px`; s.offEl.style.top = `${y + 60}px`; }
        }
      }
      if (s === tl.hovered) {
        const [x, y] = slotScreen(c, k);
        if (Math.abs(x - tl.tipAt[0]) > 0.5 || Math.abs(y - tl.tipAt[1]) > 0.5) showSlotTip(c, s, k);
      }
    });
  }
}

// ------------------------------------------------------------------ NEraColumn / NEpochSlot
function Column({ c }: { c: Col }) {
  const f = atlasFrame(`atlases/era_atlas.sprites/era_${c.era < 0 ? `minus_${Math.abs(c.era)}` : c.era}.tres`);
  return (
    <div class="tl-col" ref={(el) => { c.el = el; }} style={{ left: `${c.X}px` }}>
      {c.slots.map((s, k) => s.delay != null && <EpochSlot key={s.id} c={c} s={s} k={k} />)}
      {c.icon && <div class="tl-era-icon" style={{ ...frameStyle(f, 48, 48), filter: tint(1, 0.8, 0.4) }} />}
    </div>
  );
}

function showSlotTip(c: Col, s: Slot, k: number) {
  const [x, y] = slotScreen(c, k);
  tl.tipAt = [x, y];
  const info = s.model.UnlockInfo;
  safe(() => info.Add$String_Boolean('IsRevealed', s.state === 'complete'), undefined);
  setTips([{ title: fmt(s.model.Title), body: fmt(info), icon: s.state === 'complete' ? 'res://images/packed/unlock_icon.png' : null }],
    { kind: 'at', x: x > fracX(0.7) ? x - 360 : x + 208.8, y });
}

/**
 * NEpochSlot (162 × 100, pivot centre): slot_golden with the portrait clipped to it (the epoch_atlas frame; locked:
 * blurred and near grey, obtained: grey and dark under chains, complete: full colour), the outline (1.06 × 1.08)
 * and, while obtained, the highlight particles behind. Hover / press scale and hsv per state.
 */
function EpochSlot({ c, s, k }: { c: Col; s: Slot; k: number }) {
  const [st, setSt] = useState<'' | 'hover' | 'press' | 'release'>('');
  const [touched, setTouched] = useState(false);
  const locked = s.state === 'locked', obtained = s.state === 'obtained';
  const f = atlasFrame(s.model.PackedPortraitPath);
  // hsv (s, v) per state and pointer
  let hs = 1, hv = 1;
  if (locked) { hs = 0.25; hv = st === 'hover' ? 1.2 : touched ? 1.1 : 1; }
  else if (obtained) { hs = 0; hv = st === 'hover' ? 0.65 : 0.5; }
  else { hs = st === 'hover' ? 1.1 : 1; hv = st === 'hover' ? 1.1 : 1; }
  const scale = locked ? 1 : st === 'hover' || st === 'release' ? 1.05 : st === 'press' ? 0.95 : 1;
  const tScale = st === 'hover' ? '.05s linear' : st === 'press' ? `.25s ${E.expo}` : st === 'release' ? `.25s ${E.back}` : `.5s ${E.cubic}`;
  const tHsv = st === 'hover' || st === 'release' ? '.05s linear' : st === 'press' ? `.25s ${E.expo}` : `.5s ${E.expo}`;
  const portraitFilter = locked ? `saturate(${hs * 0.25}) blur(2px) brightness(${0.75 * hv})` : `saturate(${hs}) brightness(${hv})`;
  const mask = `url(${img('images/timeline/ui/slot_golden.png')}) center / contain no-repeat`;
  const enter = () => {
    s.hover = true;
    setSt('hover');
    playOneShot(locked ? 'event:/sfx/ui/timeline/ui_timeline_hover_locked' : 'event:/sfx/ui/timeline/ui_timeline_hover');
    tl.hovered = s;
    showSlotTip(c, s, k);
  };
  const leave = () => {
    s.hover = false;
    setSt('');
    setTouched(true);
    if (tl.hovered === s) { tl.hovered = null; setTip(null); }
  };
  return (
    <div class={'tl-slot ' + s.state} style={{ top: `${699 - 112 * k - 187}px`, scale: String(scale), transition: `scale ${tScale}` }}
      onPointerEnter={enter} onPointerLeave={leave}
      onPointerDown={(e) => { if (e.button !== 0 || locked) return; setSt('press'); sfx('ui_timeline_click'); }}
      onPointerUp={(e) => { if (e.button !== 0 || st !== 'press') return; setSt('release'); onSlotRelease(c, s); }}>
      {s.highlight && (
        <div class="tl-highlight" style={{ filter: tint(0.9, 0.4, 1) }}>
          {[0, 1, 2].map((i) => <img src={img('images/timeline/ui/slot_outline.png')} style={{ animationDelay: `${-i * 2.2 / 3}s` }} />)}
        </div>
      )}
      <div class="tl-rise" style={{ animationDelay: `${s.delay}s` }}>
        <img class="tl-slot-img" src={img('images/timeline/ui/slot_golden.png')} />
        <div class="tl-slot-mask" style={{ mask, WebkitMask: mask }}>
          <div class="tl-portrait" style={{ ...frameStyle(f, 162, 100), filter: portraitFilter, transition: `filter ${tHsv}` }} />
          {obtained && <img class="tl-chains" src={img('images/packed/timeline/epoch_slot_locked_small.png')} />}
        </div>
      </div>
      <div class="tl-rise outline" style={{ animationDelay: `${s.delay}s` }}>
        <div class={'tl-outline ' + s.outline} ref={(el) => { s.outlineEl = el; }}
          style={{ filter: s.outline === 'purple' ? tint(0.933, 0.51, 0.933) : tint(0.439, 0.627, 1), ...(s.outline === 'purple' ? {} : { opacity: s.outline === 'blue' ? 0.094 : 0 }) }}>
          <img src={img('images/timeline/ui/slot_outline.png')} />
        </div>
      </div>
    </div>
  );
}

/** epoch_offscreen_vfx: three additive indicator particles growing 0.75 → 2.25 (node scale 0.6). */
function Offscreen({ s }: { s: Slot }) {
  return (
    <div class="tl-offscreen" ref={(el) => { s.offEl = el; s.off = false; }} style={{ filter: tint(1, 0.3, 0.988) }}>
      {[0, 1, 2].map((i) => <img src={img('images/vfx/epoch_offscreen_indicator2.png')} style={{ animationDelay: `${-i}s` }} />)}
    </div>
  );
}

// ------------------------------------------------------------------ NEpochInspectScreen
/** StoryNav and the portrait Mask: under the chains canvas. */
function InspectUnder({ v }: { v: Insp }) {
  const mask = useRef<HTMLDivElement>(null), chapter = useRef<HTMLDivElement>(null), story = useRef<HTMLDivElement>(null);
  const portrait = useRef<HTMLDivElement>(null), flash = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null);
  const e = v.epoch;
  const title = fmt(e.Title);
  const chapterText = v.hasStory ? locv('timeline', 'EPOCH_INSPECT.chapterFormat', { ChapterIndex: safe(() => e.ChapterIndex, 0), ChapterName: title }) : title;
  useLayoutEffect(() => {
    if (v.page) return; // OpenViaPaginator: the mask is already in place, the labels are shown at once
    const [x, y, w, h] = v.from;
    anim(mask.current, [{ left: `${x}px` }, { left: '636px' }], 0.4, E.cubic);
    anim(mask.current, [{ top: `${y}px` }, { top: '217px' }], 0.4, E.expo);
    anim(mask.current, [{ width: `${w}px`, height: `${h}px` }, { width: '648px', height: '400px' }], 0.4, E.cubic);
    anim(chapter.current, [{ opacity: 0 }, { opacity: 1 }], 0.5, 'linear', 0.2);
    anim(story.current, [{ opacity: 0 }, { opacity: 1 }], 0.5, 'linear', 0.4);
    if (v.reveal) {
      // UnlockAnimation: portrait at s 0 v 0.75; at 2.0 the flash fades (0.5 s) and s / v go to 1 (1 s Expo Out)
      const kf = [{ filter: 'saturate(0) brightness(0.75)' }, { filter: 'saturate(1) brightness(1)' }];
      anim(portrait.current, kf, 1, E.expo, 2);
      flash.current?.animate([{ opacity: 1, filter: 'brightness(0.75)' }, { opacity: 0, filter: 'brightness(0.9)' }], { duration: 500, delay: 2000, fill: 'forwards' });
    }
  }, [v.page]);
  useLayoutEffect(() => { if (v.closing) anim(root.current, [{}, { opacity: 0, filter: 'brightness(0)' }], 0.5); }, [v.closing]);
  return (
    <div class="tl-insp" ref={root}>
      <div class="tl-story-nav">
        <div class={'tl-chapter' + (v.hasStory ? '' : ' bottom')} ref={chapter}>{chapterText}</div>
        <div class="tl-story" ref={story}>{v.hasStory ? safe(() => e.StoryTitle, '') : ''}</div>
      </div>
      <div class="tl-mask" ref={mask} style={{ maskImage: `url(${img('images/timeline/epoch_mask.png')})`, WebkitMaskImage: `url(${img('images/timeline/epoch_mask.png')})` }}>
        <div class="tl-big-portrait" ref={portrait} style={{ backgroundImage: `url(${img(safe(() => e.BigPortraitPath, ''))})` }} />
        <div class="tl-portrait-flash" ref={flash} />
        {safe(() => e.IsArtPlaceholder, false) && <div class="tl-placeholder">{loc('timeline', 'PLACEHOLDER_PORTRAIT')}</div>}
      </div>
    </div>
  );
}

/** FancyText, UnlockInfo, the Close / Continue button and the chapter arrows: over the chains canvas. */
function InspectOver({ v }: { v: Insp }) {
  const text = useRef<HTMLDivElement>(null), info = useRef<HTMLDivElement>(null), btn = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLDivElement>(null), next = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null);
  const tw = useRef<{ stop: () => void; done: boolean } | null>(null);
  const e = v.epoch;
  const desc = safe(() => e.Description, '');
  const unlockText = safe(() => e.UnlockText, '');
  useFit(text, `tlf|${desc}`, 24, 18, (el) => el.scrollHeight <= el.clientHeight + 1);
  /** SpeedUpTextAnimation: a click or Enter finishes the text tween at once. */
  const finishText = () => {
    const t = tw.current;
    if (!t || t.done) return;
    t.stop();
    t.done = true;
    text.current?.getAnimations().forEach((a) => a.finish());
    if (text.current) { text.current.style.opacity = '1'; for (const g of glyphs(text.current)) g.style.visibility = ''; }
  };
  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (v.reveal && !v.page) {
      // text α over 2 s from 2.25, visible_ratio over chars × 0.015 s from 2.5; Continue rises at 3.0
      el.style.opacity = '0';
      const gs = glyphs(el);
      for (const g of gs) g.style.visibility = 'hidden';
      const fade = anim(el, [{ opacity: 0 }, { opacity: 1 }], 2, 'linear', 2.25);
      let t = -2.5;
      const state = { done: false, stop: () => {} };
      state.stop = $.onFrame((dt: number) => {
        t += dt;
        const n = Math.max(0, Math.floor((t / Math.max(0.001, gs.length * 0.015)) * gs.length));
        gs.forEach((g, i) => { g.style.visibility = i < n ? '' : 'hidden'; });
        if (t >= gs.length * 0.015 && (!fade || fade.playState === 'finished')) { state.done = true; return false; }
        return !state.done;
      });
      tw.current = state;
      rise(btn.current, 3.0);
      setTimeout(() => { if (tl.insp === v && !v.closing) { v.closeOn = true; invalidate(); } }, 3300);
    } else {
      anim(el, [{ opacity: 0 }, { opacity: 1 }], 0.5, 'linear', 0.1);
      tw.current = { done: false, stop: () => {} };
      setTimeout(() => { if (tw.current) tw.current.done = true; }, 600);
      if (!v.page) {
        rise(btn.current, 0.1);
        setTimeout(() => { if (tl.insp === v && !v.closing) { v.closeOn = true; invalidate(); } }, 400);
        anim(info.current, [{ opacity: 0 }, { opacity: 0.8 }], 1);
      } else {
        // AnimInViaPaginator
        info.current?.getAnimations().forEach((a) => a.cancel());
        anim(info.current, [{ opacity: 0 }, { opacity: 0.8 }], 1);
      }
      if (!v.page) {
        anim(prev.current, [{ translate: '100px 0', opacity: 0 }, { translate: '0 0', opacity: 1 }], 0.25, E.back, 0.25);
        anim(next.current, [{ translate: '-100px 0', opacity: 0 }, { translate: '0 0', opacity: 1 }], 0.25, E.back, 0.25);
      }
    }
    return () => tw.current?.stop();
  }, [v.page]);
  useLayoutEffect(() => { if (v.closing) anim(root.current, [{}, { opacity: 0, filter: 'brightness(0)' }], 0.5); }, [v.closing]);
  // hotkeys: Enter / Esc close, ← / → page, Enter also finishes the text
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (tl.insp !== v || v.closing || tl.screens.length) return;
      if (ev.key === 'Enter') finishText();
      if ((ev.key === 'Escape' || ev.key === 'Enter') && v.closeOn) { ev.stopImmediatePropagation(); sfx('ui_timeline_close_epoch'); closeInspect(); }
      else if (ev.key === 'ArrowLeft' && v.prev && !v.reveal) page(v, v.prev);
      else if (ev.key === 'ArrowRight' && v.next && !v.reveal) page(v, v.next);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const arrows = v.hasStory && !v.reveal;
  return (
    <div class="tl-insp over" ref={root} onPointerUp={finishText}>
      <div class="tl-fancy" ref={text}><RichText key={v.page} text={`[center]${desc}[/center]`} /></div>
      <div class="tl-unlock-info" ref={info} style={{ opacity: 0 }}>
        <img src={img('images/packed/unlock_icon.png')} />
        <RichText text={unlockText} />
      </div>
      <div class="tl-close-pos" ref={btn}>
        <TimelineButton label={v.label} enabled={v.closeOn} exiting={v.closing} hoverScale={1.05} clickSfx="ui_timeline_close_epoch" onRelease={closeInspect} />
      </div>
      <div class="tl-page prev" ref={prev} style={{ visibility: arrows && v.prev ? 'visible' : 'hidden' }}>
        <EpochArrow left onClick={() => page(v, v.prev)} />
      </div>
      <div class="tl-page next" ref={next} style={{ visibility: arrows && v.next ? 'visible' : 'hidden' }}>
        <EpochArrow onClick={() => page(v, v.next)} />
      </div>
    </div>
  );
}
/** CloseButton / ConfirmButton entrance: from 180 px lower and transparent (α 0.3 s Cubic Out, y 0.3 s Back Out). */
function rise(el: HTMLElement | null, delay: number) {
  anim(el, [{ opacity: 0 }, { opacity: 1 }], 0.3, E.cubic, delay);
  anim(el, [{ translate: '0 180px' }, { translate: '0 0' }], 0.3, E.back, delay);
}

/**
 * NCloseButton / NUnlockConfirmButton / NAcknowledgeButton: reward_skip_button with its label (Kreon Bold 28, cream,
 * #1E424A outline). Hover 1.05 (or 1.1), unhover back over 0.5 s, press 0.95 (0.25 s Expo Out); leaving squashes it
 * to (3, 0.1) while it fades.
 */
function TimelineButton({ label, enabled, exiting, hoverScale, clickSfx: cs, onRelease }: { label: string; enabled: boolean; exiting?: boolean; hoverScale: number; clickSfx?: string; onRelease: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const scale = exiting ? '3 0.1' : st === 'hover' ? String(hoverScale) : st === 'press' ? '0.95' : '1';
  const t = exiting ? `scale .3s ${E.expo}, opacity .25s ${E.cubic}` : st === 'hover' ? 'scale .05s linear' : st === 'press' ? `scale .25s ${E.expo}` : `scale .5s ${hoverScale > 1.05 ? E.cubic : E.expo}`;
  return (
    <div class={'tl-btn' + (enabled ? '' : ' disabled')} style={{ scale, opacity: exiting ? 0 : 1, transition: t }}
      onPointerEnter={() => { if (!enabled) return; setSt('hover'); hoverSfx(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (!enabled || e.button !== 0) return; setSt('press'); if (cs) sfx(cs); else clickSfx(); }}
      onPointerUp={(e) => { if (!enabled || e.button !== 0 || st !== 'press') return; setSt(''); onRelease(); }}>
      <img src={img('images/ui/reward_screen/reward_skip_button.png')} />
      <div class="tl-btn-label">{label}</div>
    </div>
  );
}

/** NEpochPaginateButton (NGoldArrowButton with the timeline click): v 0.9, hover v 1.2 and 1.1×, press v 0.7. */
function EpochArrow({ left, onClick }: { left?: boolean; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const v = st === 'hover' ? 1.2 : st === 'press' ? 0.7 : 0.9;
  return (
    <div class="tl-arrow"
      onPointerEnter={() => { setSt('hover'); hoverSfx(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); sfx('ui_timeline_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); onClick(); } }}>
      <img src={img(`images/packed/common_ui/settings_tiny_${left ? 'left' : 'right'}_arrow.png`)}
        style={{ scale: st === 'hover' ? '1.1' : '1', filter: `brightness(${v})`, transition: st ? 'none' : `scale .5s ${E.expo}, filter 1s ${E.expo}`, transformOrigin: left ? '74px 64px' : '54px 64px' }} />
    </div>
  );
}

// ------------------------------------------------------------------ the fx canvas (chains, particles, bursts, skeletons)
let fxP: Promise<Application> | null = null;
const fxApp = () => (fxP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, resolution: renderResolution(), autoDensity: true });
  a.canvas.classList.add('tl-fx-canvas');
  fullView(a);
  // additive items add light but keep the (transparent) canvas alpha, so the page composites them as additive too
  const gl = (a.renderer as any).gl as WebGL2RenderingContext | undefined, map = (a.renderer as any).state?.blendModesMap;
  if (gl && map) map.add = [gl.ONE, gl.ONE, gl.ZERO, gl.ONE, gl.FUNC_ADD, gl.FUNC_ADD];
  return a;
})());
function FxLayer() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false;
    void fxApp().then((a) => { if (!dead) { host.current?.appendChild(a.canvas); a.ticker.start(); } });
    return () => {
      dead = true;
      void fxApp().then((a) => {
        for (const c of a.stage.removeChildren()) c.destroy({ children: true });
        a.ticker.stop();
        a.canvas.remove();
      });
    };
  }, []);
  return <div class="tl-fx" ref={host} />;
}
async function fxStage() { return (await fxApp()).stage; }

// Godot Curve sampling (points [x, y, left tangent, right tangent]; cubic Bézier in y between points)
type Pt = [number, number, number, number];
function curve(pts: Pt[], x: number) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x > b[0]) continue;
    const d = b[0] - a[0], t = (x - a[0]) / d, u = 1 - t;
    const c1 = a[1] + (a[3] * d) / 3, c2 = b[1] - (b[2] * d) / 3;
    return u * u * u * a[1] + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * b[1];
  }
  return pts[pts.length - 1][1];
}
const BRIGHT: Pt[] = [[0, 0, 0, 0], [0.40229884, 1, 0.50190777, 0]];
const ERODE_ON: Pt[] = [[0.84137934, 0, 0, 0], [0.85287356, 1, 0, 0]];
const ERODE_BASE: Pt[] = [[0.85057473, -0.1, 0, 7.476566], [1, 1, 6.879236, 0]];
/** The chains' particle containers (epoch_inspect_screen.tscn's overrides of the common VFX scenes). */
const CHAIN_VFX: Record<'shine' | 'mid' | 'end', [string, Record<string, any>][]> = {
  shine: [['common/vfx_common_specks', { amount: 12, life: 1, explo: 0.75 }], ['common/vfx_common_ray', { amount: 6, life: 0.7, explo: 1, src: 'images/vfx/common/common_ray_no_glow.png', a: 1 }],
    ['common/vfx_common_ring_polar_a', { life: 0.5, a: 0.502 }], ['common/vfx_common_glow', { life: 0.75, a: 0.251 }]],
  mid: [['common/vfx_common_specks', { amount: 20, life: 0.75, explo: 0.9 }], ['ui/vfx_ui_epoch_unlock_chain_shards', { amount: 6, life: 0.5, explo: 0.9 }]],
  end: [['ui/vfx_ui_epoch_unlock_chain_shards', { amount: 6, life: 1.5 }], ['common/vfx_common_glow', { life: 0.5, a: 0.251 }],
    ['common/vfx_common_specks', { amount: 40, life: 1, explo: 0.9 }], ['common/vfx_common_ring_polar_a', { life: 0.35 }]],
};
/** NParticlesContainer.Restart at the chains' centre (960, 422). */
async function burst(which: keyof typeof CHAIN_VFX, parent: Container) {
  for (const [path, o] of CHAIN_VFX[which]) {
    const s = await loadScene(`scenes/vfx/${path}.tscn`);
    if (!s || parent.destroyed) continue;
    const items = s.items.map((it: any) => it.k !== 'particles' ? it : {
      ...it, emitting: true, amount: o.amount ?? it.amount, life: o.life ?? it.life, explo: o.explo ?? it.explo, src: o.src ?? it.src,
      color: o.a != null ? [...(it.color ?? [1, 1, 1, 1]).slice(0, 3), (it.color?.[3] ?? 1) * o.a] : it.color,
    });
    const c = buildScene({ ...s, items });
    c.setFromMatrix(new Matrix().translate(960, 422).append(rootMatrix(s, 0, 0)));
    parent.addChild(c);
    setTimeout(() => { if (!c.destroyed) { c.parent?.removeChild(c); c.destroy({ children: true }); } }, 3000);
  }
}
/**
 * UnlockAnimation's chains: epoch_slot_locked (keep aspect in (599, 199)–(1321, 645)) drawn with
 * vfx_ui_epoch_unlock_chains; 0.98× over 0.5–1.0 s, then NEpochChains.Unlocking over 1 s (whiten, the shine and
 * mid particles, erosion) and the end particles as it vanishes.
 */
async function chainsAnimation(v: Insp) {
  const gen = tl.gen;
  const [stage, sh, tex, ero] = await Promise.all([fxStage(), loadShader('shaders/vfx/ui/vfx_ui_epoch_unlock_chains_shader.gdshader'),
    sceneTexture('images/packed/timeline/epoch_slot_locked.png'), sceneTexture('images/vfx/ui/epoch_unlock/ui_epoch_unlock_erosion_exact.png')]);
  if (gen !== tl.gen || tl.insp !== v || !tex) return;
  const root = new Container();
  const pivot = new Container();
  pivot.position.set(960, 422);
  root.addChild(pivot);
  stage.addChild(root);
  const w = 446 * (924 / 590), x0 = 599 + (722 - w) / 2 - 960, y0 = 199 - 422;
  const params = { erosion_texture: ero ?? undefined, bright_color: [1, 1, 1, 1], bright_energy: 1, bright_enabled: 0, erosion_enabled: 0, erosion_base: -0.1, erosion_offset: 0.05 } as any;
  const q = sh ? new QuadBatch(1, sh, tex, params) : null;
  if (q) {
    q.quad(0, [x0, y0, x0 + w, y0, x0 + w, y0 + 446, x0, y0 + 446], 0, 0, 1, 1, 1, 1, 1, 1);
    q.flush();
    pivot.addChild(q);
  }
  const set = (u: number) => {
    if (!q) return;
    q.group.uniforms.bright_enabled = curve(BRIGHT, u);
    q.group.uniforms.erosion_enabled = curve(ERODE_ON, u);
    q.group.uniforms.erosion_base = curve(ERODE_BASE, u);
    q.group.update();
  };
  const alive = () => gen === tl.gen && tl.insp === v && !root.destroyed;
  // 0.5–1.0 s: 0.98 (Expo Out)
  let t = 0, shine = false, mid = false;
  await new Promise<void>((done) => $.onFrame((dt: number) => {
    if (!alive()) { done(); return false; }
    t += dt;
    const k = Math.min(1, Math.max(0, (t - 0.5) / 0.5));
    pivot.scale.set(1 - 0.02 * (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)));
    if (t < 1) return true;
    // 1.0–2.0 s: Unlocking
    const u = Math.min(1, t - 1);
    set(u);
    if (!shine && u >= 0.301) { shine = true; void burst('shine', pivot.parent!); }
    if (!mid && u >= 0.895) { mid = true; void burst('mid', pivot.parent!); }
    if (u < 1) return true;
    done();
    return false;
  }));
  if (!alive()) return;
  if (q) q.visible = false;
  void burst('end', root);
  // freed with the inspect screen
  $.onFrame(() => {
    if (tl.insp === v && gen === tl.gen) return true;
    root.parent?.removeChild(root);
    root.destroy({ children: true });
    return false;
  });
}

// ------------------------------------------------------------------ stars (the menu's canvas, under the DOM)
/** BgColorOverlay is DOM; StarsBg / StarsFg (timeline_screen.tscn's particles) go on the main menu's Pixi stage. */
function mountStars() {
  let root: Container | null = null, dead = false, off = () => {};
  void Promise.all([getApp(), loadScene('scenes/timeline_screen/timeline_screen.tscn')]).then(([a, s]) => {
    if (dead || !s) return;
    const r = (root = buildScene(s, (p) => p === 'StarsBg' || p === 'StarsFg'));
    // Node2Ds placed from the screen's top-left corner (the stars drift in from its left edge)
    const place = () => r.setFromMatrix(rootMatrix(s, 1920, 1080).translate(-view.ox, -view.oy));
    place();
    off = onViewChange(place);
    a.stage.addChild(r);
  });
  return () => { dead = true; off(); if (root) { root.parent?.removeChild(root); root.destroy({ children: true }); } };
}

// ------------------------------------------------------------------ NUnlockScreens
const BURST_SCENE: Record<string, string> = {
  cards: 'unlock_cards_screen', relics: 'unlock_relics_screen', potions: 'unlock_potions_screen', character: 'unlock_character_screen', misc: 'unlock_misc_screen',
};
function UnlockScreen({ s }: { s: Screen }) {
  const root = useRef<HTMLDivElement>(null);
  // the burst (and the character's glow and skeleton) on the fx canvas
  useEffect(() => {
    if (s.kind === 'timeline') return;
    let dead = false;
    const fx = new Container();
    s.fx = fx;
    void Promise.all([fxStage(), loadScene(`scenes/timeline_screen/${BURST_SCENE[s.kind]}.tscn`)]).then(async ([stage, sc]) => {
      if (dead) return;
      stage.addChild(fx);
      if (sc) {
        const c = buildScene(sc, (p) => p === 'GPUParticles2D');
        c.setFromMatrix(rootMatrix(sc, 1920, 1080));
        fx.addChild(c);
      }
      if (s.kind !== 'character') return;
      const id = String(s.char.Id.Entry).toLowerCase();
      const cs = await creatureSpine(`scenes/creature_visuals/${id}.tscn`);
      if (dead || !cs) return;
      // SpineAnchor at (955, 697): black → white (0.25 s from 0.25); idle, attack after 0.5 s, idle
      cs.root.position.set(955, 697);
      cs.root.tint = 0x000000;
      cs.root.alpha = 0;
      fx.addChild(cs.root);
      if (cs.spine && cs.names.includes('attack')) {
        cs.spine.state.addAnimation(0, 'attack', false, 0.5);
        if (cs.names.includes('idle_loop')) cs.spine.state.addAnimation(0, 'idle_loop', true, 0);
      }
      let t = 0;
      $.onFrame((dt: number) => {
        if (cs.root.destroyed) return false;
        t += dt;
        const k = Math.round(255 * Math.min(1, Math.max(0, (t - 0.25) / 0.25)));
        cs.root.tint = (k << 16) | (k << 8) | k;
        cs.root.alpha = k / 255;
        return k < 255;
      });
      if (sc) {
        const g = buildScene({ ...sc, items: sc.items.map((it: any) => (it.p === 'RareGlow' ? { ...it, color: [...it.color.slice(0, 3), 1] } : it)) }, (p) => p === 'RareGlow');
        g.setFromMatrix(rootMatrix(sc, 1920, 1080));
        g.alpha = 0;
        fx.addChildAt(g, fx.getChildIndex(cs.root)); // RareGlow is drawn under SpineAnchor
        let gt = 0;
        $.onFrame((dt: number) => {
          if (g.destroyed) return false;
          gt += dt;
          g.alpha = s.closing ? Math.max(0, g.alpha - dt / 0.5) : Math.min(1, Math.max(0, (gt - 1) / 0.5));
          return true;
        });
      }
    });
    return () => { dead = true; fx.parent?.removeChild(fx); fx.destroy({ children: true }); };
  }, []);
  useLayoutEffect(() => {
    if (!s.closing || !root.current) return;
    // Close: modulate → transparent black over 1 s (freed when the next screen opens / the backstop is gone)
    anim(root.current, [{}, { opacity: 0, filter: 'brightness(0)' }], 1);
    if (s.fx) { const fx = s.fx; let t = 0; $.onFrame((dt: number) => { if (fx.destroyed) return false; t += dt; fx.alpha = Math.max(0, 1 - t); return t < 1; }); }
  }, [s.closing]);
  // hotkeys: Enter / Esc confirm
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!s.confirm || s.closing || tl.screens[tl.screens.length - 1] !== s) return;
      if (e.key === 'Enter' || e.key === 'Escape') { e.stopImmediatePropagation(); clickSfx(); void closeScreen(s); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (s.kind === 'timeline') return null;
  const banner = { cards: 'UNLOCK_CARDS_BANNER', relics: 'UNLOCK_RELICS_BANNER', potions: 'UNLOCK_POTIONS_BANNER' } as Record<string, string>;
  const text = { cards: 'UNLOCK_CARDS', relics: 'UNLOCK_RELICS', potions: 'UNLOCK_POTIONS' } as Record<string, string>;
  return (
    <div class="tl-unlock" ref={root}>
      {banner[s.kind] && <CommonBanner text={loc('timeline', banner[s.kind])} />}
      {s.kind === 'cards' && <CardRow cards={s.items} />}
      {s.kind === 'relics' && <RelicRow relics={s.items} />}
      {s.kind === 'potions' && <PotionRow potions={s.items} />}
      {text[s.kind] && <div class="tl-explanation"><RichText text={`[center]${loc('timeline', text[s.kind])}[/center]`} /></div>}
      {s.kind === 'character' && (
        <>
          <div class="tl-char-top"><RichText text={`[center]${loc('epochs', `${s.epoch.Id}.unlock`)}[/center]`} /></div>
          <div class="tl-char-bottom"><RichText text={`[center]${loc('epochs', `${s.epoch.Id}.unlockText`)}[/center]`} /></div>
        </>
      )}
      {s.kind === 'misc' && <div class="tl-misc"><RichText text={s.text} /></div>}
      <div class="tl-confirm-pos" ref={(el) => { if (el && !el.dataset.risen) { el.dataset.risen = '1'; rise(el, 0.1); } }}>
        <TimelineButton label={loc('timeline', 'UNLOCK_CONFIRM')} enabled={s.confirm} exiting={s.closing} hoverScale={1.1} onRelease={() => void closeScreen(s)} />
      </div>
    </div>
  );
}
/**
 * NUnlockCardsScreen: cards (NGridCardHolder at 0.8) fan out 350 apart from the centre (0.5 s Expo Out), black → white
 * (1 s Cubic Out), each with NCard.ActivateRewardScreenGlow.
 */
function CardRow({ cards }: { cards: any[] }) {
  const els = useRef<(HTMLDivElement | null)[]>([]), t0 = useRef(performance.now());
  const glowProps = { cards, slots: () => els.current, fade: () => 1 - (1 - Math.min((performance.now() - t0.current) / 1000, 1)) ** 3 };
  return (
    <>
      <RewardGlows {...glowProps} layer="glow" />
      {cards.map((c, i) => {
        const x = 350 * (i - (cards.length - 1) / 2);
        return (
          <div class="tl-card" ref={(el) => {
            els.current[i] = el;
            if (!el || el.dataset.in) return;
            el.dataset.in = '1';
            anim(el, [{ translate: '0 0' }, { translate: `${x}px 0` }], 0.5, E.expo);
            anim(el, [{ filter: 'brightness(0)' }, { filter: 'brightness(1)' }], 1, E.cubic);
          }}><Card card={c} width={240} /></div>
        );
      })}
      <RewardGlows {...glowProps} layer="over" />
    </>
  );
}
/** NUnlockRelicsScreen: NRelicBasicHolders ×3, 350 apart; hover: the icon 1.25× and the relic's tips. */
function RelicRow({ relics }: { relics: any[] }) {
  return (
    <>
      {relics.map((r, i) => <UnlockItem key={i} x={960 - 350 * (relics.length - 1) / 2 + 350 * i} y={540} size={68} inset={4} frame={atlasFrame(safe(() => r.IconPath, ''))} tips={r} />)}
    </>
  );
}
/** NUnlockPotionsScreen: NPotionHolders ×3 at −350 / 0 / +350 (the code assumes three). */
function PotionRow({ potions }: { potions: any[] }) {
  return (
    <>
      {potions.map((p, i) => <UnlockItem key={i} x={960 + 350 * (i - 1)} y={540} size={60} inset={0} frame={atlasFrame(safe(() => p.ImagePath, ''))} />)}
    </>
  );
}
function UnlockItem({ x, y, size, inset, frame, tips }: { x: number; y: number; size: number; inset: number; frame: any; tips?: any }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    anim(ref.current, [{ translate: `${960 - x}px ${540 - y}px` }, { translate: '0 0' }], 0.5, E.expo);
    anim(ref.current, [{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], 1, E.cubic);
  }, []);
  return (
    <div class="tl-item" ref={ref} style={{ left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` }}
      onPointerEnter={() => { if (!tips) return; setHover(true); hoverSfx(); const r = logicalRect(ref.current); if (r) setTips(hoverTipsOf(tips), { kind: 'relic', rect: r }); }}
      onPointerLeave={() => { if (!tips) return; setHover(false); setTip(null); }}>
      <div style={{ ...frameStyle(frame, size - 2 * inset, size - 2 * inset), position: 'absolute', left: `${inset}px`, top: `${inset}px`,
        scale: hover ? '1.25' : '1', transition: hover ? 'scale .05s linear' : `scale 1s ${E.expo}` }} />
    </div>
  );
}

// ------------------------------------------------------------------ NTimelineTutorial
function Tutorial({ t }: { t: { closing: boolean; enabled: boolean } }) {
  const text = useRef<HTMLDivElement>(null), btn = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    // visible_ratio 0 → 1 over 2 s (Quad Out) with α over 1 s; Proceed enabled at 2 s, rising to y 920 at 3 s
    const gs = glyphs(el);
    let time = 0;
    const stop = $.onFrame((dt: number) => {
      time += dt;
      const k = Math.min(1, time / 2), r = 1 - (1 - k) * (1 - k);
      const n = Math.round(r * gs.length);
      gs.forEach((g, i) => { g.style.visibility = i < n ? '' : 'hidden'; });
      return k < 1;
    });
    anim(el, [{ opacity: 0 }, { opacity: 1 }], 1);
    anim(btn.current, [{ top: `${1100 + view.oy}px` }, { top: `${920 - view.oy}px` }], 0.3, E.back, 3);
    const h = setTimeout(() => { t.enabled = true; invalidate(); }, 2000);
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' && t.enabled) { sfx('ui_timeline_close_epoch'); void closeTutorial(); } };
    window.addEventListener('keydown', key);
    return () => { stop(); clearTimeout(h); window.removeEventListener('keydown', key); };
  }, []);
  useLayoutEffect(() => { if (t.closing) anim(root.current, [{}, { opacity: 0 }], 0.5); }, [t.closing]);
  return (
    <div class="tl-tutorial" ref={root}>
      <div class="tl-tutorial-text" ref={text}><RichText text={`[center]${loc('timeline', 'TUTORIAL_TEXT')}[/center]`} /></div>
      <div class="tl-ack-pos" ref={btn}>
        <TimelineButton label={loc('timeline', 'ACKNOWLEDGE_BUTTON')} enabled={t.enabled} hoverScale={1.05} clickSfx="ui_timeline_close_epoch" onRelease={() => void closeTutorial()} />
      </div>
    </div>
  );
}
