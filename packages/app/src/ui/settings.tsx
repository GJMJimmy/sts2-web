// NSettingsScreen (screens/settings_screen.tscn): four tabs over a scrolling panel of 64 px rows (82 px apart with their
// dividers) — tickboxes, paginators, volume sliders, the language dropdown and buttons — with row hover tips at the
// panel's right edge and a toast at the bottom. Values live in the game's own SettingsSave / PrefsSave.
// Web: the window rows a browser cannot honour (display, resolution, window resizing, vsync) and feedback are left
// out, and the Input tab (key rebinding) is disabled.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G, $ } from '../game';
import { ui, invalidate } from '../store';
import { setVolumes } from '../audio';
import { playOneShot } from '../audio';
import { imageUrl, frameByName, frameStyle } from '../assets';
import { languages, setLanguage, loc } from '../i18n';
import { applyFpsLimit } from '../render/stage';
import { hsvFilter, tint } from '../filters';
import { RichText } from './richtext';
import { BackButton } from './buttons';
import { setTip } from './tooltip';
import { NScrollbar, wheelDrag } from './scrollbar';
import { confirmPopup } from './modal';
import { openCredits } from './profile';
import { view, fit } from '../view';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const s = (k: string) => loc('settings_ui', k);
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const hover = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
const click = () => playOneShot('event:/sfx/ui/clicks/ui_click');
const sm = () => G.SaveManager.Instance;

/** NMuteInBackgroundHandler: silence the master bus while the page is hidden or unfocused. */
export function applyMute() {
  const on = safe(() => sm().PrefsSave.MuteInBackground, true) && (document.hidden || !document.hasFocus());
  const st = safe(() => sm().SettingsSave, null);
  if (st) setVolumes({ master: on ? 0 : st.VolumeMaster });
}
for (const ev of ['visibilitychange', 'blur', 'focus']) (ev === 'visibilitychange' ? document : window).addEventListener(ev, () => applyMute());

// NLanguageDropdown._languageCodeToName
const LANG_NAMES: Record<string, string> = {
  eng: 'English', zhs: '中文', zht: '繁體中文', jpn: '日本語', kor: '한국어', deu: 'Deutsch', fra: 'Français', spa: 'Español (Castellano)',
  esp: 'Español (Latinoamérica)', ita: 'Italiano', pol: 'Polski', ptb: 'Português Brasileiro', rus: 'Русский', tha: 'ไทย', tur: 'Türkçe',
};

// ------------------------------------------------------------------ rows
type Row =
  | { kind: 'tick'; label: string; tip?: [string, string]; get: () => boolean; set: (v: boolean) => void; toast?: string }
  | { kind: 'page'; label: string; tip?: [string, string]; options: string[]; get: () => number; set: (i: number) => void }
  | { kind: 'slider'; label: string; get: () => number; set: (v: number) => void }
  | { kind: 'lang'; label: string; disabled: boolean }
  | { kind: 'drop'; label: string; options: string[]; get: () => number; set: (i: number) => void }
  | { kind: 'button'; label: string; text: string; hsv: number[]; outline: string; onClick: () => void };

const prefs = () => sm().PrefsSave, settings = () => sm().SettingsSave;
/** A tickbox row; `tip` names the hover tip's title key (its description is the key without _HEADER, plus _DESCRIPTION). */
const tick = (label: string, tip: string | null, get: () => boolean, set: (v: boolean) => void, toast?: string, tipBody?: string): Row =>
  ({ kind: 'tick', label: s(label), tip: tip ? [s(tip), s(tipBody ?? `${tip.replace(/_HEADER$/, '')}_DESCRIPTION`)] : undefined, get, set, toast });
function resetGeneral() {
  const st = settings(), p = prefs();
  st.LimitFpsInBackground = true; st.SkipIntroLogo = false;
  p.ScreenShakeOptionIndex = 2; p.FastMode = G.FastModeType.Normal; p.ShowRunTimer = false; p.ShowCardIndices = false;
  p.IsLongPressEnabled = false; p.UploadData = true; p.TextEffectsEnabled = true;
}
function resetGraphics() {
  const st = settings();
  st.FpsLimit = 60; st.Fullscreen = true; st.Msaa = 2; st.AspectRatioSetting = G.AspectRatioSetting.SixteenByNine;
  applyFpsLimit(); fit();
}
/** NResetGameplayButton / NResetGraphicsButton: NGenericPopup asks first. */
async function confirmReset(body: string, reset: () => void) {
  const yes = await confirmPopup({ header: s('RESET_CONFIRMATION.header'), body: s(body), yes: loc('main_menu_ui', 'GENERIC_POPUP.confirm'), no: loc('main_menu_ui', 'GENERIC_POPUP.cancel') });
  if (yes) { reset(); invalidate(); }
}
const RESET: Omit<Extract<Row, { kind: 'button' }>, 'label' | 'onClick'> = { kind: 'button', text: '', hsv: [0.45, 1.5, 0.8], outline: 'rgb(74, 37, 36)' };

function generalRows(inRun: boolean): Row[] {
  const p = prefs;
  return [
    { kind: 'lang', label: s(inRun ? 'LANGUAGE_IN_RUN' : 'LANGUAGE'), disabled: inRun },
    { kind: 'page', label: s('SCREENSHAKE'), tip: [s('SCREENSHAKE_HEADER'), s('SCREENSHAKE_DESCRIPTION')], options: ['NONE', 'SOME', 'NORMAL', 'LOTS', 'CAAAW'].map((k) => s(`SCREENSHAKE_${k}`)),
      get: () => p().ScreenShakeOptionIndex, set: (i) => { p().ScreenShakeOptionIndex = i; safe(() => $.ext('MegaCrit.Sts2.Core.Nodes.NGame').Instance.ScreenShakeTrauma(G.ShakeStrength.Medium), null); } },
    tick('FASTMODE', 'FASTMODE', () => p().FastMode !== G.FastModeType.Normal, (v) => { p().FastMode = v ? G.FastModeType.Fast : G.FastModeType.Normal; }, 'FAST_MODE'),
    tick('SHOW_RUN_TIMER_HEADER', 'SHOW_RUN_TIMER_HEADER', () => p().ShowRunTimer, (v) => { p().ShowRunTimer = v; }, 'RUN_TIMER'),
    tick('SHOW_HAND_CARD_COUNT_HEADER', 'SHOW_HAND_CARD_COUNT_HEADER', () => p().ShowCardIndices, (v) => { p().ShowCardIndices = v; }, 'HAND_CARD_COUNT'),
    tick('LONG_PRESS_CONFIRMATION_HEADER', 'LONG_PRESS_CONFIRMATION_HEADER', () => p().IsLongPressEnabled, (v) => { p().IsLongPressEnabled = v; }),
    tick('SKIP_INTRO_LOGO_HEADER', 'SKIP_INTRO_LOGO_HEADER', () => settings().SkipIntroLogo, (v) => { settings().SkipIntroLogo = v; }, 'SKIP_INTRO_LOGO'),
    tick('LIMIT_FPS_IN_BACKGROUND_HEADER', 'LIMIT_FPS_IN_BACKGROUND_HEADER', () => settings().LimitFpsInBackground, (v) => { settings().LimitFpsInBackground = v; }, 'LIMIT_FPS_IN_BACKGROUND'),
    tick('UPLOAD_GAMEPLAY_DATA', 'UPLOAD_GAMEPLAY_DATA_HEADER', () => p().UploadData, (v) => { p().UploadData = v; }, 'GAMEPLAY_DATA'),
    tick('TEXT_EFFECTS', 'TEXT_EFFECTS', () => p().TextEffectsEnabled, (v) => { p().TextEffectsEnabled = v; }, 'TEXT_EFFECTS'),
    { kind: 'button', label: s('CREDITS'), text: s('CREDITS_BUTTON_LABEL'), hsv: [0.61, 1.6, 1.3], outline: 'rgb(51, 40, 25)', onClick: openCredits },
    { ...RESET, label: s('RESET_DEFAULT'), text: s('RESET_SETTINGS_BUTTON'), onClick: () => void confirmReset('RESET_GAMEPLAY_CONFIRMATION.body', resetGeneral) },
  ];
}
function graphicsRows(): Row[] {
  const FPS = ['24', '30', '59', '60', '75', '90', '120', '144', '165', '240', '360', '500'];
  const MSAA = [0, 2, 4, 8];
  // NAspectRatioDropdown: its items in the order it adds them
  const ASPECT = ['Auto', 'FourByThree', 'SixteenByTen', 'SixteenByNine', 'TwentyOneByNine'];
  const ASPECT_KEYS = ['AUTO', 'FOUR_BY_THREE', 'SIXTEEN_BY_TEN', 'SIXTEEN_BY_NINE', 'TWENTY_ONE_BY_NINE'];
  return [
    tick('FULLSCREEN', 'FULLSCREEN_HEADER', () => !!document.fullscreenElement, (v) => {
      settings().Fullscreen = v;
      (v ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.())?.then(invalidate, invalidate);
    }),
    { kind: 'drop', label: s('ASPECT_RATIO'), options: ASPECT_KEYS.map((k) => s(`ASPECT_RATIO_${k}`)),
      get: () => ASPECT.indexOf(G.AspectRatioSetting[settings().AspectRatioSetting]),
      set: (i) => { settings().AspectRatioSetting = G.AspectRatioSetting[ASPECT[i]]; fit(); } }, // NGame.ApplyDisplaySettings
    { kind: 'page', label: s('FPS_CAP'), options: FPS, get: () => { const i = FPS.indexOf(String(settings().FpsLimit)); return i < 0 ? 3 : i; },
      set: (i) => { settings().FpsLimit = +FPS[i]; applyFpsLimit(); } },
    { kind: 'page', label: s('MSAA'), tip: [s('MSAA_HEADER'), s('MSAA_DESCRIPTION')], options: MSAA.map((m) => (m ? `${m}x` : s('MSAA_NONE'))),
      get: () => { const i = MSAA.indexOf(settings().Msaa); return i < 0 ? 3 : i; }, set: (i) => { settings().Msaa = MSAA[i]; } },
    { ...RESET, label: s('RESET_DEFAULT'), text: s('RESET_SETTINGS_BUTTON'), onClick: () => void confirmReset('RESET_GRAPHICS_CONFIRMATION.body', resetGraphics) },
  ];
}
function soundRows(): Row[] {
  const vol = (label: string, prop: string, bus: string): Row => ({ kind: 'slider', label: s(label), get: () => Math.round(settings()[prop] * 100), set: (v) => { settings()[prop] = v / 100; setVolumes({ [bus]: v / 100 }); applyMute(); } });
  return [
    vol('MASTER_VOLUME', 'VolumeMaster', 'master'), vol('MUSIC_VOLUME', 'VolumeBgm', 'music'), vol('SFX_VOLUME', 'VolumeSfx', 'sfx'), vol('AMBIENCE_VOLUME', 'VolumeAmbience', 'amb'),
    tick('BACKGROUND_MUTE', null, () => prefs().MuteInBackground, (v) => { prefs().MuteInBackground = v; applyMute(); }, 'MUTE_IN_BACKGROUND'),
  ];
}

// ------------------------------------------------------------------ the screen
const TABS = ['TAB_GENERAL', 'TAB_GRAPHICS', 'TAB_SOUND', 'TAB_INPUT'];
const toast = { text: '', gen: 0 };
/** NSettingsToast.Show. */
function showToast(key: string) { toast.text = s(key); toast.gen++; invalidate(); }

export function SettingsScreen({ inRun, onBack }: { inRun: boolean; onBack: () => void }) {
  const [tab, setTab] = useState(0);
  useEffect(() => () => { safe(() => { sm().SaveSettings(); sm().SavePrefsFile(); }, null); toast.text = ''; }, []);
  const rows = tab === 0 ? generalRows(inRun) : tab === 1 ? graphicsRows() : soundRows();
  return (
    <div class="settings-screen">
      <SettingsScroll key={tab} rows={rows} />
      <div class="settings-tabs">
        {TABS.map((k, i) => <SettingsTab label={s(k)} x={442 + 260 * i} selected={tab === i} disabled={i === 3} onClick={() => setTab(i)} />)}
      </div>
      <BackButton enabled onClick={() => { setTip(null); onBack(); }} />
      <Toast />
    </div>
  );
}

/**
 * NScrollableContainer + NSettingsGradientMask: the panel (x 454–1466) starts 20 px under the clipper at y 187, fades out
 * above y 184–200 and at the bottom, follows its target at lerp 15·dt, wheel ±40, drag; past the ends it springs back
 * at 12·dt. The panel is its rows' height plus 40 % of the view when that overflows. It fades in from black on show.
 */
function SettingsScroll({ rows }: { rows: Row[] }) {
  const content = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);
  const st = useRef({ pos: 0, target: 0, drag: false, limit: 0, value: 0 });
  const [bar, setBar] = useState<{ on: boolean; v: number }>({ on: false, v: 0 });
  const VIEW = 893 + 2 * view.oy, PAD_T = 20, PAD_B = 30; // the Clipper: from 187 px down to the screen's bottom
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    const size = h + 50 >= VIEW ? h + VIEW * 0.4 : h;
    st.current.limit = -(PAD_B + PAD_T + size) + VIEW;
    setBar({ on: size + PAD_T + PAD_B > VIEW, v: 0 });
    content.current?.animate([{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], { duration: 500, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' });
  }, [VIEW]);
  useEffect(() => $.onFrame((dt: number) => {
    const s0 = st.current, lim = s0.limit;
    if (lim >= 0) return true; // DisableScrollingIfContentFits
    s0.pos += (s0.target - s0.pos) * Math.min(1, dt * 15);
    if (Math.abs(s0.pos - s0.target) < 0.5) s0.pos = s0.target;
    if (!s0.drag) {
      if (s0.target < lim) s0.target += (lim - s0.target) * Math.min(1, dt * 12);
      else if (s0.target > 0) s0.target += (0 - s0.target) * Math.min(1, dt * 12);
    }
    if (content.current) content.current.style.top = `${187 + PAD_T + s0.pos}px`;
    const v = Math.min(1, Math.max(0, s0.pos / lim));
    if (Math.abs(v - s0.value) > 0.001) { s0.value = v; setBar((b) => ({ ...b, v })); }
    return true;
  }), []);
  return (
    <div class="settings-scroll"
      onWheel={(e) => { st.current.target += wheelDrag(e); }}
      onPointerDown={(e) => { if (e.button !== 0 || (e.target as Element).closest('[data-ctl]')) return; st.current.drag = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (st.current.drag) st.current.target += e.movementY / (safe(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')), 1) || 1); }}
      onPointerUp={() => { st.current.drag = false; }}>
      <div class="settings-mask">
        <div class="settings-panel" ref={content} style={{ top: `${187 + PAD_T}px` }}>
          <div class="settings-rows" ref={box}>
            {rows.map((r, i) => <>{i > 0 && <div class="settings-divider" />}<SettingsRow r={r} /></>)}
          </div>
        </div>
      </div>
      {/* Scrollbar: anchored at 0.794 of the width, 0.187 … 0.947 of the height */}
      {bar.on && <NScrollbar x={1524 + 0.5875 * view.ox} y={202 - 0.626 * view.oy} w={47} h={821 + 1.52 * view.oy} value={bar.v} style={{ filter: undefined }}
        onSet={(v) => { st.current.target = v * st.current.limit; }} />}
    </div>
  );
}

function SettingsRow({ r }: { r: Row }) {
  const ref = useRef<HTMLDivElement>(null);
  const tip = 'tip' in r ? r.tip : undefined;
  const showTip = () => {
    if (!tip || !ref.current) return;
    const rr = ref.current.getBoundingClientRect(), sr = document.querySelector('.stage-root')!.getBoundingClientRect(), k = 1920 / sr.width;
    setTip(tip[0], tip[1], { kind: 'at', x: 1466, y: (rr.top - sr.top) * k - 60 });
  };
  return (
    <div class="settings-row" ref={ref} onPointerEnter={showTip} onPointerLeave={() => tip && setTip(null)}>
      <div class={'sr-label' + (r.kind === 'lang' && r.disabled ? ' disabled' : '')}><RichText text={r.label} /></div>
      {r.kind === 'tick' && <Tickbox r={r} />}
      {r.kind === 'page' && <Paginator r={r} />}
      {r.kind === 'slider' && <Slider r={r} />}
      {r.kind === 'lang' && <LanguageDropdown disabled={r.disabled} />}
      {r.kind === 'drop' && <Dropdown label={r.options[safe(r.get, -1)] ?? ''} options={r.options} onPick={(i) => { r.set(i); invalidate(); }} />}
      {r.kind === 'button' && <SettingsButton r={r} />}
    </div>
  );
}

/** NSettingsTickbox: checkbox_ticked / _unticked at 0.8 (51 px); hover 1.05 and v 1.2, press 0.95 and v 0.8; on / off sounds and toasts. */
function Tickbox({ r }: { r: Extract<Row, { kind: 'tick' }> }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const on = safe(r.get, false);
  const scale = st === 'hover' ? 1.05 : st === 'press' ? 0.95 : 1, v = st === 'hover' ? 1.2 : st === 'press' ? 0.8 : 1;
  const t = st === 'hover' ? '.05s linear' : `.5s ${EXPO_OUT}`;
  return (
    <div class="st-tick" data-ctl
      onPointerEnter={() => { setSt('hover'); hover(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); click(); } }}
      onPointerUp={(e) => {
        if (e.button !== 0 || st !== 'press') return;
        setSt('hover');
        const next = !on;
        r.set(next);
        playOneShot(next ? 'event:/sfx/ui/clicks/ui_checkbox_on' : 'event:/sfx/ui/clicks/ui_checkbox_off');
        if (r.toast) showToast(`TOAST_${r.toast}_${next ? 'ON' : 'OFF'}`);
        invalidate();
      }}>
      <div class="st-tick-visual" style={{ scale: String(scale), filter: `brightness(${v})`, transition: `scale ${t}, filter ${t}` }}>
        <div style={frameStyle(frameByName('ui_atlas', on ? 'checkbox_ticked' : 'checkbox_unticked'), 51.2, 51.2)} />
      </div>
    </div>
  );
}

/**
 * NPaginator (324 × 64): the value between two 48 px arrows; paging wraps, the new value slides in from ∓90 px (0.25 s
 * Cubic Out, α 0.75 → 1) while the old one slides out and fades to transparent black.
 */
function Paginator({ r }: { r: Extract<Row, { kind: 'page' }> }) {
  const i = Math.max(0, safe(r.get, 0));
  const [anim, setAnim] = useState<{ old: string; dir: number; gen: number } | null>(null);
  const label = useRef<HTMLDivElement>(null), vfx = useRef<HTMLDivElement>(null);
  const page = (d: number) => {
    const n = r.options.length, next = (i + d + n) % n;
    setAnim({ old: r.options[i] ?? '', dir: d, gen: (anim?.gen ?? 0) + 1 });
    r.set(next);
    invalidate();
  };
  useLayoutEffect(() => {
    if (!anim) return;
    const ease = 'cubic-bezier(0.33, 1, 0.68, 1)';
    label.current?.animate([{ translate: `${anim.dir < 0 ? -90 : 90}px 0`, opacity: 0.75 }, { translate: '0 0', opacity: 1 }], { duration: 250, easing: ease });
    vfx.current?.animate([{ translate: '0 0', opacity: 1, filter: 'brightness(1)' }, { translate: `${anim.dir < 0 ? 90 : -90}px 0`, opacity: 0, filter: 'brightness(0)' }], { duration: 250, easing: ease, fill: 'forwards' });
  }, [anim?.gen]);
  return (
    <div class="st-page" data-ctl>
      <PageArrow left onClick={() => page(-1)} />
      <div class="stp-mask">
        <div class="stp-label" ref={label}>{r.options[i] ?? '>:P'}</div>
        {anim && <div class="stp-label" ref={vfx} key={anim.gen}>{anim.old}</div>}
      </div>
      <PageArrow onClick={() => page(1)} />
    </div>
  );
}
/** NPaginateArrow: 0.75 scale; hover 1.1× and v 1.5 (0.05 s), unhover back and v 0.9 over 0.5 s Expo Out, press 0.9× v 0.8. */
function PageArrow({ left, onClick }: { left?: boolean; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const [touched, setTouched] = useState(false);
  const k = st === 'hover' ? 1.1 : st === 'press' ? 0.9 : 1, v = st === 'hover' ? 1.5 : st === 'press' ? 0.8 : touched ? 0.9 : 1;
  const t = st === 'hover' ? '.05s linear' : `.5s ${EXPO_OUT}`;
  const f = left ? frameByName('ui_atlas', 'settings_tiny_left_arrow') : null;
  return (
    <div class={'stp-arrow' + (left ? ' left' : ' right')}
      onPointerEnter={() => { setSt('hover'); hover(); }} onPointerLeave={() => { setSt(''); setTouched(true); }}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); click(); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); onClick(); } }}>
      <div class="stp-img" style={{ scale: String(0.75 * k), filter: `brightness(${v})`, transition: `scale ${t}, filter ${t}` }}>
        {f ? <div style={frameStyle(f, 64, 64)} /> : <img src={imageUrl('images/packed/common_ui/settings_tiny_right_arrow.png') ?? ''} width={64} height={64} />}
      </div>
    </div>
  );
}

/**
 * NSettingsSlider / NSlider (324 × 64): a health_bar track (#5C7375) in its black 0.36 border, the scrollbar_train
 * handle at the value (smoothed), "N%" to its left. Pressing or dragging sets the value from x; steps of 1.
 */
function Slider({ r }: { r: Extract<Row, { kind: 'slider' }> }) {
  const v = safe(r.get, 0);
  const at = (e: PointerEvent) => {
    const rr = (e.currentTarget as HTMLElement).getBoundingClientRect();
    r.set(Math.round(Math.min(1, Math.max(0, (e.clientX - rr.left) / rr.width)) * 100));
    invalidate();
  };
  return (
    <div class="st-slider" data-ctl>
      <div class="sts-value">{v}%</div>
      <div class="sts-bar"
        onPointerDown={(e) => { if (e.button !== 0) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); at(e); }}
        onPointerMove={(e) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) at(e); }}>
        <div class="sts-border" style={{ borderImageSource: `url(${imageUrl('images/ui/combat/health_bar_bg.png')})` }} />
        <div class="sts-fill" style={{ borderImageSource: `url(${imageUrl('images/ui/combat/health_bar.png')})`, filter: tint(0.361, 0.451, 0.459) }} />
        <div class="sts-handle" style={{ left: `${3.24 * v - 22.5}px` }}>
          <div style={frameStyle(frameByName('ui_atlas', 'scrollbar_train_large'), 40, 60)} />
        </div>
      </div>
    </div>
  );
}

/** NLanguageDropdown: greyed and locked in a run. */
function LanguageDropdown({ disabled }: { disabled: boolean }) {
  const cur = safe(() => settings().Language, 'eng') ?? 'eng';
  const pick = async (l: string) => { await setLanguage(l); sm().SaveSettings(); invalidate(); };
  return <Dropdown label={LANG_NAMES[cur] ?? cur} options={languages.map((l) => LANG_NAMES[l] ?? l)} disabled={disabled} onPick={(i) => void pick(languages[i])} />;
}
/**
 * NSettingsDropdown (320 × 64): the current option (Kreon Bold 28, gold) on #2C434F (#3C5B6B hovered) with a down
 * arrow; the list opens underneath (#122129, 44 px items, #2C5870 hovered, up to 600 px).
 */
function Dropdown({ label, options, disabled = false, onPick }: { label: string; options: string[]; disabled?: boolean; onPick: (i: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(false);
  return (
    <div class={'st-drop' + (disabled ? ' disabled' : '')} data-ctl>
      {open && <div class="std-dismiss" onPointerUp={() => setOpen(false)} />}
      <div class="std-face" style={{ background: hot ? '#3C5B6B' : '#2C434F' }}
        onPointerEnter={() => { if (disabled) return; setHot(true); hover(); }} onPointerLeave={() => setHot(false)}
        onPointerDown={(e) => { if (!disabled && e.button === 0) click(); }}
        onPointerUp={(e) => { if (!disabled && e.button === 0) setOpen(!open); }}>
        <div class="std-label">{label}</div>
        <div class="std-arrow" style={frameStyle(frameByName('ui_atlas', 'settings_tiny_left_arrow'), 26, 26)} />
      </div>
      {open && (
        <div class="std-list">
          {options.map((o, i) => <div class="std-item" onPointerEnter={hover} onPointerUp={() => { setOpen(false); onPick(i); }}>{o}</div>)}
        </div>
      )}
    </div>
  );
}

/** NSettingsButton (320 × 64): reward_skip_button (264 × 64, per-button hue) and its label; hover 1.05, press 0.95. */
function SettingsButton({ r }: { r: Extract<Row, { kind: 'button' }> }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const k = st === 'hover' ? 1.05 : st === 'press' ? 0.95 : 1;
  const t = st === 'hover' ? '.05s linear' : st === 'press' ? `.25s ${EXPO_OUT}` : `.5s ${EXPO_OUT}`;
  return (
    <div class="st-button" data-ctl style={{ scale: String(k), transition: `scale ${t}` }}
      onPointerEnter={() => { setSt('hover'); hover(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); click(); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); r.onClick(); } }}>
      <img class="stb-img" src={imageUrl('images/ui/reward_screen/reward_skip_button.png') ?? ''} style={{ filter: hsvFilter(r.hsv[0], r.hsv[1], r.hsv[2]) }} />
      <div class="stb-label" style={{ WebkitTextStrokeColor: r.outline }}>{r.text}</div>
    </div>
  );
}

/**
 * NSettingsTab (256 × 90): settings_tab_selected (hsv v .9) with the additive cyan stroke when selected; the label is
 * half-transparent cream unless selected. Hover: gold, v 1.2, 1.05 at once; unhover eases back over 0.5 s Expo Out.
 */
function SettingsTab({ label, x, selected, disabled, onClick }: { label: string; x: number; selected: boolean; disabled?: boolean; onClick: () => void }) {
  const [hot, setHot] = useState(false);
  const t = hot ? 'none' : `.5s ${EXPO_OUT}`;
  return (
    <div class={'settings-tab' + (disabled ? ' disabled' : '')} style={{ left: `${x}px`, scale: hot ? '1.05' : '1', transition: hot ? 'none' : `scale ${t}` }}
      onPointerEnter={() => { if (disabled) return; setHot(true); hover(); }} onPointerLeave={() => setHot(false)}
      onPointerDown={(e) => { if (!disabled && e.button === 0) click(); }}
      onPointerUp={(e) => { if (!disabled && e.button === 0) onClick(); }}>
      {selected && <img class="stab-outline" src={imageUrl('images/packed/common_ui/settings_tab_stroke.png') ?? ''} />}
      <img class="stab-img" src={imageUrl('images/packed/common_ui/settings_tab_selected.png') ?? ''} style={{ filter: `brightness(${hot ? 1.2 : 0.9})`, transition: hot ? 'none' : `filter ${t}` }} />
      <div class="stab-label" style={{ color: hot ? '#EFC851' : selected ? '#FFF6E2' : 'rgba(255, 246, 226, .5)', transition: hot ? 'none' : `color ${t}` }}>{label}</div>
    </div>
  );
}

/** NSettingsToast: 700 × 64 black 0.75 nine-patch parked under the screen; rises 120 px (0.25 s Back Out), holds 1 s, fades 0.5 s. */
function Toast() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !toast.gen) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([
      { translate: '0 0', opacity: 1, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      { translate: '0 -120px', opacity: 1, offset: 0.25 / 1.75 },
      { translate: '0 -120px', opacity: 1, offset: 1.25 / 1.75 },
      { translate: '0 -120px', opacity: 0 },
    ], { duration: 1750, fill: 'forwards' });
  }, [toast.gen]);
  return (
    <div class="settings-toast" ref={ref}>
      <div class="stt-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/tiny_nine_patch.png')})` }} />
      <div class="stt-text"><RichText text={toast.text} /></div>
    </div>
  );
}
