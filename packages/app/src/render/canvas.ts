// Godot canvas_item rendering pieces Pixi lacks: a batch of quads with per-vertex colour and INSTANCE_CUSTOM (particles,
// shader-drawn sprites) and a translator from Godot's shading language to GLSL ES 3.00 for those quads. Screen reads
// (hint_screen_texture, SCREEN_UV) see a copy of what was drawn before the item in its canvas, as Godot's back buffer.
// Shaders that do not compile are reported as unsupported and their items are not drawn.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer, BufferImageSource, BufferUsage, Geometry, GlProgram, Mesh, RenderContainer, Shader, Texture, TextureSource, Ticker, UniformGroup, type Renderer } from 'pixi.js';
import { A } from '../assets';
import { getApp } from './stage';
import { repeating } from './noise';

// ------------------------------------------------------------------ animation clock
/** Per-frame callbacks for particles and shader TIME; each returns false once its display object is gone. */
const tickers = new Set<(dt: number) => boolean>();
let hooked = false;
export function animate(fn: (dt: number) => boolean) {
  tickers.add(fn);
  if (!hooked) {
    hooked = true;
    // the app's ticker, so SettingsSave.FpsLimit (and software rendering's 30 fps) bound this work too
    getApp().then((a) => a.ticker.add((t: Ticker) => {
      const dt = Math.min(t.deltaMS / 1000, 0.1);
      shaderTime.t += dt;
      for (const f of tickers) if (!f(dt)) tickers.delete(f);
    }));
  }
}
/** Godot's TIME for shaders. */
export const shaderTime = { t: 0 };

// ------------------------------------------------------------------ shader translation
const VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition; in vec2 aUV; in vec4 aColor; in vec4 aCustom;
out vec2 vUV; out vec4 vColor; out vec4 vCustom; out vec2 vPos;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV; vColor = aColor; vCustom = aCustom; vPos = aPosition;
}`;
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV; in vec4 vColor; in vec4 vCustom; in vec2 vPos;
out vec4 fragColor;
uniform vec4 uColor;
uniform float TIME;
uniform sampler2D TEXTURE; uniform vec4 TEXTURE_frame; uniform int TEXTURE_rep;
uniform vec2 TEXTURE_PIXEL_SIZE;
vec2 UV; vec4 COLOR; vec2 VERTEX; vec4 INSTANCE_CUSTOM; float POINT_SIZE;
const mat4 MODEL_MATRIX = mat4(1.0); const mat4 CANVAS_MATRIX = mat4(1.0); const mat4 SCREEN_MATRIX = mat4(1.0);
const int INSTANCE_ID = 0; const int VERTEX_ID = 0; const bool AT_LIGHT_PASS = false;
const float PI = 3.14159265359; const float TAU = 6.28318530718; const float E = 2.71828182846;
#define FRAGCOORD gl_FragCoord
#define fma(a, b, c) ((a) * (b) + (c))
// textures are premultiplied on the GPU; Godot shaders read straight alpha. Atlas frames and repeat (1) / mirrored
// repeat (2) are emulated.
vec2 _gd_wrap(int rep, vec2 uv) { return rep == 1 ? fract(uv) : rep == 2 ? 1.0 - abs(mod(uv, 2.0) - 1.0) : clamp(uv, 0.0, 1.0); }
vec4 _gd_tex(sampler2D s, vec4 f, int rep, vec2 uv) {
  vec2 u = _gd_wrap(rep, uv);
  vec4 c = texture(s, f.xy + u * f.zw);
  return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}
vec4 _gd_texLod(sampler2D s, vec4 f, int rep, vec2 uv, float lod) { return _gd_tex(s, f, rep, uv); }
// blend_premul_alpha shaders read TEXTURE as stored (premultiplied), as Godot does
vec4 _gd_texRaw(sampler2D s, vec4 f, int rep, vec2 uv) { return texture(s, f.xy + _gd_wrap(rep, uv) * f.zw); }
// the screen: the render target's pixel size and whether its rows run bottom-up (the canvas); SCREEN_UV is top-down.
// The back buffer holds premultiplied colour; a screen read gives it straight, so writing it back is exact.
uniform vec3 _gd_scr_info; uniform sampler2D _gd_screen;
vec2 SCREEN_UV;
#define SCREEN_PIXEL_SIZE (1.0 / _gd_scr_info.xy)
vec4 _gd_scr(vec2 uv) { vec4 c = texture(_gd_screen, vec2(uv.x, _gd_scr_info.z > 0.5 ? 1.0 - uv.y : uv.y)); return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 _gd_scrLod(vec2 uv, float lod) { return _gd_scr(uv); }
`;
const UNSUPPORTED = /NORMAL_TEXTURE|SPECULAR|LIGHT_|#include|global\s+uniform|textureSize|texelFetch/;
const TYPES: Record<string, string> = { float: 'f32', int: 'i32', bool: 'i32', vec2: 'vec2<f32>', vec3: 'vec3<f32>', vec4: 'vec4<f32>', ivec2: 'vec2<i32>', mat4: 'mat4x4<f32>', mat3: 'mat3x3<f32>' };

export interface Uniform { name: string; type: string; def: number[] | null; repeat: boolean; white: boolean; size?: number }
/** `screen`: reads the back buffer (hint_screen_texture); `screenUV`: needs the screen's size (SCREEN_UV, a screen read). */
export interface GodotShader { fragment: string; blend: 'normal' | 'add' | 'subtract' | 'multiply'; premul: boolean; uniforms: Uniform[]; usesTime: boolean; screen: boolean; screenUV: boolean }

function body(src: string, name: string): { at: number; end: number; text: string } | null {
  const m = new RegExp(`void\\s+${name}\\s*\\(\\s*\\)\\s*\\{`).exec(src);
  if (!m) return null;
  let depth = 1, i = m.index + m[0].length;
  for (; i < src.length && depth; i++) depth += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0;
  return { at: m.index, end: i, text: src.slice(m.index + m[0].length, i - 1) };
}
// constructor names first: the 2 of vec2(0.0, 1.0) is not a component
const nums = (s: string | undefined) => (s ? (s.replace(/\b[a-z_]\w*/gi, '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number) : null);

/** Godot shading language (canvas_item) → a fragment shader for QuadBatch; null when it needs what we cannot give. */
export function translate(code: string, floatLiterals: boolean | 'cmp' = false): GodotShader | null {
  let s = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (UNSUPPORTED.test(s)) return null;
  const mode = /render_mode\s+([^;]*);/.exec(s)?.[1] ?? '';
  s = s.replace(/shader_type\s+\w+\s*;/, '').replace(/render_mode\s+[^;]*;/, '');
  const uniforms: Uniform[] = [];
  // array sizes may use the shader's integer constants (uniform vec3 fades[gridSize * gridSize])
  const consts: Record<string, number> = {};
  for (const m of s.matchAll(/const\s+int\s+(\w+)\s*=\s*(\d+)\s*;/g)) consts[m[1]] = +m[2];
  const arraySize = (e: string) => {
    const x = e.replace(/\w+/g, (w) => String(consts[w] ?? w));
    return /^[\d\s*+\-/()]+$/.test(x) ? Math.floor(Function(`return (${x})`)()) : NaN;
  };
  const screens: string[] = [];
  let screenMips = false;
  s = s.replace(/(?:instance\s+)?uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(\w+)\s+(\w+)\s*(?:\[([^\]]+)\])?\s*(?::\s*([^=;]+))?(?:=\s*([^;]+))?;/g, (_m, type, name, dim, hints = '', def) => {
    // hint_screen_texture: the back buffer, not a material parameter
    if (/hint_screen_texture/.test(hints)) { screens.push(name); screenMips ||= /mipmap/.test(hints); return ''; }
    const size = dim ? arraySize(dim) : undefined;
    uniforms.push({ name, type, def: type === 'bool' ? (def?.trim() === 'true' ? [1] : [0]) : nums(def), repeat: /repeat_enable/.test(hints), white: !/hint_default_(black|transparent)/.test(hints), size });
    return type === 'sampler2D' ? `uniform sampler2D ${name}; uniform vec4 ${name}_frame; uniform int ${name}_rep;` : `uniform ${type} ${name}${size ? `[${size}]` : ''};`;
  });
  s = s.replace(/varying\s+(?:flat\s+|smooth\s+)?((?:lowp\s+|mediump\s+|highp\s+)?\w+\s+\w+(?:\[\d+\])?)\s*;/g, '$1;');
  const vert = body(s, 'vertex'), frag = body(s, 'fragment');
  if (/void\s+light\s*\(/.test(s)) { const l = body(s, 'light'); if (l) s = s.slice(0, l.at) + s.slice(l.end); }
  s = s.replace(/void\s+vertex\s*\(\s*\)/, 'void _gd_vertex()').replace(/void\s+fragment\s*\(\s*\)/, 'void _gd_fragment()');
  for (const n of screens) s = s.replace(new RegExp(`\\btexture\\(\\s*${n}\\s*,`, 'g'), '_gd_scr(').replace(new RegExp(`\\btextureLod\\(\\s*${n}\\s*,`, 'g'), '_gd_scrLod(');
  // ponytail: the back buffer has no mip chain (Godot blurs one for mipmap-filtered screen textures): texture() at the
  // screen's own scale reads level 0 either way (the sand fall / water reflection offsets can tip Godot a level higher
  // where they change fast); an explicit level cannot (dark_blur's bias form fails to compile), so it is unsupported
  if (screenMips && s.includes('_gd_scrLod(')) return null;
  s = s.replace(/\btexture\(\s*(\w+)\s*,/g, '_gd_tex($1, $1_frame, $1_rep,').replace(/\btextureLod\(\s*(\w+)\s*,/g, '_gd_texLod($1, $1_frame, $1_rep,');
  // GLSL ES has no implicit int → float; Godot accepts some integer literals in float expressions. Second attempt only;
  // the third also leaves literals in comparisons alone (int counters and uniforms: `if (x == 0)`, `if (outerCircle < 0)`).
  if (floatLiterals) {
    const lit = floatLiterals === 'cmp' ? /((?:==|!=|<=|>=|<|>)\s*)?(?<![\w.[])(\d+)(?![\w.\]])/g : /()(?<![\w.[])(\d+)(?![\w.\]])/g;
    s = s.split('\n').map((l) => (/\bint\b|ivec|for\s*\(/.test(l) ? l : l.replace(lit, (m, cmp, d) => (cmp ? m : d + '.0')))).join('\n');
  }
  const premul = /blend_premul_alpha/.test(mode);
  if (premul) s = s.replace(/_gd_tex\(TEXTURE,/g, '_gd_texRaw(TEXTURE,');
  const screen = screens.length > 0, screenUV = screen || /\bSCREEN_(UV|PIXEL_SIZE)\b/.test(s);
  const fragment = `${PRELUDE}${s}
void main() {
  UV = vUV; COLOR = vColor; VERTEX = vPos; INSTANCE_CUSTOM = vCustom; POINT_SIZE = 1.0;
  ${screenUV ? 'SCREEN_UV = vec2(gl_FragCoord.x, _gd_scr_info.z > 0.5 ? _gd_scr_info.y - gl_FragCoord.y : gl_FragCoord.y) / _gd_scr_info.xy;' : ''}
  ${vert ? '_gd_vertex();' : ''}
  COLOR = _gd_tex(TEXTURE, TEXTURE_frame, TEXTURE_rep, UV) * COLOR;
  ${frag ? '_gd_fragment();' : ''}
  vec4 c = ${premul ? 'COLOR' : 'vec4(COLOR.rgb * COLOR.a, COLOR.a)'};
  fragColor = c * uColor;
}`;
  const blend = /blend_add/.test(mode) ? 'add' : /blend_sub/.test(mode) ? 'subtract' : /blend_mul/.test(mode) ? 'multiply' : 'normal';
  return { fragment, blend, premul, uniforms, usesTime: /\bTIME\b/.test(s), screen, screenUV };
}

/** Compiles a program once on a private WebGL2 context: Pixi would only log a failure at draw time, every frame. */
let testGl: WebGL2RenderingContext | null | undefined;
function compiles(fragment: string): boolean {
  if (testGl === undefined) testGl = document.createElement('canvas').getContext('webgl2');
  const gl = testGl;
  if (!gl) return false;
  const sh = (type: number, src: string) => { const x = gl.createShader(type)!; gl.shaderSource(x, src); gl.compileShader(x); return x; };
  const v = sh(gl.VERTEX_SHADER, VERTEX), f = sh(gl.FRAGMENT_SHADER, fragment);
  const p = gl.createProgram()!;
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  const ok = !!gl.getProgramParameter(p, gl.LINK_STATUS);
  if (!ok) console.debug('[shader]', gl.getShaderInfoLog(f));
  gl.deleteProgram(p); gl.deleteShader(v); gl.deleteShader(f);
  return ok;
}

const shaderCache = new Map<string, Promise<GodotShader | null>>();
/** assets/shaders/<path>.gdshader → translated shader (null: unsupported). */
export function loadShader(src: string): Promise<GodotShader | null> {
  const rel = src.replace(/^res:\/\//, '').replace(/\.(tres|gdshader)$/, '.gdshader');
  let p = shaderCache.get(rel);
  if (!p) {
    p = fetch(A + 'shaders/' + rel).then((r) => (r.ok ? r.text() : '')).then((code) => {
      if (!code) return null;
      for (const floats of [false, true, 'cmp'] as const) {
        const t = translate(code, floats);
        if (!t) return null;
        if (compiles(t.fragment)) return t;
      }
      console.debug('[shader] unsupported', rel);
      return null;
    }).catch(() => null);
    shaderCache.set(rel, p);
  }
  return p;
}
/** The plain pass-through shader (texture × vertex colour). */
export const plainShader: GodotShader = translate('shader_type canvas_item;')!;

// ------------------------------------------------------------------ textures for shader samplers
const white = Texture.WHITE;
/** Normalized frame (x, y, w, h) of a texture inside its source (atlas frames). */
export function frameOf(t: Texture): Float32Array {
  const s = t.source;
  return new Float32Array([t.frame.x / s.width, t.frame.y / s.height, t.frame.width / s.width, t.frame.height / s.height]);
}
/** Float data baked by tools/scenes.py for procedural textures (CurveXYZTexture, GradientTexture1D). */
export function bakedTexture(b: { w: number; rgba: number[] }): Texture {
  const src = new BufferImageSource({ resource: new Float32Array(b.rgba), width: b.w, height: 1, format: 'rgba32float', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' });
  return new Texture({ source: src });
}

// ------------------------------------------------------------------ the back buffer (hint_screen_texture)
/**
 * RendererCanvasRenderRD's back buffer, per renderer (each canvas has its own GL context): the render target is copied
 * before the first screen-reading item of a render draws, and later ones reuse that copy (material_screen_texture_cached)
 * unless they sit under a BackBufferCopy, which copies again (`fresh`).
 * ponytail: always the whole target (a BackBufferCopy rect copies less; reads outside it are undefined in Godot anyway).
 */
const backs = new WeakMap<Renderer, { src: TextureSource; tex: Texture; target: unknown }>();
function backBuffer(r: Renderer) {
  let b = backs.get(r);
  if (!b) {
    const src = new TextureSource({ width: 1, height: 1, resolution: 1, scaleMode: 'linear', addressMode: 'clamp-to-edge' });
    backs.set(r, (b = { src, tex: new Texture({ source: src }), target: null }));
    const bb = b;
    r.runners.prerender.add({ prerender: () => { bb.target = null; } });
  }
  return b;
}

// ------------------------------------------------------------------ quad batch
export interface ShaderParams { [name: string]: number | boolean | number[] | Texture }
/**
 * N quads drawn in one call with a (translated) Godot shader. Callers write corners/uv/colour/custom per quad with
 * `quad()` and then `flush()`; unused quads collapse to nothing.
 */
export class QuadBatch extends Mesh<Geometry, Shader> {
  pos: Float32Array; uv: Float32Array; col: Float32Array; cus: Float32Array;
  private bufs: Buffer[];
  group: UniformGroup;
  constructor(public n: number, sh: GodotShader, tex: Texture, params: ShaderParams = {}) {
    const pos = new Float32Array(n * 8), uv = new Float32Array(n * 8), col = new Float32Array(n * 16), cus = new Float32Array(n * 16);
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    const buf = (data: Float32Array) => new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const bufs = [buf(pos), buf(uv), buf(col), buf(cus)];
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: bufs[0], format: 'float32x2' }, aUV: { buffer: bufs[1], format: 'float32x2' }, aColor: { buffer: bufs[2], format: 'float32x4' }, aCustom: { buffer: bufs[3], format: 'float32x4' } },
      indexBuffer: new Buffer({ data: idx, usage: BufferUsage.INDEX }),
    });
    const u: Record<string, any> = {
      TIME: { value: shaderTime.t, type: 'f32' }, TEXTURE_frame: { value: frameOf(tex), type: 'vec4<f32>' }, TEXTURE_rep: { value: 0, type: 'i32' },
      TEXTURE_PIXEL_SIZE: { value: new Float32Array([1 / (tex.frame.width || 1), 1 / (tex.frame.height || 1)]), type: 'vec2<f32>' },
    };
    const resources: Record<string, any> = { TEXTURE: tex.source };
    if (sh.screenUV) u._gd_scr_info = { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' };
    if (sh.screen) resources._gd_screen = white.source; // the renderer's back buffer, bound before each draw
    for (const un of sh.uniforms) {
      const v = params[un.name];
      if (un.type === 'sampler2D') {
        const t = v instanceof Texture ? v : white;
        resources[un.name] = (un.repeat ? repeating(t) : t).source; // generated noise wraps in hardware too
        u[un.name + '_frame'] = { value: frameOf(t), type: 'vec4<f32>' };
        u[un.name + '_rep'] = { value: un.repeat ? 1 : 0, type: 'i32' };
        continue;
      }
      const type = TYPES[un.type];
      if (!type) continue;
      if (un.size) {
        // uniform arrays: a flat list of components, zero-filled
        const n = { f32: 1, i32: 1, 'vec2<f32>': 2, 'vec3<f32>': 3, 'vec4<f32>': 4 }[type as 'f32'] ?? 1;
        const flat = new (type.includes('i32') ? Int32Array : Float32Array)(un.size * n);
        flat.set(((v ?? un.def ?? []) as number[]).slice(0, flat.length));
        u[un.name] = { value: flat, type, size: un.size };
        continue;
      }
      const raw = v ?? un.def ?? [];
      let arr = (typeof raw === 'boolean' ? [raw ? 1 : 0] : typeof raw === 'number' ? [raw] : (raw as number[])).slice();
      const size = { f32: 1, i32: 1, 'vec2<f32>': 2, 'vec3<f32>': 3, 'vec4<f32>': 4, 'vec2<i32>': 2, 'mat4x4<f32>': 16, 'mat3x3<f32>': 9 }[type]!;
      if (un.type.startsWith('mat') && arr.length < size) { const n = Math.sqrt(size); arr = Array.from({ length: size }, (_, k) => (k % (n + 1) === 0 ? 1 : 0)); }
      if (un.type === 'vec4' && arr.length === 3) arr.push(1); // Color(r, g, b)
      while (arr.length < size) arr.push(0);
      u[un.name] = { value: size === 1 ? arr[0] : type.includes('i32') ? new Int32Array(arr.slice(0, size)) : new Float32Array(arr.slice(0, size)), type };
    }
    const group = new UniformGroup(u);
    const shader = new Shader({ glProgram: GlProgram.from({ vertex: VERTEX, fragment: sh.fragment, name: 'godot-canvas' }), resources: { ...resources, gd: group } });
    super({ geometry, shader });
    this.pos = pos; this.uv = uv; this.col = col; this.cus = cus; this.bufs = bufs; this.group = group; this.tex = tex;
    this.blendMode = sh.blend;
    if (sh.usesTime) animate(() => { if (this.destroyed) return false; group.uniforms.TIME = shaderTime.t; group.update(); return true; });
    if (sh.screenUV) {
      // runs in draw order right before the batch (it follows the batch into whatever container takes it)
      const pre = (this.pre = new RenderContainer((r) => this.beforeDraw(r, sh.screen)));
      this.on('added', (p) => p.addChildAt(pre, p.getChildIndex(this)));
      this.on('removed', () => pre.parent?.removeChild(pre));
    }
  }
  /** Under a BackBufferCopy: copy the screen afresh rather than reuse this render's copy. */
  fresh = false;
  private tex: Texture;
  /** CanvasItem.texture_repeat for TEXTURE (tools/scenes.py `rep`): 1 enabled, 2 mirror; unset: disabled. */
  repeat(mode?: number) {
    if (!mode) return;
    this.group.uniforms.TEXTURE_rep = mode;
    this.group.update();
    if (mode === 1) this.shader!.resources.TEXTURE = repeating(this.tex).source;
  }
  private pre: RenderContainer | null = null;
  /** The render target's size and orientation for SCREEN_UV and, for screen reads, the back buffer. */
  private beforeDraw(r: Renderer, read: boolean) {
    const rt: any = r.renderTarget.renderTarget;
    if (!rt || this.destroyed) return;
    const w = rt.pixelWidth, h = rt.pixelHeight, info = this.group.uniforms._gd_scr_info as Float32Array;
    info[0] = w; info[1] = h; info[2] = !rt.isRoot !== !!rt.flipY ? 0 : 1; // the canvas itself is drawn bottom-up
    this.group.update();
    if (!read) return;
    const b = backBuffer(r);
    if (b.target !== rt || this.fresh) {
      if (b.src.pixelWidth !== w || b.src.pixelHeight !== h) b.src.resize(w, h, 1);
      r.renderTarget.copyToTexture(rt, b.tex, { x: 0, y: 0 }, { width: w, height: h }, { x: 0, y: 0 });
      b.target = rt;
    }
    this.shader!.resources._gd_screen = b.src;
  }
  /** Mesh.destroy leaves the shader (and its texture bindings) and the vertex buffers alive: both are ours alone. */
  override destroy(o?: any) {
    const sh = this.shader, g = this.geometry;
    this.pre?.destroy();
    super.destroy(o);
    sh?.destroy();
    g?.destroy(true);
  }
  /** Quad i from four corners (clockwise from top-left), its uv rect, straight RGBA colour and INSTANCE_CUSTOM. */
  quad(i: number, c: number[], u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number, cu?: number[]) {
    this.pos.set(c, i * 8);
    this.uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    for (let k = 0; k < 4; k++) { this.col.set([r, g, b, a], i * 16 + k * 4); if (cu) this.cus.set(cu, i * 16 + k * 4); }
  }
  hide(i: number) { this.pos.fill(0, i * 8, i * 8 + 8); }
  flush() { for (const b of this.bufs) b.update(); }
}
