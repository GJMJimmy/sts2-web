// The overlay stack's screens (views in bridge.ts, stack semantics in store.ts): NRewardsScreen, NCardRewardSelectionScreen,
// NChooseACardSelectionScreen, NChooseABundleSelectionScreen and the NCardGridSelectionScreen family, with the shared
// backstop under the top screen. Layout is the 1920 × 1080 viewport.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G, $, list } from '../game';
import { ui, invalidate, backstop } from '../store';
import { frameByName, frameStyle, imageUrl, anyImage, atlasFrame } from '../assets';
import { playOneShot } from '../audio';
import { loc } from '../i18n';
import { RichText } from './richtext';
import { Card } from './card';
import { setTip, setTips, hoverTipsOf, logicalRect } from './tooltip';
import { BackButton, ConfirmButton, ProceedButton } from './buttons';
import { Reticle } from './creature-ui';
import { PeekButton } from './hand-select';
import { highlightImage } from '../render/highlight';
import { inspectCard } from './cards-view';
import { RewardsView, CardRewardView, ChooseACardView, BundleView, GridSelectView, rewardListHeight } from '../bridge';
import { wheelDrag } from './scrollbar';
import { RewardGlows } from './reward-glow';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (ls: any) => safe(() => (typeof ls === 'string' ? ls : ls?.GetFormattedText?.() ?? String(ls ?? '')), '');
const TR = { Linear: 0, Sine: 1, Expo: 5, Cubic: 7, Back: 10 }, EZ = { In: 0, Out: 1 };
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const img = (p: string) => imageUrl(p) ?? '';
/** An image turned 180° (flip_h + flip_v) as a data URL, once loaded. */
const flips = new Map<string, string>();
function flipped(src: string) {
  const got = flips.get(src);
  if (got !== undefined) return got;
  flips.set(src, '');
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d')!;
    g.translate(c.width, c.height); g.scale(-1, -1); g.drawImage(im, 0, 0);
    flips.set(src, c.toDataURL());
    invalidate();
  };
  im.src = src;
  return '';
}

// ------------------------------------------------------------------ the stack
export function OverlayLayer({ fallback }: { fallback: (o: any) => any }) {
  const n = ui.overlays.length;
  return (
    <>
      {ui.overlays.map((o, i) => (
        <>
          {i === n - 1 && <div class="overlay-backstop" style={{ opacity: backstop.A }} />}
          <OverlayScreen o={o} fallback={fallback} key={o.$key ??= Math.random()} />
        </>
      ))}
    </>
  );
}
function OverlayScreen({ o, fallback }: { o: any; fallback: (o: any) => any }) {
  if (o.$hidden) return null;
  if (o instanceof RewardsView) return <RewardsScreen v={o} />;
  if (o instanceof CardRewardView) return <CardRewardScreen v={o} />;
  if (o instanceof ChooseACardView) return <ChooseACardScreen v={o} />;
  if (o instanceof BundleView) return <BundleScreen v={o} />;
  if (o instanceof GridSelectView) return <GridScreen v={o} />;
  return fallback(o);
}
/** Paint a view's tweened fx while its component is mounted (the view calls paint from its tweens). */
function usePaint(v: { paint?: () => void }, paint: () => void) {
  useLayoutEffect(() => { v.paint = paint; paint(); return () => { if (v.paint === paint) v.paint = undefined; }; });
}

// ------------------------------------------------------------------ NCommonBanner
/** reward_banner in (633,206)–(1287,368), label Kreon Bold 40; AnimateIn: alpha 0.4 s Expo Out, y +50 → 0 0.4 s Back Out. */
export function CommonBanner({ text, out }: { text: string; out?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (out) el.animate([{ opacity: 0 }], { duration: 400, easing: EXPO_OUT, fill: 'forwards' });
    else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EXPO_OUT, fill: 'forwards' });
      el.animate([{ translate: '0 50px' }, { translate: '0 0' }], { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' });
    }
  }, [out]);
  return (
    <div class="common-banner" ref={ref}>
      <img class="cb-image" src={img('images/ui/reward_screen/reward_banner.png')} />
      <div class="cb-label">{text}</div>
    </div>
  );
}

// ------------------------------------------------------------------ NRewardsScreen
function RewardsScreen({ v }: { v: RewardsView }) {
  const win = useRef<HTMLDivElement>(null), listEl = useRef<HTMLDivElement>(null);
  usePaint(v, () => {
    const w = win.current;
    if (!w) return;
    w.style.opacity = String(v.fx.WinA);
    w.style.filter = v.fx.WinV < 1 ? `brightness(${v.fx.WinV})` : '';
    w.style.translate = `0 ${v.fx.WinY}px`;
  });
  const h = rewardListHeight(v.buttons), canScroll = h >= 400, bottom = 35 - h + 400;
  // NRewardsScreen.UpdateScrollPosition: lerp to the target (dt·15), spring back past the ends (dt·12)
  useEffect(() => $.onFrame((dt: number) => {
    const s = v.scroll;
    if (Math.abs(s.y - s.target) > 0.01) { s.y += (s.target - s.y) * Math.min(1, dt * 15); if (Math.abs(s.y - s.target) < 0.5) s.y = s.target; }
    const b = 35 - rewardListHeight(v.buttons) + 400;
    if (s.target < Math.min(b, 0)) s.target += (b - s.target) * dt * 12;
    else if (s.target > Math.max(b, 0)) s.target += (35 - s.target) * dt * 12;
    if (listEl.current) listEl.current.style.top = `${s.y}px`;
  }), [v]);
  const mugged = safe(() => v.runState.CurrentRoom.GoldProportion < 1, false);
  return (
    <div class="rewards-screen" onWheel={(e) => { if (canScroll) v.scroll.target += wheelDrag(e); }}>
      <div class="rw-window" ref={win}>
        <img class="rw-bg" src={img('images/ui/reward_screen/reward_panel.png')} />
        <div class="rw-banner">
          <img src={img('images/ui/reward_screen/reward_banner.png')} />
          <div class="rw-header">{loc('gameplay_ui', mugged ? 'COMBAT_REWARD_HEADER_MUGGED' : 'COMBAT_REWARD_HEADER_LOOT')}</div>
        </div>
        {/* RewardContainerMask: the panel texture flipped both ways, tinted 0.31, clipping the list to its shape */}
        <div class="rw-mask" style={{ maskImage: `url(${flipped(img('images/ui/reward_screen/reward_panel.png'))})` }}>
          <div class="rw-mask-bg" style={{ backgroundImage: `url(${flipped(img('images/ui/reward_screen/reward_panel.png'))})` }} />
          <div class="rw-list" ref={listEl} style={{ top: `${v.scroll.y}px` }}>
            {v.buttons.map((b) => (b instanceof G.LinkedRewardSet ? <LinkedSet v={v} set={b} key={b} /> : <RewardButton v={v} r={b} key={b} />))}
          </div>
        </div>
        {canScroll && <Scrollbar value={Math.min(1, Math.max(0, v.scroll.y / bottom))} />}
      </div>
      {!v.proceedHidden && (
        <ProceedButton enabled={v.proceedOn} pulse={v.pulse} label={loc('gameplay_ui', v.skipLabel ? 'CHOOSE_CARD_SKIP_BUTTON' : 'PROCEED_BUTTON')} onClick={() => v.proceed()} />
      )}
    </div>
  );
}
/** NScrollbar (reward list): track 45 × 445 at (512, 140) of the window, the train moved by the scroll value. */
function Scrollbar({ value }: { value: number }) {
  return (
    <div class="rw-scrollbar">
      <div class="sb-track" style={frameStyle(frameByName('ui_atlas', 'scrollbar_track_center'), 45, 445)} />
      <div class="sb-train" style={{ ...frameStyle(frameByName('ui_atlas', 'scrollbar_train_large'), 45), top: `${value * 380}px` }} />
    </div>
  );
}
/** NLinkedRewardSet: a dark box around its buttons (382 wide) with chain links between them. */
function LinkedSet({ v, set }: { v: RewardsView; set: any }) {
  const rewards = list(set.Rewards);
  return (
    <div class="rw-linked">
      {rewards.map((r) => <RewardButton v={v} r={r} set={set} key={r} width={382} />)}
      {rewards.slice(1).map((_, i) => <img class="rw-chain" src={img('images/ui/reward_screen/reward_chain.png')} style={{ top: `${48 + 89 * i}px` }} />)}
    </div>
  );
}
/** NRewardButton: 402 × 86, hsv v 0.8 at first (0.9 after a hover), 1.1 hovered, 0.7 pressed; gold label on hover. */
function RewardButton({ v, r, set, width = 402 }: { v: RewardsView; r: any; set?: any; width?: number }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const [rest, setRest] = useState(0.8);
  const el = useRef<HTMLDivElement>(null);
  const busy = v.busy.has(r);
  const on = st !== '' && !busy;
  const bright = busy ? rest : st === 'press' ? 0.7 : st === 'hover' ? 1.1 : rest;
  return (
    <div class={'reward-btn' + (on ? ' hover' : '') + (r instanceof G.RelicReward ? ' relic' : '')} ref={el} style={{ width: `${width}px` }}
      onPointerEnter={() => {
        if (busy) return;
        setSt('hover');
        playOneShot('event:/sfx/ui/clicks/ui_hover');
        const rect = logicalRect(el.current);
        if (rect) setTips(hoverTipsOf(r), { kind: 'align', rect, align: 'left' });
      }}
      onPointerLeave={() => { if (st) setRest(0.9); setSt(''); setTip(null); }}
      onPointerDown={(e) => { if (e.button === 0 && !busy) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); setTip(null); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press' && !busy) { setSt(''); setRest(0.9); void v.claim(r, set, logicalRect(el.current?.querySelector('.rb-icon') ?? null)); } }}>
      <img class="rb-bg" src={img('images/ui/reward_screen/reward_item_button.png')} style={{ width: `${width - 1}px`, filter: `brightness(${bright})`, transition: st === 'hover' ? 'none' : `filter .5s ${EXPO_OUT}` }} />
      <div class="rb-icon"><RewardIcon r={r} /></div>
      <div class="rb-label" style={{ width: `${width - 86}px` }}><RichText text={fmt(safe(() => r.Description, ''))} /></div>
      <Reticle on={on} corners={[[-11, -12, 1, 1], [width - 21, -11, -1, 1], [-11, 65, 1, -1], [width - 21, 66, -1, -1]]} origin="141px 98px" />
    </div>
  );
}
/** Reward.CreateIcon at IconPosition: the reward texture, a relic's BigIcon, or the potion at 0.8. */
function RewardIcon({ r }: { r: any }) {
  const relic = safe(() => r._relic ?? r.ClaimedRelic, null), potion = safe(() => r.Potion, null);
  const pos = safe(() => r.IconPosition, null) ?? { X: 0, Y: 0 };
  if (relic) return <img class="rb-icon-img" src={img(safe(() => relic.BigIconPath, ''))} style={{ left: `${pos.X}px`, top: `${pos.Y}px` }} />;
  if (potion) {
    const p = anyImage(safe(() => potion.ImagePath, ''));
    const style = { left: `${pos.X}px`, top: `${pos.Y}px` };
    return <div class="rb-potion" style={style}>{p && ('frame' in p ? <div style={frameStyle(p.frame, 60, 60)} /> : <img src={p.url} width={60} height={60} />)}</div>;
  }
  return <img class="rb-icon-img" src={img(safe(() => r.IconPath, ''))} style={{ left: `${pos.X}px`, top: `${pos.Y}px` }} />;
}

// ------------------------------------------------------------------ card holders
/**
 * NGridCardHolder: the card at 0.8, 1.0 while hovered (at once), back over 0.5 s Expo Out; press plays ui_click, a left
 * release picks, a right release inspects. Hover tips go beside it (SetAlignmentForCardHolder).
 */
export function GridHolder({ card, x, y, scale = 0.8, hover = 1, onPick, onInspect, highlight, clickable = true, style, mode, cls }: {
  card: any; x: number; y: number; scale?: number; hover?: number; onPick?: (el: Element | null) => void; onInspect?: () => void;
  highlight?: boolean; clickable?: boolean; style?: any; mode?: number; cls?: string;
}) {
  const [hot, setHot] = useState(false);
  const pressed = useRef(-1);
  const el = useRef<HTMLDivElement>(null);
  return (
    <div class={'grid-holder' + (cls ? ` ${cls}` : '')} ref={el} style={{ left: `${x}px`, top: `${y}px`, scale: String(hot ? hover : scale), zIndex: hot ? 2 : 1, transition: hot ? 'none' : `scale .5s ${EXPO_OUT}`, ...style }}
      onPointerEnter={() => {
        setHot(true);
        playOneShot('event:/sfx/ui/clicks/ui_hover');
        setTips(hoverTipsOf(card), { kind: 'holder', rect: [x - 150 * hover, y - 211 * hover, 300 * hover, 422 * hover], x, starCost: safe(() => card.CurrentStarCost > 0 || card.HasStarCostX, false) });
      }}
      onPointerLeave={() => { setHot(false); pressed.current = -1; setTip(null); }}
      onPointerDown={(e) => { if (!clickable || pressed.current >= 0) return; if (e.button === 0 || e.button === 2) playOneShot('event:/sfx/ui/clicks/ui_click'); pressed.current = e.button; }}
      onPointerUp={(e) => {
        if (!clickable || e.button !== pressed.current) return;
        pressed.current = -1;
        if (e.button === 0) onPick?.(el.current); else onInspect?.();
      }}
      onContextMenu={(e) => e.preventDefault()}>
      <div class="gh-card">
        {highlight !== undefined && <Highlight on={highlight} />}
        <Card card={card} width={300} mode={mode} />
      </div>
    </div>
  );
}
/** NCardHighlight (cyan): width 0 → 0.075 over 0.5 s Cubic Out when shown, → 0 over 0.5 s linear when hidden. */
function Highlight({ on, color = [0, 0.957, 0.988, 0.98] }: { on: boolean; color?: number[] }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const st = useRef({ W: 0, t: null as any });
  useEffect(() => {
    const s = st.current;
    s.t?.Kill();
    const t = (s.t = new $.WebTween());
    const tw = t.TweenProperty(s, 'w', on ? 0.075 : 0, 0.5);
    if (on) tw.SetEase(EZ.Out).SetTrans(TR.Cubic);
    let frame = 0;
    return $.onFrame(() => {
      const c = cv.current;
      if (!c) return false;
      const image = highlightImage(s.W, color, ++frame, performance.now() / 1000);
      c.style.display = image ? '' : 'none';
      if (image) { const g = c.getContext('2d')!; g.clearRect(0, 0, 256, 256); g.drawImage(image, 0, 0); }
      return on || s.W > 0.0005 || t.IsValid();
    });
  }, [on]);
  return <canvas class="card-highlight" ref={cv} width={256} height={256} style={{ display: 'none' }} />;
}

// ------------------------------------------------------------------ NCardRewardSelectionScreen / NChooseACardSelectionScreen
/** The card row: holders at the row centre + fx.X, faded up from black (fx.V). */
function CardRow({ v, cards, cx, cy, onPick, hidden }: { v: any; cards: any[]; cx: number; cy: number; onPick: (c: any, el: Element | null) => void; hidden?: Set<any> }) {
  const els = useRef<(HTMLDivElement | null)[]>([]);
  usePaint(v, () => {
    v.fx.forEach((f: any, i: number) => {
      const e = els.current[i];
      if (e) { e.style.translate = `${f.X}px 0`; e.style.filter = f.V < 1 ? `brightness(${f.V})` : ''; }
    });
  });
  const shown = cards.map((c) => (hidden?.has(c) ? null : c));
  const glowProps = { cards: shown, slots: () => els.current, fade: (i: number) => v.fx[i]?.V ?? 1, node: (c: any) => v.flying?.get(c) };
  return (
    <>
      <RewardGlows {...glowProps} layer="glow" key={`g${v.gen}`} />
      <div class="card-row" key={v.gen}>
        {cards.map((c, i) => !hidden?.has(c) && (
          <div class="card-slot" ref={(e) => { els.current[i] = e; }} style={{ translate: `${v.fx[i]?.X ?? 0}px 0` }}>
            <GridHolder card={c} x={cx} y={cy} clickable={v.clickable} onPick={(el) => onPick(c, el)} onInspect={() => inspectCard([c], c)}
              cls={i === cards.findIndex((x) => safe(() => x.Type === G.CardType.Power, false)) ? 'power' : undefined} />
            {/* NCard.FlashRelicOnCard: the modifying relics' icons swell over the card (3 staggered, additive) */}
            {list(safe(() => v.results?.[i]?.ModifyingRelics, [])).map((r: any) => (
              <div class="card-relic-flash" key={v.gen} style={{ left: `${cx}px`, top: `${cy - 80}px` }}>
                {[0, 1, 2].map((k) => <div style={{ ...frameStyle(atlasFrame(safe(() => r.IconPath, '')), 160, 160), animationDelay: `${0.2 * k}s` }} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <RewardGlows {...glowProps} layer="over" key={`o${v.gen}`} />
    </>
  );
}
function CardRewardScreen({ v }: { v: CardRewardView }) {
  const alts = useRef<HTMLDivElement>(null);
  // AfterOverlayOpened: the alternatives slide down from 50 px above over 0.5 s Back Out
  useEffect(() => { alts.current?.animate([{ translate: '0 -50px' }, { translate: '0 0' }], { duration: 500, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }); }, []);
  if (!v.visible) return null;
  return (
    <div class="card-reward-screen">
      <CommonBanner text={loc('gameplay_ui', 'CHOOSE_CARD_HEADER')} />
      <CardRow v={v} cards={v.cards} cx={960} cy={616} hidden={v.taken} onPick={(c, el) => v.select(c, el)} />
      <div class="cr-alternatives" ref={alts}>
        {v.alternatives.map((a) => <AltButton text={fmt(a.Title)} onClick={() => v.alt(a)} />)}
      </div>
    </div>
  );
}
function ChooseACardScreen({ v }: { v: ChooseACardView }) {
  const skip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    skip.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: EXPO_OUT });
    skip.current?.animate([{ translate: '0 -50px' }, { translate: '0 0' }], { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }, []);
  usePaint(v, () => { const e = document.querySelector<HTMLElement>('.choose-card-screen'); if (e) e.style.opacity = String(v.A); });
  if (!v.visible) return null;
  const hide = v.peeking;
  return (
    <div class="choose-card-screen" style={{ opacity: v.A, pointerEvents: hide ? 'none' : undefined }}>
      {!hide && <CommonBanner text={loc('gameplay_ui', 'CHOOSE_CARD_HEADER')} />}
      {!hide && <CardRow v={v} cards={v.cards} cx={960} cy={600} onPick={(c) => v.select(c)} />}
      {v.canSkip && !hide && <div class="cc-skip" ref={skip}><AltButton text={loc('gameplay_ui', 'CHOOSE_CARD_SKIP_BUTTON')} onClick={() => v.skip()} /></div>}
      {G.CombatManager.Instance.IsInProgress && <div class="screen-peek"><PeekButton peeking={v.peeking} onToggle={() => { v.peeking = !v.peeking; invalidate(); }} /></div>}
    </div>
  );
}
/** NCardRewardAlternativeButton / NChoiceSelectionSkipButton: reward_skip_button art, Kreon Bold 34. No sounds. */
function AltButton({ text, onClick }: { text: string; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const s = st === 'press' ? 0.95 : st === 'hover' ? 1.05 : 1, b = st === 'press' ? 0.7 : st === 'hover' ? 1.1 : 0.9;
  const t = st === 'hover' ? 'none' : st === 'press' ? `scale .2s ${EXPO_OUT}, filter .2s ${EXPO_OUT}` : `scale .5s ${EXPO_OUT}, filter .5s ${EXPO_OUT}`;
  return (
    <div class="alt-btn" style={{ scale: String(s), transition: t }}
      onPointerEnter={() => setSt('hover')} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) setSt('press'); }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); onClick(); } }}>
      <img src={img('images/ui/reward_screen/reward_skip_button.png')} style={{ filter: `brightness(${b})`, transition: t }} />
      <div class="alt-label">{text}</div>
    </div>
  );
}

// ------------------------------------------------------------------ NChooseABundleSelectionScreen
/** Bundles at 400 px (scale 0.8, 0.85 hovered); card i of n offset (45,−45)·(n/2 − i), modulate 0.5 + 0.5·i/(n − 1). */
const bundleShade = (i: number, n: number) => 0.5 + (n > 1 ? i / (n - 1) : 0) * 0.5;
function BundleScreen({ v }: { v: BundleView }) {
  const [hot, setHot] = useState(-1);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  usePaint(v, () => { const e = document.querySelector<HTMLElement>('.bundle-screen'); if (e) e.style.opacity = String(v.A); });
  // OnBundleClicked: each card's preview holder starts where the card sat in the (hovered, 0.85) bundle and moves to its
  // slot over 0.5 s Expo Out; RemoveCardNodes whitens the cards over 0.15 s
  const scaleAtPick = useRef(0.8);
  useLayoutEffect(() => {
    if (v.picked < 0) return;
    const b = v.bundles[v.picked], n = b.length, bx = 960 + (v.picked - (v.bundles.length - 1) / 2) * 400, k = scaleAtPick.current;
    els.current.forEach((e, i) => {
      if (!e || i >= n) return;
      const dx = bx - 45 * k * (i - n / 2) - (960 + ((n - 1) / 2 - i) * 400), dy = 45 * k * (i - n / 2);
      e.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 500, easing: EXPO_OUT });
      e.animate([{ filter: `brightness(${bundleShade(i, n)})` }, { filter: 'brightness(1)' }], { duration: 150 });
    });
  }, [v.picked]);
  if (!v.visible) return null;
  const n = v.bundles.length;
  const picked = v.picked >= 0 ? v.bundles[v.picked] : null;
  return (
    <div class="bundle-screen" style={{ opacity: v.A }}>
      <CommonBanner text={loc('gameplay_ui', 'CHOOSE_A_PACK')} out={!!picked} />
      {!picked && v.bundles.map((b, i) => {
        const bx = 960 + (i - (n - 1) / 2) * 400;
        return (
          <div class="bundle" style={{ left: `${bx}px`, top: '600px', scale: String(hot === i ? 0.85 : 0.8), transition: hot === i ? 'none' : `scale .5s ${EXPO_OUT}` }}
            onPointerEnter={() => { setHot(i); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => setHot(-1)}
            onPointerUp={(e) => { if (e.button === 0) { playOneShot('event:/sfx/ui/clicks/ui_click'); scaleAtPick.current = hot === i ? 0.85 : 0.8; v.pick(i); } }}>
            {b.map((c, j) => {
              const k = b.length / 2 - j;
              return (
                <div class="bundle-card" style={{ translate: `${45 * k}px ${-45 * k}px`, filter: `brightness(${bundleShade(j, b.length)})` }}>
                  <Card card={c} width={300} style={{ left: '-150px', top: '-211px', position: 'absolute' }} />
                </div>
              );
            })}
          </div>
        );
      })}
      {picked && (
        <div class="bundle-preview">
          {picked.map((c, i) => (
            <div class="bundle-preview-card" ref={(e) => { els.current[i] = e; }}>
              <GridHolder card={c} x={960 + ((picked.length - 1) / 2 - i) * 400} y={600} scale={1} hover={1.1} onPick={() => inspectCard([c], c)} />
            </div>
          ))}
          <BackButton enabled onClick={() => v.cancel()} />
          <ConfirmButton enabled onClick={() => v.confirm(els.current.map((e) => e?.querySelector('.card') ?? null))} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ NCardGridSelectionScreen family
/** NCardGrid: five columns at x 375 + 280·c, rows 377.6 apart (a single row centred at y 460), smooth scrolling. */
function CardGrid({ v }: { v: GridSelectView }) {
  const inner = useRef<HTMLDivElement>(null);
  const s = useRef({ y: 0, target: 0, drag: false, last: 0 });
  const rows = Math.ceil(v.cards.length / 5);
  const contentH = rows * 337.6 + Math.max(0, rows - 1) * 40 + 400;
  const top = contentH < 1000 ? (1000 - contentH) / 2 : 0, bottom = contentH < 1000 ? (1000 - contentH) / 2 : 1000 - contentH;
  useEffect(() => { s.current.y = s.current.target = top; }, [v]);
  useEffect(() => $.onFrame((dt: number) => {
    const g = s.current;
    if (Math.abs(g.y - g.target) > 0.1) { g.y += (g.target - g.y) * Math.min(1, dt * 15); if (Math.abs(g.y - g.target) < 0.5) g.y = g.target; }
    if (!g.drag) {
      if (g.target < Math.min(bottom, top)) g.target += (Math.min(bottom, top) - g.target) * dt * 12;
      else if (g.target > Math.max(top, bottom)) g.target += (Math.max(top, bottom) - g.target) * dt * 12;
    }
    if (inner.current) inner.current.style.top = `${g.y}px`;
  }), [top, bottom]);
  const canScroll = !v.preview && !v.peeking;
  const y = (e: PointerEvent) => { const st = document.querySelector('.stage-root')!.getBoundingClientRect(); return (e.clientY - st.top) * (1080 / st.height); };
  useEffect(() => {
    const move = (e: PointerEvent) => { const g = s.current; if (!g.drag) return; const yy = y(e); g.target += yy - g.last; g.last = yy; };
    const up = () => { s.current.drag = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  return (
    <div class="card-grid" onWheel={(e) => { if (canScroll) s.current.target += wheelDrag(e); }}
      onPointerDown={(e) => { if (canScroll && e.button === 0) { s.current.drag = true; s.current.last = y(e); s.current.target = s.current.y; } }}>
      <div class="cg-scroll">
        <div class="cg-inner" ref={inner} style={{ top: `${s.current.y}px` }}>
          {v.cards.map((c, i) => {
            const r = Math.floor(i / 5), col = i % 5;
            const shown = v.showUpgrades && safe(() => c.IsUpgradable, false) ? upgradedClone(c) : c;
            return <GridHolder card={shown} x={225 + col * 280} y={248.8 + r * 377.6} highlight={v.selected.includes(c)} mode={shown !== c ? 2 : undefined}
              clickable={!v.preview && !v.peeking} onPick={() => v.click(c)} onInspect={() => inspectCard(v.cards, c)} key={c} />;
          })}
        </div>
      </div>
      <div class="cg-gradient" />
    </div>
  );
}
const upgrades = new WeakMap<any, any>();
/** NGridCardHolder.SetIsPreviewingUpgrade: an upgraded clone shown in the preview style. */
function upgradedClone(c: any) {
  let u = upgrades.get(c);
  if (!u) { u = safe(() => { const x = c.MutableClone(); x.UpgradeInternal(); return x; }, c); upgrades.set(c, u); }
  return u;
}
function BottomPrompt({ text, small }: { text: string; small?: boolean }) {
  return <div class={'grid-prompt' + (small ? ' small' : '')}><RichText text={text} /></div>;
}
/** NTickbox "View Upgrades" (upgrade and transform screens), scaled 0.75 at (16, 1004). */
function ViewUpgrades({ v }: { v: GridSelectView }) {
  return (
    <div class="view-upgrades" onPointerUp={(e) => { if (e.button === 0) { playOneShot('event:/sfx/ui/clicks/ui_click'); v.showUpgrades = !v.showUpgrades; invalidate(); } }}
      onPointerEnter={() => playOneShot('event:/sfx/ui/clicks/ui_hover')}>
      <div class="vu-box" style={frameStyle(frameByName('ui_atlas', v.showUpgrades ? 'checkbox_ticked' : 'checkbox_unticked'), 64, 64)} />
      <div class="vu-label">{loc('card_selection', 'VIEW_UPGRADES')}</div>
    </div>
  );
}
function GridScreen({ v }: { v: GridSelectView }) {
  if (!v.visible) return null;
  const hide = v.peeking;
  const upgradeLike = v.grid === 'upgrade' || v.grid === 'transform';
  return (
    <div class={'grid-screen' + (hide ? ' peeking' : '')}>
      {!hide && <CardGrid v={v} />}
      {!hide && <BottomPrompt text={v.grid === 'enchant' ? `[center]${v.prompt}[/center]` : v.prompt} small={v.grid === 'transform'} />}
      {!hide && upgradeLike && <ViewUpgrades v={v} />}
      {!hide && v.grid === 'enchant' && <EnchantDescription v={v} />}
      {v.grid !== 'simple' && <BackButton enabled={v.cancelable && !v.preview && !hide} onClick={() => v.close()} />}
      {v.grid !== 'upgrade' && <ConfirmButton enabled={v.confirmEnabled && !hide} onClick={() => v.confirm()} />}
      {v.preview && !hide && <GridPreview v={v} />}
      {v.peekEnabled && <div class="screen-peek"><PeekButton peeking={v.peeking} onToggle={() => v.togglePeek()} /></div>}
    </div>
  );
}
/** The preview step: remove row, upgrade before / after, transform, enchant (black 0.78, or 0.85 for multi-upgrade / enchant). */
function GridPreview({ v }: { v: GridSelectView }) {
  const sel = v.selected, n = sel.length;
  let body: any;
  if ((v.grid === 'upgrade' || v.grid === 'enchant') && v.single) {
    const card = sel[0];
    const after = v.grid === 'upgrade' ? upgradedClone(card) : enchantedClone(card, v);
    body = (
      <>
        <PreviewCard card={card} x={680} y={540} />
        <PreviewCard card={after} x={1240} y={540} mode={v.grid === 'upgrade' ? 2 : undefined} />
        <UpgradeArrows cx={960} />
      </>
    );
  } else if (v.grid === 'transform') {
    const k = Math.min(730 / (n * 300 + (n - 1) * 30), 1);
    body = (
      <>
        {sel.map((c, i) => <PreviewCard card={c} x={830 - (n - i - 0.5) * 300 * k - (n - i - 1) * 30} y={540} scale={k} />)}
        {sel.map((c, i) => <TransformAfter v={v} card={c} x={1080 + (i + 0.5) * 300 * k + i * 30} scale={k} />)}
        <UpgradeArrows cx={960} />
      </>
    );
  } else {
    // the remove / select row scales down for many cards (the upgrade and enchant rows do not)
    const k = v.grid === 'deck' ? (n > 6 ? 0.55 : n > 3 ? 0.8 : 1) : 1;
    const shown = sel.map((c) => (v.grid === 'upgrade' ? upgradedClone(c) : v.grid === 'enchant' ? enchantedClone(c, v) : c));
    body = shown.map((c, i) => <PreviewCard card={c} x={960 + (i - (n - 1) / 2) * 400 * k} y={540} scale={k} mode={v.grid === 'upgrade' ? 2 : undefined} />);
  }
  const dark = v.grid === 'enchant' || (v.grid === 'upgrade' && !v.single) ? 0.85 : 0.78;
  return (
    <div class="grid-preview">
      <div class="gp-bg" style={{ opacity: dark }} />
      {body}
      <BackButton enabled onClick={() => v.cancelPreview()} />
      <ConfirmButton enabled onClick={() => v.confirmPreview()} />
    </div>
  );
}
/** NPreviewCardHolder: hover tips, no hover scale. */
function PreviewCard({ card, x, y, scale = 1, mode }: { card: any; x: number; y: number; scale?: number; mode?: number }) {
  return (
    <div class="preview-card" style={{ left: `${x}px`, top: `${y}px`, scale: String(scale) }}
      onPointerEnter={() => setTips(hoverTipsOf(card), { kind: 'holder', rect: [x - 150 * scale, y - 211 * scale, 300 * scale, 422 * scale], x })}
      onPointerLeave={() => setTip(null)}>
      <Card card={card} width={300} mode={mode} style={{ left: '-150px', top: '-211px', position: 'absolute' }} />
    </div>
  );
}
/** NTransformPreview: the replacement, or (unknown yet) a card from the options cycling every 0.2 s. */
function TransformAfter({ v, card, x, scale }: { v: GridSelectView; card: any; x: number; scale: number }) {
  const tr = safe(() => v.toTransformation?.(card), null);
  const fixed = safe(() => tr?.Replacement ?? null, null);
  const [shown, setShown] = useState<any>(fixed ?? card);
  useEffect(() => {
    if (fixed) return;
    const opts = safe(() => list(tr?.ReplacementOptions ?? G.CardFactory.GetDefaultTransformationOptions(card, safe(() => tr.IsInCombat, false))), []);
    if (!opts.length) return;
    let order = [...opts].sort(() => Math.random() - 0.5), i = 0;
    setShown(order[0]);
    const id = setInterval(() => { i++; if (i >= order.length) { order = [...opts].sort(() => Math.random() - 0.5); i = 0; } setShown(order[i]); }, 200);
    return () => clearInterval(id);
  }, [card]);
  return <PreviewCard card={shown} x={x} y={540} scale={scale} />;
}
const enchanted = new WeakMap<any, any>();
/** NEnchantPreview: a clone with the enchantment applied (IsEnchantmentPreview). */
function enchantedClone(card: any, v: GridSelectView) {
  let e = enchanted.get(card);
  if (!e) {
    e = safe(() => {
      const c = card.CardScope.CloneCard(card), m = v.enchantment.ToMutable();
      c.EnchantInternal(m, v.enchantAmount);
      c.IsEnchantmentPreview = true;
      m.ModifyCard();
      return c;
    }, card);
    enchanted.set(card, e);
  }
  return e;
}
/** Three upgrade_arrow textures across the middle, with a black 25 % shadow 8 px down-right. */
function UpgradeArrows({ cx }: { cx: number }) {
  const a = img('images/ui/cards/upgrade_preview/upgrade_arrow.png');
  return (
    <>
      <div class="up-arrows shadow" style={{ left: `${cx - 93.5}px`, top: '515.5px' }}>{[0, 1, 2].map(() => <img src={a} />)}</div>
      <div class="up-arrows" style={{ left: `${cx - 101.5}px`, top: '507.5px' }}>{[0, 1, 2].map(() => <img src={a} />)}</div>
    </>
  );
}
/** NDeckEnchantSelectScreen's enchantment box: icon, title and description, bottom right. */
function EnchantDescription({ v }: { v: GridSelectView }) {
  const m = safe(() => { const x = v.enchantment.ToMutable(); x.Amount = v.enchantAmount; x.RecalculateValues(); return x; }, null);
  if (!m) return null;
  const icon = anyImage(safe(() => m.IconPath ?? m.Icon?.ResourcePath, ''));
  return (
    <div class="enchant-desc">
      {icon && ('frame' in icon ? <div class="ed-icon" style={frameStyle(icon.frame, 60, 60)} /> : <img class="ed-icon" src={icon.url} />)}
      <div class="ed-title">{fmt(m.Title)}</div>
      <div class="ed-body"><RichText text={fmt(m.DynamicDescription)} /></div>
    </div>
  );
}
