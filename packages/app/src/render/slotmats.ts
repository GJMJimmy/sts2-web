// spine-godot's slot materials (SpineSprite::update_meshes, spine-runtimes 4.2 — one SpineMesh2D per slot): each slot's
// attachment is drawn with its first SpineSlotNode's material for the slot's blend mode, else the SpineSprite's material
// for that blend mode, else the default CanvasItemMaterial of that blend mode. spine-pixi batches the whole skeleton, so a
// slot with a material is drawn here instead: the attachment's world vertices / uvs / colour, as spine-pixi computed them,
// go into a QuadBatch mesh with the translated shader inside a slot object (spine-pixi renders it at the slot's place in
// draw order), and spine-pixi's own copy of the attachment collapses to a point. The SpineSlotNode's children (scene
// effects) keep following the bone inside the same slot object, after the attachment as in Godot.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Container, Matrix, Texture } from 'pixi.js';
import { MeshAttachment, RegionAttachment, type Spine } from '@esotericsoftware/spine-pixi-v8';
import { QuadBatch, loadShader, plainShader, type GodotShader, type ShaderParams } from './canvas';
import { shaderParams } from './scene';
import { $ } from '../game';

const BLENDS = ['normal', 'additive', 'multiply', 'screen'] as const; // spine BlendMode order
type Blend = (typeof BLENDS)[number];
const CANVAS_BLEND: Record<string, any> = { mix: 'normal', add: 'add', sub: 'subtract', mul: 'multiply' };

/**
 * A ShaderMaterial (or CanvasItemMaterial): shared by every slot — and scene instance — using the same resource.
 * ponytail: a scene's sub-resource materials are keyed by their content (tools/scenes.py), so two identical ones in
 * different scenes share runtime parameter changes; key them by scene + id if a script ever tells them apart.
 */
export class Mat {
  version = 0;
  constructor(public sh: GodotShader, public params: ShaderParams, public blend?: string) {}
  set(name: string, v: number | number[]) { this.params[name] = v; this.version++; }
  /** Tween target: TweenProperty(mat.node, "shader_parameter/x", …) (WebTween reads "ShaderParameter/x"). */
  node = new Proxy({}, { get: (_, k) => this.params[String(k).slice(16)], set: (_, k, v) => (this.set(String(k).slice(16), v), true) });
}
const shared = new Map<string, Promise<Mat | null>>();
function loadMat(m: any): Promise<Mat | null> {
  if (m.blend) return Promise.resolve(new Mat(plainShader, {}, m.blend));
  const make = () => Promise.all([loadShader(m.shader.src), shaderParams(m.shader.params)]).then(([sh, p]) => (sh ? new Mat(sh, p) : null));
  if (m.local) return make(); // resource_local_to_scene: a copy per instance
  let p = shared.get(m.key);
  if (!p) shared.set(m.key, (p = make()));
  return p;
}
/** res://materials/vfx/hsv.tres (h = s = v = 1), duplicated (NCreatureVisuals.SetScaleAndHue). */
const hsv = () => loadShader('shaders/hsv.gdshader').then((sh) => (sh ? new Mat(sh, { h: 1, s: 1, v: 1 }) : null));

/**
 * Godot puts the canvas item's modulate into the vertex COLOR the shader reads (and overwrites); Pixi's QuadBatch
 * multiplies the result by the item's colour instead. Slot shaders get Godot's order.
 * ponytail: Pixi skips a container at alpha 0, where Godot would still run a shader that ignores COLOR.
 */
const modulated = new WeakMap<GodotShader, GodotShader>();
function godotModulate(sh: GodotShader): GodotShader {
  let m = modulated.get(sh);
  if (!m) {
    const a = sh.fragment.replace('COLOR = vColor;', 'COLOR = vColor * (uColor.a > 0.0 ? vec4(uColor.rgb / uColor.a, uColor.a) : vec4(0.0));');
    const b = a.replace('fragColor = c * uColor;', 'fragColor = c;');
    m = a !== sh.fragment && b !== a ? { ...sh, fragment: b } : sh;
    modulated.set(sh, m);
  }
  return m;
}

interface Holder { root: Container; layer: Container; follower: Container; mesh?: QuadBatch & { key?: string; v?: number } }
type Mats = Partial<Record<Blend, Mat | null>>; // null: not drawable (loading, or its shader cannot run here)

export class SlotMaterials {
  /** SpineSprite.*_material */
  sprite: Mats = {};
  private slots = new Map<number, Mats>();
  private holders = new Map<number, Holder>();
  private done!: () => void;
  ready = new Promise<void>((r) => (this.done = r));
  private addObject: (ref: any, c: Container, o?: any) => void;
  constructor(public sp: Spine) {
    const s: any = sp;
    const transform = s.transformAttachments.bind(s), update = s.updateSlotObject.bind(s);
    this.addObject = s.addSlotObject.bind(s);
    s.transformAttachments = () => { transform(); this.draw(); };
    // the holder stays in skeleton space; SpineSlotNode children follow the bone as spine-pixi places slot objects
    s.updateSlotObject = (so: any) => {
      const h = this.holders.get(so.slot.data.index);
      update(h && so.container === h.root ? { ...so, container: h.follower } : so);
    };
    s.addSlotObject = (ref: any, c: Container, o?: any) => {
      const slot = typeof ref === 'string' ? sp.skeleton.findSlot(ref) : typeof ref === 'number' ? sp.skeleton.slots[ref] : ref;
      const h = slot && this.holders.get(slot.data.index);
      if (h) h.follower.addChild(c);
      else this.addObject(ref, c, o);
    };
  }

  /** The scene's SpineSprite item: `mats` (the sprite's), `slotMats` (by slot name) and its VFX scripts' material drivers. */
  async install(it: any) {
    const loads: Promise<void>[] = [];
    const want = (into: Mats, b: string, m: any) => {
      if (!BLENDS.includes(b as Blend)) return;
      into[b as Blend] = null; // hidden until loaded, as Godot never draws it without its material
      loads.push(loadMat(m).then((x) => { into[b as Blend] = x; }));
    };
    for (const [b, m] of Object.entries(it?.mats ?? {})) want(this.sprite, b, m);
    for (const [name, ms] of Object.entries(it?.slotMats ?? {})) {
      const slot = this.sp.skeleton.findSlot(name);
      if (!slot) continue;
      const into: Mats = {};
      this.slots.set(slot.data.index, into);
      for (const [b, m] of Object.entries(ms as any)) want(into, b, m);
    }
    this.refresh();
    await Promise.all(loads);
    if (this.sp.destroyed) return;
    for (const v of it?.vfx ?? []) SCRIPTS[v]?.(this);
    this.done();
  }
  /** A SpineSlotNode's normal material (MegaSlotNode.GetNormalMaterial). */
  slotMat(name: string) {
    const slot = this.sp.skeleton.findSlot(name);
    return (slot && this.slots.get(slot.data.index)?.normal) || null;
  }
  /** SpineSprite.set_*_material */
  setSprite(b: Blend, m: Mat | null) {
    if (m) this.sprite[b] = m;
    else delete this.sprite[b];
    this.refresh();
  }
  /** NCreatureVisuals.SetScaleAndHue: unless hue ≈ 0, the normal material (a copy of hsv.tres if it has none) gets h = hue. */
  async setHue(hue: number) {
    if (Math.abs(hue) <= 1e-5) return; // Mathf.IsEqualApprox(hue, 0)
    await this.ready; // the scene's own normal material first (the Myte's hsv)
    let m = this.sprite.normal;
    if (!m) {
      const x = await hsv();
      if (!x || this.sp.destroyed) return;
      m = this.sprite.normal ??= x;
      this.refresh();
    }
    m.set('h', hue);
  }
  private resolve(slot: any): Mat | null | undefined {
    const b = BLENDS[slot.data.blendMode];
    const own = this.slots.get(slot.data.index);
    return own && b in own ? own[b] : this.sprite[b];
  }
  /** A holder slot object for every slot drawn with a material (outside rendering: it changes the display tree). */
  private refresh() {
    const s: any = this.sp;
    for (const slot of this.sp.skeleton.slots) {
      if (this.resolve(slot) === undefined || this.holders.has(slot.data.index)) continue;
      const h: Holder = { root: new Container(), layer: new Container(), follower: new Container() };
      h.root.addChild(h.layer, h.follower);
      // effects already attached to the slot move into the holder, which now follows the bone for them
      const prev: Container | undefined = s._slotsObject[slot.data.name]?.container;
      if (prev) { s.removeSlotObject(slot); prev.setFromMatrix(new Matrix()); prev.alpha = 1; prev.visible = true; h.follower.addChild(prev); }
      this.holders.set(slot.data.index, h);
      this.addObject(slot, h.root);
    }
  }
  /** After spine-pixi's transformAttachments: each held slot's attachment into its mesh, spine-pixi's copy collapsed. */
  private draw() {
    const s: any = this.sp;
    for (const [i, h] of this.holders) {
      const slot = this.sp.skeleton.slots[i], att = slot.getAttachment(), mat = this.resolve(slot);
      let shown: Holder['mesh'] | null = null;
      if (mat !== undefined && slot.bone.active && (att instanceof RegionAttachment || att instanceof MeshAttachment)) {
        const d = s._getCachedData(slot, att);
        // spine-godot draws a slot whatever its alpha (the shader may not read COLOR); spine-pixi skips alpha 0 without clipping it
        const c = d.clipped && !d.skipRender ? d.clippedData : null;
        const pos: Float32Array = c ? c.vertices : d.vertices, n = c ? c.vertexCount : d.vertices.length / 2;
        if (mat && d.texture !== Texture.EMPTY) shown = this.mesh(h, mat, d, pos, c ? c.uvs : d.uvs, c ? c.indices.subarray(0, c.indicesCount) : d.indices, n);
        pos.fill(0, 0, n * 2);
      }
      for (const q of h.layer.children) q.visible = q === shown;
    }
  }
  private mesh(h: Holder, mat: Mat, d: any, pos: Float32Array, uv: Float32Array, idx: ArrayLike<number>, n: number) {
    const key = `${d.id}|${d.texture.uid}`;
    let q = h.mesh;
    if (!q || q.key !== key || q.n * 4 < n || (q as any).$mat !== mat) {
      q?.destroy();
      q = h.mesh = Object.assign(new QuadBatch(Math.ceil(n / 4), godotModulate(mat.sh), d.texture, mat.params), { key, v: mat.version, $mat: mat });
      if (mat.blend) q.blendMode = CANVAS_BLEND[mat.blend] ?? 'normal';
      h.layer.addChild(q);
    }
    q.pos.set(pos.subarray(0, n * 2));
    q.uv.set(uv.subarray(0, n * 2));
    const { r, g, b, a } = d.color;
    for (let k = 0; k < n; k++) { const o = k * 4; q.col[o] = r; q.col[o + 1] = g; q.col[o + 2] = b; q.col[o + 3] = a; }
    const ib = q.geometry.indexBuffer;
    if (ib.data.length !== idx.length || Array.prototype.some.call(idx, (x: number, j: number) => ib.data[j] !== x)) ib.data = Uint32Array.from(idx);
    q.flush();
    if (q.v !== mat.version) {
      // shader parameters set at runtime (scripts, SetScaleAndHue)
      const u = q.group.uniforms as any;
      for (const [k, v] of Object.entries(mat.params)) {
        if (!(k in u) || v instanceof Texture) continue;
        if (typeof u[k] === 'number') u[k] = +v;
        else u[k].set(v as number[]);
      }
      q.group.update();
      q.v = mat.version;
    }
    return q;
  }
}
const controllers = new WeakMap<Spine, SlotMaterials>();
/** The slot-material controller of a creature's skeleton. */
export const slotMats = (sp: Spine) => controllers.get(sp) ?? (controllers.set(sp, new SlotMaterials(sp)), controllers.get(sp)!);

/** Spine events → handlers (MegaSprite.ConnectAnimationEvent). */
function onEvents(c: SlotMaterials, h: Record<string, () => void>) {
  c.sp.state.addListener({ event: (_: any, e: any) => { if (!c.sp.destroyed) h[e.data.name]?.(); } });
}
const tween = (ease: number, trans: number) => { const t = new $.WebTween(); t.SetEase(ease); t.SetTrans(trans); return t; };
const IN = 0, OUT = 1, QUART = 3, QUAD = 4;
/**
 * The creature VFX scripts' material parts.
 * ponytail: only what drives materials (and Vantom's charge track) is ported; their particle toggles (Emitting at _Ready
 * and on events) and NSoulFyshVfx's _Ready SetAnimation("attack_debuff") are not — port the whole scripts when the
 * creature VFX nodes get a home.
 */
const SCRIPTS: Record<string, (c: SlotMaterials) => void> = {
  /** NSoulFyshVfx: both waves at amount 0.3, raised to 1 while the animation's wave events last. */
  NSoulFyshVfx(c) {
    const sound = c.slotMat('soundwave'), beckon = c.slotMat('beckonwave');
    sound?.set('amount', 0.3);
    beckon?.set('amount', 0.3);
    const to = (m: Mat | null, v: number, d: number, ease: number) => m && tween(ease, QUAD).TweenProperty(m.node, 'shader_parameter/amount', v, d);
    onEvents(c, {
      soundwave_start: () => to(sound, 1, 0.44999998807907104, OUT), soundwave_end: () => to(sound, 0.3, 0.5, IN),
      beckon_start: () => to(beckon, 1, 0.25, OUT), beckon_end: () => to(beckon, 0.3, 0.5, IN),
    });
  },
  /** NVantomVfx: the tail's dissolve (shared by the tail, tail_hook and megablade slots) and its charge track. */
  NVantomVfx(c) {
    const tail = c.slotMat('tail'), st = c.sp.state;
    tail?.set('step', -0.1);
    try { st.setAnimation(1, '_tracks/charged_0', true); } catch { /* no track animation */ }
    onEvents(c, {
      dissolve_tail: () => {
        if (!tail) return;
        const t = tween(IN, QUAD);
        t.TweenProperty(tail.node, 'shader_parameter/step', 1, 1);
        t.TweenCallback(() => { if (c.sp.destroyed) return; st.setAnimation(1, '_tracks/charge_up_1', false); st.addAnimation(1, '_tracks/charged_1', true, 0); });
      },
    });
  },
  /** NLivingGasVfx: "dissipate" raises the three smokes' AlphaStep to 1 (1.4 s, Quart In), "reconstitute" restores it. */
  NLivingGasVfx(c) {
    const mats = ['smoke_tex', 'smoke_tex2', 'smoke_tex3'].map((s) => c.slotMat(s)); // SmokeSlot1..3
    const steps = mats.map((m) => ((m?.params.AlphaStep as number[]) ?? [0, 1]).slice());
    const at = (t: number) => mats.forEach((m, i) => m?.set('AlphaStep', steps[i].map((x) => x + (1 - x) * t)));
    onEvents(c, {
      dissipate: () => { const t = new $.WebTween(); t.TweenMethod(at, 0, 1, 1.399999976158142); t.SetEase(IN).SetTrans(QUART); },
      reconstitute: () => at(0),
    });
  },
};
