// Compendium screens pushed from NCompendiumSubmenu: the card library (NCardLibrary), relic collection
// (NRelicCollection) and potion lab (NPotionLab). All are transparent submenus over the menu blur (or the run's capstone
// backstop) with the shared back button; what is shown follows the progress save and the unlock state.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { G, list } from '../game';
import { ui, invalidate, leaveScreen } from '../store';
import { imageUrl, frameByName, frameStyle, atlasFrame } from '../assets';
import { loc, locv } from '../i18n';
import { tint } from '../filters';
import { Card, useFit } from './card';
import { RichText } from './richtext';
import { setTip, setTips, hoverTipsOf, logicalRect, type TipData } from './tooltip';
import { BackButton } from './buttons';
import { inspectCard, inspectRelic, inspectActive, upgradedOf } from './inspect';
import { safe, fmt, EXPO_OUT, BACK_OUT, hoverSfx, clickSfx, useScroller, BorderGradient, TickboxVisual, useTick, type TickState } from './comp-shared';

export { upgradedOf };
const progress = () => G.SaveManager.Instance.Progress;
const unlocks = () => G.SaveManager.Instance.GenerateUnlockStateFromProgress();
const ids = (xs: any) => new Set(list(xs).map((i: any) => String(i?.Entry ?? i)));
const lang = () => safe(() => G.LocManager.Instance.Language, 'eng');
const byTitle = (a: any, b: any) => fmt(a.Title).localeCompare(fmt(b.Title), lang() === 'zhs' ? 'zh' : undefined);
const rgba = (c: any, a: number) => tint(c.R, c.G, c.B, a);

// ================================================================== card library
const CHARS = ['IRONCLAD', 'SILENT', 'REGENT', 'NECROBINDER', 'DEFECT']; // the PoolFilters grid order
const POOL_CLASS: Record<string, string> = { IRONCLAD: 'IroncladCardPool', SILENT: 'SilentCardPool', REGENT: 'RegentCardPool', NECROBINDER: 'NecrobinderCardPool', DEFECT: 'DefectCardPool', COLORLESS: 'ColorlessCardPool' };
/** The NCardLibrary node survives between opens (NSubmenuStack caches it): the sort priority and the rarity boxes' enabled state carry over. */
const kept = { priority: ['RarityAscending', 'TypeAscending', 'CostAscending', 'AlphabetAscending'], rarityDisabled: false };
type Filters = { pool: string | null; type: Set<string>; rarity: Set<string>; cost: Set<string>; search: string; mp: boolean; stats: boolean; upgrades: boolean; desc: Record<string, boolean> };
const RARITY_VALUE = (r: number) => { const R = G.CardRarity; return r <= R.Ancient ? r : ({ [R.Status]: 6, [R.Curse]: 7, [R.Event]: 8, [R.Quest]: 9, [R.Token]: 10 } as Record<number, number>)[r] ?? 0; };
const RARITY_WORDS = () => safe(() => Object.keys(G.CardRarity).filter((k) => typeof G.CardRarity[k] === 'number').map((k) => [k.toLowerCase(), G.CardRarity[k]] as [string, number]), [] as [string, number][]);
function poolPass(pool: string | null, c: any) {
  if (!pool) return false;
  const R = G.CardRarity;
  if (pool === 'ANCIENT') return c.Rarity === R.Ancient;
  if (pool === 'MISC') return c.Rarity >= R.Event && c.Rarity <= R.Quest;
  return safe(() => c.Pool.constructor.name === POOL_CLASS[pool], false);
}
const TYPE_PASS: Record<string, (c: any) => boolean> = {
  ATTACK: (c) => c.Type === G.CardType.Attack, SKILL: (c) => c.Type === G.CardType.Skill, POWER: (c) => c.Type === G.CardType.Power,
  OTHER: (c) => ![G.CardType.Attack, G.CardType.Skill, G.CardType.Power].includes(c.Type),
};
const RARITY_PASS: Record<string, (c: any) => boolean> = {
  COMMON: (c) => c.Rarity === G.CardRarity.Common, UNCOMMON: (c) => c.Rarity === G.CardRarity.Uncommon, RARE: (c) => c.Rarity === G.CardRarity.Rare,
  OTHER: (c) => ![G.CardRarity.Common, G.CardRarity.Uncommon, G.CardRarity.Rare].includes(c.Rarity),
};
const canon = (c: any) => safe(() => c.EnergyCost.Canonical, 0);
const COST_PASS: Record<string, (c: any) => boolean> = {
  ZERO: (c) => safe(() => !!c.EnergyCost && c.EnergyCost.Canonical <= 0 && !c.EnergyCost.CostsX, false),
  ONE: (c) => canon(c) === 1, TWO: (c) => canon(c) === 2, THREE: (c) => canon(c) >= 3,
  X: (c) => safe(() => c.EnergyCost.CostsX || c.HasStarCostX, false),
};
/** NSearchBar.Normalize over Title + " " + the BBCode- and tag-stripped description. */
const haystack = (c: any, upgrades: boolean) => {
  const text = upgrades && safe(() => c.IsUpgradable, false)
    ? safe(() => upgradedOf(c).GetDescriptionForUpgradePreview(), '') : safe(() => c.GetDescriptionForPile(G.PileType.None), '');
  return `${fmt(c.Title)} ${String(text).replace(/\[(.*?)\]/g, '').replace(/<.*?>/g, '')}`.trim().replace(/[\t\r\n]/g, ' ').replace(/\s{2,}/g, ' ').toLowerCase();
};
/** NCardGrid.SortingAlgorithms under the priority list (ties by id), then the library's locked-last reorder. */
function sortCards(cards: any[], priority: string[], locked: (c: any) => boolean) {
  const lg = lang() === 'zhs' ? 'zh' : undefined;
  const cmp: Record<string, (a: any, b: any) => number> = {
    Rarity: (a, b) => RARITY_VALUE(a.Rarity) - RARITY_VALUE(b.Rarity), Cost: (a, b) => canon(a) - canon(b),
    Type: (a, b) => a.Type - b.Type, Alphabet: (a, b) => fmt(a.Title).localeCompare(fmt(b.Title), lg),
  };
  const out = [...cards].sort((a, b) => {
    for (const o of priority) {
      const n = cmp[o.replace(/(Ascending|Descending)$/, '')](a, b);
      if (n) return o.endsWith('Descending') ? -n : n;
    }
    return a.Id.Entry < b.Id.Entry ? -1 : a.Id.Entry > b.Id.Entry ? 1 : 0;
  });
  return [...out.filter((c) => !locked(c)), ...out.filter(locked)];
}

export function CardLibrary() {
  // OnSubmenuOpened: everything resets; the pool is the run character's (Ironclad outside a run)
  const data = useMemo(() => {
    const un = unlocks();
    const unlockedChars = new Set(list(un.Characters).map((c: any) => c.Id.Entry));
    const unlocked = new Set(list(G.ModelDb.AllCardPools).flatMap((p: any) => safe(() => list(p.GetUnlockedCards(un, G.CardMultiplayerConstraint.None)), [])));
    const seen = ids(progress().DiscoveredCards);
    const all = list(G.ModelDb.AllCards).filter((c: any) => safe(() => c.ShouldShowInCardLibrary, true));
    const me = ui.screen === 'run' ? safe(() => String(G.RunManager.Instance.State.Players[0].Character.Id.Entry), null) : null;
    return { unlockedChars, unlocked, seen, all, me };
  }, []);
  const f = useRef<Filters>({
    pool: data.me && CHARS.includes(data.me) ? data.me : 'IRONCLAD', type: new Set(), rarity: new Set(), cost: new Set(), search: '',
    mp: true, stats: false, upgrades: false, desc: { Type: true, Rarity: true, Cost: true, Alphabet: true },
  }).current;
  const [, rerender] = useState(0);
  const refresh = () => rerender((n) => n + 1);
  const vis = (c: any): 'visible' | 'notSeen' | 'locked' => (!data.unlocked.has(c) ? 'locked' : data.seen.has(c.Id.Entry) ? 'visible' : 'notSeen');
  /** UpdateFilter → DisplayCards */
  const compute = () => {
    const rarityOn = !!f.pool && f.pool !== 'ANCIENT' && f.pool !== 'MISC';
    const q = f.search, blank = !q.trim(), ql = q.toLowerCase();
    const word = RARITY_WORDS().find(([w]) => w === ql);
    const any = (set: Set<string>, pass: Record<string, (c: any) => boolean>, c: any) => !set.size || [...set].some((k) => pass[k](c));
    const cards = data.all.filter((c: any) => poolPass(f.pool, c) && any(f.cost, COST_PASS, c) && (!rarityOn || any(f.rarity, RARITY_PASS, c)) && any(f.type, TYPE_PASS, c)
      && (f.mp || c.MultiplayerConstraint !== G.CardMultiplayerConstraint.MultiplayerOnly)
      && (blank || (data.seen.has(c.Id.Entry) && ((word && c.Rarity === word[1]) || haystack(c, f.upgrades).includes(ql)))));
    return sortCards(cards, kept.priority, (c) => vis(c) === 'locked');
  };
  const grid = useRef<{ display: (cards: any[]) => void; out: () => void }>(null);
  const [cards, setCards] = useState<any[]>(() => compute());
  const debounce = useRef<any>(0);
  const update = (text = false) => {
    clearTimeout(debounce.current);
    if (!text) { setCards(compute()); refresh(); return; }
    grid.current?.out(); // DisplayCardsAfterShortDelay: the grid animates out at once, the cards follow 250 ms after the last keystroke
    debounce.current = setTimeout(() => setCards(compute()), 250);
  };
  useEffect(() => () => { clearTimeout(debounce.current); setTip(null); }, []);
  const pools = [...CHARS.filter((c) => data.unlockedChars.has(c)), 'COLORLESS', 'ANCIENT', 'MISC'];
  const dy = pools.length <= 4 ? -64 : 0; // one row of pool buttons: everything under them moves up
  const sorter = (k: string) => {
    f.desc[k] = !f.desc[k];
    kept.priority = kept.priority.filter((o) => !o.startsWith(k));
    // OnRaritySort is inverted: a descending button sorts ascending
    const d = k === 'Rarity' ? !f.desc[k] : f.desc[k];
    kept.priority.unshift(`${k}${d ? 'Descending' : 'Ascending'}`);
    update();
  };
  const pickPool = (p: string) => {
    f.pool = f.pool === p ? null : p; // releasing the selected pool deselects it (and nothing is left)
    kept.rarityDisabled = !f.pool || f.pool === 'ANCIENT' || f.pool === 'MISC';
    update();
  };
  const toggle = (set: Set<string>, k: string) => { if (set.has(k)) set.delete(k); else set.add(k); update(); };
  const tipAt = (key: string) => (e: PointerEvent) => {
    const r = logicalRect(e.currentTarget as Element);
    if (r) setTips([{ title: '', body: loc('card_library', key) }], { kind: 'at', x: 310, y: r[1] });
  };
  const noTip = () => setTip(null);
  const s = (k: string) => safe(() => new G.LocString().$ctor_LocString('gameplay_ui', k).GetRawText(), k);
  return (
    <div class="screen card-library">
      <LibraryGrid cards={cards} f={f} vis={vis} api={grid} />
      <div class="cl-sidebar">
        <div class="cl-shadow" />
        <div class="cl-panel" />
        <SearchBar value={f.search} onInput={(v) => { f.search = v; update(true); }} onSubmit={() => update()} />
        <div class="cl-pools">
          {pools.map((p, i) => <PoolToggle key={p} pool={p} x={16 + 64 * (i % 4)} y={76 + 64 * Math.floor(i / 4)} selected={f.pool === p}
            onClick={() => pickPool(p)} onTip={p === 'COLORLESS' ? tipAt('POOL_COLORLESS_TIP') : p === 'ANCIENT' ? tipAt('POOL_ANCIENT_TIP') : p === 'MISC' ? tipAt('POOL_MISC_TIP') : undefined} onUntip={noTip} />)}
        </div>
        <div class="cl-lower" style={{ top: `${dy}px` }}>
          <SortButton y={216} label={s('SORT_TYPE')} desc={f.desc.Type} onClick={() => sorter('Type')} />
          {['ATTACK', 'SKILL', 'POWER', 'OTHER'].map((k, i) => <TypeTickbox kind={k} x={24 + 48 * i} ticked={f.type.has(k)} onClick={() => toggle(f.type, k)} onTip={tipAt(`TYPE_${k}_TIP`)} onUntip={noTip} />)}
          <SortButton y={338} label={s('SORT_RARITY')} desc={f.desc.Rarity} onClick={() => sorter('Rarity')} />
          {['COMMON', 'UNCOMMON', 'RARE', 'OTHER'].map((k, i) => <RarityTickbox kind={k} y={384 + 38 * i} ticked={f.rarity.has(k)} disabled={kept.rarityDisabled}
            onClick={() => toggle(f.rarity, k)} onTip={tipAt(`RARITY_${k}_TIP`)} onUntip={noTip} />)}
          <SortButton y={558} label={s('SORT_COST')} desc={f.desc.Cost} onClick={() => sorter('Cost')} />
          {[['ZERO', '0'], ['ONE', '1'], ['TWO', '2'], ['THREE', '3+'], ['X', 'X']].map(([k, label], i) => <CostTickbox label={label} x={24 + 48 * i} ticked={f.cost.has(k)}
            onClick={() => toggle(f.cost, k)} onTip={tipAt(`COST_${k}_TIP`)} onUntip={noTip} />)}
          <SortButton y={666} label={s('SORT_ALPHABET')} desc={f.desc.Alphabet} onClick={() => sorter('Alphabet')} />
        </div>
        <StatTickbox y={930} label={loc('card_library', 'VIEW_MULTIPLAYER_CARDS')} ticked={f.mp} onClick={() => { f.mp = !f.mp; update(); }} />
        <StatTickbox y={976} label={loc('card_library', 'VIEW_STATS')} ticked={f.stats} onClick={() => { f.stats = !f.stats; refresh(); }} />
        <StatTickbox y={1022} label={loc('card_library', 'VIEW_UPGRADES')} ticked={f.upgrades} onClick={() => { f.upgrades = !f.upgrades; if (f.search.trim()) update(); else refresh(); }} />
      </div>
      <div class="cl-count"><RichText text={locv('card_library', 'CARD_COUNT', { Amount: cards.length })} /></div>
      {cards.length === 0 && <div class="cl-noresults">{loc('card_library', 'NO_RESULTS')}</div>}
      <BackButton enabled onClick={() => { setTip(null); leaveScreen(); }} />
    </div>
  );
}

/**
 * NCardLibraryGrid: 5 columns of 0.8 cards (centres x 474 + 280c, first row 248.8 down) in the scroll container
 * x 338–1770, top-aligned; the scrollbar shows past 3 rows. Every refilter animates the holders out (40 px down,
 * fading, 0.2 s) and back in, staggered over 0.2 s (0.4 s Back Out), for the ~5 rows the game keeps alive.
 */
function LibraryGrid({ cards, f, vis, api }: { cards: any[]; f: Filters; vis: (c: any) => string; api: any }) {
  const [shown, setShown] = useState<any[]>(cards);
  const [gen, setGen] = useState(0);
  const rows = Math.ceil(shown.length / 5);
  const H = (rows ? rows * 337.6 + (rows - 1) * 40 : 0) + 80 + 320;
  const bottom = H >= 1080 ? 1080 - H : (1080 - H) / 2;
  const sc = useScroller({ range: [Math.min(0, bottom), Math.max(0, bottom)], barOn: H > 1400 });
  const out = useRef<Promise<void> | null>(null);
  const animOut = () => {
    if (out.current) return out.current;
    const els = Array.from(sc.inner.current?.querySelectorAll<HTMLElement>('.cl-anim') ?? []);
    out.current = Promise.all(els.map((el) => el.animate([{ translate: '0 0', opacity: 1 }, { translate: '0 40px', opacity: 0 }],
      { duration: 200, easing: EXPO_OUT, fill: 'forwards' }).finished.catch(() => {}))).then(() => {});
    return out.current;
  };
  api.current = { out: animOut };
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; setGen(1); return; }
    let live = true;
    void animOut().then(() => { if (!live) return; out.current = null; sc.reset(); setShown(cards); setGen((g) => g + 1); });
    return () => { live = false; };
  }, [cards]);
  useLayoutEffect(() => {
    if (!gen) return;
    const els = Array.from(sc.inner.current?.querySelectorAll<HTMLElement>('.cl-anim') ?? []);
    for (const el of els) el.getAnimations().forEach((a) => a.cancel());
    const live = els.slice(0, 25); // the holders NCardGrid keeps (≈5 rows)
    live.forEach((el, i) => {
      const delay = (i / live.length) * 200;
      el.animate([{ translate: '0 40px' }, { translate: '0 0' }], { duration: 400, delay, easing: BACK_OUT, fill: 'backwards' });
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay, easing: EXPO_OUT, fill: 'backwards' });
    });
  }, [gen]);
  const discovered = shown.filter((c) => vis(c) === 'visible');
  const pv = progress();
  return (
    <div class="cl-grid" {...sc.handlers}>
      <div class="cl-scroll">
        <div class="cl-inner" ref={sc.inner} style={{ ...sc.innerStyle, height: `${H}px` }}>
          {shown.map((c, i) => {
            const v = vis(c) as 'visible' | 'notSeen' | 'locked';
            const up = f.upgrades && safe(() => c.IsUpgradable, false);
            const wins = f.stats ? safe(() => { const o = { v: null as any }; return pv.CardStats.TryGetValue(c.Id, o) ? Number(o.v.TimesWon) : 0; }, 0) : 0;
            return <LibHolder key={c} card={up ? upgradedOf(c) : c} preview={up} vis={v} x={136 + 280 * (i % 5)} y={248.8 + 377.6 * Math.floor(i / 5)}
              stats={f.stats ? wins : null} onInspect={() => { if (v === 'visible') inspectCard(discovered, c, f.upgrades); }} />;
          })}
        </div>
      </div>
      <BorderGradient x={288} w={1632} />
      {sc.scrollbar(1820, 129.6, 50, 820)}
    </div>
  );
}

/** NGridCardHolder in the library: hover 1.0 at once (tips only for discovered cards), back to 0.8 over 0.5 s Expo Out; either click inspects. */
function LibHolder({ card, preview, vis, x, y, stats, onInspect }: { card: any; preview: boolean; vis: 'visible' | 'notSeen' | 'locked'; x: number; y: number; stats: number | null; onInspect: () => void }) {
  const [hot, setHot] = useState(false);
  const pressed = useRef(-1);
  return (
    <div class="grid-holder cl-holder" style={{ left: `${x}px`, top: `${y}px`, scale: hot ? '1' : '0.8', zIndex: hot ? 2 : 1, transition: hot ? 'none' : `scale .5s ${EXPO_OUT}`, cursor: vis === 'visible' ? 'pointer' : 'default' }}
      onPointerEnter={(e) => {
        setHot(true); hoverSfx();
        if (vis !== 'visible') return;
        const r = logicalRect(e.currentTarget as Element);
        if (r) setTips(hoverTipsOf(card), { kind: 'holder', rect: [r[0] - 150, r[1] - 211, 300, 422], x: r[0], starCost: safe(() => card.CurrentStarCost > 0 || card.HasStarCostX, false) });
      }}
      onPointerLeave={() => { setHot(false); pressed.current = -1; if (!inspectActive()) setTip(null); }}
      onPointerDown={(e) => { if (e.button === 0 || e.button === 2) { clickSfx(); pressed.current = e.button; } }}
      onPointerUp={(e) => { if (e.button === pressed.current) { pressed.current = -1; onInspect(); } }}>
      <div class="cl-anim">
        <div class="gh-card"><Card card={card} width={300} preview={preview} visibility={vis} /></div>
        {stats !== null && <LibStats wins={stats} />}
      </div>
    </div>
  );
}
/** NCardLibraryStats: "Victories: n" on a black 0.73 box over the portrait. */
function LibStats({ wins }: { wins: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const text = locv('card_library', 'VICTORIES', { Victories: wins });
  useFit(ref, `cls|${text}`, 30, 10, (el) => el.scrollWidth <= 231 && el.scrollHeight <= 117);
  return <div class="cl-stats"><div class="cl-stats-label" ref={ref}><RichText text={text} /></div></div>;
}

/** NSearchBar: a default Godot LineEdit (Kreon 24) with the clear button (back_button_x, 0.9, 1.1 on hover). */
function SearchBar({ value, onInput, onSubmit }: { value: string; onInput: (v: string) => void; onSubmit: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [hot, setHot] = useState<boolean | null>(null);
  return (
    <div class="cl-search">
      <input ref={input} class="cl-search-input" placeholder={loc('card_library', 'SEARCH_PLACEHOLDER')} value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); else if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
      <div class="cl-search-clear" onPointerEnter={() => { setHot(true); hoverSfx(); }} onPointerLeave={() => setHot(false)}
        onPointerDown={(e) => { if (e.button === 0) clickSfx(); }}
        onPointerUp={(e) => { if (e.button !== 0) return; input.current?.focus(); if (value.trim()) onInput(''); }}>
        <div style={{ ...frameStyle(frameByName('compressed', 'back_button_x'), 36, 36), scale: hot ? '1.1' : hot === false ? '1' : '0.9', transition: hot ? 'scale .05s linear' : 'scale .3s linear' }} />
      </div>
    </div>
  );
}

/** NCardPoolFilter: a 56 px icon (hsv s / v 1 selected, 0.3 / 0.55 not) with its shadow; 1.1 selected, 0.95 not. */
function PoolToggle({ pool, x, y, selected, onClick, onTip, onUntip }: { pool: string; x: number; y: number; selected: boolean; onClick: () => void; onTip?: (e: PointerEvent) => void; onUntip: () => void }) {
  const [st, setSt] = useState<TickState>('');
  const base = selected ? 1.1 : 0.95;
  const k = st === 'hover' ? base * 1.2 : st === 'press' ? base * 0.8 : base;
  const t = st === 'hover' ? '.05s linear' : st === 'press' ? `.3s ${EXPO_OUT}` : selected ? `.2s ${BACK_OUT}` : `.3s ${EXPO_OUT}`;
  const src = CHARS.includes(pool) ? { url: imageUrl(`images/ui/top_panel/character_icon_${pool.toLowerCase()}.png`) }
    : pool === 'COLORLESS' ? { frame: frameByName('ui_atlas', 'card/energy_colorless') }
      : { url: imageUrl(pool === 'ANCIENT' ? 'images/ui/run_history/neow.png' : 'images/packed/card_library/pool_filter_other.png') };
  const img = (extra: any) => (src.frame ? <div style={{ ...frameStyle(src.frame, 56, 56), ...extra }} /> : <img src={src.url ?? ''} style={extra} />);
  return (
    <div class="cl-pool" style={{ left: `${x}px`, top: `${y}px` }}
      onPointerEnter={(e) => { setSt('hover'); hoverSfx(); onTip?.(e); }} onPointerLeave={() => { setSt(''); onUntip(); }}
      onPointerDown={(e) => { if (e.button === 0 && !selected) { setSt('press'); clickSfx(); } else if (e.button === 0) setSt('hover'); }}
      onPointerUp={(e) => { if (e.button === 0) { setSt('hover'); onClick(); } }}>
      <div class="cl-pool-img" style={{ scale: String(k), transition: `scale ${t}` }}>
        {img({ position: 'absolute', left: '4px', top: '3px', width: '56px', height: '56px', filter: 'brightness(0)', opacity: 0.251 })}
        {img({ position: 'absolute', left: 0, top: 0, width: '56px', height: '56px', filter: `saturate(${selected ? 1 : 0.3}) brightness(${selected ? 1 : 0.55})` })}
      </div>
    </div>
  );
}

/** NCardViewSortButton (256 × 42): reward_item_button at grey 0.8 (s / v 0.8, 1.05 × 1) under the label and sort_descending (flipped while ascending). */
function SortButton({ y, label, desc, onClick }: { y: number; label: string; desc: boolean; onClick: () => void }) {
  const [st, setSt] = useState<TickState>('');
  const sv = st === 'hover' ? 1 : 0.8;
  const scale = st === 'press' ? '1 0.95' : st === 'hover' ? '1.05 1.05' : '1.05 1';
  const t = st === 'hover' ? `scale .05s linear, filter .5s ${EXPO_OUT}` : st === 'press' ? `scale .25s ${EXPO_OUT}, filter .25s ${EXPO_OUT}` : `scale .5s linear, filter .5s ${EXPO_OUT}`;
  return (
    <div class="cl-sort" style={{ top: `${y}px` }}
      onPointerEnter={() => { setSt('hover'); hoverSfx(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); clickSfx(); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); onClick(); } }}>
      <img class="cl-sort-img" src={imageUrl('images/ui/reward_screen/reward_item_button.png') ?? ''} style={{ scale, filter: `brightness(.8) saturate(${sv}) brightness(${sv})`, transition: t }} />
      <div class="cl-sort-row">
        <span class="cl-sort-label">{label}</span>
        <div style={{ ...frameStyle(frameByName('ui_atlas', 'sort_descending'), 36, 36), transform: desc ? 'none' : 'scaleY(-1)', filter: tint(0.937, 0.784, 0.318) }} />
      </div>
    </div>
  );
}

/** Shared by the type and cost boxes: ticked s 1 v 1.2, unticked s .65 v .7; hover 1.2 (s / v 1.4 ticked or 1), press 0.9. */
function useIconTick(ticked: boolean, onClick: () => void, onTip: (e: PointerEvent) => void, onUntip: () => void, releaseT: string) {
  const [st, setSt] = useState<TickState | 'release'>('');
  const hot = st === 'hover' || st === 'release';
  const sv = hot ? (ticked ? 1.4 : 1) : ticked ? [1, 1.2] : [0.65, 0.7];
  const [s, v] = Array.isArray(sv) ? sv : [sv, sv];
  const k = hot ? 1.2 : st === 'press' ? 0.9 : 1;
  const t = st === 'hover' ? '.05s linear' : st === 'release' ? releaseT : st === 'press' ? `.25s ${EXPO_OUT}` : `.5s ${EXPO_OUT}`;
  return {
    style: { scale: String(k), filter: `saturate(${s}) brightness(${v})`, transition: `scale ${t}, filter ${st === 'hover' ? '.05s linear' : `.5s ${EXPO_OUT}`}` },
    handlers: {
      onPointerEnter: (e: PointerEvent) => { setSt('hover'); hoverSfx(); onTip(e); },
      onPointerLeave: () => { setSt(''); onUntip(); },
      onPointerDown: (e: PointerEvent) => { if (e.button === 0) { setSt('press'); clickSfx(); } },
      onPointerUp: (e: PointerEvent) => { if (e.button === 0 && st === 'press') { setSt('release'); onClick(); } },
    },
  };
}
/** NCardTypeTickbox (48 × 54): type_sort_<kind> with the gold outline while ticked. */
function TypeTickbox({ kind, x, ticked, onClick, onTip, onUntip }: { kind: string; x: number; ticked: boolean; onClick: () => void; onTip: (e: PointerEvent) => void; onUntip: () => void }) {
  const t = useIconTick(ticked, onClick, onTip, onUntip, `.25s ${BACK_OUT}`);
  return (
    <div class="cl-type" style={{ left: `${x}px` }} {...t.handlers}>
      <div class="cl-type-img" style={t.style}>
        <img src={imageUrl(`images/packed/card_library/type_sort_${kind.toLowerCase()}.png`) ?? ''} />
        {ticked && <img src={imageUrl('images/packed/card_library/type_sort_outline2.png') ?? ''} style={{ filter: tint(0.937, 0.784, 0.318) }} />}
      </div>
    </div>
  );
}
/** NCardCostTickbox (48 × 48): the #5594A5 cost gem (50 px) with its shadow, gold outline while ticked, and the cost. */
function CostTickbox({ label, x, ticked, onClick, onTip, onUntip }: { label: string; x: number; ticked: boolean; onClick: () => void; onTip: (e: PointerEvent) => void; onUntip: () => void }) {
  const t = useIconTick(ticked, onClick, onTip, onUntip, '.05s linear');
  const gem = imageUrl('images/packed/card_library/cost_tickbox.png') ?? '';
  return (
    <div class="cl-cost" style={{ left: `${x}px` }} {...t.handlers}>
      <div class="cl-cost-img" style={{ scale: t.style.scale, transition: t.style.transition }}>
        <img src={gem} style={{ left: '4px', top: '3px', filter: 'brightness(0)', opacity: 0.251 }} />
        <img src={gem} style={{ filter: `${tint(0.333, 0.58, 0.647)} ${t.style.filter}`, transition: t.style.transition }} />
        {ticked && <img src={imageUrl('images/packed/card_library/cost_tickbox_outline.png') ?? ''} style={{ filter: tint(0.937, 0.784, 0.318) }} />}
        <span class="cl-cost-label">{label}</span>
      </div>
    </div>
  );
}
/** NTickbox row label: hover 1.1 (0.05 s), unhover / press back over 0.5 s Expo Out (press greys it), release pops 1.1 (0.25 s Bounce). */
function tickLabel(st: TickState, popped: boolean) {
  const k = st === 'hover' ? 1.1 : 1;
  return { scale: String(k), opacity: st === 'press' ? 0.75 : 1, transition: st === 'hover' ? (popped ? 'scale .25s cubic-bezier(.34, 1.8, .64, 1)' : 'scale .05s linear') : `scale .5s ${EXPO_OUT}, opacity .5s ${EXPO_OUT}` };
}
/** NCardRarityTickbox (256 × 38): the checkbox at 0.66 and the rarity label in its colour; greyed and inert without a character / colorless pool. */
function RarityTickbox({ kind, y, ticked, disabled, onClick, onTip, onUntip }: { kind: string; y: number; ticked: boolean; disabled: boolean; onClick: () => void; onTip: (e: PointerEvent) => void; onUntip: () => void }) {
  const tk = useTick(ticked, onClick, !disabled);
  const [popped, setPopped] = useState(false);
  const color = ({ COMMON: '#FFF6E2', UNCOMMON: '#87C7D0', RARE: '#EFC148', OTHER: '#EE7DD3' } as Record<string, string>)[kind];
  return (
    <div class={'cl-rarity' + (disabled ? ' disabled' : '')} style={{ top: `${y}px` }}
      onPointerEnter={(e) => { tk.handlers.onPointerEnter(); if (!disabled) onTip(e); }} onPointerLeave={() => { tk.handlers.onPointerLeave(); setPopped(false); onUntip(); }}
      onPointerDown={(e) => { tk.handlers.onPointerDown(e); setPopped(false); }} onPointerUp={(e) => { if (tk.st === 'press') setPopped(true); tk.handlers.onPointerUp(e); }}>
      <div class="cl-rarity-box"><TickboxVisual ticked={ticked} st={tk.st} /></div>
      <div class="cl-rarity-label" style={{ color, ...tickLabel(tk.st, popped) }}>{loc('card_library', `RARITY_${kind}`)}</div>
    </div>
  );
}
/** NLibraryStatTickbox (256 × 42): Multiplayer Cards, View Stats, View Upgrades. */
function StatTickbox({ y, label, ticked, onClick }: { y: number; label: string; ticked: boolean; onClick: () => void }) {
  const tk = useTick(ticked, onClick);
  const [popped, setPopped] = useState(false);
  return (
    <div class="cl-stat" style={{ top: `${y}px` }} {...tk.handlers}
      onPointerLeave={() => { tk.handlers.onPointerLeave(); setPopped(false); }}
      onPointerUp={(e) => { if (tk.st === 'press') setPopped(true); tk.handlers.onPointerUp(e); }}>
      <div class="cl-stat-box"><TickboxVisual ticked={ticked} st={tk.st} /></div>
      <div class="cl-stat-label" style={tickLabel(tk.st, popped)}>{label}</div>
    </div>
  );
}

// ================================================================== relic collection / potion lab
/** Hover tips that follow their owner while the content scrolls (NHoverTipSet.SetFollowOwner). */
let follow: { el: Element; tips: TipData[]; dx: number } | null = null;
function showFollow(el: Element, tips: TipData[], dx = 0) {
  follow = { el, tips, dx };
  placeFollow();
}
function placeFollow() {
  const r = follow && logicalRect(follow.el);
  if (follow && r) setTips(follow.tips, { kind: 'align', rect: [r[0] + follow.dx, r[1], r[2], r[3]], align: r[0] > 1440 ? 'left' : 'right' });
}
/** Removes the tips (only its own when `el` is given: a click may have handed them to the inspect screen). */
function hideFollow(el?: Element) { if (el && follow?.el !== el) return; follow = null; setTip(null); }

interface Group { header: string | null; icon?: string | null; items: any[]; sub?: Group[]; spacer?: boolean }
type Vis = 'visible' | 'notSeen' | 'locked';

/** NRelicCollectionCategory.LoadRelics for every rarity (subcategories for starters and per unlocked ancient). */
function relicGroups() {
  const R = G.RelicRarity;
  const all = list(G.ModelDb.AllRelics);
  const pools = list(G.ModelDb.AllCharacterRelicPools);
  const seen = ids(progress().DiscoveredRelics);
  const un = unlocks();
  const unlocked = new Set(list(un.Relics));
  const order: any[] = [];
  const bucket = (rarity: number) => {
    const cache = all.filter((r: any) => r.Rarity === rarity);
    const char = pools.flatMap((p: any) => { const pid = ids(p.AllRelicIds); return cache.filter((r: any) => pid.has(r.Id.Entry)); });
    const shared = cache.filter((r: any) => !char.includes(r)).sort(byTitle);
    return [...shared, ...char];
  };
  const groups: Group[] = [];
  for (const [k, rarity] of [['STARTER', R.Starter], ['COMMON', R.Common], ['UNCOMMON', R.Uncommon], ['RARE', R.Rare], ['SHOP', R.Shop], ['ANCIENT', R.Ancient], ['EVENT', R.Event]] as [string, number][]) {
    const header = loc('relic_collection', k);
    if (rarity === R.Starter) {
      const starters = list(G.ModelDb.AllCharacters).flatMap((c: any) => list(c.StartingRelics));
      const too = G.ModelDb.Relic(G.TouchOfOrobas);
      const upgradedStarters = starters.map((r: any) => safe(() => too.GetUpgradedStarterRelic(r), r));
      order.push(...starters, ...upgradedStarters);
      groups.push({ header, items: [], sub: [{ header: null, items: starters, spacer: false }, { header: null, items: upgradedStarters, spacer: true }] });
    } else if (rarity === R.Ancient) {
      const cache = new Set(all.filter((r: any) => r.Rarity === rarity));
      const acts = [G.Overgrowth, G.Underdocks, G.Hive, G.Glory].map((a) => G.ModelDb.Act(a));
      const ancients = [...new Set([...acts.flatMap((a: any) => list(a.AllAncients)), ...list(G.ModelDb.AllSharedAncients)])];
      const open = new Set([...acts.flatMap((a: any) => safe(() => list(a.GetUnlockedAncients(un)), [])), ...list(un.SharedAncients)]);
      const stats = progress().AncientStats;
      const sub: Group[] = [];
      for (const anc of ancients) {
        if (!open.has(anc)) continue;
        const relics = [...new Set(list(anc.AllPossibleOptions).map((o: any) => safe(() => o.Relic?.CanonicalInstance, null)).filter((r: any) => r && cache.has(r)))].sort(byTitle);
        const known = safe(() => stats.ContainsKey(anc.Id), false) || relics.some((r: any) => seen.has(r.Id.Entry));
        order.push(...relics);
        sub.push({ header: locv('relic_collection', 'ANCIENT_SUBCATEGORY', { Ancient: known ? fmt(anc.Title) : loc('relic_collection', 'UNKNOWN_ANCIENT') }),
          icon: imageUrl(`images/ui/run_history/${String(anc.Id.Entry).toLowerCase()}.png`), items: relics, spacer: true });
      }
      groups.push({ header, items: [], sub });
    } else {
      const items = bucket(rarity);
      order.push(...items);
      groups.push({ header, items });
    }
  }
  const vis = (r: any): Vis => (!unlocked.has(r) ? 'locked' : seen.has(r.Id.Entry) ? 'visible' : 'notSeen');
  const outline = (r: any) => { const p = pools.find((p: any) => ids(p.AllRelicIds).has(r.Id.Entry)); return p ? p.LabOutlineColor : null; };
  return { groups, order, vis, outline };
}

export function RelicCollection() {
  const d = useMemo(relicGroups, []);
  const sc = useScroller({ onMove: placeFollow });
  useEffect(() => () => hideFollow(), []);
  return (
    <div class="screen coll-screen">
      <div class="coll-contents fade-in" {...sc.handlers}>
        <div class="coll-inner" ref={sc.inner} style={sc.innerStyle}>
          <div class="coll-column">
            {d.groups.map((g) => <Category g={g} cell={(r) => <RelicEntry r={r} vis={d.vis(r)} outline={d.outline(r)} order={d.order} scroller={sc.state} />} kind="relic" />)}
          </div>
        </div>
        {sc.scrollbar(1821, 129.6, 48, 820)}
        <BorderGradient />
      </div>
      <BackButton enabled onClick={() => { hideFollow(); leaveScreen(); }} />
    </div>
  );
}
/** relic_collection_category.tscn / _subcategory.tscn: header row, the 10-column grid (32 apart) under its margin, the spacer. */
function Category({ g, cell, kind, sub }: { g: Group; cell: (m: any) => any; kind: 'relic' | 'potion'; sub?: boolean }) {
  const n = Math.min(10, g.items.length);
  return (
    <div class={`coll-cat ${kind}` + (sub ? ' sub' : '')}>
      <div class="coll-head-row" style={{ height: `${g.header || g.icon ? (g.icon ? 48 : 36) : 0}px` }}>
        {g.icon && <img class="coll-icon" src={g.icon} />}
        {g.header && <div class="coll-head"><RichText text={g.header} /></div>}
      </div>
      <div class="coll-margin">
        {g.items.length > 0 && <div class="coll-grid" style={{ gridTemplateColumns: `repeat(${n}, ${kind === 'relic' ? 68 : 60}px)` }}>{g.items.map(cell)}</div>}
      </div>
      {g.sub?.map((s) => <Category g={s} cell={cell} kind={kind} sub />)}
      {g.spacer !== false && <div class={'coll-spacer' + (sub ? ' sub' : '')} />}
    </div>
  );
}
/** NRelicCollectionEntry (68 × 68, the relic drawn at 1.25): locked, silhouette or icon + outline; hover 1.25 at once, back over 1 s; click inspects. */
function RelicEntry({ r, vis, outline, order, scroller }: { r: any; vis: Vis; outline: any; order: any[]; scroller: any }) {
  const [hot, setHot] = useState(false);
  const pressed = useRef(false);
  const id = String(r.Id.Entry).toLowerCase();
  const tips = (): TipData[] => (vis === 'visible' ? hoverTipsOf(safe(() => r.ToMutable(), r))
    : [{ title: loc('main_menu_ui', `COMPENDIUM_RELIC_COLLECTION.${vis === 'locked' ? 'locked' : 'unknown'}.title`), body: loc('main_menu_ui', `COMPENDIUM_RELIC_COLLECTION.${vis === 'locked' ? 'locked' : 'unknown'}.description`) }]);
  return (
    <div class="relic-entry"
      onPointerEnter={(e) => { setHot(true); showFollow(e.currentTarget as Element, tips()); }}
      onPointerLeave={(e) => { setHot(false); pressed.current = false; hideFollow(e.currentTarget as Element); }}
      onPointerDown={(e) => { if (e.button === 0) { pressed.current = true; setHot(false); clickSfx(); scroller.moved = 0; } }}
      onPointerUp={(e) => { if (e.button !== 0 || !pressed.current) return; pressed.current = false; hideFollow(); if (scroller.moved < 20) inspectRelic(order, r); }}>
      <div class="relic-entry-holder">
        <div class="relic-entry-node" style={{ scale: hot ? '1.25' : '1', transition: hot ? 'none' : `scale 1s ${EXPO_OUT}` }}>
          {vis === 'locked'
            ? <img class="relic-entry-lock" src={imageUrl('images/packed/common_ui/locked_model.png') ?? ''} />
            : (
              <>
                <div class="relic-entry-outline" style={{ ...frameStyle(frameByName('relic_outline_atlas', id), 60, 60), filter: vis === 'notSeen' ? undefined : outline ? rgba(outline, 0.66) : tint(0, 0, 0, 0.5), opacity: vis === 'notSeen' ? 0.5 : 1 }} />
                <div class="relic-entry-icon" style={{ ...frameStyle(atlasFrame(safe(() => r.IconPath, '')) ?? frameByName('relic_atlas', id), 60, 60), ...(vis === 'notSeen' ? { filter: 'brightness(0)', opacity: 0.9 } : {}) }} />
              </>
            )}
        </div>
      </div>
    </div>
  );
}

export function PotionLab() {
  const d = useMemo(() => {
    const P = G.PotionRarity;
    const all = list(G.ModelDb.AllPotions);
    const pools = list(G.ModelDb.AllCharacterPotionPools);
    const seen = ids(progress().DiscoveredPotions);
    const unlocked = new Set(list(unlocks().Potions));
    const groups: Group[] = ([['COMMON', [P.Common]], ['UNCOMMON', [P.Uncommon]], ['RARE', [P.Rare]], ['SPECIAL', [P.Event, P.Token]]] as [string, number[]][]).map(([k, rs]) => {
      const cache = all.filter((p: any) => rs.includes(p.Rarity));
      const char = pools.flatMap((pool: any) => { const pid = ids(pool.AllPotionIds); return cache.filter((p: any) => pid.has(p.Id.Entry)); });
      return { header: loc('potion_lab', k), items: [...cache.filter((p: any) => !char.includes(p)).sort(byTitle), ...char] };
    });
    const vis = (p: any): Vis => (!unlocked.has(p) ? 'locked' : seen.has(p.Id.Entry) ? 'visible' : 'notSeen');
    const outline = (p: any) => { const pool = pools.find((pp: any) => ids(pp.AllPotionIds).has(p.Id.Entry)); return pool ? pool.LabOutlineColor : null; };
    return { groups, vis, outline };
  }, []);
  const sc = useScroller({ onMove: placeFollow });
  useEffect(() => () => hideFollow(), []);
  return (
    <div class="screen coll-screen">
      <div class="coll-contents fade-in potions" {...sc.handlers}>
        <div class="coll-inner" ref={sc.inner} style={sc.innerStyle}>
          <div class="coll-column">
            {d.groups.map((g) => <Category g={g} kind="potion" cell={(p) => <PotionHolder p={p} vis={d.vis(p)} outline={d.outline(p)} />} />)}
          </div>
        </div>
        {sc.scrollbar(1820, 130, 50, 820)}
        <BorderGradient />
      </div>
      <BackButton enabled onClick={() => { hideFollow(); leaveScreen(); }} />
    </div>
  );
}
/** NLabPotionHolder (60 × 60, not a button, no sounds): hover 1.2 over 0.05 s, back over 0.5 s Expo Out; tips 32 px right of it. */
function PotionHolder({ p, vis, outline }: { p: any; vis: Vis; outline: any }) {
  const [hot, setHot] = useState(false);
  const tips = (): TipData[] => (vis === 'visible' ? hoverTipsOf(safe(() => p.ToMutable(), p))
    : [{ title: loc('main_menu_ui', `POTION_LAB_COLLECTION.${vis === 'locked' ? 'locked' : 'unknown'}.title`), body: loc('main_menu_ui', `POTION_LAB_COLLECTION.${vis === 'locked' ? 'locked' : 'unknown'}.description`) }]);
  const img = safe(() => p.ImagePath, '');
  return (
    <div class="potion-entry" onPointerEnter={(e) => { setHot(true); showFollow(e.currentTarget as Element, tips(), 32); }} onPointerLeave={(e) => { setHot(false); hideFollow(e.currentTarget as Element); }}>
      <div class="potion-entry-node" style={{ scale: hot ? '1.2' : '1', transition: hot ? 'scale .05s linear' : `scale .5s ${EXPO_OUT}`, filter: vis === 'locked' ? 'brightness(.5)' : undefined }}>
        {vis === 'locked'
          ? <img class="potion-entry-lock" src={imageUrl('images/packed/common_ui/locked_model.png') ?? ''} />
          : (
            <>
              <div class="potion-entry-outline" style={{ ...frameStyle(atlasFrame(img.replace('potion_atlas', 'potion_outline_atlas')), 60, 60), filter: vis === 'notSeen' ? undefined : outline ? rgba(outline, 0.66) : tint(0, 0, 0, 0.5), opacity: vis === 'notSeen' ? 0.5 : 1 }} />
              <div class="potion-entry-img" style={{ ...frameStyle(atlasFrame(img), 60, 60), ...(vis === 'notSeen' ? { filter: 'brightness(0)', opacity: 0.9 } : {}) }} />
            </>
          )}
      </div>
    </div>
  );
}
