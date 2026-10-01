// Card VFX in a transparent canvas of their own, over the flying cards: NCardTrailVfx (two additive Line2D trails with
// NCardTrail's point ageing, sparks and card silhouettes), NCardFlyShuffleVfx silhouettes and NExhaustVfx particles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Application, Container, Sprite, Texture } from 'pixi.js';
import { $ } from '../game';
import { invalidate } from '../store';
import { QuadBatch, plainShader } from './canvas';
import { loadScene, followParticles, sceneTexture, playSpriteVfx, particleItem } from './scene';
import { TrailVfx, ShuffleFlyVfx, ExhaustVfx, CardSmithVfx } from '../cardnodes';

/** card_trail_<character>.tscn Line2D modulates (Outer, Inner); widths, curves and gradients are shared. */
const TRAIL_MOD: Record<string, number[][]> = {
  ironclad: [[1, 0.168627, 0, 0.752941], [1, 0.827451, 0, 0.501961]],
  silent: [[0, 0.668156, 0.118437, 0.752941], [1, 1, 0, 0.501961]],
  defect: [[0, 0.603654, 0.789533, 0.752941], [0, 1, 0.883333, 0.501961]],
  regent: [[0.624218, 0.276004, 0, 0.752941], [1, 1, 0, 0.501961]],
  necrobinder: [[1, 0.12558, 0.287734, 0.752941], [0.95975, 0.668365, 0.606022, 0.501961]],
};
const GRAD_COLS = [[0, 0, 0, 0], [0.25, 0.25, 0.25, 0.305882], [1, 1, 1, 1]];
/** Curve points: x, y, left tangent, right tangent. */
const LINES = [
  { width: 96, color: [1, 1, 1, 0.752941], tex: 'images/packed/vfx/trail.png', gOff: [0, 0.141431, 0.522463],
    curve: [[0, 0.111037, 0, 0], [0.839578, 0.663793, -2.61019, -2.61019], [0.922468, 0.94341, 0, 0], [1, 0.685611, 0, 0]] },
  { width: 64, color: [1, 1, 1, 1], tex: 'images/packed/vfx/trail2.png', gOff: [0.261231, 0.647255, 0.821549],
    curve: [[0, 0, 0, 0], [0.801075, 0.571397, -3.15833, -3.15833], [0.900922, 0.367031, 0, 0], [0.938291, 0.930834, 0, 0], [1, 0.742201, 0, 0]] },
];
/** Godot Curve.Sample: cubic Bézier in y between points, tangents scaled by the segment width. */
export function curveAt(c: number[][], x: number) {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1];
    if (x > b[0]) continue;
    const d = b[0] - a[0], t = d ? (x - a[0]) / d : 0, u = 1 - t;
    const p1 = a[1] + (a[3] * d) / 3, p2 = b[1] - (b[2] * d) / 3;
    return u * u * u * a[1] + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * b[1];
  }
  return c[c.length - 1][1];
}
function gradAt(off: number[], t: number) {
  if (t <= off[0]) return GRAD_COLS[0];
  for (let i = 0; i < off.length - 1; i++) {
    if (t > off[i + 1]) continue;
    const f = (t - off[i]) / (off[i + 1] - off[i] || 1), a = GRAD_COLS[i], b = GRAD_COLS[i + 1];
    return a.map((v, k) => v + (b[k] - v) * f);
  }
  return GRAD_COLS[GRAD_COLS.length - 1];
}

/** NCardTrail: points in global space, aged out after 0.8 s; gaps over 48 px are filled along a curve. */
class TrailLine {
  pts: { x: number; y: number; age: number }[] = [];
  private last: number[] | null = null;
  batch: QuadBatch | null = null;
  constructor(parent: Container, private spec: (typeof LINES)[number], private mod: number[]) {
    sceneTexture(spec.tex).then((t) => {
      if (!t || parent.destroyed) return;
      this.batch = new QuadBatch(160, plainShader, t);
      this.batch.blendMode = 'add';
      parent.addChild(this.batch);
    });
  }
  update(dt: number, x: number, y: number, alpha: number) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[0].age > 0.8) this.pts.shift();
    this.add(x, y, dt);
    this.draw(alpha);
  }
  private add(x: number, y: number, dt: number) {
    if (this.last) {
      const d = Math.hypot(x - this.last[0], y - this.last[1]);
      if (d < 12) return;
      const n = this.pts.length;
      if (n > 2 && d > 48) {
        const a = this.pts[n - 2], b = this.pts[n - 1];
        for (let s = 48; s < d - 12; s += 48) {
          const f = 0.5 + (s / d) * 0.5;
          const v = [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f], w = [b.x + (x - b.x) * f, b.y + (y - b.y) * f];
          this.pts.push({ x: v[0] + (w[0] - v[0]) * f, y: v[1] + (w[1] - v[1]) * f, age: dt * f });
        }
      }
    }
    this.pts.push({ x, y, age: 0 });
    this.last = [x, y];
  }
  private draw(alpha: number) {
    const b = this.batch;
    if (!b) return;
    const p = this.pts, n = Math.min(p.length, b.n + 1), s = this.spec, m = this.mod;
    const len = [0];
    for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
    const total = len[n - 1] || 1;
    const normal = (i: number) => {
      const a = p[Math.max(0, i - 1)], c = p[Math.min(n - 1, i + 1)];
      const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    for (let i = 0; i < b.n; i++) {
      if (i >= n - 1) { b.hide(i); continue; }
      const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
      const w0 = (s.width * curveAt(s.curve, t0)) / 2, w1 = (s.width * curveAt(s.curve, t1)) / 2;
      const n0 = normal(i), n1 = normal(i + 1), a = p[i], c = p[i + 1];
      const g = gradAt(s.gOff, (t0 + t1) / 2);
      b.quad(i, [a.x + n0[0] * w0, a.y + n0[1] * w0, c.x + n1[0] * w1, c.y + n1[1] * w1, c.x - n1[0] * w1, c.y - n1[1] * w1, a.x - n0[0] * w0, a.y - n0[1] * w0],
        len[i] / total, 0, len[i + 1] / total, 1,
        s.color[0] * g[0] * m[0], s.color[1] * g[1] * m[1], s.color[2] * g[2] * m[2], s.color[3] * g[3] * m[3] * alpha);
    }
    b.flush();
  }
}

/** One NCardTrailVfx: lines, the Sprites node (sparks + silhouettes) following the node. */
class TrailGfx {
  root = new Container();
  private lines: TrailLine[];
  private sprites = new Container();
  private sparks: { view: Container; stop: () => void }[] = [];
  private stopped = false;
  constructor(parent: Container, private trail: TrailVfx) {
    parent.addChild(this.root);
    const mod = TRAIL_MOD[trail.character] ?? TRAIL_MOD.ironclad;
    this.lines = LINES.map((spec, i) => new TrailLine(this.root, spec, mod[i]));
    this.root.addChild(this.sprites);
    loadScene(`scenes/vfx/card_trail_${trail.character}.tscn`).then((s) => {
      if (!s || this.root.destroyed) return;
      for (const it of s.items) {
        if (it.k === 'particles') {
          const sp = followParticles(it, () => [this.trail.x, this.trail.y, this.trail.rot, this.trail.spritesScale]);
          this.sparks.push(sp);
          this.root.addChildAt(sp.view, 0);
        } else if (it.k === 'tex') {
          const spr = new Sprite(Texture.EMPTY);
          spr.anchor.set(0.5);
          spr.blendMode = 'add';
          if (it.color) { spr.tint = ((it.color[0] * 255) << 16) | ((it.color[1] * 255) << 8) | (it.color[2] * 255); spr.alpha = it.color[3]; }
          spr.scale.set(it.m[0], it.m[3]);
          sceneTexture(it.src).then((t) => { if (t && !spr.destroyed) { spr.texture = t; spr.width = it.w * it.m[0]; spr.height = it.h * it.m[3]; } });
          this.sprites.addChild(spr);
        }
      }
    });
  }
  update(dt: number) {
    const t = this.trail;
    for (const l of this.lines) l.update(dt, t.x, t.y, t.alpha);
    this.sprites.position.set(t.x, t.y);
    this.sprites.rotation = t.rot;
    this.sprites.scale.set(t.spritesScale);
    this.sprites.alpha = t.spritesAlpha * t.alpha;
    if (!t.following && !this.stopped) { this.stopped = true; for (const s of this.sparks) s.stop(); }
  }
  destroy() { this.root.destroy({ children: true }); }
}

const claimed = new Set<TrailVfx>();
/**
 * The overlay canvas, mounted by the combat screen between the VFX-container cards and the combat UI. Its Application
 * lives for the page: destroying a second renderer tears down batcher state Pixi shares with the main stage.
 */
const overlays = new Map<string, Promise<Application>>();
export function overlayApp(key: string) {
  let p = overlays.get(key);
  if (!p) overlays.set(key, (p = (async () => {
    const a = new Application();
    await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, antialias: false, autoStart: false, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
    a.canvas.classList.add('card-fx');
    // additive onto a transparent canvas: keep dst alpha, so opaque-black textures (hammer_mark, impact circles) add
    // light over the DOM like Godot's opaque framebuffer instead of painting black (premultiplied rgb > a composites as add)
    const gl = (a.renderer as any).gl as WebGL2RenderingContext | undefined, map = (a.renderer as any).state?.blendModesMap;
    if (gl && map) map.add = [gl.ONE, gl.ONE, gl.ZERO, gl.ONE];
    return a;
  })()));
  return p;
}
/** `owns(node)`: whether a trail's node belongs to this layer (combat room vs. the global UI). */
/** CombatVfxContainer: VfxCmd scenes and hit / block sparks, over the creatures and their HP bars, under the hand. */
let combatRoot: Container | null = null;
/** The live CombatVfxContainer layer (null outside combat): ported VFX nodes draw into it. */
export const combatVfxRoot = () => (combatRoot && !combatRoot.destroyed ? combatRoot : null);
/** The NGlobalUi layer (over the whole run screen): VFX the rule layer adds to NRun.GlobalUi draw into it. */
let globalRoot: Container | null = null;
export const globalVfxRoot = () => (globalRoot && !globalRoot.destroyed ? globalRoot : null);
/**
 * Scenes whose root script drives the effect (NHeavyBluntVfx, NStarryImpactVfx, …), keyed by the VfxCmd path
 * (`vfx/vfx_heavy_blunt`): their ports replace the flat "emit everything" playback.
 */
export const scriptedVfx = new Map<string, (root: Container, x: number, y: number, tint?: number[]) => void>();
export function playCombatVfx(path: string, x: number, y: number, tint?: number[]) {
  const root = combatVfxRoot();
  if (!root) return;
  const key = path.replace(/^res:\/\/scenes\//, '').replace(/\.tscn$/, '');
  const port = scriptedVfx.get(key);
  if (port) port(root, x, y, tint);
  else void playSpriteVfx(root, path, x, y, 1, tint);
}
// NItemThrowVfx (vfx_item_throw.tscn) curves: horizontal progress, height, rotation influence
const THROW_H = [[0, 0, 0, 2.73591], [0.496583, 0.549666, 0.450627, 0.450627], [1, 1, 2.39805, 0]];
const THROW_V = [[0, 0, 0, 9.60083], [0.298405, 1, 0, 0], [0.753986, 1, 0, 0], [1, 0, -9.60083, 0]];
const THROW_R = [[0.00227791, 0.994574, 0, -3.81546], [0.501139, 0.196995, 0, 0], [1, 0.647329, 1.92383, 0]];
/** NItemThrowVfx: the item (80 px wide) arcs 350 px high from source to target over 0.55 s, spinning. */
export function playItemThrow(src: number[], dst: number[], texPath: string | null, scale = 1) {
  if (!combatRoot || combatRoot.destroyed || !texPath) return;
  const root = combatRoot, sp = new Sprite(Texture.EMPTY);
  sp.anchor.set(0.5);
  sp.visible = false;
  sp.rotation = Math.random() * Math.PI * 2;
  root.addChild(sp);
  void sceneTexture(texPath).then((t) => { if (t && !sp.destroyed) { sp.texture = t; sp.scale.set((scale * 80) / t.width); } });
  let t = 0;
  $.onFrame((dt: number) => {
    if (sp.destroyed) return false;
    if (t >= 0.55) { sp.destroy(); return false; }
    const u = t / 0.55, w = curveAt(THROW_H, u);
    sp.visible = true;
    sp.rotation += ((curveAt(THROW_R, u) * -2880 * Math.PI) / 180) * dt;
    sp.position.set(src[0] + (dst[0] - src[0]) * w, src[1] + (dst[1] - src[1]) * w - 350 * curveAt(THROW_V, u));
    t += dt;
    return true;
  });
}
/**
 * Ported VFX nodes (render/vfx-cards.ts) waiting for the canvas whose tree holds `node`: `draw(root)` adds their
 * display objects there (they free themselves). Entries whose node is freed first are dropped.
 */
export const pendingFx: { node: any; draw: (root: Container) => void }[] = [];
/**
 * A VFX node among DOM cards (`slotted`: NCombatUi's) draws in a slot of its own instead of the overlay's root: the
 * slot is rendered alone and copied into a canvas that ui/cardlayer.tsx stacks right over the node's own cards (the
 * node's `$fxSlot`), so its particles and flashes sit in the node's tree order among the cards. Freed with the node.
 */
export interface FxSlot { id: number; root: Container; canvas: HTMLCanvasElement | null }
let slotIds = 0;
export class CardFxCanvas {
  constructor(private key: string, private owns: (node: any) => boolean, private slotted: (node: any) => boolean = () => false) {}
  private slots = new Map<any, FxSlot>();
  private app: Application | null = null;
  private root = new Container();
  private trails = new Map<TrailVfx, TrailGfx>();
  private shuffles = new Map<ShuffleFlyVfx, Sprite>();
  private stop: (() => void) | null = null;
  private dead = false;
  async mount(el: HTMLElement) {
    const a = await overlayApp(this.key);
    if (this.dead) return;
    this.app = a;
    a.stage.removeChildren();
    a.stage.addChild(this.root);
    if (this.key === 'combat') combatRoot = this.root;
    if (this.key === 'global') globalRoot = this.root;
    el.appendChild(a.canvas);
    let idle = false;
    this.stop = $.onFrame((dt: number) => {
      if (this.dead) return false;
      this.sync(dt);
      this.renderSlots(a);
      const busy = this.trails.size > 0 || this.shuffles.size > 0 || this.slots.size > 0 || this.root.children.length > this.trails.size;
      if (busy || !idle) a.render();
      idle = !busy;
    });
  }
  private sync(dt: number) {
    for (const t of TrailVfx.all) if (!this.trails.has(t) && !claimed.has(t) && this.owns(t.follow)) { claimed.add(t); this.trails.set(t, new TrailGfx(this.root, t)); }
    for (const [t, g] of this.trails) {
      if (!TrailVfx.all.has(t)) { g.destroy(); this.trails.delete(t); claimed.delete(t); continue; }
      g.update(dt);
    }
    for (const s of ShuffleFlyVfx.all) if (!this.shuffles.has(s) && this.owns(s)) {
      const sp = new Sprite(Texture.EMPTY);
      sp.anchor.set(0.5);
      sp.tint = 0x000000;
      sceneTexture('images/packed/vfx/small_card_silhouette.png').then((t) => { if (t && !sp.destroyed) sp.texture = t; });
      this.root.addChild(sp);
      this.shuffles.set(s, sp);
    }
    for (const [s, sp] of this.shuffles) {
      if (!ShuffleFlyVfx.all.has(s)) { sp.destroy(); this.shuffles.delete(s); continue; }
      sp.position.set(s.Position.X, s.Position.Y);
      sp.rotation = s.Rotation;
      sp.scale.set(0.75 * s.Scale.X * (sp.texture.width ? 64 / sp.texture.width : 1));
      sp.alpha = s.alpha;
    }
    for (let i = pendingFx.length - 1; i >= 0; i--) {
      const e = pendingFx[i];
      if (e.node.$freed) pendingFx.splice(i, 1);
      else if (this.owns(e.node)) { pendingFx.splice(i, 1); e.draw(this.slotted(e.node) ? this.slotOf(e.node) : this.root); }
    }
    if (this.key === 'combat') for (const e of ExhaustVfx.pending.splice(0)) void playSpriteVfx(this.root, 'vfx/cards/exhaust_vfx', e.x, e.y);
    // NCardSmithVfx.PlaySubParticles: SparkN's three emitters, at the VFX node (its scale applied to the offsets)
    for (let i = CardSmithVfx.pending.length - 1; i >= 0; i--) {
      const e = CardSmithVfx.pending[i];
      if (!this.owns(e.node)) continue;
      CardSmithVfx.pending.splice(i, 1);
      const g = e.node.xf(), root = this.root;
      void loadScene('scenes/vfx/vfx_card_smith.tscn').then((sc) => {
        if (!sc || root.destroyed) return;
        for (const it of sc.items.filter((x: any) => String(x.p).startsWith(`Spark${e.spark}/`))) {
          const p = particleItem({ ...it, m: [g.sx, 0, 0, g.sy, g.x + it.m[4] * g.sx, g.y + it.m[5] * g.sy] }, true);
          root.addChild(p);
          setTimeout(() => { if (!p.destroyed) p.destroy({ children: true }); }, 1200);
        }
      });
    }
  }
  private slotOf(node: any) {
    let s = this.slots.get(node);
    if (!s) { s = { id: ++slotIds, root: new Container(), canvas: null }; this.slots.set(node, s); node.$fxSlot = s; invalidate(); }
    return s.root;
  }
  /** Each slot rendered on its own and copied out before the overlay's own render replaces the canvas. */
  private renderSlots(a: Application) {
    for (const [node, s] of this.slots) {
      if (node.$freed) { s.root.destroy({ children: true }); this.slots.delete(node); node.$fxSlot = null; invalidate(); continue; }
      const cv = s.canvas;
      if (!cv) continue;
      a.renderer.render({ container: s.root });
      if (cv.width !== a.canvas.width || cv.height !== a.canvas.height) { cv.width = a.canvas.width; cv.height = a.canvas.height; }
      const g = cv.getContext('2d');
      if (!g) continue;
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(a.canvas, 0, 0);
    }
  }
  destroy() {
    this.dead = true;
    this.stop?.();
    for (const [node, s] of this.slots) { s.root.destroy({ children: true }); node.$fxSlot = null; }
    this.slots.clear();
    if (combatRoot === this.root) combatRoot = null;
    if (globalRoot === this.root) globalRoot = null;
    for (const [t, g] of this.trails) { g.destroy(); claimed.delete(t); }
    this.trails.clear();
    this.shuffles.clear();
    this.root.destroy({ children: true });
    if (this.app) { this.app.stage.removeChildren(); this.app.render(); this.app.canvas.remove(); }
    this.app = null;
  }
}
