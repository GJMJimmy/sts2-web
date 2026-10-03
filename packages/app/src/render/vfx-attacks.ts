// Attack and impact VFX: ports of the scripted combat effects the rule layer creates (NScratchVfx, NBigSlashVfx, the
// magic missiles, dagger spray, …) and of the scene-root scripts VfxCmd paths play (NHeavyBluntVfx, NStarryImpactVfx,
// NScreamVfx, …, registered in cardfx.scriptedVfx). A Create returns a web node; AddChildSafely into CombatVfxContainer
// (or BackCombatVfxContainer: behind the creatures) is its _Ready, which builds the converted scene and runs the script.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Container, Graphics, Matrix, Texture } from 'pixi.js';
import { G, $, N } from '../game';
import { ContainerNode, targetManager } from '../cardnodes';
import { combatVfxRoot, scriptedVfx, curveAt } from './cardfx';
import { buildScene, loadScene, particleItem, sceneTexture, selectionReticle, type SceneData, type Reticle } from './scene';
import { activeStage } from './stage';
import { QuadBatch, plainShader, loadShader } from './canvas';
import { shakeOffset } from '../ui/screenshake';
import { setTips, setTip, hoverTipsOf } from '../ui/tooltip';
import { corners } from '../view';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const safe = <T,>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
const room = () => N('Rooms.NCombatRoom').Instance;
const cnode = (c: any) => safe(() => room()?.GetCreatureNode(c) ?? null, null);
const isCreature = (a: any) => !!a && typeof a === 'object' && 'CurrentHp' in a;
const v2 = (x: number, y: number) => new $.Vector2(x, y);
const rgba = (c: any) => [c?.R ?? 1, c?.G ?? 1, c?.B ?? 1, c?.A ?? 1];
const html = (h: string) => [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1));
const mul = (a: number[], b: number[]) => a.map((v, i) => v * (b[i] ?? 1));
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
const hex = (c: number[]) => (byte(c[0]) << 16) | (byte(c[1]) << 8) | byte(c[2]);
/** NGame.ScreenShake(ShakeStrength.<s>, ShakeDuration.<d>). */
const shake = (s: string, d: string) => safe(() => N('NGame').Instance?.ScreenShake?.(G.ShakeStrength[s], G.ShakeDuration[d]), null);
/** Cmd.Wait: none under FastMode Instant, in non-interactive mode or while the combat ends (as in the original). */
const cmdWait = (s: number): Promise<void> => Promise.resolve(G.Cmd.Wait$2(s, false));
/** Process-frame time (NHeavyBluntVfx.WaitForSeconds) — not skipped by fast mode. */
const frames = (s: number) => new Promise<void>((r) => { let t = 0; $.onFrame((dt: number) => { t += dt; if (t < s) return true; r(); return false; }); });
/** Task.Delay (real time). */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const finished = (t: any) => new Promise<void>((r) => t.whenFinished(r));
const tween = () => new $.WebTween();
/** Godot Node2D transform: position, rotation, scale, skew. */
const xf = (x: number, y: number, rot = 0, sx = 1, sy = 1, skew = 0) =>
  new Matrix(Math.cos(rot) * sx, Math.sin(rot) * sx, -Math.sin(rot + skew) * sy, Math.cos(rot + skew) * sy, x, y);
const M = (m: number[]) => new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);

// ------------------------------------------------------------------ layers and nodes
/** BackCombatVfxContainer (in CombatSceneContainer: behind the creatures, scaled by the camera, shaken with the scene). */
Object.defineProperty(N('Rooms.NCombatRoom').prototype, 'BackCombatVfxContainer', {
  configurable: true,
  get() { return (this.$backVfx ??= new ContainerNode(0, 0, 'back')); },
  set(v: any) { this.$backVfx = v; },
});
/** Its Pixi layer on the combat stage, right above the background (the creatures are added after it). */
const backLayers = new WeakMap<object, Container>();
function backLayer(): Container | null {
  const st: any = activeStage;
  if (!st || st.root.destroyed) return null;
  let c = backLayers.get(st);
  if (!c || c.destroyed) backLayers.set(st, (c = new Container()));
  if (c.parent !== st.root) st.root.addChildAt(c, st.bg.parent === st.root ? st.root.getChildIndex(st.bg) + 1 : 0);
  return c;
}
/** Encounter.GetCameraScaling: the scale BackCombatVfxContainer's children get from CombatSceneContainer. */
const camScale = () => safe(() => room()?.combatState?.Encounter?.GetCameraScaling?.() || 1, 1);

/** The stage's top layer (over the creatures), kept last among the stage's children. */
const frontLayers = new WeakMap<object, Container>();
function frontLayer(st: any): Container {
  let c = frontLayers.get(st);
  if (!c || c.destroyed) frontLayers.set(st, (c = new Container()));
  if (st.root.children[st.root.children.length - 1] !== c) st.root.addChild(c);
  return c;
}
/**
 * Put item display `d` under `anchor`, unless it reads the screen (hint_screen_texture: the distortion rings of heavy
 * blunt, starry impact, the screams, the large missile, the hyperbeam) and `anchor` sits in CombatVfxContainer's overlay
 * canvas: Godot's screen copy there holds the background and the creatures, which the combat stage draws in its own
 * canvas, so it is drawn on the stage, over the creatures, following `anchor` every frame (global transform, alpha,
 * tint, visibility; the stage's shake taken out: CombatVfxContainer does not shake).
 * ponytail: the copy misses the creatures' DOM UI (HP bars, intents) and the overlay's VFX drawn before the item, which
 * Godot distorts too, and the item draws under the overlay's VFX rather than among them.
 */
export function screenAware(anchor: Container, d: Container, it: any) {
  if (!it?.shader?.screen) { anchor.addChild(d); return; }
  const proxy = new Container();
  proxy.addChild(d);
  $.onFrame(() => {
    if (anchor.destroyed || d.destroyed) { if (!proxy.destroyed) { proxy.parent?.removeChild(proxy); proxy.destroy({ children: true }); } return false; }
    const overlay = combatVfxRoot(), st: any = activeStage;
    let p: Container | null = anchor, shown = true;
    for (; p && p !== overlay; p = p.parent) shown &&= p.visible && p.renderable;
    if (!p || !st || st.root.destroyed) { if (proxy.parent !== anchor) { anchor.addChild(proxy); proxy.setFromMatrix(new Matrix()); proxy.visible = true; proxy.alpha = 1; proxy.tint = 0xffffff; } return true; }
    const layer = frontLayer(st);
    if (proxy.parent !== layer) layer.addChild(proxy);
    const g = anchor.getGlobalTransform(new Matrix(), false);
    proxy.setFromMatrix(new Matrix(g.a, g.b, g.c, g.d, g.tx - shakeOffset.x, g.ty - shakeOffset.y));
    proxy.visible = shown;
    proxy.alpha = anchor.getGlobalAlpha(false);
    proxy.tint = anchor.getGlobalTint(false);
    return true;
  });
}

/**
 * NCombatRoom.RadialBlur → NRadialBlurVfx.Activate (combat_room.tscn's RadialBlur: a full-viewport BackBufferCopy over
 * CombatVfxContainer, its ColorRect drawn with radial_blur.gdshader, 12 samples): unless it is showing, blur_center.x =
 * 0.3 / 0.6 / 0.45 (Left / Right / else; y stays 0.5), blur_power tweens to 0.005 over 0.1 s, then to 0 over 0.9 s
 * (Cubic In), and it hides. The material keeps blur_power between runs (0.005 in the scene, 0 after the first).
 * It is drawn over the stage's creatures (what its screen copy holds), held still against the stage's shake.
 * ponytail: the creatures' DOM UI and the VFX overlay stay sharp over it (see screenAware).
 */
const radialBlur = { Power: 0.005, on: false };
const VfxPosition = N('Vfx.VfxPosition');
N('Rooms.NCombatRoom').prototype.RadialBlur = function (pos = VfxPosition.Center) {
  const st: any = activeStage;
  if (G.TestMode.IsOn || radialBlur.on || !st || st.root.destroyed) return;
  radialBlur.on = true;
  const cx = pos === VfxPosition.Left ? 0.3 : pos === VfxPosition.Right ? 0.6 : 0.45;
  const t = tween().SetParallel();
  t.TweenProperty(radialBlur, 'power', 0.005, 0.1);
  t.Chain();
  t.TweenProperty(radialBlur, 'power', 0, 0.9).SetEase(0).SetTrans(7);
  void loadShader('shaders/radial_blur.gdshader').then((sh) => {
    if (!sh || st.root.destroyed) return;
    const q = new QuadBatch(1, sh, Texture.WHITE, { blur_center: [cx, 0.5], blur_power: radialBlur.Power, sampling_count: 12 });
    q.fresh = true; // a BackBufferCopy (COPY_MODE_VIEWPORT)
    q.quad(0, corners(), 0, 0, 1, 1, 1, 1, 1, 1);
    q.flush();
    const holder = new Container();
    holder.addChild(q);
    $.onFrame(() => {
      if (st.root.destroyed || !t.IsValid()) { holder.destroy({ children: true }); return false; }
      const layer = frontLayer(st);
      if (holder.parent !== layer) layer.addChild(holder);
      holder.position.set(-shakeOffset.x, -shakeOffset.y);
      q.group.uniforms.blur_power = radialBlur.Power;
      q.group.update();
      return true;
    });
  });
  t.whenFinished(() => { radialBlur.on = false; });
};

/**
 * The node a Create returns: a web node, so GodotTreeExtensions.AddChildSafely puts it in the web tree; entering it
 * runs `ready` (_Ready) once, in the Pixi layer of the container it went into. QueueFree takes its display with it.
 */
class AtkNode extends ContainerNode {
  private started = false;
  constructor(private ready: (n: AtkNode, layer: Container, back: boolean) => void | Promise<void>) { super(); }
  IsInsideTree() { return !this.$freed && !!this.$parent; }
  $entered() {
    if (this.started) return;
    this.started = true;
    const back = this.$parent?.label === 'back';
    const layer = back ? backLayer() : combatVfxRoot();
    if (!layer) return;
    Promise.resolve(this.ready(this, layer, back)).catch((e) => console.warn('[vfx]', e));
  }
}

/**
 * A converted VFX scene drawn in a layer: one wrapper per item in the converter's draw order (z_index, then tree
 * order). Scripts move nodes (`place`: a node's new root-local transform; items under it follow), recolour items
 * before they are built, restart / stop emitters and fade subtrees.
 */
class Fx {
  root = new Container();
  private freed = false;
  /** Freed, or its layer went away with the stage / overlay. */
  get dead() { return this.freed || this.root.destroyed; }
  private wraps: { it: any; w: Container; d: Container | null }[] = [];
  private over = new Map<string, Matrix>();
  private patch = new Map<string, any>();
  constructor(public s: SceneData, layer: Container, public m: Matrix) {
    this.root.setFromMatrix(m);
    layer.addChild(this.root);
    for (const it of s.items) {
      if (it.clipOnly) continue;
      const w = new Container();
      this.root.addChild(w);
      this.wraps.push({ it, w, d: null });
    }
  }
  get ex(): Record<string, any> { return this.s.exports ?? {}; }
  node(p: string) { return M(this.s.nodes[p] ?? [1, 0, 0, 1, 0, 0]); }
  private under(it: any, p: string) { return it.p === p || it.p.startsWith(p + '/'); }
  private item(e: { it: any }) { const p = this.patch.get(e.it.p); return p ? { ...e.it, ...p } : e.it; }
  /** Node2D.Transform of node `p`, root-local. */
  place(p: string, m: Matrix) {
    this.over.set(p, m);
    for (const e of this.wraps) {
      let best = '';
      for (const k of this.over.keys()) if (this.under(e.it, k) && k.length > best.length) best = k;
      if (best) e.w.setFromMatrix(this.over.get(best)!.clone().append(this.node(best).invert()));
    }
  }
  /** Node2D.GlobalPosition = (x, y), keeping the node's rotation and scale. */
  setGlobal(p: string, x: number, y: number) {
    const n = this.over.get(p) ?? this.node(p), l = this.m.clone().invert().apply({ x, y });
    this.place(p, new Matrix(n.a, n.b, n.c, n.d, l.x, l.y));
  }
  /** Node2D.Rotation / Scale of node `p` (scene position kept). */
  setRotScale(p: string, rot: number | null, sx?: number, sy?: number) {
    const n = this.node(p), det = n.a * n.d - n.b * n.c;
    const r = rot ?? Math.atan2(n.b, n.a), ox = Math.hypot(n.a, n.b), oy = Math.hypot(n.c, n.d) * Math.sign(det || 1);
    this.place(p, xf(n.tx, n.ty, r, sx ?? ox, sy ?? oy));
  }
  set(paths: string[] | string | undefined, f: (it: any) => any) {
    for (const p of [paths ?? []].flat()) for (const e of this.wraps) if (e.it.p === p) this.patch.set(p, { ...this.patch.get(p), ...f(this.item(e)) });
  }
  /** CanvasItem.SelfModulate (the converter's colour = modulate × self_modulate). */
  selfModulate(paths: string[] | string | undefined, c: number[]) { this.set(paths, (it) => ({ color: mul(it.mod ?? it.color ?? [1, 1, 1, 1], c) })); }
  /** ParticleProcessMaterial.Color. */
  processColor(paths: string[] | undefined, c: number[]) { this.set(paths, () => ({ tint: c })); }
  /** The scene root's Modulate replaced (the converter bakes the root's into every item). */
  rootModulate(c: number[]) {
    const r = this.s.root as any, m = r.mod ?? [1, 1, 1, 1];
    for (const e of this.wraps) this.patch.set(e.it.p, { ...this.patch.get(e.it.p), color: mul((this.item(e).color ?? [1, 1, 1, 1]).map((v: number, k: number) => (m[k] ? v / m[k] : v)), c) });
  }
  /** Draw the static items and start the emitters the scene has emitting; `onSpine` gets each skeleton by path. */
  start(onSpine?: (p: string, sp: any) => void) {
    for (const e of this.wraps) {
      if (e.it.k === 'particles') { if (e.it.emitting) this.restartOne(e); continue; }
      e.d = buildScene({ ...this.s, items: [this.item(e)] }, undefined, onSpine && ((sp: any) => onSpine(e.it.p, sp)));
      screenAware(e.w, e.d, e.it);
    }
  }
  private restartOne(e: { it: any; w: Container; d: Container | null }) {
    e.d?.destroy({ children: true });
    e.d = particleItem(this.item(e), true);
    screenAware(e.w, e.d, e.it);
  }
  /** GPUParticles2D.Restart. */
  restart(paths: string[] | undefined) { for (const e of this.wraps) if (e.it.k === 'particles' && paths?.includes(e.it.p)) this.restartOne(e); }
  /** GPUParticles2D.Emitting = false: live particles finish, none respawn. */
  stop(paths: string[] | undefined) { for (const e of this.wraps) if (paths?.includes(e.it.p)) { const em = (e.d as any)?.emitter; if (em) em.emitting = false; } }
  /** A subtree's Visible / Modulate (tint and alpha on its items' wrappers). */
  visible(p: string, on: boolean) { for (const e of this.wraps) if (this.under(e.it, p)) e.w.visible = on; }
  modulate(p: string, c: number[]) { for (const e of this.wraps) if (this.under(e.it, p)) { e.w.tint = hex(c); e.w.alpha = c[3]; } }
  wrapOf(p: string) { return this.wraps.find((e) => e.it.p === p)?.w ?? null; }
  /** Cmd.Wait; false once the node is gone (its cancellation token). */
  async wait(s: number) { await cmdWait(s); return !this.dead; }
  free() { if (this.dead) { this.freed = true; return; } this.freed = true; this.root.destroy({ children: true }); }
}

/** Build `path` (vfx/…) in `layer` at root transform `m(scene)`; tied to node `n` (freed with it) when given. */
async function fxOf(path: string, layer: Container, m: (s: SceneData) => Matrix, n?: AtkNode | null): Promise<Fx | null> {
  const s = await loadScene(`scenes/${path}.tscn`);
  if (!s || layer.destroyed || n?.$freed) { n?.QueueFree(); return null; }
  const fx = new Fx(s, layer, m(s));
  n?.$onExit.push(() => fx.free());
  return fx;
}
/** The root at a global position, with the scene root's rotation / scale unless the script sets them. */
const at = (x: number, y: number, o: { rot?: number; sx?: number; sy?: number } = {}) => (s: SceneData) =>
  xf(x, y, o.rot ?? s.root.rot, o.sx ?? s.root.scale[0], o.sy ?? s.root.scale[1]);

/**
 * The common shape: Create builds the node at a position; _Ready sets the scene up and runs PlaySequence; the node
 * frees itself (QueueFreeSafely) when the sequence ends.
 */
function scripted(path: string, m: (s: SceneData) => Matrix, setup: ((fx: Fx) => void) | null, seq: (fx: Fx, n: AtkNode | null) => Promise<unknown>) {
  const run = async (n: AtkNode | null, layer: Container) => {
    const fx = await fxOf(path, layer, m, n);
    if (!fx) return;
    try {
      setup?.(fx);
      fx.start();
      await seq(fx, n);
    } finally {
      if (n) n.QueueFree();
      else fx.free();
    }
  };
  return { node: () => new AtkNode((n, layer) => run(n, layer)), play: (layer: Container) => void run(null, layer).catch((e) => console.warn('[vfx]', e)) };
}
/** Register a scene-root script for VfxCmd.PlayVfx (root at the position, scene rotation / scale kept). */
function viaVfxCmd(path: string, make: (x: number, y: number) => { play: (layer: Container) => void }) {
  scriptedVfx.set(path, (root, x, y) => make(x, y).play(root));
}
const centerOf = (a: any) => (isCreature(a) ? cnode(a)?.VfxSpawnPosition ?? null : a);

// ------------------------------------------------------------------ slashes
/**
 * NScratchVfx (vfx_scratch_impact) at the target's centre, mirrored (Scale.x −1) when going right: the scratch
 * flipbook, 0.1 s later the flare / specks / side smoke and ScreenShake(VeryWeak, Short); freed after 2 s more.
 */
const NScratchVfx = N('Vfx.NScratchVfx');
NScratchVfx.Create = (a: any, goingRight: boolean) => {
  if (G.TestMode.IsOn) return null;
  const p = centerOf(a);
  if (!p) return null;
  return scripted('vfx/vfx_scratch_impact', at(p.X, p.Y, { sx: goingRight ? -1 : 1, sy: 1 }), null, async (fx) => {
    fx.restart(fx.ex._anticipationParticles);
    if (!(await fx.wait(0.1))) return;
    fx.restart(fx.ex._impactParticles);
    shake('VeryWeak', 'Short');
    await fx.wait(2);
  }).node();
};

/** NBigSlashVfx (vfx_big_slash): the slash core, self-modulated by the tint, facing left unless facingRight; 1 s. */
const NBigSlashVfx = N('Vfx.NBigSlashVfx');
NBigSlashVfx.Create = (a: any, facingRight?: boolean, tint?: any) => {
  if (G.TestMode.IsOn) return null;
  if (isCreature(a)) { const n = cnode(a); return n ? NBigSlashVfx.Create(n.VfxSpawnPosition, !!a.IsEnemy, new $.Color('50b598')) : null; }
  if (!a) return null;
  const c = tint ? rgba(tint) : html('a380ff');
  return scripted('vfx/vfx_big_slash', at(a.X, a.Y, { sx: facingRight ? 1 : -1, sy: 1 }), (fx) => fx.selfModulate(fx.ex._modulateParticles, c), async (fx) => {
    fx.restart(fx.ex._slashParticles);
    await fx.wait(1);
  }).node();
};

/**
 * NBigSlashImpactVfx (vfx_big_slash_impact): the core pivot turned to `rotationDegrees` (60 by default), tinted
 * (#80dbff); the core, then 0.1 s later ScreenShake(Strong, Short) and the smoke / specks / flare; freed after 2 s.
 */
const NBigSlashImpactVfx = N('Vfx.NBigSlashImpactVfx');
NBigSlashImpactVfx.Create = (a: any, deg = 60, tint?: any) => {
  if (G.TestMode.IsOn) return null;
  const p = centerOf(a);
  if (!p) return null;
  const c = tint ? rgba(tint) : html('80dbff');
  return scripted('vfx/vfx_big_slash_impact', at(p.X, p.Y), (fx) => {
    if (fx.ex._corePivot) fx.setRotScale(fx.ex._corePivot, (deg * Math.PI) / 180);
    fx.selfModulate(fx.ex._modulateParticles, c);
  }, async (fx) => {
    fx.restart(fx.ex._anticipationParticles);
    if (!(await fx.wait(0.1))) return;
    shake('Strong', 'Short');
    fx.restart(fx.ex._impactParticles);
    await fx.wait(2);
  }).node();
};

/**
 * NThinSliceVfx (thin_slice_vfx): Slash (one 8000 px/s streak) 400–500 px from the target's centre (± 50 px) at a
 * random angle, aimed at it; the Sparkle ring at the centre. SetColor writes the shared ParticleProcessMaterial, so
 * Green / Blue / Purple / Black keep the colour the last slice used; freed after 1 s (Task.Delay).
 */
let thinSliceTint: number[] | null = null;
const NThinSliceVfx = N('Vfx.NThinSliceVfx');
NThinSliceVfx.Create = (target: any, color = 6) => {
  if (G.TestMode.IsOn) return null;
  const p = cnode(target)?.VfxSpawnPosition;
  if (!p) return null;
  const cx = p.X + rand(-50, 50), cy = p.Y + rand(-50, 50);
  return new AtkNode(async (n, layer) => {
    const fx = await fxOf('vfx/thin_slice_vfx', layer, () => new Matrix(), n);
    if (!fx) return;
    const s = rand(0, Math.PI * 2), r = rand(400, 500), sx = cx + r * Math.cos(s), sy = cy + r * Math.sin(s);
    const rot = Math.atan2(cy - sy, cx - sx);
    fx.place('Slash', xf(sx, sy, rot));
    fx.place('Slash/Sparkle', xf(cx, cy, rot));
    thinSliceTint ??= fx.s.items.find((it) => it.p === 'Slash')?.tint ?? [1, 1, 1, 1];
    const set = ({ 0: html('FF9900'), 5: [1, 1, 1, 1], 6: html('C4FFE6') } as Record<number, number[]>)[color];
    if (set) thinSliceTint = set;
    const t = thinSliceTint;
    fx.set('Slash', () => ({ tint: t }));
    fx.restart(['Slash', 'Slash/Sparkle']);
    if (color === 7) return; // SetColor's default case throws: SelfDestruct never starts (no caller passes Gold)
    await delay(1000);
    n.QueueFree();
  });
};

/**
 * NStabVfx (stab_vfx): Primary (motion line, additive) 200 px beside the target's jittered centre, aimed at it,
 * springs onto it (0.5 s Elastic Out) while the whole fades out from 0.25 s (0.25 s); VfxColor picks the Primary /
 * Secondary self-modulates.
 */
const STAB: Record<number, string[]> = { 1: ['00A52F', 'FFCB2D'], 2: ['007BDD', '00EFF6'], 3: ['A803FF', '00EFF3'], 5: ['808080', 'FFFFFF'], 6: ['009599', '5CDCFF'], 7: ['EBA800', 'FFE39C'], 0: ['FF0000', 'FFCB2D'] };
const NStabVfx = N('Vfx.NStabVfx');
NStabVfx.Create = (target: any, facingEnemies = false, color = 0) => {
  if (G.TestMode.IsOn) return null;
  const p = cnode(target)?.VfxSpawnPosition;
  if (!p) return null;
  const cx = p.X + (facingEnemies ? rand(0, 48) : rand(-48, 0)), cy = p.Y + rand(-50, 50);
  return new AtkNode(async (n, layer) => {
    const fx = await fxOf('vfx/stab_vfx', layer, () => new Matrix(), n);
    if (!fx) return;
    const px = cx + rand(-12, 12) + (facingEnemies ? -200 : 200), py = cy + rand(-64, 64);
    const rot = Math.atan2(py - cy, px - cx) + Math.PI / 2;
    const c = STAB[color];
    if (c) { fx.selfModulate('Primary', html(c[0])); fx.selfModulate('Primary/Secondary', html(c[1])); }
    fx.start();
    const st = { Modulate: { A: 1 }, Position: v2(px, py) };
    const apply = () => { fx.place('Primary', xf(st.Position.X, st.Position.Y, rot, 2, 2)); fx.root.alpha = st.Modulate.A; };
    apply();
    $.onFrame(() => { if (fx.dead) return false; apply(); return true; });
    const t = tween().SetParallel();
    t.TweenProperty(st, 'modulate:a', 1, 0.25);
    t.TweenProperty(st, 'position', v2(cx, cy), 0.5).SetEase(1).SetTrans(6);
    t.TweenProperty(st, 'modulate:a', 0, 0.25).SetDelay(0.25);
    n.$onExit.push(() => t.Kill());
    await finished(t);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ daggers
/** NDaggerSprayFlurryVfx (vfx_dagger_spray_flurry) at the creature, mirrored unless going right; daggers tinted. */
const NDaggerSprayFlurryVfx = N('Vfx.NDaggerSprayFlurryVfx');
NDaggerSprayFlurryVfx.Create = (a: any, tint: any, goingRight: boolean) => {
  if (G.TestMode.IsOn) return null;
  const p = centerOf(a);
  if (!p) return null;
  return scripted('vfx/vfx_dagger_spray_flurry', at(p.X, p.Y, { sx: goingRight ? 1 : -1, sy: 1 }), (fx) => fx.processColor(fx.ex._modulateParticles, rgba(tint)), async (fx) => {
    fx.restart(fx.ex._particles);
    await fx.wait(2);
  }).node();
};
/** NDaggerSprayImpactVfx (vfx_dagger_spray_impact): after _impactDelay (0.1 s) ScreenShake(Weak, Short) + the impact. */
const NDaggerSprayImpactVfx = N('Vfx.NDaggerSprayImpactVfx');
NDaggerSprayImpactVfx.Create = (a: any, tint: any, goingRight: boolean) => {
  if (G.TestMode.IsOn) return null;
  const p = centerOf(a);
  if (!p) return null;
  return scripted('vfx/vfx_dagger_spray_impact', at(p.X, p.Y, { sx: goingRight ? 1 : -1, sy: 1 }), (fx) => fx.selfModulate(fx.ex._modulateParticles, rgba(tint)), async (fx) => {
    if (!(await fx.wait(fx.ex._impactDelay ?? 0.1))) return;
    shake('Weak', 'Short');
    fx.restart(fx.ex._particles);
    await fx.wait(2);
  }).node();
};
/**
 * NShivThrowVfx (vfx_shiv_throw) at the target's centre, turned along thrower → target: the thrown dagger and
 * specks, 0.15 s later the impact and ScreenShake(Weak, Short); freed after 2 s.
 */
const NShivThrowVfx = N('Vfx.NShivThrowVfx');
NShivThrowVfx.Create = (a: any, b: any, tint: any) => {
  if (G.TestMode.IsOn) return null;
  const from = centerOf(a), to = centerOf(b);
  if (!from || !to) return null;
  return scripted('vfx/vfx_shiv_throw', at(to.X, to.Y, { rot: Math.atan2(to.Y - from.Y, to.X - from.X) }), (fx) => fx.processColor(fx.ex._modulateParticles, rgba(tint)), async (fx) => {
    fx.restart(fx.ex._throwParticles);
    if (!(await fx.wait(0.15))) return;
    fx.restart(fx.ex._impactParticles);
    shake('Weak', 'Short');
    await fx.wait(2);
  }).node();
};

/**
 * NFanOfKnivesVfx (fan_of_knives_vfx) in BackCombatVfxContainer: nine shivs (and their shadows) at the creature's
 * centre rise 180 px (Back Out, 0.4–0.8 s each) while fading in; 0.4 s in, all but the middle one fan out to ±25°,
 * ±50°, ±75°, ±100° (0.8 s Back Out); each fades out (0.4 s, after 0.25–0.5 s); freed when the rise / fade ends.
 */
const FAN = [-1.74533, -1.3089975, -0.872665, -0.4363325, 0, 0.4363325, 0.872665, 1.3089975, 1.74533];
const NFanOfKnivesVfx = N('Vfx.Cards.NFanOfKnivesVfx');
NFanOfKnivesVfx.Create = (target: any) => {
  if (G.TestMode.IsOn) return null;
  const p = cnode(target)?.VfxSpawnPosition;
  return new AtkNode(async (n, layer, back) => {
    const fx = await fxOf('vfx/fan_of_knives_vfx', layer, () => new Matrix(), n);
    if (!fx || !p) return;
    const sc = back ? camScale() : 1;
    const shivs = FAN.map((_, i) => ({ path: `ShivFanParticle${i + 1}`, s: rand(0.98, 1.02) * sc, Rotation: 0, Offset: { Y: 0 }, Modulate: new $.Color(0, 0, 0, 0), shadow: { Offset: { Y: 0 } } }));
    const apply = () => {
      for (const sh of shivs) {
        const m = xf(p.X, p.Y, sh.Rotation, sh.s, sh.s);
        fx.place(sh.path, m.clone().append(xf(0, sh.Offset.Y + 200)));
        fx.place(`${sh.path}/Shadow`, m.clone().append(xf(10, 10 + sh.shadow.Offset.Y + 200)));
        fx.modulate(sh.path, rgba(sh.Modulate));
      }
    };
    apply();
    fx.start();
    $.onFrame(() => { if (fx.dead) return false; apply(); return true; });
    safe(() => G.SfxCmd.Play$2('event:/sfx/characters/silent/silent_fan_of_knives', 1), null);
    const spawn = tween().SetParallel();
    for (const sh of shivs) {
      const d = rand(0.4, 0.8);
      spawn.TweenProperty(sh, 'offset:y', -180, d).From(0).SetEase(1).SetTrans(10);
      spawn.TweenProperty(sh, 'modulate', new $.Color(1, 1, 1, 1), d).From(new $.Color(0, 0, 0, 0));
      spawn.TweenProperty(sh.shadow, 'offset:y', -180, d).From(0).SetEase(1).SetTrans(10);
    }
    spawn.Chain();
    for (const sh of shivs) spawn.TweenProperty(sh, 'modulate', new $.Color(1, 1, 1, 0), 0.4).SetDelay(rand(0.25, 0.5));
    const fan = tween().SetParallel();
    fan.TweenInterval(0.4);
    fan.Chain();
    shivs.forEach((sh, i) => { if (i !== 4) fan.TweenProperty(sh, 'rotation', FAN[i], 0.8).SetEase(1).SetTrans(10); });
    n.$onExit.push(() => { spawn.Kill(); fan.Kill(); });
    await finished(spawn);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ magic missiles
/**
 * NLargeMagicMissileVfx / NSmallMagicMissileVfx: the anticipation (sky flare / ray / ring) where the line through
 * the target at −30° from vertical meets y = 80; after 0.2 s the missile flies from there (+ offset along the line)
 * to the target (+ offset) in WaitTime (0.2 s), then hides; the impact and ScreenShake (Strong/Normal, Medium/Short);
 * freed after 2 s. The caller waits WaitTime before dealing the damage.
 */
function missile(T: any, path: string, strength: string, duration: string) {
  T.Create = (pos: any, tint: any) => {
    if (G.TestMode.IsOn || !pos) return null;
    const tx = pos.X, ty = pos.Y, c = rgba(tint);
    const dx = 0.5, dy = Math.sqrt(3) / 2; // Quaternion.FromEuler(0, 0, −30°) · Vector3.Up
    const k = (80 - ty) / dy, topX = tx + dx * k, topY = 80; // Geometry2D.LineIntersectsLine with y = 80
    const waitTime = 0.2, anticipation = 0.2; // WaitTime / _anticipationDuration: field defaults, not set in the scenes
    let start = [0, 0], end = [0, 0];
    const n: any = scripted(path, at(tx, ty), (fx) => {
      const ex = fx.ex, off = ex._projectileOffset ?? 100;
      fx.setGlobal(ex._anticipationContainer, topX, topY);
      fx.selfModulate(ex._modulateParticles, c);
      fx.visible(ex._projectileContainer, false);
      start = [topX + dx * off, topY + dy * off];
      end = [tx + dx * off, ty + dy * off];
    }, async (fx) => {
      const ex = fx.ex;
      fx.restart(ex._anticipationParticles);
      if (!(await fx.wait(anticipation))) return;
      fx.restart(ex._projectileStartParticles);
      fx.setGlobal(ex._projectileContainer, start[0], start[1]);
      fx.visible(ex._projectileContainer, true);
      fx.restart(ex._projectileParticles);
      await new Promise<void>((r) => {
        let t = 0;
        const move = () => { const w = t / waitTime; fx.setGlobal(ex._projectileContainer, start[0] + (end[0] - start[0]) * w, start[1] + (end[1] - start[1]) * w); };
        move();
        $.onFrame((dt: number) => { t += dt; if (fx.dead || t >= waitTime) { r(); return false; } move(); return true; });
      });
      if (fx.dead) return;
      fx.visible(ex._projectileContainer, false);
      fx.restart(ex._impactParticles);
      shake(strength, duration);
      await fx.wait(2);
    }).node();
    n.WaitTime = waitTime;
    return n;
  };
}
missile(N('Vfx.NLargeMagicMissileVfx'), 'vfx/vfx_large_magic_missile', 'Strong', 'Normal');
missile(N('Vfx.NSmallMagicMissileVfx'), 'vfx/vfx_small_magic_missile', 'Medium', 'Short');

// ------------------------------------------------------------------ impacts
/** NGaseousImpactVfx (vfx_gaseous_impact) at a side's centre, a creature's centre or a point; Modulate = tint; 2 s. */
const NGaseousImpactVfx = N('Vfx.NGaseousImpactVfx');
NGaseousImpactVfx.Create = (a: any, b: any, c?: any) => {
  if (G.TestMode.IsOn) return null;
  const [p, tint] = typeof a === 'number' ? [G.VfxCmd.GetSideCenter(a, b), c] : [centerOf(a), b];
  if (!p) return null;
  return scripted('vfx/vfx_gaseous_impact', at(p.X, p.Y), (fx) => fx.rootModulate(rgba(tint)), async (fx) => {
    fx.restart(fx.ex._impactParticles);
    await fx.wait(2);
  }).node();
};
/** NWormyImpactVfx (vfx_wormy_impact): the ground pivot at the hitbox bottom, the centre pivot at the centre; 2 s. */
const NWormyImpactVfx = N('Vfx.NWormyImpactVfx');
NWormyImpactVfx.Create = (a: any, center?: any) => {
  if (G.TestMode.IsOn) return null;
  let g = a, c = center;
  if (isCreature(a)) { const n = cnode(a); if (!n) return null; g = n.GetBottomOfHitbox(); c = n.VfxSpawnPosition; }
  return scripted('vfx/vfx_wormy_impact', at(g.X, g.Y), (fx) => { fx.setGlobal(fx.ex._groundPivot, g.X, g.Y); fx.setGlobal(fx.ex._centerPivot, c.X, c.Y); }, async (fx) => {
    fx.restart(fx.ex._particles);
    await fx.wait(2);
  }).node();
};
/** NSporeImpactVfx (vfx_spore_impact) at the hitbox bottom: the poof scaled by _scaleRange, Modulate = tint; 3.5 s. */
const NSporeImpactVfx = N('Vfx.NSporeImpactVfx');
NSporeImpactVfx.Create = (a: any, tint: any) => {
  if (G.TestMode.IsOn) return null;
  const p = isCreature(a) ? cnode(a)?.GetBottomOfHitbox() : a;
  if (!p) return null;
  return scripted('vfx/vfx_spore_impact', at(p.X, p.Y), (fx) => {
    const r = fx.ex._scaleRange ?? [0, 0], k = rand(r[0], r[1]);
    if (fx.ex._poofPivot) fx.setRotScale(fx.ex._poofPivot, null, k, k);
    fx.rootModulate(rgba(tint));
  }, async (fx) => {
    fx.restart(fx.ex._impactParticles);
    await fx.wait(3.5);
  }).node();
};
/** NPoisonImpactVfx (vfx_poison_impact) at the centre, its horizontal smoke mirrored at random; 2 s. */
const NPoisonImpactVfx = N('Vfx.NPoisonImpactVfx');
NPoisonImpactVfx.Create = (a: any) => {
  if (G.TestMode.IsOn) return null;
  const p = centerOf(a);
  if (!p) return null;
  const flip = Math.random() > 0.5 ? 1 : -1;
  return scripted('vfx/vfx_poison_impact', at(p.X, p.Y), (fx) => { if (fx.ex._horizontalSmokeContainer) fx.setRotScale(fx.ex._horizontalSmokeContainer, null, flip, 1); }, async (fx) => {
    fx.restart(fx.ex._impactParticles);
    await fx.wait(2);
  }).node();
};
/** NGoopyImpactVfx (vfx_goopy_impact) at the centre, Modulate = tint (Colors.Green for a creature); 3.5 s. */
const NGoopyImpactVfx = N('Vfx.NGoopyImpactVfx');
NGoopyImpactVfx.Create = (a: any, tint?: any) => {
  if (G.TestMode.IsOn) return null;
  const p = centerOf(a);
  if (!p) return null;
  const c = isCreature(a) ? [0, 1, 0, 1] : rgba(tint);
  return scripted('vfx/vfx_goopy_impact', at(p.X, p.Y), (fx) => fx.rootModulate(c), async (fx) => {
    fx.restart(fx.ex._impactParticles);
    await fx.wait(3.5);
  }).node();
};

// ------------------------------------------------------------------ scene-root scripts (VfxCmd paths)
/** NHeavyBluntVfx (vfx_heavy_blunt): anticipation; 0.2 s (process frames) later ScreenShake(Strong, Short) + impact; 2 s. */
const heavyBlunt = (x: number, y: number) => scripted('vfx/vfx_heavy_blunt', at(x, y), null, async (fx) => {
  fx.restart(fx.ex._anticipationParticles);
  await frames(0.2);
  if (fx.dead) return;
  shake('Strong', 'Short');
  fx.restart(fx.ex._impactParticles);
  await frames(2);
});
viaVfxCmd('vfx/vfx_heavy_blunt', heavyBlunt);
N('Vfx.NHeavyBluntVfx').Create = (pos: any) => (G.TestMode.IsOn ? null : heavyBlunt(pos.X, pos.Y).node());
/** NStarryImpactVfx (vfx_starry_impact): ScreenShake(Weak, Short) and every emitter restarted; 2 s. */
const starry = (x: number, y: number) => scripted('vfx/vfx_starry_impact', at(x, y), null, async (fx) => {
  shake('Weak', 'Short');
  fx.restart(fx.ex._particles);
  await fx.wait(2);
});
viaVfxCmd('vfx/vfx_starry_impact', starry);
N('Vfx.NStarryImpactVfx').Create = (pos: any) => (G.TestMode.IsOn ? null : starry(pos.X, pos.Y).node());
/**
 * NScreamVfx / NSpookyScreamVfx: one-shot emitters with Lifetime = _duration (1 s) restarted, the continuous ones
 * restarted and stopped after _duration; freed 2 s later. The plain scream also shakes (Medium, Normal).
 */
function scream(path: string, withShake: boolean) {
  const make = (x: number, y: number) => scripted(path, at(x, y), (fx) => fx.set(fx.ex._oneShotParticles, () => ({ life: fx.ex._duration ?? 1 })), async (fx) => {
    const d = fx.ex._duration ?? 1;
    if (withShake) shake('Medium', 'Normal');
    fx.restart(fx.ex._oneShotParticles);
    fx.restart(fx.ex._continuousParticles);
    if (!(await fx.wait(d))) return;
    fx.stop(fx.ex._continuousParticles);
    await fx.wait(2);
  });
  viaVfxCmd(path, make);
  return make;
}
const screamVfx = scream('vfx/vfx_scream', true), spookyVfx = scream('vfx/vfx_spooky_scream', false);
N('Vfx.NScreamVfx').Create = (pos: any) => (G.TestMode.IsOn ? null : screamVfx(pos.X, pos.Y).node());
N('Vfx.NSpookyScreamVfx').Create = (pos: any) => (G.TestMode.IsOn ? null : spookyVfx(pos.X, pos.Y).node());

/**
 * NHellraiserAttackVfx (hellraiser_attack_vfx, at the creature's feet): the sword (flipped at random) rises out of
 * ClippingRect's bottom edge (position.y 300 → 90, 0.5 s Expo Out) while the whole goes Red → White (0.3 s); after
 * 0.1 s it sinks back (→ 300, 0.5 s Expo In) and fades (0.3 s); then it frees itself.
 */
scriptedVfx.set('vfx/hellraiser_attack_vfx', (layer, x, y) => void (async () => {
  const fx = await fxOf('vfx/hellraiser_attack_vfx', layer, at(x, y));
  if (!fx) return;
  const it = fx.s.items.find((i) => i.p === 'ClippingRect/Sword');
  const rect = fx.s.nodes.ClippingRect ?? [1, 0, 0, 1, -150, -300], size = fx.s.sizes?.ClippingRect ?? [300, 300];
  if (it && Math.random() < 0.5) fx.set(it.p, () => ({ flipH: true }));
  fx.start();
  const w = fx.wrapOf('ClippingRect/Sword');
  if (w) { const mask = new Graphics().rect(rect[4], rect[5], size[0], size[1]).fill(0xffffff); fx.root.addChild(mask); w.mask = mask; } // clip_contents
  const sword = { Position: v2(0, 300) }, root = { Modulate: new $.Color(1, 0, 0, 1) }, baseX = it?.m?.[4] ?? 0;
  const apply = () => { fx.place('ClippingRect/Sword', xf(baseX, rect[5] + sword.Position.Y)); fx.root.tint = hex(rgba(root.Modulate)); fx.root.alpha = root.Modulate.A; };
  apply();
  $.onFrame(() => { if (fx.dead) return false; apply(); return true; });
  const t = tween().SetParallel();
  t.TweenProperty(sword, 'position:y', 90, 0.5).SetEase(1).SetTrans(5);
  t.TweenProperty(root, 'modulate', new $.Color(1, 1, 1, 1), 0.3).From(new $.Color(1, 0, 0, 1));
  t.Chain().TweenInterval(0.1);
  t.Chain();
  t.TweenProperty(sword, 'position:y', 300, 0.5).SetEase(0).SetTrans(5);
  t.TweenProperty(root, 'modulate:a', 0, 0.3);
  t.Chain().TweenCallback(() => fx.free());
})());

// ------------------------------------------------------------------ ground spikes
/**
 * NBgGroundSpikeVfx / NFgGroundSpikeVfx (bg_/fg_ground_spike_vfx: an additive spike Sprite2D): skewed 15–30°,
 * scaled, placed beside the point (40–160 px out; 10–96 px up behind, 10–32 px down in front), coloured by VfxColor
 * (α 0.5), drifting at 50–250 px/s ÷ its size; after 0.01–0.2 s its skew grows to 30–60° while it shrinks
 * (× 0.1–0.5) and fades (0.25–1 s Expo Out), then it frees itself.
 */
function groundSpike(T: any, path: string, fg: boolean) {
  T.Create = (pos: any, movingRight = true, color = 0) => {
    if (G.TestMode.IsOn) return null;
    return new AtkNode(async (n, layer, back) => {
      const sgn = movingRight ? 1 : -1;
      let mod: number[];
      switch (color) {
        case 0: mod = [1, rand(0.2, 0.8), rand(0, 0.2), 0.5]; break;
        case 3: mod = [rand(0, 0.2), rand(0.2, 0.8), 1, 0.5]; break;
        case 5: { const k = rand(0.2, 0.8); mod = [k, k, k, 0.5]; break; }
        case 6: { const k = rand(0.6, 1); mod = [0.2, k, k, 0.5]; break; }
        case 7: { const k = rand(0.6, 1); mod = [k, k, 0.2, 1]; break; }
        default: return; // Log.Error + ArgumentOutOfRangeException (no caller passes these)
      }
      const st = { Skew: sgn * rand(15, 30) * 0.0174533, Scale: v2(0, 0), Modulate: { A: mod[3] } };
      const k = rand(0.5, 1.5);
      st.Scale = v2(rand(0.8, 1.2) * k, rand(0.8, 2) * k);
      const px = pos.X + sgn * rand(40, 160), py = pos.Y + (fg ? rand(10, 32) : rand(-96, -10));
      const vx = (sgn * rand(50, 250)) / k, vy = rand(-5, 5) / k;
      const fx = await fxOf(path, layer, () => new Matrix(), n);
      if (!fx) return;
      fx.set('.', () => ({ color: [mod[0], mod[1], mod[2], 1] }));
      fx.start();
      const sc = back ? camScale() : 1;
      let x = px, y = py;
      const apply = () => { fx.root.setFromMatrix(xf(x, y, 0, st.Scale.X * sc, st.Scale.Y * sc, st.Skew)); fx.root.alpha = st.Modulate.A; };
      apply();
      $.onFrame((dt: number) => { if (fx.dead) return false; x += vx * dt; y += vy * dt; apply(); return true; });
      const d = rand(0.25, 1), t = tween().SetParallel();
      t.TweenInterval(rand(0.01, 0.2));
      t.Chain();
      t.TweenProperty(st, 'skew', sgn * rand(30, 60) * 0.0174533, d).SetEase(1).SetTrans(5);
      const shrink = rand(0.1, 0.5);
      t.TweenProperty(st, 'scale', v2(st.Scale.X * shrink, st.Scale.Y * shrink), d).SetEase(1).SetTrans(5);
      t.TweenProperty(st, 'modulate:a', 0, d).SetEase(1).SetTrans(5);
      n.$onExit.push(() => t.Kill());
      await finished(t);
      n.QueueFree();
    });
  };
}
groundSpike(N('Vfx.NBgGroundSpikeVfx'), 'vfx/bg_ground_spike_vfx', false);
groundSpike(N('Vfx.NFgGroundSpikeVfx'), 'vfx/fg_ground_spike_vfx', true);
/** NSpikeSplashVfx: six ground spikes each way in front (CombatVfxContainer) and behind (BackCombatVfxContainer). */
const NSpikeSplashVfx = N('Vfx.Cards.NSpikeSplashVfx');
NSpikeSplashVfx.Create = (target: any, color = 0) => {
  if (G.TestMode.IsOn) return null;
  const p = cnode(target)?.GetBottomOfHitbox();
  return new AtkNode(async (n) => {
    const r = room(), add = (c: any, v: any) => G.GodotTreeExtensions.AddChildSafely(c, v);
    for (let i = 0; i < 6; i++) {
      add(r.CombatVfxContainer, N('Vfx.NFgGroundSpikeVfx').Create(p, true, color));
      add(r.CombatVfxContainer, N('Vfx.NFgGroundSpikeVfx').Create(p, false, color));
    }
    for (let i = 0; i < 6; i++) {
      add(r.BackCombatVfxContainer, N('Vfx.NBgGroundSpikeVfx').Create(p, true, color));
      add(r.BackCombatVfxContainer, N('Vfx.NBgGroundSpikeVfx').Create(p, false, color));
    }
    await delay(2000);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ bolas
const TRAIL_CURVE = [[0, 0, 0, 0], [1e-5, 0, 0.578717, 0.578717], [1, 1, 0.646704, 0]];
/** Line2D (width × width_curve by distance, LINE_TEXTURE_STRETCH) through the points. ponytail: round joints drawn as plain segment joins. */
function drawBand(b: QuadBatch, pts: number[][], width: number, curve: number[][], col: number[]) {
  const n = pts.length, len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[n - 1] || 1;
  const normal = (i: number) => {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  for (let i = 0; i < b.n; i++) {
    if (i >= n - 1) { b.hide(i); continue; }
    const w0 = (width * curveAt(curve, len[i] / total)) / 2, w1 = (width * curveAt(curve, len[i + 1] / total)) / 2;
    const n0 = normal(i), n1 = normal(i + 1), a = pts[i], c = pts[i + 1];
    b.quad(i, [a[0] + n0[0] * w0, a[1] + n0[1] * w0, c[0] + n1[0] * w1, c[1] + n1[1] * w1, c[0] - n1[0] * w1, c[1] - n1[1] * w1, a[0] - n0[0] * w0, a[1] - n0[1] * w0],
      len[i] / total, 0, len[i + 1] / total, 1, col[0], col[1], col[2], col[3]);
  }
  b.flush();
}
/**
 * NBolasVfx (cards/bolas_vfx, all additive): from the owner's centre along a quadratic Bézier (control 400–500 px
 * above the higher end) to the target's centre (0.6 s Sine Out), fading in (0.25 s); spinning at 30 rad/s slowing by
 * 12 rad/s², the side bolas drifting apart at 150 px/s; each bola trails an NBasicTrail Line2D (last 15 / 10 points);
 * 0.15 s after arriving it fades out (0.15 s) and frees itself.
 */
const NBolasVfx = N('Vfx.Cards.NBolasVfx');
NBolasVfx.Create = (owner: any, target: any) => {
  if (G.TestMode.IsOn || target?.IsDead) return null;
  const s0 = cnode(owner)?.VfxSpawnPosition, e0 = cnode(target)?.VfxSpawnPosition;
  if (!s0 || !e0) return null;
  const start = [s0.X, s0.Y], end = [e0.X, e0.Y], ctrl = [(start[0] + end[0]) * 0.5, Math.min(start[1], end[1]) - rand(400, 500)];
  return new AtkNode(async (n, layer) => {
    const fx = await fxOf('vfx/cards/bolas_vfx', layer, () => xf(start[0], start[1]), n);
    if (!fx) return;
    for (const it of fx.s.items) fx.set(it.p, () => ({ blend: 'add' })); // use_parent_material: the root's additive material
    fx.start();
    const st = { Modulate: { A: 0 }, x: start[0], y: start[1], rot: 0, speed: 30, b2: -50, b3: 50 };
    const bolas = [['CenterBola', 15], ['Bola2', 10], ['Bola3', 10]] as const;
    // the Trail Line2Ds (not converted): default_color white × their modulate
    const trailMod = [[0.28, 0.604, 1, 1], [0.4, 0.407843, 1, 1], [0.4, 0.407843, 1, 1]];
    const pts: number[][][] = [[], [], []];
    const lines: (QuadBatch | null)[] = [null, null, null];
    const holders = bolas.map(([p]) => { const h = new Container(); const w = fx.wrapOf(`${p}/Sprite2D`); fx.root.addChildAt(h, w ? fx.root.getChildIndex(w) : 0); return h; });
    void sceneTexture('images/packed/vfx/trail.png').then((t) => {
      if (!t || fx.dead) return;
      holders.forEach((h, i) => { const b = new QuadBatch(bolas[i][1], plainShader, t); b.blendMode = 'add'; h.addChild(b); lines[i] = b; });
    });
    const t = tween().SetParallel();
    t.TweenProperty(st, 'modulate:a', 1, 0.25).From(0);
    t.TweenMethod((p: number) => { const u = 1 - p; st.x = u * u * start[0] + 2 * u * p * ctrl[0] + p * p * end[0]; st.y = u * u * start[1] + 2 * u * p * ctrl[1] + p * p * end[1]; }, 0, 1, 0.6).SetEase(1).SetTrans(1);
    t.Chain();
    t.TweenInterval(0.15);
    t.TweenProperty(st, 'modulate:a', 0, 0.15);
    n.$onExit.push(() => t.Kill());
    fx.root.alpha = 0;
    $.onFrame((dt: number) => {
      if (fx.dead) return false;
      st.rot += dt * -st.speed;
      st.speed -= dt * 12;
      st.b2 -= 150 * dt;
      st.b3 += 150 * dt;
      const m = xf(st.x, st.y, st.rot);
      fx.root.setFromMatrix(m);
      fx.root.alpha = st.Modulate.A;
      fx.place('Bola2', xf(st.b2, 0));
      fx.place('Bola3', xf(st.b3, 0));
      const inv = m.clone().invert();
      bolas.forEach(([, max], i) => {
        const lx = i === 0 ? 0 : i === 1 ? st.b2 : st.b3, g = m.apply({ x: lx, y: 0 });
        pts[i].push([g.x, g.y]);
        if (pts[i].length > max) pts[i].shift();
        holders[i].setFromMatrix(inv); // NBasicTrail: the Line2D stays in global space
        const b = lines[i];
        if (b) drawBand(b, pts[i], 36, TRAIL_CURVE, trailMod[i]);
      });
      return true;
    });
    await finished(t);
    n.QueueFree();
  });
};

// ------------------------------------------------------------------ sovereign blade
/** NCreature as a web parent: the nodes the rule layer adds to a creature node (NSovereignBladeVfx) and GetChildren. */
Object.assign(N('Combat.NCreature').prototype, {
  AddChild(this: any, c: any) {
    if (!c || !('$kids' in c)) return;
    c.$parent?.RemoveChild?.(c);
    (this.$kids ??= []).push(c);
    c.$parent = this;
    c.$entered?.();
  },
  RemoveChild(this: any, c: any) { const k = this.$kids ?? [], i = k.indexOf(c); if (i >= 0) k.splice(i, 1); if (c?.$parent === this) c.$parent = null; },
  GetChildren(this: any): any[] { return [...(this.$kids ?? [])]; },
  GetChildCount(this: any): number { return (this.$kids ?? []).length; },
  MoveChild(this: any, c: any, i: number) { const k = this.$kids ?? [], j = k.indexOf(c); if (j < 0) return; k.splice(j, 1); k.splice(Math.min(i, k.length), 0, c); c.$moved?.(i); },
});

/** sovereign_blade.tscn's %Path Curve2D (in, out, position per point) and its Path2D transform. */
const ORBIT = [[0, 0, 0, 0, -16.632, -119.646], [-36.9344, 211.325, 36.9344, -211.325, 139.842, -282.813], [-0.387668, 0, 0.387668, 0, 19.2266, -629.169],
  [39.851, -223.279, -39.851, 223.279, -158.67, -458.995], [0, 0, 0, 0, -18.0291, -119.646]];
const ORBIT_XF = [2.14732, 0, 0, 0.998972, 87.7143, 79.5227];
/** Curve2D baked for SampleBaked: the Bézier segments as a dense polyline with running lengths. ponytail: dense sampling, not Godot's 5 px re-bake (same curve, lengths agree to well under a pixel). */
const orbit = (() => {
  const pts: number[][] = [], len = [0];
  for (let i = 0; i < ORBIT.length - 1; i++) {
    const a = ORBIT[i], b = ORBIT[i + 1], p0 = [a[4], a[5]], p1 = [a[4] + a[2], a[5] + a[3]], p2 = [b[4] + b[0], b[5] + b[1]], p3 = [b[4], b[5]];
    for (let k = i ? 1 : 0; k <= 200; k++) {
      const t = k / 200, u = 1 - t;
      pts.push([0, 1].map((j) => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]));
      if (pts.length > 1) { const q = pts[pts.length - 2], r = pts[pts.length - 1]; len.push(len[len.length - 1] + Math.hypot(r[0] - q[0], r[1] - q[1])); }
    }
  }
  const total = len[len.length - 1];
  const at = (d: number) => {
    let lo = 0, hi = len.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] <= d) lo = m; else hi = m; }
    const f = (d - len[lo]) / (len[hi] - len[lo] || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
  };
  return { total, at };
})();
const TRAIL_W = [[0, 0.987017, 0, 0], [0.998188, 0.991345, -0.0361939, 0]];
const SB = 'SpineSword/SwordBone/ScaleContainer/';
const NSovereignBladeVfx = N('Vfx.NSovereignBladeVfx');
/**
 * NSovereignBladeVfx (vfx/sovereign_blade), a child of the owner's creature node: the sword skeleton (idle_loop) with
 * the blade / glow / hilts / spikes / flames on its `blade` bone, orbiting along %Path (60 px/s) — behind the
 * character on the far side of the orbit while the blade is small — and drifting (lerp 7/s) to its orbit point, which
 * moves towards the creature's front as the blade grows. Forge grows it (scale 0.9 → 2 by damage / 200, a 1.2× pop,
 * glow flash, sparks, flames when new); Attack pulls back 50 px and thrusts at the target (slash sparks, trail);
 * RemoveSovereignBlade shrinks it away (0.2 s). Positions are the original's global ones, in the creature's frame.
 * Hovering %Hitbox (a DOM box in the creature's overlay, under or over its hitbox with the blade's draw order) shows
 * the card's tip beside it and the selection reticle, and stops the orbit, unless it is attacking or a target is
 * being picked.
 * ponytail: "in front" is the top of the creature's Pixi container (its HP bar / intents are DOM above the stage); the
 * non-local emitters (ForgeSparks, SlashParticles) move with the sword instead of staying where they were emitted.
 */
class BladeNode extends NSovereignBladeVfx {
  $kids: any[] = [];
  $parent: any = null;
  $freed = false;
  private root = new Container();
  private st = { Scale: v2(0, 0), GlobalPosition: v2(0, 0), Rotation: 0, glow: { Modulate: new $.Color(0, 0, 0, 0) }, trail: { Modulate: new $.Color(1, 1, 1, 1) } };
  private size = 0;
  private forging = false;
  private attacking = false;
  private behind = false;
  private glowVisible = false;
  private trailPts: number[][] = [];
  private trailStart = [0, 0];
  private tw: Record<string, any> = {};
  private sp: any = null;
  private wraps = new Map<string, { it: any; w: Container; d: Container | null; m0: number[] }>();
  private pending: (() => void)[] = [];
  private slashRot: number | null = null;
  private trailBatch: QuadBatch | null = null;
  private stop: (() => void) | null = null;
  private owner: any = null;
  /** %Hitbox (a Control under SpineSword: 278 × 129 at (−209, −60)), its MouseFilter Ignore, focus and the tip. */
  private hit: HTMLDivElement | null = null;
  private ignore = false;
  private focused = false;
  private hoverTip = false;
  private targeting = false;
  private reticle: Reticle | null = null;
  IsInsideTree() { return !this.$freed && !!this.$parent; }
  GetParent() { return this.$parent; }
  QueueFree() {
    if (this.$freed) return;
    this.$freed = true;
    for (const t of Object.values(this.tw)) t?.Kill?.();
    this.stop?.();
    this.hit?.remove();
    if (this.hoverTip) setTip(null); // the owner (%Hitbox) left the tree: NHoverTipSet.Remove
    if (this.owner) this.owner.Died = $.dremove(this.owner.Died, this.onDied);
    this.$parent?.RemoveChild?.(this);
    if (!this.root.destroyed) this.root.destroy({ children: true });
  }
  private onDied = () => { this.ignore = true; this.updateHoverTip(); this.RemoveSovereignBlade(); };
  /** UpdateHoverTip: the card's tip at the hitbox's top-right corner (unaligned) and the reticle. */
  private updateHoverTip() {
    const on = this.focused && !this.attacking && !targetManager.IsInSelection && !this.ignore;
    if (on && !this.hoverTip) {
      this.hoverTip = true;
      const h = this.hitboxXf();
      setTips(hoverTipsOf({ HoverTips: [G.HoverTipFactory.FromCard$CardModel_Boolean(this.Card, false)] }), { kind: 'at', x: h.e + 278, y: h.f });
      this.reticle?.OnSelect();
    } else if (!on && this.hoverTip) {
      setTip(null);
      this.reticle?.OnDeselect();
      this.hoverTip = false;
    }
  }
  /** %Hitbox's global transform (SpineSword's position, rotation and scale in the creature's frame). */
  private hitboxXf() {
    const k = this.frame()?.root.scale.x ?? 1, r = this.st.Rotation, sx = this.st.Scale.X * k, sy = this.st.Scale.Y * k;
    const a = Math.cos(r) * sx, b = Math.sin(r) * sx, c = -Math.sin(r) * sy, d = Math.cos(r) * sy, g = this.st.GlobalPosition;
    return { a, b, c, d, e: g.X - 209 * a - 60 * c, f: g.Y - 209 * b - 60 * d };
  }
  /** The hitbox box: first in the creature's overlay while the blade is drawn behind it, last while in front. */
  private placeHitbox() {
    const el: HTMLElement | null = this.$parent?.overlay ?? null, s = this.$parent?.slot;
    if (!el || !el.isConnected || !s) { this.hit?.remove(); return; }
    let hit = this.hit;
    if (!hit) {
      hit = this.hit = document.createElement('div');
      hit.className = 'blade-hitbox';
      hit.onpointerenter = () => { this.focused = true; if (!safe(() => room().Ui.Hand.InCardPlay, false)) this.updateHoverTip(); };
      hit.onpointerleave = () => { this.focused = false; this.updateHoverTip(); };
    }
    if (hit.parentElement !== el || (this.behind ? el.firstChild : el.lastChild) !== hit) el.insertBefore(hit, this.behind ? el.firstChild : null);
    const h = this.hitboxXf(), k = s.s || 1;
    hit.style.transform = `matrix(${h.a / k}, ${h.b / k}, ${h.c / k}, ${h.d / k}, ${(h.e - s.x) / k}, ${(h.f - s.y) / k})`;
    hit.style.pointerEvents = this.ignore || targetManager.IsInSelection ? 'none' : '';
  }
  private creature() { return this.$parent?.Entity ?? this.$parent?.creature ?? null; }
  /** The creature node's global transform (its origin and scale on the 1920×1080 stage). */
  private frame() {
    const a: any = activeStage?.actors.get(this.creature());
    return a && !a.root.destroyed ? a : null;
  }
  private toLocal(g: number[]) { const a = this.frame(), s = a?.root.scale.x || 1; return a ? [(g[0] - a.root.x) / s, (g[1] - a.root.y) / s] : g; }
  private toGlobal(l: number[]) { const a = this.frame(), s = a?.root.scale.x || 1; return a ? [a.root.x + l[0] * s, a.root.y + l[1] * s] : l; }
  private room: any = null;
  $entered() {
    if (this.stop) return;
    this.room = room();
    this.owner = this.Card?.Owner?.Creature ?? null;
    if (this.owner) this.owner.Died = $.dcombine(this.owner.Died, this.onDied);
    const start = this.toGlobal([100, -500]); // SpineSword's scene position
    this.st.GlobalPosition = v2(start[0], start[1]);
    void this.build();
    this.stop = $.onFrame((dt: number) => { if (this.$freed) return false; this.process(dt); return true; });
  }
  private async build() {
    const s = await loadScene('scenes/vfx/sovereign_blade.tscn');
    if (!s || this.$freed) return;
    const spineIt = s.items.find((i) => i.k === 'spine');
    const swordM = M(s.nodes.SpineSword ?? [1, 0, 0, 1, 100, -500]).invert();
    // _Ready: the one-shot bursts and the second-stage spikes start off; BladeGlow is hidden and transparent
    const off = new Set([`${SB}ForgeSparks`, `${SB}SpawnFlames`, `${SB}SpawnFlamesBack`, 'SpineSword/SlashParticles']);
    const idle = new Set([`${SB}ChargeParticles`, `${SB}Spikes2`, `${SB}SpikeCircle2`]);
    const boneC = new Container(), slashC = new Container();
    for (const it0 of s.items) {
      if (it0.k === 'spine' || it0.p.startsWith('SpineSword/Hitbox')) continue;
      const it = { ...it0, m: [1, 0, 0, 1, 0, 0], bone: undefined, behind: undefined, oneShot: off.has(it0.p) || it0.oneShot, emitting: !off.has(it0.p) && !idle.has(it0.p) && it0.emitting, color: it0.p === `${SB}BladeGlow` ? [1, 1, 1, 1] : it0.color };
      const w = new Container();
      w.setFromMatrix(it0.bone ? M(it0.m) : swordM.clone().append(M(it0.m)));
      (it0.bone ? boneC : slashC).addChild(w);
      const e = { it, w, d: null as Container | null, m0: it0.m as number[] };
      this.wraps.set(it0.p, e);
      if (it.k === 'particles') { if (it.emitting) this.restart(it0.p); }
      else { e.d = buildScene({ ...s, items: [it] }); w.addChild(e.d); }
    }
    const spineC = new Container();
    spineC.addChild(boneC, slashC);
    if (spineIt) spineC.addChild(buildScene({ ...s, items: [{ ...spineIt, m: [1, 0, 0, 1, 0, 0] }] }, undefined, (sp: any) => {
      this.sp = sp;
      const prev = sp.afterUpdateWorldTransforms, bone = sp.skeleton.findBone('blade');
      sp.afterUpdateWorldTransforms = (x: any) => { prev(x); if (bone && !boneC.destroyed) boneC.setFromMatrix(new Matrix(bone.a, bone.c, bone.b, bone.d, bone.worldX, bone.worldY)); };
      this.anim('idle_loop', true);
    }));
    void sceneTexture('images/vfx/sovereign_blade/sovereign_blade_trail.png').then((t) => {
      if (!t || this.root.destroyed) return;
      this.trailBatch = new QuadBatch(1, plainShader, t);
      this.root.addChildAt(this.trailBatch, 0); // show_behind_parent
    });
    // %Hitbox/%SelectionReticle, drawn over the sword
    const RET = 'SpineSword/Hitbox/SelectionReticle', ret = new Container();
    ret.setFromMatrix(swordM.clone());
    ret.addChild(selectionReticle(buildScene(s, (p) => p.startsWith(RET)), s, RET, (r) => { this.reticle = r; }));
    spineC.addChild(ret);
    this.root.addChild(spineC);
    this.spineC = spineC;
    for (const f of this.pending.splice(0)) f();
    this.apply();
  }
  private spineC: Container | null = null;
  private anim(name: string, loop: boolean) { try { this.sp?.state.setAnimation(0, name, loop); } catch { /* missing animation */ } }
  private later(f: () => void) { if (this.spineC) f(); else this.pending.push(f); }
  private restart(p: string, patch?: any) {
    const e = this.wraps.get(p);
    if (!e) return;
    if (patch) e.it = { ...e.it, ...patch };
    e.d?.destroy({ children: true });
    e.d = particleItem({ ...e.it, emitting: true }, true);
    e.w.addChild(e.d);
  }
  private emit(p: string, on: boolean) {
    const e = this.wraps.get(p);
    if (!e) return;
    const em = (e.d as any)?.emitter;
    if (on && (!e.d || !em || em.done)) this.restart(p);
    else if (em) em.emitting = on;
    else if (!on && e.d) { e.d.destroy({ children: true }); e.d = null; }
  }
  private show(p: string, on: boolean) { const e = this.wraps.get(p); if (e) e.w.visible = on; }
  /** _Process: orbit, draw order, drift. */
  private process(dt: number) {
    if (room() !== this.room || this.root.destroyed) { this.QueueFree(); return; } // freed with the creature node / its display
    const a = this.frame();
    if (!a) return;
    if (this.root.parent !== a.root) a.root.addChildAt(this.root, this.behind ? 0 : a.root.children.length);
    // NTargetManager TargetingBegan / TargetingEnded: MouseFilter Ignore / Stop, UpdateHoverTip
    if (targetManager.IsInSelection !== this.targeting) { this.targeting = targetManager.IsInSelection; this.updateHoverTip(); }
    if (!this.hoverTip) this.OrbitProgress += (60 * dt) / orbit.total;
    const num = this.OrbitProgress % 1, flag = num > 0.25 && num < 0.7799999713897705;
    if (flag !== this.behind && this.size < 0.6) {
      this.behind = !this.behind;
      a.root.addChildAt(this.root, flag ? 0 : a.root.children.length - 1); // MoveChild(this, 0 | last)
    }
    const o = orbit.at(num * orbit.total), px = ORBIT_XF[0] * o[0] + ORBIT_XF[4], py = ORBIT_XF[3] * o[1] + ORBIT_XF[5];
    const g = this.toGlobal([px, py]);
    g[0] += (a.root.x + 200 - g[0]) * Math.min(Math.max(this.size / 1.25, 0), 1);
    g[1] -= (this.st.Scale.Y - 1) * 100;
    if (!this.attacking) {
      const k = dt * 7, p = this.st.GlobalPosition;
      this.st.GlobalPosition = v2(p.X + (g[0] - p.X) * k, p.Y + (g[1] - p.Y) * k);
    }
    this.apply();
    this.placeHitbox();
  }
  private apply() {
    const c = this.spineC;
    if (!c) return;
    const l = this.toLocal([this.st.GlobalPosition.X, this.st.GlobalPosition.Y]);
    c.setFromMatrix(xf(l[0], l[1], this.st.Rotation, this.st.Scale.X, this.st.Scale.Y));
    const glow = this.wraps.get(`${SB}BladeGlow`);
    if (glow) { glow.w.visible = this.glowVisible; glow.w.tint = hex(rgba(this.st.glow.Modulate)); glow.w.alpha = this.st.glow.Modulate.A; }
    const slash = this.wraps.get('SpineSword/SlashParticles');
    if (slash && this.slashRot != null) slash.w.setFromMatrix(xf(-157, -2, this.slashRot));
    const b = this.trailBatch;
    if (b) {
      if (this.trailPts.length < 2) { b.hide(0); b.flush(); }
      else drawBand(b, this.trailPts.map((p) => this.toLocal(p)), 100, TRAIL_W, [0.29, 0.562167, 1, this.st.trail.Modulate.A]);
    }
  }
  /** SpikeCircle's global position (EndSlash's trail end). */
  private spikeCircle(): number[] {
    const e = this.wraps.get(`${SB}SpikeCircle`), b = this.sp?.skeleton.findBone('blade');
    const l = this.toLocal([this.st.GlobalPosition.X, this.st.GlobalPosition.Y]);
    if (!e || !b) return [this.st.GlobalPosition.X, this.st.GlobalPosition.Y];
    const p = xf(l[0], l[1], this.st.Rotation, this.st.Scale.X, this.st.Scale.Y).append(new Matrix(b.a, b.c, b.b, b.d, b.worldX, b.worldY)).apply({ x: e.m0[4], y: e.m0[5] });
    return this.toGlobal([p.x, p.y]);
  }
  Forge(bladeDamage = 0, showFlames = false) {
    if (this.forging) this.cleanupForge();
    this.size = Math.min(Math.max(bladeDamage / 200, 0), 1);
    this.forging = true;
    const size = this.size, n = Math.trunc(size * 30), hilt = size < 0.3;
    this.later(() => {
      if (n > 0) this.restart(`${SB}ChargeParticles`, { amount: n }); // Amount = n restarts the emitter
      else this.emit(`${SB}ChargeParticles`, false);
      this.show(`${SB}Hilt`, hilt);
      this.show(`${SB}Hilt2`, !hilt);
      for (const [p, on] of [['Spikes', hilt], ['Spikes2', !hilt], ['SpikeCircle', hilt], ['SpikeCircle2', !hilt]] as const) { this.show(SB + p, on); this.emit(SB + p, on); }
      this.show(`${SB}Detail`, bladeDamage >= 0.66); // (sic: damage, not size)
    });
    this.glowVisible = true;
    const c = html('ff7300'), glow = tween();
    this.tw.glow = glow;
    if (showFlames) this.later(() => { this.restart(`${SB}SpawnFlames`); this.restart(`${SB}SpawnFlamesBack`); });
    glow.TweenProperty(this.st.glow, 'modulate', new $.Color(c[0], c[1], c[2], 1), 0.05).SetEase(1);
    glow.Chain().TweenProperty(this.st.glow, 'modulate', new $.Color(c[0], c[1], c[2], 0), 0.5).SetEase(0).SetTrans(7);
    glow.Chain().TweenCallback(() => this.cleanupForge());
    const k = 0.9 + (2 - 0.9) * size, sc = tween();
    this.tw.scale = sc;
    sc.TweenProperty(this.st, 'scale', v2(k * 1.2, k * 1.2), 0.05000000074505806).SetEase(1).SetTrans(7);
    sc.Chain().TweenCallback(() => this.later(() => this.restart(`${SB}ForgeSparks`)));
    sc.Chain().TweenProperty(this.st, 'scale', v2(k, k), 0.30000001192092896).SetEase(2).SetTrans(7);
  }
  private cleanupForge() { this.forging = false; this.tw.scale?.Kill(); this.tw.glow?.Kill(); }
  Attack(target: any) {
    if (this.attacking) this.cleanupAttack();
    this.attacking = true;
    this.anim('attack', false);
    const p = this.st.GlobalPosition, back = v2(p.X - 50, p.Y), angle = Math.atan2(target.Y - p.Y, target.X - p.X) - this.st.Rotation;
    this.trailStart = [back.X, back.Y];
    const t = tween();
    this.tw.attack = t;
    t.TweenProperty(this.st, 'rotation', angle, 0.05000000074505806);
    t.Parallel().TweenProperty(this.st, 'global_position', back, 0.07999999821186066).SetEase(1).SetTrans(5);
    t.Chain().TweenProperty(this.st, 'rotation', angle, 0);
    t.Parallel().TweenProperty(this.st, 'global_position', v2(target.X, target.Y), 0.05000000074505806).SetEase(0).SetTrans(5);
    t.Chain().TweenCallback(() => this.endSlash());
    t.TweenInterval(0.25);
    t.Chain().TweenCallback(() => this.later(() => this.restart(`${SB}ForgeSparks`))).SetDelay(0.30000001192092896);
    t.Chain().TweenCallback(() => this.cleanupAttack());
    this.updateHoverTip();
  }
  private endSlash() {
    const p = this.st.GlobalPosition;
    this.slashRot = Math.atan2(this.trailStart[1] - p.Y, this.trailStart[0] - p.X) - this.st.Rotation - 1.5708;
    this.later(() => { this.restart(`${SB}ChargeParticles`); this.restart('SpineSword/SlashParticles'); });
    this.apply();
    this.trailPts = [this.trailStart, this.spikeCircle()];
    this.st.trail.Modulate = new $.Color(1, 1, 1, 1);
    const t = tween();
    this.tw.trail = t;
    t.TweenProperty(this.st.trail, 'modulate:a', 0, 0.20000000298023224);
  }
  private cleanupAttack() {
    this.attacking = false;
    this.tw.attack?.Kill();
    this.anim('idle_loop', true);
    this.st.Rotation = 0;
    this.trailPts = [];
  }
  RemoveSovereignBlade() {
    this.tw.scale?.Kill();
    const t = tween();
    this.tw.scale = t;
    t.TweenProperty(this.st, 'scale', v2(0, 0), 0.20000000298023224).SetEase(1).SetTrans(7);
    t.Chain().TweenCallback(() => this.QueueFree());
  }
}
NSovereignBladeVfx.Create = (card: any) => {
  if (G.TestMode.IsOn) return null;
  const n = new BladeNode();
  n.Card = card;
  return n;
};

// ------------------------------------------------------------------ vine shambler
/**
 * NVineShamblerVinesVfx (vine_shambler_vines_vfx, on each hit creature): the front vines' "animation" plays with the
 * back vines' (reparented into BackCombatVfxContainer where they stood); the front skeleton's dirt_1..4 events burst
 * the dirt emitters (one-shot, off until then); the first complete frees both.
 */
const VINES = 'vfx/monsters/vine_shambler_vines/vine_shambler_vines_vfx';
scriptedVfx.set(VINES, (layer, x, y) => void (async () => {
  const fx = await fxOf(VINES, layer, at(x, y));
  if (!fx) return;
  const dirt = ['DirtBlast1', 'VinesBackScene/DirtBlast2', 'DirtBlast3', 'VinesBackScene/DirtBlast4'];
  fx.set(dirt, () => ({ emitting: false, oneShot: true }));
  const back = new Container(), bl = backLayer();
  const bw = fx.wrapOf('VinesBackScene/VinesBack');
  if (bw && bl) { back.setFromMatrix(fx.m); back.addChild(bw); bl.addChild(back); } // Reparent keeps the global transform
  const free = () => { fx.free(); if (!back.destroyed) back.destroy({ children: true }); };
  fx.start((p, sp) => {
    try { sp.state.setAnimation(0, 'animation', true); } catch { /* no animation */ }
    if (p !== 'VinesFront') return;
    sp.state.setAnimation(0, 'animation', true).listener = {
      event: (_: any, ev: any) => { const m = /^dirt_(\d)$/.exec(ev?.data?.name ?? ''); if (m) fx.restart([dirt[+m[1] - 1]]); },
      complete: free,
    };
  });
})());

// ------------------------------------------------------------------ decimillipede
/**
 * NDecimillipedeRocksVfx (vfx_decimillipede_rocks; DecimillipedeSegment.AnimSegmentsAttack adds the instance to
 * CombatVfxContainer at the screen centre): every rock's GDScript _ready plays idle_loop; Play then drops the _rocks
 * one by one, each after a 100–200 ms Task.Delay, with a random fall1–4 (once, default mix); freed 5 s after the last.
 * The rocks' GDScript _process also still reacts to the A key (KEY_A held down → attack(): a random fall, idle_loop
 * queued after it, x moved within ±200 px of where the rock started), as it does in the original.
 */
const ROCKS = 'vfx/vfx_decimillipede_rocks';
scriptedVfx.set(ROCKS, (layer, x, y) => void (async () => {
  const fx = await fxOf(ROCKS, layer, at(x, y));
  if (!fx) return;
  const rocks = new Map<string, { sp: any; fall: string | null; base: number }>();
  const fall = (p: string, anim: string) => { const r = rocks.get(p); if (r?.sp) r.sp.state.setAnimation(0, anim, false); else rocks.set(p, { sp: null, fall: anim, base: 0 }); };
  fx.start((p, sp) => {
    sp.state.data.defaultMix = fx.s.items.find((it) => it.p === p)?.spine?.mix ?? 0;
    const want = rocks.get(p)?.fall;
    rocks.set(p, { sp, fall: null, base: sp.parent?.x ?? 0 });
    if (want) sp.state.setAnimation(0, want, false);
  });
  let down = false;
  const key = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'a') return;
    if (e.type === 'keyup') { down = false; return; }
    if (down) return;
    down = true;
    for (const r of rocks.values()) {
      if (!r.sp || r.sp.destroyed) continue;
      r.sp.state.setAnimation(0, `fall${1 + Math.floor(Math.random() * 4)}`, false).mixDuration = 0;
      r.sp.state.addAnimation(0, 'idle_loop', true, 0).mixDuration = 0;
      if (r.sp.parent) r.sp.parent.x = r.base + (Math.random() * 400 - 200);
    }
  };
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);
  try {
    for (const p of (fx.ex._rocks ?? []) as string[]) {
      await delay(100 + Math.floor(Math.random() * 101));
      if (fx.dead) return;
      fall(p, `fall${1 + Math.floor(Math.random() * 4)}`);
    }
    await delay(5000);
  } finally {
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
    fx.free();
  }
})());
