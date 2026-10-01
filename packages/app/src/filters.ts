// Exact port of shaders/hsv.gdshader (YIQ hue rotation + saturation + value) as SVG feColorMatrix filters.
const MATS: Record<string, [number, number, number]> = {
  // card frames (by pool)
  card_frame_red_mat: [0.025, 0.85, 1.0], card_frame_blue_mat: [0.55, 0.9, 1.0], card_frame_green_mat: [0.32, 0.45, 1.2],
  card_frame_orange_mat: [0.12, 1.5, 1.2], card_frame_pink_mat: [0.965, 0.55, 1.2], card_frame_colorless_mat: [1.0, 0.0, 1.2],
  card_frame_curse_mat: [0.85, 0.05, 0.55], card_frame_quest_mat: [1.0, 1.0, 1.0],
  // banners / portrait borders / type plaques (by rarity)
  card_banner_ancient_mat: [0.0, 0.2, 0.9], card_banner_common_mat: [1.0, 0.0, 0.85], card_banner_curse_mat: [0.27, 1.1, 0.9],
  card_banner_event_mat: [0.875, 0.85, 0.9], card_banner_quest_mat: [0.515, 1.727, 0.9], card_banner_rare_mat: [0.563, 1.198, 1.14],
  card_banner_status_mat: [0.634, 0.35, 0.8], card_banner_uncommon_mat: [1.0, 1.0, 1.0],
  // NCard enchantment tab (SetEnchantmentStatus: enabled / disabled)
  enchant_tab: [0.25, 0.4, 0.6], enchant_tab_off: [0.25, 0.1, 0.6],
  // debuff hover tips (hover_tip.tscn hsv 0.47 / 2 / 0.9)
  hover_tip_debuff: [0.47, 2.0, 0.9],
};
type M3 = number[][];
const mul = (a: M3, b: M3): M3 => a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
const inv3 = (m: M3): M3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map((r) => r.map((x) => x / det));
};
const YIQ: M3 = [[0.2989, 0.587, 0.114], [0.5959, -0.2774, -0.3216], [0.2115, -0.5229, 0.3114]];
export function hsvMatrix(h: number, s: number, v: number): M3 {
  const t = (1 - h) * Math.PI * 2;
  const c = Math.cos(t), sn = Math.sin(t);
  const Ht: M3 = [[1, 0, 0], [0, c, -sn], [0, sn, c]]; // (v * H) in GLSL == H^T * v
  const S: M3 = [[1, 0, 0], [0, s, 0], [0, 0, s]];
  const V: M3 = [[v, 0, 0], [0, v, 0], [0, 0, v]];
  return mul(inv3(YIQ), mul(V, mul(S, mul(Ht, YIQ))));
}
export function installFilters() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  let html = '';
  for (const [name, [h, s, v]] of Object.entries(MATS)) {
    const m = hsvMatrix(h, s, v);
    const vals = [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0].map((x) => x.toFixed(5)).join(' ');
    html += `<filter id="${name}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${vals}"/></filter>`;
  }
  // relic.gdshader is_used (the RGB average) × NRelicInventoryHolder's Disabled modulate #808080
  html += '<filter id="relic-used" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.16667 0.16667 0.16667 0 0 0.16667 0.16667 0.16667 0 0 0.16667 0.16667 0.16667 0 0 0 0 0 1 0"/></filter>';
  svg.innerHTML = html;
  document.body.appendChild(svg);
}
/** res://materials/cards/frames/card_frame_red_mat.tres → its hsv.gdshader (h, s, v), or null. */
export const matHsv = (path: string | null | undefined) => {
  const m = /(\w+_mat)\.tres$/.exec(path ?? '');
  return m ? MATS[m[1]] ?? null : null;
};
/** res://materials/cards/frames/card_frame_red_mat.tres → CSS filter */
export const matFilter = (path: string | null | undefined) => {
  const m = /(\w+_mat)\.tres$/.exec(path ?? '');
  return m && MATS[m[1]] ? `url(#${m[1]})` : 'none';
};

/** Godot modulate (colour multiply) on textures as an SVG feColorMatrix filter, created on first use. */
let tintSvg: SVGSVGElement | null = null;
const tints = new Set<string>();
export function tint(r: number, g: number, b: number, a = 1): string {
  const id = 'mod-' + [r, g, b, a].map((v) => Math.round(v * 1000)).join('-');
  if (!tints.has(id)) {
    tints.add(id);
    if (!tintSvg) {
      tintSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tintSvg.setAttribute('width', '0'); tintSvg.setAttribute('height', '0'); tintSvg.style.position = 'absolute';
      document.body.appendChild(tintSvg);
    }
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `<feColorMatrix type="matrix" values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 ${a} 0"/>`;
    tintSvg.appendChild(f);
  }
  return `url(#${id})`;
}
/** hsv.gdshader with arbitrary (h, s, v) as a filter, created on first use. */
export function hsvFilter(h: number, s: number, v: number): string {
  const id = 'hsv-' + [h, s, v].map((x) => Math.round(x * 1000)).join('-');
  if (!tints.has(id)) {
    tint(1, 1, 1); // ensures the svg host exists
    tints.add(id);
    const m = hsvMatrix(h, s, v);
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `<feColorMatrix type="matrix" values="${[...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0].map((x) => x.toFixed(5)).join(' ')}"/>`;
    tintSvg!.appendChild(f);
  }
  return `url(#${id})`;
}
