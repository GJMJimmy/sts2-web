// The global inspect overlays (NGame's NInspectCardScreen and NInspectRelicScreen): one big card or relic over a black
// 0.9 backstop, gold arrows through the list it was opened from (hidden at the ends, no wrap), keyword tips beside it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { G, list } from '../game';
import { invalidate } from '../store';
import { imageUrl } from '../assets';
import { loc } from '../i18n';
import { hsvFilter, tint } from '../filters';
import { Card, useFit } from './card';
import { RichText } from './richtext';
import { setTip, setTips, hoverTipsOf } from './tooltip';
import { NGoldArrowButton } from './buttons';
import { safe, fmt, hoverSfx, clickSfx, BACK_OUT, EXPO_OUT, TickboxVisual, useTick } from './comp-shared';

const upgraded = new WeakMap<any, { from: boolean; m: any }>();
const clone = (c: any) => (c.IsMutable ? c.MutableClone() : c.ToMutable());
/** NInspectCardScreen.UpdateCardDisplay: a clone upgraded with UpgradePreviewType.Deck (shown via GetDescriptionForUpgradePreview). */
export function upgradedOf(c: any) {
  const from = safe(() => c.IsUpgraded, false); // deck cards get upgraded at rest sites: rebuild then
  let u = upgraded.get(c);
  if (!u || u.from !== from) {
    const m = safe(() => {
      const m = clone(c);
      if (!m.IsUpgraded && m.IsUpgradable) { m.UpgradePreviewType = G.CardUpgradePreviewType.Deck; m.UpgradeInternal(); }
      return m;
    }, c);
    upgraded.set(c, (u = { from, m }));
  }
  return u.m;
}
/** Unticked: a clone, downgraded (CardCmd.Downgrade) when the card is upgraded. */
const downgraded = new WeakMap<any, any>();
function downgradedOf(c: any) {
  if (!safe(() => c.IsUpgraded, false)) return c;
  let m = downgraded.get(c);
  if (!m) { m = safe(() => { const d = clone(c); while (d.IsUpgraded) d.DowngradeInternal(); return d; }, c); downgraded.set(c, m); }
  return m;
}

// ------------------------------------------------------------------ state
type Open = { kind: 'card'; id: number; list: any[]; index: number; all: boolean; ticked: boolean; dir: number; gen: number; closing: boolean }
  | { kind: 'relic'; id: number; list: any[]; index: number; dir: number; gen: number; closing: boolean; unlocked: Set<any> };
let open: Open | null = null;
let gen = 0;
/** NInspectCardScreen.Open(cards, index, viewAllUpgraded) (NCardHolder.AltPressed, the card library, run history). */
export function inspectCard(cards: any[], card: any, upgrades = false) {
  const index = Math.max(0, cards.indexOf(card));
  open = { kind: 'card', id: ++gen, list: cards, index, all: upgrades, ticked: false, dir: 0, gen, closing: false };
  setCardIndex(open, index);
  invalidate();
}
/** NInspectRelicScreen.Open(relics, relic) (relic collection, run history). */
export function inspectRelic(relics: any[], relic: any) {
  const unlocked = new Set(safe(() => list(G.SaveManager.Instance.GenerateUnlockStateFromProgress().Relics), [] as any[]));
  open = { kind: 'relic', id: ++gen, list: relics, index: Math.max(0, relics.indexOf(relic)), dir: 0, gen, closing: false, unlocked };
  invalidate();
}
export const inspectActive = () => open !== null;
function setCardIndex(o: Extract<Open, { kind: 'card' }>, i: number) {
  o.index = Math.min(Math.max(0, i), o.list.length - 1);
  o.ticked = safe(() => o.list[o.index].IsUpgraded, false) || o.all;
}
function step(d: number) {
  const o = open;
  if (!o || o.closing) return;
  const i = o.index + d;
  if (i < 0 || i >= o.list.length) return; // the arrow is hidden at the ends
  if (o.kind === 'card') setCardIndex(o, i); else o.index = i;
  o.dir = d;
  o.gen = ++gen;
  invalidate();
}
function close() {
  const o = open;
  if (!o || o.closing) return;
  o.closing = true;
  if (o.kind === 'relic') relicBackstop = { from: 0.9, closedAt: performance.now() };
  setTip(null);
  invalidate();
  setTimeout(() => { if (open === o) { open = null; invalidate(); } }, 250);
}

export function InspectLayer() {
  if (!open) return null;
  return open.kind === 'card' ? <CardInspect o={open} key={open.id} /> : <RelicInspect o={open} key={open.id} />;
}

/**
 * The backstop: black, fading to 0.9 over 0.25 s from its current alpha; an NButton that closes the screen (Escape too).
 * NInspectRelicScreen keeps one backstop whose scene modulate starts opaque: its first open fades 1 → 0.9, later ones
 * from what its last Close (→ 0 over 0.25 s) left.
 */
let relicBackstop = { from: 1, closedAt: -Infinity };
const relicBackstopAlpha = () => relicBackstop.from * Math.max(0, 1 - (performance.now() - relicBackstop.closedAt) / 250);
function Backstop({ closing, scale, from }: { closing: boolean; scale?: number; from?: number }) {
  return (
    <div class={'inspect-backstop' + (closing ? ' closing' : '')} data-esc={closing ? undefined : ''}
      style={{ ...(scale ? { scale: String(scale) } : {}), ...(from !== undefined ? { '--from': String(from) } : {}) }}
      onPointerEnter={hoverSfx} onPointerDown={(e) => { if (e.button === 0) clickSfx(); }} onClick={close} />
  );
}
/** ←/→ step (ui_left / ui_right); Enter / Space toggles the upgrade preview. */
function useKeys(toggle?: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if ((e.key === 'Enter' || e.key === ' ') && toggle) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
}
/** Open: arrows slide in from 100 px toward the centre (0.25 s Back Out) and fade from black, after 0.1 s. */
function arrowIn(el: HTMLElement | null, dx: number) {
  el?.animate([{ translate: `${dx}px 0`, filter: 'brightness(0)', opacity: 0 }, { translate: '0 0', filter: 'brightness(1)', opacity: 1 }],
    { duration: 250, delay: 100, easing: BACK_OUT, fill: 'backwards' });
}

// ------------------------------------------------------------------ NInspectCardScreen
function CardInspect({ o }: { o: Extract<Open, { kind: 'card' }> }) {
  const card = o.list[o.index];
  const upgradable = safe(() => !card.IsUpgraded && card.IsUpgradable, false);
  const shown = o.ticked ? upgradedOf(card) : downgradedOf(card);
  const preview = o.ticked && upgradable;
  const showTick = safe(() => card.MaxUpgradeLevel > 0, false);
  const toggle = () => { if (!showTick || o.closing) return; o.ticked = !o.ticked; o.all = false; invalidate(); };
  const tick = useTick(o.ticked, toggle, showTick && !o.closing);
  const cardRef = useRef<HTMLDivElement>(null), left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const tipList = hoverTipsOf(shown);
  const tips = useRef(() => {});
  tips.current = () => { if (!o.closing) setTips(tipList, { kind: 'align', rect: [607, 122, 706, 836], align: 'right' }); };
  useKeys(toggle);
  useEffect(() => {
    // Open: the card grows 1.75 → 2 (0.15 s Spring, after 0.1 s) and fades in from black over 0.25 s
    cardRef.current?.animate([{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], { duration: 250 });
    cardRef.current?.animate([{ scale: '0.875' }, { scale: '1' }], { duration: 150, delay: 100, easing: BACK_OUT, fill: 'backwards' });
    arrowIn(left.current?.firstElementChild as HTMLElement, 100);
    arrowIn(right.current?.firstElementChild as HTMLElement, -100);
    const t = setTimeout(() => tips.current(), 80); // after the opening click's pointer-leave on its holder
    return () => clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    // navigate: the next card slides in from ±100 px (0.25 s Expo Out)
    if (o.dir) cardRef.current?.animate([{ translate: `${100 * o.dir}px 0` }, { translate: '0 0' }], { duration: 250, easing: EXPO_OUT });
    tips.current();
  }, [o.gen, o.ticked]);
  return (
    <div class={'inspect-screen card' + (o.closing ? ' closing' : '')} onPointerUp={() => setTimeout(() => tips.current(), 0)}
      onPointerMove={() => { if (tipList.length && !document.querySelector('.tips-viewport')) tips.current(); }}>
      <Backstop closing={o.closing} />
      <div class="ic-card" ref={cardRef}><Card card={shown} width={600} preview={preview} /></div>
      <div class="ic-arrows" ref={left}>{o.index > 0 && <NGoldArrowButton left class="inspect-arrow" style={{ left: '472px' }} onClick={() => step(-1)} />}</div>
      <div class="ic-arrows" ref={right}>{o.index < o.list.length - 1 && <NGoldArrowButton class="inspect-arrow" style={{ left: '1320px' }} onClick={() => step(1)} />}</div>
      {showTick && (
        <div class="ic-upgrade" {...tick.handlers}>
          <TickboxVisual ticked={o.ticked} st={tick.st} />
          <span class="ic-upgrade-label">{loc('card_selection', 'VIEW_UPGRADES')}</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ NInspectRelicScreen
/** SetRarityVisuals: the rarity label's colour and the frame's hsv. */
const RARITY: Record<string, [string, number[]]> = {
  None: ['#FFF6E2', [0.95, 0.25, 0.9]], Starter: ['#FFF6E2', [0.95, 0.25, 0.9]], Common: ['#FFF6E2', [0.95, 0.25, 0.9]],
  Uncommon: ['#87CEEB', [0.426, 0.8, 1.1]], Rare: ['#EFC851', [1, 0.8, 1.15]], Shop: ['#87CEEB', [0.525, 2.5, 0.85]],
  Event: ['#7FFF00', [0.23, 0.75, 0.9]], Ancient: ['#FF5555', [0.875, 3, 0.9]],
};
const rarityName = (r: number) => safe(() => Object.keys(G.RelicRarity).find((k) => G.RelicRarity[k] === r) ?? 'Common', 'Common');
/** RelicModel.BigIcon: images/relics/<id>.png, else the beta icon, else the missing-power icon. */
export const bigIcon = (r: any) => imageUrl(safe(() => r.BigIconPath, '')) ?? imageUrl(safe(() => r.BigBetaIconPath, '')) ?? imageUrl('images/powers/missing_power.png') ?? '';

function RelicInspect({ o }: { o: Extract<Open, { kind: 'relic' }> }) {
  const relic = o.list[o.index];
  const unlocked = o.unlocked.has(safe(() => relic.CanonicalInstance, null) ?? relic) || o.unlocked.has(relic);
  const seen = safe(() => G.SaveManager.Instance.IsRelicSeen(relic), true);
  const rar = rarityName(safe(() => relic.Rarity, 2));
  let name: string, rarity = '', desc: string, flavor = '', img: string, dark = false, vis = rar;
  if (!unlocked) {
    name = loc('inspect_relic_screen', 'LOCKED_TITLE'); desc = loc('inspect_relic_screen', 'LOCKED_DESCRIPTION');
    img = imageUrl('images/packed/common_ui/locked_model.png') ?? ''; vis = 'Common';
  } else if (!seen) {
    name = loc('inspect_relic_screen', 'UNDISCOVERED_TITLE'); desc = loc('inspect_relic_screen', 'UNDISCOVERED_DESCRIPTION');
    img = bigIcon(relic); dark = true;
  } else {
    name = fmt(relic.Title); rarity = loc('gameplay_ui', `RELIC_RARITY.${rar.toUpperCase()}`);
    desc = fmt(safe(() => relic.DynamicDescription, null)); flavor = fmt(safe(() => relic.Flavor, null)); img = bigIcon(relic);
  }
  const [color, hsv] = RARITY[vis] ?? RARITY.Common;
  const popup = useRef<HTMLDivElement>(null), left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const backstopFrom = useRef<number | null>(null);
  backstopFrom.current ??= relicBackstop.closedAt === -Infinity ? 1 : relicBackstopAlpha();
  const nameRef = useRef<HTMLDivElement>(null), rarRef = useRef<HTMLDivElement>(null), flavorRef = useRef<HTMLDivElement>(null);
  useFit(nameRef, `irn|${name}`, 36, 24, (el) => el.scrollWidth <= 770);
  useFit(rarRef, `irr|${rarity}`, 24, 18, (el) => el.scrollWidth <= 442);
  useFit(flavorRef, `irf|${flavor}`, 22, 18, (el) => el.scrollHeight <= 120);
  const tipList = seen ? hoverTipsOf({ HoverTips: safe(() => relic.HoverTipsExcludingRelic, null) }) : [];
  const relicTips = useRef(() => {});
  relicTips.current = () => { if (tipList.length && !o.closing) setTips(tipList, { kind: 'align', rect: [604, 155, 706, 836], align: 'right' }); else setTip(null); };
  useKeys();
  useEffect(() => {
    // Open: the popup rises 200 px (0.25 s Cubic Out) and fades in; the arrows slide in after 0.1 s
    popup.current?.animate([{ translate: '0 200px', filter: 'brightness(0)', opacity: 0 }, { translate: '0 0', filter: 'brightness(1)', opacity: 1 }],
      { duration: 250, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' });
    arrowIn(left.current?.firstElementChild as HTMLElement, 100);
    arrowIn(right.current?.firstElementChild as HTMLElement, -100);
    const t = setTimeout(() => relicTips.current(), 80);
    return () => clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    if (o.dir) popup.current?.animate([{ translate: `${100 * o.dir}px 0` }, { translate: '0 0' }], { duration: 250, easing: EXPO_OUT });
    // tips only for a seen relic: its keyword tips, right of HoverTipRect (604, 155)–(1310, 991)
    relicTips.current();
  }, [o.gen]);
  return (
    <div class={'inspect-screen' + (o.closing ? ' closing' : '')} onPointerUp={() => setTimeout(() => relicTips.current(), 0)}
      onPointerMove={() => { if (tipList.length && !document.querySelector('.tips-viewport')) relicTips.current(); }}>
      <Backstop closing={o.closing} scale={1.2} from={backstopFrom.current} />
      <div class="ir-popup" ref={popup}>
        <img class="ir-bg" src={imageUrl('images/ui/reward_screen/reward_panel.png') ?? ''} />
        <div class="ir-name" ref={nameRef}>{name}</div>
        <div class="ir-rarity" ref={rarRef} style={{ color }}>{rarity}</div>
        <img class="ir-frame-bg" src={imageUrl('images/ui/reward_screen/reward_panel.png') ?? ''} style={{ filter: tint(0.0812, 0.28, 0.2469) }} />
        <img class="ir-image" src={img} style={dark ? { filter: 'brightness(0)', opacity: 0.9 } : undefined} />
        <img class="ir-frame" src={imageUrl('images/packed/inspect_relic_screen/relic_inspect_frame.png') ?? ''} style={{ filter: hsvFilter(hsv[0], hsv[1], hsv[2]) }} />
        <div class="ir-text">
          <div class="ir-desc"><RichText text={desc} /></div>
          <div class="ir-spacer"><div class="ir-divider" /></div>
          <div class="ir-flavor" ref={flavorRef}><RichText text={flavor ? `[center]${flavor}[/center]` : ''} /></div>
        </div>
      </div>
      <div class="ic-arrows" ref={left}>{o.index > 0 && <NGoldArrowButton left class="inspect-arrow" style={{ left: '472px' }} onClick={() => step(-1)} />}</div>
      <div class="ic-arrows" ref={right}>{o.index < o.list.length - 1 && <NGoldArrowButton class="inspect-arrow" style={{ left: '1320px' }} onClick={() => step(1)} />}</div>
    </div>
  );
}
