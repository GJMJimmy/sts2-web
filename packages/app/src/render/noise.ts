// Godot 4's FastNoiseLite resource and NoiseTexture2D (modules/noise: fastnoise_lite.cpp, noise.cpp,
// noise_texture_2d.cpp) on Auburn's FastNoiseLite JS port, the library Godot wraps. tools/scenes.py exports each
// NoiseTexture2D as its properties (Godot names); omitted properties take Godot's defaults here too.
// ponytail: the JS port computes in doubles where Godot's C++ uses floats; results are rounded to float32 where Godot
// stores them, so a byte can still differ where a value sits on a quantization edge.
import FastNoiseLite from 'fastnoise-lite';
import { BufferImageSource, Texture } from 'pixi.js';

/** FastNoiseLite's properties and Godot's defaults (fastnoise_lite.h). */
const FNL = {
  noise_type: 1, seed: 0, frequency: 0.01, offset: [0, 0, 0],
  fractal_type: 1, fractal_octaves: 5, fractal_lacunarity: 2, fractal_gain: 0.5, fractal_weighted_strength: 0, fractal_ping_pong_strength: 2,
  cellular_distance_function: 0, cellular_jitter: 1, cellular_return_type: 1, domain_warp_enabled: false,
};
/** NoiseTexture2D's properties and defaults (noise_texture_2d.h). */
const TEX = { width: 512, height: 512, invert: false, in_3d_space: false, seamless: false, seamless_blend_skirt: 0.1, as_normal_map: false, bump_strength: 8, normalize: true };
export type NoiseParams = Partial<typeof FNL>;
export interface Ramp { offsets: number[]; colors: number[][]; interpolation_mode?: number; interpolation_color_space?: number }
export type NoiseTextureDesc = Partial<typeof TEX> & { color_ramp?: Ramp | null; noise?: NoiseParams | null };

// Godot's enums in order → the port's names (fastnoise_lite.h casts them straight to the library's enums)
const NOISE = ['OpenSimplex2', 'OpenSimplex2S', 'Cellular', 'Perlin', 'ValueCubic', 'Value'];
const FRACTAL = ['None', 'FBm', 'Ridged', 'PingPong'];
const DISTANCE = ['Euclidean', 'EuclideanSq', 'Manhattan', 'Hybrid'];
const RETURN = ['CellValue', 'Distance', 'Distance2', 'Distance2Add', 'Distance2Sub', 'Distance2Mul', 'Distance2Div'];
const F = Math.fround;

/**
 * A FastNoiseLite resource: get_noise_2d / get_noise_3d (the offset added first; GetNoise1D(x) is get2d(x, 0)).
 * ponytail: domain warp is not applied — the port's DomainWrap only takes its private Vector2/3 class; no game resource
 * enables it.
 */
export function godotNoise(params: NoiseParams = {}) {
  const p = { ...FNL, ...params };
  const n = new FastNoiseLite(p.seed);
  n.SetNoiseType(NOISE[p.noise_type]);
  n.SetFrequency(F(p.frequency)); // the resource's floats, as Godot stores them
  n.SetFractalType(FRACTAL[p.fractal_type]);
  n.SetFractalOctaves(p.fractal_octaves);
  n.SetFractalLacunarity(F(p.fractal_lacunarity));
  n.SetFractalGain(F(p.fractal_gain));
  n.SetFractalWeightedStrength(F(p.fractal_weighted_strength));
  n.SetFractalPingPongStrength(F(p.fractal_ping_pong_strength));
  n.SetCellularDistanceFunction(DISTANCE[p.cellular_distance_function]);
  n.SetCellularReturnType(RETURN[p.cellular_return_type]);
  n.SetCellularJitter(F(p.cellular_jitter));
  const [ox, oy, oz] = p.offset.map(F);
  return {
    get2d: (x: number, y: number) => F(n.GetNoise(F(x + ox), F(y + oy))),
    get3d: (x: number, y: number, z: number) => F(n.GetNoise(F(x + ox), F(y + oy), F(z + oz))),
  };
}

/** Noise::_get_image: `depth` L8 layers, normalized to the min..max of all of them or mapped from −1..1. */
function getImage(n: ReturnType<typeof godotNoise>, w: number, h: number, depth: number, invert: boolean, in3d: boolean, normalize: boolean): Uint8Array<ArrayBuffer>[] {
  const v = new Float32Array(w * h * depth);
  for (let d = 0, i = 0; d < depth; d++) {
    if (d && !in3d) { v.copyWithin(i, 0, w * h); i += w * h; continue; } // get_noise_2d ignores the layer
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[i++] = in3d ? n.get3d(x, y, d) : n.get2d(x, y);
  }
  let lo = 3.4028234663852886e38, hi = -lo;
  if (normalize) for (const x of v) { if (x > hi) hi = x; if (x < lo) lo = x; }
  const range = F(hi - lo);
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let d = 0; d < depth; d++) {
    const img = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const x = v[d * w * h + i];
      const f = normalize ? (hi === lo ? 0 : F(F(F(x - lo) / range) * 255)) : F(F(x * 127.5) + 127.5);
      const b = Math.trunc(Math.min(Math.max(f, 0), 255));
      img[i] = invert ? 255 - b : b;
    }
    out.push(img);
  }
  return out;
}

/** Math::smoothstep in floats. */
function smoothstep(from: number, to: number, s: number) {
  const t = Math.min(Math.max(F(F(s - F(from)) / F(F(to) - F(from))), 0), 1);
  return F(F(t * t) * F(3 - F(2 * t)));
}
/** Noise::_alpha_blend<uint8_t>. */
const blend = (bg: number, fg: number, a: number) => (((a + 1) * fg + (256 - a) * bg) >> 8) & 255;

/**
 * Noise::get_seamless_image: a (w + skirt) × (h + skirt) image (two layers: the normalization spans both), its quadrants
 * swapped so the edges meet, the skirt blended over the middle seams (Noise::_generate_seamless_image, first layer).
 */
function seamlessImage(n: ReturnType<typeof godotNoise>, w: number, h: number, invert: boolean, in3d: boolean, skirt: number, normalize: boolean): Uint8Array<ArrayBuffer> {
  const sw = Math.max(1, Math.trunc(F(w * F(skirt)))), sh = Math.max(1, Math.trunc(F(h * F(skirt))));
  const srcW = w + sw, srcH = h + sh, hw = Math.trunc(w * 0.5), hh = Math.trunc(h * 0.5), ex = hw + sw, ey = hh + sh;
  const src = getImage(n, srcW, srcH, 2, invert, in3d, normalize)[0];
  const dst = new Uint8Array(w * h);
  // img_buff: the source read with the half offset and a modulo (the output size skips the skirt, the source size includes it)
  const XY = (x: number, y: number) => src[((x + hw) % w) + ((y + hh) % h) * srcW];
  const X = (x: number, y: number) => src[((x + hw) % w) + ((y + hh) % srcH) * srcW];
  const Y = (x: number, y: number) => src[((x + hw) % srcW) + ((y + hh) % h) * srcW];
  const D = (x: number, y: number) => src[((x + hw) % srcW) + ((y + hh) % srcH) * srcW];
  const at = (x: number, y: number) => (x % w) + (y % h) * w;
  const alpha = (k: number, s: number) => Math.trunc(F(255 * F(1 - smoothstep(0.1, 0.9, F(k / s)))));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[at(x, y)] = XY(x, y);
  for (let x = hw; x < ex; x++) {
    const a = alpha(x - hw, sw);
    for (let y = 0; y < h; y++) {
      if (y === hh) y = ey - 1; // the centre square comes last
      else dst[at(x, y)] = blend(dst[at(x, y)], Y(x, y), a);
    }
  }
  for (let y = hh; y < ey; y++) {
    const a = alpha(y - hh, sh);
    for (let x = 0; x < w; x++) {
      if (x === hw) x = ex - 1;
      else dst[at(x, y)] = blend(dst[at(x, y)], X(x, y), a);
    }
  }
  for (let y = hh; y < ey; y++) for (let x = hw; x < ex; x++) {
    const xa = alpha(x - hw, sw), ya = alpha(y - hh, sh);
    dst[at(x, y)] = blend(blend(XY(x, y), Y(x, y), xa), blend(X(x, y), D(x, y), xa), ya);
  }
  return dst;
}

/**
 * Gradient::get_color_at_offset (points sorted by offset; linear, constant or cubic).
 * ponytail: only the sRGB interpolation colour space — no noise colour ramp in the game uses Linear sRGB or Oklab.
 */
function rampColor(pts: [number, number[]][], mode: number, x: number): number[] {
  if (!pts.length) return [0, 0, 0, 1];
  let low = 0, high = pts.length - 1, mid = 0;
  while (low <= high) {
    mid = (low + high) >> 1;
    if (pts[mid][0] > x) high = mid - 1;
    else if (pts[mid][0] < x) low = mid + 1;
    else return pts[mid][1];
  }
  if (pts[mid][0] > x) mid--;
  const a = mid, b = mid + 1;
  if (b >= pts.length) return pts[pts.length - 1][1];
  if (a < 0) return pts[0][1];
  const t = F(F(x - pts[a][0]) / F(pts[b][0] - pts[a][0]));
  if (mode === 1) return pts[a][1];
  const c1 = pts[a][1], c2 = pts[b][1];
  if (mode === 2) {
    const c0 = pts[Math.max(a - 1, 0)][1], c3 = pts[Math.min(b + 1, pts.length - 1)][1];
    // Math::cubic_interpolate(from, to, pre, post, weight)
    return c1.map((f, i) => { const p = c0[i], o = c2[i], q = c3[i]; return F(0.5 * (f * 2 + (-p + o) * t + (2 * p - 5 * f + 4 * o - q) * t * t + (-p + 3 * f - 3 * o + q) * t * t * t)); });
  }
  return c1.map((f, i) => F(f + F(t * F(c2[i] - f)))); // Color::lerp
}

/** NoiseTexture2D._generate_texture → the image Godot uploads: L8, or RGBA8 with a colour ramp or as a normal map. */
export function noiseImage(desc: NoiseTextureDesc): { width: number; height: number; format: 'L8' | 'RGBA8'; data: Uint8Array<ArrayBuffer> } {
  const d = { ...TEX, ...desc };
  const w = d.width, h = d.height;
  const n = godotNoise(d.noise ?? {});
  let data = d.seamless ? seamlessImage(n, w, h, d.invert, d.in_3d_space, d.seamless_blend_skirt, d.normalize) : getImage(n, w, h, 1, d.invert, d.in_3d_space, d.normalize)[0];
  let format: 'L8' | 'RGBA8' = 'L8';
  if (d.color_ramp) {
    // _modulate_with_gradient: each pixel's luminance (L8 → l/255 in r, g, b) looked up in the ramp, stored as bytes
    const r = d.color_ramp, pts = r.offsets.map((o, i) => [F(o), (r.colors[i] ?? [0, 0, 0, 1]).map(F)] as [number, number[]]).sort((p, q) => p[0] - q[0]);
    const lut = Array.from({ length: 256 }, (_, b) => {
      const l = F(b / 255);
      const c = rampColor(pts, r.interpolation_mode ?? 0, F(F(F(F(0.2126) * l) + F(F(0.7152) * l)) + F(F(0.0722) * l)));
      return c.map((v) => Math.trunc(Math.min(Math.max(v * 255, 0), 255)));
    });
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set(lut[data[i]], i * 4);
    data = rgba; format = 'RGBA8';
  }
  if (d.as_normal_map) {
    // Image::bump_map_to_normal_map: the red channel as heights, wrapping at the edges
    const k = format === 'L8' ? 1 : 4, hgt = (x: number, y: number) => F(data[(y * w + x) * k] / 255);
    const nm = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const here = hgt(x, y), right = hgt((x + 1) % w, y), above = hgt(x, (y + 1) % h);
      // across (1, 0, (right − here)·s) × up (0, 1, (here − above)·s), normalized
      const ax = F(F(right - here) * d.bump_strength), uz = F(F(here - above) * d.bump_strength);
      const nx = -ax, ny = -uz, len = Math.hypot(nx, ny, 1);
      nm.set([Math.trunc(127.5 + (nx / len) * 127.5), Math.trunc(127.5 + (ny / len) * 127.5), Math.trunc(127.5 + (1 / len) * 127.5), 255], (y * w + x) * 4);
    }
    data = nm; format = 'RGBA8';
  }
  return { width: w, height: h, format, data };
}

/** The image as straight RGBA (L8 sampled as l, l, l, 1). */
export function noiseRGBA(desc: NoiseTextureDesc): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const im = noiseImage(desc);
  if (im.format === 'RGBA8') return { width: im.width, height: im.height, rgba: new Uint8ClampedArray(im.data.buffer) };
  const rgba = new Uint8ClampedArray(im.width * im.height * 4);
  im.data.forEach((l, i) => rgba.set([l, l, l, 255], i * 4));
  return { width: im.width, height: im.height, rgba };
}

const cache = new Map<string, Texture>();
const twins = new WeakMap<Texture, Texture>();
/** A NoiseTexture2D as a Pixi texture (premultiplied, clamped), cached by its properties. */
export function noiseTexture(desc: NoiseTextureDesc): Texture {
  const key = JSON.stringify(desc);
  let t = cache.get(key);
  if (!t) {
    const { width, height, rgba } = noiseRGBA(desc);
    const pm = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      pm[i] = Math.round((rgba[i] * a) / 255); pm[i + 1] = Math.round((rgba[i + 1] * a) / 255); pm[i + 2] = Math.round((rgba[i + 2] * a) / 255); pm[i + 3] = a;
    }
    const make = (addressMode: 'clamp-to-edge' | 'repeat') => new Texture({ source: new BufferImageSource({ resource: pm, width, height, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha', addressMode }) });
    t = make('clamp-to-edge');
    twins.set(t, make('repeat'));
    cache.set(key, t);
  }
  return t;
}
/** The same noise texture wrapping (samplers declared `repeat_enable`); any other texture as it is. */
export const repeating = (t: Texture) => twins.get(t) ?? t;
