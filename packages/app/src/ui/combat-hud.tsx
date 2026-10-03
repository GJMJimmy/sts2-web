// combat_ui.tscn HUD: NEnergyCounter (per-character orb layers, burst on gain) with NStarCounter, NEndTurnButton and the
// three NCombatCardPile buttons. Positions, fonts, colours and tweens follow the scenes and scripts: the buttons run
// NClickableControl's enable / focus / press state machine with real tweens ($.WebTween), painted every frame.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { toggleCardsView, closeCardsView } from './pause';
import { useEffect, useRef } from 'preact/hooks';
import { G, $, N } from '../game';
import { ui, invalidate } from '../store';
import { imageUrl } from '../assets';
import { setTip } from './tooltip';
import { t } from '../i18n';
import { playOneShot } from '../audio';
import { curveAt } from '../render/cardfx';
import { useFit } from './card';
import { tint, hsvFilter } from '../filters';
import { modalOpen } from './modal';
import { ftueActive, seenFtue, showFtue } from './ftue';
import { inspectActive } from './inspect';
import { view, fracX, fracY, anchored } from '../view';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const rgb = (c: number[]) => `rgb(${c[0] * 255}, ${c[1] * 255}, ${c[2] * 255})`;
const colorCss = (c: any, d: string) => (c && 'R' in c ? `rgba(${c.R * 255}, ${c.G * 255}, ${c.B * 255}, ${c.A ?? 1})` : d);
const tween = () => new $.WebTween();
/** Tween.TransitionType / EaseType. */
const QUART = 3, EXPO = 5, CUBIC = 7, BACK = 10, OUT = 1;
/** static_hover_tips `<key>.title` / `.description`, at a point anchored like its button (`to`: view.ts anchored). */
function staticTip(key: string, vars: Record<string, string>, x0: number, y0: number, to = '') {
  const [x, y] = anchored(x0, y0, to);
  const ls = (k: string) => { const l = new G.LocString().$ctor_LocString('static_hover_tips', k); for (const [n, v] of Object.entries(vars)) l.Add$String_String(n, v); return safe(() => l.GetFormattedText(), ''); };
  setTip(ls(`${key}.title`), ls(`${key}.description`), { kind: 'at', x, y });
}
/** Style writes that skip unchanged values (the buttons are painted every frame). */
const painted = new WeakMap<HTMLElement, Record<string, string>>();
function put(el: HTMLElement | null, k: string, v: string) {
  if (!el) return;
  let m = painted.get(el);
  if (!m) painted.set(el, (m = {}));
  if (m[k] !== v) { m[k] = v; (el.style as any)[k] = v; }
}
/** ActiveScreenContext.IsCurrent(NCombatRoom): no modal, FTUE, inspect screen, capstone, map or overlay above the combat. */
export const combatIsCurrent = () => !modalOpen() && !ftueActive() && !inspectActive() && !ui.cardsView && !ui.pauseOpen && !ui.subscreen && !ui.mapOpen && !ui.overlays.length && !ui.gameOver;
const combatHand = () => N('Rooms.NCombatRoom').Instance?.Ui?.Hand ?? null;

// ------------------------------------------------------------------ NEnergyCounter
/** <char>_energy_counter.tscn: static layers under/over the two rotating ones; particle colour of the bursts. */
const ORB: Record<string, { base: number[]; rot: number[]; top: number[]; particle: [number, number, number]; burstY: number }> = {
  ironclad: { base: [1], rot: [2, 3], top: [4, 5], particle: [0.894, 0.655, 0.216], burstY: 62 },
  silent: { base: [1], rot: [2, 3], top: [4, 5], particle: [0.184, 0.843, 0.255], burstY: 63 },
  defect: { base: [1], rot: [2, 3], top: [4, 5], particle: [0, 0.796, 0.851], burstY: 63 },
  regent: { base: [1], rot: [2, 3], top: [5, 5], particle: [0.894, 0.655, 0.216], burstY: 62 },
  necrobinder: { base: [1], rot: [2], top: [3], particle: [0.988, 0.549, 0.643], burstY: 63 },
};
const SHINE_CURVE = [[0.00596422, 0.0309963, 0, 4.46389], [0.298211, 0.736162, 0.832039, 0.832039], [0.99006, 0.932841, -0.247478, 0]];
const BURST_CURVE = [[0.00596422, 0.0309963, 0, 2.09119], [1, 0.995203, 0.241291, 0]];
/** Gradient_4pfys offsets: alpha 0 → 1 → 1 → 0. */
const RAMP = [0, 0.330526, 0.652632, 1];
/**
 * One-shot CPUParticles2D burst (amount 1, additive material): 0.45 × scale curve, colour alpha 0.6 × ramp, a random
 * 0–260° start angle turning 30°/s. Emitting again while the burst is alive does nothing (set_emitting).
 */
function burst(el: HTMLElement | null, curve: number[][], life: number) {
  if (!el || el.getAnimations().some((a) => a.playState === 'running')) return;
  const a0 = Math.random() * 260, frames: Keyframe[] = [];
  for (let i = 0; i <= 24; i++) {
    const tt = i / 24, alpha = tt < RAMP[1] ? tt / RAMP[1] : tt < RAMP[2] ? 1 : 1 - (tt - RAMP[2]) / (RAMP[3] - RAMP[2]);
    frames.push({ offset: tt, opacity: alpha * 0.6, transform: `rotate(${a0 + 30 * life * tt}deg) scale(${0.45 * curveAt(curve, tt)})` });
  }
  el.animate(frames, { duration: life * 1000 });
}
export function EnergyCounter({ me, pcs, out }: { me: any; pcs: any; out: boolean }) {
  const ch = String(safe(() => me.Character.Id.Entry, 'IRONCLAD')).toLowerCase();
  const o = ORB[ch] ?? ORB.ironclad;
  const energy = pcs.Energy, max = safe(() => pcs.MaxEnergy, energy); // MaxEnergy runs hooks: throws once the combat is torn down
  const regent = safe(() => me.Character.ShouldAlwaysShowStarCounter, false);
  const rot = useRef<HTMLImageElement[]>([]);
  const back = useRef<HTMLImageElement>(null), front = useRef<HTMLImageElement>(null), label = useRef<HTMLDivElement>(null);
  const zero = useRef(energy === 0);
  zero.current = energy === 0;
  useEffect(() => {
    const ang = [0, 0];
    return $.onFrame((dt: number) => {
      const sp = zero.current ? 5 : 30;
      rot.current.forEach((el, i) => { if (el) { ang[i] += dt * sp * (i + 1); el.style.transform = `rotate(${ang[i]}deg)`; } });
    });
  }, []);
  // NEnergyCounter.OnEnergyChanged: both bursts fire when energy goes up
  useEffect(() => {
    const on = (was: number, now: number) => { if (was < now) { burst(front.current, BURST_CURVE, 0.5); burst(back.current, SHINE_CURVE, 1); } };
    pcs.EnergyChanged = $.dcombine(pcs.EnergyChanged, on);
    return () => { pcs.EnergyChanged = $.dremove(pcs.EnergyChanged, on); };
  }, [pcs]);
  // MegaLabel SetTextAutoSize: 36 → 32 to fit the 96 × 186 label
  useFit(label, `en|${energy}/${max}`, 36, 32, (el) => (el.firstChild as HTMLElement).offsetWidth <= 96 && (el.firstChild as HTMLElement).offsetHeight <= 186);
  const layer = (n: number) => imageUrl(`images/ui/combat/energy_counters/${ch}/${ch}_orb_layer_${n}.png`) ?? '';
  const outline = energy === 0 ? '#501717' : colorCss(safe(() => me.Character.EnergyLabelOutlineColor, null), '#000');
  // combat_ui.tscn EnergyCounterContainer: anchored bottom-left (style.css moves its x)
  const y = regent ? 806 : 828;
  const energyTip = () => staticTip('ENERGY_COUNT', { energyPrefix: safe(() => G.EnergyIconHelper.GetPrefix(me.Character.CardPool), '') }, 100 - 70, y - 200, 'lb');
  return (
    <div class={'energy-counter' + (out ? ' out' : '')} style={{ top: `${y + view.oy}px` }} onMouseEnter={energyTip} onMouseLeave={() => setTip(null)}>
      <img class="orb-burst" ref={back} src={imageUrl('images/ui/combat/energy_counters/energy_burst/energy_orb_shine.png') ?? ''} style={{ top: `${o.burstY}px`, filter: tint(...o.particle) }} />
      <div class={'orb-layers' + (energy === 0 ? ' dark' : '')}>
        {o.base.map((n) => <img src={layer(n)} />)}
        {o.rot.map((n, i) => <img src={layer(n)} ref={(el) => { if (el) rot.current[i] = el; }} />)}
        {o.top.map((n) => <img src={layer(n)} />)}
      </div>
      <img class="orb-burst" ref={front} src={imageUrl('images/ui/combat/energy_counters/energy_burst/energy_orb_burst.png') ?? ''} style={{ top: `${o.burstY}px`, filter: tint(...o.particle) }} />
      <div class="orb-label" ref={label} style={{ color: energy === 0 ? '#ff5555' : '#fff6e2', WebkitTextStrokeColor: outline }}><span>{energy}/{max}</span></div>
      {/* mouse_entered / exited are hierarchical: leaving the star onto the orb brings the orb's tip back */}
      <StarCounter pcs={pcs} regent={regent} onLeave={(e) => { if ((e.currentTarget as HTMLElement).parentElement?.contains(e.relatedTarget as Node)) energyTip(); else setTip(null); }} />
    </div>
  );
}

// ------------------------------------------------------------------ NStarCounter
/** MathHelper.SmoothDamp (NStarCounter follows the real count with smoothTime 0.1). */
function smoothDamp(cur: number, target: number, vel: { v: number }, time: number, dt: number) {
  const omega = 2 / time, x = omega * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  if (target - cur > 0 === out > target) { out = target; vel.v = 0; }
  return out;
}
/** star_gain_vfx.tscn (GPUParticles2D, lifetime 1 s, colour (0.77, 0.931, 1)): GlowStar (twinkle_star 37 px) and the flash. */
const STAR_TINT: [number, number, number] = [0.77, 0.931, 1];
const GLOW_SCALE = [[0, 2.45204, 0, 3.26562], [0.75, 4, 0, 0]];
const GLOW_SPIN = [[0, 326.461, 0, 0], [1, 303.241, 0, 0]];
const GLOW_ALPHA = [[0.151685, 1, 0, -3.16357], [0.99999, 0, 0.196272, 0.196272], [1, 0, -2.51066, 0]];
const FLASH_SCALE = [[0, 0.433848, 0, 0.759952], [1, 0.648842, 0, 0]];
const FLASH_ALPHA = [[0.202247, 1, 0, -2.46329], [0.99999, 0, -0.312973, -0.312973], [1, 0, -2.51066, 0]];
/** NStarCounter.UpdateStarCount: a new StarGainVfx at the counter's centre, moved to child 0 (behind the icon and older ones). */
function starGain(host: HTMLElement | null) {
  if (!host) return;
  const vfx = document.createElement('div');
  const particle = (path: string, size: number, alpha: number, scale: number[][], fade: number[][], spin: number[][] | null) => {
    const el = document.createElement('img');
    el.src = imageUrl(path) ?? '';
    Object.assign(el.style, { position: 'absolute', left: `${-size / 2}px`, top: `${-size / 2}px`, width: `${size}px`, height: `${size}px`, opacity: '0', filter: tint(...STAR_TINT) });
    vfx.appendChild(el);
    const frames: Keyframe[] = [];
    // ParticleProcessMaterial: angle = age × angular_velocity × curve(age); scale and alpha from their curves
    for (let i = 0; i <= 32; i++) {
      const u = i / 32;
      frames.push({ offset: u, opacity: alpha * curveAt(fade, u), transform: `rotate(${spin ? u * 0.999984 * curveAt(spin, u) : 0}deg) scale(${curveAt(scale, u)})` });
    }
    el.animate(frames, { duration: 1000 });
  };
  particle('images/packed/vfx/generic/twinkle_star.png', 37, 1, GLOW_SCALE, GLOW_ALPHA, GLOW_SPIN);
  particle('images/ui/combat/energy_star_flash_glow.png', 512, 0.592157, FLASH_SCALE, FLASH_ALPHA, null);
  host.prepend(vfx);
  setTimeout(() => vfx.remove(), 1000);
}
const starShown = new WeakMap<any, boolean>();
function StarCounter({ pcs, regent, onLeave }: { pcs: any; regent: boolean; onLeave: (e: MouseEvent) => void }) {
  const stars = pcs.Stars;
  // RefreshVisibility: the Regent always; others from the first star on (for the rest of the combat)
  const shown = regent || stars > 0 || starShown.get(pcs);
  if (shown) starShown.set(pcs, true);
  const label = useRef<HTMLDivElement | null>(null), icon = useRef<HTMLDivElement>(null), gain = useRef<HTMLDivElement>(null);
  const rot = useRef<HTMLImageElement[]>([]);
  // _lerpingStarCount / _displayedStarCount start at 0; the hsv material at s 1, v 1
  const st = useRef({ lerp: 0, vel: { v: 0 }, shownN: 0, S: 1, V: 1, hsvTw: null as any });
  useEffect(() => {
    const s = st.current, ang = [0, 0];
    const setText = (n: number) => {
      if (n === s.shownN) return;
      s.shownN = n;
      if (label.current) label.current.textContent = String(n);
      [s.S, s.V] = n === 0 ? [0.5, 0.85] : [1, 1];
    };
    // OnStarsChanged → UpdateStarCount: a drop snaps, a gain flashes the icon (v 2 → 1 over 0.2 s) and spawns the VFX
    const changed = (was: number, now: number) => {
      if (now < was) { s.hsvTw?.Kill(); s.V = 1; s.lerp = now; setText(now); }
      else if (now > was) {
        s.hsvTw?.Kill();
        s.hsvTw = tween();
        s.hsvTw.TweenMethod((v: number) => { s.V = v; }, 2, 1, 0.2);
        starGain(gain.current);
      }
      invalidate();
    };
    pcs.StarsChanged = $.dcombine(pcs.StarsChanged, changed);
    const stop = $.onFrame((dt: number) => {
      const target = pcs.Stars, sp = target === 0 ? 5 : 30;
      rot.current.forEach((el, i) => { if (el) { ang[i] += dt * sp * (i + 1); el.style.transform = `rotate(${ang[i]}deg)`; } });
      s.lerp = smoothDamp(s.lerp, target, s.vel, 0.1, Math.max(dt, 1e-4));
      setText(Math.round(s.lerp));
      put(icon.current, 'filter', s.S === 1 ? `brightness(${s.V})` : `${hsvFilter(1, s.S, 1)} brightness(${s.V})`);
    });
    return () => { stop(); s.hsvTw?.Kill(); pcs.StarsChanged = $.dremove(pcs.StarsChanged, changed); };
  }, [pcs]);
  // Visible = false keeps the node (and a first gain's VFX, spawned before RefreshVisibility shows it)
  return (
    <div class="star-counter" style={{ top: `${regent ? 62 : 40}px`, display: shown ? '' : 'none' }}
      onMouseEnter={() => staticTip('STAR_COUNT', { singleStarIcon: '[img]res://images/packed/sprite_fonts/star_icon.png[/img]' }, 64 - 34, 868 - 300, 'lb')} onMouseLeave={onLeave}>
      <div class="star-gain" ref={gain} />
      <div class="star-icon" ref={icon}>
        <img src={imageUrl('images/ui/combat/energy_star.png') ?? ''} />
        <img src={imageUrl('images/ui/combat/energy_star_layer_2.png') ?? ''} ref={(el) => { if (el) rot.current[0] = el; }} />
        <img src={imageUrl('images/ui/combat/energy_star_layer_3.png') ?? ''} ref={(el) => { if (el) rot.current[1] = el; }} />
      </div>
      <div class="star-label" ref={(el) => { label.current = el; if (el) el.textContent = String(st.current.shownN); }} />
    </div>
  );
}

// ------------------------------------------------------------------ NClickableControl
/** Enable / Disable, hover → RefreshFocus → OnFocus / OnUnfocus, press / release (mouse while focused, or a hotkey). */
abstract class Clickable {
  isEnabled = false;
  hovered = false;
  focused = false;
  pressed = false;
  enable() { if (this.isEnabled) return; this.isEnabled = true; this.onEnable(); this.refreshFocus(); }
  disable() { if (!this.isEnabled) return; this.isEnabled = false; this.pressed = false; this.onDisable(); this.refreshFocus(); }
  hover(on: boolean) { this.hovered = on; this.refreshFocus(); }
  private refreshFocus() {
    const f = this.isEnabled && this.hovered;
    if (f === this.focused) return;
    this.focused = f;
    if (f) this.onFocus(); else this.onUnfocus();
  }
  mouse(down: boolean) { if (this.isEnabled && this.focused) { if (down) this.pressHandler(); else this.releaseHandler(); } }
  pressHandler() { this.pressed = true; this.onPress(); }
  releaseHandler() { if (!this.pressed) return; this.pressed = false; this.onRelease(); }
  /** NButton registers its hotkeys only while enabled: the press now, the release when the key comes up. */
  hotkey(): (() => void) | null {
    if (!this.isEnabled) return null;
    this.pressHandler();
    return () => { if (this.isEnabled) this.releaseHandler(); };
  }
  protected onEnable() {}
  protected onDisable() {}
  protected abstract onFocus(): void;
  protected abstract onUnfocus(): void;
  protected abstract onPress(): void;
  protected abstract onRelease(): void;
}

// ------------------------------------------------------------------ NEndTurnButton
const CREAM = [1, 0.964706, 0.886275], GRAY = [0.5, 0.5, 0.5], RED = [1, 1 / 3, 1 / 3], CYAN = [0, 1, 1], DARK_GRAY = [0.662745, 0.662745, 0.662745];
/** end_turn_button.tscn Label font_outline_color. */
const ETB_OUTLINE = [0.0756, 0.12084, 0.18];
const col = (c: number[]) => new $.Color(c[0], c[1], c[2], 1);
const longPressOn = () => safe(() => !!G.SaveManager.Instance.PrefsSave.IsLongPressEnabled, false);
function endTurnText(round: number, undo = false) {
  return safe(() => {
    const l = new G.LocString().$ctor_LocString('gameplay_ui', undo ? 'UNDO_END_TURN_BUTTON' : 'END_TURN_BUTTON');
    if (!undo) { if (l.Add$String_Decimal) l.Add$String_Decimal('turnNumber', round); else l.Add$String_String('turnNumber', String(round)); }
    return l.GetFormattedText();
  }, t('endTurn'));
}
/** NEndTurnLongPressBar: fills over a 0.5 s hold (then ends the turn and fades), drains at the same rate when let go. */
class LongPressBar {
  private timer = 0;
  private held = false;
  private live = true;
  private tw: any = null;
  A = 0;
  W = 0;
  C = [0.360784, 1, 0.980392];
  constructor(private btn: EndTurnCtl) {}
  startPress() { this.held = true; }
  cancelPress() { this.held = false; }
  process(dt: number) {
    if (!this.live) return;
    if (this.held) {
      this.timer += dt;
      if (this.timer > 0.5) {
        this.live = false;
        this.W = 204;
        this.timer = 0;
        this.btn.callReleaseLogic();
        this.tw?.Kill();
        this.tw = tween();
        this.tw.TweenProperty(this, 'a', 0, 0.25);
        this.tw.whenFinished(() => { this.C = [1, 0.85, 0.36]; this.held = false; this.live = true; });
      } else this.recalc();
    } else if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer < 0) { this.timer = 0; this.A = 0; } else this.recalc();
    }
  }
  private recalc() {
    const k = this.timer / 0.5, e = k * 0.75 - 1;
    this.W = k * 204;
    this.C = [k * 2.5, 0.6 + k, 0.6];
    this.A = e * e * e + 1; // Ease.CubicOut(k × 0.75)
  }
}
/**
 * States: Hidden (off-screen below), Enabled, Disabled (greyed). Shown and hidden by the turn events (TurnStarted,
 * AboutToSwitchToEnemyTurn, PlayerEndedTurn, CombatEnded); enabled only while the combat is the current screen and no
 * hand selection runs. The glow pulses while no hand card can be played.
 */
class EndTurnCtl extends Clickable {
  state: 'Enabled' | 'Disabled' | 'Hidden' = 'Hidden';
  text = '';
  /** Position.y, Visuals.position.y, the image's hsv v and modulate, the label's modulate, Glow / GlowVfx alpha and scale. */
  n = { PosY: 1096, VisualsY: 0, V: 1, ImageMod: col([1, 1, 1]), LabelMod: col([1, 1, 1]), GlowA: 0, GlowS: 0.5, GlowVfxA: 0, GlowVfxS: 0.5 };
  bar = new LongPressBar(this);
  private shiny = false;
  private tipShown = false;
  private noPlayableEnds = 0;
  private positionTw: any = null;
  private hoverTw: any = null;
  private glowVfxTw: any = null;
  private glowEnableTw: any = null;
  constructor(public view: any, public me: any) { super(); }
  private get cm() { return G.CombatManager.Instance; }
  private get hand() { return this.view.Ui?.Hand; }
  private ready() { return safe(() => this.cm.IsPlayerReadyToEndTurn(this.me), false); }
  /** CanTurnBeEnded: not while a card is being played or the hand is selecting. */
  private get canTurnBeEnded() { const h = this.hand; return !!h && !h.InCardPlay && h.mode === 1; }
  private canTakeAction(p: any) {
    const extra = safe(() => this.cm.PlayersTakingExtraTurn, null);
    return safe(() => p.Creature.IsAlive, false) && (!extra || extra.Count === 0 || extra.Contains(p));
  }
  private setText(s: string) { if (this.text !== s) { this.text = s; invalidate(); } }
  private removeTip() { if (this.tipShown) { this.tipShown = false; setTip(null); } }

  /** Subscribes to the turn events (and catches up if the view mounts mid-turn); returns the unsubscribe. */
  attach() {
    const cm = this.cm, tr = cm.StateTracker;
    const turn = (s: any) => this.onTurnStarted(s), hide = () => this.setState('Hidden');
    const ended = (p: any, back: boolean) => this.afterPlayerEndedTurn(p, back), unended = (p: any) => this.afterPlayerUnendedTurn(p);
    const changed = () => this.startOrStopPulseVfx();
    cm.TurnStarted = $.dcombine(cm.TurnStarted, turn);
    cm.AboutToSwitchToEnemyTurn = $.dcombine(cm.AboutToSwitchToEnemyTurn, hide);
    cm.PlayerEndedTurn = $.dcombine(cm.PlayerEndedTurn, ended);
    cm.PlayerUnendedTurn = $.dcombine(cm.PlayerUnendedTurn, unended);
    cm.CombatEnded = $.dcombine(cm.CombatEnded, hide); // NCombatUi.AnimOut → OnCombatEnded
    if (tr) tr.CombatStateChanged = $.dcombine(tr.CombatStateChanged, changed);
    // the room's web view can mount after the play phase began (the node itself lives for the whole combat)
    const cs = this.view.combatState;
    if (cm.IsInProgress && cm.IsPlayPhase && safe(() => cs.CurrentSide === G.CombatSide.Player, false)) {
      this.setText(endTurnText(cs.RoundNumber));
      this.state = !this.ready() && this.canTakeAction(this.me) ? 'Enabled' : 'Disabled';
      this.n.PosY = 846;
      this.refreshEnabled();
      this.startOrStopPulseVfx();
    }
    return () => {
      cm.TurnStarted = $.dremove(cm.TurnStarted, turn);
      cm.AboutToSwitchToEnemyTurn = $.dremove(cm.AboutToSwitchToEnemyTurn, hide);
      cm.PlayerEndedTurn = $.dremove(cm.PlayerEndedTurn, ended);
      cm.PlayerUnendedTurn = $.dremove(cm.PlayerUnendedTurn, unended);
      cm.CombatEnded = $.dremove(cm.CombatEnded, hide);
      if (tr) tr.CombatStateChanged = $.dremove(tr.CombatStateChanged, changed);
      for (const tw of [this.positionTw, this.hoverTw, this.glowVfxTw, this.glowEnableTw]) tw?.Kill();
      this.removeTip();
    };
  }
  private onTurnStarted(state: any) {
    if (state.CurrentSide !== G.CombatSide.Player || !this.cm.IsInProgress) return;
    this.setText(endTurnText(state.RoundNumber));
    if (this.canTakeAction(this.me)) { this.setState('Enabled'); return; }
    this.animIn();
    this.setState('Disabled');
  }
  private afterPlayerEndedTurn(player: any, canBackOut: boolean) {
    if (safe(() => G.LocalContext.IsMe$Player(player), true)) {
      this.startOrStopPulseVfx();
      if (!this.cm.AllPlayersReadyToEndTurn() && this.canTakeAction(this.me) && canBackOut) {
        this.setState('Enabled');
        this.setText(endTurnText(0, true));
      } else this.setState('Disabled');
    }
    if (this.cm.AllPlayersReadyToEndTurn()) this.setState('Disabled');
  }
  private afterPlayerUnendedTurn(player: any) {
    if (!safe(() => G.LocalContext.IsMe$Player(player), true) || !this.canTakeAction(player)) return;
    this.setState('Enabled');
    this.setText(endTurnText(player.Creature.CombatState.RoundNumber));
    this.startOrStopPulseVfx();
  }
  private hasPlayableCard() { return safe(() => [...$.iter(this.me.PlayerCombatState.Hand.Cards)].some((c: any) => c.CanPlay$0()), false); }
  private startOrStopPulseVfx() {
    const flag = !this.hasPlayableCard() && !this.ready() && this.state === 'Enabled', n = this.n;
    if (this.shiny) {
      if (flag) return;
      this.shiny = false;
      this.glowEnableTw?.Kill();
      this.glowEnableTw = tween().SetParallel();
      this.glowEnableTw.TweenProperty(n, 'glow_a', 0, 0.5).SetEase(OUT).SetTrans(EXPO);
      this.glowVfxTw?.Kill();
      this.glowVfxTw = tween();
      this.glowVfxTw.TweenProperty(n, 'glow_vfx_a', 0, 0.5).SetEase(OUT).SetTrans(EXPO);
    } else if (flag) {
      this.shiny = true;
      this.glowVfxTw?.Kill();
      this.glowPulse();
      this.glowEnableTw?.Kill();
      this.glowEnableTw = tween().SetParallel();
      this.glowEnableTw.TweenProperty(n, 'glow_a', 0.75, 0.8).SetEase(OUT).SetTrans(BACK);
      this.glowEnableTw.TweenProperty(n, 'glow_s', 0.5, 0.8).SetEase(OUT).SetTrans(BACK).From(0.45);
    }
  }
  /** GlowPulse: a looping (SetLoops) 1.5 s ring, scale 0.5 → 0.7 (quart out), alpha 0.4 → 0. */
  private glowPulse() {
    const tw = (this.glowVfxTw = tween().SetParallel());
    tw.TweenProperty(this.n, 'glow_vfx_s', 0.7, 1.5).From(0.5).SetEase(OUT).SetTrans(QUART);
    tw.TweenProperty(this.n, 'glow_vfx_a', 0, 1.5).From(0.4);
    tw.whenFinished(() => { if (this.glowVfxTw === tw) this.glowPulse(); });
  }
  private fadeGlow() {
    this.glowEnableTw?.Kill();
    this.glowEnableTw = tween().SetParallel();
    this.glowEnableTw.TweenProperty(this.n, 'glow_a', 0, 0.5).SetEase(OUT).SetTrans(EXPO);
  }
  protected onRelease() {
    if (this.shouldShowPlayableCardsFtue()) return;
    if (longPressOn()) this.bar.cancelPress();
    else this.callReleaseLogic();
  }
  callReleaseLogic() {
    if (!this.canTurnBeEnded) return;
    this.fadeGlow();
    const me = this.me, round = me.Creature.CombatState.RoundNumber, ready = this.ready();
    this.setState('Disabled');
    G.RunManager.Instance.ActionQueueSynchronizer.RequestEnqueue(ready
      ? new G.UndoEndPlayerTurnAction().$ctor_UndoEndPlayerTurnAction(me, round)
      : new G.EndPlayerTurnAction().$ctor_EndPlayerTurnAction(me, round));
    invalidate();
  }
  /** SecretEndTurnLogicViaFtue: the cannot-play tip's hidden hitbox ends the turn without the playable-cards check. */
  secretEndTurn() {
    this.fadeGlow();
    const me = this.me;
    G.RunManager.Instance.ActionQueueSynchronizer.RequestEnqueue(new G.EndPlayerTurnAction().$ctor_EndPlayerTurnAction(me, me.Creature.CombatState.RoundNumber));
    invalidate();
  }
  /** The first time a turn is ended with playable cards the tip shows instead; three ends without any retire it. */
  private shouldShowPlayableCardsFtue() {
    if (seenFtue('can_play_cards_ftue')) return false;
    const has = safe(() => this.me.PlayerCombatState.HasCardsToPlay(), false);
    if (has) void showFtue('can_play_cards_ftue', 'CAN_PLAY_CARDS_FTUE');
    else if (++this.noPlayableEnds === 3) G.SaveManager.Instance.MarkFtueAsComplete('can_play_cards_ftue');
    return has;
  }
  protected onEnable() {
    this.hoverTw?.CustomStep(999);
    this.n.ImageMod = col([1, 1, 1]);
    this.n.LabelMod = col(CREAM);
  }
  protected onDisable() {
    this.removeTip();
    this.hoverTw?.CustomStep(999);
    this.n.ImageMod = col(GRAY);
    this.n.LabelMod = col(GRAY);
    this.startOrStopPulseVfx();
  }
  private animOut() {
    this.hoverTw?.Kill();
    this.positionTw?.Kill();
    this.positionTw = tween();
    this.positionTw.TweenProperty(this.n, 'pos_y', 1096, 0.5).SetEase(OUT).SetTrans(EXPO);
  }
  private animIn() {
    this.positionTw?.Kill();
    this.positionTw = tween();
    this.positionTw.TweenProperty(this.n, 'pos_y', 846, 0.5).SetEase(OUT).SetTrans(BACK);
  }
  protected onFocus() {
    playOneShot('event:/sfx/ui/clicks/ui_hover');
    this.hoverTw?.Kill();
    this.n.V = 1.5;
    this.n.VisualsY = -2;
    if (!this.ready()) {
      this.n.LabelMod = col(safe(() => this.me.PlayerCombatState.HasCardsToPlay(), false) ? RED : CYAN);
      this.hand?.FlashPlayableHolders?.();
      staticTip('END_TURN', {}, fracX(1604 / 1920) - 76, fracY(this.n.PosY / 1080) - 302);
      this.tipShown = true;
    } else this.n.LabelMod = col(CREAM);
  }
  protected onUnfocus() {
    if (longPressOn()) this.bar.cancelPress();
    this.removeTip();
    this.hoverTw?.Kill();
    const tw = (this.hoverTw = tween().SetParallel());
    tw.TweenProperty(this.n, 'v', 1, 0.5).From(this.n.V).SetEase(OUT).SetTrans(EXPO);
    tw.TweenProperty(this.n, 'visuals_y', 0, 0.5).SetEase(OUT).SetTrans(EXPO);
    tw.TweenProperty(this.n, 'label_mod', col(this.isEnabled ? CREAM : GRAY), 0.5).SetEase(OUT).SetTrans(EXPO);
  }
  protected onPress() {
    if (!this.canTurnBeEnded) return;
    if (longPressOn()) this.bar.startPress();
    this.hoverTw?.Kill();
    const tw = (this.hoverTw = tween().SetParallel());
    tw.TweenProperty(this.n, 'v', 1, 0.5).From(this.n.V).SetEase(OUT).SetTrans(EXPO);
    tw.TweenProperty(this.n, 'visuals_y', 8, 0.5).SetEase(OUT).SetTrans(CUBIC);
    tw.TweenProperty(this.n, 'label_mod', col(DARK_GRAY), 0.5).SetEase(OUT).SetTrans(EXPO);
  }
  private setState(s: 'Enabled' | 'Disabled' | 'Hidden') {
    if (this.state === s) return;
    if (s === 'Hidden') this.animOut();
    if (s === 'Enabled' && this.state === 'Hidden') this.animIn();
    this.state = s;
    this.refreshEnabled();
  }
  private blocked() { return !combatIsCurrent() || !!this.hand?.IsInCardSelection; }
  /** RefreshEnabled (SetState, and NCombatUi.Enable / Disable whenever the active screen changes). */
  private refreshEnabled() { if (this.state === 'Enabled' && !this.blocked()) this.enable(); else this.disable(); }
  tick(dt: number) {
    this.bar.process(dt);
    if ((this.state === 'Enabled' && !this.blocked()) !== this.isEnabled) this.refreshEnabled();
  }
  paint(r: Record<string, HTMLElement | null>) {
    const n = this.n, m = n.LabelMod;
    // ShowPos / HidePos are ratios of the viewport's size (dev resolution 1920 × 1080)
    put(r.root, 'left', `${fracX(1604 / 1920)}px`);
    put(r.root, 'top', `${fracY(n.PosY / 1080)}px`);
    // state markers for the FTUE and the e2e tools (no styling hangs on them)
    r.root?.classList.toggle('shown', this.state !== 'Hidden');
    r.root?.classList.toggle('disabled', !this.isEnabled);
    put(r.visuals, 'top', `${n.VisualsY}px`);
    put(r.image, 'filter', `brightness(${n.V * n.ImageMod.R})`); // hsv v, then the grey modulate
    put(r.glow, 'opacity', String(n.GlowA));
    put(r.glow, 'scale', String(n.GlowS / 0.5));
    put(r.glowVfx, 'opacity', String(n.GlowVfxA));
    put(r.glowVfx, 'scale', String(n.GlowVfxS / 0.5));
    // the label's modulate tints its cream font colour and its outline
    put(r.label, 'color', rgb([CREAM[0] * m.R, CREAM[1] * m.G, CREAM[2] * m.B]));
    put(r.label, 'webkitTextStrokeColor', rgb([ETB_OUTLINE[0] * m.R, ETB_OUTLINE[1] * m.G, ETB_OUTLINE[2] * m.B]));
    // Bar (additive ColorRect, modulate alpha A) over its BarOutline child (black, 0.5 × the bar's alpha)
    const b = this.bar;
    put(r.barOutline, 'width', `${b.W + 10}px`);
    put(r.barOutline, 'opacity', String(0.5 * b.A));
    put(r.barFill, 'width', `${b.W}px`);
    put(r.barFill, 'background', rgb(b.C.map((c) => Math.min(1, c * b.A))));
  }
}
export const hud = { endTurn: null as EndTurnCtl | null, piles: {} as Partial<Record<PileKind, PileCtl>> };
/** E (MegaInput.accept) while the End Turn button is enabled: pressed now, released with the key. */
export const endTurnHotkey = () => hud.endTurn?.hotkey() ?? null;

export function EndTurnButton({ view, me }: { view: any; me: any }) {
  const ref = useRef<EndTurnCtl | null>(null);
  if (!ref.current || ref.current.me !== me || ref.current.view !== view) ref.current = new EndTurnCtl(view, me);
  const c = ref.current;
  const els = useRef<Record<string, HTMLElement | null>>({});
  const el = (k: string) => (e: HTMLElement | null) => { els.current[k] = e; };
  const label = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hud.endTurn = c;
    const detach = c.attach();
    const stop = $.onFrame((dt: number) => { c.tick(dt); c.paint(els.current); });
    return () => { stop(); detach(); if (hud.endTurn === c) hud.endTurn = null; };
  }, [c]);
  // MegaLabel SetTextAutoSize: one line, shrunk (30 → 8) to fit 162 × 72
  useFit(label, `etb|${c.text}`, 30, 8, (e) => (e.firstChild as HTMLElement).offsetWidth <= 162 && (e.firstChild as HTMLElement).offsetHeight <= 72);
  return (
    <div class="end-turn-btn" ref={el('root')}
      onPointerEnter={() => c.hover(true)} onPointerLeave={() => c.hover(false)}
      onPointerDown={(e) => { if (e.button === 0) c.mouse(true); }} onPointerUp={(e) => { if (e.button === 0) c.mouse(false); }}>
      <div class="etb-visuals" ref={el('visuals')}>
        <img class="etb-glow-vfx" ref={el('glowVfx')} src={imageUrl('images/packed/combat_ui/end_turn_button_glow.png') ?? ''} />
        <img class="etb-image" ref={el('image')} src={imageUrl('images/packed/combat_ui/end_turn_button.png') ?? ''} />
        <img class="etb-glow" ref={el('glow')} src={imageUrl('images/packed/combat_ui/end_turn_button_glow.png') ?? ''} />
        <div class="etb-label" ref={(e) => { label.current = e; els.current.label = e; }}><span>{c.text}</span></div>
      </div>
      {longPressOn() && <div class="etb-bar"><div class="etb-bar-outline" ref={el('barOutline')} /><div class="etb-bar-fill" ref={el('barFill')} /></div>}
    </div>
  );
}

// ------------------------------------------------------------------ NCombatCardPile
type PileKind = 'draw' | 'discard' | 'exhaust';
/** The count follows CardAddFinished (a card's flight reaching the pile) and CardRemoveFinished, not the model. */
const counts = new WeakMap<any, { n: number; bump: number }>();
const size = (pile: any) => pile.Cards.Count ?? pile.Cards.length;
function usePileCount(pile: any) {
  let c = counts.get(pile);
  if (!c) { c = { n: size(pile), bump: 0 }; counts.set(pile, c); }
  useEffect(() => {
    const add = () => { const x = counts.get(pile)!; x.n = Math.min(x.n + 1, size(pile)); x.bump++; invalidate(); };
    const rem = () => { const x = counts.get(pile)!; x.n = Math.max(x.n - 1, size(pile)); invalidate(); };
    pile.CardAddFinished = $.dcombine(pile.CardAddFinished, add);
    pile.CardRemoveFinished = $.dcombine(pile.CardRemoveFinished, rem);
    return () => { pile.CardAddFinished = $.dremove(pile.CardAddFinished, add); pile.CardRemoveFinished = $.dremove(pile.CardRemoveFinished, rem); };
  }, [pile]);
  return c;
}
const PILES = {
  draw: { rect: [15, 985], to: 'lb', hide: [-150, 100], img: 'draw_pile', tip: 'DRAW_PILE', tipAt: [14, -375], empty: 'OPEN_EMPTY_DRAW' },
  discard: { rect: [1826, 985], to: 'rb', hide: [150, 100], img: 'discard_pile', tip: 'DISCARD_PILE', tipAt: [-320, -370], empty: 'OPEN_EMPTY_DISCARD' },
  exhaust: { rect: [1830, 790], to: 'rb', hide: [150, 0], img: 'exhaust_pile', tip: 'EXHAUST_PILE', tipAt: [-320, -125], empty: '' },
};
/** NCombatUi.Enable / Disable: the pile buttons work while the combat is current, and during a hand selection only while peeking. */
const pilesEnabled = () => { const h = combatHand(); return combatIsCurrent() && (!h?.IsInCardSelection || !!h.select?.peeking); };
class PileCtl extends Clickable {
  /** Icon scale and modulate, count label scale. */
  n = { IconS: 1, IconM: 1, CountS: 1 };
  private tw: any = null;
  private tipShown = false;
  constructor(public kind: PileKind, public pile: any, public me: any) { super(); }
  protected onFocus() {
    const p = PILES[this.kind];
    staticTip(p.tip, {}, p.rect[0] + p.tipAt[0], p.rect[1] + p.tipAt[1], p.to);
    this.tipShown = true;
    this.tw?.Kill();
    this.tw = tween();
    this.tw.TweenProperty(this.n, 'icon_s', 1.25, 0.05);
  }
  protected onUnfocus() {
    if (this.tipShown) { this.tipShown = false; setTip(null); }
    this.tw?.Kill();
    this.tw = tween().SetParallel();
    this.tw.TweenProperty(this.n, 'icon_s', 1, 0.5).SetEase(OUT).SetTrans(EXPO);
    this.tw.TweenProperty(this.n, 'icon_m', 1, 0.5).SetEase(OUT).SetTrans(EXPO);
  }
  protected onPress() {
    this.tw?.Kill();
    this.tw = tween().SetParallel();
    this.tw.TweenProperty(this.n, 'icon_s', 1, 0.25).SetEase(OUT).SetTrans(CUBIC);
    this.tw.TweenProperty(this.n, 'icon_m', DARK_GRAY[0], 0.25).SetEase(OUT).SetTrans(CUBIC);
  }
  protected onRelease() {
    this.tw?.Kill();
    this.tw = tween();
    this.tw.TweenProperty(this.n, 'icon_s', this.focused ? 1.25 : 1, 0.05);
    this.tw.TweenProperty(this.n, 'icon_m', 1, 0.5).SetEase(OUT).SetTrans(EXPO);
    if (!G.CombatManager.Instance.IsInProgress) return;
    if (size(this.pile) === 0) {
      // NExhaustPileButton sets no _emptyPileMessage (GetFormattedText throws): nothing shows
      const key = PILES[this.kind].empty;
      if (!key) return;
      closeCardsView();
      const text = safe(() => new G.LocString().$ctor_LocString('combat_messages', key).GetFormattedText(), '');
      const child = N('Vfx.NThoughtBubbleVfx').Create(text, this.me.Creature, 2);
      safe(() => G.GodotTreeExtensions.AddChildSafely(N('Rooms.NCombatRoom').Instance?.CombatVfxContainer, child), null);
    } else if (ui.cardsView?.kind === this.kind) closeCardsView();
    else toggleCardsView(this.kind);
    invalidate();
  }
  /** AddCard: icon and label pop to 1.25 and settle (0.5 s expo out). */
  bump() {
    this.tw?.Kill();
    this.tw = tween().SetParallel();
    this.n.IconS = 1.25;
    this.tw.TweenProperty(this.n, 'icon_s', 1, 0.5).SetEase(OUT).SetTrans(EXPO);
    this.n.CountS = 1.25;
    this.tw.TweenProperty(this.n, 'count_s', 1, 0.5).SetEase(OUT).SetTrans(EXPO);
  }
  kill() { this.tw?.Kill(); if (this.tipShown) setTip(null); }
}
/** Hotkeys A / S / X: the pile button's press and release; with that pile's screen open, its release closes it. */
export function pileHotkey(kind: PileKind): (() => void) | null {
  if (ui.cardsView) return ui.cardsView.kind === kind ? () => { closeCardsView(); invalidate(); } : null;
  return hud.piles[kind]?.hotkey() ?? null;
}
export function PileButton({ kind, pile, me, out }: { kind: PileKind; pile: any; me: any; out: boolean }) {
  const p = PILES[kind];
  const c = usePileCount(pile);
  const ref = useRef<PileCtl | null>(null);
  if (!ref.current || ref.current.pile !== pile) ref.current = new PileCtl(kind, pile, me);
  const ctl = ref.current;
  const icon = useRef<HTMLImageElement>(null), count = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hud.piles[kind] = ctl;
    const bump = () => ctl.bump();
    pile.CardAddFinished = $.dcombine(pile.CardAddFinished, bump);
    const stop = $.onFrame(() => {
      const en = pilesEnabled();
      if (en !== ctl.isEnabled) { if (en) ctl.enable(); else ctl.disable(); }
      put(icon.current, 'transform', `scale(${ctl.n.IconS})`);
      put(icon.current, 'filter', ctl.n.IconM < 1 ? `brightness(${ctl.n.IconM})` : '');
      put(count.current, 'transform', `scale(${ctl.n.CountS})`);
    });
    return () => { stop(); ctl.kill(); pile.CardAddFinished = $.dremove(pile.CardAddFinished, bump); if (hud.piles[kind] === ctl) delete hud.piles[kind]; };
  }, [ctl]);
  // MegaLabel SetTextAutoSize: 26 → 20 in the 24 × 100 label (the exhaust count 32 → 20 in 38 × 100)
  const w = kind === 'exhaust' ? 38 : 24;
  useFit(count, `pc${w}|${c.n}`, kind === 'exhaust' ? 32 : 26, 20, (el) => (el.firstChild as HTMLElement).offsetWidth <= w && (el.firstChild as HTMLElement).offsetHeight <= 100);
  // the exhaust pile shows up with its first card and stays for the rest of the combat
  const visible = kind !== 'exhaust' || c.n > 0 || c.bump > 0;
  const [x, y] = anchored(p.rect[0], p.rect[1], p.to); // combat_piles_container.tscn: the screen's bottom corners
  return (
    <div class={'pile-btn ' + kind + (out ? ' out' : '')} style={{ left: `${x}px`, top: `${y}px`, '--hx': `${p.hide[0]}px`, '--hy': `${p.hide[1]}px`, display: visible ? '' : 'none' } as any}
      onPointerEnter={() => ctl.hover(true)} onPointerLeave={() => ctl.hover(false)}
      onPointerDown={(e) => { if (e.button === 0) ctl.mouse(true); }} onPointerUp={(e) => { if (e.button === 0) ctl.mouse(false); }}>
      <img class="pile-icon" ref={icon} src={imageUrl(`images/packed/combat_ui/${p.img}.png`) ?? ''} />
      {kind === 'exhaust'
        ? <div class="pile-count exhaust" ref={count}><span>{c.n}</span></div>
        : <div class="pile-badge"><img src={imageUrl('images/packed/combat_ui/pile_button_count.png') ?? ''} /><div class="pile-count" ref={count}><span>{c.n}</span></div></div>}
    </div>
  );
}
