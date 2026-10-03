// Main menu (NMainMenu, screens/main_menu.tscn) and its submenu stack (NMainMenuSubmenuStack): the text buttons with
// their reticles, the continue-run info, the profile button and the release label over MainMenuBg; pushed submenus
// (singleplayer, character select, settings, compendium) show over the BlurBackstop while the logo fades.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { G, $, list } from '../game';
import { playMusic, playOneShot } from '../audio';
import { ui, invalidate, type MenuSubmenu } from '../store';
import { imageUrl, frameByName, frameStyle } from '../assets';
import { loc, locv, appText } from '../i18n';
import { continueRun, abandonRun } from '../flow';
import { openTimeline, revealableCount, Timeline } from './timeline';
import { DailyRun, CustomRun } from './modes';
import { Profiles } from './profile';
import { PatchNotes } from './patchnotes';
import { RichText } from './richtext';
import { Backdrop } from './backdrop';
import { mainMenuBackdrop, setMenuBlur, setLogoAlpha } from '../render/scene';
import { abandonRunPopup } from './modal';
import { BackButton } from './buttons';
import { hsvFilter, tint } from '../filters';
import { SettingsScreen } from './settings';
import { CompendiumSubmenu } from './compendium-menu';
import { CharSelect } from './charselect';
import { transitionView } from './transition';
import { showEarlyAccessDisclaimer } from './disclaimer';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const m = (k: string) => loc('main_menu_ui', k);
const TR = { Linear: 0, Cubic: 7 }, EZ = { Out: 1 };
const BACK_OUT = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const profileId = () => safe(() => G.SaveManager.Instance.CurrentProfileId, 1);
export const epochRevealed = (T: any) => safe(() => G.SaveManager.Instance.IsEpochRevealed$_T1(T), false);

// ------------------------------------------------------------------ submenu stack
const bs = { K: 0, LogoA: 1 };
let bsTween: any = null, logoTween: any = null;
function animate(t: any) { $.onFrame(() => { setMenuBlur(bs.K); setLogoAlpha(bs.LogoA); return t.IsValid(); }); }
/** NMainMenu.EnableBackstop / DisableBackstop: blur (lod, mix) over 0.25 s in or 0.15 s out; the logo fades over 1 s. */
export function backstop(on: boolean) {
  bsTween?.Kill(); logoTween?.Kill();
  bsTween = new $.WebTween();
  bsTween.TweenProperty(bs, 'k', on ? 1 : 0, on ? 0.25 : 0.15);
  logoTween = new $.WebTween();
  logoTween.TweenProperty(bs, 'logo_a', on ? 0 : 1, 1).SetEase(EZ.Out).SetTrans(TR.Cubic);
  animate(bsTween); animate(logoTween);
}
/** NSubmenuStack.Push: the previous submenu hides at once, the new one shows at once. */
export function pushMenu(s: MenuSubmenu) { ui.menuStack = [...ui.menuStack, s]; backstop(true); invalidate(); }
/** NSubmenuStack.Pop: back to the previous submenu, or to the main menu's buttons. */
export function popMenu() {
  ui.menuStack = ui.menuStack.slice(0, -1);
  if (!ui.menuStack.length) backstop(false);
  invalidate();
}

let menuGen = 0;
/** NGame.ReloadMainMenu: a fresh main menu (empty stack, backstop and logo reset, fade-in, buttons refreshed). */
export function reloadMainMenu() { ui.menuStack = []; menuGen++; invalidate(); }
export function MainMenu() {
  useEffect(() => {
    playMusic('event:/music/menu_update');
    // a menu entered with submenus open (back from a menu-side screen) has its backstop up already
    bs.K = ui.menuStack.length ? 1 : 0; bs.LogoA = ui.menuStack.length ? 0 : 1;
    setMenuBlur(bs.K); setLogoAlpha(bs.LogoA);
    void transitionView.FadeIn(3);
    showEarlyAccessDisclaimer();
  }, [menuGen]);
  const top = ui.menuStack[ui.menuStack.length - 1];
  return (
    <div class="screen menu" data-shake key={menuGen}>
      <Backdrop id="main-menu" build={mainMenuBackdrop} />
      {!top && (
        <>
          <MainMenuTextButtons />
          <ProfileButton />
          <PatchNotes />
          <PortLinks />
        </>
      )}
      {top === 'singleplayer' && <SingleplayerSubmenu />}
      {top === 'charselect' && <CharSelect />}
      {top === 'settings' && <SettingsScreen inRun={false} onBack={popMenu} />}
      {/* NSubmenuStack.Push hides the compendium while one of its screens (ui.subscreen) is up */}
      {top === 'compendium' && !ui.subscreen && <CompendiumSubmenu onBack={popMenu} />}
      {top === 'timeline' && <Timeline />}
      {top === 'daily' && <DailyRun />}
      {top === 'custom' && <CustomRun />}
      {top === 'profile' && <Profiles />}
      {/* NDebugInfoLabelManager's ReleaseInfo: version and today's date */}
      <div class="mm-release">{'v0.98.3\n' + netDate('yyyy-MM-dd', new Date())}</div>
    </div>
  );
}

// ------------------------------------------------------------------ text buttons
interface Row { key: string; enabled: boolean; onClick: () => void; dot?: boolean }
let continuing = false;

/**
 * MainMenuTextButtons (VBox (642, 609)–(911, 1059), rows 200 × 50 centred vertically) in node order Continue,
 * Abandon Run, Singleplayer, Multiplayer, Timeline, Settings, Compendium (Quit is hidden on the web), with
 * RefreshButtons / UpdateTimelineButtonBehavior's visibility rules. Multiplayer stays disabled: no netcode.
 */
function MainMenuTextButtons() {
  const sm = G.SaveManager.Instance;
  const hasSave = safe(() => sm.HasRunSave, false);
  const discovered = revealableCount();
  const epochs = safe(() => list(sm.Progress.Epochs).length, 0);
  let timeline: boolean | null = null, dot = false, forced = false; // null: hidden
  if (discovered > 0 && !hasSave) { timeline = true; dot = true; forced = true; }
  else if (epochs > 1 && epochRevealed(G.NeowEpoch)) timeline = discovered === 0;
  else if (epochs > 1) timeline = false;
  const compendium = safe(() => sm.IsCompendiumAvailable(), false);
  const rows: Row[] = [
    ...(hasSave ? [
      { key: 'CONTINUE', enabled: !continuing, onClick: () => { continuing = true; void continueRun().finally(() => { continuing = false; }); } },
      { key: 'ABANDON_RUN', enabled: true, onClick: async () => { if (await abandonRunPopup()) { abandonRun(); invalidate(); } } },
    ] : [
      // SingleplayerButtonPressed: the first run goes straight to character select
      { key: 'SINGLE_PLAYER', enabled: !forced, onClick: () => pushMenu(safe(() => sm.Progress.NumberOfRuns, 0) > 0 ? 'singleplayer' : 'charselect') },
    ]),
    { key: 'MULTIPLAYER', enabled: false, onClick: () => {} },
    ...(timeline !== null ? [{ key: 'TIMELINE', enabled: timeline, dot, onClick: openTimeline }] : []),
    { key: 'SETTINGS', enabled: true, onClick: () => pushMenu('settings') },
    ...(compendium ? [{ key: 'COMPENDIUM', enabled: !forced, onClick: () => pushMenu('compendium') }] : []),
  ];
  const top0 = 609 + (450 - 50 * rows.length) / 2;
  const retL = useRef<HTMLDivElement>(null), retR = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState(false);
  const run = useMemo(() => continueInfo(), [hasSave]);
  // MainMenuButtonFocused: the reticles jump to the row and slide out from the label (Back Out); Unfocused fades them
  const focus = (i: number, lbl: HTMLElement) => {
    const x = 676.5 + lbl.offsetLeft, r = x + lbl.offsetWidth, y = `${top0 + 50 * i + 5}px`;
    for (const [el, from, to] of [[retL.current, x - 26, x - 54], [retR.current, r - 14, r + 14]] as [HTMLDivElement, number, number][]) {
      el.style.top = y;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ left: `${from}px` }, { left: `${to}px` }], { duration: 250, easing: BACK_OUT, fill: 'forwards' });
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 50, fill: 'forwards' });
    }
  };
  const unfocus = () => {
    for (const el of [retL.current, retR.current]) {
      if (!el) continue;
      const o = getComputedStyle(el).opacity;
      el.getAnimations().filter((a) => (a.effect as KeyframeEffect)?.getKeyframes().some((k) => 'opacity' in k)).forEach((a) => a.cancel());
      el.animate([{ opacity: o }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
    }
  };
  const reticle = (flip: boolean, ref: any) => (
    <div class="mm-reticle" ref={ref} style={{ backgroundImage: `url(${imageUrl('images/packed/main_menu/main_menu_button_highlight.png')})`, filter: tint(0.937, 0.784, 0.318), scale: flip ? '-1 1' : undefined }} />
  );
  return (
    <>
      {reticle(false, retL)}
      {reticle(true, retR)}
      <div class="mm-buttons" style={{ top: `${top0}px` }}>
        {rows.map((row, i) => (
          <MainMenuTextButton key={row.key} row={row} onFocus={(lbl) => { focus(i, lbl); if (row.key === 'CONTINUE') setInfo(true); }}
            onUnfocus={() => { unfocus(); if (row.key === 'CONTINUE') setInfo(false); }}>
            {row.key === 'CONTINUE' && run && <ContinueRunInfo run={run} shown={info} />}
          </MainMenuTextButton>
        ))}
      </div>
    </>
  );
}

/**
 * NMainMenuTextButton: a 200 × 50 row with its label (Kreon 32, cream, black outline at half alpha). Focus: 1.05 and
 * gold over 0.05 s; unfocus: cream at once, 1 over 0.5 s Expo Out; press: 0.95 then half-transparent white (0.2 s
 * each, Cubic Out, one after the other); release: back to 1.05 / 1 then cream. Disabled rows are at quarter alpha.
 */
function MainMenuTextButton({ row, onFocus, onUnfocus, children }: { row: Row; onFocus: (lbl: HTMLElement) => void; onUnfocus: () => void; children?: any }) {
  const [st, setSt] = useState<'' | 'hover' | 'press' | 'release'>('');
  const lbl = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const enter = () => {
    if (!row.enabled) return;
    hovered.current = true;
    setSt('hover');
    playOneShot('event:/sfx/ui/clicks/ui_hover');
    onFocus(lbl.current!);
  };
  const leave = () => {
    if (!hovered.current) return;
    hovered.current = false;
    setSt('');
    onUnfocus();
  };
  return (
    <div class={`mm-btn mm-${row.key.toLowerCase()} ${st}${row.enabled ? '' : ' disabled'}`}
      onPointerEnter={enter} onPointerLeave={leave}
      onPointerDown={(e) => { if (row.enabled && e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (row.enabled && e.button === 0 && st === 'press') { setSt(hovered.current ? 'release' : ''); row.onClick(); } }}>
      <div class="mm-label" ref={lbl}>
        {m(row.key)}
        {row.dot && <img class="mm-dot" src={imageUrl('images/packed/common_ui/notification_dot2.png') ?? ''} />}
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ continue-run info
interface RunInfo { saved: string; icon: string | null; progress: string; ascension: string | null; hp: string; gold: string }
/** NContinueRunInfo.ShowInfo from the saved run (null when the save cannot be read). */
function continueInfo(): RunInfo | null {
  return safe(() => {
    const res = G.SaveManager.Instance.LoadRunSave();
    const save = res?.Success ? res.SaveData : null;
    if (!save) return null;
    const saved = locv('main_menu_ui', 'CONTINUE_RUN_INFO.saved', { LastSavedTime: netDate(m('CONTINUE_RUN_INFO.savedTimeFormat'), new Date(Number(save.SaveTime) * 1000)) });
    const acts = list(save.Acts), p = list(save.Players)[0];
    let floor = list(save.VisitedMapCoords).length;
    for (let i = 0; i < save.CurrentActIndex; i++) floor += G.ModelDb.GetById(G.ActModel, acts[i].Id).GetNumberOfFloors(list(save.Players).length > 1);
    const act = G.ModelDb.GetById(G.ActModel, acts[save.CurrentActIndex].Id).Title.GetFormattedText();
    const ch = G.ModelDb.GetById(G.CharacterModel, p.CharacterId);
    return {
      saved,
      icon: imageUrl(`images/ui/top_panel/character_icon_${String(ch.Id.Entry).toLowerCase()}.png`),
      progress: `${act} [blue]- ${m('CONTINUE_RUN_INFO.floor')} ${floor}[/blue]`,
      ascension: save.Ascension > 0 ? `${m('CONTINUE_RUN_INFO.ascension')} ${save.Ascension}` : null,
      hp: `[red]${p.CurrentHp}/${p.MaxHp}[/red]`,
      gold: `[gold]${p.Gold}[/gold]`,
    };
  }, null);
}
/** AnimShow / AnimHide: 20 px up (0.2 s Back Out) while fading in over 0.2 s; back down and out the same way. */
function ContinueRunInfo({ run, shown }: { run: RunInfo; shown: boolean }) {
  const tb = (n: string) => frameStyle(frameByName('ui_atlas', 'top_bar/' + n), 36, 36);
  return (
    <div class={'mm-run-info' + (shown ? ' shown' : '')}>
      <div class="mri-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/tiny_nine_patch.png')})` }} />
      <div class="mri-body">
        <div class="mri-date"><RichText text={run.saved} /></div>
        <div class="mri-row">{run.icon && <img src={run.icon} />}<RichText text={run.progress} /></div>
        {run.ascension && <div class="mri-asc"><RichText text={run.ascension} /></div>}
        <div class="mri-row">
          <div style={tb('top_bar_heart')} /><div class="mri-hp"><RichText text={run.hp} /></div>
          <div style={tb('top_bar_gold')} /><div class="mri-gold"><RichText text={run.gold} /></div>
        </div>
      </div>
    </div>
  );
}
/** .NET custom date format (the loc's savedTimeFormat) in the game language's culture. */
export function netDate(fmt: string, d: Date): string {
  const culture = safe(() => G.LocManager.Instance.CultureInfo.Name, 'en') || 'en';
  const f = (o: Intl.DateTimeFormatOptions) => safe(() => new Intl.DateTimeFormat(culture, o).format(d), new Intl.DateTimeFormat('en', o).format(d));
  const h12 = d.getHours() % 12 || 12, pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, () => string> = {
    dddd: () => f({ weekday: 'long' }), ddd: () => f({ weekday: 'short' }), dd: () => pad(d.getDate()), d: () => String(d.getDate()),
    MMMM: () => f({ month: 'long' }), MMM: () => f({ month: 'short' }), MM: () => pad(d.getMonth() + 1), M: () => String(d.getMonth() + 1),
    yyyy: () => String(d.getFullYear()), yy: () => pad(d.getFullYear() % 100),
    HH: () => pad(d.getHours()), H: () => String(d.getHours()), hh: () => pad(h12), h: () => String(h12),
    mm: () => pad(d.getMinutes()), ss: () => pad(d.getSeconds()),
    tt: () => safe(() => new Intl.DateTimeFormat(culture, { hour: 'numeric', hour12: true }).formatToParts(d).find((p) => p.type === 'dayPeriod')?.value ?? '', d.getHours() < 12 ? 'AM' : 'PM'),
  };
  return fmt.replace(/'[^']*'|"[^"]*"|dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|yy|HH|H|hh|h|mm|ss|tt/g, (t) => (t[0] === "'" || t[0] === '"' ? t.slice(1, -1) : tokens[t]()));
}

// ------------------------------------------------------------------ profile button
/**
 * NOpenProfileScreenButton (18, 16)–(190, 80): the profile icon, "Profile {Id}" (Kreon Bold 24, gold) and "Click to
 * edit" (Kreon 18, sky blue). Hover 1.02 at once; unhover 1 over 0.3 s Expo Out.
 */
function ProfileButton() {
  const [hover, setHover] = useState(false);
  const id = profileId();
  return (
    <div class={'mm-profile' + (hover ? ' hover' : '')}
      onPointerEnter={() => { setHover(true); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => { if (e.button === 0) playOneShot('event:/sfx/ui/clicks/ui_click'); }}
      onPointerUp={(e) => { if (e.button === 0) pushMenu('profile'); }}>
      <img class="mmp-icon" src={imageUrl(`images/ui/profile/profile_icon_${id}.png`) ?? ''} />
      <div class="mmp-title">{locv('main_menu_ui', 'OPEN_PROFILE_SCREEN.title', { Id: id })}</div>
      <div class="mmp-desc">{m('OPEN_PROFILE_SCREEN.description')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ the port's own corners
/** Not in the game: the source repository (bottom left, sounding like the profile button) and what this is (bottom right). */
function PortLinks() {
  return (
    <>
      <a class="mm-github" href="https://github.com/moonrailgun/sts2-web" target="_blank" rel="noopener"
        onPointerEnter={() => playOneShot('event:/sfx/ui/clicks/ui_hover')}
        onPointerDown={(e) => { if (e.button === 0) playOneShot('event:/sfx/ui/clicks/ui_click'); }}>
        {/* GitHub's mark (Octicons mark-github) */}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" /></svg>
        GitHub
      </a>
      <div class="mm-notice">{appText('unofficial')}</div>
    </>
  );
}

// ------------------------------------------------------------------ singleplayer submenu
/**
 * NSingleplayerSubmenu: Standard, Daily and Custom (330 × 705 NSubmenuButtons at x 395 / 795 / 1195, y 187) over the
 * blurred menu, and the back button. Daily / Custom need their epochs.
 */
function SingleplayerSubmenu() {
  const daily = epochRevealed(G.DailyRunEpoch), custom = epochRevealed(G.CustomAndSeedsEpoch);
  return (
    <div class="sp-submenu">
      <SubmenuButton x={395} keyPrefix="STANDARD" icon="submenu_standard" hsv={[0, 0.8, 0.8]} enabled onClick={() => pushMenu('charselect')} />
      <SubmenuButton x={795} keyPrefix="DAILY" icon="submenu_daily" hsv={[0.48, 0.8, 0.7]} enabled={daily} onClick={() => pushMenu('daily')} />
      <SubmenuButton x={1195} keyPrefix="CUSTOM" icon="submenu_custom" hsv={[0.93, 1.2, 0.65]} enabled={custom} onClick={() => pushMenu('custom')} />
      <BackButton enabled onClick={popMenu} />
    </div>
  );
}

/**
 * NSubmenuButton: submenu_panel (hsv per button), the title (Kreon Bold 32, gold), the icon and the description.
 * Focus: 1.025 and v 1 at once; unfocus: 1 over 0.5 s Cubic Out, v back over 1 s Expo Out. Disabled: dark grey,
 * the panel desaturated, the icon half grey, the lock and the LOCKED description.
 */
function SubmenuButton({ x, keyPrefix, icon, hsv, enabled, onClick }: { x: number; keyPrefix: string; icon: string; hsv: number[]; enabled: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const v = hover ? 1 : hsv[2], s = enabled ? hsv[1] : 0;
  return (
    <div class={'submenu-btn' + (enabled ? '' : ' disabled') + (hover ? ' hover' : '')} style={{ left: `${x}px` }}
      onPointerEnter={() => { if (!enabled) return; setHover(true); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
      onPointerLeave={() => { setHover(false); setDown(false); }}
      onPointerDown={(e) => { if (enabled && e.button === 0) { setDown(true); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && down) { setDown(false); onClick(); } }}>
      <img class="smb-panel" src={imageUrl('images/packed/common_ui/submenu_panel.png') ?? ''}
        style={{ filter: `${hsvFilter(hsv[0], 1, 1)} saturate(${s}) brightness(${v})`, transition: hover ? 'none' : 'filter 1s cubic-bezier(0.16, 1, 0.3, 1)' }} />
      <div class="smb-title">{m(`${keyPrefix}.title`)}</div>
      <img class="smb-icon" src={imageUrl(`images/ui/main_menu/${icon}.png`) ?? ''} />
      {!enabled && <img class="smb-icon smb-lock" src={imageUrl('images/ui/main_menu/submenu_lock.png') ?? ''} />}
      <div class="smb-desc"><RichText text={m(`${keyPrefix}.${enabled ? '' : 'LOCKED.'}description`)} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ shared with the character select / custom run
/** Characters and whether each is unlocked (UnlockState from the progress save). */
export function characters() {
  const unlocked = safe(() => list(G.SaveManager.Instance.GenerateUnlockStateFromProgress().Characters), [] as any[]);
  return list(G.ModelDb.AllCharacters).map((c: any) => ({ c, locked: !unlocked.includes(c) }));
}
/** StartRunLobby's max ascension: the character's best (0 until its <Char>4Epoch is revealed), the best of all for Random. */
export const maxAscension = (c: any) => safe(() => {
  const p = G.SaveManager.Instance.Progress;
  if (G.RandomCharacter && c instanceof G.RandomCharacter) return Math.max(0, ...list(G.ModelDb.AllCharacters).map((x: any) => p.GetOrCreateCharacterStats(x.Id).MaxAscension));
  const max = p.GetOrCreateCharacterStats(c.Id).MaxAscension;
  const epoch = G[`${c.Id.Entry.charAt(0)}${c.Id.Entry.slice(1).toLowerCase()}4Epoch`];
  return max > 0 && (!epoch || epochRevealed(epoch)) ? max : 0;
}, 0);
