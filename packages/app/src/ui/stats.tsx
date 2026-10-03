// Statistics (NStatsScreen): two settings tabs (Achievements disabled in this build), then one scrolling column —
// "Overall Stats" (a 2-column panel of icon entries) and "Character Stats" (a card per played character) — with the
// inert share button and the back button. Transparent over the menu blur or the capstone backstop.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'preact/hooks';
import { G, list } from '../game';
import { leaveScreen } from '../store';
import { imageUrl, frameByName, frameStyle } from '../assets';
import { loc, locv } from '../i18n';
import { useFit } from './card';
import { RichText } from './richtext';
import { setTip, logicalRect } from './tooltip';
import { BackButton } from './buttons';
import { safe, fmt, EXPO_OUT, hoverSfx, clickSfx, useScroller } from './comp-shared';
import { fracX } from '../view';

const ratio = (a: number, b: number) => fmt(safe(() => G.StringHelper.RatioFormat$Int32_Int32(a, b), `${a}/${b}`));
const time = (s: number) => safe(() => G.TimeFormatting.Format(s), String(s));
const s = (k: string, v: Record<string, any>) => locv('stats_screen', k, v);
const CHARS: [any, string][] = [['Ironclad', '#FF5555'], ['Silent', '#7FFF00'], ['Regent', '#FFA518'], ['Necrobinder', '#EE82EE'], ['Defect', '#87CEEB']];

export function Stats() {
  const [gen, setGen] = useState(0); // the Statistics tab reloads the stats (OpenStatsMenu)
  const sc = useScroller();
  const sm = G.SaveManager.Instance, p = sm.Progress;
  const epochs = list(p.Epochs);
  const revealed = epochs.filter((e: any) => e.State >= 5).length;
  const allKnown = list(G.EpochModel.AllEpochIds).every((id: any) => epochs.some((e: any) => e.Id === id));
  const asc = safe(() => sm.GetAggregateAscensionProgress(), 0);
  const tipPlay = { title: loc('stats_screen', 'TIP_PLAYTIME.header'), body: loc('stats_screen', 'TIP_PLAYTIME.description') };
  const tipAsc = asc > 0 ? { title: loc('stats_screen', 'TIP_WIN_LOSS.header'), body: loc('stats_screen', 'TIP_WIN_LOSS.description') } : undefined;
  // NGeneralStatsGrid, row-major
  const overall: [string, string, string?, { title: string; body: string }?][] = [
    ['stats_achievements', s('ENTRY_ACHIEVEMENTS.top', { Amount: ratio(safe(() => G.AchievementsUtil.UnlockedAchievementCount(), 0), safe(() => G.AchievementsUtil.TotalAchievementCount(), 0)) }),
      s('ENTRY_ACHIEVEMENTS.bottom', { Amount: allKnown ? ratio(revealed, epochs.length) : fmt(safe(() => G.StringHelper.RatioFormat$String_String(String(revealed), '??'), `${revealed}/??`)) })],
    ['stats_clock', s('ENTRY_PLAYTIME.top', { Playtime: time(p.TotalPlaytime) }), p.Wins > 0 ? s('ENTRY_PLAYTIME.bottom', { FastestWin: time(p.FastestVictory) }) : undefined, tipPlay],
    ['stats_cards', s('ENTRY_CARDS.top', { Amount: ratio(sm.GetTotalUnlockedCards(), G.SaveManager.GetUnlockableCardCount()) }), s('ENTRY_CARDS.bottom', { Amount: ratio(list(p.DiscoveredCards).length, list(G.ModelDb.AllCards).length) })],
    ['stats_swords', asc > 0 ? s('ENTRY_WIN_LOSS.top', { Amount: ratio(asc, G.SaveManager.GetAggregateAscensionCount()) }) : '', s('ENTRY_WIN_LOSS.bottom', { Wins: p.Wins, Losses: p.Losses }), tipAsc],
    ['stats_monsters', s('ENTRY_MONSTER.top', { Amount: fmt(safe(() => G.StringHelper.Radix(sm.GetTotalKills()), '0')) }), s('ENTRY_MONSTER.bottom', { Amount: ratio(safe(() => p.EnemyStats.Count, 0), list(G.ModelDb.Monsters).length) })],
    ['stats_chest', s('ENTRY_RELIC.top', { Amount: ratio(sm.GetTotalUnlockedRelics(), G.SaveManager.GetUnlockableRelicCount()) }), s('ENTRY_RELIC.bottom', { Amount: ratio(list(p.DiscoveredRelics).length, list(G.ModelDb.AllRelics).length) })],
    ['stats_potions_seen', s('ENTRY_POTION.top', { Amount: ratio(sm.GetTotalUnlockedPotions(), G.SaveManager.GetUnlockablePotionCount()) }), s('ENTRY_POTION.bottom', { Amount: list(G.ModelDb.AllPotions).length })],
    ['stats_questionmark', s('ENTRY_EVENTS.top', { Amount: 'N/A' }), s('ENTRY_EVENTS.bottom', { Amount: ratio(list(p.DiscoveredEvents).length, list(G.ModelDb.AllEvents).length) })],
    ['stats_chain', s('ENTRY_STREAK.top', { Amount: p.BestWinStreak })],
  ];
  // NCharacterStats, fixed order, only characters that were played (GetStatsForCharacter only reads)
  const chars = CHARS.map(([T, color]) => {
    const c = safe(() => G.ModelDb.Character(G[T]), null);
    const cs = c && safe(() => p.GetStatsForCharacter(c.Id), null);
    return c && cs ? { c, cs, color } : null;
  }).filter(Boolean) as { c: any; cs: any; color: string }[];
  return (
    <div class="screen stats-screen fade-in" data-gen={gen}>
      <div class="stats-grid" {...sc.handlers}>
        <div class="stats-inner" ref={sc.inner} style={sc.innerStyle}>
          <div class="stats-header">{loc('main_menu_ui', 'STATISTICS.OVERALL.title')}</div>
          <div class="stats-overall">{overall.map(([icon, top, bottom, tip]) => <StatEntry icon={icon} top={top} bottom={bottom} tip={tip} />)}</div>
          <div class="stats-spacer" />
          <div class="stats-header">{loc('main_menu_ui', 'STATISTICS.title')}</div>
          <div class="stats-chars">
            {chars.map(({ c, cs, color }) => (
              <div class="stats-char">
                <div class="stats-char-head">
                  <img src={imageUrl(`images/ui/top_panel/character_icon_${String(c.Id.Entry).toLowerCase()}.png`) ?? ''} />
                  <span style={{ color }}>{safe(() => c.Title.GetRawText(), fmt(c.Title))}</span>
                </div>
                <StatEntry icon="stats_clock" top={s('ENTRY_CHAR_PLAYTIME.top', { Playtime: time(cs.Playtime) })} bottom={cs.FastestWinTime >= 0 ? s('ENTRY_CHAR_PLAYTIME.bottom', { FastestWin: time(cs.FastestWinTime) }) : undefined} />
                <StatEntry icon="stats_swords" top={cs.MaxAscension > 0 ? `[red]${s('ENTRY_CHAR_WIN_LOSS.top', { Amount: cs.MaxAscension })}[/red]` : ''} bottom={s('ENTRY_CHAR_WIN_LOSS.bottom', { Wins: cs.TotalWins, Losses: cs.TotalLosses })} />
                <StatEntry icon="stats_chain" top={s('ENTRY_CHAR_STREAK.top', { Amount: cs.CurrentWinStreak })} bottom={s('ENTRY_CHAR_STREAK.bottom', { Amount: cs.BestWinStreak })} />
              </div>
            ))}
          </div>
        </div>
        {sc.scrollbar(1527, 217, 48, 800)}
      </div>
      <ShareButton />
      <div class="stats-tabs">
        <StatsTab x={698} label={loc('stats_screen', 'TAB_STATS.header')} onClick={() => { setTip(null); setGen((g) => g + 1); }} />
        <StatsTab x={966} label={loc('stats_screen', 'TAB_ACHIEVEMENT.header')} disabled />
      </div>
      <BackButton enabled onClick={() => { setTip(null); leaveScreen(); }} />
    </div>
  );
}

/**
 * NStatEntry (500 wide): the stats_screen_atlas icon (80 × 72 box, keep aspect) and one or two Kreon 28 labels
 * (auto-shrunk onto one line, 20 px overlap); an empty label is hidden. Hover 1.05 over 0.05 s (no sound).
 */
function StatEntry({ icon, top, bottom, tip }: { icon: string; top: string; bottom?: string; tip?: { title: string; body: string } }) {
  const [hot, setHot] = useState(false);
  const labels = [top, bottom].filter((t): t is string => !!t);
  const f = frameByName('stats_screen_atlas', icon);
  const box = labels.length > 1 ? 76 : 72;
  const k = f ? Math.min(80 / f.sw, box / f.sh) : 1;
  return (
    <div class="stat-entry2" style={{ height: `${labels.length > 1 ? 92 : 88}px`, scale: hot ? '1.05' : '1', transition: hot ? 'scale .05s linear' : `scale .5s ${EXPO_OUT}` }}
      onPointerEnter={(e) => {
        setHot(true);
        const r = logicalRect(e.currentTarget as Element);
        if (tip && r) setTip(tip.title, tip.body, { kind: 'at', x: r[0] < fracX(0.4) ? r[0] - 392 : r[0] + 532, y: r[1] });
      }}
      onPointerLeave={() => { setHot(false); if (tip) setTip(null); }}>
      <div class="se-icon"><div style={f ? frameStyle(f, f.sw * k, f.sh * k) : {}} /></div>
      <div class="se-labels">{labels.map((t) => <FitLabel text={t} />)}</div>
    </div>
  );
}
function FitLabel({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFit(ref, `se|${text}`, 28, 12, (el) => (el.firstChild as HTMLElement).offsetWidth <= 404);
  return <div class="se-label" ref={ref}><RichText text={text} /></div>;
}

/** NSettingsTab (256 × 90) as the stats tabs: settings_tab_selected at v 0.9; the disabled Achievements tab is DimGray with a lock. */
function StatsTab({ x, label, disabled, onClick }: { x: number; label: string; disabled?: boolean; onClick?: () => void }) {
  const [hot, setHot] = useState(false);
  const selected = !disabled;
  const t = hot ? 'none' : `.5s ${EXPO_OUT}`;
  return (
    <div class={'settings-tab' + (disabled ? ' disabled' : '')} style={{ left: `${x}px`, scale: hot ? '1.05' : '1', transition: hot ? 'none' : `scale ${t}` }}
      onPointerEnter={() => { if (disabled) return; setHot(true); hoverSfx(); }} onPointerLeave={() => setHot(false)}
      onPointerDown={(e) => { if (!disabled && e.button === 0) clickSfx(); }}
      onPointerUp={(e) => { if (!disabled && e.button === 0) onClick?.(); }}>
      {selected && <img class="stab-outline" src={imageUrl('images/packed/common_ui/settings_tab_stroke.png') ?? ''} />}
      <img class="stab-img" src={imageUrl('images/packed/common_ui/settings_tab_selected.png') ?? ''} style={{ filter: `brightness(${hot ? 1.2 : 0.9})`, transition: hot ? 'none' : `filter ${t}` }} />
      <div class="stab-label" style={{ color: hot ? '#EFC851' : selected ? '#FFF6E2' : 'rgba(255, 246, 226, .5)', transition: hot ? 'none' : `color ${t}` }}>{label}</div>
      {disabled && <img class="stats-tab-lock" src={imageUrl('images/packed/main_menu/submenu_lock.png') ?? ''} />}
    </div>
  );
}

/** ui/share_button.tscn with NShareStatsButton: visible, does nothing; the card_unplayable badge sits over it. */
export function ShareButton({ inert, label = 'Share', badge = 102 }: { inert?: boolean; label?: string; badge?: number }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  return (
    <div class="share-btn"
      onPointerEnter={() => { if (inert) return; setSt('hover'); hoverSfx(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (!inert && e.button === 0) { setSt('press'); clickSfx(); } }} onPointerUp={() => setSt(st ? 'hover' : '')}>
      <div class="share-visuals" style={{ scale: st === 'hover' ? '1.05' : st === 'press' ? '0.95' : '1' }}>
        <div style={{ ...frameStyle(frameByName('stats_screen_atlas', 'share_stats'), 64, 64), position: 'absolute', left: '11px', top: 0 }} />
        <div class="share-label">{label}</div>
      </div>
      <div class="share-badge" style={{ ...frameStyle(frameByName('ui_atlas', 'card/card_unplayable_icon'), badge, badge), left: `${86 - badge / 2}px`, top: `${32 - badge / 2}px` }} />
    </div>
  );
}
