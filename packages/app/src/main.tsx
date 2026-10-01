import { render } from 'preact';
import './style.css';
import { G, $, list } from './game';
import { ui, setRenderer, startLoop, invalidate, type Screen } from './store';
import { loadAssetIndex } from './assets';
import { preloadLocalization, addListedFiles, appText } from './i18n';
import { sceneIndex } from './render/scene';
import { installFilters } from './filters';
import { installBridge } from './bridge';
import './render/vfx-cards';
import './render/vfx-attacks';
import './render/vfx-misc';
import { loadAudioIndex, setVolumes, resolveSfx } from './audio';
import { MainMenu } from './ui/menu';
import { RunScreen } from './ui/run';
import { combatHotkey } from './ui/combat';
import { Tip } from './ui/tooltip';
import { openPauseMenu, toggleCardsView, closeCardsView } from './ui/pause';
import { ftueActive } from './ui/ftue';
import { InspectLayer, inspectActive } from './ui/cards-view';
import { loadShader } from './render/canvas';
import { fullScreenScene } from './render/scene';
import { Backdrop } from './ui/backdrop';
import { CardLibrary, RelicCollection, PotionLab } from './ui/compendium';
import { Stats } from './ui/stats';
import { RunHistory } from './ui/history';
import { TransitionLayer, transitionView } from './ui/transition';
import { ModalLayer } from './ui/modal';
import { topBarMapPressed } from './ui/map';

// A touch device held upright shows the stage turned a quarter (its top along the screen's right edge) rather than a
// tiny letterboxed one: the player turns the device, not the browser.
let turned = false;
function fit() {
  turned = window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches;
  const [w, h] = turned ? [window.innerHeight, window.innerWidth] : [window.innerWidth, window.innerHeight];
  document.documentElement.style.setProperty('--scale', String(Math.min(w / 1920, h / 1080)));
  document.documentElement.style.setProperty('--turn', turned ? '90deg' : '0deg');
}
window.addEventListener('resize', () => { fit(); invalidate(); });
// While turned, page coordinates are reported as the unturned stage sees them (x = page y, y = width − page x), so
// every client → stage conversion in the views (and Pixi's) stays as written.
// ponytail: patches DOM prototypes; move to explicit stage-coordinate helpers if another transform is ever needed
{
  const P = MouseEvent.prototype;
  const orig = (k: string) => Object.getOwnPropertyDescriptor(P, k)!.get as (this: MouseEvent) => number;
  const cx = orig('clientX'), cy = orig('clientY'), mx = orig('movementX'), my = orig('movementY');
  const def = (k: string, get: (this: MouseEvent) => number) => Object.defineProperty(P, k, { get, configurable: true, enumerable: true });
  def('clientX', function () { return turned ? cy.call(this) : cx.call(this); });
  def('clientY', function () { return turned ? window.innerWidth - cx.call(this) : cy.call(this); });
  def('movementX', function () { return turned ? my.call(this) : mx.call(this); });
  def('movementY', function () { return turned ? -mx.call(this) : my.call(this); });
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = rect.call(this);
    return turned ? new DOMRect(r.top, window.innerWidth - r.right, r.height, r.width) : r;
  };
}
// a finger captures its pointer to the element it lands on, so a dragged card would never enter the enemy under it:
// released, touch drags hover what they pass over like the mouse
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') (e.target as Element).releasePointerCapture?.(e.pointerId); }, true);
// potion popup closes on any click outside it
window.addEventListener('pointerdown', (e) => { if (ui.potionMenu && !(e.target as Element).closest?.('.potion-wrap')) { ui.potionMenu = null; invalidate(); } }, true);

/** NInputManager defaults outside Escape: A/S/X/D open the draw/discard/exhaust piles and the deck, M the map. */
function runHotkey(key: string) {
  if (ui.screen !== 'run' || ui.pauseOpen || ui.subscreen || ftueActive()) return;
  if (combatHotkey(key)) return;
  const k = key.toLowerCase();
  const pile = ({ a: 'draw', s: 'discard', x: 'exhaust', d: 'deck' } as Record<string, 'draw' | 'discard' | 'exhaust' | 'deck'>)[k];
  if (pile && (pile === 'deck' || document.querySelector('.combat .combat-ui'))) toggleCardsView(pile);
  else if (k === 'm' && !ui.gameOver && ui.room?.kind !== 'maproom') topBarMapPressed(); // NTopBarMapButton's viewMap hotkey
  else return;
  invalidate();
}
const SCREENS: Partial<Record<Screen, () => any>> = {
  library: CardLibrary, relics: RelicCollection, potions: PotionLab,
  history: RunHistory, stats: Stats,
};
/** A routed screen as its own component (keyed), so its hooks never mix with App's or another screen's. */
function ScreenView({ s }: { s: Screen }) { const S = SCREENS[s]; return S ? <S key={s} /> : null; }
// the right mouse button is a game input (cancel a play, inspect a card, draw on the map): never the browser's menu
window.addEventListener('contextmenu', (e) => e.preventDefault(), true);
// Escape closes the topmost panel; in a run with nothing open it brings up the pause menu (NHotkeyManager "pause")
window.addEventListener('keydown', (e) => {
  // NPeekButton's hotkey (MegaInput.peek = Space) on an overlay screen that has one
  const top = ui.overlays[ui.overlays.length - 1];
  if (e.code === 'Space' && ui.screen === 'run' && top?.peekEnabled && !(e.target as HTMLElement)?.closest?.('input, textarea')) {
    e.preventDefault();
    if (!e.repeat) top.togglePeek();
    return;
  }
  const el = e.target as HTMLInputElement;
  if (el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(el.type))) return; // typing
  if (e.key !== 'Escape') { runHotkey(e.key); return; }
  const closers = document.querySelectorAll<HTMLElement>('[data-esc]'); // inner modals (card inspect) mark their close control
  const close = closers[closers.length - 1];
  if (close) { close.click(); return; }
  else if (ui.subscreen) ui.subscreen = null;
  else if (ui.cardsView) closeCardsView();
  else if (ui.screen === 'run' && !ui.gameOver && !ui.pauseOpen) openPauseMenu();
  invalidate();
});
// dev only: ?scene=scenes/rest_site/hive_rest_site.tscn shows one converted scene full-screen (renderer checks)
const debugScene = import.meta.env.DEV ? new URLSearchParams(location.search).get('scene') : null;
function App() {
  // AbstractMegaRichTextEffect: PrefsSave.TextEffectsEnabled turns wavy / shaky text off
  document.body.classList.toggle('no-text-fx', !tryOr(() => G.SaveManager.Instance.PrefsSave.TextEffectsEnabled, true));
  if (debugScene && ui.screen !== 'boot') return <div class="viewport"><div class="stage-root"><Backdrop id={debugScene} build={() => fullScreenScene(debugScene)} /></div></div>;
  return (
    <>
      <div class="viewport">
        <div class="stage-root">
          {ui.screen === 'boot' && <div class="boot">Loading…</div>}
          {ui.screen === 'menu' && <MainMenu />}
          {ui.screen === 'run' && <RunScreen />}
          <ScreenView s={ui.screen} />
        </div>
      </div>
      <TransitionLayer />
      {ui.subscreen && <div class="viewport"><div class="stage-root subscreen-root"><ScreenView s={ui.subscreen} /></div></div>}
      {inspectActive() && <div class="viewport"><div class="stage-root settings-root"><InspectLayer /></div></div>}
      <ModalLayer />
      <Tip />
      {ui.toast && <div class="toast" onClick={() => { ui.toast = ''; invalidate(); }}>{ui.toast}</div>}
    </>
  );
}

async function boot() {
  fit();
  const root = document.getElementById('app')!;
  setRenderer(() => render(<App />, root));
  startLoop();
  installFilters();
  // tables must be fetched before init; the last chosen language is mirrored outside the (not yet loaded) SettingsSave,
  // and until one is chosen the device's language applies
  const lang = new URLSearchParams(location.search).get('lang') ?? safeGet('sts2web.lang') ?? G.platformLanguage(navigator.languages);
  await Promise.all([loadAssetIndex(), preloadLocalization(lang === 'eng' ? ['eng'] : ['eng', lang]), sceneIndex().then(addListedFiles), loadAudioIndex()]);
  $.setGodotLogSink((level: string, msg: string) => (level === 'error' ? console.error(msg) : level === 'warn' ? console.warn(msg) : undefined));
  installBridge();
  let warned = false;
  $.setStorageErrorHandler((path: string, err: unknown) => {
    console.error('save write failed', path, err);
    if (!warned) { warned = true; ui.toast = appText('storageFull'); invalidate(); }
  });
  await $.vfs.mount(); // saves live in IndexedDB (localStorage ones migrate on first run)
  G.initGame({});
  // players only get Normal/Fast (NFastModeTickbox); Instant is a test mode in which some event animation loops spin
  const prefs = G.SaveManager.Instance.PrefsSave;
  if (prefs.FastMode === G.FastModeType.Instant) prefs.FastMode = G.FastModeType.Fast;
  if (!$.vfs.persistent) ui.toast = appText('noStorage');
  const st = G.SaveManager.Instance.SettingsSave;
  setVolumes({ master: st.VolumeMaster, music: st.VolumeBgm, sfx: st.VolumeSfx, amb: st.VolumeAmbience });
  // always: a saved SettingsSave.Language may differ from the tables fetched above (the device's language changed)
  G.SaveManager.Instance.SettingsSave.Language = lang;
  G.LocManager.Instance.SetLanguage(lang);
  document.documentElement.dataset.lang = lang; // style.css: FontManager's per-language font substitution
  await transitionView.FadeOut(); // NGame.LaunchMainMenu: after the logo animation, before the menu fades in
  ui.screen = 'menu';
  invalidate();
  (window as any).G = G;
  (window as any).ui = ui;
  (window as any).unlockAll = unlockAll;
  (window as any).invalidate = invalidate;
  if (import.meta.env.DEV) Object.assign(window, { __loadShader: loadShader, __resolveSfx: resolveSfx }); // tools/e2e/shaders.mjs, audio.mjs
  // NGame._Notification(WM_CLOSE_REQUEST) → Quit: closing the tab saves settings, prefs, progress and the profile
  window.addEventListener('pageshow', (e) => { if (e.persisted) $.vfs.setUnloading(false); });
  window.addEventListener('pagehide', () => {
    $.vfs.setUnloading(true);
    const sm = G.SaveManager.Instance;
    for (const save of ['SaveSettings', 'SavePrefsFile', 'SaveProgressFile', 'SaveProfile']) try { sm[save](); } catch (e) { console.warn(save, e); }
  });
  const qs = new URLSearchParams(location.search);
  if (qs.get('unlock') === 'all') unlockAll();
  if (qs.get('tutorials') === 'off') { G.SaveManager.Instance.SetFtuesEnabled(false); G.SaveManager.Instance.SettingsSave.SeenEaDisclaimer = true; }
}
/** The dev console's `unlock all` (UnlockConsoleCmd): everything discovered, every epoch revealed, ascension 10. */
function unlockAll() {
  const sm = G.SaveManager.Instance, p = sm.Progress;
  for (const c of list(G.ModelDb.AllCards)) p.MarkCardAsSeen(c.Id);
  for (const r of list(G.ModelDb.AllRelics)) p.MarkRelicAsSeen(r.Id);
  for (const x of list(G.ModelDb.AllPotions)) p.MarkPotionAsSeen(x.Id);
  for (const e of list(G.ModelDb.AllEvents)) p.MarkEventAsSeen(e.Id);
  for (const m of list(G.ModelDb.Monsters)) {
    const s = p.GetOrCreateEnemyStats(m.Id);
    if (s.FightStats.Count === 0) s.FightStats.Add(Object.assign(new G.FightStats().$ctor_FightStats(), { Character: G.ModelDb.Character(G.Ironclad).Id, Wins: 1 }));
  }
  const revealed = new Set(list(p.Epochs).filter((e: any) => e.State === G.EpochState.Revealed).map((e: any) => e.Id));
  for (const id of list(G.EpochModel.AllEpochIds)) if (!revealed.has(id)) sm.ObtainEpochOverride(id, G.EpochState.Revealed);
  p.MaxMultiplayerAscension = 10;
  for (const c of list(G.ModelDb.AllCharacters)) p.GetOrCreateCharacterStats(c.Id).MaxAscension = 10;
  sm.SaveProgressFile();
  invalidate();
}
// offline cache (production builds only; the dev server serves modules that must not be cached)
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`./sw.js?v=${__BUILD_ID__}&a=${__ASSETS_ID__}`).catch(() => {});
// Tianji analytics on deployed hosts only: dev, preview and the e2e runs all serve from 127.0.0.1
if (!['127.0.0.1', 'localhost'].includes(location.hostname)) {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://app.tianji.dev/tracker.js';
  s.dataset.websiteId = 'cmupjzwk6wm425xc7qmgk89dy';
  document.head.append(s);
}
function tryOr<T>(f: () => T, d: T) { try { return f() ?? d; } catch { return d; } }
function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
boot().catch((e) => {
  console.error(e);
  document.getElementById('app')!.innerHTML = `<pre class="fatal">${String(e?.stack ?? e)}</pre>`;
});
