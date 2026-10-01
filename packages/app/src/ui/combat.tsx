// Combat screen: Pixi stage (backgrounds + Spine creatures) under a DOM layer (HP, intents, powers, hand, piles).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CombatBanners, clearCombatBanners } from './banners';
import { useEffect, useRef } from 'preact/hooks';
import { G, $, N, list } from '../game';
import { ui } from '../store';
import { CombatStage, layoutCreatures } from '../render/stage';
import { combatBackdropFor } from '../render/scene';
import { atlasFrame, frameStyle, frameByName, imageUrl } from '../assets';
import { RichText } from './richtext';
import { setTip, setTips, hoverTipsOf } from './tooltip';
import { floaters, bubbles, powerPops } from '../bridge';
import { t } from '../i18n';
import { showFtue } from './ftue';
import { CardLayer, TargetingArrow, TintFilters, usePointer } from './cardlayer';
import { EnergyCounter, EndTurnButton, PileButton, pileHotkey, endTurnHotkey, combatIsCurrent, hud } from './combat-hud';
import { CreatureOverlay, FloatNumber, SpeechBubble, PowerPop } from './creature-ui';
import { OrbLabels } from './orbs';
import { HandSelectUi, SelectConfirmButton, confirmHotkey, peekHotkey } from './hand-select';
import { CardFxCanvas } from '../render/cardfx';
import { arrow, ftueHook, targetManager, TrailVfx, ShuffleFlyVfx, type HandView } from '../cardnodes';

let hotkeys: { hand: HandView | null } | null = null;
/** NHotkeyManager: echoes (held-key repeats) never trigger; a hotkey's release binding runs when its key comes up. */
let keyRepeat = false;
window.addEventListener('keydown', (e) => { keyRepeat = e.repeat; }, true);
const held = new Map<string, () => void>();
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(), f = held.get(k); if (f) { held.delete(k); f(); } });
const hold = (k: string, release: (() => void) | null) => { if (release) held.set(k, release); return true; };
/**
 * Combat keys (NInputManager.DefaultKeyboardInputMap): digits pick hand cards (NPlayerHand selectCard1–10), Space is the
 * peek button's, E (accept) the confirm button's during a hand selection and otherwise the End Turn button's, A / S / X
 * the pile buttons'. A button takes its key only while enabled.
 */
export function combatHotkey(key: string): boolean {
  if (!hotkeys || !document.querySelector('.combat .combat-ui')) return false;
  const k = key.toLowerCase(), hand = hotkeys.hand;
  if (!/^[0-9 easx]$/.test(k)) return false;
  if (keyRepeat) return true;
  if (/^[0-9]$/.test(k)) { if (combatIsCurrent()) hand?.selectCardShortcut((Number(k) + 9) % 10); return true; }
  if (k === ' ') return hold(k, hand?.IsInCardSelection && combatIsCurrent() ? peekHotkey() : null);
  if (k === 'e') return hold(k, !hand?.IsInCardSelection ? endTurnHotkey() : combatIsCurrent() ? confirmHotkey() : null);
  return hold(k, pileHotkey(k === 'a' ? 'draw' : k === 's' ? 'discard' : 'exhaust'));
}

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
/** static_hover_tips `<key>.title` / `.description` (the counters' and piles' hover tips), with optional variables. */
export function staticTip(key: string, vars: Record<string, string> = {}) {
  const ls = (k: string) => { const l = new G.LocString().$ctor_LocString('static_hover_tips', k); for (const [n, v] of Object.entries(vars)) l.Add$String_String(n, v); return safe(() => l.GetFormattedText(), ''); };
  setTip(ls(`${key}.title`), ls(`${key}.description`));
}
/** Leaving a run mid-combat: free the combat room's web nodes (hand, queue, VFX). */
export function resetCombatUi() {
  N('Rooms.NCombatRoom').Instance?.dispose?.();
  clearCombatBanners();
  TrailVfx.all.clear();
  ShuffleFlyVfx.all.clear();
}
/** NEndTurnButton.SecretEndTurnLogicViaFtue: the cannot-play tip's hidden hitbox ends the turn without the playable-cards check. */
ftueHook.cannotPlay = () => showFtue('cannot_play_card_ftue', 'CANNOT_PLAY_CARD_FTUE', () => hud.endTurn?.secretEndTurn());

/** Combat room; `visualOnly` (combat-layout events) shows the stage and creatures without the hand/energy UI. */
export function CombatScreen({ view, visualOnly = false }: { view: any; visualOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fxHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = new CombatStage(view);
    combatBackdropFor(G, view.combatState, view.combatState?.RunState ?? G.RunManager.Instance.State).then((bg) => st.setBackground(bg));
    st.mount(host.current!);
    // VFX nodes in NCombatUi draw among its (DOM) cards, in FX slots; CombatVfxContainer's under the combat UI
    const fx = new CardFxCanvas('combat', (n) => !!n && (view.Ui.IsAncestorOf(n) || view.CombatVfxContainer.IsAncestorOf(n)), (n) => view.Ui.IsAncestorOf(n));
    if (!visualOnly) void fx.mount(fxHost.current!);
    let raf = 0;
    const tick = () => { st.sync(); raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); st.destroy(); fx.destroy(); };
  }, [view]);
  usePointer(() => view.Ui?.Hand ?? null);
  const cs = view.combatState;
  const cm = G.CombatManager.Instance;
  const me = cs?.Players?.[0] ?? G.RunManager.Instance.State?.Players?.[0];
  const pcs = me?.PlayerCombatState;
  const slots = cs ? layoutCreatures(cs) : new Map();
  hotkeys = { hand: visualOnly ? null : view.Ui?.Hand ?? null };
  return (
    <div class={'combat' + (arrow.visible ? ' targeting' : '') + (ui.gameOver ? ' gameover' : '')}>
      {/* CombatSceneContainer (the screen-shake target): background and creatures with their HP bars, intents, orbs */}
      <div class="stage-host" ref={host} data-shake />
      <div class="creatures-layer" data-shake>
        {[...slots].map(([c, s]) => <CreatureOverlay key={keyOf(c)} c={c} s={s} node={view.GetCreatureNode(c)} fresh={performance.now() - view.createdAt < 1000} />)}
        {[...view.removing].filter(([c]) => !slots.has(c)).map(([c, s]) => <CreatureOverlay key={keyOf(c)} c={c} s={s} node={view.removingNodes.get(c)} fresh={false} removing />)}
        {me && slots.get(me.Creature) && view.GetCreatureNode(me.Creature)?.OrbManager && <OrbLabels view={view.GetCreatureNode(me.Creature).OrbManager} c={me.Creature} s={slots.get(me.Creature)} />}
      </div>
      {/* CombatVfxContainer's DOM part: damage numbers and speech bubbles do not shake */}
      <div class="creatures-layer">
        {powerPops.map((p) => <PowerPop key={'p' + p.id} p={p} />)}
        {floaters.map((f) => <FloatNumber key={f.id} f={f} s={slots.get(f.c)} />)}
        {bubbles.map((b) => <SpeechBubble key={'b' + b.id} b={b} s={b.c ? slots.get(b.c) : undefined} />)}
      </div>
      {!visualOnly && <CardLayer root={view.CombatVfxContainer} />}
      <div class="card-fx-host" ref={fxHost} />
      {pcs && !visualOnly && (
        <div class="combat-ui">
          <PileButton kind="draw" pile={pcs.DrawPile} me={me} out={!cm.IsInProgress || !!ui.gameOver} />
          <PileButton kind="discard" pile={pcs.DiscardPile} me={me} out={!cm.IsInProgress || !!ui.gameOver} />
          <PileButton kind="exhaust" pile={pcs.ExhaustPile} me={me} out={!cm.IsInProgress || !!ui.gameOver} />
          <EndTurnButton view={view} me={me} />
          <EnergyCounter me={me} pcs={pcs} out={!cm.IsInProgress || !!ui.gameOver} />
          {view.Ui.Hand.IsInCardSelection ? (
            <>
              {/* NCombatUi.OnHandSelectModeEntered: the hand comes to the front, over its backstop (a peek target) */}
              <CardLayer root={view.Ui} hand={view.Ui.Hand} skip={view.Ui.Hand} />
              <div class="select-backstop" style={view.Ui.Hand.select.peeking ? { visibility: 'hidden' } : undefined} />
              <CardLayer root={view.Ui.Hand} hand={view.Ui.Hand} />
              <HandSelectUi hand={view.Ui.Hand} />
            </>
          ) : <CardLayer root={view.Ui} hand={view.Ui.Hand} />}
          <SelectConfirmButton hand={view.Ui.Hand} />
        </div>
      )}
      {!visualOnly && <CombatBanners />}
      <TargetingArrow />
      <TintFilters />
    </div>
  );
}

const ids = new WeakMap<any, number>();
let nextId = 0;
const keyOf = (c: any) => ids.get(c) ?? (ids.set(c, ++nextId), nextId);
