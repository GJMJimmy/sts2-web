// NCharacterSelectScreen (screens/character_select_screen.tscn), singleplayer: the character's animated background
// (AnimatedBg, render/scene charSelectBg), the info panel, the character buttons, the ascension panel and the back /
// embark buttons, as a submenu over the blurred main menu.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'preact/hooks';
import { G, $, list } from '../game';
import { playOneShot, stopMusic } from '../audio';
import { invalidate } from '../store';
import { imageUrl, atlasFrame, frameByName, frameStyle } from '../assets';
import { loc } from '../i18n';
import { startRun } from '../flow';
import { acceptTutorialsFtue } from './ftue';
import { RichText } from './richtext';
import { setTip } from './tooltip';
import { BackButton, ConfirmButton, NGoldArrowButton } from './buttons';
import { charSelectBg, regentZones, regentSkin } from '../render/scene';
import { tint } from '../filters';
import { useFit } from './card';
import { transitionView } from './transition';
import { characters, maxAscension, popMenu } from './menu';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (ls: any) => safe(() => ls?.GetFormattedText?.() ?? String(ls ?? ''), '');
const cl = (k: string) => safe(() => new G.LocString().$ctor_LocString('characters', k).GetFormattedText(), '');
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const isRandom = (c: any) => !!G.RandomCharacter && c instanceof G.RandomCharacter;
const shake = () => safe(() => $.ext('MegaCrit.Sts2.Core.Nodes.NGame').Instance.ScreenShake(G.ShakeStrength.Weak, G.ShakeDuration.Short, 90), null);

interface Sel { c: any; locked: boolean; n: number }
let embarking = false;
const none = (id: any) => !id || id === G.ModelId.none || safe(() => id.Equals(G.ModelId.none), false);
const debugAudio = (f: string) => safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play(f), null);

/** NCharacterSelectButton.LockForAnimation / AnimateUnlock state for the character being unlocked. */
const ua = { c: null as any, x: 0, y: 0, unlocked: false, lockA: 1, add: false, AddS: 1, AddA: 1 };
/**
 * PlayUnlockCharacterAnimation: behind a black 0.784 backstop (info panel hidden, back / embark off) the button shows
 * its locked face for 0.3 s, then its lock shakes for 1 s (radius 1 → 5, Quad Out) with the charge sound; the lock
 * turns to the open one, the icon unlocks with an additive copy growing to 1.5 while fading (1 s Expo In) and the lock
 * fades after 0.5 s. Then the character is selected. (The spark particles are not drawn.)
 */
async function playUnlock(c: any, done: () => void) {
  Object.assign(ua, { c, x: 0, y: 0, unlocked: false, lockA: 1, add: false, AddS: 1, AddA: 1 });
  invalidate();
  await new Promise((r) => setTimeout(r, 300));
  debugAudio('character_unlock_charge.mp3');
  await new Promise<void>((resolve) => {
    let t = 0, r = 1;
    $.onFrame((dt: number) => {
      const a = Math.random() * Math.PI * 2;
      ua.x = Math.cos(a) * r; ua.y = Math.sin(a) * r;
      t += dt;
      r = 1 + 4 * (1 - (1 - Math.min(t, 1)) ** 2);
      invalidate();
      if (t < 1) return true;
      resolve();
      return false;
    });
  });
  debugAudio('character_unlock.mp3');
  Object.assign(ua, { x: 0, y: 0, unlocked: true, add: true });
  const tw = new $.WebTween().SetParallel();
  tw.TweenProperty(ua, 'add_s', 1.5, 1);
  tw.TweenProperty(ua, 'add_a', 0, 1).SetEase(0).SetTrans(5);
  tw.TweenProperty(ua, 'lock_a', 0, 0.5).SetDelay(0.5);
  $.onFrame(() => { invalidate(); return tw.IsValid(); });
  tw.whenFinished(() => { ua.c = null; invalidate(); });
  safe(() => { G.SaveManager.Instance.Progress.PendingCharacterUnlock = G.ModelId.none; }, undefined);
  done();
}

export function CharSelect() {
  const chars = characters();
  // the random button only once every character is unlocked
  const random = chars.every((x) => !x.locked) ? safe(() => G.ModelDb.Character(G.RandomCharacter), null) : null;
  const buttons = [...chars, ...(random ? [{ c: random, locked: false }] : [])];
  const [sel, setSel] = useState<Sel | null>(null);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const max = sel && !sel.locked ? maxAscension(sel.c) : 0;
  /** NCharacterSelectScreen.SelectCharacter (+ StartRunLobby's ascension for the character). */
  const select = (c: any, locked: boolean) => {
    if (sel?.c === c) return;
    if (!isRandom(c)) playOneShot(c.CharacterSelectSfx);
    shake();
    void charSelectBg(locked ? null : isRandom(c) ? 'random_character' : String(c.Id.Entry).toLowerCase());
    const m = locked ? 0 : maxAscension(c);
    const pref = safe(() => G.SaveManager.Instance.Progress.GetOrCreateCharacterStats(c.Id).PreferredAscension, 0);
    setLevel(isRandom(c) ? m : Math.min(pref, m));
    setSel({ c, locked, n: (sel?.n ?? 0) + 1 });
  };
  // OnSubmenuOpened: the first button is selected, or a newly unlocked character plays its unlock first
  useEffect(() => {
    embarking = false;
    const pending = safe(() => G.SaveManager.Instance.Progress.PendingCharacterUnlock, null);
    const b = none(pending) ? null : buttons.find((x) => safe(() => x.c.Id.Equals(pending), false));
    if (b) {
      setUnlocking(true);
      void playUnlock(b.c, () => { setUnlocking(false); select(b.c, false); });
    } else select(buttons[0].c, buttons[0].locked);
    return () => { void charSelectBg(null); ua.c = null; };
  }, []);
  const changeLevel = (n: number) => {
    setLevel(n);
    // StartRunLobby.UpdatePreferredAscension
    if (sel && !isRandom(sel.c)) safe(() => { G.SaveManager.Instance.Progress.GetOrCreateCharacterStats(sel.c.Id).PreferredAscension = n; }, undefined);
  };
  const embark = async () => {
    if (!sel || sel.locked || embarking) return;
    embarking = true;
    setBusy(true);
    await acceptTutorialsFtue();
    let c = sel.c, asc = level;
    if (isRandom(c)) {
      // RollRandomCharacter, then its shake, sfx and background for a second
      const all = list(G.ModelDb.AllCharacters);
      c = all[Math.floor(Math.random() * all.length)];
      const m = safe(() => G.SaveManager.Instance.Progress.GetOrCreateCharacterStats(c.Id).MaxAscension, 0);
      asc = Math.min(m, asc);
      shake();
      playOneShot(c.CharacterSelectSfx);
      void charSelectBg(String(c.Id.Entry).toLowerCase());
      if (asc < m) setLevel(asc);
      await new Promise((r) => setTimeout(r, 1000));
    }
    stopMusic();
    playOneShot(c.CharacterTransitionSfx);
    await transitionView.FadeOut(0.8, c.CharacterSelectTransitionPath);
    await startRun(c, { ascension: asc });
  };
  return (
    <div class="charselect">
      {sel && !sel.locked && safe(() => sel.c.Id.Entry === 'REGENT', false) && <RegentHovers key={sel.n} />}
      {sel && !unlocking && <InfoPanel key={sel.n} c={sel.c} locked={sel.locked} />}
      {unlocking && <div class="chs-unlock-backstop" />}
      <div class="chs-buttons" style={{ left: `${960 - (buttons.length * 116 - 16) / 2}px` }}>
        {buttons.map(({ c, locked }) => (
          <CharacterSelectButton c={c} locked={locked} selected={sel?.c === c} enabled={!busy} onSelect={() => select(c, locked)} />
        ))}
      </div>
      {sel && !sel.locked && max > 0 && <AscensionPanel key={sel.n} level={level} max={max} onChange={changeLevel} />}
      <BackButton enabled={!busy && !unlocking} onClick={popMenu} />
      <ConfirmButton enabled={!!sel && !sel.locked && !busy && !unlocking} onClick={() => void embark()} />
    </div>
  );
}

/** NRegentCharacterSelectBg's constellation hover Controls (under the rest of the screen). */
function RegentHovers() {
  const [zones, setZones] = useState<ReturnType<typeof regentZones>>(null);
  // the background loads asynchronously after the selection
  useEffect(() => $.onFrame(() => { const z = regentZones(); if (z) setZones(z); return !z; }), []);
  if (!zones) return null;
  return <>{zones.map((z) => <div class="chs-bg-hover" style={{ left: `${z.x}px`, top: `${z.y}px`, width: `${z.w}px`, height: `${z.h}px` }}
    onPointerEnter={() => regentSkin(z.skin)} onPointerLeave={() => regentSkin('normal')} />)}</>;
}

/**
 * InfoPanel (296, 345)–(822, 779), sliding in from 300 px to the left (0.5 s Expo Out) on every selection, over its
 * fuzzy nine-patch: the name (Spectral Bold 80, auto-sized down to 48), HP and gold, the description and the starting
 * relic. Locked characters show the unlock text and the relic's silhouette; Random shows ?? and no relic.
 */
function InfoPanel({ c, locked }: { c: any; locked: boolean }) {
  const random = isRandom(c);
  const name = locked ? loc('main_menu_ui', 'CHARACTER_SELECT.locked.title') : cl(c.CharacterSelectTitle);
  const desc = locked ? safe(() => c.GetUnlockText().GetFormattedText(), '') : cl(c.CharacterSelectDesc);
  const relic = random ? null : safe(() => list(c.StartingRelics)[0], null);
  const unknown = locked || random;
  const nameRef = useRef<HTMLDivElement>(null), relicRef = useRef<HTMLDivElement>(null);
  useFit(nameRef, `csn|${name}`, 80, 48, (el) => el.scrollWidth <= el.clientWidth);
  useFit(relicRef, `csr|${relic ? fmt(relic.Title) : ''}|${locked}`, 24, 12, (el) => el.scrollHeight <= 57);
  const tb = (n: string) => frameStyle(frameByName('ui_atlas', 'top_bar/' + n), 40, 40);
  const icon = relic ? atlasFrame(safe(() => relic.IconPath, '')) : null;
  const outline = relic ? atlasFrame(safe(() => relic.PackedIconOutlinePath, '')) : null;
  return (
    <div class="chs-info">
      <div class="chs-info-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/fuzzy_nine_patch_char_select.png')})` }} />
      <div class="chs-info-box">
        <div class="chs-name" ref={nameRef}>{name}</div>
        <div class="chs-spacer">
          <div class="chs-stats">
            <div class="chs-stat"><div style={tb('top_bar_heart')} /><span class="hp">{unknown ? '??/??' : `${c.StartingHp}/${c.StartingHp}`}</span></div>
            <div class="chs-stat"><div style={tb('top_bar_gold')} /><span class="gold">{unknown ? '???' : String(c.StartingGold)}</span></div>
          </div>
        </div>
        <div class="chs-desc"><RichText text={desc} /></div>
        <div class="chs-relic">
          {relic && (
            <>
              <div class="chs-relic-outline" style={{ ...frameStyle(outline, 64, 64), filter: locked ? tint(1, 1, 1, 0.5) : tint(0, 0, 0, 0.5) }} />
              <div class="chs-relic-icon" style={{ ...frameStyle(icon, 64, 64), filter: locked ? tint(0, 0, 0, 0.9) : undefined }} />
              <div class="chs-relic-title"><RichText text={locked ? loc('main_menu_ui', 'CHARACTER_SELECT.lockedRelic.title') : fmt(relic.Title)} /></div>
              <div class="chs-relic-desc" ref={relicRef}><RichText text={locked ? loc('main_menu_ui', 'CHARACTER_SELECT.lockedRelic.description') : fmt(relic.DynamicDescription)} /></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * NCharacterSelectButton (100 × 154): the portrait masked by char_select_button_mask with its shadow, the gold
 * additive outline pulsing while selected, and the lock over locked ones. hsv (s, v): 0.2 / 0.4 at first, 1 / 1.1
 * selected (at once), 0.2 / 0.8 after leaving a state (0.5 s Expo Out); hover 1.1× with 1 / 1.1 at once.
 */
export function CharacterSelectButton({ c, locked, selected, enabled, onSelect }: { c: any; locked: boolean; selected: boolean; enabled: boolean; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  const [touched, setTouched] = useState(false);
  const was = useRef(selected);
  if (was.current !== selected) { if (was.current) queueMicrotask(() => setTouched(true)); was.current = selected; }
  const id = isRandom(c) ? 'random' : String(c.Id.Entry).toLowerCase();
  const u = ua.c === c ? ua : null;
  const showLocked = locked || (!!u && !u.unlocked);
  const lit = selected || hover;
  const s = lit ? 1 : 0.2, v = lit ? 1.1 : touched ? 0.8 : 0.4;
  const snap = hover || selected;
  const el = useRef<HTMLDivElement>(null);
  return (
    <div class={'chs-btn' + (selected ? ' selected' : '') + (hover ? ' hover' : '') + (u ? ' unlocking' : '')} ref={el}
      onPointerEnter={() => {
        if (selected || !enabled) return;
        setHover(true);
        playOneShot('event:/sfx/ui/clicks/ui_hover');
        if (locked) {
          const r = el.current!.getBoundingClientRect(), root = el.current!.closest('.stage-root')!.getBoundingClientRect(), k = root.width / 1920;
          setTip(loc('main_menu_ui', 'CHARACTER_SELECT.locked.title'), safe(() => c.GetUnlockText().GetFormattedText(), ''), { kind: 'at', x: (r.left - root.left) / k - 90, y: (r.top - root.top) / k - 180 });
        }
      }}
      onPointerLeave={() => { if (hover) { setHover(false); setTouched(true); } setTip(null); }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && !selected) { setHover(false); setTip(null); onSelect(); } }}>
      <img class="chsb-shadow" src={imageUrl('images/packed/character_select/char_select_button_mask.png') ?? ''} />
      {selected && <img class="chsb-outline" src={imageUrl('images/packed/character_select/char_select_outline.png') ?? ''} style={{ filter: tint(0.94, 0.706, 0.16, 0.85) }} />}
      <div class="chsb-mask" style={{ maskImage: `url(${imageUrl('images/packed/character_select/char_select_button_mask.png')})`, WebkitMaskImage: `url(${imageUrl('images/packed/character_select/char_select_button_mask.png')})` }}>
        <img class="chsb-icon" src={imageUrl(`images/packed/character_select/char_select_${id}${showLocked ? '_locked' : ''}.png`) ?? ''}
          style={{ filter: `saturate(${s}) brightness(${v})`, transition: snap ? 'none' : `filter .5s ${EXPO_OUT}` }} />
        {u?.add && <img class="chsb-icon chsb-add" src={imageUrl(`images/packed/character_select/char_select_${id}.png`) ?? ''} style={{ scale: String(1.01 * u.AddS), opacity: u.AddA }} />}
      </div>
      {(locked || u) && <img class="chsb-lock" src={imageUrl(`images/packed/character_select/char_select_lock3${u?.unlocked ? '_unlocked' : ''}.png`) ?? ''}
        style={u ? { opacity: u.lockA, translate: `${u.x}px ${u.y}px` } : undefined} />}
    </div>
  );
}

/**
 * NAscensionPanel (643, 738)–(1277, 855), fixed at the bottom: the gold arrows (hidden at 0 / max), the ascension
 * flame with the level, and "[gold]title[/gold]\ndescription". AnimIn: alpha 0 → 1 over 0.2 s, 30 px up (0.3 s Back Out).
 */
export function AscensionPanel({ level, max, onChange }: { level: number; max: number; onChange: (n: number) => void }) {
  const key = `LEVEL_${String(level).padStart(2, '0')}`;
  const text = `[b][gold]${loc('ascension', `${key}.title`)}[/gold][/b]\n${loc('ascension', `${key}.description`)}`;
  const numRef = useRef<HTMLDivElement>(null);
  useFit(numRef, `asc|${level}`, 36, 22, (el) => el.scrollWidth <= 64);
  return (
    <div class="chs-asc">
      <div class="chs-asc-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/tiny_nine_patch.png')})` }} />
      {level > 0 && <NGoldArrowButton left size={64} class="chs-arrow left" onClick={() => onChange(level - 1)} />}
      <div class="chs-asc-icon" style={frameStyle(frameByName('ui_atlas', 'top_bar/top_bar_ascension'), 64, 93)} />
      <div class="chs-asc-level" ref={numRef}>{level}</div>
      <div class="chs-asc-desc"><RichText text={text} /></div>
      {level < max && <NGoldArrowButton size={64} class="chs-arrow right" onClick={() => onChange(level + 1)} />}
    </div>
  );
}
