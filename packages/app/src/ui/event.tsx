// NEventRoom's layouts (views in bridge.ts: EventRoomView): the default layout (full-screen portrait with its VFX,
// title, typewriter description, sliding option buttons), the combat layout (a visual-only combat room with the text
// above and the options bottom left) and the ancient layout (background scene, name banner, dialogue bubbles).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G, $, list } from '../game';
import { invalidate } from '../store';
import { imageUrl, anyImage, frameStyle } from '../assets';
import { playOneShot, playLoop, stopLoop } from '../audio';
import { loc } from '../i18n';
import { RichText } from './richtext';
import { setTip, setTips, hoverTipsOf, logicalRect } from './tooltip';
import { Backdrop } from './backdrop';
import { CombatScreen } from './combat';
import { eventPortrait, fullScreenScene } from '../render/scene';
import { Container, Matrix } from 'pixi.js';
import { tint } from '../filters';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (ls: any) => safe(() => ls?.GetFormattedText?.() ?? String(ls ?? ''), '');
const fastMode = () => safe(() => G.SaveManager.Instance.PrefsSave.FastMode, G.FastModeType.Normal);
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)', BACK_OUT = 'cubic-bezier(0.34, 1.56, 0.64, 1)', SINE_OUT = 'cubic-bezier(0.61, 1, 0.88, 1)';
const img = (p: string) => imageUrl(p) ?? '';
const col = (c: any) => (c ? `rgba(${Math.round(c.R * 255)}, ${Math.round(c.G * 255)}, ${Math.round(c.B * 255)}, ${c.A ?? 1})` : 'transparent');

export function EventScreen({ view }: { view: any }) {
  if (view.layout === 'combat') return <CombatLayout view={view} />;
  if (view.layout === 'ancient') return <AncientLayout view={view} />;
  return <DefaultLayout view={view} />;
}

// ------------------------------------------------------------------ NEventLayout (default)
function DefaultLayout({ view }: { view: any }) {
  const ev = view.event;
  const id = safe(() => String(ev.Id.Entry).toLowerCase(), '');
  const title = useRef<HTMLDivElement>(null);
  useTitleFade(title, view.descGen);
  return (
    <div class="event event-default" data-shake>
      <Backdrop id={`event:${id}:${view.portrait}`} build={() => eventPortrait(view.portrait, `scenes/vfx/events/${id}_vfx.tscn`)} />
      <div class="ev-column">
        <div class="ev-title" ref={title}>{view.title}</div>
        <div class="ev-desc"><Typewriter text={view.description} gen={view.descGen} /></div>
        <div class="ev-spacer" />
        <div class="ev-options">
          {view.options.map((o: any, i: number) => <OptionButton view={view} o={o} i={i} key={`${view.optionsGen}:${i}`} />)}
        </div>
      </div>
    </div>
  );
}
/** NEventLayout.AnimateIn: after 0.5 s (0.2 fast) the title fades to white over 0.5 s (0.25), once. */
function useTitleFade(ref: { current: HTMLElement | null }, gen: number) {
  useEffect(() => {
    if (!gen || !ref.current || ref.current.dataset.shown) return;
    ref.current.dataset.shown = '1';
    const fast = fastMode() === G.FastModeType.Fast;
    ref.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fast ? 250 : 500, delay: fast ? 200 : 500, fill: 'both' });
  }, [gen]);
}
/**
 * The description: it fades in over 1 s while visible_ratio goes 0 → 1 (Sine Out), 0.25 s after a 0.5 s pause (fast:
 * 0.2 + 0.25, over 0.5 s). Glyphs are revealed in reading order, taking their place from the start.
 */
function Typewriter({ text, gen }: { text: string; gen: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !gen) return;
    const glyphs: HTMLElement[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
      const n = walker.currentNode as any;
      if (n.nodeType === 3) texts.push(n);
      else if (n.tagName === 'IMG') glyphs.push(n);
    }
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const ch of t.textContent ?? '') { const s = document.createElement('span'); s.textContent = ch; frag.appendChild(s); }
      t.replaceWith(frag);
    }
    // document order: images and characters interleaved
    const all = Array.from(root.querySelectorAll<HTMLElement>('span:not(:has(*)), img'));
    all.forEach((e) => { e.style.visibility = 'hidden'; });
    const fast = fastMode() === G.FastModeType.Fast;
    const delay = (fast ? 0.2 : 0.5) + 0.25, dur = fast ? 0.5 : 1;
    root.style.opacity = '0';
    let t = 0, shown = 0;
    const stop = $.onFrame((dt: number) => {
      t += dt;
      const k = Math.min(1, Math.max(0, (t - delay) / dur));
      root.style.opacity = String(k);
      const n = Math.round(Math.sin((k * Math.PI) / 2) * all.length);
      for (; shown < n; shown++) all[shown].style.visibility = '';
      return k < 1;
    });
    return () => { stop(); };
  }, [gen]);
  return <div class="ev-typewriter" ref={ref} key={gen}><RichText text={text} /></div>;
}

/**
 * NEventOptionButton (800 × 100; ancients 1000 × 100): the event_button nine-patch in the event's ButtonColor,
 * "[gold][b]title[/b][/gold]\ndescription" (red when locked). Button i slides in from −60 px (0.5 s Back Out) after
 * 0.5 + 0.2·i s and only takes clicks then; ancient options appear at once.
 */
function OptionButton({ view, o, i, ancient }: { view: any; o: any; i: number; ancient?: boolean }) {
  const ev = view.event;
  const el = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const [on, setOn] = useState(false);
  const [v, setV] = useState(0.9);
  const locked = !!o.IsLocked;
  const kills = safe(() => !!o.WillKillPlayer?.(ev.Owner), false);
  // _Ready: the event's vars go into the option's texts once
  if (!o.$varsAdded) { o.$varsAdded = true; safe(() => { ev.DynamicVars.AddTo(o.Description); ev.DynamicVars.AddTo(o.Title); }, undefined); }
  const title = fmt(o.Title), desc = fmt(o.Description);
  const text = !title ? desc : `[${locked ? 'red' : 'gold'}][b]${title}[/b][/${locked ? 'red' : 'gold'}]\n${desc}`;
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    if (ancient || fastMode() === G.FastModeType.Instant) { setOn(true); return; }
    const fast = fastMode() === G.FastModeType.Fast;
    const delay = (fast ? 250 : 500) + (fast ? 100 : 200) * i, dur = fast ? 250 : 500;
    e.animate([{ translate: '-60px 0' }, { translate: '0 0' }], { duration: dur, delay, easing: BACK_OUT, fill: 'backwards' });
    const a = e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay, fill: 'backwards' });
    a.onfinish = () => setOn(true);
  }, []);
  const active = on && !view.disabled && !locked;
  const scale = st === 'press' ? 0.99 : st === 'hover' ? 1.01 : 1;
  const bright = locked ? 0.65 : v;
  const color = safe(() => ev.ButtonColor, null);
  return (
    <div class={'event-option' + (ancient ? ' ancient' : '') + (locked ? ' locked' : '') + (st === 'hover' ? ' hover' : '')} ref={el}
      style={{ scale: String(scale), transition: st === 'hover' ? 'scale .05s linear' : `scale .5s ${EXPO_OUT}` }}
      onPointerEnter={() => {
        if (locked || !on) return;
        setSt('hover'); setV(1.2);
        playOneShot('event:/sfx/ui/clicks/ui_hover');
        const r = logicalRect(el.current);
        const combat = view.layout === 'combat';
        if (r) setTips(hoverTipsOf(o), { kind: 'align', rect: r, align: combat ? 'right' : 'left' });
      }}
      onPointerLeave={() => { if (st) { setSt(''); setV(0.9); } setTip(null); }}
      onPointerDown={(e) => { if (e.button === 0 && active) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press' && active) { setSt('hover'); setTip(null); view.OptionButtonClicked(o, i); } }}>
      {!ancient && <div class={'eo-kill' + (kills ? (st === 'hover' ? ' pulse' : ' on') : '')} style={maskBox('images/packed/common_ui/event_button_sdf.png', '125.5 114.5 125.5 118.5 fill / 251px 229px 251px 237px')} />}
      {!ancient && <div class="eo-shadow" style={{ WebkitMaskImage: `url(${EB('images/packed/common_ui/event_button_outline.png')})` }} />}
      <div class="eo-outline" style={{
        ...(ancient ? maskBox('images/packed/common_ui/ancient_event_option_button_outline.png', '44 fill / 44px') : { WebkitMaskImage: `url(${EB('images/packed/common_ui/event_button_outline.png')})` }),
        opacity: st === 'hover' ? 0.75 : 0, transition: st === 'hover' ? 'opacity .05s linear' : 'opacity .3s linear',
      }} />
      {ancient
        ? <div class="eo-image" style={{ ...maskBox('images/packed/common_ui/ancient_event_option_button.png', '34 fill / 34px'), backgroundColor: col(color) }} />
        : <div class="eo-image" style={{
          backgroundImage: `url(${EB('images/packed/common_ui/event_button.png')})`, opacity: color?.A ?? 0.9,
          filter: `${locked ? 'hue-rotate(173deg) saturate(.2) ' : ''}brightness(${bright})`, transition: st === 'hover' ? 'none' : `filter .5s ${EXPO_OUT}`,
        }} />}
      {ancient && o.Relic && <RelicIcon relic={o.Relic} />}
      <div class="eo-text" style={{ opacity: locked ? 0.7 : 1, left: ancient ? (o.Relic ? '92px' : '32px') : '42px' }}><RichText text={text} /></div>
    </div>
  );
}
/** A white nine-patch texture as a mask (the element's background colour is the modulate). */
const maskBox = (path: string, slice: string) => ({ WebkitMaskBoxImage: `url(${img(path)}) ${slice}` } as any);
/**
 * Godot's NinePatchRect drawn to a canvas, for event_button (284 × 110, margins 192 / 50): its left and right margins
 * overlap, so the middle strip samples the texture backwards and the vertical middle collapses. `scale` is the file's
 * resolution (0.5 for @0.5x). Returns a data URL once the texture has loaded.
 */
const patches = new Map<string, string>();
function ninePatch(path: string, w: number, h: number, m: [number, number, number, number], scale = 0.5): string {
  const key = `${path}|${w}|${h}`;
  const got = patches.get(key);
  if (got !== undefined) return got;
  patches.set(key, '');
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const W = im.naturalWidth / scale, H = im.naturalHeight / scale;
    const [ml, mt, mr, mb] = m;
    const xs: [number, number, number, number][] = [[0, ml, 0, ml], [ml, W - mr, ml, w - mr], [W - mr, W, w - mr, w]];
    const ys: [number, number, number, number][] = [[0, mt, 0, mt], [mt, H - mb, mt, h - mb], [H - mb, H, h - mb, h]];
    for (const [sx0, sx1, dx0, dx1] of xs) for (const [sy0, sy1, dy0, dy1] of ys) {
      if (dx1 <= dx0 || dy1 <= dy0 || sx1 === sx0 || sy1 === sy0) continue;
      g.save();
      // a reversed source span (overlapping margins) is drawn mirrored
      g.translate(sx1 < sx0 ? dx1 : dx0, sy1 < sy0 ? dy1 : dy0);
      g.scale(sx1 < sx0 ? -1 : 1, sy1 < sy0 ? -1 : 1);
      g.drawImage(im, Math.min(sx0, sx1) * scale, Math.min(sy0, sy1) * scale, Math.abs(sx1 - sx0) * scale, Math.abs(sy1 - sy0) * scale, 0, 0, dx1 - dx0, dy1 - dy0);
      g.restore();
    }
    patches.set(key, c.toDataURL());
    invalidate();
  };
  im.src = img(path);
  return '';
}
const EB = (path: string) => ninePatch(path, 800, 100, [192, 50, 192, 50]);

function RelicIcon({ relic }: { relic: any }) {
  const icon = anyImage(safe(() => relic.IconPath, '')), outline = anyImage(safe(() => relic.IconOutlinePath ?? relic.IconPath?.replace(/\.tres$/, '_outline.tres'), ''));
  const draw = (x: any, cls: string) => x && ('frame' in x ? <div class={cls} style={frameStyle(x.frame, 60, 60)} /> : <img class={cls} src={x.url} />);
  return <div class="eo-relic">{draw(outline, 'eo-relic-outline')}{draw(icon, 'eo-relic-icon')}</div>;
}

// ------------------------------------------------------------------ NCombatEventLayout
/** A visual-only combat room; the description top centre (640–1280, 120–482) and the options stacked up from y 980. */
function CombatLayout({ view }: { view: any }) {
  return (
    <div class="event event-combat">
      {view.combat && <CombatScreen view={view.combat} visualOnly />}
      {!view.hidden && (
        <>
          <div class="evc-desc"><Typewriter text={view.description} gen={view.descGen} /></div>
          <div class="evc-options">
            {view.options.map((o: any, i: number) => <OptionButton view={view} o={o} i={i} key={`${view.optionsGen}:${i}`} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ NAncientEventLayout
function AncientLayout({ view }: { view: any }) {
  const ev = view.event;
  const content = useRef<HTMLDivElement>(null), lines = useRef<HTMLDivElement>(null), opts = useRef<HTMLDivElement>(null);
  const last = view.line >= view.dialogue.length - 1;
  const clipH = last ? 720 : 640;
  // ambient loop for as long as the layout is up
  useEffect(() => {
    const bgm = safe(() => (ev.HasAmbientBgm ? ev.AmbientBgm : ''), '');
    if (bgm) playLoop(bgm);
    return () => { if (bgm) stopLoop(bgm); };
  }, [ev]);
  // SetDialogueLineAndAnimate: the content slides so the current line (and, on the last one, the options) end at the bottom
  const y = useRef<number | null>(null);
  useLayoutEffect(() => {
    const c = content.current;
    if (!c || !view.ready) return;
    const lineEls = lines.current ? Array.from(lines.current.children) as HTMLElement[] : [];
    const cur = lineEls[view.line];
    let num = cur ? cur.offsetTop + cur.offsetHeight : 0;
    if (last) num += (opts.current?.offsetHeight ?? 0) + 10;
    const from = y.current ?? clipH, to = clipH - num;
    y.current = to;
    c.style.top = `${to}px`;
    c.animate([{ top: `${from}px` }, { top: `${to}px` }], { duration: 1000, easing: EXPO_OUT });
    safe(() => { const l = view.dialogue[view.line]; if (l) playOneShot(l.GetSfxOrFallbackPath()); }, undefined);
  }, [view.line, view.ready, view.optionsGen, view.dialogue.length]);
  const advance = () => { if (!last) { playOneShot('event:/sfx/ui/clicks/ui_click'); view.line++; invalidate(); } };
  return (
    <div class="event event-ancient" data-shake>
      <Backdrop id={`ancient:${safe(() => ev.Id.Entry, '')}`} build={() => ancientBackground(ev)} />
      <AncientNameBanner ev={ev} />
      {!last && view.ready && <div class="anc-hitbox" onPointerUp={(e) => { if (e.button === 0) advance(); }} />}
      <div class="anc-clip" style={{ height: `${clipH}px` }}>
        <div class="anc-content" ref={content} style={{ top: `${y.current ?? clipH}px` }}>
          <div class="anc-dialogue" ref={lines}>
            {view.dialogue.map((l: any, i: number) => <DialogueLine ev={ev} l={l} dim={i < view.line} reached={i <= view.line} />)}
          </div>
          <div class="anc-options" ref={opts}>
            {view.options.map((o: any, i: number) => <OptionButton view={view} o={o} i={i} ancient key={`${view.optionsGen}:${i}`} />)}
          </div>
        </div>
      </div>
      {!last && view.ready && <FakeNext text={fmt(safe(() => view.dialogue[view.line]?.NextButtonText, null))} />}
    </div>
  );
}
/** NAncientBgContainer at 16:9: the background scene scaled 0.89 about the screen centre, 40 px down. */
async function ancientBackground(ev: any): Promise<Container | null> {
  const c = await fullScreenScene(`scenes/events/background_scenes/${safe(() => String(ev.Id.Entry).toLowerCase(), '')}.tscn`);
  if (!c) return null;
  const root = new Container();
  root.setFromMatrix(new Matrix().translate(-960, -540).scale(0.89, 0.89).translate(960, 580));
  root.addChild(c);
  return root;
}
/** NAncientDialogueLine: [ancient icon] [bubble in the speaker's colour with its tail] [character icon], min 800 × 68. */
function DialogueLine({ ev, l, dim, reached }: { ev: any; l: any; dim: boolean; reached: boolean }) {
  const [hot, setHot] = useState(false);
  const me = safe(() => ev.Owner.Character, null);
  const isChar = l.Speaker === G.AncientDialogueSpeaker.Character;
  const color = col(isChar ? safe(() => me.DialogueColor, null) : safe(() => ev.DialogueColor, null));
  const text = safe(() => { const t = l.LineText; me.AddDetailsTo(t); return t.GetFormattedText(); }, '');
  const charId = safe(() => String(me.Id.Entry).toLowerCase(), '');
  const ancId = safe(() => String(ev.Id.Entry).toLowerCase(), '');
  const icon = (p: string, o: string) => (
    <div class="adl-icon"><img class="adl-icon-outline" src={img(o)} /><img src={img(p)} /></div>
  );
  const np = maskBox('images/ui/dialogue_nine_patch.png', '27 28 27 28 fill / 27px 28px 27px 28px');
  const tail = { WebkitMaskImage: `url(${img('images/ui/dialogue_tail.png')})` } as any;
  return (
    <div class="adl" style={{ opacity: dim && !hot ? 0.25 : 1 }} onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)}>
      <div class="adl-slot">{!isChar && reached && icon(`images/ui/run_history/${ancId}.png`, `images/ui/run_history/${ancId}_outline.png`)}</div>
      <div class="adl-box">
        <div class="adl-shape">
          {!isChar && <div class="adl-tail"><div class="adl-sh" style={{ ...tail, left: '2px', top: '5px' }} /><div class="adl-fill" style={{ ...tail, backgroundColor: color }} /></div>}
          <div class="adl-bubble"><div class="adl-sh" style={{ ...np, left: '2px', top: '5px' }} /><div class="adl-fill" style={{ ...np, backgroundColor: color }} /></div>
          {isChar && <div class="adl-tail right"><div class="adl-sh" style={{ ...tail, left: '3px', top: '3px' }} /><div class="adl-fill" style={{ ...tail, backgroundColor: color }} /></div>}
        </div>
        <div class="adl-text" style={{ paddingLeft: `${isChar ? 20 : 48}px`, paddingRight: `${isChar ? 46 : 18}px` }}><RichText text={text} /></div>
      </div>
      <div class="adl-slot">{isChar && reached && icon(`images/ui/top_panel/character_icon_${charId}.png`, `images/ui/top_panel/character_icon_${charId}_outline.png`)}</div>
    </div>
  );
}
/** The "next" prompt (bottom right): gold Bitter italic and little_arrow bobbing +4 / −4; both fade in after 0.5 s. */
function FakeNext({ text }: { text: string }) {
  return (
    <div class="anc-next">
      {text && <div class="anc-next-label">{text}</div>}
      <div class="anc-next-arrow"><img src={img('images/packed/common_ui/little_arrow.png')} style={{ filter: tint(0.937, 0.784, 0.318) }} /></div>
    </div>
  );
}

/**
 * NAncientNameBanner: the name (Spectral Bold 72, gold, spread glyphs closing in over 3 s Expo Out while each glyph's
 * x-scale springs 0 → 1) and the epithet (Bitter italic 22, sky blue) rise from y −200 to −100 over 4 s Circ Out;
 * after a 1.5 s hold both turn red and fade, then the name docks bottom left (54 px cream, epithet 18 px at 0.5).
 */
function AncientNameBanner({ ev }: { ev: any }) {
  const root = useRef<HTMLDivElement>(null), title = useRef<HTMLDivElement>(null), epithet = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  const name: string = safe(() => fmt(ev.Title).toUpperCase(), '');
  const glyphs: string[] = Array.from(name);
  useEffect(() => {
    const o = { Y: -200, X: 0, EpY: 18, EpA: 0, Spacing: 1000, Rot: 0, TitleR: 0.937, TitleG: 0.784, TitleB: 0.318, TitleA: 1, EpR: 0.529, EpG: 0.808, EpB: 0.922 };
    const effects = safe(() => G.SaveManager.Instance.PrefsSave.TextEffectsEnabled, true);
    // GetTextCenterGlyphIndex: the glyph at the middle of the name's width
    const cv = document.createElement('canvas').getContext('2d')!;
    cv.font = "700 72px 'Spectral'";
    const adv = glyphs.map((g) => cv.measureText(g).width), total = adv.reduce((a, b) => a + b, 0);
    let acc = 0, center = 0;
    for (let i = 0; i < adv.length; i++) { if (acc + adv[i] > total / 2) { center = i + (total / 2 - acc) / adv[i]; break; } acc += adv[i]; }
    const t0 = performance.now();
    const paint = () => {
      const r = root.current, t = title.current, e = epithet.current;
      if (!r || !t || !e) return;
      r.style.translate = `${o.X}px ${o.Y}px`;
      e.style.translate = `0 ${o.EpY}px`;
      e.style.opacity = String(o.EpA);
      e.style.color = `rgb(${o.EpR * 255}, ${o.EpG * 255}, ${o.EpB * 255})`;
      t.style.opacity = String(o.TitleA);
      t.style.color = `rgb(${o.TitleR * 255}, ${o.TitleG * 255}, ${o.TitleB * 255})`;
      const spans = t.children as HTMLCollectionOf<HTMLElement>;
      const el = (performance.now() - t0) / 1000;
      for (let i = 0; i < spans.length; i++) {
        if (effects) spans[i].style.transform = `translateX(${(i + 0.5 - center) * o.Spacing}px) scaleX(${o.Rot})`;
        else spans[i].style.opacity = String(Math.min(1, Math.max(0, el * 3 - i * 0.015)));
      }
    };
    const move = new $.WebTween();
    move.TweenProperty(o, 'y', -100, 4).SetEase(1).SetTrans(9);
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'spacing', 0, 3).SetEase(1).SetTrans(5).From(1000);
    t.TweenProperty(o, 'rot', 1, 3).SetEase(1).SetTrans(11).From(0);
    t.TweenProperty(o, 'ep_y', 42, 2).SetEase(1).SetTrans(7).SetDelay(1);
    t.TweenProperty(o, 'ep_a', 1, 1).SetDelay(1.5);
    t.Chain();
    t.TweenInterval(1.5);
    t.Chain();
    for (const [k, v] of [['title_r', 1], ['title_g', 0], ['title_b', 0], ['ep_r', 1], ['ep_g', 0], ['ep_b', 0]] as [string, number][]) t.TweenProperty(o, k, v, 1).SetEase(1).SetTrans(5);
    t.TweenProperty(o, 'title_a', 0, 1).SetEase(1).SetTrans(7);
    t.TweenProperty(o, 'ep_a', 0, 1).SetEase(1).SetTrans(7);
    const stop = $.onFrame(() => { paint(); return true; });
    t.whenFinished(() => {
      move.Kill();
      Object.assign(o, { Y: -80, TitleR: 1, TitleG: 0.965, TitleB: 0.886, TitleA: 1, EpR: 1, EpG: 0.965, EpB: 0.886, EpA: 0, Spacing: 0, Rot: 1 });
      setDocked(true);
      const m = new $.WebTween().SetParallel();
      m.TweenProperty(o, 'ep_a', 0.5, 2).SetEase(1).SetTrans(9);
      m.TweenProperty(o, 'x', 48, 2).SetEase(1).SetTrans(9).From(0);
    });
    return () => { stop(); move.Kill(); t.Kill(); };
  }, [ev]);
  return (
    <div class={'anc-banner' + (docked ? ' docked' : '')} ref={root}>
      <div class="anc-epithet" ref={epithet}>
        <div class="anc-title" ref={title}>{glyphs.map((g) => <span>{g}</span>)}</div>
        <span class="anc-epithet-text">{fmt(safe(() => ev.Epithet, null))}</span>
      </div>
    </div>
  );
}
void list;
void loc;
