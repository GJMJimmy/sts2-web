// NCompendiumSubmenu (screens/compendium_submenu.tscn): four 368 × 490 short submenu buttons — Card Library, Relic
// Collection, Potion Lab, Bestiary (disabled, as in the game) — and the Statistics / Run History bottom buttons, in a
// 1920 × 1080 margin box (200 / 64), with the back button. Leaderboards and Achievements are hidden in the game too.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'preact/hooks';
import { G } from '../game';
import { ui, invalidate, type Screen } from '../store';
import { playOneShot } from '../audio';
import { imageUrl } from '../assets';
import { loc } from '../i18n';
import { hsvFilter } from '../filters';
import './compendium.css';
import { RichText } from './richtext';
import { BackButton } from './buttons';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const m = (k: string) => loc('main_menu_ui', k);
const open = (s: Screen) => { ui.subscreen = s; invalidate(); };

export function CompendiumSubmenu({ onBack }: { onBack: () => void }) {
  const history = safe(() => G.SaveManager.Instance.GetRunHistoryCount() > 0, false); // NRunHistory.CanBeShown
  const top: [string, string, number[], (() => void) | null][] = [
    ['COMPENDIUM_CARD_LIBRARY', 'submenu_card_library', [1, 0.6, 0.8], () => open('library')],
    ['COMPENDIUM_RELIC_COLLECTION', 'submenu_relic_collection', [0.48, 0.8, 0.7], () => open('relics')],
    ['COMPENDIUM_POTION_LAB', 'submenu_potion_lab', [0.24, 1, 0.7], () => open('potions')],
    ['COMPENDIUM_BESTIARY', 'submenu_bestiary', [0.93, 1.2, 0.65], null],
  ];
  const bottom: [string, string, number[], number[], () => void][] = [
    ['STATISTICS', 'submenu_stats_icon', [0.84, 1.4, 1.1], [52.9, 27, 174.2, 112], () => open('stats')],
    ...(history ? [['RUN_HISTORY', 'submenu_history_icon', [0.725, 2.5, 1], [22.4, 33, 235.2, 105], () => open('history')] as [string, string, number[], number[], () => void]] : []),
  ];
  return (
    <div class="compendium-menu">
      {top.map(([key, icon, hsv, onClick], i) => <ShortSubmenuButton x={206 + 380 * i} keyPrefix={key} icon={icon} hsv={hsv} onClick={onClick} />)}
      {/* BottomRow is right-aligned (SHRINK_END, 24 apart) in the 200 / 64 margin box */}
      {bottom.map(([key, icon, hsv, rect, onClick], i) => <CompendiumBottomButton x={1720 - bottom.length * 280 - (bottom.length - 1) * 24 + 304 * i} keyPrefix={key} icon={icon} hsv={hsv} rect={rect} onClick={onClick} />)}
      <BackButton enabled onClick={onBack} />
    </div>
  );
}

/**
 * NShortSubmenuButton: submenu_panel_short (hsv per button), the icon, the title (Kreon Bold 28, gold) and the
 * description. Hover 1.02 and v + .2 (0.05 s); unhover over 0.3 s Cubic Out; press 0.98 and light grey. Disabled ones
 * are dark grey with the lock and the LOCKED description.
 */
function ShortSubmenuButton({ x, keyPrefix, icon, hsv, onClick }: { x: number; keyPrefix: string; icon: string; hsv: number[]; onClick: (() => void) | null }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const enabled = !!onClick;
  const k = st === 'hover' ? 1.02 : st === 'press' ? 0.98 : 1, v = hsv[2] + (st === 'hover' ? 0.2 : 0);
  const t = st === 'hover' ? '.05s linear' : st === 'press' ? '.2s cubic-bezier(0.33, 1, 0.68, 1)' : '.3s cubic-bezier(0.33, 1, 0.68, 1)';
  const tl = st === 'hover' ? '.05s linear' : st === 'press' ? '.2s linear' : '.3s linear'; // v and modulate tween linearly
  const desc = enabled ? m(`${keyPrefix}.description`) : (() => { const l = m(`${keyPrefix}.LOCKED.description`); return l && !l.includes('LOCKED') ? l : m(`${keyPrefix}.description`); })();
  return (
    <div class={'short-submenu-btn' + (enabled ? '' : ' disabled')} style={{ left: `${x}px`, top: '183px', scale: String(k), filter: st === 'press' ? 'brightness(.75)' : 'none', transition: `scale ${t}, filter ${tl}` }}
      onPointerEnter={() => { if (!enabled) return; setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
      onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (enabled && e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && st === 'press') { setSt(''); onClick!(); } }}>
      <img class="ssb-panel" src={imageUrl('images/packed/common_ui/submenu_panel_short.png') ?? ''} style={{ filter: `${hsvFilter(hsv[0], 1, 1)} saturate(${hsv[1]}) brightness(${v})`, transition: `filter ${tl}` }} />
      <img class="ssb-icon" src={imageUrl(`images/ui/main_menu/${icon}.png`) ?? ''} />
      {!enabled && <img class="ssb-icon" src={imageUrl('images/ui/main_menu/submenu_lock.png') ?? ''} />}
      <div class="ssb-title">{m(`${keyPrefix}.title`)}</div>
      <div class="ssb-desc"><RichText text={desc} /></div>
    </div>
  );
}

/** NCompendiumBottomButton (280 × 200): submenu_compendium_button (covered), its icon and label; hover 1.05 and v + .2, press 0.95. */
function CompendiumBottomButton({ x, keyPrefix, icon, hsv, rect, onClick }: { x: number; keyPrefix: string; icon: string; hsv: number[]; rect: number[]; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const k = st === 'hover' ? 1.05 : st === 'press' ? 0.95 : 1, v = hsv[2] + (st === 'hover' ? 0.2 : 0);
  const t = st === 'hover' ? '.05s linear' : st === 'press' ? '.2s cubic-bezier(0.33, 1, 0.68, 1)' : '.3s cubic-bezier(0.33, 1, 0.68, 1)';
  const tl = st === 'hover' ? '.05s linear' : st === 'press' ? '.2s linear' : '.3s linear';
  return (
    <div class="compendium-bottom-btn" style={{ left: `${x}px`, top: '697px', scale: String(k), filter: st === 'press' ? 'brightness(.75)' : 'none', transition: `scale ${t}, filter ${tl}` }}
      onPointerEnter={() => { setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
      onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt(''); onClick(); } }}>
      <img class="cbb-panel" src={imageUrl('images/packed/common_ui/submenu_compendium_button.png') ?? ''} style={{ filter: `${hsvFilter(hsv[0], 1, 1)} saturate(${hsv[1]}) brightness(${v})`, transition: `filter ${tl}` }} />
      <img class="cbb-icon" src={imageUrl(`images/packed/main_menu/${icon}.png`) ?? ''} style={{ left: `${rect[0]}px`, top: `${rect[1]}px`, width: `${rect[2]}px`, height: `${rect[3]}px`, objectFit: 'contain' }} />
      <div class="cbb-label">{m(`${keyPrefix}.title`)}</div>
    </div>
  );
}
