// NRestSiteRoom (view: RestSiteView in bridge.ts): the act's campfire with the resting characters, "What shall I do?",
// the option buttons (rest_site_button.tscn) in an HBox centred at x 960.5, the description (a text, not a tip) and the
// proceed button that only comes once an option has been used.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Container } from 'pixi.js';
import { G, $, N } from '../game';
import { overlayApp } from '../render/cardfx';
import { playSpriteVfx } from '../render/scene';
import { imageUrl } from '../assets';
import { playOneShot } from '../audio';
import { loc } from '../i18n';
import { RichText } from './richtext';
import { Backdrop } from './backdrop';
import { ProceedButton } from './buttons';
import { restSiteBackdrop } from '../render/scene';
import { tint } from '../filters';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (ls: any) => safe(() => ls?.GetFormattedText?.() ?? String(ls ?? ''), '');
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const W = 246.786, GAP = 100;

// ------------------------------------------------------------------ post-select VFX (RestSiteOption.DoLocalPostSelectVfx)
let smokeLayer: Container | null = null;
/** The rest room's VFX layer (render/vfx-cards.ts draws the NRelicFlashVfx on a rest-site character there). */
export const restVfxRoot = () => (smokeLayer && !smokeLayer.destroyed ? smokeLayer : null);
/** NRestSmokeVfx: rest_smoke_vfx at the screen centre, over the room (under the top bar); freed after 4 s. */
N('Vfx.NRestSmokeVfx').Create = () => { if (smokeLayer && !smokeLayer.destroyed) void playSpriteVfx(smokeLayer, 'vfx/rest_smoke_vfx', 960, 540); return null; };
/**
 * NDesaturateTransitionVfx: the WorldEnvironment adjustment over the whole screen, all linear — brightness 1 → 0.1,
 * contrast 1 → 0.7, saturation 1 → 0.25 over 1 s; contrast → 0.8 over the next second; everything back to 1 over the
 * third. Godot's order: c·b, mix(0.5, c, contrast), mix(avg(rgb), c, saturation).
 */
N('Vfx.NDesaturateTransitionVfx').Create = () => {
  const root = document.querySelector<HTMLElement>('.stage-root');
  if (!root) return null;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  svg.innerHTML = '<filter id="rest-desaturate" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" /></filter>';
  document.body.appendChild(svg);
  const fm = svg.querySelector('feColorMatrix')!;
  const k = { B: 1, C: 1, S: 1 };
  const t = new $.WebTween();
  t.Parallel().TweenProperty(k, 'b', 0.1, 1); t.Parallel().TweenProperty(k, 'c', 0.7, 1); t.Parallel().TweenProperty(k, 's', 0.25, 1);
  t.Chain().TweenProperty(k, 'c', 0.8, 1);
  t.Chain().TweenProperty(k, 'b', 1, 1); t.Parallel().TweenProperty(k, 'c', 1, 1); t.Parallel().TweenProperty(k, 's', 1, 1);
  root.style.filter = 'url(#rest-desaturate)';
  $.onFrame(() => {
    const a = k.C * k.B, d = (a * (1 - k.S)) / 3, m = a * k.S + d, o = 0.5 * (1 - k.C);
    fm.setAttribute('values', `${m} ${d} ${d} 0 ${o} ${d} ${m} ${d} 0 ${o} ${d} ${d} ${m} 0 ${o} 0 0 0 1 0`);
    if (t.IsValid()) return true;
    root.style.filter = '';
    svg.remove();
    return false;
  });
  return null;
};
function RestVfxLayer() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false;
    const root = new Container();
    smokeLayer = root;
    void overlayApp('rest-vfx').then((a) => {
      if (dead) return;
      a.stage.removeChildren();
      a.stage.addChild(root);
      host.current?.appendChild(a.canvas);
      a.canvas.classList.add('room-vfx-canvas');
      let drawn = false;
      $.onFrame(() => { if (dead) return false; const busy = root.children.length > 0; if (busy || drawn) a.render(); drawn = busy; return true; });
    });
    return () => {
      dead = true;
      if (smokeLayer === root) smokeLayer = null;
      root.destroy({ children: true });
      void overlayApp('rest-vfx').then((a) => { a.stage.removeChildren(); a.render(); if (a.canvas.parentElement === host.current) a.canvas.remove(); });
    };
  }, []);
  return <div class="room-vfx-host" ref={host} />;
}

export function RestScreen({ view }: { view: any }) {
  const rs = G.RunManager.Instance.State;
  const choices = useRef<HTMLDivElement>(null), intro = useRef<HTMLDivElement>(null), desc = useRef<HTMLDivElement>(null);
  const paint = () => {
    if (choices.current) choices.current.style.opacity = String(view.fx.ChoicesA);
    if (intro.current) intro.current.style.opacity = String(view.fx.IntroA);
    if (desc.current) { desc.current.style.opacity = String(view.fx.DescA); desc.current.style.top = `${view.fx.DescY}px`; }
  };
  useLayoutEffect(() => { view.paint = paint; paint(); return () => { if (view.paint === paint) view.paint = undefined; }; });
  const n = view.options.length, total = n * W + Math.max(0, n - 1) * GAP;
  return (
    <div class="rest" data-shake>
      <Backdrop id={`rest:${rs?.TotalFloor}`} build={() => restSiteBackdrop(rs, view.fireOut)} />
      <div class="rest-choices" ref={choices}>
        <div class="rest-intro" ref={intro} style={{ visibility: view.introHidden ? 'hidden' : undefined }}>
          <div class="rest-header">{loc('rest_site_ui', 'PROMPT')}</div>
          {view.options.map((o: any, i: number) => <RestButton view={view} o={o} x={960.5 - total / 2 + i * (W + GAP)} key={`${view.optionsGen}:${i}`} />)}
        </div>
        <div class="rest-desc" ref={desc}><RichText text={view.description} /></div>
      </div>
      <ProceedButton enabled={view.proceedOn} onClick={() => view.proceed()} />
      <RestVfxLayer />
    </div>
  );
}

/**
 * NRestSiteButton: the option icon (hsv; grey and dark when disabled) with a gold additive outline at 0.9, the name
 * below. Fades in from black over 0.5 s before it takes clicks. Hover: 1.1 / outline 1.0 / label +6 (0.05 s) and the
 * description; unhover eases back over 1 s Expo Out. A disabled option still shows its (red) description.
 */
function RestButton({ view, o, x }: { view: any; o: any; x: number }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const [ready, setReady] = useState(false);
  const enabled = safe(() => !!o.IsEnabled, true);
  const id = safe(() => String(o.OptionId).toLowerCase(), '');
  const text = () => fmt(o.Description);
  const scale = st === 'hover' ? 1.1 : st === 'press' ? 0.9 : 1;
  const t = st === 'hover' ? '.05s linear' : `1s ${EXPO_OUT}`;
  const v = !enabled ? 0.6 : st === 'hover' ? 1.2 : 1;
  const active = ready && !view.disabled && enabled;
  return (
    <div class="rest-btn" style={{ left: `${x}px` }}
      ref={(e) => { if (e && !e.dataset.in) { e.dataset.in = '1'; e.animate([{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], { duration: 500, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }).onfinish = () => setReady(true); } }}
      onPointerEnter={() => { if (!ready) return; setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); view.SetText(text()); }}
      onPointerLeave={() => { if (st) { setSt(''); view.FadeOutOptionDescription(); } }}
      onPointerDown={(e) => { if (e.button === 0 && active) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press' && active) { setSt('hover'); void view.select(o); } }}>
      <div class="rb-visuals" style={{ scale: String(scale), transition: `scale ${t}` }}>
        <img class="rb-outline" src={imageUrl('images/ui/rest_site/option_outline.png') ?? ''} style={{ scale: st === 'hover' ? '1' : '0.9', transition: `scale ${t}`, filter: tint(1, 0.702, 0, 0.753) }} />
        <img class="rb-icon" src={imageUrl(`images/ui/rest_site/option_${id}.png`) ?? ''} style={{ filter: `${enabled ? '' : 'grayscale(1) '}brightness(${v})`, transition: st === 'hover' ? 'none' : `filter 1s ${EXPO_OUT}` }} />
      </div>
      <div class="rb-name" style={{ translate: `0 ${st === 'hover' ? 6 : 0}px`, transition: `translate ${t}` }}>{fmt(o.Title)}</div>
    </div>
  );
}
