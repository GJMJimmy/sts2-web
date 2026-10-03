// Card grids over the run (capstone screens): the deck (NDeckViewScreen, with its four sorters) and a combat pile
// (NCardPileScreen), both on NCardGrid.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'preact/hooks';
import { G, $, list } from '../game';
import { ui, invalidate } from '../store';
import { loc } from '../i18n';
import { imageUrl, frameByName, frameStyle } from '../assets';
import { playOneShot } from '../audio';
import { hsvFilter, matFilter, tint } from '../filters';
import { RichText } from './richtext';
import { inspectCard, inspectActive, InspectLayer, upgradedOf } from './inspect';
import { GridHolder } from './overlays';
import { BackButton } from './buttons';
import { NScrollbar, wheelDrag } from './scrollbar';
import { closeCardsView } from './pause';
import { view } from '../view';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const title = (c: any) => String(safe(() => c.Title, c.Id.Entry));
const byId = (a: any, b: any) => (a.Id.Entry < b.Id.Entry ? -1 : a.Id.Entry > b.Id.Entry ? 1 : 0);

/** NDeckViewScreen: the sorter pressed last goes first in the priority list and flips direction each press. */
const deck = { priority: ['Ascending', 'TypeAscending', 'CostAscending', 'AlphabetAscending'], desc: {} as Record<string, boolean>, upgrades: false };
/** NCardHolder.AltPressed (right click) → NInspectCardScreen (ui/inspect.tsx) over whatever card list is showing. */
export { inspectCard, inspectActive, InspectLayer };
const SORTERS: [string, string][] = [['', 'SORT_OBTAINED'], ['Type', 'SORT_TYPE'], ['Cost', 'SORT_COST'], ['Alphabet', 'SORT_ALPHABET']];
function press(k: string) {
  deck.priority = deck.priority.filter((o) => o !== `${k}Ascending` && o !== `${k}Descending`);
  deck.desc[k] = !deck.desc[k];
  deck.priority.unshift(`${k}${deck.desc[k] ? 'Descending' : 'Ascending'}`);
  invalidate();
}
/** NCardGrid.SetCards with NCardGrid.SortingAlgorithms; ties fall back to the model id. */
function sorted(cards: any[], priority: string[]) {
  if (priority[0] === 'Descending') return [...cards].reverse();
  if (priority[0] === 'Ascending') return cards;
  const lang = safe(() => G.LocManager.Instance.Language, 'eng');
  const cmp: Record<string, (a: any, b: any) => number> = {
    Type: (a, b) => a.Type - b.Type,
    Cost: (a, b) => safe(() => a.EnergyCost.Canonical - b.EnergyCost.Canonical, 0),
    Alphabet: (a, b) => title(a).localeCompare(title(b), lang === 'zhs' ? 'zh' : undefined),
    '': (a, b) => cards.indexOf(a) - cards.indexOf(b),
  };
  return [...cards].sort((a, b) => {
    for (const o of priority) {
      const desc = o.endsWith('Descending');
      const n = cmp[o.replace(/(Ascending|Descending)$/, '')](a, b);
      if (n) return desc ? -n : n;
    }
    return byId(a, b);
  });
}

const PILE: Record<string, [string, string]> = {
  deck: ['Deck', 'DECK_PILE_INFO'], draw: ['Draw', 'DRAW_PILE_INFO'], discard: ['Discard', 'DISCARD_PILE_INFO'], exhaust: ['Exhaust', 'EXHAUST_PILE_INFO'],
};
// CardPool.FrameMaterial hsv per character (NDeckViewScreen tints its sort buttons with the hue)
const FRAME_H: Record<string, number> = { ironclad: 0.025, silent: 0.32, defect: 0.55, necrobinder: 0.965, regent: 0.12 };

/** NCardPileScreen (draw / discard / exhaust) and NDeckViewScreen, over the capstone backstop. */
export function CardsView() {
  const v = ui.cardsView!;
  const me = G.RunManager.Instance.State?.Players?.[0];
  if (!me) return null;
  const [pileName, info] = PILE[v.kind];
  const pile = safe(() => G.PileTypeExtensions.GetPile(G.PileType[pileName], me), null);
  let cards: any[] = list(pile?.Cards ?? []);
  const deckView = v.kind === 'deck';
  // NCardPileScreen: the draw pile is shown sorted by rarity so it does not reveal the draw order
  if (v.kind === 'draw') cards = [...cards].sort((a, b) => a.Rarity - b.Rarity || byId(a, b));
  if (deckView) cards = sorted(cards, deck.priority);
  return (
    <div class="cards-screen" key={v.kind}>
      {!deckView && <div class="cs-background" />}
      <NCardGridView cards={cards} x0={deckView ? 175 : 150} yOffset={deckView ? 100 : 0} showUpgrades={deckView && deck.upgrades}>
        {deckView && <SortBar me={me} />}
      </NCardGridView>
      <BackButton enabled onClick={closeCardsView} />
      <div class="cs-bottom"><RichText text={`[center]${loc('gameplay_ui', info)}[/center]`} /></div>
      {deckView && <ViewUpgrades />}
    </div>
  );
}

/**
 * NCardGrid: 5 columns of 0.8 cards (240 × 337.6, 40 apart) in a 1570-wide scroll container from `x0`, starting
 * YOffset + 80 down; the grid (y 80–1080) lerps to its target (15·dt), wheel ±40, drag, springs back past the ends
 * (12·dt); a short grid is centred. Black fades on the top and bottom 5 %; the scrollbar shows from ~3 rows. That is at
 * 1920 × 1080: the grid fills the screen under the top bar, with as many columns as fit its scroll container, centred.
 */
function NCardGridView({ cards, x0, yOffset, showUpgrades, children }: { cards: any[]; x0: number; yOffset: number; showUpgrades: boolean; children?: any }) {
  const scrollW = 1570 + 2 * view.ox, cols = Math.floor((scrollW + 40) / 280), cx0 = (scrollW - (cols * 280 - 40)) / 2 + 120, gridH = 1000 + 2 * view.oy;
  const rows = Math.ceil(cards.length / cols);
  const contained = rows ? rows * 337.6 + (rows - 1) * 40 : 0;
  const scrollH = contained + 80 + 320 + yOffset;
  const limTop = scrollH < gridH ? (gridH - scrollH) / 2 : 0, limBottom = scrollH < gridH ? (gridH - scrollH) / 2 : gridH - scrollH;
  const inner = useRef<HTMLDivElement>(null);
  const s = useRef({ y: limTop, target: limTop, drag: false, last: 0, bar: -1 });
  const [bar, setBar] = useState(0);
  useEffect(() => { s.current.y = s.current.target = limTop; }, [cards.length, cols, gridH]);
  useEffect(() => $.onFrame((dt: number) => {
    const g = s.current;
    if (Math.abs(g.y - g.target) > 0.1) { g.y += (g.target - g.y) * Math.min(1, dt * 15); if (Math.abs(g.y - g.target) < 0.5) g.y = g.target; }
    if (!g.drag) {
      if (g.target < Math.min(limBottom, limTop)) g.target += (Math.min(limBottom, limTop) - g.target) * dt * 12;
      else if (g.target > Math.max(limTop, limBottom)) g.target += (Math.max(limTop, limBottom) - g.target) * dt * 12;
    }
    if (inner.current) inner.current.style.top = `${g.y}px`;
    const v = limBottom < 0 ? Math.min(1, Math.max(0, g.y / limBottom)) : 0;
    if (Math.abs(v - g.bar) > 0.002) { g.bar = v; setBar(v); }
  }), [limTop, limBottom]);
  const y = (e: PointerEvent) => { const st = document.querySelector('.stage-root')!.getBoundingClientRect(); return (e.clientY - st.top) * (1080 / st.height); };
  useEffect(() => {
    const move = (e: PointerEvent) => { const g = s.current; if (!g.drag) return; const yy = y(e); g.target += yy - g.last; g.last = yy; };
    const up = () => { s.current.drag = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  return (
    <div class="ncard-grid" onWheel={(e) => { s.current.target += wheelDrag(e); }}
      onPointerDown={(e) => { if (e.button === 0) { s.current.drag = true; s.current.last = y(e); s.current.target = s.current.y; } }}>
      <div class="ncg-scroll" style={{ left: `${x0}px` }}>
        <div class="ncg-inner" ref={inner} style={{ top: `${s.current.y}px`, height: `${scrollH}px` }}>
          {children}
          {cards.map((c, i) => {
            const r = Math.floor(i / cols), col = i % cols;
            const up = showUpgrades && safe(() => c.IsUpgradable, false);
            return <GridHolder card={up ? upgradedOf(c) : c} x={cx0 + col * 280} y={248.8 + yOffset + r * 377.6} mode={up ? 2 : undefined}
              onPick={() => inspectCard(cards, c, showUpgrades)} onInspect={() => inspectCard(cards, c, showUpgrades)} key={c} />;
          })}
        </div>
      </div>
      <div class="ncg-border" />
      {scrollH > gridH + 320 && <NScrollbar x={1820 + 2 * view.ox} y={129.6} w={50} h={740 + 2 * view.oy} value={bar} onSet={(v) => { s.current.target = v * limBottom; }} />}
    </div>
  );
}

/** NDeckViewScreen's SortingOptions: the character-tinted color_tab_bar strip with the four sort buttons (it scrolls with the grid). */
function SortBar({ me }: { me: any }) {
  const h = FRAME_H[String(safe(() => me.Character.Id.Entry, '')).toLowerCase()] ?? 1;
  return (
    <div class="cv-sortbar">
      <img class="cv-sortbar-bg" src={imageUrl('images/ui/color_tab_bar.png') ?? ''} style={{ filter: matFilter(safe(() => me.Character.CardPool.FrameMaterialPath, '')) }} />
      <div class="cv-sorters">{SORTERS.map(([k, key]) => <SortButton k={k} label={loc('gameplay_ui', key)} hue={h} />)}</div>
    </div>
  );
}
/**
 * NCardViewSortButton (250 × 42): color_tab_bar (grey 0.73, hsv s / v 0.8 with the character's hue) under the label
 * (Kreon Bold 22, gold) and the sort_descending icon, flipped while ascending. Hover 1.05 and s / v 1; press squashes.
 */
function SortButton({ k, label, hue }: { k: string; label: string; hue: number }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const desc = !!deck.desc[k];
  const sv = st === 'hover' ? 1 : 0.8;
  const scale = st === 'press' ? '1 0.95' : st === 'hover' ? '1.05 1.05' : '1.05 1';
  return (
    <div class="sort-btn"
      onPointerEnter={() => { setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); press(k); } }}>
      <img class="sb-img" src={imageUrl('images/ui/color_tab_bar.png') ?? ''}
        style={{ scale, filter: `brightness(.729) ${hsvFilter(hue, 1, 1)} saturate(${sv}) brightness(${sv})`, transition: st === 'hover' ? 'scale .05s linear, filter .5s cubic-bezier(0.16, 1, 0.3, 1)' : 'scale .25s cubic-bezier(0.16, 1, 0.3, 1), filter .5s cubic-bezier(0.16, 1, 0.3, 1)' }} />
      <div class="sb-row">
        <span class="sb-label">{label}</span>
        <div class="sb-icon" style={{ ...frameStyle(frameByName('ui_atlas', 'sort_descending'), 36, 36), transform: desc ? 'none' : 'scaleY(-1)', filter: tint(0.937, 0.784, 0.318) }} />
      </div>
    </div>
  );
}
/** ViewUpgrades: the tickbox (16, 1004) at 0.75 and "View Upgrades" (Kreon Bold 27, gold); unticked on every open. */
function ViewUpgrades() {
  useEffect(() => { deck.upgrades = false; invalidate(); }, []);
  const [hot, setHot] = useState(false);
  return (
    <div class="cv-upgrades"
      onPointerEnter={() => { setHot(true); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => setHot(false)}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        deck.upgrades = !deck.upgrades;
        playOneShot(deck.upgrades ? 'event:/sfx/ui/clicks/ui_checkbox_on' : 'event:/sfx/ui/clicks/ui_checkbox_off');
        invalidate();
      }}>
      <div class="cvu-tick" style={{ scale: hot ? '1.05' : '1', filter: `brightness(${hot ? 1.2 : 1})` }}>
        <div style={frameStyle(frameByName('ui_atlas', deck.upgrades ? 'checkbox_ticked' : 'checkbox_unticked'), 51.2, 51.2)} />
      </div>
      <div class="cvu-label">{loc('gameplay_ui', 'VIEW_UPGRADES')}</div>
    </div>
  );
}
