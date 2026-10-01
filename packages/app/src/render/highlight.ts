// NCardHighlight: card_frame_sdf through shaders/card_ripple.gdshader (blend_add), evaluated on the CPU at the SDF's
// resolution — one image per (width, colour) per frame, copied into each card's canvas.
import { imageUrl } from '../assets';

const SIZE = 256;
let sdf: Float32Array | null = null, lum: Float32Array | null = null, loading = false;
function load() {
  if (loading) return;
  loading = true;
  const url = imageUrl('images/packed/card_template/card_frame_sdf.exr');
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, SIZE, SIZE);
    const d = g.getImageData(0, 0, SIZE, SIZE).data;
    sdf = new Float32Array(SIZE * SIZE);
    lum = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) { sdf[i] = d[i * 4 + 3] / 255; lum[i] = d[i * 4] / 255; }
  };
  img.src = url;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

const cache = new Map<string, HTMLCanvasElement>();
const pool: HTMLCanvasElement[] = [];
let cacheFrame = -1;
/**
 * The highlight at shader width `w` in colour `rgba` (the Highlight node's modulate) for this frame, or null while the
 * SDF loads / the glow is off. card.tscn: ease 0.005, modulo_width 0.02, ripple_speed 0.03.
 */
export function highlightImage(w: number, rgba: number[], frame: number, time: number): HTMLCanvasElement | null {
  if (!sdf) { load(); return null; }
  if (w <= 0.0005) return null;
  if (frame !== cacheFrame) { cacheFrame = frame; pool.push(...cache.values()); cache.clear(); }
  const key = `${w.toFixed(4)}|${rgba.join(',')}`;
  let c = cache.get(key);
  if (c) return c;
  c = pool.pop();
  if (!c) { c = document.createElement('canvas'); c.width = c.height = SIZE; }
  const g = c.getContext('2d')!;
  const out = g.createImageData(SIZE, SIZE), d = out.data;
  const [r, gg, b, ma] = rgba, lo = 1 - w, s = sdf, l = lum!;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const a = s[i] * ma;
    if (a < lo - 0.02) continue;
    const m = (time * 0.03 + a) % 0.02;
    const bright = a - m + smooth(0, 0.005, m) * 0.02;
    const alpha = smooth(lo, 1, bright);
    if (alpha <= 0) continue;
    const j = i * 4;
    d[j] = r * l[i] * 255; d[j + 1] = gg * l[i] * 255; d[j + 2] = b * l[i] * 255; d[j + 3] = alpha * 255;
  }
  g.putImageData(out, 0, 0);
  cache.set(key, c);
  return c;
}
