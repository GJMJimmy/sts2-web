// NCapstoneContainer + NCapstoneSubmenuStack in a run: the pause menu and the submenus it pushes (settings, the
// compendium) over the capstone backstop (black 0.851, fading in over 0.5 s Cubic Out, or at once over overlays). The
// top bar and the relics slide up while the stack is open.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'preact/hooks';
import { G, $, N, list } from '../game';
import { ui, invalidate, hideOverlays, showOverlays } from '../store';
import { playOneShot, stopMusic } from '../audio';
import { imageUrl } from '../assets';
import { loc } from '../i18n';
import { hsvFilter } from '../filters';
import { BackButton } from './buttons';
import { SettingsScreen } from './settings';
import { CompendiumSubmenu } from './compendium-menu';
import { abandonRunPopup } from './modal';
import { toMenu } from '../flow';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The capstone backstop's alpha and whether it fades (it snaps when overlays are up). */
export const capstone = { A: 0, fade: true };
export type Submenu = 'pause' | 'settings' | 'compendium';
export const submenus: Submenu[] = [];

/** NCapstoneContainer.Open: overlays hide; the backstop fades in unless a capstone or an overlay was already up. */
function capstoneOpen() {
  const had = ui.pauseOpen || !!ui.cardsView;
  if (ui.pauseOpen) closeStack();
  hideOverlays();
  capstone.fade = !had && ui.overlays.length === 0;
  capstone.A = 1;
  safe(() => G.CombatManager.Instance.Pause(), undefined);
}
/** NCapstoneContainer.Close / CloseInternal. */
function capstoneClose() {
  safe(() => G.CombatManager.Instance.Unpause(), undefined);
  showOverlays();
  capstone.fade = ui.overlays.length === 0;
  capstone.A = 0;
}
/** NCapstoneSubmenuStack.AfterCapstoneClosed. */
function closeStack(sound = true) {
  submenus.length = 0;
  ui.pauseOpen = false;
  if (sound) playOneShot('event:/sfx/ui/pause_close');
}

/** NCapstoneSubmenuStack.ShowScreen(PauseMenu) → NCapstoneContainer.Open. */
export function openPauseMenu() {
  if (ui.pauseOpen) return;
  capstoneOpen();
  ui.cardsView = null;
  submenus.length = 0;
  submenus.push('pause');
  ui.pauseOpen = true;
  playOneShot('event:/sfx/ui/pause_open');
  invalidate();
}
export function closePauseMenu() {
  if (!ui.pauseOpen) return;
  closeStack();
  capstoneClose();
  invalidate();
}
/** NDeckViewScreen.ShowScreen / NCardPileScreen.ShowScreen (map_open.mp3), or their back button when already open. */
export function toggleCardsView(kind: 'deck' | 'draw' | 'discard' | 'exhaust') {
  if (kind === 'deck' && N('NRun').Instance?.GlobalUi.TopBar.Deck.IsEnabled === false) return;
  if (ui.cardsView?.kind === kind) { closeCardsView(); return; }
  capstoneOpen();
  ui.cardsView = { kind };
  safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play('map_open.mp3'), null);
  invalidate();
}
export function closeCardsView() {
  if (!ui.cardsView) return;
  ui.cardsView = null;
  capstoneClose();
  invalidate();
}
export function pushSubmenu(s: Submenu) { submenus.push(s); invalidate(); }
/** NSubmenuStack.Pop: the stack closes the capstone once empty. */
export function popSubmenu() { submenus.pop(); if (!submenus.length) closePauseMenu(); else invalidate(); }

export function CapstoneBackstop() {
  return <div class="capstone-backstop" style={{ opacity: capstone.A, transition: capstone.fade ? 'opacity .5s cubic-bezier(0.33, 1, 0.68, 1)' : 'none' }} />;
}

export function CapstoneStack() {
  if (!ui.pauseOpen) return null;
  const top = submenus[submenus.length - 1];
  return (
    <div class="capstone">
      {top === 'pause' && <PauseMenu />}
      {top === 'settings' && <SettingsScreen inRun onBack={popSubmenu} />}
      {top === 'compendium' && !ui.subscreen && <CompendiumSubmenu onBack={popSubmenu} />}
    </div>
  );
}

/**
 * NPauseMenu: "Paused" (Spectral Bold 64, gold) over a column of 372 × 80 buttons — Resume, Settings, Compendium
 * (once available), Give Up (red hue), Save and Quit — centred on the screen, and the back button.
 */
function PauseMenu() {
  const rm = G.RunManager.Instance;
  const p = (k: string) => loc('gameplay_ui', `PAUSE_MENU.${k}`);
  const [quitting, setQuitting] = useState(false);
  const compendium = safe(() => G.SaveManager.Instance.IsCompendiumAvailable(), true);
  const canGiveUp = safe(() => rm.IsInProgress && !rm.State.IsGameOver && !list(rm.State.Players).every((x: any) => x.Creature.IsDead), false);
  // OnBackOrResumeButtonPressed
  const resume = () => { playOneShot('event:/sfx/ui/map/map_close'); closePauseMenu(); };
  const giveUp = async () => { if (await abandonRunPopup()) { closePauseMenu(); rm.Abandon(); } };
  // CloseToMenu: the menu stays up (disabled) through NGame.ReturnToMainMenu's fade
  const saveAndQuit = () => {
    setQuitting(true);
    safe(() => rm.ActionQueueSet.Reset(), undefined);
    stopMusic();
    void toMenu().then(() => { submenus.length = 0; ui.pauseOpen = false; capstone.A = 0; capstone.fade = false; });
  };
  const buttons: [string, () => void, number[], string, boolean][] = [
    [p('RESUME'), resume, [1, 0.8, 0.9], '#25545C', true],
    [p('SETTINGS'), () => pushSubmenu('settings'), [1, 1, 1], '#25545C', true],
    ...(compendium ? [[p('COMPENDIUM'), () => pushSubmenu('compendium'), [1, 1, 1], '#25545C', true] as [string, () => void, number[], string, boolean]] : []),
    [p('GIVE_UP'), () => void giveUp(), [0.5, 1, 1], '#5C3225', canGiveUp],
    [p('SAVE_AND_QUIT'), saveAndQuit, [1, 1, 1], '#25545C', true],
  ];
  const top = compendium ? 306 : 340;
  return (
    <div class="pause-menu">
      <div class="pm-title" style={{ top: `${top}px` }}>{p('PAUSED')}</div>
      {buttons.map(([label, onClick, hsv, outline, enabled], i) => (
        <PauseButton label={label} y={top + 68 + 80 * i} hsv={hsv} outline={outline} enabled={enabled && !quitting} onClick={onClick} />
      ))}
      <BackButton enabled={!quitting} onClick={resume} />
    </div>
  );
}

/**
 * NPauseMenuButton: reward_item_button stretched to 372 × 80 at 0.9. Hover: s / v 1.1 at once, 0.95, label gold;
 * unhover: s .8 v .9, 0.9 over 0.5 s Expo Out; press: 0.85 and 6 px down. Disabled buttons are greyed.
 */
function PauseButton({ label, y, hsv, outline, enabled, onClick }: { label: string; y: number; hsv: number[]; outline: string; enabled: boolean; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const [touched, setTouched] = useState(false);
  const sv = st === 'hover' ? [1.1, 1.1] : st === 'press' || touched ? [0.8, 0.9] : [hsv[1], hsv[2]];
  const k = st === 'hover' ? 0.95 : st === 'press' ? 0.85 : 0.9, dy = st === 'press' ? 6 : 0;
  const t = st === 'hover' ? '.05s linear' : `.5s ${EXPO_OUT}`;
  return (
    <div class={'pause-btn' + (enabled ? '' : ' disabled')} style={{ top: `${y}px` }}
      onPointerEnter={() => { if (!enabled) return; setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
      onPointerLeave={() => { if (st) setTouched(true); setSt(''); }}
      onPointerDown={(e) => { if (enabled && e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && st === 'press') { setSt(''); setTouched(true); onClick(); } }}>
      <img class="pb-img" src={imageUrl('images/ui/reward_screen/reward_item_button.png') ?? ''}
        style={{ scale: String(k), translate: `0 ${dy}px`, filter: `${hsvFilter(hsv[0], 1, 1)} saturate(${sv[0]}) brightness(${sv[1]})`, transition: st === 'hover' ? `scale ${t}` : `scale ${t}, translate ${t}, filter ${t}` }} />
      <div class="pb-label" style={{ translate: `0 ${dy}px`, color: st === 'hover' ? '#EFC851' : '#FFF6E2', WebkitTextStrokeColor: outline, transition: `translate ${t}, color .05s linear` }}>{label}</div>
    </div>
  );
}
