// Renders scenes flattened by tools/scenes.py (backgrounds, rest sites, merchant, event backgrounds, VFX) as Pixi
// display trees: textured quads, colour rects, Spine skeletons, particle emitters and Godot-shader quads (render/canvas).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Assets, BlurFilter, Container, Graphics, Matrix, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { A, imageUrl, atlasFrame, skelSrc } from '../assets';
import { QuadBatch, bakedTexture, loadShader, plainShader, type ShaderParams } from './canvas';
import { noiseTexture } from './noise';
import { Emitter } from './particles';
import { slotMats } from './slotmats';
import { $ } from '../game';

export interface SceneData {
  root: { ctrl: boolean; a?: number[]; off?: number[]; pos?: number[]; piv: number[]; scale: number[]; rot: number };
  items: any[];
  nodes: Record<string, number[]>;
  sizes?: Record<string, number[]>;
  /** the root script's exported fields (node paths, numbers) — tools/scenes.py script_exports */
  exports?: Record<string, any>;
  /** an autoplayed AnimationPlayer (tools/scenes.py autoplay_anim) */
  anim?: { length: number; free?: number; tracks: { node: string; prop: string; times: number[]; values: any[]; discrete: boolean; sizes?: (number[] | null)[] }[] };
}
const cache = new Map<string, Promise<SceneData | null>>();
let index: Promise<string[]> | null = null;

/** res://scenes/x.tscn or scenes/x.tscn → flattened scene (null if it was not converted). */
export function loadScene(path: string): Promise<SceneData | null> {
  const rel = path.replace(/^res:\/\//, '').replace(/\.tscn$/, '');
  let p = cache.get(rel);
  if (!p) cache.set(rel, (p = fetch(`${A}scenes/${rel}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  return p;
}
/** Converted scene paths (for DirAccess listings of res://scenes/...). */
export function sceneIndex(): Promise<string[]> {
  return (index ??= fetch(`${A}scenes/index.json`).then((r) => r.json()).catch(() => []));
}

const M = (m: number[]) => new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);
function trs(x: number, y: number, rot: number, sx: number, sy: number, piv: number[]) {
  return new Matrix().translate(-piv[0], -piv[1]).scale(sx, sy).rotate(rot).translate(x + piv[0], y + piv[1]);
}
/** Where a scene's root sits inside a parent of size pw×ph (Godot anchors + offsets, or a Node2D position). */
export function rootMatrix(s: SceneData, pw: number, ph: number): Matrix {
  const r = s.root;
  if (r.a && r.off) return trs(r.a[0] * pw + r.off[0], r.a[1] * ph + r.off[1], r.rot, r.scale[0], r.scale[1], r.piv);
  const p = r.pos ?? [0, 0];
  return trs(p[0], p[1], r.rot, r.scale[0], r.scale[1], [0, 0]);
}

const texCache = new Map<string, Promise<Texture | null>>();
function texture(src: string): Promise<Texture | null> {
  let p = texCache.get(src);
  if (!p) {
    const url = imageUrl(src);
    const f = url ? null : atlasFrame(src);
    p = url
      ? Assets.load<Texture>(url).catch(() => null)
      : f
        ? Assets.load<Texture>(f.page).then((t) => new Texture({ source: t.source, frame: new Rectangle(f.x, f.y, f.w, f.h) })).catch(() => null)
        : Promise.resolve(null);
    texCache.set(src, p);
  }
  return p;
}

/** An item's texture: its image, or the NoiseTexture2D generated from the properties tools/scenes.py exported. */
const itemTexture = (it: any): Promise<Texture | null> => (it.noise ? Promise.resolve(noiseTexture(it.noise)) : texture(it.src));

function quad(it: any): Container {
  const holder = new Container();
  holder.setFromMatrix(M(it.m));
  const sp = new Sprite(Texture.EMPTY);
  holder.addChild(sp);
  if (it.color) { sp.tint = ((it.color[0] * 255) << 16) | ((it.color[1] * 255) << 8) | (it.color[2] * 255); sp.alpha = it.color[3]; }
  if (it.blend) sp.blendMode = BLEND[it.blend];
  itemTexture(it).then((t) => {
    if (!t || sp.destroyed) return;
    let tex = t;
    const k = t.width / (it.tw || t.width); // downscale factor of the web asset vs the original texture
    if (it.region) tex = new Texture({ source: t.source, frame: new Rectangle(t.frame.x + it.region[0] * k, t.frame.y + it.region[1] * k, it.region[2] * k, it.region[3] * k) });
    sp.texture = tex;
    // TextureRect stretch modes: 0 scale, 2 keep, 3 keep centred, 4/5 keep aspect (centred), 6 keep aspect covered
    let { x, y, w, h } = it;
    const tw = it.region ? it.region[2] : it.tw || w, th = it.region ? it.region[3] : it.th || h;
    if (it.stretch === 2 || it.stretch === 3) { if (it.stretch === 3) { x += (w - tw) / 2; y += (h - th) / 2; } w = tw; h = th; }
    else if (it.stretch >= 4 && it.stretch <= 6) {
      const s = it.stretch === 6 ? Math.max(w / tw, h / th) : Math.min(w / tw, h / th);
      const nw = tw * s, nh = th * s;
      if (it.stretch !== 4) { x += (w - nw) / 2; y += (h - nh) / 2; }
      w = nw; h = nh;
    }
    sp.x = it.flipH ? x + w : x; sp.y = it.flipV ? y + h : y;
    sp.width = w; sp.height = h;
    if (it.flipH) sp.scale.x *= -1;
    if (it.flipV) sp.scale.y *= -1;
  });
  return holder;
}

const BLEND: Record<string, any> = { add: 'add', mul: 'multiply', sub: 'subtract' }; // 'subtract' is registered on the GL state (stage.ts)

/** ShaderMaterial parameters: textures loaded, procedural ones rebuilt from their baked data or generated (noise). */
export async function shaderParams(params: Record<string, any> = {}): Promise<ShaderParams> {
  const out: ShaderParams = {};
  await Promise.all(Object.entries(params).map(async ([k, v]) => {
    if (v?.bake) out[k] = bakedTexture(v.bake);
    else if (v?.noise) out[k] = noiseTexture(v.noise);
    else if (v?.tex) { const t = await texture(v.tex); if (t) out[k] = t; }
    else out[k] = v;
  }));
  return out;
}
/** The translated shader for an item, the plain one when it has none, null when its shader cannot run here. */
async function itemShader(it: any) {
  if (!it.shader) return plainShader;
  return it.shader.src ? loadShader(it.shader.src) : null;
}

/** A TextureRect / Sprite2D drawn with its Godot shader (one quad). */
function shaderQuad(it: any): Container {
  const holder = new Container();
  holder.setFromMatrix(M(it.m));
  Promise.all([itemTexture(it), itemShader(it), shaderParams(it.shader?.params)]).then(([t, sh, params]) => {
    if (!t || !sh || holder.destroyed) return;
    const q = new QuadBatch(1, sh, t, params);
    q.fresh = !!it.bbc; // under a BackBufferCopy
    q.repeat(it.rep);
    const k = it.tw ? 1 / it.tw : 0, kh = it.th ? 1 / it.th : 0;
    const [u0, v0, u1, v1] = it.region ? [it.region[0] * k, it.region[1] * kh, (it.region[0] + it.region[2]) * k, (it.region[1] + it.region[3]) * kh] : [0, 0, 1, 1];
    const x0 = it.x, y0 = it.y, x1 = it.x + it.w, y1 = it.y + it.h;
    const c = it.color ?? [1, 1, 1, 1];
    q.quad(0, [x0, y0, x1, y0, x1, y1, x0, y1], it.flipH ? u1 : u0, it.flipV ? v1 : v0, it.flipH ? u0 : u1, it.flipV ? v0 : v1, c[0], c[1], c[2], c[3]);
    q.flush();
    if (it.blend) q.blendMode = BLEND[it.blend];
    holder.addChild(q);
  });
  return holder;
}

/** A card trail's CPUParticles2D in global space, emitted wherever `follow()` → [x, y, rotation, scale] is. */
export function followParticles(it: any, follow: () => number[]): { view: Container; stop: () => void } {
  const holder = new Container();
  let em: Emitter | null = null, stopped = false;
  Promise.all([itemTexture(it), itemShader(it), shaderParams(it.shader?.params)]).then(([t, sh, params]) => {
    if (!t || !sh || holder.destroyed) return;
    em = new Emitter(it, t, sh, params, true, follow);
    em.emitting = !stopped;
    if (it.blend && !it.shader) em.batch.blendMode = BLEND[it.blend];
    holder.addChild(em.batch);
  });
  return { view: holder, stop: () => { stopped = true; if (em) em.emitting = false; } };
}
export { texture as sceneTexture };

/** CPUParticles2D / GPUParticles2D. `emit` forces emitters that scripts start (VFX) on. */
export function particleItem(it: any, emit = false, onDone?: () => void): Container {
  const holder = new Container();
  holder.setFromMatrix(M(it.m));
  Promise.all([itemTexture(it), itemShader(it), shaderParams(it.shader?.params)]).then(([t, sh, params]) => {
    if (!t || !sh || holder.destroyed) { onDone?.(); return; }
    const e = new Emitter(it, t, sh, params, emit || it.emitting);
    e.batch.fresh = !!it.bbc; // under a BackBufferCopy
    e.batch.repeat(it.rep);
    (holder as any).emitter = e; // scripted VFX (render/vfx-misc) toggle Emitting / wait for Finished
    if (it.blend && !it.shader) e.batch.blendMode = BLEND[it.blend];
    holder.addChild(e.batch);
    if (onDone) { const check = setInterval(() => { if (e.done || holder.destroyed) { clearInterval(check); onDone(); } }, 250); }
  });
  return holder;
}

const spineLoads = new Map<string, Promise<boolean>>();
function spineItem(it: any, onSpine?: (sp: Spine) => void): Container {
  const holder = new Container();
  holder.setFromMatrix(M(it.m));
  const key = 'scene:' + it.spine.skel;
  let p = spineLoads.get(key);
  if (!p) {
    Assets.add({ alias: key + ':skel', ...skelSrc(it.spine.skel) });
    Assets.add({ alias: key + ':atlas', src: A + it.spine.atlas });
    spineLoads.set(key, (p = Assets.load([key + ':skel', key + ':atlas']).then(() => true).catch(() => false)));
  }
  p.then((ok) => {
    if (!ok || holder.destroyed) return;
    const sp = Spine.from({ skeleton: key + ':skel', atlas: key + ':atlas', scale: 1 });
    try { if (it.skin && sp.skeleton.data.findSkin(it.skin)) sp.skeleton.setSkinByName(it.skin); } catch { /* default skin */ }
    const names = sp.skeleton.data.animations.map((a: any) => a.name);
    const anim = names.includes(it.anim) ? it.anim : names.find((n: string) => /idle|loop/i.test(n)) ?? names[0];
    if (anim) sp.state.setAnimation(0, anim, true);
    if (it.color) sp.alpha = it.color[3];
    if (it.mats || it.slotMats) void slotMats(sp).install(it); // SpineSprite / SpineSlotNode materials (render/slotmats)
    holder.addChild(sp);
    onSpine?.(sp);
  });
  return holder;
}

function drawItem(it: any, onSpine?: (sp: Spine) => void): Container | null {
  if (it.k === 'particles') return particleItem(it);
  if (it.k === 'tex') return it.shader ? shaderQuad(it) : quad(it);
  if (it.k === 'rect') {
    const g = new Graphics().rect(it.x, it.y, it.w, it.h).fill({ color: ((it.color[0] * 255) << 16) | ((it.color[1] * 255) << 8) | (it.color[2] * 255), alpha: it.color[3] });
    g.setFromMatrix(M(it.m));
    return g;
  }
  if (it.k === 'spine' && !it.shader) return spineItem(it, onSpine);
  return null;
}

/**
 * Display tree for a scene's items, in the scene root's local space. `keep` filters by node path. clip_children:
 * items under a clipping node go into a container masked by that node's texture (drawn too unless it only clips).
 */
export function buildScene(s: SceneData, keep: (path: string) => boolean = () => true, onSpine?: (sp: Spine) => void): Container {
  const c = new Container();
  const clips = new Map<string, Container>();
  // SpineBoneNode children: drawn with their skeleton (behind or in front of it), following the bone every frame
  const followers = new Map<any, [string, boolean, Container][]>();
  // SpineSlotNode children: drawn in their slot's place (spine-pixi slot objects)
  const slotted = new Map<any, [string, Container][]>();
  for (const it of s.items) {
    if (!(it.bone || it.slot) || !keep(it.p ?? '') || it.clipOnly) continue;
    const owner = s.items.find((x) => x.k === 'spine' && it.p.startsWith(x.p + '/'));
    const d = owner && keep(owner.p) ? drawItem(it) : null;
    if (!d) continue;
    const f = new Container();
    f.addChild(d);
    if (it.slot) (slotted.get(owner) ?? (slotted.set(owner, []), slotted.get(owner)!)).push([it.slot, f]);
    else (followers.get(owner) ?? (followers.set(owner, []), followers.get(owner)!)).push([it.bone, !!it.behind, f]);
  }
  const withFollowers = (it: any) => (sp: Spine) => {
    for (const [slot, c] of slotted.get(it) ?? []) { try { sp.addSlotObject(slot, c); } catch { c.destroy({ children: true }); } }
    const fs = followers.get(it) ?? [];
    for (const [, behind, d] of fs) behind ? sp.parent?.addChildAt(d, 0) : sp.parent?.addChild(d);
    const bones = fs.map(([b, , d]) => [sp.skeleton.findBone(b), d] as const).filter(([b]) => b);
    if (bones.length) {
      const prev = sp.afterUpdateWorldTransforms;
      sp.afterUpdateWorldTransforms = (x: Spine) => {
        prev(x);
        for (const [b, f] of bones) if (!f.destroyed) f.setFromMatrix(new Matrix(b!.a, b!.c, b!.b, b!.d, b!.worldX, b!.worldY));
      };
    }
    onSpine?.(sp);
  };
  for (const it of s.items) {
    if (!keep(it.p ?? '') || it.clipOnly || it.bone || it.slot) continue;
    const d = it.k === 'spine' && !it.shader ? spineItem(it, withFollowers(it)) : drawItem(it, onSpine);
    if (!d) continue;
    d.label ||= it.p; // the node path, for code that shows / hides nodes at runtime
    if (!it.clip) { c.addChild(d); continue; }
    let g = clips.get(it.clip);
    if (!g) {
      g = new Container();
      const clipper = s.items.find((x) => x.p === it.clip && x.k === 'tex');
      if (clipper) {
        const m = quad(clipper);
        g.addChild(m);
        g.mask = m.children[0] as Sprite;
      }
      clips.set(it.clip, g);
      c.addChild(g);
    }
    g.addChild(d);
  }
  return c;
}

/**
 * A creature_visuals scene's effects around its Spine skeleton (drawn by render/stage): free items go behind or in front
 * of the skeleton by draw order, SpineBoneNode children follow their bone every frame, SpineSlotNode children are drawn
 * in the slot's place (spine-pixi slot objects). Without a skeleton (sprite-only creatures) the free items are the body.
 */
export function attachCreatureFx(root: Container, s: SceneData, sp: Spine | null) {
  const spineAt = s.items.findIndex((it) => it.k === 'spine');
  // NDevotedSculptorVfx._Ready: both emitters start off and burst once on their Spine event.
  const sculptorEvents: Record<string, string> = sp && s.items[spineAt]?.vfx?.includes('NDevotedSculptorVfx')
    ? { 'Visuals/VoiceBoneNode/VoiceParticles': 'caw', 'Visuals/AttackParticles': 'attack' } : {};
  const back = new Container(), front = new Container();
  const bones = new Map<string, Container>(), slots = new Map<string, Container>();
  s.items.forEach((it, i) => {
    if (it.k === 'spine' || it.clipOnly || ((it.bone || it.slot) && !sp)) return;
    const event = it.k === 'particles' ? sculptorEvents[it.p] : undefined;
    const d = event ? new Container() : drawItem(it);
    if (!d) return;
    if (event) sp!.state.addListener({ event: (_, ev) => {
      if (ev.data.name !== event || d.destroyed) return;
      // GPUParticles2D.Restart clears the previous burst, including one still loading its texture.
      for (const child of d.removeChildren()) child.destroy({ children: true });
      d.addChild(particleItem({ ...it, oneShot: true }, true));
    } });
    const group = (m: Map<string, Container>, k: string) => m.get(k) ?? (m.set(k, new Container()), m.get(k)!);
    if (it.slot) group(slots, it.slot).addChild(d);
    else if (it.bone) group(bones, `${it.bone}|${it.behind ? 'b' : 'f'}`).addChild(d);
    else (spineAt >= 0 && i < spineAt ? back : front).addChild(d);
  });
  root.addChildAt(back, 0);
  root.addChild(front);
  if (!sp) return;
  // bone followers live in containers carrying the skeleton's own placement, behind or above it
  const place = (c: Container) => { c.position.copyFrom(sp.position); c.scale.copyFrom(sp.scale); return c; };
  const boneBack = place(new Container()), boneFront = place(new Container());
  for (const [k, c] of bones) (k.endsWith('|b') ? boneBack : boneFront).addChild(c);
  root.addChildAt(boneBack, root.getChildIndex(sp));
  root.addChildAt(boneFront, root.getChildIndex(sp) + 1);
  for (const [slot, c] of slots) { try { sp.addSlotObject(slot, c); } catch { c.destroy({ children: true }); } }
  // SpineSprite / SpineSlotNode materials (render/slotmats)
  void slotMats(sp).install(s.items.find((it) => it.k === 'spine' && !it.slot && !it.bone));
  if (!bones.size) return;
  const follow = [...bones].map(([k, c]) => [sp.skeleton.findBone(k.split('|')[0]), c] as const).filter(([b]) => b);
  const prev = sp.afterUpdateWorldTransforms;
  sp.afterUpdateWorldTransforms = (x: Spine) => {
    prev(x);
    for (const [b, c] of follow) if (!c.destroyed) c.setFromMatrix(new Matrix(b!.a, b!.c, b!.b, b!.d, b!.worldX, b!.worldY));
  };
}

/** A scene placed full-screen (rest sites, merchant): root resolved against the 1920×1080 viewport. */
/**
 * NEventLayout's portrait: the art keep-aspect in a 2560 × 1200 rect at (−320, −55) scaled 1.04 about its centre (screen
 * (960, 545)), with the event's VFX scene (vfx/events/<id>_vfx, when there is one) at portrait-local EventModel.VfxOffset.
 */
export async function eventPortrait(path: string | null, vfx: string | null): Promise<Container | null> {
  const root = new Container();
  root.setFromMatrix(new Matrix().translate(-1280, -600).scale(1.04, 1.04).translate(960, 545));
  const [t, s] = await Promise.all([path ? texture(path) : null, vfx ? loadScene(vfx) : null]);
  if (t) {
    const k = Math.min(2560 / t.width, 1200 / t.height);
    const sp = new Sprite(t);
    sp.width = t.width * k; sp.height = t.height * k;
    sp.x = (2560 - sp.width) / 2; sp.y = (1200 - sp.height) / 2;
    root.addChild(sp);
  }
  if (s) {
    const c = buildScene(s);
    const r = s.root;
    c.setFromMatrix(new Matrix().scale(r.scale[0], r.scale[1]).rotate(r.rot).translate(268, 49));
    root.addChild(c);
  }
  return root;
}
export async function fullScreenScene(path: string, keep?: (path: string) => boolean): Promise<Container | null> {
  const s = await loadScene(path);
  if (!s) return null;
  const c = buildScene(s, keep);
  c.setFromMatrix(rootMatrix(s, 1920, 1080));
  return c;
}

/**
 * NCombatBackground: the act/encounter background scene with the chosen layer scenes attached to its Layer_0x /
 * Foreground nodes, inside BgContainer (screen centre + 23px) of a scene container scaled by the camera.
 */
export async function combatBackground(bgScene: string, layers: string[], fg: string | null, scaling: number, offset: [number, number]): Promise<Container> {
  const root = new Container();
  const cam = new Matrix().translate(-960, -540).scale(scaling, scaling).translate(960 + offset[0], 540 + offset[1]);
  const bg = await loadScene(bgScene);
  const bgC = new Container();
  const bgM = new Matrix().translate(983, 540).prepend(new Matrix()); // BgContainer origin in the scene container
  if (bg) { const m = rootMatrix(bg, 0, 0); bgM.append(m); }
  bgC.setFromMatrix(cam.clone().append(bgM));
  root.addChild(bgC);
  const attach = async (node: string, path: string) => {
    const s = await loadScene(path);
    if (!s) return;
    const c = buildScene(s);
    const nm = bg?.nodes[node] ? M(bg.nodes[node]) : new Matrix();
    c.setFromMatrix(nm.append(rootMatrix(s, 0, 0)));
    return c;
  };
  const parts = await Promise.all([...layers.map((p, i) => attach(`Layer_${String(i).padStart(2, '0')}`, p)), fg ? attach('Foreground', fg) : null]);
  for (const p of parts) if (p) bgC.addChild(p);
  if (bg) bgC.addChild(buildScene(bg)); // the background scene's own dressing (lights etc.) sits above its layers' parents
  return root;
}

/** The combat background exactly as NCombatRoom builds it: the encounter/act picks layers with a per-map-point RNG. */
export async function combatBackdropFor(G: any, cs: any, rs: any): Promise<Container | null> {
  const enc = cs?.Encounter;
  if (!enc || !rs) return null;
  const c = rs.CurrentMapCoord;
  const rng = new G.Rng().$ctor_Rng$UInt32_Int32((rs.Rng.Seed + (c ? c.row + c.col * 747 : 0)) >>> 0, 0); // NCombatRoom.GenerateBackgroundRngForCurrentPoint
  let bga: any;
  try { bga = enc.GetBackgroundAssets(rs.Act, rng); } catch (e) { console.warn('background assets', e); return null; }
  let scaling = 1, off: [number, number] = [0, 0];
  try { scaling = enc.GetCameraScaling() || 1; const o = enc.GetCameraOffset(); off = [o?.X ?? 0, o?.Y ?? 0]; } catch { /* defaults */ }
  return combatBackground(bga.BackgroundScenePath, Array.from(bga.BgLayers ?? []), bga.FgLayer ?? null, scaling, off);
}

/** Place `child` (a scene) under node `node` of `parent` (whose root sits at parentM), resolving anchors against that node's size. */
async function attachUnder(parentM: Matrix, parent: SceneData, node: string, childPath: string, keep?: (p: string) => boolean, onSpine?: (sp: Spine) => void, local?: Matrix): Promise<Container | null> {
  const s = await loadScene(childPath);
  if (!s) return null;
  const c = buildScene(s, keep, onSpine);
  const size = parent.sizes?.[node] ?? [0, 0];
  const m = parentM.clone().append(parent.nodes[node] ? M(parent.nodes[node]) : new Matrix()).append(rootMatrix(s, size[0], size[1]));
  c.setFromMatrix(local ? m.append(local) : m);
  return c;
}

/**
 * NRestSiteRoom: the act's rest-site scene in BgContainer and each player's NRestSiteCharacter at Character_N, playing
 * the act's loop (overgrowth / hive / glory) from a random time; odd players are flipped. With the fire out
 * (ExtinguishFireIfAble) the lighting is gone, the characters are DarkGray and play _tracks/light_off on track 1.
 */
const rest = { lighting: [] as Container[], spines: [] as Spine[], chars: [] as Container[], out: false };
export async function restSiteBackdrop(rs: any, fireOut = false): Promise<Container | null> {
  const room = await loadScene('scenes/rooms/rest_site_room.tscn');
  if (!room || !rs) return null;
  const roomM = rootMatrix(room, 1920, 1080);
  const root = new Container();
  Object.assign(rest, { lighting: [], spines: [], chars: [], out: false });
  const bg = await attachUnder(roomM, room, 'BgContainer', rs.Act.RestSiteBackgroundPath);
  if (bg) { root.addChild(bg); rest.lighting = bg.children.filter((d) => /^RestSiteLighting(\/|$)/.test(d.label)); }
  const anim = ['overgrowth_loop', 'hive_loop', 'glory_loop'][rs.CurrentActIndex] ?? 'overgrowth_loop';
  const onSpine = (sp: Spine) => {
    const names = sp.skeleton.data.animations.map((a: any) => a.name);
    if (names.includes(anim)) {
      const e = sp.state.setAnimation(0, anim, true);
      e.trackTime = e.animationEnd * Math.random();
    }
    rest.spines.push(sp);
    if (rest.out) hideFlameGlow(sp);
  };
  const players = Array.from(rs.Players ?? []) as any[];
  const chars = await Promise.all(players.slice(0, 4).map((p, i) =>
    attachUnder(roomM, room, `BgContainer/Character_${i + 1}`, `scenes/rest_site/characters/${p.Character.Id.Entry.toLowerCase()}_rest_site.tscn`,
      (path) => !/Reticle|ControlRoot/.test(path), onSpine, i % 2 === 1 ? new Matrix().scale(-1, 1) : undefined)));
  for (const c of chars) if (c) { rest.chars.push(c); root.addChild(c); }
  if (fireOut) extinguishRestFire();
  return root;
}
/** NRestSiteCharacter.HideFlameGlow: the "_tracks/light_off" track (looped) on track 1. */
function hideFlameGlow(sp: Spine) {
  if (!sp.destroyed && sp.skeleton.data.findAnimation('_tracks/light_off')) sp.state.setAnimation(1, '_tracks/light_off', true);
}
/** NRestSiteRoom.ExtinguishFireIfAble: the lighting hides, the characters lose the flame glow and turn DarkGray. */
export function extinguishRestFire() {
  if (rest.out) return;
  rest.out = true;
  for (const d of rest.lighting) if (!d.destroyed) d.visible = false;
  for (const sp of rest.spines) hideFlameGlow(sp);
  for (const c of rest.chars) if (!c.destroyed) c.tint = 0xa9a9a9;
}

/**
 * A merchant room's SceneContainer in draw order: BgContainer (`onBg` gets its skeletons), the characters (they belong
 * to CharacterContainer), then the other nodes that `front` keeps — MerchantButton's selection reticle under the
 * merchant's skeleton (→ `onFront`), as in the scene. `onReticle` gets the reticle (NSelectionReticle).
 */
export interface Reticle { OnSelect(): void; OnDeselect(): void }
function shopScene(s: SceneData, chars: Container[], front: (p: string) => boolean, onBg?: (sp: Spine) => void, onFront?: (sp: Spine) => void, onReticle?: (r: Reticle) => void): Container {
  const m = rootMatrix(s, 1920, 1080);
  const root = new Container();
  const RET = 'SceneContainer/MerchantButton/MerchantSelectionReticle';
  const ri = s.items.findIndex((it) => (it.p ?? '').startsWith(RET));
  const before = new Set(s.items.slice(0, Math.max(0, ri)).map((it) => it.p ?? ''));
  const kept = (p: string) => p.startsWith('SceneContainer/') && !p.startsWith('SceneContainer/BgContainer') && !/Reticle|ControllerIcon/.test(p) && front(p);
  const bg = buildScene(s, (p) => p.startsWith('SceneContainer/BgContainer'), onBg);
  const fr = new Container();
  bg.setFromMatrix(m);
  fr.setFromMatrix(m);
  fr.addChild(buildScene(s, (p) => kept(p) && before.has(p), onFront));
  if (ri >= 0 && front(RET)) fr.addChild(selectionReticle(buildScene(s, (p) => p.startsWith(RET)), s, RET, onReticle));
  fr.addChild(buildScene(s, (p) => kept(p) && !before.has(p), onFront));
  root.addChild(bg);
  for (const c of chars) root.addChild(c);
  root.addChild(fr);
  return root;
}
/**
 * NSelectionReticle on its scene items: hidden until OnSelect — opaque at once, scale 0.9 → 1 over 0.5 s (Expo Out);
 * OnDeselect fades it over 0.2 s while it grows to 1.05 (Sine Out). It scales about its centre.
 */
export function selectionReticle(c: Container, s: SceneData, path: string, onReticle?: (r: Reticle) => void): Container {
  const [w, h] = s.sizes?.[path] ?? [0, 0];
  const n = s.nodes[path] ? M(s.nodes[path]) : new Matrix();
  const mid = n.apply({ x: w / 2, y: h / 2 });
  const holder = new Container();
  holder.pivot.set(mid.x, mid.y);
  holder.position.set(mid.x, mid.y);
  holder.addChild(c);
  const st = { A: 0, S: 1 };
  let tw: any = null;
  const paint = () => { holder.alpha = st.A; holder.scale.set(st.S); };
  const run = (t: any) => { tw?.Kill(); tw = t; paint(); $.onFrame(() => { if (holder.destroyed) { t.Kill(); return false; } paint(); return t.IsValid() && tw === t; }); };
  paint();
  onReticle?.({
    OnSelect() {
      const t = new $.WebTween().SetParallel();
      t.TweenProperty(st, 'a', 1, 0.2);
      t.TweenProperty(st, 's', 1, 0.5).SetEase(1).SetTrans(5).From(0.9);
      st.A = 1; st.S = 1;
      run(t);
    },
    OnDeselect() {
      if (holder.destroyed) return;
      const t = new $.WebTween().SetParallel();
      t.TweenProperty(st, 'a', 0, 0.2).SetEase(1).SetTrans(1);
      t.TweenProperty(st, 's', 1.05, 0.2).SetEase(1).SetTrans(1);
      run(t);
    },
  });
  return holder;
}

/**
 * NMerchantRoom's SceneContainer: the shop background, the players' merchant characters (AfterRoomIsLoaded: a √n grid,
 * rows 140 px back and 50 px up, 275 px apart, back rows at half brightness; relaxed_loop from a random time), the glows,
 * the embers and the merchant (MerchantButton's skeleton, handed to `onMerchant` for its hover skin).
 */
export async function merchantBackdrop(players: any[], onMerchant: (sp: Spine) => void, onReticle?: (r: Reticle) => void): Promise<Container | null> {
  const s = await loadScene('scenes/rooms/merchant_room.tscn');
  if (!s) return null;
  const m = rootMatrix(s, 1920, 1080);
  const relaxed = (sp: Spine) => { const e = sp.state.setAnimation(0, 'relaxed_loop', true); e.trackTime = e.animationEnd * Math.random(); };
  const n = Math.ceil(Math.sqrt(players.length));
  const chars = await Promise.all(players.map(async (p, k) => {
    const i = Math.floor(k / n), j = k % n;
    const c = await attachUnder(m, s, 'SceneContainer/CharacterContainer', p.Character.MerchantAnimPath, undefined, relaxed, new Matrix().translate(-140 * i - 275 * j, -50 * i));
    if (c && i > 0) c.tint = 0x808080;
    return c;
  }));
  // MoveChild(…, 0): later characters are drawn first
  return shopScene(s, chars.reverse().filter((c): c is Container => !!c), () => true, undefined, onMerchant, onReticle);
}

/**
 * NFakeMerchant's SceneContainer: BgContainer (the bottom skeleton, the glitter through its noise shader, the fire glows
 * and square specks), the player's combat visuals (`character`, NCreatureVisuals at CharacterContainer's origin), the
 * side glows and stars, the merchant (MerchantButton's skeleton → `onMerchant`; gone with the button once he was
 * fought) and the cutter skeleton over him and the character. `rugHidden`: MegaBone.Hide (scale 0) on the bottom
 * skeleton's "rug" bone.
 */
export async function fakeMerchantBackdrop(character: Container | null, merchant: boolean, rugHidden: boolean, onMerchant: (sp: Spine) => void, onReticle?: (r: Reticle) => void): Promise<Container | null> {
  const s = await loadScene('scenes/events/custom/fake_merchant.tscn');
  if (!s) return null;
  if (character) character.setFromMatrix(rootMatrix(s, 1920, 1080).append(M(s.nodes['SceneContainer/CharacterContainer'])));
  const hideRug = (sp: Spine) => { const b = rugHidden ? sp.skeleton.findBone('rug') : null; if (b) { b.scaleX = 0; b.scaleY = 0; } };
  return shopScene(s, character ? [character] : [], (p) => merchant || !p.startsWith('SceneContainer/MerchantButton'), hideRug, onMerchant, onReticle);
}

/**
 * NTreasureRoom's scene: the black ColorRect and the act's chest skeleton (ChestVisual at (−2, 66), 0.4), frozen on its
 * opening animation (then "shine_fade") until `openChest()`. `chestSkin` swaps the stroke skin (hover), `chestAlpha` is
 * the chest's modulate while the relic collection is up, and `chestGold` fires the GoldExplosion coins.
 */
let chest: Spine | null = null, chestHolder: Container | null = null, chestRoot: Container | null = null, chestAct: any = null;
let chestOpen = false, chestGen = 0;
export function openChest() { chestOpen = true; if (chest) chest.state.timeScale = 1; }
export function chestSkin(stroke: boolean) {
  const name = stroke ? chestAct?.ChestSpineSkinNameStroke : chestAct?.ChestSpineSkinNameNormal;
  try { if (chest && name && chest.skeleton.data.findSkin(name)) { chest.skeleton.setSkinByName(name); chest.skeleton.setSlotsToSetupPose(); } } catch { /* default skin */ }
}
export function chestAlpha(a: number) { if (chestHolder) chestHolder.alpha = a; }
/** GoldExplosion: `amount` coins (coin_flip_anim 4×3) from (937, 512), bouncing (0.75) on the occluder edge at y 843. */
export async function chestGold(amount: number) {
  const room = await loadScene('scenes/rooms/treasure_room.tscn');
  const it = room?.items.find((x) => x.p === 'GoldExplosion');
  if (!it || !chestRoot || chestRoot.destroyed) return;
  const c = particleItem({ ...it, amount, floor: 843 - it.m[5], bounce: 0.75, friction: 0.5 }, true);
  c.setFromMatrix(rootMatrix(room!, 1920, 1080).append(M(it.m)));
  chestRoot.addChild(c);
}
export async function treasureBackdrop(rs: any): Promise<Container | null> {
  const gen = ++chestGen;
  chest = null; chestHolder = null; chestOpen = false; chestAct = rs?.Act;
  const room = await loadScene('scenes/rooms/treasure_room.tscn');
  const act = rs?.Act;
  if (!room || !act) return null;
  const roomM = rootMatrix(room, 1920, 1080);
  const root = new Container();
  chestRoot = root;
  const bg = buildScene(room, (p) => p === 'ColorRect');
  bg.setFromMatrix(roomM);
  root.addChild(bg);
  const base = String(act.ChestSpineResourcePath).replace(/^res:\/\//, '').replace(/_skel_data\.tres$/, '');
  const key = 'chest:' + base;
  if (!spineLoads.has(key)) {
    Assets.add({ alias: key + ':skel', ...skelSrc(`${base}.skel`) });
    Assets.add({ alias: key + ':atlas', src: `${A}${base}.atlas` });
    spineLoads.set(key, Assets.load([key + ':skel', key + ':atlas']).then(() => true).catch(() => false));
  }
  if (!(await spineLoads.get(key)) || gen !== chestGen) return root;
  const sp = Spine.from({ skeleton: key + ':skel', atlas: key + ':atlas', scale: 1 });
  sp.state.setAnimation(0, 'animation', false);
  sp.state.addAnimation(0, 'shine_fade', false, 0);
  sp.state.timeScale = chestOpen ? 1 : 0;
  const holder = new Container();
  holder.setFromMatrix(roomM.clone().append(room.nodes['Chest/ChestVisual'] ? M(room.nodes['Chest/ChestVisual']) : new Matrix()));
  holder.addChild(sp);
  root.addChild(holder);
  chest = sp; chestHolder = holder;
  chestSkin(false);
  return root;
}
/**
 * NTreasureRoomRelicHolder's rarity glow (uncommon / rare particles behind the relic) in the chest scene; `follow`
 * gives its place each frame ([x, y, alpha, scale], the relic's centre and state) or null to hide it.
 */
export async function chestRelicGlow(rarity: 'uncommon' | 'rare', follow: () => number[] | null) {
  const s = await loadScene('scenes/ui/treasure_relic_holder.tscn');
  const it = s?.items.find((x) => x.p === (rarity === 'rare' ? 'Relic/RareGlow' : 'Relic/UncommonGlow'));
  const root = chestRoot;
  if (!it || !root || root.destroyed) return;
  const c = particleItem(it);
  c.setFromMatrix(new Matrix(it.m[0], it.m[1], it.m[2], it.m[3], 0, 0));
  const g = new Container();
  g.addChild(c);
  root.addChild(g);
  const tick = () => {
    if (g.destroyed) { Ticker.shared.remove(tick); return; }
    const f = follow();
    g.visible = !!f;
    if (f) { g.position.set(f[0], f[1]); g.alpha = f[2]; g.scale.set(f[3]); }
  };
  Ticker.shared.add(tick);
}

/**
 * VfxCmd.PlayVfx / PlayNonCombatVfx: the VFX scene (res path "vfx/vfx_attack_slash" → scenes/vfx/…) under `parent`
 * with GlobalPosition = (x, y) — the scene root's own position is overridden, its rotation and scale kept (× `scale`).
 * NSpriteAnimator flipbooks, particle emitters (started, as the effects' scripts do), NVfxSpine skeletons (played once),
 * an autoplayed AnimationPlayer's texture / position tracks, and sprites. It is freed at the animation's queue_free,
 * or once its flipbooks, one-shot emitters and skeletons are done (looping parts end with it, capped at a few seconds).
 */
export async function playSpriteVfx(parent: Container, path: string, x: number, y: number, scale = 1, tint?: number[]) {
  const s = await loadScene(`scenes/${path.replace(/^res:\/\/scenes\//, '').replace(/\.tscn$/, '')}.tscn`);
  if (!s?.items.length || parent.destroyed) return;
  const root = new Container();
  root.setFromMatrix(new Matrix().scale(s.root.scale[0] * scale, s.root.scale[1] * scale).rotate(s.root.rot).translate(x, y));
  parent.addChild(root);
  let pending = 0, finished = false;
  const finish = () => { if (finished) return; finished = true; root.parent?.removeChild(root); root.destroy({ children: true }); };
  const doneOne = () => { if (--pending <= 0) finish(); };
  const byPath = new Map<string, Container>();
  for (const it of s.items) {
    if (it.clipOnly) continue;
    if (it.anim?.frames?.length) { pending++; flipbook(root, it, doneOne); continue; }
    if (it.k === 'particles') {
      // NSplashVfx and the like: the emitters' self_modulate set to a tint
      const p = tint ? { ...it, color: (it.color ?? [1, 1, 1, 1]).map((v: number, i: number) => v * (tint[i] ?? 1)) } : it;
      if (it.oneShot) pending++;
      root.addChild(particleItem(p, true, it.oneShot ? doneOne : undefined));
      continue;
    }
    if (it.k === 'spine' && !it.shader) {
      pending++;
      root.addChild(spineItem(it, (sp) => {
        const names = sp.skeleton.data.animations.map((a: any) => a.name);
        const e = sp.state.setAnimation(0, names.includes(it.anim) ? it.anim : names[0], false);
        e.listener = { complete: doneOne };
      }));
      continue;
    }
    const d = drawItem(it);
    if (d) { root.addChild(d); byPath.set(it.p, d); }
  }
  if (s.anim) playTracks(root, s, byPath, s.anim.free != null ? finish : undefined);
  setTimeout(finish, s.anim?.free != null ? s.anim.free * 1000 + 500 : pending ? 5000 : 1500);
}
/** An autoplayed AnimationPlayer: texture (Sprite2D re-centred on each frame, null hides it) and position tracks. */
function playTracks(root: Container, s: SceneData, byPath: Map<string, Container>, onFree?: () => void) {
  const anim = s.anim!;
  let t = 0;
  const applied = new Map<any, number>();
  $.onFrame((dt: number) => {
    if (root.destroyed) return false;
    t += dt;
    for (const tr of anim.tracks) {
      const holder = byPath.get(tr.node);
      if (!holder) continue;
      let k = -1;
      for (let i = 0; i < tr.times.length; i++) if (tr.times[i] <= t) k = i;
      if (k < 0 || applied.get(tr) === k) continue;
      applied.set(tr, k);
      const v = tr.values[k];
      if (tr.prop === 'position') { holder.position.set(v[0], v[1]); continue; }
      const sp = holder.children[0] as Sprite | undefined;
      if (!sp) continue;
      if (!v) { holder.visible = false; continue; }
      holder.visible = true;
      const item = s.items.find((it) => it.p === tr.node);
      const [w, h] = tr.sizes?.[k] ?? [item?.w ?? 0, item?.h ?? 0];
      const cx = (item?.x ?? 0) + (item?.w ?? 0) / 2, cy = (item?.y ?? 0) + (item?.h ?? 0) / 2;
      void texture(v).then((tex) => { if (!tex || sp.destroyed || applied.get(tr) !== k) return; sp.texture = tex; sp.x = cx - w / 2; sp.y = cy - h / 2; sp.width = w; sp.height = h; });
    }
    if (onFree && t >= anim.free!) { onFree(); return false; }
    return true;
  });
}
/** NSpriteAnimator: flip through the frames at its fps (once, or looping until the effect ends). */
async function flipbook(root: Container, it: any, done: () => void) {
  const frames = (await Promise.all(it.anim.frames.map((f: string) => texture(f)))).filter(Boolean) as Texture[];
  if (root.destroyed) return; // the stage went away while frames loaded
  if (!frames.length) { done(); return; }
  const holder = new Container();
  holder.setFromMatrix(M(it.m));
  if (it.anim.rot) holder.rotation += ((it.anim.rot[0] + Math.random() * (it.anim.rot[1] - it.anim.rot[0])) * Math.PI) / 180;
  const sp = new Sprite(frames[0]);
  sp.x = it.x; sp.y = it.y; sp.width = it.w; sp.height = it.h;
  if (it.blend) sp.blendMode = BLEND[it.blend];
  if (it.color) { sp.tint = ((it.color[0] * 255) << 16) | ((it.color[1] * 255) << 8) | (it.color[2] * 255); sp.alpha = it.color[3]; }
  holder.addChild(sp);
  root.addChild(holder);
  let i = 0;
  const timer = setInterval(() => {
    if (sp.destroyed) { clearInterval(timer); return; }
    i++;
    if (i >= frames.length && !it.anim.loop) { clearInterval(timer); done(); return; }
    sp.texture = frames[i % frames.length];
    sp.width = it.w; sp.height = it.h;
  }, Math.round(1000 / (it.anim.fps || 15)));
  if (it.anim.loop) setTimeout(() => { clearInterval(timer); done(); }, 1500);
}

// ------------------------------------------------------------------ main menu
const menu = { root: null as Container | null, bg: null as Container | null, logo: null as Container | null, dim: null as Graphics | null, blur: null as BlurFilter | null, cs: null as Container | null, csGen: 0 };
/**
 * NMainMenu's backdrop: MainMenuBg (its Rainbow only in June, NPrideRainbow) with the Logo apart for HideLogo /
 * ShowLogo, the BlurBackstop over them (dark_blur: the screen's mip lod 0 → 3 mixed 0 → 0.7 towards black), and
 * NCharacterSelectScreen's AnimatedBg above (see charSelectBg).
 */
export async function mainMenuBackdrop(): Promise<Container | null> {
  const s = await loadScene('scenes/backgrounds/main_menu_bg.tscn');
  if (!s) return null;
  const root = new Container(), bg = new Container();
  const logoPath = 'BgContainer/Control/Logo';
  const june = new Date().getMonth() === 5;
  const main = buildScene(s, (p) => !p.startsWith(logoPath) && (june || p !== 'BgContainer/Rainbow'));
  const logo = buildScene(s, (p) => p.startsWith(logoPath));
  main.setFromMatrix(rootMatrix(s, 1920, 1080));
  logo.setFromMatrix(rootMatrix(s, 1920, 1080));
  bg.addChild(main, logo);
  const dim = new Graphics().rect(0, 0, 1920, 1080).fill(0x000000);
  const cs = new Container();
  root.addChild(bg, dim, cs);
  Object.assign(menu, { root, bg, logo, dim, cs, blur: new BlurFilter({ strength: 0, quality: 3 }) });
  setMenuBlur(menuBlurK);
  setLogoAlpha(logoA);
  return root;
}
let menuBlurK = 0, logoA = 1;
/** BlurBackstop's shader parameters at `k` (0 → 1): lod 3·k, mix 0.7·k. */
export function setMenuBlur(k: number) {
  menuBlurK = k;
  if (!menu.bg || menu.bg.destroyed) return;
  menu.dim!.alpha = 0.7 * k;
  menu.blur!.strength = 8 * k;
  menu.bg.filters = k > 0 ? [menu.blur!] : [];
}
export function setLogoAlpha(a: number) { logoA = a; if (menu.logo && !menu.logo.destroyed) menu.logo.alpha = a; }

/**
 * NCharacterSelectScreen's AnimatedBg (2560 × 1200 at (−388, −80), scale 1.1 about its centre) with the character's
 * char_select_bg scene, or nothing (a locked character: the blurred main menu shows). The random character's
 * GradientTexture2D (under the water-reflection shader) is drawn as a plain linear gradient.
 */
export async function charSelectBg(id: string | null) {
  const gen = ++menu.csGen;
  const cs = menu.cs;
  regent = null;
  if (!cs || cs.destroyed) return;
  for (const c of cs.removeChildren()) c.destroy({ children: true });
  menu.bg!.visible = true;
  if (!id) return;
  const s = await loadScene(`scenes/screens/char_select/char_select_bg_${id}.tscn`);
  if (!s || gen !== menu.csGen || cs.destroyed) return;
  // the scene covers the screen: the main menu under it stops drawing once the skeleton is up
  const covered = () => { if (gen === menu.csGen && menu.bg && !menu.bg.destroyed) menu.bg.visible = false; };
  const c = buildScene(s, undefined, (sp) => { covered(); if (id === 'regent' && gen === menu.csGen) regent = { sp, m: c.localTransform.clone() }; });
  if (id === 'random_character') { c.addChildAt(randomGradient(), 0); covered(); }
  c.setFromMatrix(trs(-388, -80, 0, 1.1, 1.1, [1280, 600]).append(rootMatrix(s, 2560, 1200)));
  cs.addChild(c);
  const r = regent as { sp: Spine; m: Matrix } | null; // set by the spine callback, possibly synchronously
  if (r) r.m = c.localTransform.clone();
}
/**
 * NRegentCharacterSelectBg: hovering a constellation's Control swaps the skeleton's skin (and back to "normal"). The
 * code asks for "amongus constellation", which the skeleton spells "amogus": FindSkin gives null, as in the game.
 */
let regent: { sp: Spine; m: Matrix } | null = null;
const REGENT_ZONES: [string, number, number, number, number][] = [
  ['spheric guardian constellation', 825, 70, 1025, 256], ['deca outline', 172, 74, 509, 360], ['sentry constellation', -136, 497, 63, 898],
  ['snecko constellation', 348, 675, 671, 989], ['cultist constellation', 1794, 403, 2062, 646], ['shapes constellation', 1930, 839, 2135, 1032],
  ['amongus constellation', -170, 9, 35, 202],
];
/** The Regent background's hover Controls in screen space (null while another background is up). */
export function regentZones(): { skin: string; x: number; y: number; w: number; h: number }[] | null {
  const r = regent;
  if (!r || r.sp.destroyed) return null;
  return REGENT_ZONES.map(([skin, l, t, rr, b]) => {
    const p = r.m.apply({ x: l, y: t }), q = r.m.apply({ x: rr, y: b });
    return { skin, x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y };
  });
}
export function regentSkin(name: string) {
  const sk = regent?.sp.destroyed ? null : regent?.sp.skeleton;
  if (!sk) return;
  sk.setSkin(sk.data.findSkin(name) as any);
  sk.setSlotsToSetupPose();
}
function randomGradient() {
  const cv = document.createElement('canvas');
  cv.width = 264; cv.height = 124;
  const g = cv.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0.747 * 124, 0.995 * 264, 0.234 * 124);
  for (const [o, c] of [[0, '#9F0000'], [0.086, '#996203'], [0.135, '#7E7E00'], [0.278, '#0D5A00'], [0.515, '#001E23'], [0.849, '#004A95'], [1, '#3600DD']] as [number, string][]) lg.addColorStop(o, c);
  g.fillStyle = lg;
  g.fillRect(0, 0, 264, 124);
  const sp = new Sprite(Texture.from(cv));
  sp.position.set(-437, -107);
  sp.width = 2634; sp.height = 1236;
  return sp;
}
