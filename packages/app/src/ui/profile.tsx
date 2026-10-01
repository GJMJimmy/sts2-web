// NProfileScreen (screens/profiles/profile_screen.tscn, a submenu over the blurred main menu: three save-profile cards
// with delete buttons) and NCreditsScreen (screens/credits_screen.tscn, a modal: black, the credits rolling upward).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { G, $ } from '../game';
import { invalidate } from '../store';
import { loc, locv } from '../i18n';
import { imageUrl } from '../assets';
import { playOneShot } from '../audio';
import { tint } from '../filters';
import { RichText } from './richtext';
import { confirmPopup, openModal, closeModal } from './modal';
import { popMenu, pushMenu, netDate, reloadMainMenu } from './menu';
import { BackButton } from './buttons';
import { useFit } from './card';
import './profile.css';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const m = (k: string) => loc('main_menu_ui', k);
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)', CUBIC_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)';
const hoverSfx = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
const clickSfx = () => playOneShot('event:/sfx/ui/clicks/ui_click');
const PROFILES = [1, 2, 3];
const io = (id: number) => new G.GodotFileIo().$ctor_GodotFileIo(G.UserDataPathProvider.GetProfileScopedPath(id, 'saves'));
const hasProgress = (id: number) => safe(() => io(id).FileExists('progress.save'), false);
/** NDeleteProfileButton's forceShowProfileAsDeleted (cleared by the next Refresh). */
let forceDeleted: number | null = null;

/** NProfileButton.Initialize: "Empty", or the playtime and when the profile's saves last changed. */
function describe(id: number): string {
  const f = io(id);
  if (id === forceDeleted || !safe(() => f.FileExists('progress.save'), false)) return m('PROFILE_SCREEN.BUTTON.empty');
  const sm = G.SaveManager.Instance;
  const playtime = id === sm.CurrentProfileId
    ? sm.Progress.TotalPlaytime
    : safe(() => JSON.parse(f.ReadFile('progress.save')).total_playtime ?? null, null);
  const times = ['progress.save', 'current_run.save', 'current_run_mp.save'].filter((n) => safe(() => f.FileExists(n), false))
    .map((n) => Number(safe(() => f.GetLastModifiedTime(n).ToUnixTimeMilliseconds(), 0)));
  return locv('main_menu_ui', 'PROFILE_SCREEN.BUTTON.description', {
    Playtime: playtime == null ? '???' : safe(() => G.TimeFormatting.Format(playtime), '???'),
    LastUpdatedTime: netDate(m('PROFILE_SCREEN.BUTTON.dateFormat'), new Date(Math.max(...times, 0))),
  });
}

const loading = { on: false };
/** SwitchToThisProfile: the loading overlay, two frames, the profile's prefs and progress, then a fresh main menu. */
async function switchTo(id: number) {
  loading.on = true;
  invalidate();
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  const sm = G.SaveManager.Instance;
  sm.SwitchProfileId(id);
  sm.InitPrefsData();
  sm.InitProgressData();
  loading.on = false;
  reloadMainMenu();
}
/** NDeleteProfileButton: NGenericPopup (Cancel / Delete); deleting the current profile reloads the menu under a new profile screen. */
async function remove(id: number) {
  const yes = await confirmPopup({
    header: locv('main_menu_ui', 'PROFILE_SCREEN.DELETE_CONFIRM_POPUP.title', { Id: id }),
    body: locv('main_menu_ui', 'PROFILE_SCREEN.DELETE_CONFIRM_POPUP.description', { Id: id }),
    yes: m('PROFILE_SCREEN.DELETE_CONFIRM_POPUP.delete'), no: m('PROFILE_SCREEN.DELETE_CONFIRM_POPUP.cancel'),
  });
  if (!yes) return;
  const sm = G.SaveManager.Instance;
  sm.DeleteProfile(id);
  forceDeleted = id;
  sm.InitProgressData();
  sm.InitPrefsData();
  if (id === sm.CurrentProfileId) {
    reloadMainMenu();
    setTimeout(() => pushMenu('profile'), 50);
  } else invalidate();
}

export function Profiles() {
  const cur = safe(() => G.SaveManager.Instance.CurrentProfileId, 1);
  const msgRef = useRef<HTMLDivElement>(null);
  const msg = m('PROFILE_SCREEN.BUTTON.chooseProfileMessage');
  useFit(msgRef, `pcm|${msg}`, 36, 24, (el) => el.scrollWidth <= el.clientWidth);
  // Refresh (on open and after a delete) clears the forced "deleted" look once drawn
  useEffect(() => { if (forceDeleted != null) { const f = forceDeleted; setTimeout(() => { if (forceDeleted === f) forceDeleted = null; }); } });
  return (
    <div class="profiles">
      <div class="pf-message" ref={msgRef}>{msg}</div>
      {PROFILES.map((id, i) => <ProfileButton key={id} id={id} x={276 + 464 * i} current={id === cur} />)}
      {PROFILES.map((id, i) => (id !== forceDeleted && hasProgress(id) ? <DeleteButton key={id} id={id} x={456 + 464 * i} /> : null))}
      <BackButton enabled={!loading.on} onClick={popMenu} />
      {loading.on && (
        <div class="pf-loading">
          <div class="pf-loading-label">{m('LOADING_OVERLAY.label')}</div>
        </div>
      )}
    </div>
  );
}

/**
 * NProfileButton (440 × 560): reward_panel with the profile icon, "Save Profile N", the playtime / last update and the
 * Ironclad map marker over the current one. Hover 1.03 and v 1.3 (0.05 s), back over 0.5 s Expo Out.
 */
function ProfileButton({ id, x, current }: { id: number; x: number; current: boolean }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const titleRef = useRef<HTMLDivElement>(null);
  const title = locv('main_menu_ui', 'PROFILE_SCREEN.BUTTON.title', { Id: id });
  useFit(titleRef, `pft|${title}`, 32, 18, (el) => el.scrollWidth <= el.clientWidth);
  const lit = st !== '';
  const t = lit ? '.05s linear' : `.5s ${EXPO_OUT}`;
  return (
    <div class="pf-button" style={{ left: `${x}px`, scale: lit ? '1.03' : '1', transition: `scale ${t}` }}
      onPointerEnter={() => { if (loading.on) return; setSt('hover'); hoverSfx(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0 && !loading.on) { setSt('press'); clickSfx(); } }}
      onPointerUp={(e) => {
        if (e.button !== 0 || st !== 'press') return;
        setSt('hover');
        if (current) popMenu();
        else void switchTo(id);
      }}>
      <div class="pf-bg" style={{ filter: `brightness(${lit ? 1.3 : 1})`, transition: `filter ${t}` }}>
        <img class="pf-panel" src={imageUrl('images/ui/reward_screen/reward_panel.png') ?? ''} />
        <img class="pf-icon" src={imageUrl(`images/ui/profile/profile_icon_${id}.png`) ?? ''} />
        <div class="pf-title" ref={titleRef}>{title}</div>
        <div class="pf-info"><RichText text={describe(id)} /></div>
        {current && <img class="pf-current" src={imageUrl('images/packed/map/icons/map_marker_ironclad.png') ?? ''} />}
      </div>
    </div>
  );
}

/** NDeleteProfileButton (80 × 80): the delete icon; hover 1.1 and v 1.4, the red label sliding down 30 px as it fades in. */
function DeleteButton({ id, x }: { id: number; x: number }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const label = useRef<HTMLDivElement>(null);
  const lit = st !== '';
  const t = lit ? '.05s linear' : `.5s ${EXPO_OUT}`;
  return (
    <div class="pf-delete" style={{ left: `${x}px`, scale: lit ? '1.1' : '1', transition: `scale ${t}` }}
      onPointerEnter={() => { setSt('hover'); hoverSfx(); label.current?.animate([{ top: '48px' }, { top: '78px' }], { duration: 200, easing: CUBIC_OUT, fill: 'forwards' }); }}
      onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); clickSfx(); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt(''); void remove(id); } }}>
      <img src={imageUrl('images/packed/main_menu/delete_button.png') ?? ''} style={{ filter: `brightness(${lit ? 1.4 : 1})`, transition: `filter ${t}` }} />
      <div class="pf-delete-label" ref={label} style={{ opacity: lit ? 1 : 0, transition: lit ? 'opacity .2s linear' : 'opacity .05s linear' }}>{m('PROFILE_SCREEN.DELETE_BUTTON.label')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ NCreditsScreen
const raw = (k: string): string => safe(() => new G.LocString().$ctor_LocString('credits', k).GetRawText(), k);
/** Rng.Chaotic Fisher–Yates. */
function shuffle<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** SplitTwoColumn: "role||name" lines (others dropped). */
function twoCol(s: string): [string, string] {
  const rows = s.split('\n').filter((l) => l.length).map((l) => l.split('||').map((p) => p.trim()).filter(Boolean)).filter((p) => p.length === 2);
  return [rows.map((r) => r[0]).join('\n'), rows.map((r) => r[1]).join('\n')];
}
/** SplitTwoColumnMultiRole: one line per role (the name on the first), a blank row after multi-role entries but the last. */
function multiRole(s: string): [string, string] {
  const l: string[] = [], r: string[] = [];
  const lines = s.split('\n').filter((x) => x.length);
  lines.forEach((line, i) => {
    const p = line.split('||');
    if (p.length !== 2) return;
    const roles = p[0].trim().split(',').map((x) => x.trim()).filter(Boolean);
    roles.forEach((role, k) => { l.push(role); r.push(k === 0 ? p[1].trim() : ''); });
    if (roles.length > 1 && i !== lines.length - 1) { l.push(''); r.push(''); }
  });
  return [l.join('\n'), r.join('\n')];
}

/** NCreditsButton.OnRelease: the credits in the modal container (no backstop of its own; its Bg is opaque). */
export function openCredits() { openModal(() => <Credits />); }

function Credits() {
  const contents = useRef<HTMLDivElement>(null);
  const s = useRef({ pos: 0, target: 0, canClose: false, closing: false });
  // shuffled once per open, as the screen's Init* do
  const shuffled = useMemo(() => {
    const pt = shuffle(raw('PLAYTESTERS.names').split('||').map((p) => p.trim()).filter(Boolean));
    return { modding: shuffle(raw('MODDING_SUPPORT.names').split('||')).join('\n'), play: [0, 1, 2].map((c) => pt.filter((_, i) => i % 3 === c).join('\n')) };
  }, []);
  const close = () => { if (!s.current.canClose || s.current.closing) return; s.current.closing = true; closeModal(); };
  useEffect(() => {
    contents.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000, fill: 'both' });
    const h = setTimeout(() => { s.current.canClose = true; }, 2000);
    // _Process: the target climbs 80 px/s, the contents follow at lerp dt·20
    const stop = $.onFrame((dt: number) => {
      const st = s.current;
      st.target -= 80 * dt;
      st.pos += (st.target - st.pos) * Math.min(1, dt * 20);
      if (contents.current) contents.current.style.transform = `translateY(${st.pos}px)`;
      return true;
    });
    // ui_cancel / mega_back fire on release (the modal layer owns key presses)
    const up = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Backspace') close(); };
    window.addEventListener('keyup', up);
    return () => { clearTimeout(h); stop(); window.removeEventListener('keyup', up); };
  }, []);
  const H = (k: string, min: number, green = false) => <div class={'cred-h' + (green ? ' green' : '')} style={{ minHeight: `${min}px` }}>{raw(k)}</div>;
  const names = (text: string, cls = '') => <div class={'cred-names ' + cls}>{text}</div>;
  const two = ([roles, ns]: [string, string]) => <div class="cred-two"><div class="cred-roles">{roles}</div><div class="cred-col">{ns}</div></div>;
  const logo = (p: string, w: number, h: number, gap: number) => <><div style={{ height: `${gap}px` }} /><img class="cred-logo" src={imageUrl(p) ?? ''} style={{ width: `${w}px`, height: `${h}px` }} /></>;
  return (
    <div class="credits" onPointerDown={(e) => { if (e.button === 0) close(); }}
      onWheel={(e) => {
        const notch = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
        s.current.target += notch ? -Math.sign(e.deltaY) * 100 : -e.deltaY;
      }}>
      <div class="cred-contents" ref={contents}>
        <img class="cred-sts2" src={imageUrl('images/ui/sts2_logo_static.png') ?? ''} style={{ filter: tint(1, 0.965, 0.886) }} />
        {H('MEGA_CRIT.header', 240)}
        {names(raw('MEGA_CRIT.names'), 'tight')}
        <div style={{ height: '38px' }} />
        {two(twoCol(raw('MEGA_CRIT_TEAM.names')))}
        {['COMPOSER', 'ADDITIONAL_PROGRAMMING', 'ADDITIONAL_VFX', 'MARKETING_SUPPORT', 'CONSULTANTS'].map((k) => <>{H(`${k}.header`, 160)}{names(raw(`${k}.names`))}</>)}
        {H('VOICES.header', 160)}
        {two(multiRole(raw('VOICES.names')))}
        {H('LOC.header', 160, true)}
        {H('LOC_PTB.header', 80)}{names(raw('LOC_PTB.names'))}
        {/* original quirk: only the names are set, the roles keep the scene's placeholder */}
        {H('LOC_ZHS.header', 160)}{two(['?Translator\n?Proofreader', raw('LOC_ZHS.names')])}
        {H('LOC_FRA.header', 160)}{two(twoCol(raw('LOC_FRA.names')))}
        {H('LOC_DEU.header', 120)}{names(raw('LOC_DEU.names'))}
        {H('LOC_ITA.header', 120)}{names(raw('LOC_ITA.team'))}{two(twoCol(raw('LOC_ITA.names')))}
        {['LOC_JPN', 'LOC_KOR', 'LOC_POL'].map((k) => <>{H(`${k}.header`, 120)}{names(raw(`${k}.names`))}</>)}
        {H('LOC_RUS.header', 160)}{two(twoCol(raw('LOC_RUS.names')))}
        {H('LOC_SPA.header', 120)}{names(raw('LOC_SPA.names'))}
        {H('LOC_ESP.header', 120)}{names(raw('LOC_ESP.team'))}{two(twoCol(raw('LOC_ESP.names')))}
        {H('LOC_THA.header', 120)}{names(raw('LOC_THA.names'))}
        {H('LOC_TUR.header', 120)}{two(twoCol(raw('LOC_TUR.names')))}
        {H('TWITCH.header', 160)}{two(twoCol(raw('TWITCH.names')))}
        {H('MODDING_SUPPORT.header', 160)}{names(shuffled.modding)}
        {H('PLAYTESTERS.header', 160)}
        <div class="cred-three">{shuffled.play.map((c) => <div>{c}</div>)}</div>
        {H('TRAILER.header', 160, true)}
        {H('TRAILER_ANIMATION.header', 80)}{names(raw('TRAILER_ANIMATION.team'))}{two(twoCol(raw('TRAILER_ANIMATION.names')))}
        {H('TRAILER_EDITOR.header', 120)}{two(twoCol(raw('TRAILER_EDITOR.names')))}
        {logo('images/ui/credits/fmod_logo.png', 523, 140, 120)}
        <div class="cred-h white" style={{ minHeight: '64px' }}>{raw('FMOD')}</div>
        {logo('images/ui/credits/spine_logo.png', 498, 150, 120)}
        <div class="cred-h white" style={{ minHeight: '100px' }}>{raw('SPINE')}</div>
        {logo('images/ui/credits/godot_logo.png', 233, 220, 104)}
        <div class="cred-h white" style={{ minHeight: '64px' }}>{raw('GODOT')}</div>
        <div class="cred-exit"><RichText text={raw('EXIT_MESSAGE')} /></div>
        <div style={{ height: '2500px' }} />
        <img class="cred-logo" src={imageUrl('images/ui/game_over_screen/run_summary_merchant.png') ?? ''} style={{ width: '300px', height: '300px' }} />
      </div>
    </div>
  );
}
