// Run History (NRunHistory): a submenu showing one saved run at a time, newest first — the top row (character,
// HP, gold, potion belt, floors, time) with the date / seed / mode / build column, the death quote, a row of room
// icons per act (with the floor tip), the relics and the grouped deck, cross-highlighting the floors they came from.
// Gold arrows (D / X) step to older / newer runs.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { G, $, list } from '../game';
import { invalidate, leaveScreen } from '../store';
import { loc, locv } from '../i18n';
import { atlasFrame, frameByName, frameStyle, frameUrl, imageUrl } from '../assets';
import { matFilter, tint } from '../filters';
import { RichText } from './richtext';
import { setTip, setTips, hoverTipsOf, logicalRect, type TipData } from './tooltip';
import { BackButton, NGoldArrowButton } from './buttons';
import { inspectCard, inspectRelic, inspectActive } from './inspect';
import { netDate } from './menu';
import { ShareButton } from './stats';
import { useFit } from './card';
import { safe, fmt, EXPO_OUT, clickSfx } from './comp-shared';

const rh = (k: string, v: Record<string, any> = {}) => locv('run_history', k, v);
const none = (id: any) => !id || id === G.ModelId.none || safe(() => id.Equals(G.ModelId.none), false);
const $enum = (E: any, v: number): string => safe(() => $.enumStr(E, v), '');
const ICON = (k: 'gold' | 'card' | 'chest' | 'potion') => `[img=top]res://images/packed/sprite_fonts/${k}_icon.png[/img]`;
const sameId = (a: any, b: any) => String(a) === String(b);

/** NRunHistory.LoadDeathQuote (seeded by the run's seed). The game-over screen's GetDeathQuote adds a debug line when nothing matched. */
export function deathQuote(h: any, charId: any, debugFallback = true): string {
  const ch = G.ModelDb.GetById(G.CharacterModel, charId);
  const rng = new G.Rng().$ctor_Rng$UInt32_Int32(G.StringHelper.GetDeterministicHashCode(h.Seed) >>> 0, 0);
  const random = (prefix: string) => { const ls = G.LocString.GetRandomWithPrefix('run_history', prefix, rng); ch.AddDetailsTo(ls); return fmt(ls); };
  let body = '';
  if (h.Win) body = random('MAP_POINT_HISTORY.falseVictory');
  else if (h.WasAbandoned) body = random('MAP_POINT_HISTORY.abandon');
  else if (!none(h.KilledByEncounter)) body = fmt(G.SaveUtil.EncounterOrDeprecated(h.KilledByEncounter).GetLossMessageFor(ch));
  else if (!none(h.KilledByEvent)) {
    const ev = G.SaveUtil.EventOrDeprecated(h.KilledByEvent);
    const key = ev.Id.Entry + '.loss';
    const ls = G.LocString.Exists$2('events', key) ? new G.LocString().$ctor_LocString('events', key) : new G.LocString().$ctor_LocString('run_history', 'DEFAULT_EVENT_LOSS_MESSAGE');
    ch.AddDetailsTo(ls);
    ls.Add$String_LocString('event', ev.Title);
    body = fmt(ls);
  } else if (debugFallback) { const ls = new G.LocString().$ctor_LocString('run_history', 'MAP_POINT_HISTORY.debug'); ch.AddDetailsTo(ls); body = fmt(ls); }
  return loc('game_over_screen', 'ENCOUNTER_QUOTE_LEFT') + body + loc('game_over_screen', 'ENCOUNTER_QUOTE_RIGHT');
}

// ------------------------------------------------------------------ NMapPointHistoryHoverTip
export interface FloorTipData { title: string; player: string; room: string; actions: string; rewards: string[]; skipped: string[] }
const playerEntry = (e: any, playerId: any) => list(e.PlayerStats).find((s: any) => sameId(s.PlayerId, playerId)) ?? safe(() => e.GetEntry(playerId), null);
const title = (f: () => any) => fmt(safe(f, ''));
/** The tip's sections, in NMapPointHistoryHoverTip._Ready order (room keys ROOM_* / ROOM_UNKNOWN_* / ROOM_EVENT). */
export function floorTipData(e: any, floor: number, playerId: any): FloorTipData {
  const M = G.MapPointType, R = G.RoomType;
  const room = list(e.Rooms)[0];
  let key = ({ [M.Shop]: 'ROOM_MERCHANT', [M.Treasure]: 'ROOM_TREASURE', [M.RestSite]: 'ROOM_REST', [M.Monster]: 'ROOM_ENEMY', [M.Elite]: 'ROOM_ELITE', [M.Boss]: 'ROOM_BOSS', [M.Ancient]: 'ROOM_ANCIENT' } as Record<number, string>)[e.MapPointType];
  if (e.MapPointType === M.Unknown) key = ({ [R.Monster]: 'ROOM_UNKNOWN_ENEMY', [R.Treasure]: 'ROOM_UNKNOWN_TREASURE', [R.Shop]: 'ROOM_UNKNOWN_MERCHANT', [R.Elite]: 'ROOM_UNKNOWN_ELITE', [R.Event]: 'ROOM_EVENT' } as Record<number, string>)[room?.RoomType];
  const model = room?.RoomType === R.Event ? title(() => G.SaveUtil.EventOrDeprecated(room.ModelId).Title)
    : [R.Treasure, R.Shop, R.RestSite].includes(room?.RoomType) ? '' : title(() => G.SaveUtil.EncounterOrDeprecated(room.ModelId).Title);
  const out: FloorTipData = {
    title: rh('MAP_POINT_HISTORY.header', { FloorNum: floor }),
    room: rh('MAP_POINT_HISTORY.room_stats', { MapPointType: key ? loc('static_hover_tips', `${key}.title`) : '', ModelTitle: model }),
    player: '', actions: '', rewards: [], skipped: [],
  };
  const p = playerEntry(e, playerId);
  if (!p) return out;
  out.player = rh('MAP_POINT_HISTORY.player_stats', { HP: p.CurrentHp, MaxHP: p.MaxHp, Gold: p.CurrentGold });
  const lines: string[] = [];
  const tab = (s: string) => lines.push('\t' + s);
  if (e.MapPointType === M.Ancient) {
    const picked = safe(() => p.GetAncientPickedChoiceLoc(), null);
    if (picked) tab(rh('MAP_POINT_HISTORY.chose', { Choice: fmt(picked) }));
    for (const s of safe(() => list(p.GetAncientSkippedChoiceLoc()), [])) tab(rh('MAP_POINT_HISTORY.skipped', { Choice: fmt(s) }));
  } else {
    const evRoom = list(e.Rooms).find((r: any) => r.RoomType === R.Event);
    const ev = evRoom ? safe(() => G.SaveUtil.EventOrDeprecated(evRoom.ModelId), null) : null;
    if (ev) for (const c of list(p.EventChoices)) {
      const t = safe(() => { ev.DynamicVars.AddTo(c.Title); for (const kv of list(c.Variables)) c.Title.AddObj(kv.Key, kv.Value); return fmt(c.Title); }, fmt(c.Title));
      tab(rh('MAP_POINT_HISTORY.chose', { Choice: t }));
    }
  }
  for (const c of list(p.RestSiteChoices)) tab(rh('MAP_POINT_HISTORY.chose', { Choice: loc('rest_site_ui', `OPTION_${c}.name`) }));
  const combat = list(e.Rooms).find((r: any) => safe(() => G.RoomTypeExtensions.IsCombatRoom(r.RoomType), [R.Monster, R.Elite, R.Boss].includes(r.RoomType)));
  if (p.MaxHpLost > 0) tab(rh('MAP_POINT_HISTORY.maxHpLost', { HP: p.MaxHpLost }));
  if (p.DamageTaken > 0 || combat) tab(rh('MAP_POINT_HISTORY.damageTaken', { Damage: p.DamageTaken }));
  if (p.MaxHpGained > 0) tab(rh('MAP_POINT_HISTORY.maxHpGained', { HP: p.MaxHpGained }));
  if (p.HpHealed > 0) tab(rh('MAP_POINT_HISTORY.healed', { HP: p.HpHealed }));
  if (combat) tab(rh('MAP_POINT_HISTORY.turnsTaken', { Turns: combat.TurnsTaken }));
  for (const q of list(p.CompletedQuests)) tab(rh('MAP_POINT_HISTORY.questCompleted', { Quest: title(() => G.SaveUtil.CardOrDeprecated(q).Title) }));
  for (const id of list(p.PotionUsed)) lines.push(rh('HISTORY_ENTRY.used', { Icon: ICON('potion'), Title: title(() => G.SaveUtil.PotionOrDeprecated(id).Title) }));
  for (const id of list(p.PotionDiscarded)) lines.push(rh('HISTORY_ENTRY.removed', { Icon: ICON('potion'), Title: title(() => G.SaveUtil.PotionOrDeprecated(id).Title) }));
  if (p.GoldSpent > 0) lines.push(rh('HISTORY_ENTRY.goldSpent', { Amount: p.GoldSpent }));
  if (p.GoldLost > 0) lines.push(rh('HISTORY_ENTRY.goldLost', { Amount: p.GoldLost }));
  if (p.GoldStolen > 0) lines.push(rh('HISTORY_ENTRY.goldStolen', { Icon: ICON('gold'), Amount: p.GoldStolen }));
  out.actions = lines.join('\n').replace(/^\n+|\n+$/g, '');
  const card = (c: any) => title(() => G.CardModel.FromSerializable(c).Title);
  const got = out.rewards, skip = out.skipped;
  if (p.GoldGained > 0) got.push(rh('HISTORY_ENTRY.goldGained', { Icon: ICON('gold'), Amount: p.GoldGained }));
  for (const c of list(p.CardsGained)) got.push(rh('HISTORY_ENTRY.obtained', { Icon: ICON('card'), Title: card(c) }));
  for (const c of list(p.CardChoices)) if (!(c.wasPicked ?? c.WasPicked)) skip.push(rh('HISTORY_ENTRY.obtained', { Icon: ICON('card'), Title: card(c.Card ?? c.card) }));
  for (const [k, T] of [['RelicChoices', 'Relic'], ['PotionChoices', 'Potion']] as const) {
    for (const c of list(p[k])) {
      const s = rh('HISTORY_ENTRY.obtained', { Icon: ICON(T === 'Relic' ? 'chest' : 'potion'), Title: title(() => G.SaveUtil[`${T}OrDeprecated`](c.choice ?? c.Choice).Title) });
      ((c.wasPicked ?? c.WasPicked) ? got : skip).push(s);
    }
  }
  for (const c of list(p.CardsRemoved)) got.push(rh('HISTORY_ENTRY.removed', { Icon: ICON('card'), Title: card(c) }));
  for (const id of list(p.RelicsRemoved)) got.push(rh('HISTORY_ENTRY.removed', { Icon: ICON('chest'), Title: title(() => G.SaveUtil.RelicOrDeprecated(id).Title) }));
  for (const id of list(p.UpgradedCards)) got.push(rh('HISTORY_ENTRY.upgraded', { Icon: ICON('card'), Title: title(() => G.SaveUtil.CardOrDeprecated(id).Title) }));
  for (const id of list(p.DowngradedCards)) got.push(rh('HISTORY_ENTRY.downgraded', { Icon: ICON('card'), Title: title(() => G.SaveUtil.CardOrDeprecated(id).Title) }));
  for (const c of list(p.CardsEnchanted)) got.push(rh('HISTORY_ENTRY.enchanted', { Icon: ICON('card'), Title1: card(c.Card), Title2: title(() => G.SaveUtil.EnchantmentOrDeprecated(c.Enchantment).Title) }));
  for (const c of list(p.CardsTransformed)) got.push(rh('HISTORY_ENTRY.transformed', { Icon: ICON('card'), Title1: card(c.OriginalCard), Title2: card(c.FinalCard) }));
  return out;
}
/**
 * The tip panel (map_point_history_hover_tip.tscn): hover_tip frame, gold title, stats, then Rewards / Skipped in up to
 * two columns. Shown for run-history floors and the map screen's traveled points (NMapPoint.OnFocus); `w` is the
 * owner's width.
 */
export function FloorTipPanel({ d, cell, w: cw = 60 }: { d: FloorTipData; cell: [number, number]; w?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    // SetAlignment: right of the owner (left of it past x 1440), then the overflow corrections
    let x = cell[0] > 1440 ? cell[0] - w : cell[0] + cw, y = cell[1];
    if (y + h > 1080) y = 1080 - h;
    if (x + w > 1920) x = 1920 - w;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.visibility = 'visible';
  });
  const cols = (xs: string[]) => { const per = Math.max(5, Math.ceil(xs.length / 2)); return [xs.slice(0, per), xs.slice(per)].filter((c) => c.length); };
  const block = (h: string, xs: string[]) => xs.length > 0 && (
    <div class="fh-block">
      <div class="fh-title">{rh(h)}</div>
      <div class="fh-cols">{cols(xs).map((c) => <div class="fh-col"><RichText text={c.map((x) => '\t' + x).join('\n')} /></div>)}</div>
    </div>
  );
  return (
    <div class="fh-tip" ref={ref} style={{ visibility: 'hidden' }}>
      <div class="hover-tip-bg shadow" style={{ borderImageSource: `url(${imageUrl('images/ui/hover_tip.png')})` }} />
      <div class="hover-tip-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/hover_tip.png')})` }} />
      <div class="fh-body">
        <div class="fh-title">{d.title}</div>
        <div class="fh-text"><RichText text={d.player} /></div>
        <div class="fh-group">
          <div class="fh-text"><RichText text={d.room} /></div>
          {d.actions && <div class="fh-text"><RichText text={d.actions} /></div>}
        </div>
        {block('HISTORY_ENTRY.rewardsHeader', d.rewards)}
        {block('HISTORY_ENTRY.skippedHeader', d.skipped)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the screen
const nav = { names: [] as string[] };
interface Loaded { h: any; player: any; ch: any; relics: any[]; deck: { card: any; n: number; floors: number[] }[]; potions: any[]; tilts: number[][] }
function load(name: string): Loaded | null {
  const res = safe(() => G.SaveManager.Instance.LoadRunHistory(name), null);
  if (!res?.Success) return null;
  const h = res.SaveData;
  const player = list(h.Players)[0];
  const ch = G.ModelDb.GetById(G.CharacterModel, player.Character);
  const owner = safe(() => G.Player.CreateForNewRun(ch, G.SaveManager.Instance.GenerateUnlockStateFromProgress(), player.Id), null);
  const relics = list(player.Relics).map((r: any) => {
    const m = safe(() => G.RelicModel.FromSerializable(r), null) ?? safe(() => G.ModelDb.Relic(G.DeprecatedRelic).ToMutable(), null);
    if (m && owner) safe(() => { m.Owner = owner; }, null);
    return m;
  }).filter(Boolean);
  // NDeckHistory.PopulateCards: identical SerializableCards collapse into one entry, in order of first appearance
  const groups: { key: any; items: any[] }[] = [];
  for (const c of list(player.Deck)) {
    const g = groups.find((x) => safe(() => x.key.Equals(c), false) || JSON.stringify(x.key) === JSON.stringify(c));
    if (g) g.items.push(c); else groups.push({ key: c, items: [c] });
  }
  const deck = groups.map((g) => {
    const card = safe(() => G.CardModel.FromSerializable(g.key), null) ?? G.SaveUtil.CardOrDeprecated(g.key.Id);
    if (owner) safe(() => { card.Owner = owner; }, null);
    return { card, n: g.items.length, floors: g.items.map((c: any) => c.FloorAddedToDeck).filter((f: any) => f != null).map(Number) };
  });
  const potions = list(player.Potions).map((p: any) => { const m = safe(() => G.PotionModel.FromSerializable(p), null); if (m && owner) safe(() => { m.Owner = owner; }, null); return m; });
  // NMapPointHistoryEntry._baseAngle: 5 × a normal sample kept in [0, 1], either sign; rolled again on every rebuild
  const gauss = () => { for (;;) { const g = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); if (g >= 0 && g <= 1) return g; } };
  const tilts = list(h.MapPointHistory).map((a: any) => list(a).map(() => 5 * gauss() * (Math.random() < 0.5 ? -1 : 1)));
  return { h, player, ch, relics, deck, potions, tilts };
}

export function RunHistory() {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(0);
  const names = useMemo(() => (nav.names = safe(() => list(G.SaveManager.Instance.GetAllRunHistoryNames()).map(String).reverse(), [] as string[])), []);
  const shown = useRef<Loaded | null>(null);
  const loaded = useMemo(() => (names[idx] ? load(names[idx]) : null), [idx]);
  if (loaded) shown.current = loaded; // a run that fails to load leaves the previous one under the veil
  const run = shown.current;
  const contents = useRef<HTMLDivElement>(null);
  const [hl, setHl] = useState<Set<number>>(new Set());
  const [tip, setFloorTip] = useState<{ d: FloorTipData; cell: [number, number] } | null>(null);
  const go = (d: number) => {
    const i = idx + d;
    if (i < 0 || i >= names.length) return;
    setTip(null); setFloorTip(null); setHl(new Set());
    setIdx(i); setDir(d);
  };
  useLayoutEffect(() => {
    // switch: the contents slide in from ∓1000 px (0.5 s Expo Out) and fade in over 0.4 s
    if (!dir) return;
    contents.current?.animate([{ translate: `${dir > 0 ? -1000 : 1000}px 0` }, { translate: '0 0' }], { duration: 500, easing: EXPO_OUT });
    contents.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  }, [idx]);
  useEffect(() => {
    // mega_view_deck_and_tab_left (D): older; mega_view_exhaust_pile_and_tab_right (X): newer
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea') || document.querySelector('.inspect-screen')) return;
      const key = e.key.toLowerCase();
      if (key === 'd') go(1); else if (key === 'x') go(-1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => () => setTip(null), []);
  return (
    <div class="screen run-history">
      <div class="rhs-contents fade-in" ref={contents}>
        {run && <RunView r={run} hl={hl} setHl={setHl} onTip={setFloorTip} />}
      </div>
      {!loaded && <OutOfDate />}
      {idx < names.length - 1 && <NGoldArrowButton left class="rhs-arrow" style={{ left: '40px' }} onClick={() => go(1)} />}
      {idx > 0 && <NGoldArrowButton left flip class="rhs-arrow" style={{ left: '1746px' }} onClick={() => go(-1)} />}
      <BackButton enabled onClick={() => { setTip(null); leaveScreen(); }} />
      <ShareButton inert label={loc('main_menu_ui', 'RUN_HISTORY.SHARE.title')} badge={104} />
      {tip && <FloorTipPanel d={tip.d} cell={tip.cell} />}
    </div>
  );
}

/** OutOfDateVisual: a black 0.5 veil and the rotated red "Out of date run history" (hard-coded English). */
function OutOfDate() {
  return <div class="rhs-outofdate"><div class="rhs-ood-label">Out of date run history</div></div>;
}

function RunView({ r, hl, setHl, onTip }: { r: Loaded; hl: Set<number>; setHl: (s: Set<number>) => void; onTip: (t: { d: FloorTipData; cell: [number, number] } | null) => void }) {
  const { h, player, ch } = r;
  const acts = list(h.MapPointHistory).map((a: any) => list(a));
  const floors = acts.reduce((n: number, a: any[]) => n + a.length, 0);
  const last = acts.at(-1)?.at(-1);
  const stats = last ? playerEntry(last, player.Id) : null;
  const hp = stats ? `${stats.CurrentHp}/${stats.MaxHp}` : `${ch.StartingHp}/${ch.StartingHp}`;
  const gold = stats ? String(stats.CurrentGold) : String(ch.StartingGold);
  const modeName = $enum(G.GameMode, h.GameMode);
  const mode = rh('GAME_MODE.title', {
    PlayerCount: rh(list(h.Players).length > 1 ? 'PLAYER_COUNT.multiplayer' : 'PLAYER_COUNT.singleplayer'),
    GameMode: rh(`GAME_MODE.${['Standard', 'Daily', 'Custom'].includes(modeName) ? modeName.toLowerCase() : 'unknown'}`),
  });
  const date = new Date(Number(h.StartTime) * 1000);
  const quote = safe(() => deathQuote(h, player.Character, false), '');
  let base = 0;
  return (
    <>
      <TopRow r={r} hp={hp} gold={gold} floors={floors} />
      <div class="rhs-right">
        <div class="rhs-meta"><RichText text={isNaN(date.getTime()) ? '' : `[gold]${netDate('MMMM d, yyyy', date)}[/gold], [blue]${netDate('h:mm tt', date)}[/blue]`} /></div>
        <div class="rhs-meta"><RichText text={`[gold]Seed[/gold]: ${h.Seed}`} /></div>
        <div class="rhs-meta"><RichText text={mode} /></div>
        <div class="rhs-meta dim">{String(h.BuildId ?? '')}</div>
      </div>
      <div class="rhs-column">
        <div class="rhs-quote" style={{ color: h.Win ? '#7FFF00' : '#FF5555' }}><RichText text={quote} /></div>
        <div class="rhs-map" style={{ height: `${Math.max(174, 60 * acts.length)}px` }}>
          {acts.map((act: any[], ai: number) => {
            const from = base;
            base += act.length;
            return (
              <div class="rhs-act">
                <div class="rhs-act-title">{fmt(safe(() => G.ModelDb.GetById(G.ActModel, list(h.Acts)[ai]).Title, ''))}</div>
                {act.map((e: any, i: number) => <MapCell e={e} floor={from + i + 1} playerId={player.Id} tilt={r.tilts[ai]?.[i] ?? 0} lit={hl.has(from + i + 1)} onTip={onTip} />)}
              </div>
            );
          })}
        </div>
        <div class="rhs-spacer" />
        <RelicHistory relics={r.relics} setHl={setHl} />
        <DeckHistory deck={r.deck} setHl={setHl} />
      </div>
    </>
  );
}

/** LeftAlignedStuff: player icon (+ ascension badge), HP, gold, the potion belt, floors and run time, 24 apart. */
function TopRow({ r, hp, gold, floors }: { r: Loaded; hp: string; gold: string; floors: number }) {
  const { h, player, ch } = r;
  const tb = (n: string) => frameByName('ui_atlas', `top_bar/${n}`);
  const asc = Number(h.Ascension ?? 0);
  const slots = Math.max(0, Number(player.MaxPotionSlotCount ?? r.potions.length));
  const potW = Math.max(140, 18 + 60 * slots + 2 * Math.max(0, slots - 1) + 19);
  const iconTips = (): TipData[] => {
    const tips: TipData[] = [{ title: '', body: rh('PLAYER_HOVER', { PlayerName: fmt(ch.Title), CharacterName: '' }) }];
    if (asc > 0) {
      const t = safe(() => G.AscensionHelper.GetHoverTip(ch, asc), null);
      if (t) tips.push({ title: fmt(t.Title), body: fmt(t.Description) });
    }
    return tips;
  };
  const lblRef = useRef<HTMLDivElement>(null);
  useFit(lblRef, `rha|${asc}`, 20, 12, (el) => el.scrollWidth <= 14 + 8);
  return (
    <div class="rhs-left">
      <div class="rhs-player" onPointerEnter={() => setTips(iconTips(), { kind: 'at', x: 258, y: 135 })} onPointerLeave={() => setTip(null)}>
        <img src={imageUrl(`images/ui/top_panel/character_icon_${String(player.Character.Entry).toLowerCase()}.png`) ?? ''} />
        {asc > 0 && (
          <div class="rhs-asc">
            <div style={frameStyle(tb('top_bar_ascension'), 34, 49.5)} />
            <div class="rhs-asc-label" ref={lblRef}>{asc}</div>
          </div>
        )}
      </div>
      <div class="rhs-stat">
        <div style={frameStyle(tb('top_bar_heart'), 46, 36.8)} />
        <div class="rhs-num hp">{hp}</div>
      </div>
      <div class="rhs-stat">
        <div style={frameStyle(tb('top_bar_gold'), 44, 37.2)} />
        <div class="rhs-num gold">{gold}</div>
      </div>
      <div class="rhs-potions" style={{ width: `${potW}px` }}>
        <div class="tb-potion-bg" style={{ left: 0, top: '4px', width: `${potW}px`, borderImageSource: `url(${frameUrl(tb('top_bar_char_backdrop'), invalidate) ?? ''})` }} />
        {Array.from({ length: slots }, (_, i) => <HistoryPotion p={r.potions[i] ?? null} x={18 + 62 * i} />)}
      </div>
      <div class="rhs-stat floor">
        <div class="rhs-floor-icons">
          <div style={{ ...frameStyle(tb('top_bar_floor'), 44, 44), position: 'absolute', top: '1.5px' }} />
          <div style={{ ...frameStyle(tb('top_bar_floor'), 44, 44), position: 'absolute', top: 0 }} />
        </div>
        <div class="rhs-num floor">{floors}</div>
      </div>
      <div class="rhs-stat time">
        <div style={frameStyle(tb('timer_icon'), 48, 48)} />
        <div class="rhs-num gold">{safe(() => G.TimeFormatting.Format(h.RunTime), '')}</div>
      </div>
    </div>
  );
}
/** NPotionHolder (isUsable: false): as in the top bar — bounce and slosh on hover, the tip under the slot — without the popup. */
function HistoryPotion({ p, x }: { p: any; x: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const img = safe(() => p?.ImagePath, '');
  return (
    <div class={'tb-potion' + (p ? '' : ' empty')} style={{ left: `${x}px`, top: '9px', cursor: 'default' }}
      onPointerEnter={(e) => {
        holder.current?.animate([{ translate: '0 0' }, { translate: '0 -12px', easing: 'cubic-bezier(.61, 1, .88, 1)' }, { translate: '0 0', easing: 'cubic-bezier(.12, 0, .39, 0)' }], { duration: 250 });
        if (!p) return;
        safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play(`potion_slosh_${1 + Math.floor(Math.random() * 3)}.mp3`, 0.5), null);
        const r = logicalRect(e.currentTarget as Element);
        if (r) setTips(hoverTipsOf(p), { kind: 'at', x: r[0], y: r[1] + 90 });
      }}
      onPointerLeave={() => setTip(null)}>
      <div class="tb-potion-holder" ref={holder}>
        {p ? (
          <>
            <div class="tb-potion-outline" style={frameStyle(atlasFrame(img.replace('potion_atlas', 'potion_outline_atlas')), 54, 54)} />
            <div class="tb-potion-img" style={frameStyle(atlasFrame(img), 54, 54)} />
          </>
        ) : <img class="tb-potion-empty" src={imageUrl('images/packed/potions/potion_placeholder.png') ?? ''} />}
      </div>
    </div>
  );
}

/**
 * NMapPointHistoryEntry (60 × 60): the room icon (64 px at 0.7, tilted 0–5°) over its outline (black 0.18) and the
 * quest marker; hovered or linked it straightens to 1.05 with a white 0.5 outline (0.05 s), back over 1 s.
 */
function MapCell({ e, floor, playerId, tilt, lit, onTip }: { e: any; floor: number; playerId: any; tilt: number; lit: boolean; onTip: (t: any) => void }) {
  const [hot, setHot] = useState(false);
  const [touched, setTouched] = useState(false);
  const room = list(e.Rooms)[0];
  const special = e.MapPointType === G.MapPointType.Boss || e.MapPointType === G.MapPointType.Ancient;
  const args = [e.MapPointType, room?.RoomType ?? G.RoomType.Unassigned, special ? room?.ModelId : null];
  const icon = imageUrl(safe(() => G.ImageHelper.GetRoomIconPath(...args), null));
  const outline = imageUrl(safe(() => G.ImageHelper.GetRoomIconOutlinePath(...args), null));
  const quest = safe(() => list(playerEntry(e, playerId)?.CompletedQuests).length > 0, false);
  const on = hot || lit;
  const t = on ? `.05s ${EXPO_OUT}` : `1s ${EXPO_OUT}`;
  return (
    <div class="rhs-cell"
      onPointerEnter={(ev) => {
        setHot(true); setTouched(true);
        const r = logicalRect(ev.currentTarget as Element);
        if (r) onTip({ d: floorTipData(e, floor, playerId), cell: [r[0], r[1]] });
      }}
      onPointerLeave={() => { setHot(false); onTip(null); }}>
      {icon && (
        <div class="rhs-cell-icon" style={{ scale: on ? '1.05' : '0.7', rotate: `${on ? 0 : tilt}deg`, transition: `scale ${t}, rotate ${t}` }}>
          {outline && <img class="rhs-cell-outline" src={outline} style={{ filter: on ? tint(1, 1, 1, 0.5) : tint(0, 0, 0, touched ? 0.25 : 0.184), transition: `filter ${t}` }} />}
          <img class="rhs-cell-img" src={icon} />
          {quest && <img class="rhs-cell-quest" src={imageUrl('images/packed/map/icons/map_spoils_map_marker.png') ?? ''} />}
        </div>
      )}
    </div>
  );
}

/** Counts per rarity for the header's categories line (… .Trim(',')). */
function categories(key: string, rarities: any, items: any[], suffix: string, rarityOf: (x: any) => number) {
  const ls = safe(() => new G.LocString().$ctor_LocString('run_history', key), null);
  if (!ls) return '';
  for (const [k, v] of Object.entries(rarities)) if (typeof v === 'number') safe(() => ls.Add$String_Decimal(`${k}${suffix}`, items.filter((x) => rarityOf(x) === v).length), null);
  return fmt(ls).replace(/^,+|,+$/g, '');
}

/** NRelicHistory: "[gold][b]Relics (n):[/b][/gold]" + the rarity breakdown, then 68 px holders (19 a row). */
function RelicHistory({ relics, setHl }: { relics: any[]; setHl: (s: Set<number>) => void }) {
  const header = `[gold][b]${rh('RELIC_HISTORY.header', { totalRelics: relics.length })}[/b][/gold]${categories('RELIC_HISTORY.categories', G.RelicRarity, relics, 'Relics', (r) => r.Rarity)}`;
  return (
    <div class="rhs-relics">
      <div class="rhs-head"><RichText text={header} /></div>
      <div class="rhs-relic-grid">{relics.map((r) => <RelicCell r={r} all={relics} setHl={setHl} />)}</div>
    </div>
  );
}
/** NRelicBasicHolder: hover 1.25 over 0.05 s (no sound), relic tip under it, the floor it came from lit; release inspects. */
function RelicCell({ r, all, setHl }: { r: any; all: any[]; setHl: (s: Set<number>) => void }) {
  const [hot, setHot] = useState(false);
  const pressed = useRef(false);
  const id = String(safe(() => r.Id.Entry, '')).toLowerCase();
  return (
    <div class="rhs-relic"
      onPointerEnter={(e) => {
        setHot(true);
        const rr = logicalRect(e.currentTarget as Element);
        if (rr) setTips(hoverTipsOf(r), { kind: 'relic', rect: [rr[0], rr[1], 68, 60] });
        const f = Number(safe(() => r.FloorAddedToDeck, 0));
        if (f > 0) setHl(new Set([f]));
      }}
      onPointerLeave={() => { setHot(false); pressed.current = false; if (!inspectActive()) setTip(null); setHl(new Set()); }}
      onPointerDown={(e) => { if (e.button === 0) { pressed.current = true; clickSfx(); } }}
      onPointerUp={(e) => { if (e.button === 0 && pressed.current) { pressed.current = false; setTip(null); inspectRelic(all, r); } }}>
      <div class="rhs-relic-icon" style={{ scale: hot ? '1.25' : '1', transition: hot ? 'scale .05s linear' : `scale 1s ${EXPO_OUT}` }}>
        <div class="relic-entry-outline" style={{ ...frameStyle(frameByName('relic_outline_atlas', id), 60, 60), filter: tint(0, 0, 0, 0.5) }} />
        <div style={frameStyle(atlasFrame(safe(() => r.IconPath, '')) ?? frameByName('relic_atlas', id), 60, 60)} />
      </div>
    </div>
  );
}

/** NDeckHistory: "[gold][b]Cards (n):[/b][/gold]" + the rarity breakdown, then 240 × 32 entries, 5 a row. */
function DeckHistory({ deck, setHl }: { deck: Loaded['deck']; setHl: (s: Set<number>) => void }) {
  const cards = deck.flatMap((g) => Array(g.n).fill(g.card));
  const header = `[gold][b]${rh('DECK_HISTORY.header', { totalCards: cards.length })}[/b][/gold]${categories('DECK_HISTORY.categories', G.CardRarity, cards, 'Cards', (c) => c.Rarity)}`;
  const all = deck.map((g) => g.card);
  return (
    <div class="rhs-deck">
      <div class="rhs-head shadow"><RichText text={header} /></div>
      <div class="rhs-deck-grid">{deck.map((g) => <DeckEntry g={g} all={all} setHl={setHl} />)}</div>
    </div>
  );
}
const DECK_COLOR: Record<string, string> = {
  IroncladCardPool: '#D62000', SilentCardPool: '#5EBD00', DefectCardPool: '#3EB3ED', NecrobinderCardPool: '#CD4EED', RegentCardPool: '#E36600',
  ColorlessCardPool: '#A3A3A3', EventCardPool: '#A3A3A3', CurseCardPool: '#585B61', QuestCardPool: '#24476A',
};
const BANNER_COLOR = (r: number) => { const R = G.CardRarity; return ({ [R.Basic]: [0.612, 0.612, 0.612], [R.Common]: [0.612, 0.612, 0.612], [R.Uncommon]: [0.392, 1, 1], [R.Rare]: [1, 0.855, 0.212], [R.Curse]: [0.902, 0.412, 1], [R.Event]: [0.075, 0.745, 0.102], [R.Quest]: [0.957, 0.408, 0.212] } as Record<number, number[]>)[r] ?? [1, 1, 1]; };
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
/** NTinyCard (32 × 32, nearest filtering): pool-coloured card back with the frame material, desc box, type portrait, rarity banner. */
export function TinyCard({ card }: { card: any }) {
  const pool = safe(() => card.Pool.constructor.name, '');
  const back = safe(() => { const c = card.Pool.DeckEntryCardColor; return [c.R, c.G, c.B]; }, null) ?? (DECK_COLOR[pool] ? hex(DECK_COLOR[pool]) : [1, 1, 1]);
  const type = safe(() => $.enumStr(G.CardType, card.Type).toLowerCase(), 'skill');
  const shape = type === 'attack' || type === 'power' ? type : 'skill';
  const banner = BANNER_COLOR(safe(() => card.Rarity, 0));
  const u = (n: string) => imageUrl(`images/packed/run_history/${n}.png`) ?? '';
  return (
    <div class="tiny-card">
      <img src={u('card_back')} style={{ filter: `${matFilter(safe(() => card.VisualCardPool.FrameMaterialPath, ''))} ${tint(back[0], back[1], back[2])}` }} />
      <img src={u('desc_box')} style={{ filter: 'brightness(0)', opacity: 0.251 }} />
      <img src={u(`${shape}_portrait_shadow`)} />
      <img src={u(`${shape}_portrait`)} style={{ filter: tint(0.95, 0.92, 0.694) }} />
      <img src={u('banner_shadow')} style={{ filter: tint(0.392 * banner[0], banner[1], banner[2]) }} />
      <img src={u('banner')} style={{ filter: tint(banner[0], banner[1], banner[2]) }} />
    </div>
  );
}
/** NDeckHistoryEntry: tiny card, enchantment icon, "{n}x Title" (green upgraded, purple enchanted); hover 1.5 and the label +8 px. */
function DeckEntry({ g, all, setHl }: { g: Loaded['deck'][number]; all: any[]; setHl: (s: Set<number>) => void }) {
  const [hot, setHot] = useState(false);
  const pressed = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const c = g.card;
  const ench = safe(() => c.Enchantment, null);
  const text = `${g.n > 1 ? `${g.n}x ` : ''}${fmt(safe(() => c.Title, ''))}`;
  const color = ench ? '#EE82EE' : safe(() => c.CurrentUpgradeLevel >= 1, false) ? '#7FFF00' : '#FFF6E2';
  useFit(ref, `rhd|${text}`, 24, 20, (el) => el.scrollWidth <= 196);
  const t = hot ? '.05s linear' : `.5s ${EXPO_OUT}`;
  return (
    <div class="rhs-entry"
      onPointerEnter={() => { setHot(true); setHl(new Set(g.floors)); }}
      onPointerLeave={() => { setHot(false); pressed.current = false; setHl(new Set()); }}
      onPointerDown={(e) => { if (e.button === 0) { pressed.current = true; clickSfx(); } }}
      onPointerUp={(e) => { if (e.button === 0 && pressed.current) { pressed.current = false; inspectCard(all, c); } }}>
      <div class="rhs-tiny" style={{ scale: hot ? '1.5' : '1', transition: `scale ${t}` }}><TinyCard card={c} /></div>
      {ench && <img class="rhs-ench" src={imageUrl(`images/enchantments/${String(ench.Id.Entry).toLowerCase()}.png`) ?? ''} />}
      <div class="rhs-entry-label" ref={ref} style={{ color, translate: hot ? '8px 0' : '0 0', transition: `translate ${t}` }}>{text}</div>
    </div>
  );
}
