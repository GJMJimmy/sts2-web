// NMapScreen (in GlobalUi, above the overlay stack and under the top bar): the act map, scrolled with the original
// drag / wheel lerp and rubber band, the start-of-act scroll, open / close tweens, travel (circle, path dots, marker,
// room fade), the legend, the drawing tools and map drawings, and NActBanner. Coordinates are TheMap's: a 1920 × 1080
// control at y = T whose paper (three act textures) spans y −1620…1620; nodes carry the Godot anchor quirk (+960, +540).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { closeCardsView } from './pause';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Application, Assets, ColorMatrixFilter, Container } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { G, $, list } from '../game';
import { ui, invalidate } from '../store';
import { A, frameByName, frameStyle, imageUrl } from '../assets';
import { playOneShot } from '../audio';
import { loc, locv } from '../i18n';
import { setTip, setTips } from './tooltip';
import { BackButton } from './buttons';
import { playSpriteVfx } from '../render/scene';
import { floorTipData, FloorTipPanel, type FloorTipData } from './history';
import { seenFtue, showFtue } from './ftue';
import { transitionView } from './transition';
import { wheelDrag } from './scrollbar';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const TR = { Linear: 0, Sine: 1, Quad: 4, Expo: 5, Elastic: 6, Cubic: 7, Back: 10 }, EZ = { In: 0, Out: 1, InOut: 2 };
/** MapPointState */
const St = { None: 0, Travelable: 1, Traveled: 2, Untravelable: 3 };
const fastMode = () => safe(() => G.SaveManager.Instance.PrefsSave.FastMode, G.FastModeType.Normal);
const rs = () => G.RunManager.Instance.State;
const css = (c: any, a = c?.A ?? 1) => (c ? `rgba(${Math.round(c.R * 255)},${Math.round(c.G * 255)},${Math.round(c.B * 255)},${a})` : 'transparent');
const hex = (h: string) => ({ R: parseInt(h.slice(1, 3), 16) / 255, G: parseInt(h.slice(3, 5), 16) / 255, B: parseInt(h.slice(5, 7), 16) / 255, A: h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1 });
const PATH_DOT_TRAVELED = hex('#241F1A'), BOSS_NODE_UNTRAVELED = hex('#7D6A55D8'), OUTLINE_HOVER = { R: 1, G: 1, B: 1, A: 0.75 };
const gauss = (sd: number) => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()) * sd;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const keyOf = (c: any) => `${c.col},${c.row}`;
class V2 { constructor(public X = 0, public Y = 0) {} }
const finished = (t: any) => new Promise<void>((done) => t.whenFinished(done));

// ------------------------------------------------------------------ state
type Kind = 'normal' | 'ancient' | 'boss';
type Anim = 'instant' | 'hover' | 'unhover' | 'press' | 'select';
interface MapNode {
  p: any; key: string; kind: Kind;
  x: number; y: number; w: number; h: number; scale: number; angle: number; // top-left in TheMap, size, boss scale, icon tilt
  state: number; phase: number; Pulse: number; focus: boolean; anim: Anim; Hover: number;
  circle: { rot: number; s: number; play: boolean } | null;
  el: HTMLElement | null; // what the pulse scales (icon container / ancient root)
}
interface Dot { x: number; y: number; flip: boolean; rot: number; color: any; s: number; t0: number }
interface Banner { id: number; act: any; index: number; o: { A: number; BandA: number; NameA: number; NumA: number; NumY: number } }
type Mode = 'none' | 'draw' | 'erase';

const S = {
  map: null as any, seed: 0,
  nodes: [] as MapNode[], byKey: new Map<string, MapNode>(),
  boss: null as MapNode | null, boss2: null as MapNode | null, start: null as MapNode | null,
  paths: new Map<string, Dot[]>(), distY: 0,
  isOpen: false, visible: false, travelEnabled: false, debugTravel: false, traveling: false,
  target: -600, dragging: false,
  actTween: null as any, canInterrupt: false, inputDisabled: false, hasPlayedAnimation: false, tween: null as any,
  mode: 'none' as Mode, held: false, line: null as number[] | null,
  highlight: -1,
  press: null as null | { n: MapNode; x: number; y: number; cancelled: boolean },
  banners: [] as Banner[],
  /** NMapPointHistoryHoverTip of the focused traveled point. */
  floorTip: null as null | { d: FloorTipData; cell: [number, number]; w: number },
};
const clearTips = () => { setTip(null); S.floorTip = null; };
/** Tweened screen values (Pascal keys: WebTween paths like "map_y"). V = modulate rgb, A = alpha. */
const fx = { MapY: -600, MapV: 1, MapA: 1, BackstopA: 0, PointsA: 1, LegendX: 1536, LegendV: 1, LegendA: 1, ToolsV: 1, ToolsA: 1 };
/** NMapMarker (single player only): 40 × 40, 35 px above the node. */
const marker = { visible: false, Position: new V2(), Scale: new V2(1, 1), tween: null as any };

const nodeAt = (c: any) => (c ? S.byKey.get(keyOf(c)) ?? null : null);
const inputAllowed = () => !S.traveling && S.mode === 'none';
const travelable = (n: MapNode) => (S.debugTravel && !S.traveling) || (S.travelEnabled && n.state === St.Travelable);
const pivot = (n: MapNode) => (n.kind === 'normal' ? [28, 28] : n.kind === 'ancient' ? [104, 104] : [187, 153]);

// ------------------------------------------------------------------ NMapScreen.SetMap
export function setMap(map: any, seed: number, clearDrawings: boolean) {
  const r = rs();
  S.map = map; S.seed = seed >>> 0;
  S.nodes = []; S.byKey.clear(); S.paths.clear();
  marker.visible = false;
  if (clearDrawings) drawings.clearAll();
  S.hasPlayedAnimation = false;
  const rows = map.GetRowCount(), cols = map.GetColumnCount();
  const k = map.SecondBossMapPoint != null ? 0.9 : 1;
  S.distY = (2325 / (rows - 1)) * k;
  const distX = 1050 / cols;
  const rng = new G.Rng().$ctor_Rng$UInt32_String(S.seed || r.Rng.Seed, `map_jitter_${r.CurrentActIndex}`);
  const add = (p: any, kind: Kind, x: number, y: number, w: number, h: number, scale = 1, angle = 0) => {
    const n: MapNode = { p, key: keyOf(p.coord), kind, x, y, w, h, scale, angle, state: St.Untravelable, phase: Math.random() * 3140, Pulse: 1, focus: false, anim: 'instant', Hover: 1, circle: null, el: null };
    S.nodes.push(n); S.byKey.set(n.key, n);
    return n;
  };
  // Position set before the node enters the tree: its centre anchors add (960, 540)
  for (const p of list(map.GetAllMapPoints())) {
    const jx = rng.NextFloat$2(-21, 21), jy = rng.NextFloat$2(-25, 25);
    add(p, 'normal', p.coord.col * distX - 500 + jx + 960, -p.coord.row * S.distY + 740 + jy + 540, 56, 56, 1, gauss(8));
  }
  S.boss = add(map.BossMapPoint, 'boss', 760, -1980 * k + 540, 374, 306, map.SecondBossMapPoint ? 0.75 : 1);
  S.boss2 = map.SecondBossMapPoint ? add(map.SecondBossMapPoint, 'boss', 760, -2280 * k + 540, 374, 306, 0.75) : null;
  const st = map.StartingMapPoint;
  S.start = st.PointType === G.MapPointType.Ancient
    ? add(st, 'ancient', 880, -st.coord.row * S.distY + 720 + 540, 208, 208)
    : add(st, 'normal', 880, -st.coord.row * S.distY + 800 + 540, 56, 56);
  const untraveled = safe(() => r.Act.MapUntraveledColor, PATH_DOT_TRAVELED);
  // NMapScreen.GetLineEndpoint: normal nodes use their Position, the others their centre (the dots add 28 either way)
  const end = (n: MapNode) => (n.kind === 'normal' ? [n.x, n.y] : [n.x + n.w / 2, n.y + n.h / 2]);
  const drawPaths = (n: MapNode) => {
    for (const ch of list(n.p.Children)) {
      const c = nodeAt(ch.coord);
      if (!c) continue;
      const [sx, sy] = end(n), [ex, ey] = end(c);
      const len = Math.hypot(ex - sx, ey - sy), vx = (ex - sx) / len, vy = (ey - sy) / len;
      const ang = Math.atan2(vy, vx) + Math.PI / 2, count = Math.trunc(len / 22) + 1;
      const dots: Dot[] = [];
      for (let i = 1; i < count; i++) {
        const d = i * 22;
        dots.push({ x: sx + vx * d + 28 + rand(-3, 3), y: sy + vy * d + 28 + rand(-3, 3), flip: Math.random() < 0.5, rot: ang + gauss(0.1), color: untraveled, s: 1, t0: 0 });
      }
      S.paths.set(`${n.key}>${c.key}`, dots);
    }
  };
  for (const n of S.nodes) if (n.kind === 'normal' && n !== S.start) drawPaths(n);
  drawPaths(S.start);
  drawPaths(S.boss);
  const visited = list(r.VisitedMapCoords);
  const traveled = safe(() => r.Act.MapTraveledColor, PATH_DOT_TRAVELED);
  for (let i = 0; i < visited.length - 1; i++) for (const d of S.paths.get(`${keyOf(visited[i])}>${keyOf(visited[i + 1])}`) ?? []) { d.color = traveled; d.s = 1.2; }
  if (S.visible) { recalcTravelability(); refreshAllPointVisuals(); }
  pixi.reset();
  invalidate();
}

/** NMapScreen.RecalculateTravelability. */
function recalcTravelability() {
  const r = rs(), visited = list(r.VisitedMapCoords);
  const set = (n: MapNode | null, s: number) => { if (n && n.state !== s) { n.state = s; refreshVisuals(n); } };
  if (!visited.length) { set(S.start, St.Travelable); return; }
  for (const n of S.nodes) set(n, St.Untravelable);
  for (const c of visited) set(nodeAt(c), St.Traveled);
  const last = visited[visited.length - 1];
  if (S.boss2 && S.boss && keyOf(last) === S.boss.key) { set(S.boss2, St.Travelable); return; }
  if (last.row !== S.map.GetRowCount() - 1) {
    const flight = safe(() => list(r.Modifiers).some((m: any) => m instanceof G.Flight), false);
    const next = flight ? list(S.map.GetPointsInRow(last.row + 1)) : list(nodeAt(last)?.p.Children ?? []);
    for (const p of next) set(nodeAt(p.coord), St.Travelable);
    return;
  }
  set(S.boss, St.Travelable);
}
/** NMapPoint.RefreshVisualsInstantly: colour, enabled state, the traveled circle; the pulse resets. */
function refreshVisuals(n: MapNode) {
  n.anim = 'instant';
  if (n.kind === 'normal' && n.state === St.Traveled && !n.circle) n.circle = { rot: rand(0, 360), s: rand(0.85, 0.9), play: false };
  if (!n.focus) n.Pulse = 1;
}
function refreshAllPointVisuals() { for (const n of S.nodes) refreshVisuals(n); invalidate(); }

// ------------------------------------------------------------------ open / close
export function openMap(fromTopBar = false) {
  if (S.isOpen) return;
  const r = rs();
  S.isOpen = true; S.visible = true; ui.mapOpen = true;
  // NBackButton: moved to its hidden position, then enabled when past the act's first floor (it slides in)
  back.enabled = false;
  if (safe(() => r.ActFloor > 0, false)) requestAnimationFrame(() => { if (S.isOpen) { back.enabled = true; invalidate(); } });
  if (G.RunManager.Instance.IsSinglePlayerOrFakeMultiplayer) safe(() => G.CombatManager.Instance.Pause(), undefined);
  const neow = safe(() => r.CurrentActIndex === 0 && r.ExtraFields.StartedWithNeow, false);
  if ((neow ? r.ActFloor === 1 : r.ActFloor === 0) && !S.hasPlayedAnimation) {
    if (!fromTopBar && (fastMode() < G.FastModeType.Fast || !seenFtue('map_select_ftue'))) playStartOfActAnimation();
    else { S.hasPlayedAnimation = true; fx.MapY = S.target = -600; spawnActBanner(r.Act, r.CurrentActIndex); }
  } else {
    const row = safe(() => r.CurrentMapCoord?.row ?? 0, 0);
    fx.MapY = S.target = -600 + row * S.distY;
    fx.PointsA = 0; fx.BackstopA = 0; fx.LegendV = fx.LegendA = 0; fx.ToolsV = fx.ToolsA = 0;
  }
  fx.LegendA = 0; fx.ToolsA = 0;
  S.tween?.Kill();
  const t = (S.tween = new $.WebTween().SetParallel());
  t.TweenProperty(fx, 'backstop_a', 0.85, 0.25);
  t.TweenProperty(fx, 'map_v', 1, 0.25).From(0);
  t.TweenProperty(fx, 'map_a', 1, 0.25).From(0);
  t.TweenProperty(fx, 'legend_v', 1, 0.25).SetDelay(0.1);
  t.TweenProperty(fx, 'legend_a', 1, 0.25).SetDelay(0.1);
  t.TweenProperty(fx, 'legend_x', 1536, 0.25).From(1656).SetEase(EZ.Out).SetTrans(TR.Back).SetDelay(0.1);
  t.TweenProperty(fx, 'tools_v', 1, 0.25).SetDelay(0.2);
  t.TweenProperty(fx, 'tools_a', 1, 0.25).SetDelay(0.2);
  t.TweenProperty(fx, 'points_a', 1, 0.25).SetDelay(0.1);
  recalcTravelability();
  const visited = list(r.VisitedMapCoords);
  if (visited.length) {
    const last = visited[visited.length - 1];
    if (S.boss && S.start && S.boss.p.coord.row !== last.row && S.start.p.coord.row !== last.row) setMarker(nodeAt(last));
  }
  playOneShot('event:/sfx/ui/map/map_open');
  signalOpenedClosed();
  startLoop();
  invalidate();
}
export function closeMap(animateOut = true) {
  if (!S.isOpen) return;
  S.isOpen = false; ui.mapOpen = false;
  if (G.RunManager.Instance.IsSinglePlayerOrFakeMultiplayer) safe(() => G.CombatManager.Instance.Unpause(), undefined);
  back.enabled = false;
  signalOpenedClosed();
  if (animateOut) {
    S.tween?.Kill();
    const t = (S.tween = new $.WebTween().SetParallel());
    t.TweenProperty(fx, 'backstop_a', 0, 0.15);
    t.TweenProperty(fx, 'points_a', 0, 0.15);
    t.TweenProperty(fx, 'map_v', 0, 0.25).SetDelay(0.1);
    t.TweenProperty(fx, 'map_a', 0, 0.25).SetDelay(0.1);
    t.TweenProperty(fx, 'map_y', fx.MapY + 200, 0.25).SetEase(EZ.Out).SetTrans(TR.Cubic);
    t.TweenProperty(fx, 'legend_a', 0, 0.15);
    t.TweenProperty(fx, 'legend_x', 1656, 0.25).SetEase(EZ.Out).SetTrans(TR.Cubic);
    t.TweenProperty(fx, 'tools_a', 0, 0.15);
    t.whenFinished(() => hide());
    playOneShot('event:/sfx/ui/map/map_close');
  } else hide();
  invalidate();
}
/** Visible = false (NMapScreen.OnVisibilityChanged). */
function hide() {
  S.visible = false; S.dragging = false;
  stopDrawing();
  clearTips();
  invalidate();
}
/** NOverlayStack hides / shows the overlays and NMerchantRoom swaps its music track on Opened / Closed. */
function signalOpenedClosed() {
  if (ui.room?.kind === 'shop') safe(() => G.NRunMusicController?.Instance?.ToggleMerchantTrack?.(), undefined);
}
export const isMapVisible = () => S.visible;
/** A new run or the main menu: the run's NMapScreen goes away with it. */
export function resetMap() {
  S.tween?.Kill(); S.actTween?.Kill();
  S.actTween = null; S.isOpen = false; ui.mapOpen = false; S.banners = [];
  hide();
}
/** NTopBarMapButton.OnRelease (and the map hotkey). */
export function topBarMapPressed() {
  if (S.visible) {
    if (ui.cardsView) closeCardsView();
    else closeMap();
  } else {
    closeCardsView();
    openMap(true);
  }
  invalidate();
}

// ------------------------------------------------------------------ start of act
function playStartOfActAnimation() {
  if (S.hasPlayedAnimation) return;
  S.hasPlayedAnimation = true;
  const r = rs();
  spawnActBanner(r.Act, r.CurrentActIndex);
  void startOfActAnim();
}
async function startOfActAnim() {
  const fast = fastMode() === G.FastModeType.Fast, delay = fast ? 0.5 : 1, dur = fast ? 1.5 : 3;
  fx.MapY = 1800;
  S.actTween?.Kill();
  const t = (S.actTween = new $.WebTween().SetParallel());
  t.TweenInterval(delay);
  t.Chain();
  t.TweenProperty(fx, 'map_y', -600, dur).SetEase(EZ.InOut).SetTrans(TR.Expo);
  t.TweenCallback(() => { S.canInterrupt = true; }).SetDelay(dur * 0.25);
  S.target = -600;
  await finished(t);
  S.actTween = null;
  initMapPrompt();
}
function initMapPrompt() {
  if (!seenFtue('map_select_ftue')) setTimeout(() => { void showFtue('map_select_ftue', 'MAP_SELECT'); }, 100);
}
const actAnimRunning = () => !!S.actTween?.IsRunning();
const canScroll = () => (S.actTween == null || S.canInterrupt) && !S.inputDisabled;
function tryCancelStartOfActAnim() {
  if (!S.actTween || !S.canInterrupt) return;
  S.actTween.Kill();
  S.actTween = null; S.canInterrupt = false; S.dragging = false; S.target = -600;
  S.inputDisabled = true;
  stopDrawing();
  setTimeout(() => { S.inputDisabled = false; initMapPrompt(); }, 200);
}

// ------------------------------------------------------------------ travel
export function setTravelEnabled(b: boolean) {
  S.travelEnabled = b && safe(() => G.Hook.ShouldProceedToNextMapPoint(rs()), true);
  refreshAllPointVisuals();
}
export function setDebugTravelEnabled(b: boolean) { S.debugTravel = b; refreshAllPointVisuals(); }
export const mapTraveling = { get: () => S.traveling, set: (v: boolean) => { S.traveling = v; invalidate(); } };
export function initMarker(coord: any) { setMarker(nodeAt(coord)); }

/** NMapScreen.OnMapPointSelectedLocally: vote for the point (single player: travel). */
function selectLocally(n: MapNode) {
  const r = rs(), me = r.Players[0];
  const vote = new G.MapVote().$zero_MapVote();
  vote.coord = n.p.coord;
  vote.mapGenerationCount = G.RunManager.Instance.MapSelectionSynchronizer.MapGenerationCount;
  const src = new G.RunLocation().$ctor_RunLocation$2(r.CurrentMapCoord, r.CurrentActIndex);
  G.RunManager.Instance.ActionQueueSynchronizer.RequestEnqueue(new G.VoteForMapCoordAction().$ctor_VoteForMapCoordAction(me, src, vote));
}
/** NMapScreen.TravelToMapCoord: the chosen node's circle and brush burst, the path inking in, the marker, the fade. */
export async function travelToMapCoord(coord: any) {
  S.traveling = true;
  recalcTravelability();
  if (ui.cardsView?.kind === 'deck') closeCardsView();
  hideMarker();
  S.travelEnabled = false;
  const node = nodeAt(coord)!;
  onSelected(node);
  pixi.selectVfx(node, node.kind === 'ancient' ? 1.5 : node.kind === 'boss' ? 2 : 1);
  playOneShot('event:/sfx/ui/map/map_select');
  playOneShot('event:/sfx/ui/wipe_map');
  const fade = transitionView.RoomFadeOut();
  const visited = list(rs().VisitedMapCoords);
  invalidate();
  if (visited.length) {
    const dots = S.paths.get(`${keyOf(visited[visited.length - 1])}>${node.key}`);
    if (dots) {
      const F = G.FastModeType, mode = fastMode();
      const per = (mode === F.Fast ? 0.3 : mode === F.Normal ? 0.8 : 0) / dots.length;
      for (const d of dots) {
        await G.Cmd.Wait$2(per);
        d.color = PATH_DOT_TRAVELED; d.s = 1.2; d.t0 = performance.now();
        invalidate();
      }
    }
  }
  setMarker(node);
  await fade;
  await G.RunManager.Instance.EnterMapCoord(coord);
  refreshAllPointVisuals();
}
/** NMapPoint.OnSelected. */
function onSelected(n: MapNode) {
  n.state = St.Traveled;
  refreshVisuals(n);
  if (n.kind === 'normal') {
    const circle: NonNullable<MapNode['circle']> = (n.circle = { rot: rand(0, 360), s: rand(0.85, 0.9), play: true });
    setTimeout(() => { circle.play = false; }, 1000);
    n.anim = 'select';
    const t = new $.WebTween();
    t.TweenProperty(n, 'pulse', 1, 0.3).SetEase(EZ.Out).SetTrans(TR.Cubic);
  } else if (n.kind === 'ancient') n.anim = 'select';
}

// ------------------------------------------------------------------ marker
function setMarker(n: MapNode | null) {
  if (!n || safe(() => rs().Players.length !== 1, true)) return;
  marker.tween?.CustomStep(1e3);
  if (marker.visible) return;
  marker.visible = true;
  const pos = new V2(n.x + n.w / 2 - 20, n.y - 35);
  marker.Position = pos;
  const t = (marker.tween = new $.WebTween());
  t.TweenProperty(marker, 'scale', new V2(1, 1), 0.2).From(new V2(0, 1));
  t.Parallel().TweenProperty(marker, 'position', new V2(pos.X, pos.Y - 25), 0.2).SetEase(EZ.In).SetTrans(TR.Sine).FromCurrent();
  t.TweenProperty(marker, 'position', pos, 0.75).SetEase(EZ.Out).SetTrans(TR.Elastic);
  invalidate();
}
function hideMarker() {
  if (safe(() => rs().Players.length !== 1, true)) return;
  marker.tween?.CustomStep(1e3);
  const t = (marker.tween = new $.WebTween());
  t.TweenProperty(marker, 'scale', new V2(0, 0), 0.2).From(new V2(1, 1));
  t.TweenCallback(() => { marker.visible = false; invalidate(); });
}

// ------------------------------------------------------------------ act banner (NActBanner)
let bannerIds = 0;
/** NActBanner (a child of the map screen): it animates and frees itself whether or not the map is visible. */
export function spawnActBanner(act: any, index: number) {
  const b: Banner = { id: ++bannerIds, act, index, o: { A: 1, BandA: 0, NameA: 0, NumA: 0, NumY: 440 } };
  const t = new $.WebTween().SetParallel();
  t.TweenProperty(b.o, 'band_a', 0.25, 0.5).SetDelay(0.5);
  t.TweenProperty(b.o, 'name_a', 1, 1).SetDelay(0.25);
  t.TweenProperty(b.o, 'num_a', 1, 1).SetDelay(0.5);
  t.TweenProperty(b.o, 'num_y', 440, 1.25).SetDelay(0.5).SetEase(EZ.Out).SetTrans(TR.Quad).From(450);
  t.Chain();
  t.TweenInterval(fastMode() === G.FastModeType.Fast ? 0.5 : 2);
  t.Chain();
  t.TweenProperty(b.o, 'a', 0, 1).SetEase(EZ.Out).SetTrans(TR.Quad);
  t.whenFinished(() => { S.banners = S.banners.filter((x) => x !== b); invalidate(); });
  S.banners.push(b);
  invalidate();
}
function ActBanner({ b }: { b: Banner }) {
  const root = useRef<HTMLDivElement>(null), band = useRef<HTMLDivElement>(null), name = useRef<HTMLDivElement>(null), num = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = b.o;
    const paint = () => {
      if (root.current) root.current.style.opacity = String(o.A);
      if (band.current) band.current.style.opacity = String(o.BandA);
      if (name.current) name.current.style.opacity = String(o.NameA);
      if (num.current) { num.current.style.opacity = String(o.NumA); num.current.style.top = `${o.NumY}px`; }
    };
    paint();
    return $.onFrame(() => { paint(); return S.banners.includes(b); });
  }, []);
  return (
    <div class="act-banner" ref={root}>
      <div class="ab-band" ref={band} />
      <div class="ab-number" ref={num}>{locv('gameplay_ui', 'ACT_NUMBER', { actNumber: b.index + 1 })}</div>
      <div class="ab-name" ref={name}>{safe(() => b.act.Title.GetFormattedText(), '')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ frame loop: scroll, pulses, screen tweens
let loopOn = false;
const els: { map?: HTMLElement | null; backstop?: HTMLElement | null; points?: HTMLElement | null; legend?: HTMLElement | null; tools?: HTMLElement | null; marker?: HTMLElement | null; canvas?: HTMLElement | null } = {};
function startLoop() {
  if (loopOn) return;
  loopOn = true;
  $.onFrame((dt: number) => {
    if (!S.visible) { loopOn = false; return false; }
    if (!actAnimRunning()) updateScroll(dt);
    const allowed = inputAllowed();
    for (const n of S.nodes) {
      if (n.kind === 'boss' || !travelable(n)) continue;
      if (!n.focus && allowed) { n.phase += dt * 4; n.Pulse = n.kind === 'normal' ? Math.sin(n.phase) * 0.25 + 1.2 : Math.sin(n.phase) * 0.05 + 1; }
      else n.Pulse += (1 - n.Pulse) * 0.5;
    }
    queueMicrotask(paintFrame); // after this frame's tweens
  });
}
/** NMapScreen.UpdateScrollPosition. */
function updateScroll(dt: number) {
  if (fx.MapY !== S.target) {
    fx.MapY += (S.target - fx.MapY) * dt * 15;
    if (Math.abs(fx.MapY - S.target) < 0.5) fx.MapY = S.target;
  }
  if (!S.dragging) {
    if (S.target < -600) S.target += (-600 - S.target) * dt * 12;
    else if (S.target > 1800) S.target += (1800 - S.target) * dt * 12;
  }
}
function paintFrame() {
  const m = els.map;
  if (m) {
    for (const layer of Array.from(m.querySelectorAll<HTMLElement>('.map-scroll'))) layer.style.transform = `translateY(${fx.MapY}px)`;
    m.style.opacity = String(fx.MapA);
    m.style.filter = fx.MapV < 1 ? `brightness(${fx.MapV})` : '';
  }
  if (els.backstop) els.backstop.style.opacity = String(0.851 * fx.BackstopA);
  if (els.points) els.points.style.opacity = String(fx.PointsA);
  if (els.legend) { els.legend.style.left = `${fx.LegendX}px`; els.legend.style.opacity = String(fx.LegendA); els.legend.style.filter = fx.LegendV < 1 ? `brightness(${fx.LegendV})` : ''; }
  if (els.tools) { els.tools.style.opacity = String(fx.ToolsA); els.tools.style.filter = fx.ToolsV < 1 ? `brightness(${fx.ToolsV})` : ''; }
  if (els.marker) {
    els.marker.style.left = `${marker.Position.X}px`; els.marker.style.top = `${marker.Position.Y}px`;
    els.marker.style.transform = `scale(${marker.Scale.X}, ${marker.Scale.Y})`;
  }
  for (const n of S.nodes) if (n.el) n.el.style.transform = n.kind === 'normal' ? `rotate(${n.angle}deg) scale(${n.Pulse})` : n.kind === 'ancient' ? `scale(${n.Pulse})` : `scale(${n.Hover})`;
  pixi.frame();
}

// ------------------------------------------------------------------ input
const stage = () => (document.querySelector('.run')?.closest('.stage-root') as HTMLElement | null)?.getBoundingClientRect() ?? null;
function toStage(e: { clientX: number; clientY: number }) {
  const r = stage();
  if (!r) return [0, 0];
  const k = 1920 / r.width;
  return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
}
let lastY = 0;
function onPointerDown(e: PointerEvent) {
  const [x, y] = toStage(e);
  lastY = y;
  // NMapScreen.ProcessMouseDrawingEvent: right drags draw, middle drags erase, at any time
  if (!S.inputDisabled && !actAnimRunning() && S.mode === 'none' && (e.button === 2 || e.button === 1)) {
    e.preventDefault();
    S.mode = e.button === 2 ? 'draw' : 'erase'; S.held = true;
    updateCursor();
    drawings.begin(x, y);
    invalidate();
    return;
  }
  if (S.mode !== 'none') {
    // NMouseModeMapDrawingInput: left draws a line, right / middle leave the mode
    if (S.held) return;
    if (e.button === 0) drawings.begin(x, y);
    else stopDrawing();
    return;
  }
  if (e.button === 0 && canScroll()) {
    S.dragging = true;
    S.target = fx.MapY;
    tryCancelStartOfActAnim();
  } else S.dragging = false;
}
function onPointerMove(e: PointerEvent) {
  const [x, y] = toStage(e);
  const dy = y - lastY;
  lastY = y;
  if (S.line) { drawings.extend(x, y); return; }
  if (S.mode !== 'none') return;
  if (S.dragging) S.target += dy;
  const p = S.press;
  if (p && !p.cancelled && Math.hypot(x - p.x, y - p.y) > (p.n.kind === 'normal' ? 20 : 30)) p.cancelled = true;
}
function onPointerUp(e: PointerEvent) {
  if (S.held && ((S.mode === 'draw' && e.button === 2) || (S.mode === 'erase' && e.button === 1))) { stopDrawing(); return; }
  if (S.mode !== 'none' && e.button === 0) { drawings.end(); return; }
  S.dragging = false;
  const p = S.press;
  S.press = null;
  if (p && e.button === 0 && !p.cancelled && p.n.focus) release(p.n);
}
function onWheel(e: WheelEvent) {
  if (!canScroll()) return;
  S.target += wheelDrag(e);
  tryCancelStartOfActAnim();
}
window.addEventListener('pointermove', (e) => { if (S.visible) onPointerMove(e); });
window.addEventListener('pointerup', (e) => { if (S.visible) onPointerUp(e); });

// NMapPoint focus / press / release
function focus(n: MapNode) {
  n.focus = true;
  if (!inputAllowed()) return;
  n.anim = 'hover';
  if (n.kind === 'boss') { if (travelable(n)) tweenHover(n, 1.05, 0.05); }
  // the MapPointHistory tip for traveled nodes other than the current one
  const r = rs();
  if (n.state === St.Traveled && keyOf(safe(() => r.CurrentLocation.coord, {})) !== n.key) {
    const entry = safe(() => r.GetHistoryEntryFor(new G.RunLocation().$ctor_RunLocation$2(n.p.coord, r.CurrentActIndex)), null);
    if (entry) {
      let floor = n.p.coord.row + 1;
      const hist = list(r.MapPointHistory);
      for (let i = 0; i < hist.length - 1; i++) floor += list(hist[i]).length;
      S.floorTip = { d: floorTipData(entry, floor, safe(() => r.Players[0].NetId, 1)), cell: [n.x, n.y + fx.MapY], w: n.w };
    }
  }
  invalidate();
}
function unfocus(n: MapNode) {
  n.focus = false;
  clearTips();
  if (travelable(n) && n.kind === 'normal') n.phase = 3.926991;
  if (!inputAllowed()) return;
  n.anim = 'unhover';
  if (n.kind === 'boss') tweenHover(n, 1, 0.5, TR.Cubic);
  invalidate();
}
function press(n: MapNode, e: PointerEvent) {
  if (e.button !== 0) return;
  const [x, y] = toStage(e);
  S.press = { n, x, y, cancelled: false };
  if (!travelable(n)) return;
  n.anim = 'press';
  if (n.kind === 'boss') tweenHover(n, 1.02, 0.3, TR.Expo);
  clearTips();
  invalidate();
}
/** NMapPoint.OnRelease. */
function release(n: MapNode) {
  if (travelable(n) && (n.p.coord.row !== 0 || seenFtue('map_select_ftue')) && S.mode === 'none') selectLocally(n);
}
function tweenHover(n: MapNode, to: number, dur: number, trans?: number) {
  const t = new $.WebTween();
  const tw = t.TweenProperty(n, 'hover', to, dur);
  if (trans != null) tw.SetEase(EZ.Out).SetTrans(trans);
}

// ------------------------------------------------------------------ drawings (NMapDrawings)
// Lines live in a half-resolution (960 × 1620) viewport stretched over the paper; drawn lines are 4 px wide in the
// character's colour, erasing subtracts a 12 px stroke. Kept per run and act in user://web/map_drawings.json (the
// desktop save embeds them in the run file as a gzip packet, which the web runtime has no stream for).
interface Line { e: boolean; p: number[] }
const FILE = 'user://web/map_drawings.json';
let store: Record<string, Record<string, Line[]>> | null = null;
const all = (): Record<string, Record<string, Line[]>> => (store ??= safe(() => JSON.parse($.vfs.read(FILE) ?? '{}'), {}));
const runKey = () => `${safe(() => rs().Rng.StringSeed, '')}:${safe(() => G.RunManager.Instance._startTime, 0)}`;
const actKey = () => String(safe(() => rs().CurrentActIndex, 0));
let canvas: HTMLCanvasElement | null = null;
const drawings = {
  lines(): Line[] {
    const k = runKey(), a = actKey();
    return ((all()[k] ??= {})[a] ??= []).map((l: any) => (Array.isArray(l.p) && 'e' in l ? l : { e: false, p: l.p ?? [] }));
  },
  save() {
    const s = all(), k = runKey();
    const keys = [k, ...Object.keys(s).filter((x) => x !== k)].slice(0, 5); // this run and at most four others
    store = Object.fromEntries(keys.filter((x) => s[x]).map((x) => [x, s[x]]));
    safe(() => $.vfs.write(FILE, JSON.stringify(store)), undefined);
  },
  begin(x: number, y: number) {
    const lx = x * 0.5, ly = (y - fx.MapY + 1620) * 0.5;
    S.line = [lx, ly, lx, ly + 0.5];
    const k = runKey(), a = actKey();
    ((all()[k] ??= {})[a] ??= []).push({ e: S.mode === 'erase', p: S.line });
    this.paint();
  },
  extend(x: number, y: number) {
    const p = S.line!, lx = x * 0.5, ly = (y - fx.MapY + 1620) * 0.5;
    if ((lx - p[p.length - 2]) ** 2 + (ly - p[p.length - 1]) ** 2 < 4) return;
    p.push(lx, ly);
    this.paint();
  },
  end() { if (S.line) { S.line = null; this.save(); } },
  clearMine() { const k = runKey(); (all()[k] ??= {})[actKey()] = []; this.save(); this.paint(); },
  clearAll() { const k = runKey(); if (all()[k]) all()[k][actKey()] = []; this.paint(); },
  paint() {
    const c = canvas?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 960, 1620);
    const color = safe(() => css(rs().Players[0].Character.MapDrawingColor), '#000');
    for (const l of this.lines()) {
      c.globalCompositeOperation = l.e ? 'destination-out' : 'source-over';
      c.strokeStyle = l.e ? '#000' : color;
      c.lineWidth = l.e ? 12 : 4;
      c.lineCap = c.lineJoin = 'round';
      c.beginPath();
      for (let i = 0; i < l.p.length; i += 2) (i ? c.lineTo : c.moveTo).call(c, l.p[i], l.p[i + 1]);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  },
};
/** NMapDrawingInput.StopDrawing. */
function stopDrawing() {
  drawings.end();
  if (S.mode !== 'none') { S.mode = 'none'; S.held = false; updateCursor(); invalidate(); }
}
function toggleMode(m: Mode) {
  const was = S.mode;
  stopDrawing();
  if (was !== m) { S.mode = m; S.held = false; }
  updateCursor();
  invalidate();
}
/**
 * NMapDrawings.UpdateLocalCursor → NCursorManager.OverrideCursor: while drawing / erasing the mouse cursor everywhere is
 * the quill (hotspot 2, 56) / eraser (24, 58), its tilted image while any of the left / right / middle buttons is down.
 */
let buttonDown = false;
function updateCursor() {
  const kind = S.mode === 'draw' ? 'quill' : S.mode === 'erase' ? 'eraser' : null;
  const url = kind ? imageUrl(`images/packed/common_ui/cursor_${kind}${buttonDown ? '_tilted' : ''}.png`) : null;
  const root = document.documentElement;
  root.classList.toggle('draw-cursor', !!url);
  if (url) root.style.setProperty('--draw-cursor', `url(${url}) ${kind === 'quill' ? '2 56' : '24 58'}, auto`);
}
for (const [ev, down] of [['mousedown', true], ['mouseup', false]] as const) {
  window.addEventListener(ev, (e) => { if (e.button <= 2 && buttonDown !== down) { buttonDown = down; updateCursor(); } }, true);
}

// ------------------------------------------------------------------ images
/** Atlas frames as standalone images: tinted (white silhouettes × colour) or recoloured (normal_map_point shader). */
const pages = new Map<string, HTMLImageElement>();
const derived = new Map<string, string | null>();
function frameImage(atlas: string, name: string, key: string, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): string | null {
  const f = frameByName(atlas, name);
  if (!f) return null;
  const id = `${atlas}/${name}|${key}`;
  if (derived.has(id)) return derived.get(id)!;
  derived.set(id, null);
  let img = pages.get(f.page);
  const run = () => {
    const cv = document.createElement('canvas');
    cv.width = f.sw; cv.height = f.sh;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(img!, f.x, f.y, f.w, f.h, f.ox, f.oy, f.w, f.h);
    draw(c, f.sw, f.sh);
    derived.set(id, cv.toDataURL());
    invalidate();
  };
  if (!img) { img = new Image(); img.src = f.page; pages.set(f.page, img); }
  if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run, { once: true });
  return null;
}
const tinted = (atlas: string, name: string, c: any) => frameImage(atlas, name, css(c, 1), (x, w, h) => { x.globalCompositeOperation = 'source-in'; x.fillStyle = css(c, 1); x.fillRect(0, 0, w, h); });
/** normal_map_point.gdshader: pixels within 0.5 of the fill colour (#B49D89) become lerp(act bg, gray, 0.5). */
function recoloured(name: string, bg: any) {
  const m = { R: bg.R + (0.745 - bg.R) * 0.5, G: bg.G + (0.745 - bg.G) * 0.5, B: bg.B + (0.745 - bg.B) * 0.5 };
  return frameImage('ui_atlas', 'map/icons/' + name, css(m), (c, w, h) => {
    const d = c.getImageData(0, 0, w, h), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      if (Math.hypot(r - 0.705882, g - 0.615686, b - 0.537255) < 0.5) { px[i] = m.R * 255; px[i + 1] = m.G * 255; px[i + 2] = m.B * 255; }
    }
    c.putImageData(d, 0, 0);
  });
}
const plain = (atlas: string, name: string) => frameImage(atlas, name, '', () => {});
const url = (u: string | null) => (u ? `url(${u})` : 'none');

// ------------------------------------------------------------------ Pixi layer: Spine boss nodes and the select burst
let appP: Promise<Application> | null = null;
const mapApp = () => (appP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, antialias: false, autoStart: false, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
  a.canvas.classList.add('map-fx');
  return a;
})());
const spineLoads = new Map<string, Promise<boolean>>();
const pixi = {
  app: null as Application | null,
  root: new Container(), points: new Container(),
  bosses: new Map<MapNode, Container>(),
  async mount(el: HTMLElement) {
    const a = await mapApp();
    this.app = a;
    if (!this.points.parent) this.root.addChild(this.points);
    a.stage.removeChildren();
    a.stage.addChild(this.root);
    el.appendChild(a.canvas);
    this.sync();
  },
  reset() { for (const c of this.bosses.values()) c.destroy({ children: true }); this.bosses.clear(); if (this.app) this.sync(); },
  /** NBossMapPoint with a BossNodeSpineResource: the skeleton at 0.19, looping "animation", channel-recoloured. */
  sync() {
    for (const n of [S.boss, S.boss2]) {
      if (!n || this.bosses.has(n)) continue;
      const id = bossSpineId(n);
      if (!id) continue;
      const holder = new Container();
      this.bosses.set(n, holder);
      this.points.addChild(holder);
      const key = 'mapboss:' + id;
      let p = spineLoads.get(key);
      if (!p) {
        Assets.add({ alias: key + ':skel', src: `${A}animations/map/${id}/${id}_node.skel` });
        Assets.add({ alias: key + ':atlas', src: `${A}animations/map/${id}/${id}_node.atlas` });
        spineLoads.set(key, (p = Assets.load([key + ':skel', key + ':atlas']).then(() => true).catch(() => false)));
      }
      p.then((ok) => {
        if (!ok || holder.destroyed) return;
        const sp = Spine.from({ skeleton: key + ':skel', atlas: key + ':atlas', scale: 1 });
        sp.position.set(-187, -153);
        sp.scale.set(0.19);
        sp.state.setAnimation(0, 'animation', true);
        holder.addChild(sp);
      });
    }
  },
  frame() {
    const a = this.app;
    if (!a) return;
    this.root.y = fx.MapY;
    this.points.alpha = fx.PointsA;
    const r = safe(() => rs().Act, null);
    for (const [n, h] of this.bosses) {
      h.position.set(n.x + 187, n.y + 153);
      h.scale.set(n.scale * n.Hover);
      const black = n.state === St.Travelable || n.state === St.Traveled ? r?.MapTraveledColor : r?.MapUntraveledColor, bg = r?.MapBgColor;
      if (black && bg) {
        const f = (h.filters as any)?.[0] ?? (h.filters = [new ColorMatrixFilter()], (h.filters as any)[0]);
        f.matrix = [bg.R, 1, black.R, 0, 0, bg.G, 1, black.G, 0, 0, bg.B, 1, black.B, 0, 0, 0, 0, 0, 1, 0];
      }
    }
    a.render();
  },
  selectVfx(n: MapNode, scale: number) {
    const [px, py] = pivot(n);
    void playSpriteVfx(this.points, 'vfx/map_node_select_vfx', n.x + px, n.y + py, scale);
  },
};
/** The boss encounter's map skeleton folder, when it has one (BossNodeSpineResource: BossNodePath is a skeleton). */
function bossSpineId(n: MapNode): string | null {
  const r = rs();
  const enc = n === S.boss2 ? r.Act.SecondBossEncounter : r.Act.BossEncounter;
  const m = /animations\/map\/([^/]+)\/[^/]+_node_skel_data\.tres$/.exec(safe(() => String(enc.BossNodePath), ''));
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ view
const back = { enabled: false };
const LEGEND: [string, string, string][] = [
  ['UNKNOWN', 'Unknown', 'map_unknown'], ['MERCHANT', 'Shop', 'map_shop'], ['TREASURE', 'Treasure', 'map_chest'],
  ['REST', 'RestSite', 'map_rest'], ['ENEMY', 'Monster', 'map_monster'], ['ELITE', 'Elite', 'map_elite'],
];
const ICON: Record<string, string> = { Unassigned: 'map_unknown', Monster: 'map_monster', Elite: 'map_elite', Ancient: 'map_unknown', Treasure: 'map_chest', Shop: 'map_shop', RestSite: 'map_rest', Unknown: 'map_unknown' };
const UNKNOWN_ROOM: Record<string, [string, string]> = { Treasure: ['map_unknown_chest', 'map_chest'], Monster: ['map_unknown_monster', 'map_monster'], Shop: ['map_unknown_shop', 'map_shop'], Elite: ['map_unknown_elite', 'map_elite'] };
/** NNormalMapPoint.UpdateIcon: a traveled Unknown shows the room it turned out to be. */
function iconNames(n: MapNode): [string, string] {
  const type = $.enumStr(G.MapPointType, n.p.PointType);
  if (type !== 'Unknown' || n.state !== St.Traveled) return [ICON[type] ?? 'map_unknown', ICON[type] ?? 'map_unknown'];
  const r = rs();
  const room = safe(() => list(list(r.MapPointHistory)[r.CurrentActIndex])[n.p.coord.row].Rooms, null);
  const t = room ? $.enumStr(G.RoomType, list(room)[0].RoomType) : '';
  return UNKNOWN_ROOM[t] ?? ['map_unknown', 'map_unknown'];
}
/** CSS transitions standing in for the nodes' hover / unhover / press / select tweens. */
const TRANS: Record<Anim, (t: 'scale' | 'alpha' | 'outline') => string> = {
  instant: () => 'none',
  hover: () => '0.05s linear',
  unhover: (t) => (t === 'outline' ? '0.5s cubic-bezier(0.33,1,0.68,1)' : '0.5s cubic-bezier(0.33,1,0.68,1)'),
  press: (t) => (t === 'outline' ? '0.3s cubic-bezier(0.16,1,0.3,1)' : '0.3s cubic-bezier(0.33,1,0.68,1)'),
  select: (t) => (t === 'scale' ? '0.3s cubic-bezier(0.34,1.56,0.64,1)' : '0.3s cubic-bezier(0.16,1,0.3,1)'),
};
const hovered = (n: MapNode) => (n.anim === 'hover' && n.focus) || (n.kind === 'normal' && S.highlight >= 0 && S.highlight === n.p.PointType);

function NormalPoint({ n, act }: { n: MapNode; act: any }) {
  const [icon, outline] = iconNames(n);
  const bg = act.MapBgColor;
  const hov = hovered(n), tv = travelable(n);
  const anim: Anim = S.highlight >= 0 && n.anim !== 'press' && n.anim !== 'select' ? (hov ? 'hover' : 'unhover') : n.anim;
  const scale = hov ? 1.45 : n.anim === 'press' && n.focus ? 0.9 : 1;
  const alpha = hov || n.state === St.Travelable || n.state === St.Traveled ? 1 : 0.5;
  const oc = hov && tv ? OUTLINE_HOVER : bg;
  const tr = (p: string, k: 'scale' | 'alpha' | 'outline') => (TRANS[anim](k) === 'none' ? 'none' : `${p} ${TRANS[anim](k)}`);
  const quest = safe(() => list(n.p.Quests).length > 0, false);
  return (
    <div class={'mp mp-normal' + (tv ? ' travelable' : '')} style={{ left: `${n.x}px`, top: `${n.y}px` }}
      onPointerEnter={() => focus(n)} onPointerLeave={() => unfocus(n)} onPointerDown={(e) => press(n, e)}>
      <div class="mp-ic" ref={(e) => { n.el = e; }}>
        <div class="mp-icon" style={{ transform: `scale(${scale})`, transition: tr('transform', 'scale') }}>
          <div class="mp-outline" style={{ maskImage: url(plain('compressed', `map/${outline}_outline`)), backgroundColor: css(oc), transition: tr('background-color', 'outline') }} />
          <div class="mp-img" style={{ backgroundImage: url(recoloured(icon, bg)), opacity: alpha, transition: tr('opacity', 'alpha') }} />
        </div>
        {quest && <div class="mp-quest" style={{ backgroundImage: url(imageUrl('images/packed/map/icons/map_spoils_map_marker.png')), transform: `scale(${scale})` }} />}
      </div>
      {n.circle && (
        <div class={'mp-circle' + (n.circle.play ? ' play' : '')} style={{ '--rot': `${n.circle.rot}deg`, '--s': n.circle.s } as any}>
          <CircleFrames play={n.circle.play} />
        </div>
      )}
    </div>
  );
}
/** NMapCircleVfx: map_circle_0…4 at 24 fps when a node is chosen, else the last frame. */
function CircleFrames({ play }: { play: boolean }) {
  const [i, set] = useState(play ? 0 : 4);
  useEffect(() => {
    if (!play) return;
    let k = 0;
    const id = setInterval(() => { k++; if (k > 4) clearInterval(id); else set(k); }, 1000 / 24);
    return () => clearInterval(id);
  }, []);
  return <div class="mp-circle-img" style={{ backgroundImage: url(tinted('compressed', `map/map_circle_${i}`, PATH_DOT_TRAVELED)) }} />;
}
function AncientPoint({ n, act }: { n: MapNode; act: any }) {
  const id = safe(() => rs().Act.Ancient.Id.Entry.toLowerCase(), '');
  const hov = n.anim === 'hover' && n.focus, tv = travelable(n);
  const color = hov || tv || n.state === St.Traveled ? PATH_DOT_TRAVELED : BOSS_NODE_UNTRAVELED;
  const scale = hov ? 1.1 : n.anim === 'press' && n.focus ? 0.9 : 1;
  const tr = (p: string, k: 'scale' | 'alpha' | 'outline') => (TRANS[n.anim](k) === 'none' ? 'none' : `${p} ${TRANS[n.anim](k === 'alpha' && n.anim === 'unhover' ? 'outline' : k)}`);
  return (
    <div class={'mp mp-ancient' + (tv ? ' travelable' : '')} ref={(e) => { n.el = e; }} style={{ left: `${n.x}px`, top: `${n.y}px` }}
      onPointerEnter={() => focus(n)} onPointerLeave={() => unfocus(n)} onPointerDown={(e) => press(n, e)}>
      <div class="mp-anc-icon" style={{ transform: `scale(${scale})`, transition: tr('transform', 'scale') }}>
        <div class="mp-anc-outline" style={{ maskImage: url(imageUrl(`images/packed/map/ancients/ancient_node_${id}_outline.png`)), backgroundColor: css(hov && tv ? OUTLINE_HOVER : act.MapBgColor), transition: tr('background-color', 'outline') }} />
        <div class="mp-anc-img" style={{ maskImage: url(imageUrl(`images/packed/map/ancients/ancient_node_${id}.png`)), backgroundColor: css(color), transition: tr('background-color', 'alpha') }} />
      </div>
    </div>
  );
}
function BossPoint({ n, act }: { n: MapNode; act: any }) {
  const spine = !!bossSpineId(n);
  const enc = n === S.boss2 ? act.SecondBossEncounter : act.BossEncounter;
  const path = safe(() => String(enc.BossNodePath), '');
  const on = n.state === St.Travelable || n.state === St.Traveled;
  return (
    <div class={'mp mp-boss' + (travelable(n) ? ' travelable' : '')} style={{ left: `${n.x}px`, top: `${n.y}px`, transform: `scale(${n.scale})` }}
      onPointerEnter={() => focus(n)} onPointerLeave={() => unfocus(n)} onPointerDown={(e) => press(n, e)}>
      {!spine && (
        <div class="mp-boss-sprite" ref={(e) => { n.el = e; }}>
          <div class="mp-boss-outline" style={{ maskImage: url(imageUrl(path + '_outline.png')), backgroundColor: css(act.MapBgColor) }} />
          <div class="mp-boss-img" style={{ maskImage: url(imageUrl(path + '.png')), backgroundColor: css(on ? act.MapTraveledColor : act.MapUntraveledColor) }} />
        </div>
      )}
    </div>
  );
}

function Legend() {
  const [hot, setHot] = useState(-1);
  return (
    <div class="map-legend" ref={(e) => { els.legend = e; }} onPointerDown={(e) => e.stopPropagation()}>
      <div class="ml-bg" style={frameStyle(frameByName('ui_atlas', 'map/map_legend'), 326, 454)} />
      <div class="ml-header">{loc('map', 'LEGEND_HEADER')}</div>
      <div class="ml-items">
        {LEGEND.map(([key, type, icon], i) => (
          <div class="ml-item"
            onPointerEnter={() => {
              setHot(i);
              S.highlight = G.MapPointType[type];
              setTips([{ title: loc('map', `LEGEND_${key}.hoverTip.title`), body: loc('map', `LEGEND_${key}.hoverTip.description`) }], { kind: 'at', x: 1862, y: 746, rightEdge: true });
              invalidate();
            }}
            onPointerLeave={() => { setHot(-1); S.highlight = -1; setTip(null); invalidate(); }}
            onPointerDown={(e) => { if (e.button === 0) playOneShot('event:/sfx/ui/clicks/ui_click'); }}>
            <div class={'ml-icon' + (hot === i ? ' hot' : '')} style={frameStyle(frameByName('ui_atlas', 'map/icons/' + icon), 64, 64)} />
            <div class="ml-label">{loc('map', `LEGEND_${key}.title`)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DrawingTools() {
  const [hot, setHot] = useState('');
  const tool = (kind: 'draw' | 'erase' | 'clear', img: string, color: string, key: string, onClick: () => void) => {
    const active = (kind === 'draw' && S.mode === 'draw') || (kind === 'erase' && S.mode === 'erase');
    const glow = active || (kind === 'clear' && hot === kind);
    const lit = hot === kind || active;
    return (
      <div class={'md-btn md-' + kind} onPointerEnter={() => {
        setHot(kind);
        playOneShot('event:/sfx/ui/clicks/ui_hover');
        setTips([{ title: loc('map', `${key}.title${kind === 'clear' ? '' : '_mkb'}`), body: loc('map', `${key}.description`) }], { kind: 'at', x: 76, y: 844 });
      }} onPointerLeave={() => { setHot(''); setTip(null); }}
        onPointerDown={(e) => { if (e.button === 0) playOneShot('event:/sfx/ui/clicks/ui_click'); }}
        onPointerUp={(e) => { if (e.button === 0) onClick(); }}>
        <div class="md-icon" style={{ maskImage: url(imageUrl(`images/packed/map/${img}${glow ? '_glow' : ''}.png`)), backgroundColor: lit ? color : '#FFFFFF80', transform: `scale(${hot === kind ? 1.2 : 1.1})` }} />
      </div>
    );
  };
  return (
    <div class="map-tools" ref={(e) => { els.tools = e; }} onPointerDown={(e) => e.stopPropagation()}>
      <div class="md-bg" style={{ borderImageSource: url(imageUrl('images/ui/tiny_nine_patch.png')) }} />
      <div class="md-row">
        {tool('draw', 'drawing_quill', '#57C4FF', 'DRAWING_BUTTON', () => toggleMode('draw'))}
        {tool('erase', 'drawing_eraser', '#FF5757', 'ERASING_BUTTON', () => toggleMode('erase'))}
        {tool('clear', 'drawing_clear', '#FFE57D', 'CLEAR_DRAWING', () => { stopDrawing(); drawings.clearMine(); playOneShot('event:/sfx/ui/map/map_erase'); })}
      </div>
    </div>
  );
}

/** The map screen; rendered while NMapScreen is visible (including its close animation). */
export function MapScreen() {
  const r = rs();
  const fxHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fxHost.current) void pixi.mount(fxHost.current);
    paintFrame();
    drawings.paint();
    startLoop();
    return () => { pixi.app?.canvas.remove(); };
  }, []);
  if (!S.visible || !S.map || !r) return null;
  const act = r.Act;
  const paper = ['MapTopBgPath', 'MapMidBgPath', 'MapBotBgPath'].map((k) => imageUrl(safe(() => act[k], '')));
  const dot = (d: Dot) => url(tinted('compressed', 'map/map_dot', d.color));
  const me = safe(() => r.Players[0].Character.Id.Entry.toLowerCase(), '');
  return (
    <div class={'map-screen' + (S.mode !== 'none' ? ` drawing-${S.mode}` : '')}
      onPointerDown={onPointerDown} onWheel={onWheel}>
      <div class="map-backstop" ref={(e) => { els.backstop = e; }} />
      <div class="map-the" ref={(e) => { els.map = e; }}>
        <div class="map-scroll">
          {paper.map((u, i) => u && <div class="map-bg" style={{ top: `${-1620 + i * 1080}px`, backgroundImage: url(u) }} />)}
          <div class="map-paths">
            {[...S.paths.values()].flat().map((d) => (
              <div class={'map-dot' + (d.t0 ? ' inked' : '')} style={{ left: `${d.x - 8}px`, top: `${d.y - 8}px`, backgroundImage: dot(d), transform: `rotate(${d.rot}rad) scaleX(${d.flip ? -1 : 1})`, scale: String(d.s) }} />
            ))}
          </div>
          <div class="map-points" ref={(e) => { els.points = e; }}>
            {S.nodes.map((n) => (n.kind === 'normal' ? <NormalPoint n={n} act={act} key={n.key} /> : n.kind === 'ancient' ? <AncientPoint n={n} act={act} key={n.key} /> : <BossPoint n={n} act={act} key={n.key} />))}
          </div>
        </div>
        <div class="map-fx-host" ref={fxHost} />
        <div class="map-scroll">
          <canvas class="map-drawings" width={960} height={1620} ref={(e) => { if (e && e !== canvas) { canvas = e; drawings.paint(); } }} />
          {marker.visible && <div class="map-marker" ref={(e) => { els.marker = e; }} style={{ backgroundImage: url(imageUrl(`images/packed/map/icons/map_marker_${me}.png`)) }} />}
        </div>
      </div>
      <Legend />
      <BackButton enabled={back.enabled} onClick={() => closeMap()} />
      <DrawingTools />
      {S.banners.map((b) => <ActBanner b={b} key={b.id} />)}
      {S.floorTip && <FloorTipPanel d={S.floorTip.d} cell={S.floorTip.cell} w={S.floorTip.w} />}
    </div>
  );
}
