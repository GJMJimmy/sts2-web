// Pixi stage for combat: creatures as Spine skeletons placed per their creature_visuals scenes.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { A, skelSrc, spineIndex } from '../assets';
import { loadScene, attachCreatureFx, particleItem, buildScene, sceneTexture } from './scene';
import { curveAt } from './cardfx';
import { orbCentre, type OrbManagerView } from '../ui/orbs';
import { loadShader, QuadBatch, animate } from './canvas';
import { noiseTexture } from './noise';
import { playOneShot } from '../audio';
import { G, $, N, list } from '../game';
import { slotMats } from './slotmats';
import { fullView, view, edge } from '../view';
import { mobileRendering, renderResolution } from './quality';

export const W = 1920, H = 1080;
/** The mounted combat stage (VfxCmd calls from the rule layer land here). */
export let activeStage: CombatStage | null = null;
let app: Application | null = null;
let appReady: Promise<Application> | null = null;
const loaded = new Map<string, Promise<boolean>>();

/** WebGL without a GPU (hardware acceleration off, blocklisted driver) rasterizes on the CPU. */
function softwareGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return /swiftshader|llvmpipe|software/i.test(String(info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''));
  } catch { return false; }
}
let soft = false;
/** SettingsSave.FpsLimit (NFpsPaginator → Engine.MaxFps); 0 = uncapped. Software rendering is held at 30. */
/** NCreature.GetCurrentAnimationTimeRemaining over the dying creatures (NCombatUi.ShowRewards waits it out). */
let deathEnd = 0;
export const deathAnimRemaining = () => Math.max(0, (deathEnd - performance.now()) / 1000);
export function applyFpsLimit() {
  if (!app) return;
  const limit = Number(G.SaveManager.Instance?.SettingsSave?.FpsLimit ?? 60) || 0;
  app.ticker.maxFPS = soft ? Math.min(limit || 30, 30) : limit;
}
export function getApp() {
  if (!appReady) {
    appReady = (async () => {
      const a = new Application();
      // software rendering: no MSAA, half resolution (¼ of the pixels to fill) and 30 fps keep it off a full CPU core.
      // WebGL fixes antialiasing when the context is created, so SettingsSave.Msaa applies from the next load.
      soft = softwareGL();
      const msaa = Number(G.SaveManager.Instance?.SettingsSave?.Msaa ?? 2) > 0;
      await a.init({ width: W, height: H, backgroundAlpha: 0, antialias: msaa && !soft && !mobileRendering, autoDensity: true, resolution: soft ? 0.5 : renderResolution() });
      app = fullView(a);
      // Godot's BLEND_MODE_SUB (dst − src) for CanvasItemMaterial blend_mode = 2 / render_mode blend_sub
      const gl = (a.renderer as any).gl as WebGL2RenderingContext | undefined, map = (a.renderer as any).state?.blendModesMap;
      if (gl && map) map.subtract = [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD];
      applyFpsLimit();
      return a;
    })();
  }
  return appReady;
}

/** Screen placement of one creature: feet at (x, y), visual scale s, bounds w×h (already scaled). */
export interface Slot { x: number; y: number; w: number; h: number; s: number; intent: [number, number]; flip: boolean; /** bounds' top-left relative to (x, y) */ bl: number; bt: number; /** Visuals.Scale (creature scale changes) */ vis?: number }

/**
 * Port of NCombatRoom's layout (PositionPlayersAndPets / PositionEnemies / PositionCreaturesWithSlots /
 * AdjustCreatureScaleForAspectRatio). Both creature containers sit at the screen centre inside a scene container
 * that is scaled by the encounter's camera scaling around (960, 540) and shifted by its camera offset.
 */
const placed = new WeakMap<any, Map<any, Slot>>();
/**
 * NCombatRoom positions creature nodes once, when they are added: once the combat has started (all starting
 * creatures exist), each creature keeps its first slot, so deaths and summons do not shuffle the others.
 */
export function layoutCreatures(cs: any): Map<any, Slot> {
  return withNodeState(placedSlots(cs));
}
/**
 * What the creature nodes changed since they were placed: Visuals.Scale (ScaleTo / OstyScaleToSize / SetScaleAndHue),
 * the hitbox that follows it (UpdateBounds; the intents stay at the unscaled IntentPos), and the local player's Osty,
 * which OstyScaleToSize keeps at its owner's position + GetOstyOffsetFromPlayer (hitbox ½ + lerp((150, −75), (250, −75))).
 */
function withNodeState(slots: Map<any, Slot>): Map<any, Slot> {
  const room = N('Rooms.NCombatRoom').Instance;
  const nodes: Map<any, any> | undefined = room?.creatures;
  if (!nodes) return slots;
  for (const [c, s0] of slots) {
    const v = nodes.get(c) ?? room.removingNodes?.get(c);
    if (!v) continue;
    let s = s0;
    const b = v.BoundsScale ?? 1, vis = v.VisScale ?? 1;
    if (b !== 1 || vis !== 1) s = { ...s, vis, w: s.w * b, h: s.h * b, bl: s.bl * b, bt: s.bt * b };
    const owner = v.OstyK != null ? c.PetOwner?.Creature : null, os = owner && slots.get(owner);
    if (os) {
      const hw = (spineIndex[visualsKey(owner)]?.bounds?.[2] ?? 240) * (nodes.get(owner)?.BoundsScale ?? 1);
      s = { ...s, x: os.x + (hw / 2 + 150 + 100 * v.OstyK) * os.s, y: os.y - 75 * os.s };
    }
    const off = v.PosOffset;
    if (off && (off.X || off.Y)) s = { ...s, x: s.x + off.X, y: s.y + off.Y };
    if (s !== s0) slots.set(c, s);
  }
  return slots;
}
function placedSlots(cs: any): Map<any, Slot> {
  if (!(cs.RoundNumber > 0)) return computeLayout(cs);
  let seen = placed.get(cs);
  if (!seen) placed.set(cs, (seen = new Map()));
  // called every frame by the stage and the UI: skip the layout pass while no creature was added
  const cur = [...list(cs.Allies ?? []), ...list(cs.Enemies ?? [])];
  if (cur.length && cur.every((c) => seen!.has(c))) return new Map(cur.map((c) => [c, seen!.get(c)!]));
  const fresh = computeLayout(cs);
  const out = new Map<any, Slot>();
  for (const [c, s] of fresh) {
    if (!seen.has(c)) seen.set(c, s);
    out.set(c, seen.get(c)!);
  }
  return out;
}
function computeLayout(cs: any): Map<any, Slot> {
  const out = new Map<any, Slot>();
  const info = (c: any) => spineIndex[visualsKey(c)] ?? {};
  const bw = (c: any) => (info(c).bounds ?? [-120, -280, 240, 280])[2];
  const enc = cs.Encounter;
  const scaling = safeNum(() => enc.GetCameraScaling(), 1);
  const off = safeVec(() => enc.GetCameraOffset());
  const local = new Map<any, [number, number]>(); // container-local creature positions

  // players + pets (single player: pets hang off their owner)
  const allies = list(cs.Allies ?? []);
  const players = allies.filter((c: any) => c?.IsPlayer);
  const half = 960 / scaling;
  let gap = 70;
  const cols = Math.ceil(Math.sqrt(players.length)) || 1;
  const width = players.slice(0, cols).reduce((a, c) => a + bw(c), 0);
  let span = width + (cols - 1) * gap;
  let x0 = Math.max((half - span) * 0.5, 150);
  if (x0 + span > half && cols > 1) { gap = (half - 150 - width) / (cols - 1); span = width + (cols - 1) * gap; x0 = (half - span) * 0.5; }
  if (players.length && safeBool(() => enc.FullyCenterPlayers)) x0 = -bw(players[0]) * 0.5;
  let tx = x0;
  for (const p of players) {
    const py = 200;
    local.set(p, [-tx - bw(p) * 0.5, py]);
    let pets = allies.filter((c: any) => !c.IsPlayer && c.PetOwner === p.Player);
    if (p.Player?.Character?.Id?.Entry === 'NECROBINDER') {
      // PositionLocalPlayerOsty: the player steps back 150px, Osty stands in front (further out the bigger it is)
      const osty = pets.find((c: any) => c.Monster?.constructor?.$name === 'Osty');
      pets = pets.filter((c: any) => c !== osty);
      local.set(p, [-tx - bw(p) * 0.5 - 150, py]);
      if (osty) {
        const k = Math.min(Math.max(osty.MaxHp / 150, 0), 1);
        local.set(osty, [-tx + bw(p) * 0.5 + 150 + 100 * k, py - 75]);
      }
      tx += 100;
    }
    const step = pets.length > 1 ? bw(p) / (pets.length - 1) : 0;
    pets.forEach((pet: any, i: number) => local.set(pet, [-tx + 20 - i * step - bw(pet) * 0.5, py + 10]));
    tx += bw(p) + gap;
  }

  // enemies: encounter slots when the encounter has a scene, otherwise a centred row
  const enemies = list(cs.Enemies ?? []);
  const slots = spineIndex.encounters?.[enc?.Id?.Entry ?? ''];
  const unslotted = enemies.filter((c: any) => !(slots && c.SlotName && slots[c.SlotName]));
  for (const c of enemies) if (!unslotted.includes(c)) { const [mx, my] = slots[c.SlotName]; local.set(c, [mx - 960, my - 540]); }
  if (unslotted.length) {
    let g = 70, lift = 0;
    const sum = unslotted.reduce((a, c) => a + bw(c), 0);
    let total = sum + (unslotted.length - 1) * g;
    let v = Math.max((half - total) * 0.5, 150);
    if (v + total > half) {
      g = Math.max((half - 150 - sum) / (unslotted.length - 1), 5);
      total = sum + (unslotted.length - 1) * g;
      v = (half - total) * 0.5;
      if (g < 30) lift = 60 + (40 - 60) * ((g - 5) / 25);
    }
    unslotted.forEach((c: any, i: number) => { local.set(c, [v + bw(c) * 0.5, 200 - (i % 2 ? lift : 0)]); v += bw(c) + g; });
  }

  // AdjustCreatureScaleForAspectRatio: shrink both containers if the rightmost creature leaves the screen (`right` from
  // the viewport's left edge, as wide as the viewport)
  // ponytail: laid out once per creature, so a window resized mid-combat keeps the old fit until the next combat
  const toScreen = (p: [number, number]) => [960 + off[0] + p[0] * scaling, 540 + off[1] + p[1] * scaling];
  let right = 0;
  for (const [c, p] of local) right = Math.max(right, toScreen(p)[0] + bw(c) * 0.5 * scaling);
  right += 15 + view.ox;
  const k = right > view.w ? view.w / right : 1;
  const shift = right > view.w ? -(right - view.w) * k * scaling : 0; // applied to the enemy container only
  for (const [c, p] of local) {
    const e = info(c);
    const [bl, bt, w, h] = e.bounds ?? [-120, -280, 240, 280];
    const s = scaling * k;
    const [sx, sy] = toScreen([p[0] * k, p[1] * k]);
    out.set(c, { x: sx + (enemies.includes(c) ? shift : 0), y: sy, w: w * s, h: h * s, s, intent: [(e.intentPos?.[0] ?? 0) * s, (e.intentPos?.[1] ?? bt - 40) * s], flip: false, bl: bl * s, bt: bt * s });
  }
  return out;
}
/** A display object's transform in frame coordinates (its world transform less the stage's place in the viewport). */
const toFrame = (d: Container) => d.worldTransform.clone().translate(-view.ox, -view.oy);
const safeBool = (f: () => boolean) => { try { return !!f(); } catch { return false; } };
const safeNum = (f: () => number, d: number) => { try { const v = +f(); return Number.isFinite(v) && v > 0 ? v : d; } catch { return d; } };
const safeVec = (f: () => any): [number, number] => { try { const v = f(); return [v?.X ?? 0, v?.Y ?? 0]; } catch { return [0, 0]; } };
export function visualsKey(c: any): string {
  const id = (c.Player?.Character?.Id?.Entry ?? c.Monster?.Id?.Entry ?? '').toLowerCase();
  return `scenes/creature_visuals/${id}.tscn`;
}

function loadSpine(key: string, e: any): Promise<boolean> {
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      try {
        Assets.add({ alias: key + ':skel', ...skelSrc(e.spine.skel) });
        Assets.add({ alias: key + ':atlas', src: A + e.spine.atlas });
        await Assets.load([key + ':skel', key + ':atlas']);
        return true;
      } catch (err) {
        console.warn('spine load failed', key, err);
        return false;
      }
    })();
    loaded.set(key, p);
  }
  return p;
}

interface Actor { root: Container; spine?: Spine; key: string; lastAnimCount: number; dead: boolean; idle?: string; hue?: number; dieEnd?: number; death?: { at: number; phase: 'wait' | 'fade' }; animator?: any }

/**
 * MegaSprite / MegaAnimationState / MegaTrackEntry over a Pixi Spine: what CreatureAnimator (the model's
 * GenerateAnimator graph of AnimStates) drives. Started / completed / interrupted reach it as spine listener events.
 */
function megaSprite(sp: Spine, name: string) {
  const track = (e: any) => e && {
    SetTimeScale: (v: number) => { e.timeScale = v; },
    GetAnimationEnd: () => e.animationEnd,
    SetTrackTime: (v: number) => { e.trackTime = v; },
  };
  const state = {
    SetAnimation: (n: string, loop = true, t = 0) => track(sp.state.setAnimation(t, n, loop)),
    AddAnimation: (n: string, delay = 0, loop = true, t = 0) => track(sp.state.addAnimation(t, n, loop, delay)),
    GetCurrent: (t: number) => track(sp.state.getCurrent(t)),
    Update: (dt: number) => sp.state.update(dt),
    Apply: () => sp.state.apply(sp.skeleton),
  };
  const on = (kind: 'start' | 'complete' | 'interrupt') => (cb: any) => sp.state.addListener({ [kind]: () => cb?.Call?.(null, null, null) } as any);
  return {
    BoundObject: { Name: name },
    HasAnimation: (n: string) => !!sp.skeleton.data.findAnimation(n),
    GetAnimationState: () => state,
    GetSkeleton: () => sp.skeleton,
    ConnectAnimationStarted: on('start'), ConnectAnimationCompleted: on('complete'), ConnectAnimationInterrupted: on('interrupt'),
  };
}

/** A creature's visuals outside combat (bestiary): its Spine skeleton placed like the scene does, playing idle. */
export async function creatureSpine(key: string): Promise<{ root: Container; spine: Spine | null; names: string[]; bounds: number[] } | null> {
  const e = spineIndex[key];
  if (!e?.spine) {
    // sprite-only creatures: their scene is the body
    const s = await loadScene(key);
    if (!s) return null;
    const root = new Container();
    attachCreatureFx(root, s, null);
    return { root, spine: null, names: [], bounds: e?.bounds ?? [-120, -280, 240, 280] };
  }
  if (!(await loadSpine(key, e))) return null;
  const sp = Spine.from({ skeleton: key + ':skel', atlas: key + ':atlas', scale: 1 });
  sp.x = e.pos?.[0] ?? 0; sp.y = e.pos?.[1] ?? 0;
  sp.scale.set(e.scale?.[0] ?? 1, e.scale?.[1] ?? 1);
  try { if (e.skin && sp.skeleton.data.findSkin(e.skin)) sp.skeleton.setSkinByName(e.skin); } catch { /* default skin */ }
  sp.state.data.defaultMix = e.spine.mix ?? 0.1;
  const names = sp.skeleton.data.animations.map((x: any) => x.name);
  const idle = pick(names, ['idle_loop', 'idle', 'Idle', 'loop']) ?? names[0];
  if (idle) sp.state.setAnimation(0, idle, true);
  const root = new Container();
  root.addChild(sp);
  loadScene(key).then((s) => { if (s && !sp.destroyed) attachCreatureFx(root, s, sp); });
  return { root, spine: sp, names, bounds: e.bounds ?? [-120, -280, 240, 280] };
}
/** Play a bestiary action (attack/cast/hurt/die/revive/stun) then return to idle. */
export function playCreatureAction(sp: Spine, names: string[], action: string) {
  const name = pick(names, [action], true);
  if (!name) return false;
  const idle = pick(names, ['idle_loop', 'idle', 'Idle', 'loop']) ?? names[0];
  sp.state.setAnimation(0, name, false);
  if (idle && !/die|death|dead/i.test(name)) sp.state.addAnimation(0, idle, true, 0);
  return true;
}
export class CombatStage {
  root = new Container();
  bg = new Sprite();
  /** NCombatRoom.BackCombatVfxContainer: VFX drawn over the background, behind the creatures (render/vfx-misc). */
  backVfx = new Container();
  actors = new Map<any, Actor>();
  constructor(public view: any) {
    this.root.addChild(this.bg, this.backVfx);
  }
  async mount(el: HTMLElement) {
    activeStage = this;
    const a = await getApp();
    a.stage.removeChildren();
    a.stage.addChild(this.root);
    el.appendChild(a.canvas);
  }
  unmount() {
    if (activeStage === this) activeStage = null;
    app?.stage.removeChild(this.root);
    app?.canvas.remove();
  }
  /** Spines tick on the shared ticker until destroyed. */
  destroy() {
    this.unmount();
    this.root.destroy({ children: true });
    this.actors.clear();
  }
  bgLayer = new Container();
  /** NGameOverScreen's backstop wipe, drawn over the background and under the creatures (they die above it). */
  private underlay: Sprite | null = null;
  setUnderlay(canvas: HTMLCanvasElement | null) {
    // the stage root may have gone first (the combat room unmounts before the game over screen): already destroyed then
    if (this.underlay) { if (!this.underlay.destroyed) this.underlay.destroy({ texture: true }); this.underlay = null; }
    if (!canvas || this.root.destroyed) return;
    // ponytail: sized when the wipe starts (1.5 s long); a window resized under it leaves it until the next one
    const sp = new Sprite(Texture.from(canvas));
    sp.position.set(edge.l, edge.t);
    sp.width = view.w; sp.height = view.h;
    this.root.addChildAt(sp, this.bgLayer.parent === this.root ? this.root.getChildIndex(this.bgLayer) + 1 : 0);
    this.underlay = sp;
  }
  refreshUnderlay() { this.underlay?.texture.source.update(); }
  /** Background display tree (see render/scene.ts combatBackdropFor), drawn under the creatures. */
  setBackground(bg: Container | null) {
    if (this.root.destroyed) { bg?.destroy({ children: true }); return; }
    for (const old of this.bgLayer.removeChildren()) old.destroy({ children: true });
    if (this.bgLayer.parent !== this.root) this.root.addChildAt(this.bgLayer, 0);
    if (bg) this.bgLayer.addChild(bg);
  }
  sync() {
    const cs = this.view.combatState;
    if (!cs) return;
    const slots = new Map(layoutCreatures(cs));
    // NCombatRoom._removingCreatureNodes: removed creatures stay where they were until their death animation is over
    const removing: Map<any, Slot> = this.view.removing ?? new Map();
    for (const [c, s] of removing) if (!slots.has(c)) slots.set(c, s);
    for (const [c, a] of this.actors) if (!slots.has(c)) { a.root.destroy({ children: true }); this.actors.delete(c); }
    for (const [c, s] of slots) {
      let a = this.actors.get(c);
      if (!a) {
        a = { root: new Container(), key: visualsKey(c), lastAnimCount: 0, dead: false };
        this.actors.set(c, a);
        this.root.addChild(a.root);
        this.spawn(c, a);
      }
      // NCreature.AnimShake (a debuff): Visuals.x = 10·sin(4t)·sin(t/2), t = 2π·CubicOut(τ) over 1 s, not during "hurt"
      const shakeAt = (this.view.creatures.get(c) as any)?.shakeAt ?? 0, tau = (performance.now() - shakeAt) / 1000;
      const hurt = a.spine?.state.getCurrent(0)?.animation?.name === 'hurt';
      let dx = 0;
      if (tau >= 0 && tau < 1 && !hurt) { const t = 2 * Math.PI * (1 - (1 - tau) ** 3); dx = 10 * Math.sin(4 * t) * Math.sin(t / 2); }
      a.root.x = s.x + dx * s.s;
      a.root.y = s.y;
      a.root.scale.set(s.s * (s.vis ?? 1));
      const node = this.view.creatures.get(c) ?? this.view.removingNodes?.get(c);
      if (node && a.spine) {
        // triggers queued while the body loaded, then direct calls from the node
        for (const t of node.anims.splice(0)) this.trigger(a, t);
        if (node.onTrigger?.$actor !== a) { const f = (t: string) => { if (!a.root.destroyed && a.spine) this.trigger(a, t); }; (f as any).$actor = a; node.onTrigger = f; }
      }
      if (c.IsDead && !a.dead && a.spine) { a.dead = true; this.trigger(a, 'Dead'); }
      // SetScaleAndHue: a non-zero hue sets h on the body's normal material (hsv.tres unless it has one; render/slotmats)
      const hue = (node as any)?.Hue ?? 0;
      if (a.spine && (a.hue ?? 0) !== hue) {
        a.hue = hue;
        void slotMats(a.spine).setHue(hue);
      }
      if (removing.has(c)) this.animDie(c, a, s);
      const orbs = c.IsPlayer ? (node as any)?.OrbManager as OrbManagerView | null : null;
      if (orbs) this.syncOrbs(c, a, orbs);
    }
  }
  /**
   * NOrb visuals under the player's creature node: orb_visuals/<id> (spine idle_loop + particles) in a 1.5× container,
   * the NOrb at 0.85, scaling in on (re)creation; Glass is tinted by its DarkenedColor at 0 passive. The passive flash
   * (NOrb.Flash): two additive icon particles, 0.075 s apart, 0.5 s, scale 0.5 → 1.056, α ramp × 0.47 × strength 2.
   */
  private orbVis = new Map<number, { root: Container; sprite: Container | null; model: any; flashes: Sprite[] }>();
  private syncOrbs(c: any, a: Actor, ov: OrbManagerView) {
    const [cx, cy] = orbCentre(c), seen = new Set<number>(), now = performance.now();
    for (const n of ov.nodes) {
      seen.add(n.id);
      let v = this.orbVis.get(n.id);
      if (!v) { v = { root: new Container(), sprite: null, model: undefined, flashes: [] }; a.root.addChild(v.root); this.orbVis.set(n.id, v); }
      const id = n.model ? String(n.model.Id?.Entry ?? '').toLowerCase() : '';
      if (v.model !== n.model) {
        v.sprite?.destroy({ children: true });
        v.sprite = null;
        v.model = n.model;
        if (id) {
          const holder = (v.sprite = new Container());
          v.root.addChildAt(holder, 0);
          void loadScene(`scenes/orbs/orb_visuals/${id}.tscn`).then((sc) => { if (sc && !holder.destroyed) holder.addChild(buildScene(sc)); });
        }
      }
      v.root.position.set(cx + n.X, cy + n.Y);
      v.root.scale.set(0.85);
      v.root.alpha = n.A;
      if (v.sprite) {
        v.sprite.scale.set(1.5 * n.SpriteS);
        const glass = id === 'glass_orb' && Number(n.model?.PassiveVal) === 0;
        const dc = glass ? n.model.DarkenedColor : null;
        v.sprite.tint = dc ? ((dc.R * 255) << 16) | ((dc.G * 255) << 8) | (dc.B * 255) : 0xffffff;
      }
      // flashes: two particles per trigger
      while (v.flashes.length < n.flashes.length * 2) {
        const sp = new Sprite(Texture.EMPTY);
        sp.anchor.set(0.5);
        sp.blendMode = 'add';
        void sceneTexture(`images/orbs/${id}.png`).then((t) => { if (t && !sp.destroyed) sp.texture = t; });
        v.root.addChild(sp);
        v.flashes.push(sp);
      }
      v.flashes.forEach((sp, k) => {
        const t = (now - n.flashes[k >> 1] - (k & 1) * 75) / 500;
        if (t < 0 || t > 1) { sp.visible = false; return; }
        sp.visible = true;
        const ramp = t < 0.0572 ? t / 0.0572 : t < 0.533 ? 1 - ((t - 0.0572) / (0.533 - 0.0572)) * 0.053 : 0.947 * (1 - (t - 0.533) / (1 - 0.533));
        sp.alpha = 0.941 * ramp * (t < 0.0572 ? t / 0.0572 : 1);
        const k2 = curveAt([[0, 0.5, 0, 0.216], [1, 1.056, 0.302, 0]], t);
        sp.width = sp.height = 100 * k2;
      });
    }
    for (const [id, v] of this.orbVis) if (!seen.has(id)) { v.root.destroy({ children: true }); this.orbVis.delete(id); }
  }
  /** NCreature.GetCurrentAnimationLength after SetAnimationTrigger("Dead"): the die animation's length (0 before load). */
  dieLength(c: any) {
    const sp = this.actors.get(c)?.spine;
    const name = sp ? pick(sp.skeleton.data.animations.map((x: any) => x.name), ['die', 'death', 'dead'], true) : undefined;
    return name ? sp!.skeleton.data.findAnimation(name)?.duration ?? 0 : 0;
  }
  /**
   * NCreature.AnimDie for a removed monster: wait out the die animation + 0.5 s (sprite-only bodies: their
   * DeathAnimLengthOverride), then dissolve any visible body (NMonsterDeathVfx) unless ShouldFadeAfterDeath is off or the
   * game runs in Instant mode, and free it (the node's _ExitTree: detach) once that and the UI fade (1 s) are over.
   */
  private animDie(c: any, a: Actor, slot: Slot) {
    const now = performance.now();
    if (!a.death) a.death = { at: now, phase: 'wait' };
    if (a.death.phase !== 'wait') return;
    const m = c.Monster;
    const ready = a.spine ? now >= Math.min((a.dieEnd ?? now) + 500, a.death.at + 20000) : now >= a.death.at + (m?.HasDeathAnimLengthOverride ? m.DeathAnimLengthOverride * 1000 : 0);
    if (!ready) return;
    a.death.phase = 'fade';
    const instant = G.SaveManager.Instance?.PrefsSave?.FastMode === G.FastModeType.Instant;
    const free = () => { this.view.removingNodes?.get(c)?.detach?.(); this.view.removing?.delete(c); this.view.removingNodes?.delete(c); };
    const uiDone = a.death.at + (instant ? 0 : 1000);
    // Body.IsVisibleInTree(): the skeleton, or a sprite-only body's scene
    const body = a.spine ?? (a.root.children.length ? a.root : null);
    if (body?.visible && a.root.visible && m?.ShouldFadeAfterDeath !== false && !instant) void this.dissolve(c, a, slot).then((ms) => setTimeout(free, Math.max(ms, uiDone - performance.now())));
    else setTimeout(free, Math.max(0, uiDone - now));
  }
  /**
   * NMonsterDeathVfx: the body's current pose frozen into an N × N snapshot (a skeleton's bounds, a sprite body's hitbox —
   * its global position with its local size — × ExtraDeathVfxPadding, N the larger side, rendered at 2×) and burnt away by
   * dissolve.gdshader over min(2N / 192 · 2.5, 2.5) s (Sine Out), with the 500 blue flakes (emission radius N / 4,
   * 50–75 px/s) and enemy_fade. Returns its duration in ms.
   */
  private async dissolve(c: any, a: Actor, slot: Slot): Promise<number> {
    const sp: Container = a.spine ?? a.root, a0 = await getApp();
    const [sh, s] = await Promise.all([loadShader('shaders/dissolve.gdshader'), loadScene('scenes/vfx/vfx_monster_death.tscn')]);
    if (!sh || a.root.destroyed || this.root.destroyed) return 0;
    let b: { x: number; y: number; width: number; height: number };
    if (a.spine) {
      // the skeleton's current-pose AABB, to screen space through the body's transform
      const r = a.spine.skeleton.getBoundsRect(), wt = toFrame(sp);
      const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]].map(([x, y]) => wt.apply({ x, y }));
      const bx = Math.min(...pts.map((p) => p.x)), by = Math.min(...pts.map((p) => p.y));
      b = { x: bx, y: by, width: Math.max(...pts.map((p) => p.x)) - bx, height: Math.max(...pts.map((p) => p.y)) - by };
    } else {
      const k = slot.s || 1, w = slot.w / k, h = slot.h / k;
      b = { x: slot.x + slot.bl, y: slot.y + slot.bt, width: w, height: h };
    }
    const pad = (() => { try { const v = c.Monster.ExtraDeathVfxPadding; return [v.X || 1.2, v.Y || 1.2]; } catch { return [1.2, 1.2]; } })();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, n = Math.max(1, Math.round(Math.max(b.width * pad[0], b.height * pad[1])));
    const inv = toFrame(sp).invert(), p0 = inv.apply({ x: cx - n / 2, y: cy - n / 2 }), p1 = inv.apply({ x: cx + n / 2, y: cy + n / 2 });
    const frame = new Rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
    const tex = a0.renderer.generateTexture({ target: sp, frame, resolution: (2 * n) / frame.width, antialias: true });
    const [g1, g2] = dissolveNoise();
    const q = new QuadBatch(1, sh, tex, { dissolveGradient1: g1, dissolveGradient2: g2, threshold: 1 });
    const flip = toFrame(sp).a < 0;
    q.quad(0, [cx - n / 2, cy - n / 2, cx + n / 2, cy - n / 2, cx + n / 2, cy + n / 2, cx - n / 2, cy + n / 2], flip ? 1 : 0, 0, flip ? 0 : 1, 1, 1, 1, 1, 1);
    q.flush();
    const layer = new Container();
    layer.addChild(q);
    const it = s?.items.find((x: any) => x.k === 'particles');
    if (it) layer.addChild(particleItem({ ...it, m: [1, 0, 0, 1, cx, cy], ext: [n / 4, n / 4], vel: [50, 75] }, true));
    this.root.addChildAt(layer, this.root.getChildIndex(a.root));
    sp.visible = false;
    playOneShot('event:/sfx/enemy/enemy_fade');
    const d = Math.min(((2 * n) / 192) * 2.5, 2.5);
    let t = 0;
    animate((dt) => {
      if (layer.destroyed) return false;
      t += dt;
      q.group.uniforms.threshold = 1 - Math.sin((Math.min(t / d, 1) * Math.PI) / 2);
      q.group.update();
      if (t < d) return true;
      layer.destroy({ children: true });
      tex.destroy(true);
      return false;
    });
    return d * 1000;
  }
  private spawn(c: any, a: Actor) {
    const e = spineIndex[a.key];
    if (!e?.spine) {
      // sprite-only creatures (doors, the Crusher…): the scene is the body; a placeholder only if it was not converted
      loadScene(a.key).then((s) => {
        if (a.root.destroyed) return;
        if (s) attachCreatureFx(a.root, s, null);
        else a.root.addChild(new Graphics().roundRect(-90, -220, 180, 220, 24).fill({ color: c.IsPlayer ? 0x6b2a2a : 0x3a4a3a, alpha: 0.85 }));
      });
      return;
    }
    loadSpine(a.key, e).then((ok) => {
      if (!ok || a.root.destroyed) return;
      const sp = Spine.from({ skeleton: a.key + ':skel', atlas: a.key + ':atlas', scale: 1 });
      sp.x = e.pos?.[0] ?? 0;
      sp.y = e.pos?.[1] ?? 0;
      const flip = !c.IsPlayer && false;
      sp.scale.set((e.scale?.[0] ?? 1) * (flip ? -1 : 1), e.scale?.[1] ?? 1);
      try { if (e.skin && sp.skeleton.data.findSkin(e.skin)) sp.skeleton.setSkinByName(e.skin); } catch { /* default skin */ }
      sp.state.data.defaultMix = e.spine.mix ?? 0.1;
      const names = sp.skeleton.data.animations.map((x: any) => x.name);
      a.idle = pick(names, ['idle_loop', 'idle', 'Idle', 'loop']) ?? names[0];
      if (a.idle) sp.state.setAnimation(0, a.idle, true);
      // NCreature._spineAnimator: the model's own animation graph (MonsterModel / CharacterModel.GenerateAnimator)
      try {
        const model = c.Monster ?? c.Player?.Character;
        a.animator = model?.GenerateAnimator?.(megaSprite(sp, a.key)) ?? undefined;
      } catch (e) { console.warn('animator', a.key, e); a.animator = undefined; }
      a.spine = sp;
      a.root.addChild(sp);
      loadScene(a.key).then((s) => { if (s && !sp.destroyed) attachCreatureFx(a.root, s, sp); });
    });
  }
  private trigger(a: Actor, trigger: string) {
    const sp = a.spine!;
    if (trigger === 'Dead') a.dead = true;
    if (trigger === 'Revive') {
      a.dead = false;
      if (!a.animator?.HasTrigger('Revive')) {
        // AnimTempRevive (players): the body fades out (0.2 s), snaps to idle_loop and fades back in (0.2 s)
        const t = new $.WebTween(), o = { A: 1 };
        t.TweenProperty(o, 'a', 0, 0.2);
        t.TweenCallback(() => { if (!sp.destroyed && sp.skeleton.data.findAnimation('idle_loop')) sp.state.setAnimation(0, 'idle_loop', true); });
        t.TweenProperty(o, 'a', 1, 0.2);
        $.onFrame(() => { if (!sp.destroyed) sp.alpha = o.A; return t.IsValid(); });
        return;
      }
    }
    if (a.animator) {
      try { a.animator.SetTrigger(trigger); } catch (e) { console.warn('animator trigger', trigger, e); }
      if (trigger === 'Dead') { const e = sp.state.getCurrent(0); a.dieEnd = performance.now() + Math.max(0, (e?.animationEnd ?? 0) - (e?.trackTime ?? 0)) * 1000; deathEnd = Math.max(deathEnd, a.dieEnd); }
      return;
    }
    const names = sp.skeleton.data.animations.map((x: any) => x.name);
    const t = trigger.toLowerCase();
    const want = t.includes('dead') || t.includes('die') ? ['die', 'death', 'dead'] : t.includes('hit') || t.includes('hurt') ? ['hurt', 'hit', 'damage'] : t.includes('attack') ? ['attack'] : t.includes('cast') || t.includes('buff') ? ['cast', 'buff', 'skill'] : [t];
    const name = pick(names, want, true);
    if (!name) return;
    const dead = want[0] === 'die';
    const entry = sp.state.setAnimation(0, name, false);
    if (dead) { a.dieEnd = performance.now() + (entry?.animation?.duration ?? 0) * 1000; deathEnd = Math.max(deathEnd, a.dieEnd); }
    if (!dead && a.idle) sp.state.addAnimation(0, a.idle, true, 0);
  }
}
/**
 * dissolveGradient1 / 2: vfx_monster_death.tscn's NoiseTexture2Ds, Godot's defaults (512², normalized simplex-smooth FBM)
 * at frequencies 0.0234 and 0.0084. (Its Visual sprite shows a ViewportTexture, so the scene JSON has no item for them.)
 */
const dissolveNoise = () => [noiseTexture({ noise: { frequency: 0.0234 } }), noiseTexture({ noise: { frequency: 0.0084 } })];
function pick(names: string[], prefs: string[], fuzzy = false): string | undefined {
  for (const p of prefs) { const n = names.find((x) => x === p); if (n) return n; }
  if (fuzzy || true) for (const p of prefs) { const n = names.find((x) => x.toLowerCase().includes(p.toLowerCase()) && !x.startsWith('_')); if (n) return n; }
  return undefined;
}
void G;
