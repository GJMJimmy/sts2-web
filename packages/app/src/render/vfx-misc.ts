// Other scripted combat VFX (fire, smoke, beams, NDoomVfx, NSleepingVfx, NStunnedVfx, NPowerUpVfx, …): ports of the
// effects the rule layer creates. Create returns a web node; once the rule layer adds it to CombatVfxContainer (or
// NGlobalUi, a creature marker, …) its _Ready runs here: the converted scene is built as a node tree (SceneVfx) and the
// script's sequence restarts / stops its emitters and tweens its nodes at the original times.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColorMatrixFilter, Container, Filter, GlProgram, Graphics, Matrix, RenderTexture, Sprite, Text, Texture, UniformGroup, defaultFilterVert } from 'pixi.js';
import { G, $, N } from '../game';
import { combatVfxRoot, globalVfxRoot, curveAt } from './cardfx';
import { screenAware } from './vfx-attacks';
import { loadScene, buildScene, particleItem, sceneTexture, type SceneData } from './scene';
import { QuadBatch, plainShader, loadShader, bakedTexture, shaderTime } from './canvas';
import { activeStage, getApp, layoutCreatures } from './stage';
import { slotMats } from './slotmats';
import { ui } from '../store';
import { ContainerNode } from '../cardnodes';
import { loc } from '../i18n';

const I = [1, 0, 0, 1, 0, 0];
const M = (m: number[]) => new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);
const v2 = (x = 0, y = 0) => new $.Vector2(x, y);
const hex = (h: string) => [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1));
const rgba = (c: any) => [c?.R ?? 1, c?.G ?? 1, c?.B ?? 1, c?.A ?? 1];
const room = () => N('Rooms.NCombatRoom').Instance;
/** NGame.ScreenShake(ShakeStrength, ShakeDuration[, degrees]): Weak 2, Medium 3, Strong 4; Short 1, Normal 2. */
const shake = (strength: number, duration: number, deg?: number) => { try { N('NGame').Instance?.ScreenShake?.(strength, duration, deg); } catch { /* no game */ } };
/** Task.Delay (real time). */
const delay = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
/** Cmd.Wait: a scene-tree timer, skipped in Instant mode and while combat ends (the original semantics). */
const cmdWait = (s: number): Promise<void> => Promise.resolve(G.Cmd.Wait$2(s, false));
/** await ToSignal(GetTree(), ProcessFrame): resolves next frame with its delta. */
const frame = () => new Promise<number>((r) => $.onFrame((dt: number) => { r(dt); return false; }));
/** A WebTween's Finished as a promise. */
const finished = (t: any) => new Promise<void>((r) => t.whenFinished(r));

// ------------------------------------------------------------------ scene nodes
/** One GPUParticles2D of a converted scene: Restart, Emitting and Finished over render/scene's particleItem. */
class Particles {
  view = new Container();
  private cur: Container | null = null;
  constructor(public it: any) { if (it.emitting) this.restart(); }
  private get em(): any { return (this.cur as any)?.emitter ?? null; }
  /** GPUParticles2D.Restart: the cycle starts over (live particles cleared) and it emits. */
  restart() {
    this.cur?.destroy({ children: true });
    this.cur = particleItem({ ...this.it, m: I }, true);
    screenAware(this.view, this.cur, this.it);
  }
  set emitting(on: boolean) {
    const e = this.em;
    if (on) { if (!this.cur || e?.done) this.restart(); else if (e) e.emitting = true; }
    else if (e) e.emitting = false;
    else if (this.cur) { this.cur.destroy({ children: true }); this.cur = null; } // still loading: nothing emitted yet
  }
  /** One-shot emitters: every particle has died (Finished). */
  get done() { const e = this.em; return !this.cur || !!e?.done; }
  /** Resolves on Finished (or after `max` s: an emitter whose texture never loads never finishes). */
  async whenDone(max = 10) { const t0 = performance.now(); while (!this.view.destroyed && !this.done && performance.now() - t0 < max * 1000) await frame(); }
}

/**
 * A converted VFX scene as a tree of containers, one per Godot node (local transforms from the converter's root-local
 * matrices), so a script can scale / fade / hide a node and restart its emitters. clip_children nodes mask their
 * descendants by their own texture's alpha. `mods`: scene modulates of nodes the script drives, divided out of the
 * converted items' colours (which carry them) so the container's alpha / tint can stand for the node's modulate.
 * ponytail: z_index is ignored (the converter's draw order is kept per node); a scene that lifts a child over its
 * siblings with z_index (the hyperbeam's laser core, the dive-bomb impact core) draws in tree order.
 */
class SceneVfx {
  root = new Container();
  private nodes = new Map<string, Container>();
  private inner = new Map<string, Container>();
  ps = new Map<string, Particles>();
  constructor(public s: SceneData, over: Record<string, any> = {}, mods: Record<string, number[]> = {}) {
    this.nodes.set('.', this.root);
    for (const it0 of s.items) {
      let it = over[it0.p] ? { ...it0, ...over[it0.p] } : it0;
      for (const [p, m] of Object.entries(mods)) {
        if (it.color && (p === '.' || it.p === p || it.p.startsWith(p + '/'))) it = { ...it, color: it.color.map((x: number, k: number) => (m[k] ? x / m[k] : x)) };
      }
      const c = this.node(it.p);
      if (it.clipOnly) continue;
      if (it.k === 'particles') { const p = new Particles(it); this.ps.set(it.p, p); c.addChild(p.view); }
      else c.addChild(buildScene({ ...s, items: [{ ...it, m: I, clip: undefined }] }));
    }
  }
  private isClip(path: string) { return this.s.items.some((x) => x.clip === path); }
  /** Where a node's children go: the node, or its masked group when it clips them. */
  private childParent(path: string) {
    const c = this.nodes.get(path)!;
    if (path === '.' || !this.isClip(path)) return c;
    let g = this.inner.get(path);
    if (!g) {
      g = new Container();
      const clipper = this.s.items.find((x) => x.p === path && x.k === 'tex');
      if (clipper) {
        const m = buildScene({ ...this.s, items: [{ ...clipper, m: I, clip: undefined, clipOnly: undefined, shader: undefined, color: undefined }] });
        g.addChild(m);
        g.setMask({ mask: (m.children[0] as Container).children[0] as Sprite, channel: 'alpha' });
      }
      c.addChild(g);
      this.inner.set(path, g);
    }
    return g;
  }
  /** The container standing for node `path` ('.' is the scene root). */
  node(path: string): Container {
    let c = this.nodes.get(path);
    if (c) return c;
    const i = path.lastIndexOf('/'), pp = i < 0 ? '.' : path.slice(0, i);
    this.node(pp);
    c = new Container();
    c.setFromMatrix(this.local(path));
    this.childParent(pp).addChild(c);
    this.nodes.set(path, c);
    return c;
  }
  /** The node's transform in its parent (from the scene). */
  local(path: string): Matrix {
    const i = path.lastIndexOf('/'), pp = i < 0 ? '.' : path.slice(0, i);
    const pm = pp === '.' ? new Matrix() : M(this.s.nodes[pp] ?? I);
    return pm.invert().append(M(this.s.nodes[path] ?? I));
  }
  /** Node2D.Scale = (sx, sy) on a node whose scene scale is `base` (its rotation / skew kept). */
  scale(path: string, sx: number, sy: number, base: number[]) {
    const m = this.local(path), kx = sx / base[0], ky = sy / base[1];
    this.node(path).setFromMatrix(new Matrix(m.a * kx, m.b * kx, m.c * ky, m.d * ky, m.tx, m.ty));
  }
  p(path: string) { return this.ps.get(path) ?? null; }
  restart(paths: string[]) { for (const p of paths) this.p(p)?.restart(); }
  emit(paths: string[], on: boolean) { for (const p of paths) { const x = this.p(p); if (x) x.emitting = on; } }
  destroy() { if (!this.root.destroyed) this.root.destroy({ children: true }); }
}

// ------------------------------------------------------------------ the node Create returns
/** Pixi layer for where a node was added: CombatVfxContainer (over the creatures) or NGlobalUi (over the run). */
function layerOf(n: any): Container | null {
  if (n.$parent instanceof EventVfxContainer) return n.$parent.layer;
  if (room()?.CombatVfxContainer?.IsAncestorOf?.(n)) return combatVfxRoot();
  if (N('NRun').Instance?.GlobalUi?.IsAncestorOf?.(n)) return globalVfxRoot();
  return null;
}
/** Place a scene root at the node's global transform. */
function place(root: Container, n: any) {
  const t = n.xf();
  root.position.set(t.x, t.y);
  root.rotation = t.rot;
  root.scale.set(t.sx, t.sy);
}
/**
 * The node a VFX Create returns: a web node, so AddChildSafely puts it in the web tree; entering the tree runs `ready`
 * (the original _Ready) once. QueueFree takes its display with it.
 */
class VfxNode extends ContainerNode {
  private started = false;
  view: { destroy(): void } | null = null;
  constructor(private ready: (n: VfxNode) => void | Promise<void>) { super(); }
  IsInsideTree() { return !this.$freed && !!this.$parent; }
  $entered() {
    if (this.started) return;
    this.started = true;
    this.$onExit.push(() => this.view?.destroy());
    Promise.resolve(this.ready(this)).catch((e) => console.warn('[vfx]', e));
  }
  /** Build scene `path` into the node's layer at its global transform; null if it cannot be shown. */
  async scene(path: string, over?: Record<string, any>, mods?: Record<string, number[]>, layer?: Container | null): Promise<SceneVfx | null> {
    const s = await loadScene(path);
    const l = layer === undefined ? layerOf(this) : layer;
    if (!s || !l || this.$freed) { this.QueueFree(); return null; }
    const v = new SceneVfx(s, over, mods);
    place(v.root, this);
    l.addChild(v.root);
    this.view = v;
    return v;
  }
}
const create = (ready: (n: VfxNode) => void | Promise<void>, pos?: any) => {
  const n = new VfxNode(ready);
  if (pos) n.GlobalPosition = v2(pos.X, pos.Y);
  return n;
};
/** GetParent<Control>().Size: the web containers' sizes (NGlobalUi, a stub, fills the 1920 × 1080 viewport). */
const parentSize = (n: any) => { const z = n.$parent?.Size; return v2(z?.X || 1920, z?.Y || 1080); };
const isVec = (x: any) => x && typeof x === 'object' && 'X' in x && !('CurrentHp' in x);

// ------------------------------------------------------------------ fire
/**
 * NGroundFireVfx (vfx/fires/vfx_ground_fire) at the target's GetBottomOfHitbox: ApplyColor recolours the stepped-fire
 * shaders; AnimateIn: MainFire (its scene modulate 0.752941 overridden) scales 0 → 4 (0.5 s Back Out) and fades in to
 * 0.9 (Cubic Out) with the Ember burst; then MainFire and FlameSprites fade out (0.5 s) while MainFire settles to 2
 * (2 s Cubic InOut); FlameSprites stop, and it frees once the Ember burst is over.
 */
const FIRE = 'MainFire/VfxAdditiveStepFire/';
N('Vfx.NGroundFireVfx').Create = (target: any, color = 0) => {
  if (G.TestMode.IsOn) return null;
  const cn = room().GetCreatureNode(target);
  if (!cn) return null;
  return create(async (n) => {
    const s = await loadScene('scenes/vfx/fires/vfx_ground_fire.tscn');
    const over: Record<string, any> = {};
    // ApplyColor (Red: the scene's colours; Black / White: white outer + inner, 541b00 add)
    if (color !== 0 && s) {
      const [outer, inner, add] = ({ 1: ['2fa800', '06a000', '541b00'], 2: ['0099cd', '00a3bf', '000000'], 3: ['7821ff', '3f21ff', '541b00'] } as Record<number, string[]>)[color] ?? ['ffffff', 'ffffff', '541b00'];
      const sh = (p: string, params: any) => { const it = s.items.find((x) => x.p === FIRE + p); if (it) over[it.p] = { shader: { ...it.shader, params: { ...it.shader.params, ...params } } }; };
      sh('SteppedFireMix', { OuterColor: hex(outer), InnerColor: hex(inner) });
      sh('SteppedFireAdd', { OuterColor: hex(add) });
    }
    const v = await n.scene('scenes/vfx/fires/vfx_ground_fire.tscn', over, { MainFire: [1, 1, 1, 0.752941] });
    if (!v) return;
    const main = v.node('MainFire'), flames = v.node('FlameSprites'), ember = v.p('Ember')!;
    const o = { Scale: v2(0, 0), Modulate: new $.Color(1, 1, 1, 0) }, f = { Modulate: new $.Color(1, 1, 1, 1) };
    $.onFrame(() => {
      if (main.destroyed) return false;
      v.scale('MainFire', o.Scale.X, o.Scale.Y, [4, 4]);
      main.alpha = o.Modulate.A;
      flames.alpha = f.Modulate.A;
      return true;
    });
    ember.emitting = true;
    let t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'scale', v2(4, 4), 0.5).SetEase(1).SetTrans(10);
    t.TweenProperty(o, 'modulate:a', 0.9, 0.5).SetEase(1).SetTrans(7);
    await finished(t);
    v.emit(['FlameSprites'], true);
    t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'modulate:a', 0, 0.5);
    t.TweenProperty(f, 'modulate:a', 0, 0.5);
    t.TweenProperty(o, 'scale', v2(2, 2), 2).SetEase(2).SetTrans(7);
    await finished(t);
    v.emit(['FlameSprites'], false);
    await ember.whenDone();
    n.QueueFree();
  }, cn.GetBottomOfHitbox());
};

/**
 * NFireBurstVfx (vfx/vfx_fire_burst) at a creature's GetBottomOfHitbox or a floor position: scaled by scaleFactor,
 * mirrored at random; _modulateParticles take the tint (default #ff8b57) as self_modulate; every particle restarts, a
 * weak normal shake, freed after Cmd.Wait(2).
 */
const FIRE_TINT = 'ff8b57';
const fbCenter = (p: string) => `center_pivot/${p}`;
const FB_PARTICLES = ['vfx_fire_burst_center_flipbook', 'vfx_fire_burst_left_flipbook', 'vfx_fire_burst_right_flipbook', 'vfx_common_glow', 'vfx_common_specks_glow', 'vfx_common_hit_flare', 'vfx_common_specks', 'vfx_poof'].map(fbCenter);
const FB_MODULATE = FB_PARTICLES.slice(0, 6);
N('Vfx.NFireBurstVfx').Create = (a: any, scaleFactor: number, tint?: any) => {
  if (G.TestMode.IsOn) return null;
  let pos = a;
  if (!isVec(a)) { const cn = room()?.GetCreatureNode(a); if (!cn) return null; pos = cn.GetBottomOfHitbox(); }
  const col = tint ? rgba(tint) : hex(FIRE_TINT);
  const n = create(async (n) => {
    const v = await n.scene('scenes/vfx/vfx_fire_burst.tscn', Object.fromEntries(FB_MODULATE.map((p) => [p, { color: col }])));
    if (!v) return;
    v.restart(FB_PARTICLES);
    shake(2, 2);
    await cmdWait(2);
    n.QueueFree();
  }, pos);
  n.Scale = v2(scaleFactor * (Math.random() > 0.5 ? 1 : -1), scaleFactor);
  return n;
};

/**
 * NFireBurningVfx (vfx/vfx_fire_burning): at the floor, Modulate = tint (default #ff8b57), scaled, mirrored when not
 * going right; _startParticles restart, 0.3 s later _endParticles, freed 2 s after.
 */
const FBN = (p: string) => `fire_flipbook_container/${p}`;
N('Vfx.NFireBurningVfx').Create = (a: any, scaleFactor: number, goingRight: boolean, tint?: any) => {
  if (G.TestMode.IsOn) return null;
  let pos = a;
  if (!isVec(a)) { const cn = room()?.GetCreatureNode(a); if (!cn) return null; pos = cn.GetBottomOfHitbox(); }
  const col = tint ? rgba(tint) : hex(FIRE_TINT);
  const n = create(async (n) => {
    // the scene root's own modulate (the converted colours carry it) is replaced by the tint
    const v = await n.scene('scenes/vfx/vfx_fire_burning.tscn', undefined, { '.': [1, 0.54595, 0.342164, 1] });
    if (!v) return;
    v.root.tint = ((col[0] * 255) << 16) | ((col[1] * 255) << 8) | (col[2] * 255);
    v.root.alpha = col[3];
    v.restart(['vfx_fire_flipbook', 'vfx_common_specks', 'vfx_common_glow'].map(FBN));
    await cmdWait(0.3);
    v.restart(['vfx_fire_burst_right_flipbook', 'vfx_fire_flipbook_dark', 'vfx_common_specks_burst'].map(FBN));
    await cmdWait(2);
    n.QueueFree();
  }, pos);
  n.Scale = v2(scaleFactor * (goingRight ? 1 : -1), scaleFactor);
  return n;
};

/** NFireSmokePuffVfx / NSmokePuffVfx at the creature's VfxSpawnPosition: Ember and Clouds emit, freed after 2.5 s. */
function smokePuff(path: string, target: any, clouds?: any) {
  if (G.TestMode.IsOn) return null;
  const cn = room()?.GetCreatureNode(target);
  if (!cn) return null;
  return create(async (n) => {
    const v = await n.scene(path, clouds ? { Clouds: clouds } : undefined);
    if (!v) return;
    v.emit(['Ember', 'Clouds'], true);
    await delay(2.5);
    n.QueueFree();
  }, cn.VfxSpawnPosition);
}
N('Vfx.NFireSmokePuffVfx').Create = (target: any) => smokePuff('scenes/vfx/vfx_fire_smoke_puff.tscn', target);
// Purple: the clouds' process colour F6B1FF. ponytail: its hue variation ±0.02 is not simulated (render/particles has none)
N('Vfx.NSmokePuffVfx').Create = (target: any, c: number) => smokePuff('scenes/vfx/vfx_smoke_puff.tscn', target, c === 1 ? { tint: hex('F6B1FF') } : undefined);


// ------------------------------------------------------------------ bursts
/** NLineBurstVfx (a GPUParticles2D scene) at a creature's VfxSpawnPosition or a position: emits once, freed when done. */
N('Vfx.NLineBurstVfx').Create = (a: any) => {
  if (G.TestMode.IsOn) return null;
  return create(async (n) => {
    const v = await n.scene('scenes/vfx/vfx_line_burst.tscn');
    if (!v) return;
    const p = v.p('.')!;
    p.emitting = true;
    await p.whenDone();
    n.QueueFree();
  }, isVec(a) ? a : room().GetCreatureNode(a).VfxSpawnPosition);
};

/**
 * NKinPriestGrenadeVfx (vfx/monsters/kin_priest_grenade_vfx) at the target's GetBottomOfHitbox: blunt_attack.mp3,
 * noise and blast emit once, the crypto particles 100 ms later. (The original never frees the node; it is freed once
 * its 5 s wait is over, when every emitter is long done.)
 */
N('Vfx.NKinPriestGrenadeVfx').Create = (target: any) => {
  if (G.TestMode.IsOn) return null;
  const cn = room().GetCreatureNode(target);
  if (!cn) return null;
  return create(async (n) => {
    const v = await n.scene('scenes/vfx/monsters/kin_priest_grenade_vfx.tscn');
    if (!v) return;
    try { $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play('blunt_attack.mp3'); } catch { /* no audio */ }
    v.emit(['NoiseParticles', 'ExplosionBaseParticle'], true);
    await delay(0.1);
    v.emit(['CryptoParticles'], true);
    await delay(5);
    n.QueueFree();
  }, cn.GetBottomOfHitbox());
};

/**
 * NPowerUpVfx (vfx_power_up / vfx_ghostly_power_up) at the creature's VfxSpawnPosition, added to CombatVfxContainer by
 * Create: for 1 s its modulate is 1 except the first and last 0.1 s (a linear fade in / out), then it is freed.
 * ponytail: BackVfx (the SubViewport's 3D aura, reparented behind the creatures) is not drawn — no 3D renderer here.
 */
function powerUp(target: any, path: string) {
  if (G.TestMode.IsOn) return null;
  const cn = room()?.GetCreatureNode(target);
  if (!cn || !cn.IsInteractable) return null;
  const n = create(async (n) => {
    const v = await n.scene(path);
    if (!v) return;
    let timer = 1;
    $.onFrame((dt: number) => {
      if (v.root.destroyed) return false;
      timer -= dt;
      const d = Math.abs(timer / 1 - 0.5);
      v.root.alpha = d > 0.4 ? Math.max(0, 1 - (d - 0.4) / 0.1) : 1;
      if (timer >= 0) return true;
      n.QueueFree();
      return false;
    });
  }, cn.VfxSpawnPosition);
  G.GodotTreeExtensions.AddChildSafely(room().CombatVfxContainer, n);
  return n;
}
N('Vfx.NPowerUpVfx').CreateNormal = (t: any) => powerUp(t, 'scenes/vfx/vfx_power_up/vfx_power_up.tscn');
N('Vfx.NPowerUpVfx').CreateGhostly = (t: any) => powerUp(t, 'scenes/vfx/vfx_ghostly_power_up/vfx_ghostly_power_up.tscn');

// ------------------------------------------------------------------ whole screen
/**
 * NHorizontalLinesVfx (whole_screen/horizontal_lines_vfx, a GPUParticles2D): the process colour set to `color`, emitted
 * over the parent's height 500 px left of it (turned 180° about the parent's bottom-right when moving left); fades in
 * 0.45 s, holds max(1, duration) − 0.9 s, fades out 0.45 s. (The original leaves the invisible emitter in the tree.)
 */
N('Vfx.NHorizontalLinesVfx').Create = (color: any, duration = 2, right = true) => {
  if (G.TestMode.IsOn) return null;
  const dur = Math.max(1, duration);
  return create(async (n) => {
    const size = parentSize(n);
    const v = await n.scene('scenes/vfx/whole_screen/horizontal_lines_vfx.tscn', { '.': { tint: rgba(color), offset: [-500, size.Y * 0.5], ext: [200, size.Y * 0.5] } });
    if (!v) return;
    if (!right) { v.root.rotation = Math.PI; v.root.position.set(size.X, size.Y); }
    const o = { Modulate: new $.Color(1, 1, 1, 0) };
    $.onFrame(() => { if (v.root.destroyed) return false; v.root.alpha = o.Modulate.A; return true; });
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'modulate:a', 1, 0.45);
    t.Chain();
    t.TweenInterval(dur - 0.9);
    t.Chain();
    t.TweenProperty(o, 'modulate:a', 0, 0.45);
    await finished(t);
    n.QueueFree();
  });
};

/** A full-screen quad drawn with vertex colour `rgba` (Godot modulates above 1 brighten, which a Pixi tint cannot). */
function colorQuad(src: string, w: number, h: number, c: number[], blend: 'normal' | 'add'): Container {
  const holder = new Container();
  void sceneTexture(src).then((t) => {
    if (!t || holder.destroyed) return;
    const q = new QuadBatch(1, plainShader, t);
    q.quad(0, [0, 0, w, 0, w, h, 0, h], 0, 0, 1, 1, c[0], c[1], c[2], c[3]);
    q.flush();
    q.blendMode = blend;
    holder.addChild(q);
  });
  return holder;
}
/**
 * NSmokyVignetteVfx (whole_screen/vfx_smoky_vignette, a full-rect Control): Modulate = tint, Highlights (additive)
 * modulate = highlightColor; both fade in from 0 over 0.1 s to their alphas, then out over 1 s (Cubic In / linear).
 */
N('Vfx.NSmokyVignetteVfx').Create = (tint: any, hi: any) => {
  if (G.TestMode.IsOn) return null;
  const t0 = rgba(tint), h0 = rgba(hi);
  return create(async (n) => {
    const s = await loadScene('scenes/vfx/whole_screen/vfx_smoky_vignette.tscn');
    const layer = layerOf(n);
    if (!s || !layer || n.$freed) { n.QueueFree(); return; }
    const [base, high] = [s.items.find((x) => x.p === '.'), s.items.find((x) => x.p === 'Highlights')];
    const root = new Container(), hc = new Container();
    const size = parentSize(n);
    root.addChild(colorQuad(base.src, size.X, size.Y, [t0[0], t0[1], t0[2], 1], 'normal'), hc);
    hc.addChild(colorQuad(high.src, size.X, size.Y, [t0[0] * h0[0], t0[1] * h0[1], t0[2] * h0[2], 1], 'add'));
    layer.addChild(root);
    n.view = root;
    const a = { Modulate: new $.Color(1, 1, 1, 0) }, b = { Modulate: new $.Color(1, 1, 1, 0) };
    $.onFrame(() => { if (root.destroyed) return false; root.alpha = a.Modulate.A; hc.alpha = b.Modulate.A; return true; });
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(a, 'modulate:a', t0[3], 0.1).From(0);
    t.TweenProperty(b, 'modulate:a', h0[3], 0.1).From(0);
    t.Chain();
    t.TweenProperty(a, 'modulate:a', 0, 1).SetEase(0).SetTrans(7);
    t.TweenProperty(b, 'modulate:a', 0, 1);
    await finished(t);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ creature status
/**
 * NStunnedVfx (stunned_vfx.tscn) at the creature's GetTopOfHitbox: the "Stunned!" Label (Kreon bold, glyph spacing 2,
 * 48 px, cream, outline 16, shadow (5, 4)) in its 237 × 81 rect, centred; modulate:a → 1 (0.25 s Expo Out), 0.5 s,
 * → 0 (1 s); it rises 100 px over 2 s (Quart Out); freed when the fade ends.
 */
N('Vfx.NStunnedVfx').Create = (creature: any) => {
  if (G.TestMode.IsOn || N('Combat.NCombatUi').IsDebugHideTextVfx) return null;
  return create(async (n) => {
    const cn = room()?.GetCreatureNode(creature), layer = layerOf(n);
    if (!cn || !layer) { n.QueueFree(); return; }
    const p = cn.GetTopOfHitbox(), root = new Container();
    root.position.set(p.X, p.Y);
    // the codebase's label convention: Godot outline N → a centred stroke N / 2 under the fill
    const label = new Text({ text: loc('vfx', 'STUNNED'), style: {
      fontFamily: 'Kreon', fontWeight: '700', fontSize: 48, letterSpacing: 2, fill: 0xfff6e2, align: 'center',
      stroke: { color: 0x1c180f, alpha: 0.752941, width: 8, join: 'round' },
      dropShadow: { color: 0x000000, alpha: 0.25098, blur: 0, distance: Math.hypot(5, 4), angle: Math.atan2(4, 5) },
    } });
    label.anchor.set(0.5);
    const lx = (-121 + 116) / 2, ly0 = (1 + 82.333336) / 2;
    const o = { Modulate: new $.Color(1, 1, 1, 1), Position: v2(0, 0) };
    root.addChild(label);
    layer.addChild(root);
    n.view = root;
    $.onFrame(() => { if (root.destroyed) return false; label.alpha = o.Modulate.A; label.position.set(lx, ly0 + o.Position.Y); return true; });
    const t = new $.WebTween();
    t.TweenProperty(o, 'modulate:a', 1, 0.25).SetEase(1).SetTrans(5);
    t.TweenInterval(0.5);
    t.TweenProperty(o, 'modulate:a', 0, 1).SetEase(1).SetTrans(0);
    new $.WebTween().TweenProperty(o, 'position:y', -100, 2).SetEase(1).SetTrans(3);
    await finished(t);
    n.QueueFree();
  });
};

/** A creature's scene node the rule layer adds VFX to (GetSpecialNode), drawn in the creature's stage container. */
class CreatureMarker extends ContainerNode {
  constructor(public creature: any, public path: string, public behind: boolean) { super(); }
  IsInsideTree() { return true; }
}
const NCreature = N('Combat.NCreature');
const specialNode = NCreature.prototype.GetSpecialNode;
NCreature.prototype.GetSpecialNode = function (T: any, name: any) {
  // LagavulinMatriarch / SlumberingBeetle: Visuals/SleepVfxPos (a show_behind_parent Marker2D) holds NSleepingVfx
  if (String(name) === '%SleepVfxPos') return (this.$sleepMarker ??= new CreatureMarker(this.Entity, 'Visuals/SleepVfxPos', true));
  return specialNode.call(this, T, name);
};
/** The marker's container in the creature's stage body (its scene transform, behind or over the skeleton), once both exist. */
async function markerLayer(m: CreatureMarker, alive: () => boolean): Promise<Container | null> {
  const key = `scenes/creature_visuals/${String(m.creature.Player?.Character?.Id?.Entry ?? m.creature.Monster?.Id?.Entry ?? '').toLowerCase()}.tscn`;
  const s = await loadScene(key);
  const mm = s?.nodes[m.path];
  if (!mm) return null;
  for (;;) {
    if (!alive()) return null;
    const a: any = activeStage?.actors.get(m.creature);
    if (a?.spine && !a.root.destroyed) {
      const c = new Container();
      c.setFromMatrix(M(mm));
      a.root.addChildAt(c, m.behind ? a.root.getChildIndex(a.spine) : a.root.children.length);
      return c;
    }
    await frame();
  }
}

/**
 * NSleepingVfx (vfx/vfx_sleeping) on the creature's SleepVfxPos marker, behind the body: the glow bursts, the small
 * stars and Zs (the language's LocalizedTexture, drifting right or left) emit until Stop(): they stop emitting and it is
 * freed 5 s later.
 */
class SleepingVfx extends VfxNode {
  private v: SceneVfx | null = null;
  private stopped = false;
  Stop() {
    this.stopped = true;
    this.v?.emit(['vfx_starry_impact_small_stars', 'vfx_sleeping_z'], false);
    void cmdWait(5).then(() => this.QueueFree());
  }
}
N('Vfx.NSleepingVfx').Create = (_pos: any, goingRight = true) => {
  if (G.TestMode.IsOn) return null;
  const lang = G.SaveManager.Instance?.SettingsSave?.Language;
  const z: any = { dir: [goingRight ? 0.5 : -0.5, -1] };
  if (lang === 'jpn') z.src = 'images/vfx/sleeping/sleeping_z_jpn.png';
  const n: SleepingVfx = new SleepingVfx(async (n) => {
    const node = n as SleepingVfx, parent = n.$parent;
    const layer = parent instanceof CreatureMarker ? await markerLayer(parent, () => !n.$freed) : layerOf(n);
    const s = await loadScene('scenes/vfx/vfx_sleeping.tscn');
    if (!layer || !s || n.$freed) { if (layer && !layer.destroyed) layer.destroy({ children: true }); return; }
    const v = new SceneVfx(s, { vfx_sleeping_z: z });
    if (!(parent instanceof CreatureMarker)) place(v.root, n);
    layer.addChild(v.root);
    n.view = { destroy: () => { if (!layer.destroyed) layer.destroy({ children: true }); } };
    node['v'] = v;
    v.restart(['vfx_common_glow']);
    for (const p of ['vfx_starry_impact_small_stars', 'vfx_sleeping_z']) { v.p(p)?.restart(); }
    if (node['stopped']) v.emit(['vfx_starry_impact_small_stars', 'vfx_sleeping_z'], false);
  });
  return n;
};

// ------------------------------------------------------------------ Defect beams
/** VfxSpawnPosition, plus Defect.EyelineOffset when the owner plays the Defect. */
function eyePos(owner: any) {
  const cn = room()?.GetCreatureNode(owner);
  if (!cn) return null;
  const p = cn.VfxSpawnPosition, ch = owner.Player?.Character;
  if (ch instanceof G.Defect) { const o = ch.EyelineOffset; return v2(p.X + o.X, p.Y + o.Y); }
  return v2(p.X, p.Y);
}
const angleTo = (a: any, b: any) => Math.atan2(b.Y - a.Y, b.X - a.X);

/** NSweepingBeamImpactVfx (vfx/vfx_sweeping_beam_impact): its particles restart; freed after Cmd.Wait(2). */
function sweepImpact(pos: any) {
  if (G.TestMode.IsOn) return null;
  return create(async (n) => {
    // ponytail: GetTree().Root (over everything) → the NGlobalUi layer, the topmost the port draws into
    const v = await n.scene('scenes/vfx/vfx_sweeping_beam_impact.tscn', undefined, undefined, globalVfxRoot() ?? combatVfxRoot());
    if (!v) return;
    v.restart(['vfx_common_hit_flare', 'vfx_dagger_impact_core_right']);
    await cmdWait(2);
    n.QueueFree();
  }, pos);
}
N('Vfx.NSweepingBeamImpactVfx').Create = (a: any) => sweepImpact(isVec(a) ? a : room()?.GetCreatureNode(a)?.VfxSpawnPosition);

/**
 * NSweepingBeamVfx (vfx/vfx_sweeping_beam) at the owner's eye: start particles restart, the emitting ones run for the
 * 0.5 s sweep while _sweepingIndexCurve picks the sweep particle to restart; halfway a medium shake and an
 * NSweepingBeamImpactVfx on every target; then the end particles, the emitting ones stop, freed after Cmd.Wait(2).
 */
const SWEEP_CURVE = [[0, -1, 0, 0], [0.39770114, -1, 0, 0], [0.5218391, 2, 0, 0]];
const SB = {
  emitting: ['emitting/vfx_hyperbeam_core', 'emitting/vfx_common_hit_flare_transparent', 'emitting/vfx_common_hit_flare', 'emitting/vfx_common_glow'],
  start: ['start/vfx_common_ring_polar_b_1', 'start/vfx_dagger_impact_core_right', 'start/vfx_dagger_impact_core_left', 'start/vfx_sweeping_beam_flipbook'],
  end: ['end/vfx_common_ring_polar_b_2', 'end/vfx_common_specks', 'end/vfx_common_hit_flare'],
  sweeping: ['sweep_particles/vfx_common_specks_top', 'sweep_particles/vfx_common_specks_middle', 'sweep_particles/vfx_common_specks_bottom'],
};
N('Vfx.NSweepingBeamVfx').Create = (a: any, b: any) => {
  if (G.TestMode.IsOn) return null;
  let eye = a, targets: any[] = [...$.iter(b)];
  if (!isVec(a)) {
    eye = eyePos(a);
    if (!eye) return null;
    targets = targets.map((t) => room()?.GetCreatureNode(t)?.VfxSpawnPosition).filter(Boolean);
  }
  return create(async (n) => {
    const v = await n.scene('scenes/vfx/vfx_sweeping_beam.tscn');
    if (!v) return;
    v.emit(SB.emitting, false);
    let timer = 0, impacts = false, prev = -1;
    v.restart(SB.start);
    v.restart(SB.emitting);
    const dur = 0.5;
    while (timer < dur) {
      const t = timer / dur, i = Math.floor(curveAt(SWEEP_CURVE, t));
      if (prev !== i && i >= 0 && i < SB.sweeping.length) { v.p(SB.sweeping[i])?.restart(); prev = i; }
      if (t >= 0.5 && !impacts) {
        impacts = true;
        shake(3, 2);
        for (const p of targets) sweepImpact(p)?.$entered();
      }
      timer += await frame();
      if (n.$freed) return;
    }
    v.restart(SB.end);
    v.emit(SB.emitting, false);
    await cmdWait(2);
    n.QueueFree();
  }, eye);
};

/** Line2D sampling helpers: Godot gradients (offsets, RGBA colours; constant or linear) baked for a lut sampler. */
function gradAt(off: number[], cols: number[][], x: number, constant = false) {
  if (x <= off[0]) return cols[0];
  for (let i = off.length - 1; i >= 0; i--) {
    if (x < off[i]) continue;
    if (constant || i === off.length - 1) return cols[i];
    const f = (x - off[i]) / (off[i + 1] - off[i] || 1);
    return cols[i].map((c, k) => c + (cols[i + 1][k] - c) * f);
  }
  return cols[cols.length - 1];
}
/**
 * vfx_hyperbeam_laser_line (a Line2D, z_index 2): points along +x to 2000, width 500 × width_curve and the gradient
 * sampled by distance, UV tiled every 500 px (no texture: tile aspect 1), drawn with its material's shader.
 * ponytail: the shader's vertex() wobble (VERTEX.y from main_texture per vertex) is not applied — shaders here run
 * vertex() per fragment; the line stays straight.
 */
const LASER_X = [0, 50, 150, 400, 750, 1400, 2000];
const LASER_W = [[0, 0, 0, 13.993162], [0.09885058, 0.6968086, 0, 0.22560202], [1, 1, 0.21340723, 0]];
function laserLine(): Container {
  const holder = new Container();
  const lutOff = [0, 0.32492998, 0.63585436, 0.77310926], lutCol = [[0, 0.7005143, 1, 1], [0, 0.19745195, 0.8462217, 1], [0, 0.7005143, 1, 1], [1, 1, 1, 1]];
  const rgbaLut: number[] = [];
  for (let i = 0; i < 256; i++) rgbaLut.push(...gradAt(lutOff, lutCol, (i + 0.5) / 256, true));
  void Promise.all([loadShader('shaders/vfx/hyperbeam/vfx_hyperbeam_laser_line.gdshader'), sceneTexture('images/vfx/hyperbeam/hyperbeam_laser_line.png'), sceneTexture('images/vfx/hyperbeam/hyperbeam_laser_overlay.png')]).then(([sh, main, over]) => {
    if (!sh || !main || !over || holder.destroyed) return;
    const q = new QuadBatch(LASER_X.length - 1, sh, Texture.WHITE, { vpo_speed: 10, vpo_intensity: 50, main_texture: main, texture_panning_speed: -10, overlay: over, lut: bakedTexture({ w: 256, rgba: rgbaLut }) });
    const L = 2000, col = (x: number) => gradAt([0.0025974025, 1], [[2.454227, 2.454227, 2.454227, 1], [1, 1, 1, 1]], x / L);
    for (let i = 0; i < LASER_X.length - 1; i++) {
      const x0 = LASER_X[i], x1 = LASER_X[i + 1], w0 = (500 * curveAt(LASER_W, x0 / L)) / 2, w1 = (500 * curveAt(LASER_W, x1 / L)) / 2;
      const c0 = col(x0), c1 = col(x1);
      q.quad(i, [x0, -w0, x1, -w1, x1, w1, x0, w0], x0 / 500, 0, x1 / 500, 1, c0[0], c0[1], c0[2], c0[3]);
      q.col.set([...c1, ...c1], i * 16 + 4); // the right end's two vertices
    }
    q.flush();
    holder.addChild(q);
  });
  return holder;
}

/**
 * NHyperbeamVfx (vfx/vfx_hyperbeam) at the owner's eye, turned toward the main target: the laser (its particles, line
 * and container) hidden while the anticipation particles restart; after 0.525 s the laser shows (particles restarted)
 * with a medium shake; 0.5 s later it hides, the end particles restart with a strong short shake; freed 2 s later.
 * The vfx_outward_screen_distortion rings (BackBufferCopy + hint_screen_texture) draw on the stage (vfx-attacks screenAware).
 */
const HB = {
  anticipation: ['vfx_common_ray', 'vfx_hyperbeam_core', 'vfx_common_specks', 'vfx_common_ring_polar_b_1', 'vfx_common_ring_polar_b_2', 'vfx_common_glow', 'vfx_hyperbeam_laser_anticipation'].map((p) => `anticipation/${p}`),
  laser: ['vfx_hyperbeam_core', 'vfx_common_glow', 'vfx_common_hit_flare', 'vfx_common_hit_flare_transparent', 'vfx_common_ring_polar_a', 'vfx_common_specks_burst', 'vfx_common_specks_continuous', 'vfx_common_specks_right', 'BackBufferCopy/vfx_outward_screen_distortion'].map((p) => `laser/${p}`),
  end: ['vfx_dagger_impact_core_right', 'vfx_dagger_impact_core_left', 'vfx_hyperbeam_laser_end', 'vfx_common_ring_polar_b_1', 'vfx_common_ring_polar_b_2', 'vfx_common_specks_burst', 'vfx_common_specks_right', 'vfx_common_glow', 'BackBufferCopy/vfx_outward_screen_distortion'].map((p) => `end/${p}`),
};
N('Vfx.NHyperbeamVfx').Create = (a: any, b: any) => {
  if (G.TestMode.IsOn) return null;
  let eye = a, target = b;
  if (!isVec(a)) {
    eye = eyePos(a);
    target = room()?.GetCreatureNode(b)?.VfxSpawnPosition;
    if (!eye || !target) return null;
  }
  const n = create(async (n) => {
    const v = await n.scene('scenes/vfx/vfx_hyperbeam.tscn');
    if (!v) return;
    const laser = v.node('laser'), line = laserLine();
    laser.addChild(line);
    const show = (on: boolean) => {
      for (const p of HB.laser) { const c = v.node(p); c.visible = on; if (on) v.p(p)?.restart(); }
      line.visible = on;
      laser.visible = on;
    };
    show(false);
    v.restart(HB.anticipation);
    await cmdWait(0.525);
    if (n.$freed) return;
    show(true);
    shake(3, 2);
    await cmdWait(0.5);
    if (n.$freed) return;
    show(false);
    v.restart(HB.end);
    shake(4, 1);
    await cmdWait(2);
    n.QueueFree();
  }, eye);
  n.Rotation = angleTo(eye, target);
  return n;
};

/**
 * NHyperbeamImpactVfx (vfx/vfx_hyperbeam_impact) at the target's centre, turned along the beam: the start particles
 * show and restart; after Cmd.Wait(0.5) they hide and the end particles restart; freed 2 s later.
 */
const HBI = {
  start: ['impact_start/vfx_hyperbeam_impact_spikes', 'impact_start/vfx_common_ring_polar_b', 'impact_start/vfx_common_hit_flare'],
  end: ['impact_end/vfx_common_ring_polar_b', 'impact_end/vfx_common_hit_flare', 'impact_end/vfx_poof', 'impact_end/vfx_common_specks_right', 'impact_end/vfx_dagger_impact_core'],
};
N('Vfx.NHyperbeamImpactVfx').Create = (a: any, b: any) => {
  if (G.TestMode.IsOn) return null;
  let src = a, target = b;
  if (!isVec(a)) {
    src = eyePos(a);
    target = room()?.GetCreatureNode(b)?.VfxSpawnPosition;
    if (!src || !target) return null;
  }
  const n = create(async (n) => {
    const v = await n.scene('scenes/vfx/vfx_hyperbeam_impact.tscn');
    if (!v) return;
    for (const p of HBI.start) { v.node(p).visible = true; v.p(p)?.restart(); }
    await cmdWait(0.5);
    if (n.$freed) return;
    for (const p of HBI.start) v.node(p).visible = false;
    v.restart(HBI.end);
    await cmdWait(2);
    n.QueueFree();
  }, target);
  n.Rotation = angleTo(src, target);
  return n;
};

// ------------------------------------------------------------------ card overlays
const chaos = () => G.Rng.Chaotic;
/**
 * NNightmareHandsVfx (vfx/cards/nightmare_hands_vfx, a full-rect Control) freed after 2 s. Each SpookyHand
 * (NSpookyHandVfx, additive): red ±0.2, scales in from 0 after 0–0.4 s (0.4–0.5 s Spring Out), holds 0.3–0.6 s, then
 * shrinks to half (Back In) while fading (Quad Out) over 0.4–0.6 s; meanwhile it sways about its pivot
 * (sin(t·speed)·intensity, halved during its 50 ms pauses).
 */
const HAND_PIVOT = [[194, 0], [62, 0], [62, 0], [194, 0], [194, 0]];
N('Vfx.Cards.NNightmareHandsVfx').Create = () => {
  if (G.TestMode.IsOn) return null;
  return create(async (n) => {
    const s = await loadScene('scenes/vfx/cards/nightmare_hands_vfx.tscn');
    const layer = layerOf(n);
    if (!s || !layer || n.$freed) { n.QueueFree(); return; }
    const root = new Container();
    layer.addChild(root);
    n.view = root;
    s.items.forEach((it, i) => {
      const [px, py] = HAND_PIVOT[i] ?? [0, 0], m = M(it.m), P = m.apply({ x: px, y: py });
      const sx = Math.hypot(m.a, m.b), rot0 = Math.atan2(m.b, m.a), target = [sx, (m.a * m.d - m.b * m.c) / sx];
      const hand = buildScene({ ...s, items: [{ ...it, m: I }] });
      root.addChild(hand);
      const r = chaos();
      const st = { totalPauses: r.NextInt$2(2, 7), canPause: r.NextFloat$2(0.5, 1.2), speed: r.NextFloat$2(3, 5), intensity: r.NextFloat$2(0.1, 0.3), paused: false, pauseT: 0, pauses: 0, dur: 0 };
      const col = it.color ?? [1, 1, 1, 1];
      const o = { Scale: v2(0, 0), Modulate: new $.Color(col[0] + r.NextFloat$2(-0.2, 0.2), col[1], col[2], 1), Rotation: rot0 };
      const t = new $.WebTween().SetParallel();
      t.TweenInterval(r.NextDouble$2(0, 0.4));
      t.Chain();
      t.TweenProperty(o, 'scale', v2(target[0], target[1]), r.NextDouble$2(0.4, 0.5)).SetEase(1).SetTrans(11);
      t.Chain();
      t.TweenInterval(r.NextDouble$2(0.3, 0.6));
      t.Chain();
      const d = r.NextDouble$2(0.4, 0.6);
      t.TweenProperty(o, 'scale', v2(target[0] * 0.5, target[1] * 0.5), d).SetEase(0).SetTrans(10);
      t.TweenProperty(o, 'modulate:a', 0, d).SetEase(1).SetTrans(4);
      $.onFrame((dt: number) => {
        if (hand.destroyed) return false;
        st.dur += dt * st.speed;
        st.canPause -= dt;
        if (st.paused) {
          st.pauseT += dt;
          if (st.pauseT >= 0.05) { st.paused = false; st.pauseT = 0; st.pauses++; }
          o.Rotation = rot0 + Math.sin(st.dur) * st.intensity * 0.5;
        } else o.Rotation = rot0 + Math.sin(st.dur) * st.intensity;
        if (st.canPause < 0 && st.pauses < st.totalPauses) st.paused = true;
        hand.setFromMatrix(new Matrix().translate(-px, -py).scale(o.Scale.X, o.Scale.Y).rotate(o.Rotation).translate(P.x, P.y));
        hand.tint = ((Math.min(1, Math.max(0, o.Modulate.R)) * 255) << 16) | ((o.Modulate.G * 255) << 8) | (o.Modulate.B * 255);
        hand.alpha = o.Modulate.A; // new Color(r, g, b): AnimateIn's modulate has alpha 1
        return true;
      });
    });
    // the converted colour carries the modulate; the hands' own containers apply it now
    for (const c of root.children) c.children.forEach((q: any) => q.children?.forEach((sp: any) => { sp.tint = 0xffffff; sp.alpha = 1; }));
    await delay(2);
    n.QueueFree();
  });
};

/**
 * NAdditiveOverlayVfx (vfx/additive_overlay_vfx): a full-rect additive ColorRect, modulate (1, 0, 0, 0) for Red / Black
 * (the VfxColor presets otherwise), alpha → 0.1 (0.5 s Expo Out), 0.5 s, → 0 (0.5 s), then freed.
 */
const OVERLAY_COLOR: Record<number, string> = { 1: '00ff15', 2: '001aff', 3: 'b300ff', 5: 'ffffff', 6: '00fffb', 7: 'b17e00' };
function additiveOverlay(color = 0) {
  if (G.TestMode.IsOn) return null;
  return create(async (n) => {
    const layer = layerOf(n);
    if (!layer || n.$freed) { n.QueueFree(); return; }
    const size = parentSize(n), c = OVERLAY_COLOR[color] ? hex(OVERLAY_COLOR[color]) : [1, 0, 0];
    const g = new Graphics().rect(0, 0, size.X, size.Y).fill(0xffffff);
    g.tint = ((c[0] * 255) << 16) | ((c[1] * 255) << 8) | (c[2] * 255);
    g.blendMode = 'add';
    g.alpha = 0;
    layer.addChild(g);
    n.view = g;
    const o = { Modulate: new $.Color(c[0], c[1], c[2], 0) };
    $.onFrame(() => { if (g.destroyed) return false; g.alpha = o.Modulate.A; return true; });
    const t = new $.WebTween();
    t.TweenProperty(o, 'modulate:a', 0.1, 0.5).SetEase(1).SetTrans(5);
    t.TweenInterval(0.5);
    t.TweenProperty(o, 'modulate:a', 0, 0.5);
    await finished(t);
    n.QueueFree();
  });
}
N('Vfx.NAdditiveOverlayVfx').Create = (c?: number) => additiveOverlay(c);

/**
 * NHellraiserSwordVfx (vfx/cards/vfx_hellraiser/hellraiser_sword_vfx): a 200 × 200 clipping Control (pivot (50, 200))
 * at `pos` + (gaussian x, posY), scaled (0.7–0.9, 0.8–1.2) × 1–2; its 51 × 140 sword (random flip, ±20°, pivot
 * (25, 140)) waits 0–0.8 s, springs up from y 300 to 80 (0.25 s) while the modulate goes red → targetColor, holds
 * 0.25 s, sinks to 200 (0.5 s Expo In) fading out, then is freed.
 */
function hellraiserSword(layer: Container, pos: number[], posY: number, target: number) {
  const r = chaos();
  const flip = r.NextBool(), rotDeg = r.NextFloat$2(-20, 20);
  const k = r.NextFloat$2(1, 2), sc = [r.NextFloat$2(0.7, 0.9) * k, r.NextFloat$2(0.8, 1.2) * k];
  const x = pos[0] + r.NextGaussianFloat(0, 1, -500, 500), y = pos[1] + posY;
  // clip_contents: the 200 × 200 rect clips the sword (clip_children on a Control that draws nothing is taken as that rect)
  const root = new Container(), clip = new Graphics().rect(0, 0, 200, 200).fill(0xffffff), holder = new Container(), sw = new Sprite(Texture.EMPTY);
  root.position.set(x + 50, y + 200);
  root.pivot.set(50, 200);
  root.scale.set(sc[0], sc[1]);
  root.addChild(clip, holder);
  holder.mask = clip;
  const pivot = new Container();
  pivot.pivot.set(25, 140);
  pivot.rotation = (rotDeg * Math.PI) / 180;
  pivot.addChild(sw);
  holder.addChild(pivot);
  sw.width = 51; sw.height = 140;
  if (flip) { sw.anchor.x = 1; sw.scale.x *= -1; }
  void sceneTexture('images/packed/vfx/combat/hellraiser_sword.png').then((t) => { if (t && !sw.destroyed) { sw.texture = t; sw.width = 51; sw.height = 140; if (flip) sw.scale.x = -Math.abs(sw.scale.x); } });
  layer.addChild(root);
  const o = { Modulate: new $.Color(1, 1, 1, 1), Position: v2(25, 200) };
  $.onFrame(() => {
    if (root.destroyed) return false;
    pivot.position.set(o.Position.X + 25, o.Position.Y + 140);
    root.tint = ((o.Modulate.R * 255) << 16) | ((o.Modulate.G * 255) << 8) | (o.Modulate.B * 255);
    root.alpha = o.Modulate.A;
    return true;
  });
  const t = new $.WebTween().SetParallel();
  t.TweenInterval(r.NextDouble$0() * 0.8);
  t.Chain();
  t.TweenProperty(o, 'position:y', 80, 0.25).From(300).SetEase(1).SetTrans(11);
  t.TweenProperty(o, 'modulate', new $.Color(target, target, target, 1), 0.25).From(new $.Color(1, 0, 0, 1));
  t.Chain().TweenInterval(0.25);
  t.Chain();
  t.TweenProperty(o, 'position:y', 200, 0.5).SetEase(0).SetTrans(5);
  t.TweenProperty(o, 'modulate:a', 0, 0.5);
  t.Chain().TweenCallback(() => root.destroy({ children: true }));
}
/**
 * NHellraiserVfx at the target's GetBottomOfHitbox + (−100, −200): ten swords in front (posY 10–50 ascending, grey
 * 0.8 → 1) and, after the ironclad_hellraiser sound, ten behind the creatures (posY −50 → −10, grey 0.4 → 0.7), plus
 * an NAdditiveOverlayVfx; freed after 2 s.
 */
N('Vfx.Cards.NHellraiserVfx').Create = (target: any) => {
  if (G.TestMode.IsOn) return null;
  const b = room().GetCreatureNode(target).GetBottomOfHitbox(), pos = [b.X - 100, b.Y - 200];
  return create(async (n) => {
    const front = layerOf(n), back = activeStage?.backVfx;
    if (!front) { n.QueueFree(); return; }
    const r = chaos();
    const ys = Array.from({ length: 10 }, () => r.NextFloat$2(10, 50)).sort((a, c) => a - c);
    for (const y of ys) hellraiserSword(front, pos, y, G.MathHelper.Remap(y, 10, 50, 0.8, 1));
    const ys2 = Array.from({ length: 10 }, () => r.NextFloat$2(-50, -10));
    G.SfxCmd.Play$2('event:/sfx/characters/ironclad/ironclad_hellraiser', 1);
    ys2.sort((a, c) => a - c);
    for (const y of ys2) if (back && !back.destroyed) hellraiserSword(back, pos, y, G.MathHelper.Remap(y, -10, -50, 0.7, 0.4));
    G.GodotTreeExtensions.AddChildSafely(room().CombatVfxContainer, additiveOverlay());
    await delay(2);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ liquid overlay (a filter on the creature's skeleton)
/** vfx_potion_liquid_overlay_shader as a filter: SCREEN_UV is the fragment's design-space position over 1920 × 1080. */
const LIQUID_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform sampler2D uOverlay;
uniform sampler2D uLut;
uniform float uInfluence;
uniform vec4 uTint;
uniform float uTime;
uniform float uH;
vec4 straight(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
// get_hue_shifted_color at s = v = 1 (the body's colour is already modulated: base_color / col = 1)
vec3 hueShifted(vec3 rgb) {
  mat3 RGB_to_YIQ = mat3(vec3(0.2989, 0.5959, 0.2115), vec3(0.5870, -0.2774, -0.5229), vec3(0.1140, -0.3216, 0.3114));
  vec3 c = RGB_to_YIQ * rgb;
  float hue = mix(0.0, 6.283185, 1.0 - uH);
  float sh = sin(hue), ch = cos(hue);
  c *= mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, ch, -sh), vec3(0.0, sh, ch));
  // inverse(RGB_to_YIQ), precomputed (GLSL ES 1.00 contexts have no inverse())
  return mat3(vec3(1.0030614, 0.9992574, 0.9966738), vec3(0.9552047, -0.2717675, -1.1051157), vec3(0.6192834, -0.6464861, 1.7051188)) * c;
}
void main() {
  vec4 base = straight(texture(uTexture, vTextureCoord));
  base.rgb = hueShifted(base.rgb);
  vec2 suv = (uOutputFrame.xy + vTextureCoord * uInputSize.xy) / vec2(1920.0, 1080.0);
  vec4 dist = straight(texture(uOverlay, fract(suv * 10.0 + uTime * vec2(0.0, 0.0))));
  vec4 ov = straight(texture(uOverlay, fract(suv * 10.0 + uTime * vec2(0.0, -2.0) + dist.b * 0.1)));
  vec4 lut = texture(uLut, vec2(ov.r, 0.5)) * uTint;
  vec3 c = mix(base.rgb, lut.rgb, ov.a * step(0.5, base.a) * uInfluence);
  finalColor = vec4(c * base.a, base.a);
}`;
const liquid = new WeakMap<any, { f: Filter; timer: number }>();
/**
 * NCreatureVisuals.TryApplyLiquidOverlay: the SpineBody's material becomes potion_liquid_overlay (tint, overlay
 * influence 1 → 0 over 1 s, then the normal material again); while it runs a new tint restarts the timer.
 * The shader's hue stage uses the creature's hue (SetScaleAndHue; s = v = 1).
 */
async function applyLiquidOverlay(creature: any, tint: number[]) {
  const a: any = activeStage?.actors.get(creature), sp = a?.spine;
  if (!sp) return;
  const cur = liquid.get(sp);
  if (cur) { (cur.f.resources.liquid as any).uniforms.uTint = new Float32Array(tint); cur.timer = 1; return; }
  const over = await sceneTexture('images/vfx/potion/potion_liquid_overlay.png');
  if (!over || sp.destroyed || liquid.has(sp)) return;
  const lut: number[] = [];
  for (let i = 0; i < 256; i++) lut.push(...gradAt([0, 0.645429, 1], [[0.43, 0.43, 0.43, 1], [0.64, 0.64, 0.64, 1], [1, 1, 1, 1]], (i + 0.5) / 256));
  const h = Number(room()?.GetCreatureNode(creature)?.Hue ?? 0) || 1; // NCreatureVisuals._hue: 1 until SetScaleAndHue
  const u = new UniformGroup({ uInfluence: { value: 1, type: 'f32' }, uTint: { value: new Float32Array(tint), type: 'vec4<f32>' }, uTime: { value: shaderTime.t, type: 'f32' }, uH: { value: h, type: 'f32' } });
  const f = new Filter({ glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: LIQUID_FRAG, name: 'liquid-overlay', preferredFragmentPrecision: 'highp' }), resources: { liquid: u, uOverlay: over.source, uLut: bakedTexture({ w: 256, rgba: lut }).source } });
  const st = { f, timer: 1 };
  liquid.set(sp, st);
  // SetNormalMaterial: the overlay replaces the body's normal material (the hsv one of a re-hued creature, render/slotmats)
  // ponytail: drawn as a filter over the whole skeleton, where Godot shades only the normal-blend slots without their own
  // material; move it to slotMats(sp).setSprite('normal', …) once its SCREEN_UV shader runs on slot meshes
  const saved = sp.filters, mats = slotMats(sp), savedMat = mats.sprite.normal;
  sp.filters = [f];
  mats.setSprite('normal', null);
  $.onFrame((dt: number) => {
    if (sp.destroyed) return false;
    if (st.timer > 0) {
      u.uniforms.uInfluence = 1 - (1 - st.timer) / 1;
      u.uniforms.uTime = shaderTime.t;
      st.timer -= dt;
      return true;
    }
    sp.filters = sp.filters?.includes?.(f) ? saved : sp.filters;
    mats.setSprite('normal', savedMat ?? null);
    liquid.delete(sp);
    f.destroy();
    return false;
  });
}
/** NLiquidOverlayVfx: applies the target's liquid overlay (above) and frees itself after Cmd.Wait(0.5). */
N('Vfx.NLiquidOverlayVfx').Create = (target: any, tint: any) => {
  if (G.TestMode.IsOn) return null;
  const c = rgba(tint);
  return create(async (n) => {
    if (target) void applyLiquidOverlay(target, c);
    await cmdWait(0.5);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ minion dive bomb
/**
 * A Godot bezier animation track: keys (time, value, in handle (t, v), out handle (t, v)); between two keys the cubic
 * through value, value + out, next + in, next is solved for the time (Animation.bezier_track_interpolate).
 */
function bezierTrack(times: number[], pts: number[], t: number) {
  if (t <= times[0]) return pts[0];
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i], t1 = times[i + 1];
    if (t > t1) continue;
    const a = i * 5, b = a + 5;
    const x = [t0, t0 + pts[a + 3], t1 + pts[b + 1], t1], y = [pts[a], pts[a] + pts[a + 4], pts[b] + pts[b + 2], pts[b]];
    const at = (c: number[], u: number) => { const v = 1 - u; return v * v * v * c[0] + 3 * v * v * u * c[1] + 3 * v * u * u * c[2] + u * u * u * c[3]; };
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (at(x, m) < t) lo = m; else hi = m; }
    return at(y, (lo + hi) / 2);
  }
  return pts[(times.length - 1) * 5];
}
/** minion_animation_player: idle / rotating (a full turn every 1/6 s, looping) / punch (0.3 s squash); [rotation, sx, sy]. */
const MINION_ANIMS: Record<string, { len: number; loop: boolean; rot: [number[], number[]]; sx: [number[], number[]]; sy: [number[], number[]] }> = {
  idle: { len: 1, loop: true, rot: [[0], [0, -0.25, 0, 0.25, 0]], sx: [[0], [0.5, -0.25, 0, 0.25, 0]], sy: [[0], [0.5, -0.25, 0, 0.25, 0]] },
  rotating: { len: 0.16666834, loop: true, rot: [[0, 0.16666667], [0, 0, 0, 0, 0, 6.2831855, 0, 0, 0, 0]], sx: [[0], [0.5, 0, 0, 0, 0]], sy: [[0], [0.5, 0, 0, 0, 0]] },
  punch: {
    len: 0.3, loop: false, rot: [[0, 0.3], [0, -0.225, 0, 0.225, 0, 0, -0.225, 0, 0.225, 0]],
    sx: [[0, 0.1, 0.2, 0.3], [0.5, 0, 0, 0, 0.08188498, 0.6, -0.05, 0, 0.05, 0, 0.45, -0.05, 0, 0.049999993, 0, 0.5, -0.049999993, 0, 0, 0]],
    sy: [[0, 0.1, 0.2, 0.3], [0.5, 0, 0, 0, 0.08314443, 0.6, -0.05, 0, 0.05, 0, 0.45, -0.05, 0, 0.049999993, 0, 0.5, -0.049999993, 0, 0, 0]],
  },
};
const DIVE_H = [[0, 0, 0, 1.8950253], [0.5011494, 0.5012648, 0.19330244, 0.19330244], [1, 1, 2.1263278, 0]];
const DIVE_V = [[0, 0, 0, 8.119158], [0.35172412, 1, 0, 0], [0.65057474, 1, 0, 0], [1, 0, -8.887359, 0]];
const DIVE_TEX = [[0, 0, 0, 0], [0.24597703, 0, 0, 0], [0.25287354, 1.0025296, 0, 0], [0.6551724, 1.0025296, 0, 0], [0.6689655, 2, 0, 0]];
const MINION_TEX = ['flop', 'roll', 'dive'].map((n) => `images/vfx/minion_divebomb/minion_divebomb_${n}.png`);
const DB = 'vfx_minion_dive_bomb_';
const DB_IMPACT = ['vfx_heavy_blunt_hit_core', 'vfx_heavy_blunt_hit_core_glow', 'vfx_heavy_blunt_hit_spikes', 'vfx_heavy_blunt_hit_floor_smoke_left', 'vfx_heavy_blunt_hit_floor_smoke_right', 'vfx_common_specks_gray', 'vfx_common_specks_glow', 'vfx_common_hit_flare'].map((p) => `${DB}impact_particles/${p}`);
const DB_START = ['vfx_poof', 'vfx_common_specks'].map((p) => `${DB}start_particles/${p}`);
const DB_FALL = [`${DB}falling_particles/${DB}trail`, `${DB}falling_particles/${DB}rings`];
/**
 * NMinionDiveBombVfx (vfx/vfx_minion_dive_bomb) from the owner's VfxSpawnPosition to the target's GetBottomOfHitbox:
 * the minion (256² textures at the animation's 0.5 scale) flies 1 s from source + (100, 0) to target + (0, −100) along
 * _horizontalCurve, 400 px high by _verticalCurve, its texture and animation (idle / rotating / punch) picked by
 * _textureCurve (the start particles restart with the first); the falling particles join at 0.725 s. On landing it
 * hides, a weak short shake, the impact particles restart at the target, the falling ones stop; freed after Cmd.Wait(2).
 */
N('Vfx.NMinionDiveBombVfx').Create = (a: any, b: any) => {
  if (G.TestMode.IsOn) return null;
  let src = a, dst = b;
  if (!isVec(a)) {
    const o = room()?.GetCreatureNode(a), t = room()?.GetCreatureNode(b);
    if (!o || !t) return null;
    src = o.VfxSpawnPosition; dst = t.GetBottomOfHitbox();
  }
  return create(async (n) => {
    const v = await n.scene('scenes/vfx/vfx_minion_dive_bomb.tscn', { [`${DB}minion`]: { clipOnly: 1 } });
    if (!v) return;
    const minion = v.node(`${DB}minion`), falling = v.node(`${DB}falling_particles`), impact = v.node(`${DB}impact_particles`);
    const trail = v.node(DB_FALL[0]);
    const sp = new Sprite(Texture.EMPTY);
    sp.anchor.set(0.5);
    minion.addChildAt(sp, 0);
    const texs = MINION_TEX.map(() => null as Texture | null);
    MINION_TEX.forEach((p, i) => void sceneTexture(p).then((t) => { texs[i] = t; }));
    const local = (x: number, y: number) => [x - src.X, y - src.Y];
    let prev = -1, anim = 'idle', animT = 0;
    const show = (i: number) => {
      if (prev === i) return;
      prev = i;
      const k = Math.min(Math.max(i, 0), 2);
      const name = ['idle', 'rotating', 'punch'][k];
      if (anim !== name) { anim = name; animT = 0; }
      if (i === 0) v.restart(DB_START); // _minionVfx[0]; [1] (rotating) has no particles
    };
    const pose = () => {
      const A = MINION_ANIMS[anim], t = A.loop ? animT % A.len : Math.min(animT, A.len);
      const k = Math.min(Math.max(prev, 0), 2), tex = texs[k];
      if (tex && sp.texture !== tex) { sp.texture = tex; sp.width = 256; sp.height = 256; }
      minion.rotation = bezierTrack(A.rot[0], A.rot[1], t);
      minion.scale.set(bezierTrack(A.sx[0], A.sx[1], t), bezierTrack(A.sy[0], A.sy[1], t));
    };
    const start = [src.X + 100, src.Y], end = [dst.X, dst.Y - 100];
    trail.visible = true;
    show(0);
    minion.position.set(...(local(start[0], start[1]) as [number, number]));
    let timer = 0, falling0 = false;
    while (timer < 1) {
      const u = timer / 1, w = curveAt(DIVE_H, u), h = curveAt(DIVE_V, u);
      show(Math.floor(curveAt(DIVE_TEX, u)));
      const p = local(start[0] + (end[0] - start[0]) * w, start[1] + (end[1] - start[1]) * w - h * 400);
      minion.position.set(p[0], p[1]);
      falling.position.set(p[0], p[1]);
      if (timer >= 0.725 && !falling0) { v.restart(DB_FALL); trail.visible = true; falling0 = true; }
      pose();
      const dt = await frame();
      if (n.$freed) return;
      timer += dt;
      animT += dt;
    }
    minion.visible = false;
    shake(2, 1);
    impact.position.set(...(local(dst.X, dst.Y) as [number, number]));
    v.restart(DB_IMPACT);
    trail.visible = false;
    v.emit(DB_FALL, false);
    await cmdWait(2);
    n.QueueFree();
  }, src);
};

// ------------------------------------------------------------------ event rooms
/**
 * NEventLayout's %VfxContainer (a full-rect Control 39 px down, over the portrait and under the text): a web node whose
 * VFX draw into a layer over the event backdrop on the shared stage while its event room is on screen.
 */
class EventVfxContainer extends ContainerNode {
  layer = new Container();
  constructor(room: any) {
    super(0, 39, 'event-vfx');
    let seen = false;
    void getApp().then((app) => $.onFrame(() => {
      if (this.layer.destroyed) return false;
      const here = N('Rooms.NEventRoom').Instance === room && ui.room === room;
      seen ||= here;
      if (seen && !here) { this.layer.destroy({ children: true }); return false; }
      const st = app.stage;
      if (here && st.children[st.children.length - 1] !== this.layer) st.addChild(this.layer);
      return true;
    }));
  }
}
const eventVfx = new WeakMap<any, EventVfxContainer>();
Object.defineProperty(N('Rooms.NEventRoom').prototype, 'VfxContainer', {
  configurable: true,
  get() {
    if (this.layout === 'combat') return null; // NCombatEventLayout has no VfxContainer
    let c = eventVfx.get(this);
    if (!c) eventVfx.set(this, (c = new EventVfxContainer(this)));
    return c;
  },
});
/** NRainVfx (whole_screen/vfx_rain, a GPUParticles2D at (550, −300) in the event's VfxContainer), emitting for the room. */
N('Vfx.NRainVfx').Create = () => {
  if (G.TestMode.IsOn) return null;
  return create(async (n) => {
    const s = await loadScene('scenes/vfx/whole_screen/vfx_rain.tscn');
    const p = s?.root.pos ?? [0, 0];
    n.Position = v2(p[0], p[1]);
    await n.scene('scenes/vfx/whole_screen/vfx_rain.tscn');
  });
};

/**
 * Godot's FastNoiseLite at its defaults (OpenSimplex2S "simplex smooth", frequency 0.01, FBM 5 octaves, lacunarity 2,
 * gain 0.5): get_noise_1d(x) = GetNoise(x, 0) — a port of FastNoiseLite.h (skewed coordinates, int32 prime hashing,
 * the 128-entry 2-D gradient table: 24 directions every 15° from 7.5° five times, then 8 every 45° from 22.5°).
 */
const GRAD2D = new Float32Array(256);
for (let k = 0; k < 128; k++) {
  const a = ((k < 120 ? 7.5 + 15 * (k % 24) : 22.5 + 45 * (k - 120)) * Math.PI) / 180;
  GRAD2D[2 * k] = Math.sin(a);
  GRAD2D[2 * k + 1] = Math.cos(a);
}
const PX = 501125321, PY = 1136930381;
function grad2(seed: number, xp: number, yp: number, xd: number, yd: number) {
  let h = Math.imul(seed ^ xp ^ yp, 0x27d4eb2d);
  h ^= h >> 15;
  h &= 127 << 1;
  return xd * GRAD2D[h] + yd * GRAD2D[h | 1];
}
function openSimplex2S(seed: number, x: number, y: number) {
  const SQRT3 = 1.7320508075688772, G2 = (3 - SQRT3) / 6;
  let i = Math.floor(x), j = Math.floor(y);
  const xi = x - i, yi = y - j;
  i = Math.imul(i, PX); j = Math.imul(j, PY);
  const i1 = (i + PX) | 0, j1 = (j + PY) | 0;
  const t = (xi + yi) * G2, x0 = xi - t, y0 = yi - t;
  const a0 = 2 / 3 - x0 * x0 - y0 * y0;
  let v = a0 * a0 * (a0 * a0) * grad2(seed, i, j, x0, y0);
  const a1 = 2 * (1 - 2 * G2) * (1 / G2 - 2) * t + (-2 * (1 - 2 * G2) * (1 - 2 * G2) + a0);
  v += a1 * a1 * (a1 * a1) * grad2(seed, i1, j1, x0 - (1 - 2 * G2), y0 - (1 - 2 * G2));
  const add = (dx: number, dy: number, xp: number, yp: number) => { const a = 2 / 3 - dx * dx - dy * dy; if (a > 0) v += a * a * (a * a) * grad2(seed, xp | 0, yp | 0, dx, dy); };
  const xmyi = xi - yi;
  if (t > G2) {
    if (xi + xmyi > 1) add(x0 + (3 * G2 - 2), y0 + (3 * G2 - 1), i + (PX << 1), j + PY);
    else add(x0 + G2, y0 + (G2 - 1), i, j + PY);
    if (yi - xmyi > 1) add(x0 + (3 * G2 - 1), y0 + (3 * G2 - 2), i + PX, j + (PY << 1));
    else add(x0 + (G2 - 1), y0 + G2, i + PX, j);
  } else {
    if (xi + xmyi < 0) add(x0 + (1 - G2), y0 - G2, i - PX, j);
    else add(x0 + (G2 - 1), y0 + G2, i + PX, j);
    if (yi < xmyi) add(x0 - G2, y0 - (G2 - 1), i, j - PY);
    else add(x0 + G2, y0 + (G2 - 1), i, j + PY);
  }
  return v * 18.24196194486065;
}
function noise1d(seed: number, px: number) {
  const F2 = 0.5 * (1.7320508075688772 - 1);
  let x = px * 0.01, y = 0;
  const t = (x + y) * F2;
  x += t; y += t;
  let sum = 0, amp = 1 / (1 + 0.5 + 0.25 + 0.125 + 0.0625);
  for (let o = 0; o < 5; o++) {
    sum += openSimplex2S((seed + o) | 0, x, y) * amp;
    x *= 2; y *= 2; amp *= 0.5;
  }
  return sum;
}

/**
 * NMirrorVfx (whole_screen/mirror_vfx) in the event's VfxContainer: three mirror-shaped clips (mirror_mask3 at
 * (480, 540)) each showing a Reflection — the screen copy (screencap.gdshader reads hint_screen_texture) in a
 * 1920 × 1080 rect at (−1040, −1080), pivot (960, 540), turned −2° / 0° / +2°. Every frame the masks and their
 * reflections scale by 1.05 + noise (seeds 0, 2, 4) and the masks turn |noise| × 10 / 20 / 30° (seeds 1, 3, 5), the
 * noise at 2 × elapsed seconds. The screen copy is the event backdrop under the layer, re-rendered each frame.
 */
N('Vfx.NMirrorVfx').Create = () => {
  if (G.TestMode.IsOn) return null;
  return create(async (n) => {
    const s = await loadScene('scenes/vfx/whole_screen/mirror_vfx.tscn'), layer = layerOf(n), app = await getApp();
    if (!s || !layer || n.$freed) { n.QueueFree(); return; }
    const root = new Container(), rt = RenderTexture.create({ width: 1920, height: 1080 });
    place(root, n);
    layer.addChild(root);
    n.view = { destroy: () => { root.destroy({ children: true }); rt.destroy(true); } };
    const masks = [1, 2, 3].map((k) => {
      const mi = s.items.find((x) => x.p === `Mask${k}`), ri = s.items.find((x) => x.p === `Mask${k}/Reflection`);
      const holder = new Container();
      holder.position.set(mi.m[4], mi.m[5]);
      const m = buildScene({ ...s, items: [{ ...mi, m: I, clipOnly: undefined }] }), clipped = new Container();
      holder.addChild(m, clipped);
      clipped.setMask({ mask: (m.children[0] as Container).children[0] as Sprite, channel: 'alpha' });
      const refl = new Container(), sp = new Sprite(rt);
      refl.position.set(-1040 + 960, -1080 + 540);
      refl.pivot.set(960, 540);
      refl.rotation = Math.atan2(ri.m[1], ri.m[0]);
      sp.width = 1920; sp.height = 1080;
      refl.addChild(sp);
      clipped.addChild(refl);
      root.addChild(holder);
      return { holder, refl };
    });
    let total = 0;
    $.onFrame((dt: number) => {
      if (root.destroyed) return false;
      // hint_screen_texture: what the screen holds under this layer
      const below = app.stage.children.filter((c) => c !== layer && c.visible);
      below.forEach((c, i) => app.renderer.render({ container: c, target: rt, clear: i === 0 }));
      total += dt * 2;
      masks.forEach((m, k) => {
        const sc = 1.05 + noise1d(2 * k, total), rot = Math.abs(noise1d(2 * k + 1, total)) * 10 * (k + 1);
        m.holder.scale.set(sc);
        m.holder.rotation = (rot * Math.PI) / 180;
        m.refl.scale.set(sc);
      });
      return true;
    });
  });
};

// ------------------------------------------------------------------ doom
/**
 * NDoomSubEmitterVfx over one half of vfx_doom (DoomVfxBack / DoomVfxFront): its scalable layers take CurScaleX as an
 * x scale (the vertical-shrinking one also shrinks in y below 1); ShowOrHide(width, time) turns it on (particles
 * restart, the dense one gets (int)width × 300 particles, the spears start firing) and tweens CurScaleX to the width
 * (Cubic Out), or off after 0.3 s (to 0 over CurScaleX × 0.15 s, Cubic In; then the particles stop). A spear fires at
 * a random x (±70 − 20), leaning x × 0.15 + 4°, x-scale 0.4 / CurScaleX, shrinking from 1–1.5 to 0 in y over
 * 0.3–0.6 s while fading in to 0.4–0.7 (0.2 s Quad In), and fires again while the emitter is on.
 */
class DoomSub {
  private cur = 0;
  private on = false;
  private tween: any = null;
  private base = new Map<string, number[]>();
  constructor(private v: SceneVfx, private root: string, private layers: string[], private spears: string[], private shrink: string, private dense: string) {
    for (const l of this.layers) { const m = v.local(`${root}/${l}`); this.base.set(l, [Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)]); }
    this.setVisibility(false);
    this.width(0);
    this.showOrHide(0, 0);
  }
  private width(w: number) {
    this.cur = w;
    for (const l of this.layers) {
      const b = this.base.get(l)!, p = `${this.root}/${l}`;
      this.v.scale(p, b[0] * w, l === this.shrink && w < 1 ? b[1] * w : b[1], b);
    }
  }
  private setVisibility(on: boolean) {
    for (const l of this.layers) { const p = this.v.p(`${this.root}/${l}`); if (p) { if (on) p.restart(); else p.emitting = false; } }
    if (on) for (const s of this.spears) this.fire(s);
  }
  private fire(path: string) {
    const r = chaos(), node = this.v.node(`${this.root}/${path}`), m0 = this.v.local(`${this.root}/${path}`);
    if (node.destroyed) return;
    const y0 = m0.apply({ x: 20, y: 206 }).y - 206;
    const x = r.NextFloat$2(140 * -0.5, 140 * 0.5) - 20, rot = ((x * 0.15 + 4) * Math.PI) / 180;
    const sx = 0.4 / this.cur;
    const o = { Scale: v2(sx, r.NextFloat$2(1, 1.5)), Modulate: new $.Color(1, 1, 1, 0) };
    const apply = () => {
      node.visible = Number.isFinite(sx);
      if (node.visible) node.setFromMatrix(new Matrix().translate(-20, -206).scale(o.Scale.X, o.Scale.Y).rotate(rot).translate(x + 20, y0 + 206));
      node.alpha = o.Modulate.A;
    };
    const t = new $.WebTween();
    t.TweenProperty(o, 'scale', v2(sx, 0), r.NextFloat$2(0.3, 0.6)).From(v2(sx, r.NextFloat$2(1, 1.5)));
    if (this.on) t.TweenCallback(() => this.fire(path));
    new $.WebTween().TweenProperty(o, 'modulate', new $.Color(1, 1, 1, r.NextFloat$2(0.4, 0.7)), 0.2).SetEase(0).SetTrans(4);
    $.onFrame(() => { if (node.destroyed || !t.IsValid()) return false; apply(); return true; });
    apply();
  }
  showOrHide(w: number, time: number) {
    this.on = w > 0.1;
    const delay = this.on ? 0 : 0.3;
    let to = w, ease = 1;
    if (this.on) {
      const d = this.v.p(`${this.root}/${this.dense}`), n = Math.trunc(w) * 300;
      if (d) d.it = { ...d.it, amount: n <= 1 ? 1 : n };
      this.setVisibility(true);
    } else { ease = 0; to = 0; time = this.cur * 0.15; }
    this.tween?.Kill();
    const o = { CurScaleX: this.cur }, t = (this.tween = new $.WebTween());
    t.TweenProperty(o, 'CurScaleX', to, time).SetDelay(delay).SetEase(ease).SetTrans(7);
    if (!this.on) t.TweenCallback(() => this.setVisibility(false));
    $.onFrame(() => { if (this.v.root.destroyed || this.tween !== t) return false; this.width(o.CurScaleX); return t.IsValid(); });
  }
}
const DOOM_SPEARS = (h: string) => [1, 2, 3, 4].map((i) => `${h}/Spear${i}`);
/** Grayscale (hsv.gdshader at h = 1, s = 0, v = 1: YIQ luma), the Visual sprite's material over the doomed body. */
function doomGray() {
  const f = new ColorMatrixFilter(), y = [0.2989, 0.587, 0.114];
  f.matrix = [...y, 0, 0, ...y, 0, 0, ...y, 0, 0, 0, 0, 0, 1, 0] as any;
  return f;
}
/**
 * NDoomVfx (vfx/vfx_doom) at the hitbox's bottom centre, scaled by the scene container: the necrobinder_doom_kill sound;
 * a doomed body (shouldDie) is moved into the effect's 1.5 × hitbox viewport (feet at its bottom centre, grayscale by
 * the Visual's hsv material) and clipped at the floor line 9 px up; a weak short shake at 180 ± 10°; both sub-emitters
 * open to viewport width / 260 over 0.5 s; after 0.75 s the body sinks the viewport's height (0.75 s Expo In); the
 * emitters close, and 2 s later it is freed — VfxTask (DoomPower's DeathAnimationTask half) completes then.
 * ponytail: the doomed body stays on the stage canvas (clipped and slid there, its die trigger held back), so the back
 * half is drawn just under that body and the front half over all creatures, where the original draws the whole group
 * over all creatures; the viewport's second camera scaling of the body is not applied (1 in most encounters).
 */
N('Vfx.NDoomVfx').Create = (visuals: any, position: any, size: any, shouldDie: boolean) => {
  if (G.TestMode.IsOn) return null;
  const r = room(), nodes: any[] = r ? [...r.CreatureNodes, ...(r.removingNodes?.values?.() ?? [])] : [];
  const cv = nodes.find((x) => x.Visuals === visuals), c = cv?.Entity;
  const cs = r?.combatState, slot = c && cs ? layoutCreatures(cs).get(c) ?? r.removing?.get(c) : null;
  const scaling = (() => { try { return Number(cs?.Encounter?.GetCameraScaling()) || 1; } catch { return 1; } })();
  // CreatureView has no Hitbox Control: its rect is the slot's bounds (what Hitbox.GlobalPosition / Size stand for)
  const hb = slot ? { x: slot.x + slot.bl, y: slot.y + slot.bt, w: slot.w / scaling, h: slot.h / scaling } : { x: position?.X ?? 0, y: position?.Y ?? 0, w: size?.X ?? 0, h: size?.Y ?? 0 };
  const tcs = new $.TaskCompletionSource();
  const actor: any = shouldDie && c ? activeStage?.actors.get(c) : null;
  if (actor) {
    actor.dead = true; // the body is the effect's now: no "Dead" animation, no death dissolve
    actor.death = { at: performance.now(), phase: 'doom' };
    const e = actor.spine?.state.getCurrent(0);
    if (e?.animation?.name === 'hurt') { e.trackTime = 0.1; e.timeScale = 0; } // StartDoomAnim's frozen hurt pose
  }
  const n = new VfxNode(async (n) => {
    try {
      G.SfxCmd.Play$2('event:/sfx/characters/necrobinder/necrobinder_doom_kill', 1);
      const s = await loadScene('scenes/vfx/vfx_doom.tscn'), front = layerOf(n);
      if (!s || !front || n.$freed) return;
      const vw = Math.trunc(hb.w * 1.5), vh = Math.trunc(hb.h * 1.5), ox = hb.x + (hb.w * scaling) / 2, oy = hb.y + hb.h * scaling;
      const part = (p: string) => ({ ...s, items: s.items.filter((it) => it.p.startsWith(p + '/')) });
      const spearMods = (h: string) => Object.fromEntries(DOOM_SPEARS(h).map((p) => [p, [1, 1, 1, 0.533333]]));
      const back = new SceneVfx(part('DoomVfxBack'), {}, spearMods('DoomVfxBack/SpearHolderBack'));
      const fore = new SceneVfx(part('DoomVfxFront'), {}, spearMods('DoomVfxFront/SpearHolder'));
      const stageRoot: Container | undefined = actor ? activeStage?.root : undefined;
      for (const v of [back, fore]) { v.root.position.set(ox, oy); v.root.scale.set(scaling); }
      if (actor && stageRoot && !actor.root.destroyed) stageRoot.addChildAt(back.root, stageRoot.getChildIndex(actor.root));
      else front.addChild(back.root);
      front.addChild(fore.root);
      n.view = { destroy: () => { back.destroy(); fore.destroy(); } };
      const subs = [
        new DoomSub(back, 'DoomVfxBack', ['doom_floor_globs_back', 'doom_globs_floaty_back', 'DoomFlameHolder', 'DoomHoleHolder'], DOOM_SPEARS('SpearHolderBack'), 'DoomFlameHolder', 'doom_floor_globs_back'),
        new DoomSub(fore, 'DoomVfxFront', ['doom_globs_gravity', 'doom_globs_floaty', 'DoomGlowHolder', 'doom_floor_globs', 'doom_floor_globs_inner'], DOOM_SPEARS('SpearHolder'), 'DoomGlowHolder', 'doom_floor_globs'),
      ];
      // the body in the viewport: feet at its bottom centre, sliding down with the Visual, clipped by viewport and Mask
      const o = { Position: v2(0, -vh * 0.5) };
      let clip: Graphics | null = null;
      if (actor && stageRoot && !actor.root.destroyed) {
        clip = new Graphics();
        stageRoot.addChild(clip);
        actor.root.mask = clip;
        actor.root.filters = [...(actor.root.filters ?? []), doomGray()];
        const follow = () => {
          if (actor.root.destroyed || !clip || clip.destroyed) return false;
          const k = actor.root.scale.y || 1, dy = (o.Position.Y + vh * 0.5) * scaling;
          actor.root.pivot.set((actor.root.x - ox) / k, (actor.root.y - oy - dy) / k);
          const top = oy - vh * scaling + dy, bottom = Math.min(oy + dy, oy - 9 * scaling);
          clip.clear();
          if (bottom > top) clip.rect(ox - (vw / 2) * scaling, top, vw * scaling, bottom - top).fill(0xffffff);
          return true;
        };
        follow();
        $.onFrame(follow);
      }
      shake(2, 1, 180 + chaos().NextFloat$2(-10, 10));
      for (const sub of subs) sub.showOrHide(vw / 260, 0.5);
      const t = new $.WebTween();
      t.TweenProperty(o, 'position:y', o.Position.Y + vh, 0.75).SetEase(0).SetDelay(0.75).SetTrans(5);
      await finished(t);
      for (const sub of subs) sub.showOrHide(0, 0.25);
      await delay(2);
      clip?.destroy();
    } finally {
      n.QueueFree();
      tcs.TrySetResult();
      if (c) { r?.removing?.delete(c); r?.removingNodes?.delete(c); }
    }
  });
  (n as any).VfxTask = tcs.Task;
  n.GlobalPosition = v2(hb.x + (hb.w * scaling) / 2, hb.y + hb.h * scaling);
  n.Scale = v2(scaling, scaling);
  return n;
};
