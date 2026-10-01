// NCreature's DOM parts, in creature-local coordinates (origin at the feet, scaled with the combat scene):
// creature_state_display.tscn (health bar, block, nameplate, power row), the intents (NIntent, animated from
// IntentAnimData), NSelectionReticle; plus the floating numbers (NDamageNumVfx, NHealNumVfx, NDamageBlockedVfx), the power
// VFX (NPowerAppliedVfx, NPowerFlashVfx, NPowerRemovedVfx) and the speech / thought bubbles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useLayoutEffect, useEffect } from 'preact/hooks';
import { G, $, list } from '../game';
import { atlasFrame, frameStyle, imageUrl, spineIndex } from '../assets';
import { RichText, glyphs } from './richtext';
import { logicalRect } from './tooltip';
import { flipbook } from './anim';
import { useFit } from './card';
import { visualsKey, type Slot } from '../render/stage';
import { curveAt } from '../render/cardfx';
import { tint, hsvFilter } from '../filters';
import { targetManager } from '../cardnodes';
import type { CreatureView, IntentNode, PowerPopData } from '../bridge';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (x: any) => safe(() => (typeof x === 'string' ? x : x?.GetFormattedText?.() ?? ''), '');
const info = (c: any) => spineIndex[visualsKey(c)] ?? {};
const rgba = (c: any, d: string) => (c && 'R' in c ? `rgba(${Math.round(c.R * 255)}, ${Math.round(c.G * 255)}, ${Math.round(c.B * 255)}, ${c.A})` : d);

// ------------------------------------------------------------------ SVG filters for the power shaders
let fxSvg: SVGSVGElement | null = null;
function svgFilter(id: string, body: string) {
  if (document.getElementById(id)) return `url(#${id})`;
  if (!fxSvg) {
    fxSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    fxSvg.setAttribute('width', '0'); fxSvg.setAttribute('height', '0'); fxSvg.style.position = 'absolute';
    document.body.appendChild(fxSvg);
  }
  const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  f.setAttribute('id', id);
  f.setAttribute('color-interpolation-filters', 'sRGB');
  f.innerHTML = body;
  fxSvg.appendChild(f);
  return `url(#${id})`;
}
/** power_flash_vfx.gdshader (blend_add): COLOR = texture² with rgb × strength (drawn additively, plus-lighter).
 *  ponytail: SVG filter results clamp to 1, so strength-2 texels past 1 add less than Godot's unclamped source would. */
const flashFilter = (strength: number) => svgFilter(`power-flash-${strength}`,
  `<feComponentTransfer>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="gamma" amplitude="${strength}" exponent="2" offset="0"/>`).join('')}<feFuncA type="gamma" amplitude="1" exponent="2" offset="0"/></feComponentTransfer>`);
/** power.gdshader with pulse = 1: COLOR.rgb += |sin(TIME · 3)| · 0.2 — one filter whose offset follows TIME while used. */
let pulseLoop = false;
function pulseFilter() {
  const url = svgFilter('power-pulse', `<feComponentTransfer>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="1" intercept="0"/>`).join('')}</feComponentTransfer>`);
  if (!pulseLoop) {
    pulseLoop = true;
    const funcs = Array.from(document.getElementById('power-pulse')!.firstElementChild!.children);
    $.onFrame(() => {
      const v = (Math.abs(Math.sin((performance.now() / 1000) * 3)) * 0.2).toFixed(4);
      for (const f of funcs) f.setAttribute('intercept', v);
      if (document.querySelector('.power-icon.pulse')) return true;
      pulseLoop = false;
      return false;
    });
  }
  return url;
}

// ------------------------------------------------------------------ NSelectionReticle
/** `corners`: each bracket's box top-left and mirror (x, y, sx, sy); by default the creature layout for a w × h box. */
export function Reticle({ on, w = 0, h = 0, corners: given, origin }: { on: boolean; w?: number; h?: number; corners?: [number, number, number, number][]; origin?: string }) {
  const src = imageUrl('images/ui/combat/combat_reticle.png') ?? '';
  // Border (top-left) at (-10, -10); Border2 / 3 / 4 mirrored to the other corners; shadows +4, +3 in black at 50%
  const corners: [number, number, number, number][] = given ?? [[-10, -10, 1, 1], [-10, h - 21, 1, -1], [w - 22, -10, -1, 1], [w - 22, h - 21, -1, -1]];
  return (
    <div class={'reticle' + (on ? ' on' : '')} style={{ width: `${w}px`, height: `${h}px`, transformOrigin: origin }}>
      {corners.map(([x, y, sx, sy]) => <img class="reticle-shadow" src={src} style={{ left: `${x + 4}px`, top: `${y + 3}px`, transform: `scale(${sx}, ${sy})` }} />)}
      {corners.map(([x, y, sx, sy]) => <img src={src} style={{ left: `${x}px`, top: `${y}px`, transform: `scale(${sx}, ${sy})` }} />)}
    </div>
  );
}

// ------------------------------------------------------------------ NHealthBar
/**
 * HpMiddleground (RefreshMiddleground): when the HP changes, its right edge steps 1 px out and tweens to the HP
 * foreground's − 2 over 1 s (Expo Out), after 1 s when it shrinks. A new bar width resets it (SetHpBarContainerSize…).
 */
interface MidState { Mid: number; hp: number; max: number; maxFg: number; tween: any; el: HTMLElement | null }
const mids = new WeakMap<any, MidState>();
function middleground(c: any, maxFg: number, fgHp: number): MidState {
  let st = mids.get(c);
  if (!st || st.maxFg !== maxFg) {
    st?.tween?.Kill();
    st = { Mid: fgHp - 2, hp: c.CurrentHp, max: c.MaxHp, maxFg, tween: null, el: null };
    mids.set(c, st);
  } else if (c.CurrentHp > 0 && (c.CurrentHp !== st.hp || c.MaxHp !== st.max)) {
    const s = st;
    s.hp = c.CurrentHp; s.max = c.MaxHp;
    const grow = fgHp >= s.Mid;
    s.Mid += 1;
    s.tween?.Kill();
    const t = (s.tween = new $.WebTween());
    t.TweenProperty(s, 'mid', fgHp - 2, 1).SetDelay(grow ? 0 : 1).SetEase(1).SetTrans(5);
    const paint = () => { if (s.el) s.el.style.width = `${Math.max(12, s.Mid - 1)}px`; };
    $.onFrame(() => { paint(); return t.IsValid(); });
    t.whenFinished(paint);
  }
  return st;
}
/** RefreshBlockUi: the block container stays until the block (and a tracked creature's) is gone; then NBlockBrokenVfx. */
const blockUi = new WeakMap<any, { shown: boolean; text: string; breaks: number[] }>();
function refreshBlock(c: any, tracking: any) {
  let b = blockUi.get(c);
  if (!b) blockUi.set(c, (b = { shown: c.Block > 0, text: String(c.Block), breaks: [] }));
  const outline = c.Block > 0 || safe(() => tracking?.Block > 0, false);
  if (!outline) {
    if (b.shown && !G.TestMode.IsOn) {
      const at = performance.now();
      b.breaks.push(at);
      setTimeout(() => { b!.breaks = b!.breaks.filter((x) => x !== at); }, 1000);
    }
    b.shown = false;
  } else if (c.Block > 0) { b.shown = true; b.text = String(c.Block); }
  return { ...b, outline };
}
function HealthBar({ c, bx, bw, outline }: { c: any; bx: number; bw: number; outline: boolean }) {
  const r = 24 - safe(() => c.Monster?.HpBarSizeReduction ?? 0, 0);
  const x = bx - r / 2, w = bw + r, maxFg = w - 10;
  const hp = c.CurrentHp, max = Math.max(1, c.MaxHp);
  const infinite = safe(() => !!c.ShowsInfiniteHp, false);
  const fg = (n: number) => (c.MaxHp <= 0 ? 0 : Math.max((n / max) * maxFg, hp > 0 ? 12 : 0));
  const powers = list(c.Powers);
  const poison = powers.find((p: any) => p instanceof G.PoisonPower);
  const doom = powers.find((p: any) => p instanceof G.DoomPower);
  const p = poison ? safe(() => poison.CalculateTotalDamageNextTurn(), 0) : 0;
  const d = doom ? safe(() => doom.Amount, 0) : 0;
  const poisonLethal = !!poison && p > 0 && p >= hp, doomLethal = !!doom && d > 0 && d >= hp - p;
  let hpRight = fg(hp), showHp = hp > 0, poisonL = 0, poisonR = 0, doomR = 0;
  if (!infinite && p > 0) {
    if (poisonLethal) { poisonR = fg(hp); showHp = false; }
    else { hpRight = fg(hp - p); poisonL = Math.max(0, hpRight - 6); poisonR = fg(hp); }
  }
  if (!infinite && d > 0) {
    if (doomLethal) { if (!poisonLethal) { doomR = hpRight; } showHp = false; }
    else doomR = Math.min(maxFg, fg(d) + 6);
  }
  const mid = middleground(c, maxFg, fg(hp));
  const fgColor = infinite ? [0.773, 0.733, 0.929] : outline ? [0.231, 0.435, 0.639] : [0.945, 0.216, 0.243];
  let [txt, outlineCol] = ['#FFF6E2', '#900000'];
  if (poisonLethal) [txt, outlineCol] = ['#76FF40', '#074700'];
  else if (doomLethal) [txt, outlineCol] = ['#FB8DFF', '#2D1263'];
  else if (outline) outlineCol = '#1B3045';
  const fillSrc = `url(${imageUrl('images/ui/combat/health_bar_fill.png')})`;
  const fill = (l: number, rgt: number, color: number[] | null, extra: any = {}) => rgt > l && (
    <div class="hp-fill" style={{ left: `${l}px`, width: `${rgt - l}px`, borderImageSource: fillSrc, filter: color ? tint(color[0], color[1], color[2]) : undefined, ...extra }} />
  );
  return (
    <div class="hp-bar" style={{ left: `${x}px`, width: `${w}px` }}>
      <div class="hp-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/combat/health_bar_bg.png')})`, filter: tint(0.1647, 0.3765, 0.4196, 0.7529) }} />
      {outline && <div class="hp-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/combat/health_bar_stroke.png')})`, filter: tint(0.706, 0.886, 1) }} />}
      <div class="hp-fills" style={{ width: `${maxFg}px` }}>
        {hp > 0 && <div class="hp-fill" ref={(el) => { mid.el = el; }} style={{ left: '1px', width: `${Math.max(12, mid.Mid - 1)}px`, borderImageSource: fillSrc, filter: tint(1, 0.498, 0) }} />}
        {fill(poisonL, poisonR, [0.4745, 0.7529, 0.2353])}
        {showHp && fill(0, hpRight, fgColor)}
        {doomR > 0 && <DoomFill w={doomR} />}
      </div>
      {infinite && c.IsAlive && <img class="hp-infinite" src={imageUrl('images/ui/combat/combat_infinity_hp.png') ?? ''} />}
      {!infinite && (
        <div class="hp-label" style={{ color: c.IsDead ? '#FFF6E2' : txt, WebkitTextStrokeColor: c.IsDead ? '#900000' : outlineCol }}>
          {c.IsDead ? safe(() => new G.LocString().$ctor_LocString('gameplay_ui', 'HEALTH_BAR.DEAD').GetRawText(), 'Dead') : `${hp}/${c.MaxHp}`}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ DoomForeground (scenes/combat/doom_bar.gdshader)
/**
 * The doom fill: health_bar_fill's alpha, its colour from doom_bar.gdshader — FastNoiseLite Perlin FBM (health_bar.tscn:
 * frequency 0.0383, 5 octaves, lacunarity 2, gain 0.5, seed 0) in a normalized 512² NoiseTexture2D, sampled twice at
 * SCREEN_UV scrolling with TIME, smoothstepped and mapped through the three-stop purple gradient.
 * ponytail: the noise is computed in doubles (Godot's FastNoiseLite uses float32): values can differ in the last bits.
 */
let noiseL8: Uint8Array | null = null;
function doomNoise() {
  if (noiseL8) return noiseL8;
  const g2: number[] = [];
  for (let r = 0; r < 5; r++) for (let k = 0; k < 24; k++) { const a = ((82.5 - 15 * k) * Math.PI) / 180; g2.push(Math.cos(a), Math.sin(a)); }
  for (const deg of [67.5, 22.5, -22.5, -67.5, -112.5, -157.5, 157.5, 112.5]) { const a = (deg * Math.PI) / 180; g2.push(Math.cos(a), Math.sin(a)); }
  const PX = 501125321, PY = 1136930381;
  const grad = (seed: number, xp: number, yp: number, xd: number, yd: number) => {
    let h = Math.imul(seed ^ xp ^ yp, 0x27d4eb2d);
    h ^= h >> 15;
    h &= 127 << 1;
    return xd * g2[h] + yd * g2[h | 1];
  };
  const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const perlin = (seed: number, x: number, y: number) => {
    const fx = Math.floor(x), fy = Math.floor(y), xd0 = x - fx, yd0 = y - fy, xd1 = xd0 - 1, yd1 = yd0 - 1;
    const xs = quintic(xd0), ys = quintic(yd0);
    const x0 = Math.imul(fx, PX), y0 = Math.imul(fy, PY), x1 = (x0 + PX) | 0, y1 = (y0 + PY) | 0;
    const a = grad(seed, x0, y0, xd0, yd0), b = grad(seed, x1, y0, xd1, yd0), c = grad(seed, x0, y1, xd0, yd1), d = grad(seed, x1, y1, xd1, yd1);
    const xf0 = a + xs * (b - a), xf1 = c + xs * (d - c);
    return (xf0 + ys * (xf1 - xf0)) * 1.4247691104677813;
  };
  const N = 512, v = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let sum = 0, amp = 1 / 1.9375, px = x * 0.0383, py = y * 0.0383;
    for (let o = 0; o < 5; o++) { sum += perlin(o, px, py) * amp; px *= 2; py *= 2; amp *= 0.5; }
    v[y * N + x] = sum; lo = Math.min(lo, sum); hi = Math.max(hi, sum);
  }
  noiseL8 = new Uint8Array(N * N);
  for (let i = 0; i < v.length; i++) noiseL8[i] = Math.min(255, Math.max(0, Math.floor(((v[i] - lo) / (hi - lo)) * 255)));
  return noiseL8;
}
/** GradientTexture1D (256 texels at i / 255) of the doom gradient. */
const DOOM_GRAD = (() => {
  const off = [0, 0.514583, 1], col = [[0.300863, 0.162626, 0.528347], [0.513726, 0.254902, 0.505882], [0.354657, 0.0421873, 0.437114]];
  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255, k = t <= off[1] ? 0 : 1, f = (t - off[k]) / (off[k + 1] - off[k]);
    return col[k].map((a, j) => a + (col[k + 1][j] - a) * f);
  });
})();
function doomColor(noise: Uint8Array, u: number, v: number, time: number, out: number[]) {
  // bilinear, repeat
  const tex = (x: number, y: number) => {
    const fx = x * 512 - 0.5, fy = y * 512 - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    const at = (i: number, j: number) => noise[(((j % 512) + 512) % 512) * 512 + (((i % 512) + 512) % 512)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ax, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ax;
    return (a + (b - a) * ay) / 255;
  };
  const s = tex(u * 0.1 + time * 0.0005 + 0.24, v * 0.1 + time * 0.0005 + 0.24);
  const c1 = tex(u + time * 0.0005 + s, v + time * 0.0005 + s);
  const c2 = tex(u + time * -0.0007 + s, v + time * -0.0007 + s);
  let f = Math.min(Math.max((c1 * 0.75 + c2 * 0.35 - 0.4) / 0.2, 0), 1);
  f = f * f * (3 - 2 * f);
  const gx = Math.min(Math.max(f * 256 - 0.5, 0), 255), i0 = Math.floor(gx), i1 = Math.min(i0 + 1, 255), gf = gx - i0;
  for (let k = 0; k < 3; k++) out[k] = DOOM_GRAD[i0][k] + (DOOM_GRAD[i1][k] - DOOM_GRAD[i0][k]) * gf;
}
let fillImg: HTMLImageElement | null = null;
function DoomFill({ w }: { w: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = Math.max(1, Math.round(w)), H = 18;
  useEffect(() => {
    const cv = ref.current!;
    let alpha: Uint8ClampedArray | null = null, img: ImageData | null = null;
    if (!fillImg) { fillImg = new Image(); fillImg.src = imageUrl('images/ui/combat/health_bar_fill.png') ?? ''; }
    const g = cv.getContext('2d')!, out = [0, 0, 0];
    // the NinePatchRect (patch margins 6 left / right) drawn once for its alpha
    const shape = () => {
      if (!fillImg!.complete || !fillImg!.naturalWidth) return false;
      const iw = fillImg!.naturalWidth, ih = fillImg!.naturalHeight, m = 6 * (iw / 15);
      g.clearRect(0, 0, W, H);
      g.drawImage(fillImg!, 0, 0, m, ih, 0, 0, 6, H);
      g.drawImage(fillImg!, m, 0, iw - 2 * m, ih, 6, 0, Math.max(0, W - 12), H);
      g.drawImage(fillImg!, iw - m, 0, m, ih, W - 6, 0, 6, H);
      img = g.getImageData(0, 0, W, H);
      alpha = new Uint8ClampedArray(W * H);
      for (let i = 0; i < W * H; i++) alpha[i] = img.data[i * 4 + 3];
      return true;
    };
    const noise = doomNoise();
    return $.onFrame(() => {
      if (!cv.isConnected) return false;
      if (!alpha && !shape()) return true;
      const r = logicalRect(cv);
      if (!r || !img) return true;
      const t = performance.now() / 1000, d = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!alpha![i]) continue;
        doomColor(noise, (r[0] + ((x + 0.5) * r[2]) / W) / 1920, (r[1] + ((y + 0.5) * r[3]) / H) / 1080, t, out);
        d[i * 4] = out[0] * 255; d[i * 4 + 1] = out[1] * 255; d[i * 4 + 2] = out[2] * 255; d[i * 4 + 3] = alpha![i];
      }
      g.putImageData(img, 0, 0);
      return true;
    });
  }, [W]);
  return <canvas class="hp-doom" ref={ref} width={W} height={H} style={{ width: `${W}px` }} />;
}

// ------------------------------------------------------------------ NPowerContainer / NPower
const powerTipFns = new WeakMap<any, () => void>();
function Powers({ c, node, bx, bw }: { c: any; node: CreatureView | null; bx: number; bw: number }) {
  const powers = list(c.Powers).filter((p: any) => safe(() => p.IsVisible, true));
  const n = powers.length, W = bw + 25;
  const perRow = Math.max(Math.ceil(n / 2), Math.ceil(W / 48));
  const shift = Math.max(0, 48 * Math.min(perRow, n) - W) / 2;
  return (
    <div class="powers" style={{ left: `${bx - shift}px` }}>
      {powers.map((p: any, i: number) => <Power key={String(safe(() => p.Id.Entry, i))} p={p} node={node} x={48 * (i % perRow)} y={Math.floor(i / perRow) * 48} />)}
    </div>
  );
}
/** NPower: the icon (pulsing while the model pulses), its PowerFlash, the amount (Counter stacks, AmountLabelColor). */
function Power({ p, node, x, y }: { p: any; node: CreatureView | null; x: number; y: number }) {
  const amt = safe(() => p.DisplayAmount, p.Amount);
  const counter = safe(() => p.StackType === G.PowerStackType.Counter, true);
  const flashAt = node?.iconFlash.get(p) ?? 0;
  const flashing = performance.now() - flashAt < 1000;
  const pulse = !!node?.pulsing.has(p);
  // OnHovered: this power's tips (re-shown on combat-state changes); OnUnhovered hides them
  let tipFn = powerTipFns.get(p);
  if (!tipFn && node) powerTipFns.set(p, (tipFn = () => node.ShowHoverTips(p.HoverTips)));
  // a freed NPower no longer refreshes its tips
  useEffect(() => () => { if (tipFn) node?.tipSubs.delete(tipFn); }, []);
  return (
    <div class="power" style={{ left: `${x}px`, top: `${y}px` }}
      onPointerEnter={() => { if (!node || !tipFn) return; node.ShowHoverTips(p.HoverTips); node.tipSubs.add(tipFn); }}
      onPointerLeave={() => { if (!node || !tipFn) return; node.HideHoverTips(); node.tipSubs.delete(tipFn); }}>
      <div class={'power-icon' + (pulse ? ' pulse' : '')} style={{ ...frameStyle(atlasFrame(safe(() => p.IconPath, '')), 40, 40), filter: pulse ? pulseFilter() : undefined }} />
      {flashing && <img key={flashAt} class="power-flash" src={imageUrl(safe(() => p.ResolvedBigIconPath, '')) ?? ''} style={{ filter: flashFilter(2) }} />}
      {counter && <div class="power-amt" style={{ color: rgba(safe(() => p.AmountLabelColor, null), '#FFF6E2') }}>{amt}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ intents
/** IntentContainer (HBox, separation −10, centred on IntentPos) at IntentContainer.Modulate.a. */
function Intents({ c, node }: { c: any; node: CreatureView | null }) {
  const ns: IntentNode[] = node?.intents ?? [];
  if (!ns.length) return null;
  const ip = info(c).intentPos ?? [0, (info(c).bounds?.[1] ?? -280) - 40];
  const n = ns.length, width = 64 * n - 10 * (n - 1);
  return (
    <div class="intents" ref={(el) => { if (node) node.intentEl = el; }} style={{ left: `${ip[0] - width / 2}px`, top: `${ip[1] - 20}px`, opacity: String(node!.IntentA) }}>
      {ns.map((it, i) => <Intent key={i} n={it} c={c} node={node!} />)}
    </div>
  );
}
/**
 * NIntent: the holder bobs (sin(πt + offset) · 10 + 8 px up); the sprite flips through its animation at 15 fps; attack /
 * status intents show their label. UpdateVisuals runs while not frozen. PlayPerform: four additive copies of the intent
 * texture (α 0.27, 0.25 s apart) grow 0.5 → 1.49 over 1 s each.
 */
function Intent({ n, c, node }: { n: IntentNode; c: any; node: CreatureView }) {
  if (!n.frozen || n.anim == null) {
    n.anim = safe(() => n.intent.GetAnimation(n.targets, c), 'unknown');
    n.label = n.intent instanceof G.AttackIntent || n.intent instanceof G.StatusIntent ? safe(() => fmt(n.intent.GetIntentLabel(n.targets, c)), '') : '';
    n.tex = safe(() => n.intent.GetTexture(n.targets, c)?.ResourcePath ?? null, null);
  }
  const anim = n.anim!;
  const count = safe(() => G.IntentAnimData.GetAnimationFrameCount(anim), 1);
  const frames = Array.from({ length: count }, (_, i) => {
    const f = frameStyle(atlasFrame(safe(() => G.IntentAnimData.GetAnimationFrame(anim, i), '')), 72, 72);
    return { padding: f.padding, backgroundImage: f.backgroundImage, backgroundSize: f.backgroundSize, backgroundPosition: f.backgroundPosition };
  });
  const sprite = count > 1 ? { ...frameStyle(null, 72, 72), backgroundRepeat: 'no-repeat', backgroundOrigin: 'content-box', backgroundClip: 'content-box', boxSizing: 'border-box', ...flipbook(`intent-${anim}`, frames, 15) } : frameStyle(atlasFrame(safe(() => G.IntentAnimData.GetAnimationFrame(anim, 0), '')), 72, 72);
  const burst = n.perform > 0 && performance.now() - n.perform < 1750 ? atlasFrame(n.tex) : null;
  const tip = () => { if (safe(() => n.intent.HasIntentTip, false)) node.ShowHoverTips([n.intent.GetHoverTip(n.targets, c)]); };
  return (
    <div class="intent" onPointerEnter={tip} onPointerLeave={() => node.HideHoverTips()}>
      <div class="intent-holder" style={{ animationDelay: `${-((n.offset / Math.PI) % 2)}s` }}>
        <div class="intent-sprite" style={sprite} />
        {burst && <div class="intent-burst" key={n.perform}>{[0, 1, 2, 3].map((k) => <div style={{ ...frameStyle(burst, 72, 72), animationDelay: `${k * 0.25}s` }} />)}</div>}
        {n.label && <div class="intent-label"><RichText text={n.label} /></div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the creature
/** MegaLabel.SetTextAutoSize: the block amount (8–24 in its 41 px) and the nameplate (12–24 in the bounds + 10 px). */
function BlockLabel({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFit(ref, `blk|${text}`, 24, 8, (el) => (el.firstChild as HTMLElement).offsetWidth <= 41);
  return <div class="cr-block-label" ref={ref}><span>{text}</span></div>;
}
function Nameplate({ name, bx, bw }: { name: string; bx: number; bw: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFit(ref, `np|${Math.round(bw)}|${name}`, 24, 12, (el) => (el.firstChild as HTMLElement).offsetWidth <= bw + 10);
  return (
    <div class="nameplate" style={{ left: `${bx}px`, width: `${bw}px` }}>
      <img src={imageUrl('images/ui/combat/combat_nameplate_background.png') ?? ''} />
      <div ref={ref}><span>{name}</span></div>
    </div>
  );
}
/** NCreatureStateDisplay animates in 20 px from above; at combat start after a random 1.3–1.7 s. */
const stateDelay = new WeakMap<any, number>();
export function CreatureOverlay({ c, s, node, fresh, removing }: { c: any; s: Slot; node: any; fresh: boolean; removing?: boolean }) {
  const k = s.s || 1;
  const bx = s.bl / k, by = s.bt / k, bw = s.w / k, bh = s.h / k;
  let delay = stateDelay.get(c);
  if (delay == null) stateDelay.set(c, (delay = fresh ? 1.3 + Math.random() * 0.4 : 0));
  const hovered = useRef(false);
  const view = node as CreatureView | null;
  const visible = safe(() => c.Monster?.IsHealthBarVisible ?? true, true);
  const block = refreshBlock(c, view?.blockTracking);
  return (
    <div class={'creature' + (c.IsDead ? ' dead' : '') + (removing ? ' removing' : '') + (view?.IsFocused || hovered.current ? ' focused' : '') + (hovered.current ? ' hp-hover' : '')} data-side={c.IsEnemy ? 'enemy' : 'ally'}
      ref={(e) => { if (view) view.overlay = e; }}
      style={{ left: `${s.x}px`, top: `${s.y}px`, transform: `scale(${k})` }}>
      <div class="cr-hitbox" style={{ left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px`, pointerEvents: view?.HitboxOn === false ? 'none' : undefined }}
        onPointerEnter={() => view?.OnFocus?.()} onPointerLeave={() => view?.OnUnfocus?.()}>
        <Reticle on={!!view?.reticle} w={bw} h={bh} />
      </div>
      <Intents c={c} node={view} />
      {visible && (
        <div class="cr-state" style={{ animationDelay: `${delay}s` }}>
          <Powers c={c} node={view} bx={bx} bw={bw} />
          <HealthBar c={c} bx={bx} bw={bw} outline={block.outline} />
          {/* NCreatureStateDisplay.OnHovered: the HP label fades, the nameplate shows, the creature's tips (not while targeting) */}
          <div class="hp-hitbox" onPointerEnter={(e) => { hovered.current = true; (e.currentTarget.parentElement!.parentElement!).classList.add('hp-hover'); if (!targetManager.IsInSelection) view?.ShowHoverTips(c.HoverTips); }}
            onPointerLeave={(e) => { hovered.current = false; (e.currentTarget.parentElement!.parentElement!).classList.remove('hp-hover'); view?.HideHoverTips(); }} />
          {block.shown && (
            <div class="cr-block" style={{ left: `${bx - 30}px` }}>
              <img src={imageUrl('images/ui/combat/block.png') ?? ''} />
              <BlockLabel text={block.text} />
            </div>
          )}
          {/* NBlockBrokenVfx at the block container's centre: the halves part (0.4 s) and fade (0.6 s) */}
          {block.breaks.map((at) => (
            <div key={at} class="block-broken" style={{ left: `${bx}px` }}>
              <img class="bb-right" src={imageUrl('images/ui/combat/block_break_right.png') ?? ''} />
              <img class="bb-left" src={imageUrl('images/ui/combat/block_break_left.png') ?? ''} />
            </div>
          ))}
          <Nameplate name={safe(() => c.Name, '')} bx={bx} bw={bw} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ floating numbers
export interface Floater { id: number; x: number; y: number; text: string; kind: 'dmg' | 'heal' | 'blocked'; c?: any;
  /** rotation, scale and velocity, rolled once in _Ready */
  roll?: { rot: number; sc: number; vx: number; vy: number } }
/** NDamageNumVfx: red → cream, 2.5× → 1 while it arcs under 2000 px/s² gravity, fading over 2 s. NHealNumVfx: green,
 *  decelerating upward, gone after 1.3 s. NDamageBlockedVfx: "Blocked" rises 250 px shrinking to 0.6. */
export function FloatNumber({ f }: { f: Floater; s?: Slot }) {
  const heal = f.kind === 'heal', blocked = f.kind === 'blocked';
  const r = (f.roll ??= {
    rot: (Math.random() * 2 - 1) * (blocked ? 2 : 5), sc: blocked ? 1 : 1.2 + Math.random() * 0.1,
    vx: (Math.random() * 2 - 1) * 100, vy: heal ? -(300 + Math.random() * 300) : -(700 + Math.random() * 100),
  });
  const ref = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.go) return;
    el.dataset.go = '1';
    const inner = el.firstChild as HTMLElement;
    if (blocked) {
      el.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-250px) scale(.6)' }], { duration: 2000, easing: 'cubic-bezier(.5, 1, .89, 1)', fill: 'forwards' });
      inner.animate([{ color: '#21C0FF' }, { color: '#FFFFFF' }], { duration: 2000, easing: 'cubic-bezier(.33, 1, .68, 1)', fill: 'forwards' });
      el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 2000, easing: 'cubic-bezier(.12, 0, .39, 0)', fill: 'forwards' });
      return;
    }
    const { vx, vy } = r;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * (heal ? 1.3 : 2);
      let x = vx * t, y: number;
      if (heal) { const sp = Math.hypot(vx, vy), stop = sp / 2000, tt = Math.min(t, stop); const d = sp * tt - 1000 * tt * tt; x = (vx / sp) * d; y = (vy / sp) * d; }
      else y = vy * t + 1000 * t * t;
      const sc = heal ? (t < 0.5 ? 2.5 - 1.5 * (1 - (1 - t / 0.5) ** 2) : 1) : (t < 1.2 ? 2.5 - 1.5 * (1 - (1 - t / 1.2) ** 2) : 1);
      const op = heal ? (t < 1 ? 1 : Math.max(0, 1 - ((t - 1) / 0.3) ** 2)) : 1 - (t / 2) ** 2;
      frames.push({ offset: i / 20, transform: `translate(${x}px, ${y}px) scale(${sc})`, opacity: Math.max(0, op) });
    }
    el.animate(frames, { duration: heal ? 1300 : 2000, fill: 'forwards' });
    if (!heal) inner.animate([{ color: 'rgb(247, 43, 20)' }, { color: '#FFF6E2' }], { duration: 500, easing: 'cubic-bezier(.33, 1, .68, 1)', fill: 'forwards' });
  };
  return (
    <div class={'float-num ' + f.kind} ref={ref} style={{ left: `${f.x}px`, top: `${f.y}px` }}>
      <div style={{ transform: `rotate(${r.rot}deg) scale(${r.sc})`, color: heal ? 'rgb(35, 247, 20)' : undefined }}>{f.text}</div>
    </div>
  );
}

// ------------------------------------------------------------------ speech / thought bubbles
export interface Bubble { id: number; c: any; pos: [number, number] | null; text: string; thought?: boolean; secs?: number | null; color?: number[]; side?: number }
/** GetCreatureSpeechPosition for a bubble made without one (TalkPos, else above the centre and out to the front). */
function talkAnchor(c: any, s: Slot | undefined): [number, number] {
  if (!s) return [960, 400];
  const tp = info(c).talkPos;
  if (tp) return [s.x + tp[0] * s.s, s.y + tp[1] * s.s];
  const cp = info(c).centerPos ?? [0, -s.h / s.s / 2];
  return [s.x + cp[0] * s.s + (c.IsPlayer ? 1 : -1) * (s.w / s.s) * 0.75, s.y + cp[1] * s.s - (s.h / s.s) * 0.375];
}
export function SpeechBubble({ b, s }: { b: Bubble; s: Slot | undefined }) {
  const [x, y] = b.pos ?? (b.c ? talkAnchor(b.c, s) : [960, 400]);
  // DialogueSide: players speak to the right of the anchor (Left), enemies to its left (Right = 2)
  const left = b.side ? b.side !== 2 : !b.c || b.c.IsPlayer;
  return b.thought ? <ThoughtBubble b={b} x={x} y={y} left={left} /> : <Speech b={b} x={x} y={y} left={left} />;
}
/** visible_ratio: the first ⌊ratio · N⌋ glyphs are shown. */
const reveal = (gl: HTMLElement[], ratio: number) => { const n = Math.floor(ratio * gl.length); gl.forEach((g, i) => { g.style.visibility = i < n ? '' : 'hidden'; }); };
/**
 * NSpeechBubbleVfx: Container (0, −1) (−155 for DialogueSide.Right), Contents bobbing y = sin(t) · 2 (t from 3.14,
 * 4.5 / s), speech_bubble3 at (62, −47) (flipped for Right) with its shadow, the text (280 × 130 at (−78, −131),
 * [fly_in ±60, 40], 18–24 px). α 0 → 1 and the text revealed over 0.4 s, the bubble 0.25 → 0.75 (0.5 s Expo Out), 7° → 0
 * (0.3 s Sine Out); after max(seconds − 1, 1) it goes to transparent black (0.4 s Sine Out).
 */
function Speech({ b, x, y, left }: { b: Bubble; x: number; y: number; left: boolean }) {
  const root = useRef<HTMLDivElement>(null), contents = useRef<HTMLDivElement>(null), bubble = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null);
  useFit(text, `sb|${b.text}`, 24, 18, (el) => (el.firstChild as HTMLElement).offsetHeight <= 130);
  useLayoutEffect(() => {
    const gl = text.current ? glyphs(text.current) : [];
    const o = { A: 0, V: 1, Ratio: 0, Scale: 0.25, Rot: 7 };
    let bob = 3.14;
    const paint = () => {
      const r = root.current;
      if (!r) return;
      r.style.opacity = String(o.A);
      r.style.rotate = `${o.Rot}deg`;
      r.style.filter = o.V < 1 ? `brightness(${o.V})` : '';
      contents.current!.style.translate = `0 ${Math.sin(bob) * 2}px`;
      bubble.current!.style.scale = String(o.Scale);
      reveal(gl, o.Ratio);
    };
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'a', 1, 0.4).From(0);
    t.TweenProperty(o, 'ratio', 1, 0.4).From(0);
    t.TweenProperty(o, 'scale', 0.75, 0.5).From(0.25).SetEase(1).SetTrans(5);
    t.TweenProperty(o, 'rot', 0, 0.3).From(7).SetEase(1).SetTrans(1);
    t.Chain();
    t.TweenInterval(Math.max((b.secs ?? 2) - 1, 1));
    t.Chain();
    t.TweenProperty(o, 'a', 0, 0.4).SetEase(1).SetTrans(1);
    t.TweenProperty(o, 'v', 0, 0.4).SetEase(1).SetTrans(1);
    paint();
    const stop = $.onFrame((dt: number) => { bob += dt * 4.5; paint(); return true; });
    return () => { stop(); t.Kill(); };
  }, []);
  const src = imageUrl('images/packed/vfx/speech_bubble3.png') ?? '';
  const hsv = b.color ?? [1, 0.9, 0.5];
  return (
    <div class="speech-bubble" ref={root} style={{ left: `${x}px`, top: `${y}px`, opacity: 0 }}>
      <div class="sb-contents" ref={contents} style={{ left: `${left ? 0 : -155}px` }}>
        <div class="sb-bubble" ref={bubble}>
          <img class="speech-shadow" src={src} style={{ transform: left ? undefined : 'scaleX(-1)' }} />
          <img class="speech-img" src={src} style={{ filter: hsvFilter(hsv[0], hsv[1], hsv[2]), transform: left ? undefined : 'scaleX(-1)' }} />
        </div>
        <div class="speech-text" ref={text}><RichText text={`[center][fly_in offset_x=${left ? -60 : 60} offset_y=40]${b.text}[/fly_in][/center]`} /></div>
      </div>
    </div>
  );
}

/**
 * vfx_thought_bubble.tscn's GPUParticles2D, in tree order, relative to Contents (the Seg* under Tail at (−8, 15), mirrored
 * for DialogueSide.Right): emission ring (radius, height, axis) × emission_shape_scale, random angle and spin, scale range,
 * scale / alpha curves over the lifetime, 2 × 2 frames of smoke_vfx_flat (random, no animation), node modulate × colour.
 */
const TAIL_SCALE = [[0, 0.811143, 0, 2.2437], [0.158608, 1, 0, 0], [1, 0.791828, -0.408964, 0]];
const TAIL_ALPHA = [[0, 0, 0, 5.63128], [0.416863, 1, 0, 0], [0.568986, 1, 0, 0], [1, 0, -5.81431, 0]];
const GREY = [0.32 * 0.88, 0.4 * 0.88, 0.4 * 0.88];
interface SmokeDef { x: number; y: number; tail: boolean; n: number; life: number; pre: number; speed: number; r: number; h: number; axis: number[]; k: number[]; w: number; s: number[]; scale: number[][]; alpha: number[][]; col: number[] }
const tailSeg = (x: number, y: number, n: number, h: number, axis: number[], s: number[], a: number): SmokeDef =>
  ({ x, y, tail: true, n, life: 2, pre: 1, speed: 1, r: 4, h, axis, k: [1, 1.5], w: 20, s, scale: TAIL_SCALE, alpha: TAIL_ALPHA, col: [...GREY, a] });
const SMOKE: SmokeDef[] = [
  { x: 0, y: -66, tail: false, n: 32, life: 2.5, pre: 0, speed: 1, r: 128, h: 64, axis: [1, 32, 1], k: [1.1, 1.54], w: 50, s: [0.9, 1.1],
    scale: [[0, 1, 0, 0], [1e-5, 0.729591, 3.3025, 3.3025], [0.245873, 1, 0, 0], [1, 0.740322, -0.873548, 0]],
    alpha: [[0, 0, 0, 2.32029], [0.497052, 1, 0, 0], [1, 0, -1.96676, 0]], col: [0.1625, 0.247083, 0.25, 0.752941] },
  tailSeg(-5, -6, 2, 40.575, [-1.5, 1, 0], [0.55, 0.75], 0.752941),
  tailSeg(-27, 32, 12, 40.575, [-1.5, 1, 0], [0.35, 0.4], 0.752941),
  tailSeg(-60, 55, 6, 40, [-5, 1, 0], [0.2, 0.22], 0.501961),
  tailSeg(-85, 59, 6, 40.575, [-10, 1, 0], [0.1, 0.11], 0.25098),
  { x: 0, y: -66, tail: false, n: 96, life: 3, pre: 1.5, speed: 0.8, r: 128, h: 64, axis: [1, 32, 1], k: [1, 1.4], w: 20, s: [1, 1.02],
    scale: TAIL_SCALE, alpha: [[0, 0, 0, 1.26287], [0.396816, 1, 0, 0], [0.599646, 1, 0, 0], [1, 0, -1.93307, 0]], col: [...GREY, 0.752941] },
];
const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** EMISSION_SHAPE_RING: a random point of the ring around the axis, spread along it by the height, then scaled (z dropped). */
function ringPoint(e: SmokeDef): [number, number] {
  const ax = norm(e.axis);
  const o = norm(Math.abs(ax[0]) === 1 ? cross(ax, [0, 1, 0]) : cross(ax, [1, 0, 0])), q = cross(ax, o);
  const th = Math.random() * 2 * Math.PI, rr = Math.sqrt(Math.random() * e.r * e.r), hh = Math.random() * e.h - e.h / 2;
  const c = Math.cos(th), s = Math.sin(th);
  return [((o[0] * c + q[0] * s) * rr + hh * ax[0]) * e.k[0], ((o[1] * c + q[1] * s) * rr + hh * ax[1]) * e.k[1]];
}
/** smoke_vfx_flat multiplied by a particle colour (rgb), once per colour. */
let smokeImg: HTMLImageElement | null = null;
const tinted = new Map<string, HTMLCanvasElement>();
function smokeTex(col: number[]): HTMLCanvasElement | null {
  if (!smokeImg) { smokeImg = new Image(); smokeImg.src = imageUrl('images/vfx/shared_use/smoke_vfx_flat.png') ?? ''; }
  if (!smokeImg.complete || !smokeImg.naturalWidth) return null;
  const key = col.slice(0, 3).join();
  let cv = tinted.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = smokeImg.naturalWidth; cv.height = smokeImg.naturalHeight;
    const g = cv.getContext('2d')!;
    g.drawImage(smokeImg, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] *= col[0]; d.data[i + 1] *= col[1]; d.data[i + 2] *= col[2]; }
    g.putImageData(d, 0, 0);
    tinted.set(key, cv);
  }
  return cv;
}
/** The canvas under the bubble's text: (−330, −210) … (340, 120) around the bubble's origin. */
const SMOKE_BOX = [-330, -210, 670, 330];
class ThoughtSmoke {
  private t = 0;
  private ps = SMOKE.map((e) => Array.from({ length: e.n }, () => ({ cycle: -1, x: 0, y: 0, ang: 0, w: 0, sc: 1, fr: 0 })));
  constructor(private cv: HTMLCanvasElement, private left: boolean) {}
  step(dt: number) {
    this.t += dt;
    const g = this.cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    const cx = (this.left ? 58 : -97) - SMOKE_BOX[0], cy = -SMOKE_BOX[1], m = this.left ? 1 : -1;
    SMOKE.forEach((e, k) => {
      const img = smokeTex(e.col);
      if (!img) return;
      const fw = img.width / 2, fh = img.height / 2, time = e.pre + this.t * e.speed;
      this.ps[k].forEach((p, i) => {
        const rel = time - (i / e.n) * e.life;
        if (rel < 0) return;
        const cycle = Math.floor(rel / e.life), age = rel - cycle * e.life;
        if (cycle !== p.cycle) {
          p.cycle = cycle;
          [p.x, p.y] = ringPoint(e);
          p.ang = Math.random() * 360; p.w = (Math.random() * 2 - 1) * e.w; p.sc = e.s[0] + Math.random() * (e.s[1] - e.s[0]);
          p.fr = Math.min(3, Math.floor(Math.random() * 4));
        }
        const tv = age / e.life, a = e.col[3] * curveAt(e.alpha, tv);
        if (a <= 0) return;
        const sc = p.sc * curveAt(e.scale, tv), rot = ((p.ang + p.w * age) * Math.PI) / 180, co = Math.cos(rot) * sc, si = Math.sin(rot) * sc;
        // Tail (−8, 15) scaled (−1, 1) on the Right: the segment and its particles mirror
        const mx = e.tail ? m : 1, px = e.tail ? -8 + m * (e.x + p.x) : e.x + p.x, py = e.tail ? 15 + e.y + p.y : e.y + p.y;
        g.globalAlpha = Math.min(1, a);
        g.setTransform(mx * co, si, -mx * si, co, cx + px, cy + py);
        g.drawImage(img, (p.fr % 2) * fw, Math.floor(p.fr / 2) * fh, fw, fh, -64, -64, 128, 128);
      });
    });
  }
}
/**
 * NThoughtBubbleVfx: Container (0, −1) (Right: −155) with Contents at (58, 1): the smoke, the tail and the text (280 × 130
 * at (−137, −124), [fly_in ±30, 40], 18–24 px, α 0.9). It scales 0.75 → 1 (0.25 s Back Out) and fades in (0.25 s Cubic Out),
 * the text revealed over 0.4 s; after max(seconds, 1) GoAway fades it out (0.4 s Sine Out).
 */
function ThoughtBubble({ b, x, y, left }: { b: Bubble; x: number; y: number; left: boolean }) {
  const root = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  useFit(text, `tb|${b.text}`, 24, 18, (el) => (el.firstChild as HTMLElement).offsetHeight <= 130);
  useLayoutEffect(() => {
    const gl = text.current ? glyphs(text.current) : [];
    const o = { A: 0, S: 0.75, Ratio: 0 };
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'ratio', 1, 0.4).From(0);
    t.TweenProperty(o, 'a', 1, 0.25).SetEase(1).SetTrans(7);
    t.TweenProperty(o, 's', 1, 0.25).SetEase(1).SetTrans(10);
    const smoke = new ThoughtSmoke(canvas.current!, left);
    let waited = 0, out: any = null;
    const paint = () => {
      const r = root.current;
      if (!r) return;
      r.style.opacity = String(o.A);
      r.style.scale = String(o.S);
      reveal(gl, o.Ratio);
    };
    paint();
    const stop = $.onFrame((dt: number) => {
      waited += dt;
      if (!out && b.secs != null && waited >= Math.max(b.secs, 1)) {
        t.Kill();
        out = new $.WebTween();
        out.TweenProperty(o, 'a', 0, 0.4).SetEase(1).SetTrans(1);
      }
      smoke.step(dt);
      paint();
      return true;
    });
    return () => { stop(); t.Kill(); out?.Kill(); };
  }, []);
  const cx = left ? 58 : -97;
  return (
    <div class="thought-bubble" ref={root} style={{ left: `${x}px`, top: `${y}px`, opacity: 0 }}>
      <canvas class="thought-smoke" ref={canvas} width={SMOKE_BOX[2]} height={SMOKE_BOX[3]} style={{ left: `${SMOKE_BOX[0]}px`, top: `${SMOKE_BOX[1]}px` }} />
      <div class="thought-text" ref={text} style={{ left: `${cx - 137}px` }}><RichText text={`[center][fly_in offset_x=${left ? -30 : 30} offset_y=40]${b.text}[/fly_in][/center]`} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ power VFX
/**
 * NPowerAppliedVfx at the creature's CenterPos: the power's big icon (256 px, α ½, with an additive 1.1× echo) grows
 * 0.4 → 0.8 over 1.25 s (Expo Out) while it fades in to ½ (0.25 s) and out (1 s); the name (Kreon Bold 48, green for a
 * buff, red for a debuff) starts 200 px up and drops 50 px (1.25 s Cubic Out), in over 0.25 s and out over 0.75 s.
 * NPowerFlashVfx (power_flash_vfx, additive, strength 1) at CenterPos: the big icon at 0.4 for 0.4 s, 0.4 → 0.45 over
 * 0.4 s, then out over 0.25 s (Sine In). NPowerRemovedVfx at the top of the hitbox: the additive icon (α 0.75) beside
 * the name and "Wears Off" (Kreon Bold 32 / 24), rising to −160 over 2 s (Quart Out), fading after 0.75 s over 1 s.
 */
export function PowerPop({ p }: { p: PowerPopData }) {
  const src = imageUrl(p.icon) ?? imageUrl('images/powers/missing_power.png') ?? '';
  if (p.kind === 'flash') return <div class="power-flash-vfx" style={{ left: `${p.x}px`, top: `${p.y}px` }}><img src={src} style={{ filter: flashFilter(1) }} /></div>;
  if (p.kind === 'removed') {
    return (
      <div class="power-removed" style={{ left: `${p.x}px`, top: `${p.y}px` }}>
        <div class="prm-box">
          <img src={src} />
          <div class="prm-text"><div class="prm-name">{p.title}</div><div class="prm-sub">{p.sub}</div></div>
        </div>
      </div>
    );
  }
  return (
    <div class="power-pop" style={{ left: `${p.x}px`, top: `${p.y}px` }}>
      <div class="pp-icon"><img src={src} /><img class="pp-echo" src={src} /></div>
      <div class="pp-label" style={{ color: p.buff ? '#7FFF00' : '#FF5555' }}>{p.title}</div>
    </div>
  );
}
