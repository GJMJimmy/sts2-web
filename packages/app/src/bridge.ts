// Bridge: web implementations of the Godot scene nodes the rule layer talks to (NRun, rooms, screens, selectors).
// Each view extends the generated stub so every member we do not implement stays an inert default.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { G, $, N, list } from './game';
import * as audio from './audio';
import { ui, invalidate, pushOverlay, popOverlay, hideBackstop, showBackstop } from './store';
import { loc, locv } from './i18n';
import { recordDailyScore } from './daily';
import { createCombatNodes, targetManager, creatureViewsRef, GlobalUiView, type CombatUiView, type ContainerNode } from './cardnodes';
import { layoutCreatures, deathAnimRemaining, activeStage, visualsKey } from './render/stage';
import { spineIndex } from './assets';
import { transitionView } from './ui/transition';
import { seenFtue, showFtue } from './ui/ftue';
import { logicalRect, setTips, setTip, hoverTipsOf } from './ui/tooltip';
import { closePauseMenu } from './ui/pause';
import { spawnCombatBanner } from './ui/banners';
import { openChest, chestSkin, chestGold, playSpriteVfx, extinguishRestFire } from './render/scene';
import { playCombatVfx, playItemThrow } from './render/cardfx';
import { screenShake, screenRumble, screenShakeTrauma, hitStop } from './ui/screenshake';
import { OrbManagerView } from './ui/orbs';
import { setMap, openMap, closeMap, isMapVisible, setTravelEnabled, setDebugTravelEnabled, mapTraveling, initMarker, travelToMapCoord, spawnActBanner } from './ui/map';

const NRun = N('NRun');
const NCombatRoom = N('Rooms.NCombatRoom');
const NCreature = N('Combat.NCreature');
const NMapScreen = N('Screens.Map.NMapScreen');
const NRewardsScreen = N('Screens.NRewardsScreen');
const NCardRewardSelectionScreen = N('Screens.CardSelection.NCardRewardSelectionScreen');
const NChooseACardSelectionScreen = N('Screens.CardSelection.NChooseACardSelectionScreen');
const NChooseABundleSelectionScreen = N('Screens.CardSelection.NChooseABundleSelectionScreen');
const NEventRoom = N('Rooms.NEventRoom');
const NRestSiteRoom = N('Rooms.NRestSiteRoom');
const NMerchantRoom = N('Rooms.NMerchantRoom');
const NTreasureRoom = N('Rooms.NTreasureRoom');
const NMapRoom = N('Rooms.NMapRoom');
const NOverlayStack = N('Screens.Overlays.NOverlayStack');
const NCardHolder = N('Cards.Holders.NCardHolder');
const NCard = N('Cards.NCard');

const NGame = N('NGame');
const tcs = () => new $.TaskCompletionSource();
const log = (...a: any[]) => console.debug('[bridge]', ...a);
const safeGet = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };

// ------------------------------------------------------------------ run & rooms
export class RunView extends NRun {
  /** NGlobalUi: card previews outside combat, the top bar's deck button and trail container. */
  GlobalUi = new GlobalUiView();
  constructor(public runState: any) { super(); }
  get MerchantRoom() { return ui.room?.kind === 'shop' ? ui.room : null; }
  SetCurrentRoom(node: any) {
    // NCombatRoom.Instance lives as long as a combat room is on screen (combat-layout events embed one)
    const prev = NCombatRoom.Instance;
    if (node?.kind !== 'combat') NCombatRoom.Instance = node?.combat ?? null;
    if (prev && prev !== NCombatRoom.Instance && prev !== node) prev.dispose?.();
    // the old room's nodes are freed with it: its speech bubbles, and a custom event's scene (its event's Node)
    const old = ui.room as any;
    if (old && old !== node) {
      bubbles.length = 0;
      if (old.custom && old.event?.Node === old.custom) old.event.Node = null;
    }
    ui.room = node;
    ui.live = node?.kind === 'combat';
    invalidate();
  }
  /** NRun.ShowGameOverScreen: the capstone and the map close; NGameOverScreen goes on the overlay stack. */
  ShowGameOverScreen(serializableRun: any) {
    closePauseMenu();
    safeGet(() => NMapScreen.Instance?.Close(false), undefined);
    ui.gameOver = { serializableRun, runState: this.runState, victory: false };
    pushOverlay({ kind: 'gameover', g: ui.gameOver, UseSharedBackstop: false });
    invalidate();
  }
}

/**
 * NIntent (ui/creature-ui.tsx draws it): the intent it shows and its targets (UpdateIntent), whether it is frozen (no
 * refresh on combat-state changes), its bob's time offset (radians) and its last PlayPerform (the particle burst).
 */
export interface IntentNode { intent: any; targets: any; frozen: boolean; offset: number; perform: number; anim?: string; label?: string; tex?: string | null }
const isInstant = () => safeGet(() => G.SaveManager.Instance.PrefsSave.FastMode === G.FastModeType.Instant, false);

/** Visual stand-in for NCreature: records animation requests for the Pixi stage; hover and the selection reticle. */
export class CreatureView extends NCreature {
  anims: string[] = [];
  flash = 0;
  IsFocused = false;
  /** The creature's DOM overlay (ui/creature-ui.tsx CreatureOverlay): Controls under the node (NSovereignBladeVfx's %Hitbox) go in it. */
  overlay: HTMLElement | null = null;
  /** NSelectionReticle.IsSelected (the four corner brackets around the hitbox). */
  reticle = false;
  private multi = false;
  /** _EnterTree: the creature's power events, its powers' Flashed (and their NPower's events), CombatEnded. */
  constructor(public creature: any) {
    super();
    creature.PowerIncreased = $.dcombine(creature.PowerIncreased, this.onPowerIncreased);
    creature.PowerApplied = $.dcombine(creature.PowerApplied, this.onPowerApplied);
    creature.PowerRemoved = $.dcombine(creature.PowerRemoved, this.onPowerRemoved);
    for (const p of list(creature.Powers)) this.subscribeToPower(p);
    const cm = G.CombatManager.Instance;
    cm.CombatEnded = $.dcombine(cm.CombatEnded, this.onCombatEnded);
    cm.StateTracker.CombatStateChanged = $.dcombine(cm.StateTracker.CombatStateChanged, this.onCombatStateChanged);
  }
  /** _ExitTree (the combat room is going away, or the removed node is freed): stop listening (players outlive the room). */
  detach() {
    const c = this.creature, cm = G.CombatManager.Instance;
    c.PowerIncreased = $.dremove(c.PowerIncreased, this.onPowerIncreased);
    c.PowerApplied = $.dremove(c.PowerApplied, this.onPowerApplied);
    c.PowerRemoved = $.dremove(c.PowerRemoved, this.onPowerRemoved);
    for (const p of [...this.powerSubs.keys()]) this.unsubscribeFromPower(p);
    cm.CombatEnded = $.dremove(cm.CombatEnded, this.onCombatEnded);
    cm.StateTracker.CombatStateChanged = $.dremove(cm.StateTracker.CombatStateChanged, this.onCombatStateChanged);
  }
  /** NCreature.OnPowerIncreased: NPowerAppliedVfx and the buff / debuff sound; a debuff shakes the body (AnimShake). */
  shakeAt = 0;
  private onPowerIncreased = (power: any, amount: number, silent: boolean) => {
    if (silent || !G.CombatManager.Instance.IsInProgress) return;
    const buff = safeGet(() => power.GetTypeForAmount(amount) === G.PowerType.Buff, true);
    if (power.ShouldPlayVfx && !G.TestMode.IsOn) {
      const p = this.VfxSpawnPosition;
      addPowerPop({ kind: 'applied', x: p.X, y: p.Y, icon: bigIcon(power), title: safeGet(() => power.Title.GetFormattedText(), ''), buff }, 1300);
      audio.playOneShot(buff ? 'event:/sfx/buff' : 'event:/sfx/debuff');
    }
    if (safeGet(() => power.GetTypeForAmount(power.Amount) === G.PowerType.Debuff, false) && performance.now() - this.shakeAt > 1000) this.shakeAt = performance.now();
  };
  // ---------------------------------------------- powers: NCreature's Flashed / PowerRemoved VFX, NPower's own events
  /** NPower.FlashPower (its one-shot PowerFlash particle, 1 s: a new flash waits for the running one) and pulse, per power. */
  iconFlash = new Map<any, number>();
  pulsing = new Set<any>();
  private powerSubs = new Map<any, { flashed: () => void; amount: () => void; on: () => void; off: () => void }>();
  private onPowerApplied = (p: any) => this.subscribeToPower(p);
  private subscribeToPower(p: any) {
    if (this.powerSubs.has(p)) return;
    const s = {
      flashed: () => { this.flashIcon(p); this.onPowerFlashed(p); },
      amount: () => this.flashIcon(p),
      on: () => { this.pulsing.add(p); invalidate(); },
      off: () => { this.pulsing.delete(p); invalidate(); },
    };
    this.powerSubs.set(p, s);
    p.Flashed = $.dcombine(p.Flashed, s.flashed);
    p.DisplayAmountChanged = $.dcombine(p.DisplayAmountChanged, s.amount);
    p.PulsingStarted = $.dcombine(p.PulsingStarted, s.on);
    p.PulsingStopped = $.dcombine(p.PulsingStopped, s.off);
  }
  private unsubscribeFromPower(p: any) {
    const s = this.powerSubs.get(p);
    if (!s) return;
    this.powerSubs.delete(p);
    p.Flashed = $.dremove(p.Flashed, s.flashed);
    p.DisplayAmountChanged = $.dremove(p.DisplayAmountChanged, s.amount);
    p.PulsingStarted = $.dremove(p.PulsingStarted, s.on);
    p.PulsingStopped = $.dremove(p.PulsingStopped, s.off);
  }
  private flashIcon(p: any) {
    const now = performance.now();
    if (now - (this.iconFlash.get(p) ?? -1e9) < 1000) return;
    this.iconFlash.set(p, now);
    invalidate();
  }
  /** OnPowerFlashed → NPowerFlashVfx at VfxSpawnPosition (powers that play VFX). */
  private onPowerFlashed(p: any) {
    if (G.TestMode.IsOn || !safeGet(() => p.ShouldPlayVfx, false)) return;
    const at = this.VfxSpawnPosition;
    addPowerPop({ kind: 'flash', x: at.X, y: at.Y, icon: bigIcon(p), title: '', buff: true }, 1050);
  }
  /** OnPowerRemoved → NPowerRemovedVfx ("Wears Off") at the top of the hitbox; NPower stops listening. */
  private onPowerRemoved = (p: any) => {
    if (!G.TestMode.IsOn && safeGet(() => p.ShouldPlayVfx, false)) {
      const at = this.GetTopOfHitbox();
      const wears = safeGet(() => new G.LocString().$ctor_LocString('vfx', 'POWER_WEARS_OFF').GetRawText(), '');
      addPowerPop({ kind: 'removed', x: at.X, y: at.Y, icon: bigIcon(p), title: safeGet(() => p.Title.GetFormattedText(), ''), buff: true, sub: wears }, 1750);
    }
    this.unsubscribeFromPower(p);
    this.pulsing.delete(p);
  };
  get Entity() { return this.creature; }
  // ---------------------------------------------- focus and hover tips
  /** NCreature.OnFocus: the nameplate; while targeting the target manager takes the hover, else the creature's tips
   *  (re-shown on every combat-state change until unfocused). */
  OnFocus() {
    if (this.IsFocused) return;
    this.IsFocused = true;
    invalidate();
    if (targetManager.IsInSelection) { targetManager.OnNodeHovered(this); return; }
    this.ShowHoverTips(this.creature.HoverTips);
    this.tipSubs.add(this.showCreatureTips);
  }
  OnUnfocus() {
    this.IsFocused = false;
    this.HideSingleSelectReticle();
    invalidate();
    targetManager.OnNodeUnhovered(this);
    this.tipSubs.delete(this.showCreatureTips);
    this.HideHoverTips();
  }
  /** NCreature.OnTargetingStarted: a focused creature becomes the hovered target; its tips go. */
  OnTargetingStarted() {
    if (!this.IsFocused) return;
    targetManager.OnNodeHovered(this);
    this.tipSubs.delete(this.showCreatureTips);
    this.HideHoverTips();
  }
  /** CombatStateChanged subscribers: ShowCreatureHoverTips (OnFocus) and NPower.ShowPowerHoverTips (a hovered power). */
  tipSubs = new Set<() => void>();
  private showCreatureTips = () => { if (this.creature.CombatState != null) this.ShowHoverTips(this.creature.HoverTips); };
  private onCombatStateChanged = () => {
    // NTargetManager.StartTargeting → OnTargetingStarted (the web target manager does not call it)
    if (targetManager.IsInSelection && this.tipSubs.has(this.showCreatureTips)) this.OnTargetingStarted();
    for (const f of [...this.tipSubs]) f();
  };
  /** ShowHoverTips: not during a card play; the set is owned by the hitbox, aligned by GetHoverTipAlignment. */
  ShowHoverTips(tips: any) {
    if (safeGet(() => NCombatRoom.Instance.Ui.Hand.InCardPlay, false)) return;
    this.HideHoverTips();
    const s = this.slot;
    if (!s) return;
    setTips(hoverTipsOf({ HoverTips: tips }), { kind: 'align', rect: [s.x + s.bl, s.y + s.bt, s.w, s.h], align: s.x > 960 ? 'left' : 'right' });
  }
  HideHoverTips() { setTip(null); }
  ShowMultiselectReticle() { this.multi = true; this.ShowSingleSelectReticle(); }
  HideMultiselectReticle() { this.multi = false; this.HideSingleSelectReticle(); }
  ShowSingleSelectReticle() { if (!this.reticle) { this.reticle = true; invalidate(); } }
  HideSingleSelectReticle() { if (!this.multi && this.reticle) { this.reticle = false; invalidate(); } }
  /** NCreature.OrbManager: players only (ui/orbs.tsx). */
  private orbView: OrbManagerView | null = null;
  get OrbManager() { return this.creature.IsPlayer ? (this.orbView ??= new OrbManagerView(this.creature)) : null; }
  /** NCreature.IsInteractable (ToggleIsInteractable: e.g. a dead Osty). */
  IsInteractable = true;
  /** Hitbox.MouseFilter: Stop, or Ignore once AnimDie starts / while not interactable (a mouse over it then leaves). */
  HitboxOn = true;
  private setHitbox(on: boolean) {
    this.HitboxOn = on;
    if (!on && this.IsFocused) this.OnUnfocus();
    invalidate();
  }
  ToggleIsInteractable(on: boolean) { this.IsInteractable = !!on; this.setHitbox(!!on); }
  /** NHealthBar._blockTrackingCreature (OstyCmd: Osty's bar shows its summoner's block as its own). */
  blockTracking: any = null;
  TrackBlockStatus(c: any) { this.blockTracking = c; invalidate(); }
  get slot() { const cs = NCombatRoom.Instance?.combatState; return cs ? layoutCreatures(cs).get(this.creature) : null; }
  /** The creature's feet (NCreature's origin). */
  get GlobalPosition() { const s = this.slot; return s ? new $.Vector2(s.x, s.y) : new $.Vector2(960, 540); }
  /** Moves the rule layer makes (SandpitPower drags creatures toward The Insatiable): kept as a screen offset on top of
   *  the room layout (render/stage.ts withNodeState adds it). */
  PosOffset = { X: 0, Y: 0 };
  set GlobalPosition(v: any) {
    const s = this.slot;
    if (!s) return;
    this.PosOffset = { X: this.PosOffset.X + (v.X - s.x), Y: this.PosOffset.Y + (v.Y - s.y) };
    invalidate();
  }
  /** GetBottomOfHitbox / GetTopOfHitbox: the hitbox (the visuals' bounds) centre bottom / top. */
  GetBottomOfHitbox() { const s = this.slot; return s ? new $.Vector2(s.x + s.bl + s.w / 2, s.y + s.bt + s.h) : new $.Vector2(960, 540); }
  GetTopOfHitbox() { const s = this.slot; return s ? new $.Vector2(s.x + s.bl + s.w / 2, s.y + s.bt) : new $.Vector2(960, 540); }
  /** NCreatureVisuals.VfxSpawnPosition (the %CenterPos marker). */
  get VfxSpawnPosition() {
    const cs = NCombatRoom.Instance?.combatState, s = cs ? layoutCreatures(cs).get(this.creature) : null;
    if (!s) return new $.Vector2(960, 540);
    const c = spineIndex[`scenes/creature_visuals/${String(this.creature.Player?.Character?.Id?.Entry ?? this.creature.Monster?.Id?.Entry ?? '').toLowerCase()}.tscn`]?.centerPos;
    return new $.Vector2(s.x + (c?.[0] ?? 0) * s.s, s.y + (c?.[1] ?? -s.h / s.s / 2) * s.s);
  }
  /** The stage's CreatureAnimator hook once the body has loaded: triggers then run at once, as in NCreature
   *  (animator conditions read the model's state now); before that they queue for the stage. */
  onTrigger: ((t: string) => void) | null = null;
  SetAnimationTrigger(trigger: string) {
    if (this.onTrigger) this.onTrigger(String(trigger));
    else this.anims.push(String(trigger));
    invalidate();
  }
  /** NCreature.StartDeathAnim: the intents freeze; the death sfx and "Dead" trigger (spine bodies); AnimDie hides the
   *  intents of a creature leaving the combat. Returns the die length for AfterDeath. */
  private dying = false;
  StartDeathAnim(shouldRemove = false) {
    for (const n of this.intents) n.frozen = true;
    if (this.dying) return 0;
    // a death animation already running (DoomPower's NDoomVfx, render/vfx-misc) plays instead
    if (this.DeathAnimationTask?.IsCompleted === false) return 0;
    this.dying = true;
    this.setHitbox(false);
    const m = this.creature.Monster, p = this.creature.Player;
    let a = 0;
    if (spineIndex[`scenes/creature_visuals/${String(p?.Character?.Id?.Entry ?? m?.Id?.Entry ?? '').toLowerCase()}.tscn`]?.spine) {
      if (m?.HasDeathSfx) audio.playOneShot(m.DeathSfx);
      if (p) audio.playOneShot(p.Character.DeathSfx);
      this.SetAnimationTrigger('Dead');
      a = activeStage?.dieLength(this.creature) ?? 0;
    }
    if (shouldRemove) this.AnimHideIntent();
    if (m?.HasDeathAnimLengthOverride) return m.DeathAnimLengthOverride;
    return Math.min(a, 30);
  }
  /** NCreature.StartReviveAnim: the animator's Revive (or, for players, AnimTempRevive); the UI comes back (CSS). */
  StartReviveAnim() { this.dying = false; this.SetAnimationTrigger('Revive'); this.setHitbox(true); }
  // ---------------------------------------------- IntentContainer
  /** The NIntent children, IntentContainer.Modulate.a (creature.tscn: 0) and the element that shows it. */
  intents: IntentNode[] = [];
  IntentA = 0;
  intentEl: HTMLElement | null = null;
  private intentFadeTween: any = null;
  private paintIntents = () => { if (this.intentEl) this.intentEl.style.opacity = String(this.IntentA); };
  /** UpdateIntent: NextMove's intents into the NIntent children (reused in order, unfrozen; new ones bob from
   *  GetHashCode / 100 + i · 0.3; extra ones freed). */
  UpdateIntent(targets: any) {
    const intents = list(this.creature.Monster.NextMove.Intents), ts = list(targets);
    const base = Math.random() * 2 * Math.PI; // ponytail: GetHashCode() / 100 is an arbitrary per-node phase
    this.intents = intents.map((intent: any, i: number) => {
      const n: IntentNode = this.intents[i] ?? { intent, targets: ts, frozen: false, offset: base + i * 0.3, perform: 0 };
      n.intent = intent; n.targets = ts; n.frozen = false;
      return n;
    });
    invalidate();
    return $.Task.CompletedTask;
  }
  /** RefreshIntents: UpdateIntent for the players, then RevealIntents (transparent, 1 s fade in after 0–0.3 s). */
  RefreshIntents() {
    this.UpdateIntent(list(this.creature.CombatState.Players).map((p: any) => p.Creature));
    this.IntentA = 0;
    this.paintIntents();
    this.fadeIntents(1, 1, G.Rng.Chaotic.NextFloat$2(0, 0.3));
    return $.Task.CompletedTask;
  }
  /** PerformIntent: each intent's particle burst, frozen; the row fades out (0.5 s after 0.4 s) while the turn waits. */
  PerformIntent() {
    const now = performance.now();
    for (const n of this.intents) { n.perform = now; n.frozen = true; }
    invalidate();
    if (isInstant()) { this.IntentA = 0; this.paintIntents(); return $.Task.CompletedTask; }
    this.AnimHideIntent(0.4);
    return G.Cmd.CustomScaledWait(0.25, 0.4);
  }
  AnimHideIntent(delay = 0) { this.fadeIntents(0, 0.5, delay); }
  private fadeIntents(to: number, dur: number, delay: number) {
    this.intentFadeTween?.Kill();
    const t = (this.intentFadeTween = new $.WebTween().SetParallel());
    const tw = t.TweenProperty(this, 'intent_a', to, dur);
    if (delay > 0) tw.SetDelay(delay);
    $.onFrame(() => { this.paintIntents(); return t.IsValid(); });
    t.whenFinished(this.paintIntents);
  }
  /** OnCombatEnded: AnimHideIntent (the orbs are cleared by the bridge's CombatEnded handler). */
  private onCombatEnded = () => this.AnimHideIntent();
  get HasSpineAnimation() { return true; }

  // ---------------------------------------------- NCreature.ScaleTo / SetDefaultScaleTo / OstyScaleToSize / SetScaleAndHue
  /** Visuals.Scale, NCreatureVisuals.DefaultScale and the hsv hue RandomizeEnemyScalesAndHues gives the body. */
  VisScale = 1;
  DefaultScale = 1;
  Hue = 0;
  /** UpdateBounds: the hitbox follows Bounds × Visuals.Scale / _tempScale (after OstyScaleToSize and SetScaleAndHue). */
  BoundsScale = 1;
  /** Osty's offset lerp weight (GetOstyOffsetFromPlayer: MaxHp / 150), tweened with its position. */
  OstyK: number | null = null;
  private tempScale = 1;
  private scaleTween: any = null;
  private tween() { const t = new $.WebTween(); $.onFrame(() => { invalidate(); return t.IsValid(); }); return t; }
  ScaleTo(size: number, duration: number) {
    if (this.creature.IsMonster && !safeGet(() => this.creature.Monster.CanChangeScale, true)) return;
    this.tempScale = size;
    this.scaleTween?.Kill();
    // ponytail: DoScaleTween's OrbManager scale (lerp to 1 by ½ below scale 1) is not applied to the orbs
    (this.scaleTween = this.tween()).TweenProperty(this, 'vis_scale', size * this.DefaultScale, duration).SetEase(2).SetTrans(1);
  }
  SetDefaultScaleTo(size: number, duration: number) {
    if (this.creature.IsMonster && !safeGet(() => this.creature.Monster.CanChangeScale, true)) return;
    this.DefaultScale = size;
    this.ScaleTo(this.tempScale, duration);
  }
  /** Osty.ScaleRange (1, 2) by health / 150; the local player's Osty also moves to its owner + GetOstyOffsetFromPlayer. */
  OstyScaleToSize(ostyHealth: number, duration: number) {
    const k = (v: number) => Math.min(Math.max(v / 150, 0), 1);
    const t = (this.scaleTween = this.tween());
    t.TweenProperty(this, 'vis_scale', (1 + k(ostyHealth)) * this.DefaultScale, duration).SetEase(2).SetTrans(1);
    if (safeGet(() => G.LocalContext.IsMe$Player(this.creature.PetOwner), false)) {
      this.OstyK ??= k(this.creature.MaxHp);
      t.Parallel().TweenProperty(this, 'osty_k', k(this.creature.MaxHp), duration);
    }
    t.TweenCallback(() => { this.BoundsScale = this.VisScale / this.tempScale; });
  }
  SetScaleAndHue(scale: number, hue: number) {
    this.DefaultScale = scale;
    this.VisScale = scale;
    this.Hue = hue;
    this.BoundsScale = this.VisScale / this.tempScale;
    invalidate();
  }
}

export class CombatRoomView extends NCombatRoom {
  kind = 'combat';
  /** NCreatureStateDisplay: creatures present in the room's first second animate in after a delay. */
  createdAt = performance.now();
  creatures = new Map<any, CreatureView>();
  private nodes = createCombatNodes();
  constructor(public room: any, public mode: number) {
    super();
    // a raw scene instance added to CombatVfxContainer (PackedScene.Instantiate stamps its SceneFilePath:
    // DecimillipedeSegment's rocks) plays there like VfxCmd.PlayVfx once its GlobalPosition is set
    const vfx = this.nodes.vfx, add = vfx.AddChild.bind(vfx);
    vfx.AddChild = (c: any) => {
      const path = c && !('$kids' in c) ? c.SceneFilePath : null;
      if (!path) { add(c); return; }
      let at = new $.Vector2(0, 0);
      Object.defineProperty(c, 'GlobalPosition', { configurable: true, get: () => at, set: (v: any) => { at = v; if (!G.TestMode.IsOn) playCombatVfx(path, v.X, v.Y); } });
    };
    // _Ready: CreateAllyNodes, and CreateEnemyNodes unless the combat is already finished (events look them up at once)
    for (const c of list(safeGet(() => room.Allies, []))) this.GetCreatureNode(c);
    if (mode !== G.CombatRoomMode.FinishedCombat) {
      for (const c of list(safeGet(() => room.Enemies, []))) this.GetCreatureNode(c);
      this.randomizeEnemyScalesAndHues();
    }
  }
  /** RandomizeEnemyScalesAndHues: several enemies of one type get 1 + (their HP roll) × 10–15 % scale and a random hue. */
  private randomizeEnemyScalesAndHues() {
    const groups = new Map<any, CreatureView[]>();
    for (const v of this.creatures.values()) {
      const m = v.creature.Monster;
      if (v.creature.Side === G.CombatSide.Player || !m) continue;
      const g = groups.get(m.constructor) ?? [];
      g.push(v);
      groups.set(m.constructor, g);
    }
    for (const g of groups.values()) {
      if (g.length === 1) continue;
      for (const v of g) {
        const m = v.creature.Monster, hp = Number(v.creature.MonsterMaxHpBeforeModification);
        const roll = m.MaxInitialHp !== m.MinInitialHp ? ((hp - m.MinInitialHp) / (m.MaxInitialHp - m.MinInitialHp) - 0.5) * 2 : 0;
        const b = spineIndex[visualsKey(v.creature)]?.bounds ?? [0, 0, 240, 280];
        const amount = Math.min(Math.max((Math.max(b[2], b[3]) - 250) / (100 - 250), 0), 1);
        v.SetScaleAndHue(1 + Math.min(Math.max(roll, 0), 1) * (0.1 + (0.15 - 0.1) * amount), G.Rng.Chaotic.NextFloat$1(0.05));
      }
    }
  }
  /** NCombatUi: hand, play queue, play container and the piles' positions. */
  get Ui(): CombatUiView { return this.nodes.ui; }
  /** Flying cards and their trails pass under the combat UI. */
  get CombatVfxContainer(): ContainerNode { return this.nodes.vfx; }
  dispose() { this.nodes.ui.destroy(); this.nodes.vfx.QueueFree(); for (const v of [...this.creatures.values(), ...this.removingNodes.values()]) v.detach(); }
  // a CombatRoom, or (combat-layout events) an ICombatRoomVisuals with just Encounter/Allies/Enemies/Act
  get combatState() { return this.room?.CombatState ?? this.room; }
  GetCreatureNode(c: any) {
    if (!c) return null;
    let v = this.creatures.get(c);
    if (!v) {
      this.creatures.set(c, (v = new CreatureView(c)));
      // AddCreature: the local player's Osty takes its size and place at once
      if (G.TestMode.IsOff && c.Monster instanceof G.Osty && safeGet(() => G.LocalContext.IsMe$Player(c.PetOwner), false)) v.OstyScaleToSize(c.MaxHp, 0);
    }
    return v;
  }
  get CreatureNodes() { return [...this.creatures.values()]; }
  AddCreature(c: any) { this.GetCreatureNode(c); invalidate(); }
  /** NCombatRoom.RemoveCreatureNode: the node moves to _removingCreatureNodes (kept, where it stood) until AnimDie ends. */
  removing = new Map<any, any>();
  removingNodes = new Map<any, CreatureView>();
  RemoveCreatureNode(v: any) {
    for (const [k, x] of this.creatures) if (x === v) {
      const slot = layoutCreatures(this.combatState).get(k);
      if (slot) { this.removing.set(k, slot); this.removingNodes.set(k, x); }
      this.creatures.delete(k);
    }
    invalidate();
  }
  TransitionToActiveCombat() { invalidate(); }
  SetUpBackground() {}
  /** NCombatRoom.PlaySplashVfx: NSplashVfx (tinted droplets + splash) at the target's feet and NLiquidOverlayVfx (the
   *  tinted liquid over the body, render/vfx-misc). */
  PlaySplashVfx(target: any, tint: any) {
    const n = this.GetCreatureNode(target);
    if (!n || G.TestMode.IsOn) return;
    const p = n.GetBottomOfHitbox();
    playCombatVfx('vfx/vfx_splash', p.X, p.Y, [tint?.R ?? 1, tint?.G ?? 1, tint?.B ?? 1, tint?.A ?? 1]);
    G.GodotTreeExtensions.AddChildSafely(this.CombatVfxContainer, N('Vfx.NLiquidOverlayVfx').Create(target, tint));
  }
}
creatureViewsRef.get = () => (NCombatRoom.Instance instanceof CombatRoomView ? NCombatRoom.Instance.CreatureNodes : []);
NCombatRoom.Create = (room: any, mode: number) => {
  NCombatRoom.Instance?.dispose?.();
  const v = new CombatRoomView(room, mode);
  NCombatRoom.Instance = v;
  return v;
};

/**
 * NEventRoom.SetupLayout for ancients: one dialogue picked (chaotic RNG) from those valid for this character's and
 * everyone's visit counts, with the act-1 name filled in.
 */
function ancientDialogue(ev: any, rs: any): any[] {
  try {
    const ch = ev.Owner.Character, id = ch.Id;
    const stats = G.SaveManager.Instance.Progress.GetStatsForAncient(ev.Id);
    const valid = ev.DialogueSet.GetValidDialogues(id, stats?.GetVisitsAs(id) ?? 0, stats?.TotalVisits ?? 0, !list(ev.AnyCharacterDialogueBlacklist).includes(ch));
    const lines = list(G.Rng.Chaotic.NextItem(G.AncientDialogue, valid).Lines);
    for (const l of lines) l.LineText?.Add$String_LocString('Act1Name', rs.Acts[0].Title);
    return lines;
  } catch (e) { console.warn('ancient dialogue', e); return []; }
}
/**
 * NEventRoom and its layout (NEventLayout / NAncientEventLayout / NCombatEventLayout): ui/event.tsx draws it. SetupLayout
 * sets the portrait and title, waits 0.2 s, then the description (typewriter) and the options (sliding in); a pick
 * clears the options until the event's next state, and the event's BeforeChosen / combat start disable them.
 * A Custom-layout event (the Fake Merchant) gets its own scene instead (`custom`, ui/shop.tsx) and no layout.
 */
export class EventRoomView extends NEventRoom {
  kind = 'event';
  combat: CombatRoomView | null = null;
  layout: 'default' | 'ancient' | 'combat' | 'custom';
  custom: FakeMerchantView | null = null;
  title = '';
  description = '';
  descGen = 0;
  options: any[] = [];
  optionsGen = 0;
  disabled = false;
  /** Options were cleared by a pick and the next state has not come yet (the coverage harness waits on it). */
  choosing = false;
  portrait: string | null = null;
  /** NCombatEventLayout.HideEventVisuals: the event's text and options go once its combat starts. */
  hidden = false;
  /** NAncientEventLayout dialogue: lines shown one at a time; the options come with the last one. */
  dialogue: any[] = [];
  line = 0;
  ready = false;
  Layout: any;
  constructor(public event: any, public runState: any, public preFinished: boolean) {
    super();
    const L = G.EventLayoutType;
    this.layout = event?.LayoutType === L.Ancient ? 'ancient' : event?.LayoutType === L.Combat ? 'combat' : event?.LayoutType === L.Custom ? 'custom' : 'default';
    // NCombatEventLayout.SetEvent: a visual-only combat room with the event's creatures
    if (this.layout === 'combat') this.combat = NCombatRoom.Create(event.CreateCombatRoomVisuals(runState.Players, runState.Act), G.CombatRoomMode.VisualOnly);
    const view = this;
    this.Layout = {
      SetPortrait: (t: any) => view.SetPortrait(t),
      RemoveNodesOnPortrait() {},
      AddVfxAnchoredToPortrait() {},
      get OptionButtons() { return []; },
      DisableEventOptions: () => { view.disabled = true; invalidate(); },
    };
  }
  get EmbeddedCombatRoom() { return this.combat; }
  SetPortrait(t: any) { this.portrait = safeGet(() => t?.ResourcePath ?? null, null); invalidate(); }
  private refresh = () => {
    this.setDescription();
    if (this.layout === 'ancient') this.dialogue = [];
    this.setOptions();
  };
  private enteringCombat = () => { this.disabled = true; if (this.layout === 'combat') this.hidden = true; invalidate(); };
  /** NEventRoom._Ready → SetupLayout. */
  async setup() {
    const ev = this.event;
    if (this.layout === 'custom') {
      // _Ready: the event's scene becomes its node (SetNode → ICustomEventNode.Initialize, then the scene's _Ready);
      // SetupLayout finds no NEventLayout and returns
      this.custom = new FakeMerchantView();
      ev.SetNode(this.custom);
      this.custom.ready();
      invalidate();
      return;
    }
    // Layout.SetEvent: the portrait (default layout), then EventModel.OnRoomEnter
    if (this.layout === 'default') this.portrait = safeGet(() => ev.InitialPortraitPath, null);
    safeGet(() => ev.OnRoomEnter(), undefined);
    this.title = safeGet(() => ev.Title.GetFormattedText(), '');
    ev.StateChanged = $.dcombine(ev.StateChanged, this.refresh);
    ev.EnteringEventCombat = $.dcombine(ev.EnteringEventCombat, this.enteringCombat);
    invalidate();
    await G.Cmd.Wait$2(0.2);
    this.setDescription();
    if (this.layout === 'ancient' && !this.preFinished) { this.dialogue = ancientDialogue(ev, this.runState); this.line = 0; }
    this.setOptions();
    this.ready = true;
    invalidate();
  }
  private setDescription() {
    const ev = this.event;
    const d = ev.Description ?? new G.LocString().$ctor_LocString('events', 'ERROR.description');
    if (!safeGet(() => d.Exists(), true)) return;
    safeGet(() => { ev.Owner.Character.AddDetailsTo(d); d.Add$String_Boolean('IsMultiplayer', ev.Owner.RunState.Players.length > 1); ev.DynamicVars.AddTo(d); }, undefined);
    this.description = safeGet(() => d.GetFormattedText(), '');
    this.descGen++;
  }
  private setOptions() {
    const ev = this.event;
    let opts = list(ev.CurrentOptions);
    if (ev.IsFinished) opts = [new G.EventOption().$ctor_EventOption$EventModel_FuncTask_String_Boolean_Boolean_IHoverTipArr(ev, NEventRoom.Proceed, 'PROCEED', false, true, [])];
    for (const o of opts) o.BeforeChosen = $.dcombine(o.BeforeChosen, (opt: any) => { if (!opt.IsProceed) { this.disabled = true; invalidate(); } return $.Task.CompletedTask; });
    this.options = opts;
    this.optionsGen++;
    this.disabled = false;
    this.choosing = false;
    invalidate();
  }
  /** NEventRoom.OptionButtonClicked. */
  OptionButtonClicked(option: any, index: number) {
    if (option.IsLocked) return;
    if (option.IsProceed) { G.TaskHelper.RunSafely(option.Chosen()); return; }
    if (!this.event.IsShared) { this.options = []; this.choosing = true; }
    G.RunManager.Instance.EventSynchronizer.ChooseLocalOption(index);
    invalidate();
  }
  choose(i: number) { const o = this.options[i]; if (o && !this.disabled) this.OptionButtonClicked(o, i); }
  proceed() { NEventRoom.Proceed(); }
}
NEventRoom.Create = (ev: any, rs: any, pre: boolean) => { const v = new EventRoomView(ev, rs, pre); NEventRoom.Instance = v; void v.setup(); return v; };
// NEventRoom.Proceed: enable travel, open the map
NEventRoom.Proceed = () => { NMapScreen.Instance?.SetTravelEnabled(true); NMapScreen.Instance?.Open(); return $.Task.CompletedTask; };

/**
 * NRestSiteRoom (ui/rest.tsx draws it): the options fade in; a pick disables them and runs the option through the
 * synchronizer, then the choices fade out while the option's post-select effect plays, the fire goes out when nothing
 * is left, and only then is the proceed button (and travel) enabled.
 */
export class RestSiteView extends NRestSiteRoom {
  kind = 'rest';
  options: any[] = [];
  optionsGen = 0;
  disabled = false;
  fireOut = false;
  proceedOn = false;
  /** Choices screen alpha, header / choices hidden for the first visit's FTUE, the description text, alpha and y. */
  fx = { ChoicesA: 1, IntroA: 1, DescA: 0, DescY: 513 };
  introHidden = false;
  description = '';
  paint?: () => void;
  private descTween: any = null;
  private descPosTween: any = null;
  private choicesTween: any = null;
  characterAnims: any[];
  constructor(public room: any, public runState: any) {
    super();
    const NRestSiteCharacter = N('RestSite.NRestSiteCharacter');
    this.characterAnims = list(runState.Players).map((p: any) => { const c = $.dummy(NRestSiteCharacter); c.$_Player = p; return c; });
    this.updateOptions();
    void this.showFtueIfNeeded();
  }
  get Options() { return this.room.Options; }
  get Characters() { return this.characterAnims; }
  get ProceedButton() { return { IsEnabled: this.proceedOn }; }
  private updateOptions() { this.options = list(this.room.Options); this.optionsGen++; invalidate(); }
  private async showFtueIfNeeded() {
    if (seenFtue('rest_site_ftue')) return;
    this.introHidden = true;
    await G.Cmd.Wait$2(0.5);
    this.introHidden = false;
    this.fx.IntroA = 0;
    const t = play(this, new $.WebTween());
    t.TweenProperty(this.fx, 'intro_a', 1, 0.5);
    void showFtue('rest_site_ftue', 'REST_SITE_FTUE');
    invalidate();
  }
  DisableOptions() { this.disabled = true; invalidate(); }
  EnableOptions() { this.disabled = false; invalidate(); }
  AnimateDescriptionDown() { this.descPosTween?.Kill(); this.descPosTween = play(this, new $.WebTween()); this.descPosTween.TweenProperty(this.fx, 'desc_y', 885, 0.8).SetTrans(TR.Expo).SetEase(EZ.Out); }
  AnimateDescriptionUp() { this.descPosTween?.Kill(); this.descPosTween = play(this, new $.WebTween()); this.descPosTween.TweenProperty(this.fx, 'desc_y', 513, 0.8).SetTrans(TR.Expo).SetEase(EZ.Out); }
  SetText(text: string) { this.descTween?.Kill(); this.fx.DescA = 1; this.description = text; this.paint?.(); invalidate(); }
  FadeOutOptionDescription() { this.descTween?.Kill(); this.descTween = play(this, new $.WebTween()); this.descTween.TweenProperty(this.fx, 'desc_a', 0, 1).SetEase(EZ.Out).SetTrans(TR.Expo).From(1); }
  GetButtonForOption() { return null; }
  GetCharacterForPlayer(p: any) { return this.characterAnims.find((c) => c.Player === p) ?? null; }
  /** NRestSiteButton.SelectOption. */
  async select(option: any) {
    const i = this.options.indexOf(option);
    if (i < 0 || this.disabled || !option.IsEnabled) return;
    this.DisableOptions();
    let ok = false;
    try {
      ok = await G.RunManager.Instance.RestSiteSynchronizer.ChooseLocalOption(i);
      if (ok) void this.AfterSelectingOption(option);
    } finally {
      if (!ok) { await new Promise((r) => requestAnimationFrame(r)); this.EnableOptions(); }
    }
  }
  /** AfterSelectingOptionAsync. */
  async AfterSelectingOption(option: any) {
    this.choicesTween?.Kill();
    const hide = (this.choicesTween = play(this, new $.WebTween()));
    hide.TweenProperty(this.fx, 'choices_a', 0, 0.5);
    const vfx = safeGet(() => option.DoLocalPostSelectVfx(), null);
    if (!list(G.RunManager.Instance.RestSiteSynchronizer.GetLocalOptions()).length && !this.fireOut) { this.fireOut = true; extinguishRestFire(); invalidate(); }
    await Promise.all([new Promise<void>((r) => hide.whenFinished(r)), vfx ?? Promise.resolve()]);
    this.updateOptions();
    this.disabled = false;
    this.showProceed();
    if (this.options.length) {
      const show = (this.choicesTween = play(this, new $.WebTween()));
      show.TweenProperty(this.fx, 'choices_a', 1, 0.5).SetEase(EZ.Out).SetTrans(TR.Cubic);
    }
  }
  /** ShowProceedButton: only after an option (or with none left) — travel is enabled with it. */
  showProceed() { if (!this.proceedOn) { this.proceedOn = true; NMapScreen.Instance?.SetTravelEnabled(true); invalidate(); } }
  proceed() { NMapScreen.Instance?.Open(); }
}
NRestSiteRoom.Create = (room: any, rs: any) => {
  const v = new RestSiteView(room, rs);
  NRestSiteRoom.Instance = v;
  // OnActiveScreenUpdated: a rest site with no options left (a reload after resting) can be left at once
  if (!v.options.length) v.showProceed();
  return v;
};

/** NMerchantSlot purchase: card removal has its own (cancelable) overload, which C# picks for that entry type. */
export async function purchase(entry: any, inventory: any) {
  const buy = entry.OnTryPurchaseWrapper$3 ?? entry.OnTryPurchaseWrapper$2;
  await buy.call(entry, inventory, false);
  invalidate();
}
/**
 * A merchant room's SceneContainer as the rule layer reaches it through MerchantButton.GetParent(): a scene instance
 * added here (FoulPotion.ShowPotionVfx's vfx_slime_impact; PackedScene.Instantiate stamps its SceneFilePath) plays in
 * `layer` (the top of the room's backdrop) once its GlobalPosition is set. Speech bubbles show themselves (`bubbles`).
 */
class SceneContainerView {
  layer: any = null;
  AddChild(child: any) {
    const path = child?.SceneFilePath;
    if (!path) return;
    let at = new $.Vector2(0, 0);
    Object.defineProperty(child, 'GlobalPosition', { configurable: true, get: () => at, set: (v: any) => { at = v; if (this.layer && !this.layer.destroyed) void playSpriteVfx(this.layer, path, v.X, v.Y); } });
  }
}
/**
 * NMerchantButton (ui/shop.tsx MerchantButton is its hit rect; the reticle is drawn in the backdrop): hovering puts
 * the merchant in his "outline" skin — or, while a TargetedNoCreature potion (the Foul Potion) is aimed, makes him the
 * target with the selection reticle; a release opens the inventory (a dead player gets a PlayerDeadLines line
 * instead). The rule layer never type-tests it, so it needs no NMerchantButton stub base.
 */
export class MerchantButtonView {
  shown = true;
  /** MerchantSelectionReticle (drawn in the backdrop, under the merchant). */
  reticle: { OnSelect(): void; OnDeselect(): void } | null = null;
  IsLocalPlayerDead = false;
  PlayerDeadLines: any = [];
  /** MerchantVisual's skeleton (ui/shop.tsx hands it over once built). */
  spine: any = null;
  private focusedWhileTargeting = false;
  constructor(public rect: number[], public scene: SceneContainerView, private opened: () => void) {}
  get GlobalPosition() { return new $.Vector2(this.rect[0], this.rect[1]); }
  get Size() { return new $.Vector2(this.rect[2], this.rect[3]); }
  GetParent() { return this.scene; }
  Hide() { this.shown = false; invalidate(); }
  private skin(name: string) { safeGet(() => { const sk = this.spine?.skeleton; sk?.setSkinByName(name); sk?.setSlotsToSetupPose(); }, undefined); }
  /** NButton.OnFocus (hover sound) → RefreshFocus. */
  OnFocus() { audio.playOneShot('event:/sfx/ui/clicks/ui_hover'); this.RefreshFocus(); }
  OnUnfocus() {
    this.reticle?.OnDeselect();
    if (this.focusedWhileTargeting) targetManager.OnNodeUnhovered(this);
    else this.skin('default');
    this.focusedWhileTargeting = false;
    invalidate();
  }
  OnPress() { audio.playOneShot('event:/sfx/ui/clicks/ui_click'); }
  OnRelease() {
    if (this.focusedWhileTargeting) {
      this.reticle?.OnDeselect();
      this.focusedWhileTargeting = false;
      this.RefreshFocus();
    } else if (this.IsLocalPlayerDead) {
      const l = G.Rng.Chaotic.NextItem(G.LocString, list(this.PlayerDeadLines));
      if (l) this.PlayDialogue(l);
    } else this.opened();
  }
  RefreshFocus() {
    if (targetManager.IsInSelection && targetManager.AllowedToTargetNode(this)) {
      targetManager.OnNodeHovered(this);
      this.reticle?.OnSelect();
      this.focusedWhileTargeting = true;
    } else {
      this.skin('outline');
      this.focusedWhileTargeting = false;
    }
    invalidate();
  }
  /** A bubble (DialogueSide.Right, VfxColor.Blue) at GlobalPosition + Left · Size.X, added to the SceneContainer. */
  PlayDialogue(line: any, duration = 2) {
    const b = N('Vfx.NSpeechBubbleVfx').Create(line.GetFormattedText(), 2 /* Right */, new $.Vector2(this.rect[0] - this.rect[2], this.rect[1]), duration, 2 /* Blue */);
    if (b) G.GodotTreeExtensions.AddChildSafely(this.GetParent(), b);
    return b;
  }
}

/**
 * NMerchantInventory and what its rooms share (NMerchantRoom and the Fake Merchant's NFakeMerchant; ui/shop.tsx draws
 * them): the rug starts rolled up; the merchant opens it (proceed and the merchant are disabled while it is open, the
 * back button closes it and proceed then pulses). Slots react to their entry's events: a failed purchase wiggles the
 * slot, a bought card flies to the deck, the merchant's hand points at the slot, and the rug dialogue says a line.
 */
const merchantShop = (Base: any) => class extends Base {
  kind = 'shop';
  pulse = false;
  blocked = false;
  fx = { BackstopA: 0, RugY: -1000 };
  /** NMerchantDialogue: the line, its x (random in 450–1450) and a counter restarting the tween. */
  line = { text: '', x: 1410, gen: 0 };
  /** NMerchantHand: where it heads (slot − 50) and when it goes home (StopPointing's linger). */
  hand = { tx: 234, ty: -54, home: 0 };
  /** NMerchantSlot.OnPurchaseFailed: entry → wiggle counter. */
  wiggles = new Map<any, number>();
  removalUsed = false;
  /** The card each card slot shows (the entry forgets it on purchase; the slot's node flies to the deck). */
  shown = new Map<any, any>();
  /** NMerchantRelic._relic / NMerchantPotion._potion: the model the slot showed before the purchase. */
  bought = new Map<any, any>();
  slotEls = new Map<any, Element>();
  paint?: () => void;
  Inventory: any;
  MerchantButton!: MerchantButtonView;
  /** The MerchantInventory and MerchantDialogueSet (NMerchantInventory.Initialize). */
  inv: any = null;
  dialogue: any = null;
  /** The inventory scene: slot origins, rug image, hand skeleton, relic icon size (NRelic.IconSize.Large). */
  slots: ShopSlots = SHOP_SLOTS;
  rug = 'images/rooms/merchant_room/shop_rug.png';
  handSkel = 'animations/backgrounds/merchant_room/hand/merchanthand';
  largeRelics = false;
  tween: any = null;
  closedHandler = false;
  initShop(inv: any, dialogue: any, button: number[]) {
    this.inv = inv;
    this.dialogue = dialogue;
    this.MerchantButton = new MerchantButtonView(button, new SceneContainerView(), () => this.OpenInventory());
    const me = inv?.Player;
    this.Inventory = { open: false, get IsOpen() { return this.open; }, Open: () => this.openRug(), OnCardRemovalUsed: () => { this.removalUsed = true; invalidate(); }, Player: me };
    for (const e of list(inv?.AllEntries ?? [])) {
      this.shown.set(e, safeGet(() => e.CreationResult?.Card ?? null, null));
      if (e instanceof G.MerchantRelicEntry || e instanceof G.MerchantPotionEntry) this.bought.set(e, e.Model);
      // NMerchantCard.UpdateVisual keeps its card node while the entry has no card: the inventory's UpdateEntries runs
      // before purchaseCompleted, which still has to fly the bought card to the deck
      e.EntryUpdated = $.dcombine(e.EntryUpdated, () => { const c = safeGet(() => e.CreationResult?.Card ?? null, null); if (c) this.shown.set(e, c); invalidate(); });
      e.PurchaseFailed = $.dcombine(e.PurchaseFailed, (status: number) => this.purchaseFailed(e, status));
      e.PurchaseCompleted = $.dcombine(e.PurchaseCompleted, (status: number, entry: any) => this.purchaseCompleted(status, entry));
    }
    const removal = inv?.CardRemovalEntry;
    if (removal && !G.Hook.ShouldAllowMerchantCardRemoval(me.RunState, me)) removal.SetUsed();
    this.removalUsed = !!removal?.Used;
  }
  get open() { return this.Inventory.open; }
  get proceedOn() { return !this.open; }
  get backOn() { return this.open && !ui.overlays.length; }
  /** OpenInventory (the merchant, or the FTUE's hitbox): the rug comes down; closing it re-enables proceed, pulsing. */
  OpenInventory() {
    if (this.open) return;
    this.closedHandler = true;
    this.openRug();
  }
  /** NMerchantInventory.Open / DoOpenAnimation. */
  openRug() {
    if (!seenFtue('merchant_ftue')) G.SaveManager.Instance.MarkFtueAsComplete('merchant_ftue');
    this.tween?.Kill();
    const t = (this.tween = play(this, new $.WebTween().SetParallel()));
    t.TweenProperty(this.fx, 'backstop_a', 0.8, 1).SetEase(EZ.InOut).SetTrans(TR.Sine);
    t.TweenProperty(this.fx, 'rug_y', 80, 0.7).SetEase(EZ.Out).SetTrans(TR.Quint);
    for (const e of list(this.inv.CardEntries)) {
      const r = safeGet(() => e.CreationResult, null);
      if (r?.HasBeenModified) setTimeout(() => { for (const relic of list(r.ModifyingRelics)) safeGet(() => relic.Flash(), undefined); }, 400);
    }
    audio.playOneShot('event:/sfx/npcs/merchant/merchant_welcome');
    this.Inventory.open = true;
    // ShowOnInventoryOpen: OpenInventoryLines (the real merchant has no such loc keys, so he says nothing)
    this.say(safeGet(() => this.dialogue.OpenInventoryLines, []));
    invalidate();
  }
  /** NMerchantInventory.Close (back button / ESC). */
  close() {
    if (!this.open) return;
    this.stopPointing(0);
    this.tween?.Kill();
    const t = (this.tween = play(this, new $.WebTween().SetParallel()));
    t.TweenProperty(this.fx, 'backstop_a', 0, 0.8).SetEase(EZ.InOut).SetTrans(TR.Sine);
    t.TweenProperty(this.fx, 'rug_y', -1000, 0.5).SetEase(EZ.Out).SetTrans(TR.Cubic);
    this.Inventory.open = false;
    if (this.closedHandler) { this.closedHandler = false; this.pulse = true; }
    invalidate();
  }
  BlockInput() { this.blocked = true; invalidate(); }
  UnblockInput() { this.blocked = false; invalidate(); }
  /** NMerchantDialogue.ShowRandom. */
  say(lines: any) {
    const l = list(lines);
    if (!l.length) return;
    const text = safeGet(() => G.Rng.Chaotic.NextItem(G.LocString, l)?.GetFormattedText() ?? '', '');
    if (!text) return;
    this.line = { text, x: G.Rng.Chaotic.NextFloat$2(450, 1450), gen: this.line.gen + 1 };
    invalidate();
  }
  /** NMerchantHand.PointAtTarget / StopPointing. */
  pointAt(x: number, y: number) { this.hand.home = 0; this.hand.tx = x - 50; this.hand.ty = y - 50; }
  stopPointing(linger: number) { this.hand.home = performance.now() + linger * 1000; }
  purchaseFailed(e: any, status: number) {
    if (status === G.PurchaseStatus.Success) return;
    this.wiggles.set(e, (this.wiggles.get(e) ?? 0) + 1);
    audio.playOneShot('event:/sfx/npcs/merchant/merchant_dissapointment');
    this.say(safeGet(() => this.dialogue.GetPurchaseSuccessLines(status), []));
  }
  /** The slot's OnSuccessfulPurchase, then NMerchantInventory.OnPurchaseCompleted. */
  purchaseCompleted(status: number, entry: any) {
    const el = this.slotEls.get(entry);
    const at = this.slotOrigin(entry);
    if (at) { this.pointAt(at[0], at[1]); this.stopPointing(2); }
    if (entry instanceof G.MerchantCardEntry) {
      const card = this.shown.get(entry);
      const node = card && holderFor(card, el?.querySelector('.card') ?? el ?? null).$_CardNode;
      if (node) {
        NRun.Instance.GlobalUi.ReparentCard(node);
        const target = G.PileTypeExtensions.GetTargetPosition(G.PileType.Deck, node);
        G.GodotTreeExtensions.AddChildSafely(NRun.Instance.GlobalUi.TopBar.TrailContainer, N('Vfx.NCardFlyVfx').Create(node, target, true, card.Owner.Character.TrailPath));
      }
      this.shown.set(entry, safeGet(() => entry.CreationResult?.Card ?? null, null));
    } else if (entry instanceof G.MerchantRelicEntry || entry instanceof G.MerchantPotionEntry) {
      // the top-bar icon starts where the slot's icon is (its NRelic icon / NPotion top-left)
      const r = logicalRect(el?.querySelector('.shop-relic, .shop-potion') ?? null);
      const at = r ? new $.Vector2(r[0], r[1]) : null;
      const model = this.bought.get(entry);
      if (model && entry instanceof G.MerchantRelicEntry) NRun.Instance.GlobalUi.RelicInventory.AnimateRelic(model, at);
      else if (model) NRun.Instance.GlobalUi.TopBar.PotionContainer.AnimatePotion(model, at);
      this.bought.set(entry, entry.Model);
    }
    audio.playOneShot('event:/sfx/npcs/merchant/merchant_thank_yous');
    this.say(safeGet(() => this.dialogue.GetPurchaseSuccessLines(status), []));
    invalidate();
  }
  /** A slot's GlobalPosition (its origin on the rug). */
  slotOrigin(entry: any): [number, number] | null {
    const o = shopSlotOrigin(this.inv, entry, this.slots);
    return o && [o[0], o[1] + this.fx.RugY - 80];
  }
  buy(entry: any) { return purchase(entry, this.inv); }
};
/** NMerchantRoom (MerchantButton at (1206, 468), 270 × 330). */
export class MerchantView extends merchantShop(NMerchantRoom) {
  constructor(public Room: any, public players: any) {
    super();
    this.initShop(Room.Inventory, G.MerchantRoom.Dialogue, [1206, 468, 270, 330]);
    this.MerchantButton.IsLocalPlayerDead = safeGet(() => G.LocalContext.GetMe$IEnumerablePlayer(players).Creature.IsDead, false);
    this.MerchantButton.PlayerDeadLines = this.dialogue.PlayerDeadLines;
  }
  /** HideScreen: the merchant tip the first time (when the rug was never opened), else the map. */
  proceed() {
    if (!seenFtue('merchant_ftue')) { void showFtue('merchant_ftue', 'MERCHANT_FTUE', () => this.OpenInventory()); return; }
    NMapScreen.Instance?.Open();
  }
  /** NMerchantRoom.FoulPotionThrown: thanks, a FoulPotionLines line and a rumble. */
  FoulPotionThrown(_potion: any) {
    audio.playOneShot('event:/sfx/npcs/merchant/merchant_thank_yous');
    const l = G.Rng.Chaotic.NextItem(G.LocString, list(this.dialogue.FoulPotionLines));
    if (l && this.MerchantButton.PlayDialogue(l)) NGame.Instance?.ScreenRumble(3 /* Medium */, 1 /* Short */, 1 /* Rumble */);
  }
}
/** merchant_inventory.tscn: slot origins with the rug open (y 80). */
export const SHOP_SLOTS = {
  cards: [[437, 383], [700, 383], [961, 383], [1220, 383], [1486, 380]],
  colorless: [[502, 756], [776, 756]],
  relics: [[989, 675], [1139, 675], [1289, 675]],
  potions: [[989, 819], [1139, 819], [1289, 819]],
  removal: [1488, 758] as number[] | null,
};
type ShopSlots = typeof SHOP_SLOTS;
export function shopSlotOrigin(inv: any, e: any, slots: ShopSlots = SHOP_SLOTS): number[] | null {
  const at = (l: any, xs: number[][]) => { const i = list(l).indexOf(e); return i >= 0 ? xs[i] ?? null : null; };
  return at(inv.CharacterCardEntries, slots.cards) ?? at(inv.ColorlessCardEntries, slots.colorless) ?? at(inv.RelicEntries, slots.relics)
    ?? at(inv.PotionEntries, slots.potions) ?? (e === inv.CardRemovalEntry ? slots.removal : null);
}
NMerchantRoom.Create = (room: any, players: any) => { const v = new MerchantView(room, players); NMerchantRoom.Instance = v; NMapScreen.Instance?.SetTravelEnabled(true); return v; };

/** fake_merchant_inventory.tscn: the six relic slots (Large icons) with the rug open (y 80). */
const FAKE_SLOTS: ShopSlots = { cards: [], colorless: [], potions: [], removal: null, relics: [[987, 298], [1262, 368], [855, 596], [1128, 663], [1463, 578], [941, 927]] };
const NFakeMerchant = N('Events.Custom.NFakeMerchant');
/**
 * NFakeMerchant, the Fake Merchant event's custom layout (ui/shop.tsx FakeMerchantScreen): the event's relic inventory
 * on the fake rug, MerchantButton at (1164, 361), 270 × 437. Proceed works at once (not pulsing until the rug was
 * closed); 0.75 s in the merchant laughs and says a welcome line. After his fight (StartedFight) he is gone, and if
 * the player took his rug the floor skeleton's "rug" bone is hidden.
 */
export class FakeMerchantView extends merchantShop(NFakeMerchant) {
  event: any = null;
  players: any[] = [];
  /** FakeMerchantBackground's "rug" bone is hidden (StartedFight and the player owns FakeMerchantsRug). */
  rugHidden = false;
  /** StartCharacterAnimation's rolls: relaxed_loop's time scale U(0.9, 1.1) and track time offset U(−0.5, 0.5). */
  charAnim = [1, 0];
  /** ICustomEventNode.Initialize (EventModel.SetNode). */
  Initialize(ev: any) {
    this.event = ev;
    this.players = list(ev.Owner.RunState.Players);
  }
  get me() { return G.LocalContext.GetMe$IEnumerablePlayer(this.players); }
  /** _Ready (AfterRoomIsLoaded's character is drawn by ui/shop.tsx). */
  ready() {
    this.slots = FAKE_SLOTS;
    this.rug = 'images/events/custom/fake_merchant_rug.png';
    this.handSkel = 'animations/backgrounds/fake_merchant_room/hand/fakemerchanthand';
    this.largeRelics = true;
    this.initShop(this.event.Inventory, G.FakeMerchant.Dialogue, [1164, 361, 270, 437]);
    if (this.event.StartedFight) {
      this.MerchantButton.Hide();
      this.rugHidden = this.me.GetRelic(G.FakeMerchantsRug) != null;
    } else {
      this.MerchantButton.IsLocalPlayerDead = this.me.Creature.IsDead;
      this.MerchantButton.PlayerDeadLines = this.dialogue.PlayerDeadLines;
    }
    NMapScreen.Instance?.SetTravelEnabled(true);
    // AfterRoomIsLoaded
    this.charAnim = [G.Rng.Chaotic.NextFloat$2(0.9, 1.1), G.Rng.Chaotic.NextFloat$2(-0.5, 0.5)];
    if (!this.event.StartedFight) G.TaskHelper.RunSafely(this.showWelcome());
  }
  /** ShowWelcomeDialogue. */
  async showWelcome() {
    const line = G.Rng.Chaotic.NextItem(G.LocString, list(this.dialogue.WelcomeLines));
    if (!line) return;
    await G.Cmd.Wait$2(0.75);
    audio.playOneShot('event:/sfx/npcs/reverse_merchant/reverse_merchant_laugh');
    this.MerchantButton.PlayDialogue(line, 4);
  }
  /** HideScreen. */
  proceed() { NMapScreen.Instance?.Open(); }
  /** FoulPotionThrown: a FoulPotionLines line, held until a second before it goes. */
  async FoulPotionThrown(_potion: any) {
    const l = G.Rng.Chaotic.NextItem(G.LocString, list(this.dialogue.FoulPotionLines));
    if (!l) return;
    const b = this.MerchantButton.PlayDialogue(l);
    if (b) await G.Cmd.Wait$2(b.SecondsToDisplay - 1);
  }
}

/**
 * NTreasureRoom + NTreasureRoomRelicCollection (drawn by ui/treasure.tsx), single player: the chest opens on a click
 * (banner in, the act's sound, gold coins), the relic rises into place and is taken with a click (it flies to the top
 * bar), then the banner leaves and proceed appears. An empty chest says so and completes after a second.
 */
export class TreasureView extends NTreasureRoom {
  kind = 'treasure';
  opened = false;
  banner: '' | 'in' | 'out' = '';
  collection = false;
  empty = false;
  relic: any = null;
  holderShown = false;
  clickable = false;
  claimed = false;
  fx = { CollectionA: 0, ChestA: 1, HolderY: 150, HolderV: 0 };
  paint?: () => void;
  private openedAt = 0;
  private done: any = null;
  private awarded: any = null;
  constructor(public room: any, public runState: any) { super(); }
  get proceedOn() { return this.claimed && !ui.overlays.length; }
  /** OpenChest. */
  async open() {
    if (this.opened) return;
    this.opened = true;
    this.banner = 'in';
    chestSkin(false);
    openChest();
    G.SfxCmd.Play$2(this.runState.Act.ChestOpenSfx);
    invalidate();
    const gold = await this.room.DoNormalRewards();
    if (gold > 0) void chestGold(gold);
    await this.room.DoExtraRewardsIfNeeded();
    const sync = G.RunManager.Instance.TreasureRoomRelicSynchronizer;
    this.awarded = (results: any) => this.onAwarded(results);
    sync.RelicsAwarded = $.dcombine(sync.RelicsAwarded, this.awarded);
    this.done = tcs();
    this.animIn(list(sync.CurrentRelics));
    void this.relicFtue();
    await this.done.Task;
    this.banner = 'out';
    NMapScreen.Instance?.SetTravelEnabled(true);
    this.claimed = true;
    // AnimOut
    const t = play(this, new $.WebTween().SetParallel());
    t.TweenProperty(this.fx, 'collection_a', 0, 0.3);
    t.TweenProperty(this.fx, 'chest_a', 1, 0.3);
    t.whenFinished(() => { this.collection = false; invalidate(); });
    invalidate();
  }
  /** InitializeRelics + AnimIn: the collection fades in over the dimmed chest; the relic comes up from black, 150 px low. */
  private animIn(relics: any[]) {
    this.collection = true;
    this.openedAt = performance.now();
    const t = play(this, new $.WebTween().SetParallel());
    t.TweenProperty(this.fx, 'collection_a', 1, 0.4).From(0);
    t.TweenProperty(this.fx, 'chest_a', 0.5, 0.4);
    if (!relics.length) {
      this.empty = true;
      const me = G.LocalContext.GetMe$IPlayerCollection(this.runState);
      safeGet(() => list(me.Relics).find((r: any) => r instanceof G.SilverCrucible)?.Flash(), undefined);
      t.TweenCallback(() => G.RunManager.Instance.TreasureRoomRelicSynchronizer.CompleteWithNoRelics()).SetDelay(1);
      invalidate();
      return;
    }
    this.relic = relics[0];
    this.holderShown = true;
    this.fx.HolderY = 150;
    this.fx.HolderV = 0;
    const d = 0.2 + 0.2 * Math.random();
    const h = play(this, new $.WebTween().SetParallel());
    h.TweenProperty(this.fx, 'holder_v', 1, 0.2).SetDelay(d);
    h.TweenProperty(this.fx, 'holder_y', 0, 0.6).SetDelay(d).SetEase(EZ.Out).SetTrans(TR.Back);
    h.TweenCallback(() => { this.clickable = true; invalidate(); }).SetDelay(d + 0.6);
    invalidate();
  }
  /** RelicFtueCheck: the first time, the relic takes no clicks for a second, then the tip points at it. */
  private async relicFtue() {
    if (seenFtue('obtain_relic_ftue')) return;
    this.selectionOff = true;
    await G.Cmd.Wait$2(1);
    this.selectionOff = false;
    invalidate();
    void showFtue('obtain_relic_ftue', 'RELIC_FTUE');
  }
  selectionOff = false;
  /** PickRelic: clicks in the first 200 ms after opening are ignored. */
  pick() {
    if (!this.clickable || this.selectionOff || performance.now() - this.openedAt <= 200) return;
    G.RunManager.Instance.TreasureRoomRelicSynchronizer.PickRelicLocally(0);
  }
  /** AnimateRelicAwards (single player: no hands): obtain, the top-bar relic flies from the holder, the holder hides. */
  private onAwarded(results: any) {
    const sync = G.RunManager.Instance.TreasureRoomRelicSynchronizer;
    sync.RelicsAwarded = $.dremove(sync.RelicsAwarded, this.awarded);
    this.clickable = false;
    for (const r of list(results)) {
      const relic = r.relic.ToMutable();
      G.TaskHelper.RunSafely(G.RelicCmd.Obtain$3(relic, r.player, -1));
      if (G.LocalContext.IsMe$Player(r.player)) NRun.Instance.GlobalUi.RelicInventory.AnimateRelic(relic, new $.Vector2(858, 357 + this.fx.HolderY), new $.Vector2(1, 1));
      if (list(this.runState.Players).length === 1) this.holderShown = false;
      for (const p of list(r.player.RunState.Players)) if (p !== r.player) p.RelicGrabBag.MoveToFallback(r.relic);
    }
    this.done?.TrySetResult();
    invalidate();
  }
  proceed() { G.TaskHelper.RunSafely(G.RunManager.Instance.ProceedFromTerminalRewardsScreen()); }
}
NTreasureRoom.Create = (room: any, rs: any) => new TreasureView(room, rs);

export class MapRoomView { kind = 'maproom'; constructor(public act: any, public actIndex: number) {} }
// NMapRoom._Ready: open the map with travel enabled (the top bar's map button is disabled while it is the room)
NMapRoom.Create = (act: any, i: number) => {
  const v: any = new MapRoomView(act, i);
  setTimeout(() => { NMapScreen.Instance?.Open(); NMapScreen.Instance?.SetTravelEnabled(true); spawnActBanner(act, i); }, 0);
  return v;
};

// ------------------------------------------------------------------ map
/** NMapScreen for the rule layer and the room views: ui/map.tsx draws and runs it. */
export class MapView extends NMapScreen {
  Drawings = { GetSerializableMapDrawings: () => null, LoadDrawings() {}, ClearAllLines() {} };
  Initialize() {}
  SetMap(map: any, seed = 0, clearDrawings = false) { setMap(map, seed, clearDrawings); }
  Open(fromTopBar = false) { openMap(fromTopBar); return this; }
  Close(animateOut = true) { closeMap(animateOut); }
  get IsOpen() { return ui.mapOpen; }
  get Visible() { return isMapVisible(); }
  IsVisibleInTree() { return isMapVisible(); }
  SetTravelEnabled(b: boolean) { setTravelEnabled(b); }
  SetDebugTravelEnabled(b: boolean) { setDebugTravelEnabled(b); }
  get IsTraveling() { return mapTraveling.get(); }
  set IsTraveling(v: boolean) { mapTraveling.set(v); }
  InitMarker(coord: any) { initMarker(coord); }
  RefreshAllMapPointVotes() {}
  TravelToMapCoord(coord: any) { return travelToMapCoord(coord); }
  HighlightPointType() {}
  CleanUp() { if (G.RunManager.Instance.IsSinglePlayerOrFakeMultiplayer) G.CombatManager.Instance.Unpause(); }
}

// ------------------------------------------------------------------ rewards & card choices
// The overlay screens' state and behaviour (ui/overlays.tsx draws them). Each follows its Godot class: IOverlayScreen
// callbacks from the stack (store.ts), the completion sources the rule layer awaits, and the tweens it starts.
const TR = { Linear: 0, Sine: 1, Quint: 2, Quad: 4, Expo: 5, Cubic: 7, Back: 10 }, EZ = { In: 0, Out: 1, InOut: 2 };
/** Run a tween on a view's fx object, repainting it each frame (the view's component sets `paint`). */
function play(view: { paint?: () => void }, t: any) { $.onFrame(() => { view.paint?.(); return t.IsValid(); }); t.whenFinished(() => view.paint?.()); return t; }
const NDebugAudio = () => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance;

/** NRewardsScreen: reward buttons (claimed ones go away), the textured window and the Proceed / Skip button. */
export class RewardsView extends NRewardsScreen {
  kind = 'rewards';
  buttons: any[] = [];
  skipped = new Set<any>();
  busy = new Set<any>();
  complete = false;
  proceedOn = false; pulse = false; skipLabel = true; proceedHidden = false;
  /** Window modulate (V rgb, A alpha) and its y offset; the reward list's scroll (y inside the mask). */
  fx = { WinV: 0, WinA: 0, WinY: 0 };
  scroll = { y: 35, target: 35 };
  paint?: () => void;
  private fade: any = null;
  private done = tcs();
  constructor(public isTerminal: boolean, public runState: any) {
    super();
    this.tryEnableProceed();
    NDebugAudio()?.Play('victory.mp3');
  }
  get UseSharedBackstop() { return true; }
  get ClosedTask() { return this.done.Task; }
  get IsComplete() { return this.complete; }
  SetRewards(r: any) {
    this.buttons = list(r);
    for (const b of this.buttons) safeGet(() => b.MarkContentAsSeen(), undefined);
    this.updateScreenState();
    if (!this.buttons.length) this.tryEnableProceed();
    invalidate();
  }
  private tryEnableProceed() {
    if (safeGet(() => G.Hook.ShouldProceedToNextMapPoint(this.runState), true) && !this.proceedOn) {
      if (this.isTerminal && this.buttons.length === 0) hideBackstop();
      this.proceedOn = true;
    }
  }
  private updateScreenState() {
    if (this.buttons.length === 0) {
      if (this.isTerminal) {
        this.fade?.Kill();
        this.fade = play(this, new $.WebTween().SetParallel());
        this.fade.TweenProperty(this.fx, 'win_a', 0, 0.25);
        hideBackstop();
        this.skipLabel = false; this.pulse = true; this.complete = true;
      } else popOverlay(this);
    }
    if (rewardListHeight(this.buttons) < 400) this.scroll.target = 35;
    invalidate();
  }
  /** NRewardButton.GetReward (a button in a linked set claims the whole set). */
  /** NRewardButton.GetReward: a claimed relic or potion flies to the top bar from the button's icon (`iconAt`). */
  async claim(b: any, set?: any, iconAt?: number[] | null) {
    if (this.busy.has(b)) return;
    this.busy.add(b);
    invalidate();
    let ok = false;
    try { ok = await b.OnSelectWrapper(); } catch (e) { console.error(e); }
    this.busy.delete(b);
    if (ok) {
      const at = iconAt ? new $.Vector2(iconAt[0], iconAt[1]) : null;
      const gui = NRun.Instance.GlobalUi;
      if (b instanceof G.RelicReward && b.ClaimedRelic) gui.RelicInventory.AnimateRelic(b.ClaimedRelic, at);
      else if (b instanceof G.PotionReward) gui.TopBar.PotionContainer.AnimatePotion(b.ClaimedPotion, at);
      if (set) { this.collected(set); safeGet(() => set.OnSkipped(), undefined); } else this.collected(b);
    } else if (!set) this.skippedFrom(b);
    invalidate();
  }
  private collected(b: any) {
    this.buttons = this.buttons.filter((x) => x !== b);
    this.updateScreenState();
    if (this.buttons.length > 0 || this.isTerminal) {
      this.tryEnableProceed();
      if (!this.buttons.some((x) => !this.skipped.has(x))) this.pulse = true;
    }
  }
  private skippedFrom(b: any) { this.skipped.add(b); if (!this.buttons.some((x) => !this.skipped.has(x))) this.pulse = true; }
  /** NRewardsScreen.OnProceedButtonPressed. */
  proceed() {
    const rs = this.runState, room = rs.CurrentRoom;
    if (this.isTerminal && (room?.RoomType === G.RoomType.Boss || room?.IsVictoryRoom)) {
      if (rs.Map.SecondBossMapPoint != null && rs.CurrentMapCoord && G.MapCoord.op_Equality?.(rs.CurrentMapCoord, rs.Map.BossMapPoint.coord)) {
        G.TaskHelper.RunSafely(G.RunManager.Instance.ProceedFromTerminalRewardsScreen());
        return;
      }
      this.proceedOn = false; invalidate();
      G.RunManager.Instance.ActChangeSynchronizer.SetLocalPlayerReady();
      return;
    }
    if (this.isTerminal) {
      if (this.skipLabel) {
        if (seenFtue('combat_reward_ftue')) G.TaskHelper.RunSafely(G.RunManager.Instance.ProceedFromTerminalRewardsScreen());
        else { this.proceedHidden = true; invalidate(); void showFtue('combat_reward_ftue', 'REWARDS_FTUE').then(() => { this.proceedHidden = false; invalidate(); }); }
        return;
      }
      if (rs.ActFloor > 4) G.SaveManager.Instance.MarkFtueAsComplete('combat_reward_ftue');
      G.TaskHelper.RunSafely(G.RunManager.Instance.ProceedFromTerminalRewardsScreen());
      return;
    }
    popOverlay(this);
  }
  AfterOverlayShown() {
    this.tryEnableProceed();
    if (!this.complete) {
      this.fade?.CustomStep(1e3);
      const t = (this.fade = play(this, new $.WebTween().SetParallel()));
      t.TweenProperty(this.fx, 'win_v', 1, 0.5);
      t.TweenProperty(this.fx, 'win_a', 1, 0.5);
      t.TweenProperty(this.fx, 'win_y', 0, 0.5).SetEase(EZ.Out).SetTrans(TR.Back).From(100);
    }
    invalidate();
  }
  AfterOverlayHidden() {
    this.proceedOn = false;
    if (!this.complete) {
      this.fade?.CustomStep(1e3);
      this.fade = play(this, new $.WebTween());
      this.fade.TweenProperty(this.fx, 'win_a', 0, 0.25);
    }
    invalidate();
  }
  /** Whatever was left unclaimed is recorded as skipped. */
  AfterOverlayClosed() {
    const rm = G.RunManager.Instance;
    if (rm.IsInProgress && !rm.IsCleaningUp) { for (const r of this.buttons) safeGet(() => r.OnSkipped(), undefined); this.done.TrySetResult(); }
    this.proceedOn = false;
  }
}
/** Reward list height: 86 px buttons (linked sets: their buttons + 3 px gaps + 30 px margins), 10 px apart. */
export function rewardListHeight(buttons: any[]) {
  return buttons.reduce((h, b, i) => h + (i ? 10 : 0) + (b instanceof G.LinkedRewardSet ? list(b.Rewards).length * 86 + (list(b.Rewards).length - 1) * 3 + 30 : 86), 0);
}
NRewardsScreen.ShowScreen = (isTerminal: boolean, rs: any) => { const v = new RewardsView(isTerminal, rs); pushOverlay(v); return v; };

/** A holder for a picked card: its node starts where the card is on screen (the pick flies from there to the deck). */
function holderFor(card: any, el: Element | null) {
  const node = NCard.Create(card);
  const h = $.dummy(NCardHolder); h.$_CardNode = node;
  const st = document.querySelector('.stage-root');
  if (node && el && st) {
    const r = el.getBoundingClientRect(), sr = st.getBoundingClientRect(), k = 1920 / sr.width;
    node.Position = new $.Vector2((r.left + r.width / 2 - sr.left) * k, (r.top + r.height / 2 - sr.top) * k);
    node.Scale = new $.Vector2((r.width * k) / 300, (r.width * k) / 300);
  }
  return h;
}
/** Shared by the card rows: the cards fly out of the row's centre (0.5 s Expo Out) and fade up from black (1 s Cubic Out). */
export class CardRowView {
  fx: { X: number; V: number }[] = [];
  gen = 0;
  clickable = false;
  visible = true;
  paint?: () => void;
  protected layoutRow(n: number, spacing: number) {
    this.gen++;
    this.fx = Array.from({ length: n }, () => ({ X: 0, V: 0 }));
    const t = play(this, new $.WebTween().SetParallel());
    this.fx.forEach((f, i) => {
      t.TweenProperty(f, 'x', (i - (n - 1) / 2) * spacing, 0.5).SetEase(EZ.Out).SetTrans(TR.Expo);
      t.TweenProperty(f, 'v', 1, 1).SetEase(EZ.Out).SetTrans(TR.Cubic).From(0);
    });
    invalidate();
  }
  /** DisableCardsForShortTimeAfterOpening: clicks are ignored for 0.35 s. */
  protected lockClicks() { this.clickable = false; setTimeout(() => { this.clickable = true; invalidate(); }, 350); }
  AfterOverlayShown() { this.visible = true; invalidate(); }
  AfterOverlayHidden() { this.visible = false; invalidate(); }
}
/** NCardRewardSelectionScreen: a pick completes at once (the card flies to the deck); alternatives run their handler. */
export class CardRewardView extends CardRowView {
  kind = 'cardreward';
  cards: any[] = [];
  results: any[] = [];
  alternatives: any[] = [];
  taken = new Set<any>();
  /** The picked cards' NCard nodes (they fly to the deck carrying their reward glow: ui/reward-glow.tsx). */
  flying = new Map<any, any>();
  private pending: any = null;
  constructor(options: any, alts: any) { super(); this.RefreshOptions(options, alts); }
  get UseSharedBackstop() { return true; }
  RefreshOptions(options: any, alts: any) {
    this.results = list(options);
    this.cards = this.results.map((o: any) => o.Card ?? o);
    this.alternatives = list(alts);
    this.taken.clear();
    this.layoutRow(this.cards.length, 350);
    for (const r of this.results) for (const relic of list(safeGet(() => r.ModifyingRelics, []))) safeGet(() => relic.Flash(), undefined);
  }
  CardsSelected() { this.pending = tcs(); return this.pending.Task; }
  private finish(holders: any[], remove: boolean) { const p = this.pending; this.pending = null; p?.TrySetResult({ Item1: holders, Item2: remove }); }
  select(card: any, el: Element | null) {
    if (!this.clickable || !this.pending) return;
    this.taken.add(card);
    const h = holderFor(card, el);
    this.flying.set(card, h.$_CardNode);
    this.finish([h], true);
    invalidate();
  }
  /** Alternatives (Skip, Reroll, Sacrifice): OnAlternateRewardSelected, then the option's own OnSelect. */
  alt(a: any) {
    const A = G.PostAlternateCardRewardAction;
    if (a.AfterSelected !== A.None && a.AfterSelected !== A.DoNothing) this.finish([], a.AfterSelected === A.DismissScreenAndRemoveReward);
    G.TaskHelper.RunSafely(a.OnSelect());
  }
  AfterOverlayOpened() {
    if (!seenFtue('power_card_ftue') && this.cards.some((c) => c.Type === G.CardType.Power)) void showFtue('power_card_ftue', 'POWER_FTUE');
    this.lockClicks();
  }
  AfterOverlayClosed() { if (this.pending) this.finish([], false); }
}
NCardRewardSelectionScreen.ShowScreen = (options: any, alternatives: any) => { const v = new CardRewardView(options, alternatives); pushOverlay(v); return v; };

/** NChooseACardSelectionScreen: three cards at 340 px, an optional skip; the pick closes the screen. */
export class ChooseACardView extends CardRowView {
  kind = 'chooseacard';
  A = 1;
  peeking = false;
  private done = tcs();
  constructor(public cards: any[], public canSkip: boolean) { super(); this.layoutRow(cards.length, 340); }
  get UseSharedBackstop() { return true; }
  CardsSelected() { return this.done.Task.ContinueWith((t: any) => { popOverlay(this); return t.Result; }); }
  select(card: any) { if (this.clickable && !this.peeking) this.done.TrySetResult([card]); }
  skip() { this.done.TrySetResult([]); }
  AfterOverlayOpened() {
    this.A = 0;
    this.lockClicks();
    const t = play(this, new $.WebTween());
    t.TweenProperty(this, 'a', 1, 0.2);
  }
  AfterOverlayClosed() { this.peeking = false; }
}
NChooseACardSelectionScreen.ShowScreen = (cards: any, canSkip: boolean) => { const v = new ChooseACardView(list(cards), canSkip); pushOverlay(v); return v; };

/** NChooseABundleSelectionScreen: stacked bundles; clicking one spreads its cards for Cancel / Confirm. */
export class BundleView {
  kind = 'bundle';
  A = 1;
  picked = -1;
  visible = true;
  paint?: () => void;
  private done = tcs();
  constructor(public bundles: any[][]) {}
  get UseSharedBackstop() { return true; }
  CardsSelected() { return this.done.Task.ContinueWith((t: any) => { popOverlay(this); return t.Result; }); }
  pick(i: number) { this.picked = i; invalidate(); }
  cancel() { this.picked = -1; invalidate(); }
  /** ConfirmSelection: every card of the bundle flies to the deck from where it is shown. */
  confirm(els: (Element | null)[]) {
    const b = this.bundles[this.picked];
    b.forEach((card, i) => {
      const node = holderFor(card, els[i]).$_CardNode;
      if (!node) return;
      NRun.Instance.GlobalUi.ReparentCard(node);
      const target = G.PileTypeExtensions.GetTargetPosition(G.PileType.Deck, node);
      G.GodotTreeExtensions.AddChildSafely(NRun.Instance.GlobalUi.TopBar.TrailContainer, N('Vfx.NCardFlyVfx').Create(node, target, true, card.Owner.Character.TrailPath));
    });
    this.done.TrySetResult([b]);
  }
  AfterOverlayOpened() { this.A = 0; const t = play(this, new $.WebTween()); t.TweenProperty(this, 'a', 1, 0.4); }
  AfterOverlayShown() { this.visible = true; invalidate(); }
  AfterOverlayHidden() { this.visible = false; invalidate(); }
}
NChooseABundleSelectionScreen.ShowScreen = (bundles: any) => { const v = new BundleView(list(bundles).map((b: any) => list(b))); pushOverlay(v); return v; };

/**
 * NCardGridSelectionScreen and its screens: NSimpleCardSelectScreen (simple), NDeckCardSelectScreen (deck),
 * NDeckUpgradeSelectScreen (upgrade), NDeckTransformSelectScreen (transform), NDeckEnchantSelectScreen (enchant).
 * Picks toggle the cyan highlight; the deck screens open their preview at MaxSelect (or from Confirm).
 */
export type GridKind = 'simple' | 'deck' | 'upgrade' | 'transform' | 'enchant';
export class GridSelectView {
  kind = 'grid';
  selected: any[] = [];
  preview = false;
  visible = true;
  peeking = false;
  showUpgrades = false;
  results: any[] | null = null;
  enchantment: any = null; enchantAmount = 0;
  toTransformation: ((c: any) => any) | null = null;
  private done = tcs();
  constructor(public grid: GridKind, public cards: any[], public prefs: any) {}
  get UseSharedBackstop() { return true; }
  get min() { return this.prefs.MinSelect; }
  get max() { return this.prefs.MaxSelect; }
  get cancelable() { return !!this.prefs.Cancelable; }
  get prompt() { return safeGet(() => this.prefs.Prompt.GetFormattedText(), ''); }
  get single() { return this.max === 1; }
  CardsSelected() { return this.done.Task; }
  /** Confirm (bottom right): NSimpleCardSelectScreen's own rule, or the deck screens' "choose between min and max". */
  get confirmEnabled() {
    if (this.preview) return false;
    if (this.grid === 'simple') return (this.prefs.RequireManualConfirmation && this.selected.length >= this.min) || (this.min === 0 && this.selected.length === 0);
    if (this.grid === 'upgrade') return false;
    return this.min !== this.max && this.selected.length >= this.min;
  }
  click(card: any) {
    if (this.preview || this.peeking) return;
    const has = this.selected.includes(card);
    if (this.grid === 'simple') {
      if (has) this.selected = this.selected.filter((c) => c !== card);
      else {
        if (this.selected.length < this.max) this.selected = [...this.selected, card];
        if (!this.prefs.RequireManualConfirmation && this.selected.length >= this.max) return this.complete(this.selected);
      }
    } else if (has) this.selected = this.selected.filter((c) => c !== card);
    else {
      this.selected = [...this.selected, card];
      if (this.grid === 'upgrade' ? this.single || this.selected.length === this.max : this.selected.length === this.max) this.openPreview();
    }
    invalidate();
  }
  confirm() {
    if (this.grid === 'simple') return this.complete(this.selected);
    if (this.grid === 'transform' && !this.prefs.RequireManualConfirmation && this.selected.length >= this.min) return this.complete(this.selected);
    this.openPreview();
  }
  openPreview() { this.preview = true; invalidate(); }
  cancelPreview() { this.preview = false; this.selected = []; invalidate(); }
  confirmPreview() { if (this.selected.length >= Math.max(this.min, 1)) this.complete(this.selected); }
  close() { this.complete([]); }
  private complete(cards: any[]) { this.done.TrySetResult(cards); popOverlay(this); }
  togglePeek() {
    this.peeking = !this.peeking;
    if (this.peeking) hideBackstop(); else showBackstop();
    invalidate();
  }
  get peekEnabled() { return this.visible && G.CombatManager.Instance.IsInProgress; }
  AfterOverlayShown() { this.visible = true; invalidate(); }
  AfterOverlayHidden() { this.visible = false; invalidate(); }
  AfterOverlayClosed() { if (this.peeking) { this.peeking = false; } this.done.TrySetResult([]); }
}
const SC = (n: string) => N('Screens.CardSelection.' + n);
SC('NSimpleCardSelectScreen').Create = (cards: any, prefs: any) => {
  const l = list(cards);
  const v = new GridSelectView('simple', l.map((c: any) => c.Card ?? c), prefs);
  if (l.some((c: any) => c.Card)) v.results = l;
  return v;
};
SC('NDeckCardSelectScreen').Create = (cards: any, prefs: any) => new GridSelectView('deck', list(cards), prefs);
SC('NDeckUpgradeSelectScreen').ShowScreen = (cards: any, prefs: any) => { const v = new GridSelectView('upgrade', list(cards), prefs); pushOverlay(v); return v; };
SC('NDeckTransformSelectScreen').ShowScreen = (cards: any, toTransformation: any, prefs: any) => {
  const v = new GridSelectView('transform', list(cards), prefs);
  v.toTransformation = (c: any) => (typeof toTransformation === 'function' ? toTransformation(c) : toTransformation?.Invoke?.(c));
  pushOverlay(v);
  return v;
};
SC('NDeckEnchantSelectScreen').ShowScreen = (cards: any, enchantment: any, amount: number, prefs: any) => {
  const v = new GridSelectView('enchant', list(cards), prefs);
  v.enchantment = enchantment; v.enchantAmount = amount;
  pushOverlay(v);
  return v;
};

// ------------------------------------------------------------------ overlays used directly by rule code
class OverlayStackView extends NOverlayStack {
  Push(screen: any) { pushOverlay(screen); }
  Remove(screen: any) { popOverlay(screen); }
  Peek() { return ui.overlays[ui.overlays.length - 1] ?? null; }
  get ScreenCount() { return ui.overlays.length; }
  Clear() { for (let o = this.Peek(); o; o = this.Peek()) popOverlay(o); }
}

// ------------------------------------------------------------------ game root
/** NDebugAudioManager (NGame.DebugAudio): events and rest-site options play plain sound files through it. */
const NDebugAudioManager = $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager') as any;
class DebugAudioView extends NDebugAudioManager {
  Play(name: string, volume = 1, variance = 0) { return audio.playDebug(String(name), volume, variance); }
  Stop(id: number, fade = 0.5) { audio.stopDebug(id, fade); }
  SetMasterAudioVolume() {}
  SetSfxAudioVolume() {}
}
class GameView extends NGame {
  Transition = transitionView;
  ReturnToMainMenu() { import('./flow').then((f) => f.toMenu()); return $.Task.CompletedTask; }
  ReturnToMainMenuAfterRun() { return this.ReturnToMainMenu(); }
  /** NGame.CurrentRunNode: the running NRun (Nightmare adds its VFX to CurrentRunNode.GlobalUi). */
  get CurrentRunNode() { return NRun.Instance; }
  DoHitStop(strength: number, duration: number) { hitStop(strength, duration); }
  /** NGame.ScreenShake / ScreenRumble / ScreenShakeTrauma → NScreenShake (ui/screenshake.ts). */
  ScreenShake(strength: number, duration = 1, degAngle = -1) { screenShake(strength, duration, degAngle); }
  ScreenRumble(strength: number, duration = 1, style = 1) { screenRumble(strength, duration, style); }
  ScreenShakeTrauma(strength: number) { screenShakeTrauma(strength); }
  /** The 1920 × 1080 viewport (DecimillipedeSegment's rocks at its centre; PileType None / Hand target positions). */
  GetViewportRect() { return { Position: new $.Vector2(0, 0), Size: new $.Vector2(1920, 1080) }; }
}
NGame.IsReleaseGame = () => true;
NGame.IsMainThread = () => true;

// ------------------------------------------------------------------ install
export const mapView = new MapView();
const ROOM_SINGLETONS = new Set(['Rooms.NCombatRoom', 'Rooms.NEventRoom', 'Rooms.NRestSiteRoom', 'Rooms.NMerchantRoom', 'Rooms.NTreasureRoom']);
/** Web mode: every scene singleton the rule layer reaches for exists (inert unless implemented here). */
function fillSingletons() {
  const pre = 'MegaCrit.Sts2.Core.Nodes.';
  for (const key of $.extKeys().stubs as string[]) {
    if (!key.startsWith(pre) || ROOM_SINGLETONS.has(key.slice(pre.length))) continue;
    const cls = $.ext(key);
    const d = Object.getOwnPropertyDescriptor(cls, 'Instance');
    if (!d || !d.get || cls.Instance != null) continue;
    cls.Instance = $.dummy(cls);
  }
}

/**
 * NCrystalSphereScreen: the Crystal Sphere event's divination board. CrystalSphereMinigame holds the rules (fog cells,
 * hidden items, tools, divination count) and offers the rewards itself once the divinations run out. The view keeps
 * what the scene's nodes animate: the screen fade, NCrystalSphereMask's per-cell fog fades (the scry_reveal shader's
 * gridFadeParams / time), each NCrystalSphereCell's highlight, each NCrystalSphereItem's reveal and the dialogue line.
 */
const NCrystalSphereScreen = N('Events.Custom.CrystalSphere.NCrystalSphereScreen');
export class CrystalSphereView {
  kind = 'crystalsphere';
  UseSharedBackstop = false;
  busy = false;
  done = false;
  proceedOn = false;
  itemsShown = false;
  fx = { A: 0 };
  /** NCrystalSphereMask: (from alpha, to alpha, start time) per cell, and its clock. */
  fades = new Float32Array(121 * 3);
  time = 0;
  /** Cell highlight modulate (0.15 s) per cell, item reveal state per item. */
  cellA = new Map<any, { A: number; t: any }>();
  items = new Map<any, { Val: number; Scale: number }>();
  big = true;
  /** NCrystalSphereDialogue: the line, its x (random in 1100–1200) and a counter restarting the tween. */
  line = { text: '', x: 1291, gen: 0 };
  paint?: () => void;
  constructor(public game: any) {
    this.fades.set([1, 0, 0], 3 * 3); // NCrystalSphereMask._Ready
    for (const col of Array.from(game.cells as any[])) for (const cell of Array.from(col as any[])) {
      this.cellA.set(cell, { A: 0, t: null });
      cell.HighlightUpdated = $.dcombine(cell.HighlightUpdated, () => this.highlight(cell));
      cell.FogUpdated = $.dcombine(cell.FogUpdated, () => this.fog(cell));
    }
    for (const it of list(game.Items)) {
      this.items.set(it, { Val: 0, Scale: 1 });
      it.Revealed = $.dcombine(it.Revealed, () => this.revealed(it));
    }
    game.DivinationCountChanged = $.dcombine(game.DivinationCountChanged, () => invalidate());
    game.Finished = $.dcombine(game.Finished, () => this.finished());
    $.onFrame((dt: number) => { this.time += dt; this.paint?.(); return ui.overlays.includes(this); });
  }
  /** NCrystalSphereCell.OnEntityHighlightUpdated: white while highlighted and still hidden (0.15 s). */
  private highlight(cell: any) {
    const c = this.cellA.get(cell)!;
    c.t?.Kill();
    c.t = play(this, new $.WebTween());
    c.t.TweenProperty(c, 'a', cell.IsHighlighted && cell.IsHidden ? 1 : 0, 0.15);
    invalidate();
  }
  /** NCrystalSphereMask.UpdateMat. */
  private fog(cell: any) {
    const i = (cell.Y * 11 + cell.X) * 3, f = this.fades;
    const from = f[i + 2] === 0 ? 1 : f[i + 1];
    f.set([from, cell.IsHidden ? 1 : 0, this.time], i);
    invalidate();
  }
  /** NCrystalSphereItem.OnRevealed (the shine and the icon's bump) and NCrystalSphereScreen.OnItemRevealed (a line). */
  private revealed(it: any) {
    const r = this.items.get(it)!;
    const t = play(this, new $.WebTween());
    t.TweenInterval(0.25);
    t.Chain().TweenProperty(r, 'val', 1, 0.5).From(0);
    t.Parallel().TweenProperty(r, 'scale', 1.2, 0.15);
    t.Parallel().TweenProperty(r, 'scale', 1, 0.5).SetDelay(0.15);
    this.say(it.IsGood ? 'REVEAL_GOOD' : 'REVEAL_BAD', it.IsGood ? 5 : 3);
  }
  say(key: string, n: number) {
    const text = loc('events', `CRYSTAL_SPHERE.banter.${key}.${1 + Math.floor(Math.random() * n)}`);
    this.line = { text, x: 1100 + Math.random() * 100, gen: this.line.gen + 1 };
    invalidate();
  }
  /** SetBigDivination / SetSmallDivination. */
  tool(big: boolean) { this.big = big; this.game.SetTool(big ? G.CrystalSphereMinigame_CrystalSphereToolType.Big : G.CrystalSphereMinigame_CrystalSphereToolType.Small); invalidate(); }
  hover(cell: any) { if (cell) { if (!this.game.IsFinished) this.game.SetHoveredCell(cell); } else this.game.UnsetHoveredCell(); invalidate(); }
  /** OnCellClicked: only while divinations remain. */
  click(cell: any) {
    if (this.busy || this.game.DivinationCount <= 0 || !cell.IsHidden) return;
    this.busy = true; invalidate();
    Promise.resolve(G.TaskHelper.RunSafely(this.game.CellClicked(cell))).finally(() => { this.busy = false; invalidate(); });
  }
  /** OnMinigameFinished: the tools and texts go, the proceed button comes, and a closing line. */
  private finished() {
    this.done = true; this.proceedOn = true;
    this.say('END', 2);
    safeGet(() => NMapScreen.Instance.SetTravelEnabled(true), undefined);
  }
  proceed() { G.TaskHelper.RunSafely(G.RunManager.Instance.ProceedFromTerminalRewardsScreen()); }
  /** NOverlayStack.Remove (tools/e2e/coverage dismisses a finished board without leaving the room). */
  close() { if (this.done) popOverlay(this); }
  /** AfterOverlayOpened: fade in over 0.5 s, then the opening line and the items. */
  AfterOverlayOpened() {
    const t = play(this, new $.WebTween());
    t.TweenProperty(this.fx, 'a', 1, 0.5).From(0);
    t.Chain().TweenCallback(() => { this.say('START', 2); this.itemsShown = true; invalidate(); });
  }
  AfterOverlayShown() { if (this.game.IsFinished) this.proceedOn = true; invalidate(); }
  AfterOverlayHidden() { this.proceedOn = false; invalidate(); }
  AfterOverlayClosed() { safeGet(() => this.game.ForceMinigameEnd(), undefined); }
}
NCrystalSphereScreen.ShowScreen = (game: any) => {
  const v = new CrystalSphereView(game);
  pushOverlay(v);
  return v;
};

// RollingBoulderPower deals its damage from NRollingBoulderVfx's HitCreature signal (one per creature the boulder rolls
// over) and then awaits the node leaving the tree. No boulder animation here: every target is hit right away.
const NRollingBoulderVfx = N('Vfx.NRollingBoulderVfx');
NRollingBoulderVfx.Create = (creatures: any) => {
  const v = $.dummy(NRollingBoulderVfx);
  const targets = list(creatures);
  v.Connect = (signal: any, callable: any) => {
    if (String(signal) === 'HitCreature') for (const c of targets) callable.Call(NCombatRoom.Instance?.GetCreatureNode?.(c) ?? { Entity: c });
    return 0;
  };
  v.IsInsideTree = () => true;
  return v;
};

// ------------------------------------------------------------------ speech bubbles (NSpeechBubbleVfx / TalkCmd)
export const bubbles: { id: number; c: any; pos: [number, number] | null; text: string; thought?: boolean; secs?: number | null; color?: number[]; side?: number }[] = [];
let bubbleId = 0;
/**
 * NSpeechBubbleVfx / NThoughtBubbleVfx.GetCreatureSpeechPosition (taken once, at Create): the visuals' TalkPos, else
 * VfxSpawnPosition moved up ¾ of half the hitbox and out ¾ of its width to the speaker's front (Hitbox.Size is local).
 */
function speechPosition(speaker: any): [number, number] | null {
  const node = NCombatRoom.Instance?.GetCreatureNode?.(speaker), s = node?.slot;
  if (!node || !s) return null;
  const tp = spineIndex[visualsKey(speaker)]?.talkPos;
  if (tp) return [s.x + tp[0] * s.s, s.y + tp[1] * s.s];
  const p = node.VfxSpawnPosition, w = s.w / s.s, h = s.h / s.s;
  return [p.X + (speaker.Side === G.CombatSide.Player ? 1 : -1) * w * 0.75, p.Y - h * 0.5 * 0.75];
}
const NSpeechBubbleVfx = N('Vfx.NSpeechBubbleVfx');
// Create(text, speaker, seconds, color) | Create(text, side, globalPosition, seconds, color)
NSpeechBubbleVfx.Create = function (text: string, a: any, b: any, c?: any) {
  const bySpeaker = a && typeof a === 'object' && 'CurrentHp' in a;
  const id = ++bubbleId;
  const secs = Number(bySpeaker ? b : c);
  // DialogueSide (None 0, Left 1, Right 2): a speaker's from its combat side; Right opens to the anchor's left
  const side = bySpeaker ? (a.Side === G.CombatSide.Player ? 1 : 2) : Number(a);
  // VfxColor presets on the bubble's hsv shader (h, s, v)
  const vc = bySpeaker ? c : arguments[4];
  const color = ({ 0: [0.48, 2, 0.5], 1: [0.8, 1.5, 0.6], 2: [0.05, 1.3, 0.55], 3: [0.3, 0.6, 0.5], 4: [1, 0.25, 0.3] } as Record<number, number[]>)[vc] ?? [1, 0.9, 0.5];
  bubbles.push({ id, c: bySpeaker ? a : null, pos: bySpeaker ? speechPosition(a) : [b?.X ?? 960, b?.Y ?? 400], text: String(text ?? ''), secs, color, side });
  invalidate();
  const remove = () => { const i = bubbles.findIndex((x) => x.id === id); if (i >= 0) { bubbles.splice(i, 1); invalidate(); } };
  // bubble in (0.5 s), hold max(seconds − 1, 1), fade out (0.4 s)
  setTimeout(remove, (0.5 + Math.max(secs - 1, 1) + 0.4) * 1000);
  const node = $.dummy(NSpeechBubbleVfx);
  node.SecondsToDisplay = secs;
  node.AnimOut = () => { remove(); return $.Task.CompletedTask; };
  return node;
};

/**
 * NThoughtBubbleVfx.Create(text, speaker, seconds): ThinkCmd lines and "can't play" reasons over the speaker (DialogueSide
 * Left for players, Right for enemies). It waits max(seconds, 1) from its start, then GoAway fades it (0.4 s) and frees it.
 */
const NThoughtBubbleVfx = N('Vfx.NThoughtBubbleVfx');
NThoughtBubbleVfx.Create = (text: any, speaker: any, seconds: any) => {
  if (G.TestMode.IsOn || typeof text !== 'string' || !speaker || typeof speaker !== 'object' || !('CurrentHp' in speaker)) return null;
  const id = ++bubbleId;
  const secs = seconds == null ? null : Number(seconds);
  bubbles.push({ id, c: speaker, pos: speechPosition(speaker), text, thought: true, secs, side: speaker.Side === G.CombatSide.Player ? 1 : 2 });
  invalidate();
  if (secs != null) setTimeout(() => { const i = bubbles.findIndex((x) => x.id === id); if (i >= 0) { bubbles.splice(i, 1); invalidate(); } }, (Math.max(secs, 1) + 0.4) * 1000);
  return null; // shown directly; CombatVfxContainer.AddChildSafely(null) is a no-op
};

// ------------------------------------------------------------------ floating numbers (NDamageNumVfx / NHealNumVfx)
/**
 * Power VFX in CombatVfxContainer (ui/creature-ui.tsx PowerPop): NPowerAppliedVfx (icon + name, 'applied'),
 * NPowerFlashVfx (the big icon, 'flash') and NPowerRemovedVfx ("Wears Off", 'removed'); freed after `ms`.
 */
export interface PowerPopData { id: number; kind: 'applied' | 'flash' | 'removed'; x: number; y: number; icon: string | null; title: string; buff: boolean; sub?: string }
export const powerPops: PowerPopData[] = [];
function addPowerPop(p: Omit<PowerPopData, 'id'>, ms: number) {
  const id = ++floaterId;
  powerPops.push({ id, ...p });
  invalidate();
  setTimeout(() => { const i = powerPops.findIndex((f) => f.id === id); if (i >= 0) powerPops.splice(i, 1); invalidate(); }, ms);
}
/** PowerModel.BigIcon (ResolvedBigIconPath: the power's big icon, its beta art or missing_power). */
const bigIcon = (power: any): string | null => safeGet(() => power.ResolvedBigIconPath, null);
/** NDamageNumVfx / NHealNumVfx / NDamageBlockedVfx at their global spawn position (_Ready takes it once). */
export const floaters: { id: number; x: number; y: number; text: string; kind: 'dmg' | 'heal' | 'blocked'; c?: any }[] = [];

/** NCombatStartBanner / NPlayerTurnBanner / NEnemyTurnBanner: a title across the screen for a moment. */
const fmtLoc = (ls: any) => { try { return ls?.GetFormattedText?.() ?? String(ls ?? ''); } catch { return ''; } };
// NCombatStartBanner / NPlayerTurnBanner / NEnemyTurnBanner: drawn by ui/banners.tsx
const bannerNode = (path: string, show: (...a: any[]) => void) => { const T = N(path); T.Create = (...a: any[]) => { show(...a); return $.dummy(T); }; };
bannerNode('Combat.NCombatStartBanner', () => spawnCombatBanner('start'));
bannerNode('Combat.NEnemyTurnBanner', () => spawnCombatBanner('enemy'));
bannerNode('Combat.NPlayerTurnBanner', (round: number) => spawnCombatBanner('player', round));
let floaterId = 0;
function floatText(x: number, y: number, text: string, kind: 'dmg' | 'heal' | 'blocked') {
  const id = ++floaterId;
  floaters.push({ id, x, y, text, kind });
  invalidate();
  setTimeout(() => { const i = floaters.findIndex((f) => f.id === id); if (i >= 0) floaters.splice(i, 1); invalidate(); }, 2100);
}
const creatureNode = (c: any) => NCombatRoom.Instance?.GetCreatureNode?.(c) ?? null;
const NDamageNumVfx = N('Vfx.NDamageNumVfx');
const NHealNumVfx = N('Vfx.NHealNumVfx');
/**
 * NDamageNumVfx.Create(target, DamageResult): unblocked + overkill (Osty shows no overkill) | (target, damage,
 * requireInteractable = true): at VfxSpawnPosition + (0, −100) ± (10, 5) — a hidden target's number only for the local
 * player, at a quarter of the screen | (globalPosition, damage).
 */
NDamageNumVfx.Create = (a: any, b: any, requireInteractable = true): any => {
  if (a && 'X' in a && !('CurrentHp' in a)) {
    if (G.TestMode.IsOn) return null;
    floatText(a.X, a.Y, String(Math.trunc(Number(b))), 'dmg');
    return $.dummy(NDamageNumVfx);
  }
  const damage = typeof b === 'object' && b ? b.UnblockedDamage + (a.Monster instanceof G.Osty ? 0 : b.OverkillDamage) : Number(b);
  const node = creatureNode(a);
  let pos = new $.Vector2(0, 0);
  if (requireInteractable && (!node || !node.IsInteractable)) {
    if (!G.LocalContext.IsMe$Creature(a)) return null;
    pos = new $.Vector2(1920 * 0.25, 1080 * 0.5);
  } else if (node) {
    const p = node.VfxSpawnPosition;
    pos = new $.Vector2(p.X + G.Rng.Chaotic.NextFloat$2(-10, 10), p.Y - 100 + G.Rng.Chaotic.NextFloat$2(-5, 5));
  }
  return NDamageNumVfx.Create(pos, damage);
};
/** NHealNumVfx.Create: only over an interactable creature, at VfxSpawnPosition + (0, −100) ± (10, 5). */
NHealNumVfx.Create = (c: any, amount: any) => {
  const node = creatureNode(c);
  if (!node || !node.IsInteractable) return null;
  const p = node.VfxSpawnPosition;
  floatText(p.X + G.Rng.Chaotic.NextFloat$2(-10, 10), p.Y - 100 + G.Rng.Chaotic.NextFloat$2(-5, 5), String(Math.trunc(Number(amount))), 'heal');
  return $.dummy(NHealNumVfx);
};
/** NDamageBlockedVfx: "Blocked" over a fully blocked hit at VfxSpawnPosition ± 20, −40…−60 (interactable creatures). */
const NDamageBlockedVfx = N('Vfx.NDamageBlockedVfx');
NDamageBlockedVfx.Create = (c: any) => {
  const node = creatureNode(c);
  if (G.TestMode.IsOn || !node?.IsInteractable) return null;
  const p = node.VfxSpawnPosition;
  floatText(p.X + G.Rng.Chaotic.NextFloat$2(-20, 20), p.Y + G.Rng.Chaotic.NextFloat$2(-60, -40), loc('vfx', 'BLOCKED'), 'blocked');
  return $.dummy(NDamageBlockedVfx);
};

// ------------------------------------------------------------------ VfxCmd → scenes in CombatVfxContainer (render/cardfx)
// PlayOnCreature(Center) / PlayOnSide / … are the transpiled ones: they end in PlayVfx at a creature node's position.
G.VfxCmd.PlayVfx = (pos: any, path: string) => { if (!G.TestMode.IsOn && NCombatRoom.Instance && path) playCombatVfx(path, pos.X, pos.Y); };
G.VfxCmd.PlayFullScreenInCombat = (path: string) => G.VfxCmd.PlayVfx(new $.Vector2(960, 540), path);
/** NHitSparkVfx / NBlockSparkVfx: the spark scenes at the creature's CenterPos (only while it is interactable). */
const spark = (scene: string) => (target: any, requireInteractable = true) => {
  const n = NCombatRoom.Instance?.GetCreatureNode?.(target);
  if (n && (!requireInteractable || n.IsInteractable)) { const p = n.VfxSpawnPosition; playCombatVfx(scene, p.X, p.Y); }
  return null;
};
N('Vfx.NHitSparkVfx').Create = spark('vfx/hit_spark_vfx');
N('Vfx.NItemThrowVfx').Create = (src: any, dst: any, tex: any, scale: any) => {
  if (!G.TestMode.IsOn) playItemThrow([src.X, src.Y], [dst.X, dst.Y], tex?.ResourcePath ?? null, scale?.X ?? 1);
  return null;
};
N('Vfx.NBlockSparkVfx').Create = (target: any) => spark('vfx/block_spark_vfx')(target);

// ------------------------------------------------------------------ audio (FMOD event paths → audio.ts)
const NAudioManager = N('Audio.NAudioManager');
const NRunMusicController = N('Audio.NRunMusicController');
class AudioManagerView extends NAudioManager {
  // PlayOneShot(path, volume) | PlayOneShot(path, parameters, volume)
  PlayOneShot(path: string, a?: any, b?: any) {
    const params = a && typeof a === 'object' ? Object.fromEntries(a as Iterable<[string, number]>) : undefined; // Dictionary<string, float>
    audio.playOneShot(path, typeof a === 'number' ? a : typeof b === 'number' ? b : 1, params);
  }
  PlayLoop(path: string, usesLoopParam = true) { audio.playLoop(path, usesLoopParam); }
  StopLoop(path: string) { audio.stopLoop(path); }
  StopAllLoops() { audio.stopAllLoops(); }
  SetParam(path: string, param: string, value: number) { audio.setLoopParam(path, param, value); }
  PlayMusic(path: string) { audio.playMusic(path); }
  UpdateMusicParameter(param: string, label: string) { audio.setMusicParam(param, label); }
  StopMusic() { audio.stopMusic(); }
}
/** NRunMusicController without the FMOD proxy: act track + Progress sections + ambience. */
class MusicControllerView extends NRunMusicController {
  runState: any = null;
  track = '';
  SetRunState(rs: any) { this.runState = rs; }
  UpdateMusic() {
    const act = this.runState?.Act;
    if (!act) return;
    const opts = list(act.BgMusicOptions);
    const i = new G.Rng().$ctor_Rng$UInt32_Int32(this.runState.Rng.Seed >>> 0, 0).NextInt$2(0, opts.length);
    this.track = opts[i] ?? opts[0];
    audio.playMusic(this.track);
    audio.setMusicProgress(0);
    this.UpdateAmbience();
  }
  PlayCustomMusic(ev: string) { audio.playMusic(ev); }
  StopCustomMusic() { if (this.track) { audio.playMusic(this.track); audio.setMusicProgress(7); } }
  UpdateCustomTrack() {} // music_controller_proxy.gd has no update_custom_track: the game's _proxy.Call fails, a no-op there too
  UpdateAmbience() {
    const rs = this.runState;
    let amb = rs?.Act?.AmbientSfx ?? '';
    const enc = rs?.CurrentRoom?.Encounter;
    if (enc?.HasAmbientSfx) amb = enc.AmbientSfx;
    audio.setAmbience(amb);
  }
  UpdateTrack() {
    const rs = this.runState, room = rs?.CurrentRoom;
    if (!room) return;
    const T = G.RoomType, t = room.RoomType;
    let p = 0; // MusicProgressTrack
    if (G.RoomTypeExtensions?.IsCombatRoom?.(t) && !G.CombatManager.Instance.IsInProgress) p = 7;
    else if (t === T.Shop) p = 2; else if (t === T.RestSite) p = 3; else if (t === T.Treasure) p = 5; else if (t === T.Monster) p = 1;
    else if (t === T.Event) p = room.CanonicalEvent instanceof G.AncientEventModel ? 0 : 4;
    else if (t === T.Elite || t === T.Boss) p = 6;
    audio.setMusicProgress(p);
    if (t === T.RestSite) audio.setCampfire(0); // update_campfire_ambience(0): CampfireState.On
  }
  UpdateMusicParameter(label: string, value: number) { audio.setMusicParam(label, value); }
  ToggleMerchantTrack() { audio.setMusicProgress(ui.mapOpen ? 9 : 2); }
  TriggerEliteSecondPhase() { audio.setMusicProgress(8); }
  TriggerCampfireGoingOut() { audio.setCampfire(1); } // CampfireState.Off
  StopMusic() { audio.stopMusic(); audio.stopAmbience(); }
}
const musicController = new MusicControllerView();

export function installBridge() {
  NAudioManager.Instance = new AudioManagerView();
  NRunMusicController.Instance = musicController;
  NGame.Instance = new GameView();
  NDebugAudioManager.Instance = new DebugAudioView();
  NMapScreen.Instance = mapView;
  NOverlayStack.Instance = new OverlayStackView();
  fillSingletons();
  // Godot scene/texture preloading has no web equivalent: assets stream on demand
  for (const k of Object.getOwnPropertyNames(G.PreloadManager)) if (/^Load/.test(k) && typeof G.PreloadManager[k] === 'function') G.PreloadManager[k] = () => $.Task.CompletedTask;
  // DailyRunUtility.UploadScore goes to a platform leaderboard: keep the day's first score locally instead
  G.DailyRunUtility.UploadScore = (time: any, score: number) => { recordDailyScore(time, score); return $.Task.CompletedTask; };
  // NCombatUi / NPower refresh on the tracker's (frame-deferred, coalesced) notifications
  const tracker = G.CombatManager.Instance.StateTracker;
  tracker.CombatStateChanged = $.dcombine(tracker.CombatStateChanged, () => { NCombatRoom.Instance?.Ui?.Hand?.OnCombatStateChanged?.(); invalidate(); });
  // NCombatUi.OnCombatWon: offer rewards once the death animations are done (ShowRewards), or proceed after 1 s
  G.CombatManager.Instance.CombatWon = $.dcombine(G.CombatManager.Instance.CombatWon, (room: any) => {
    const run = async () => {
      if (!room.Encounter.ShouldGiveRewards) { await G.Cmd.Wait$2(1); await G.RunManager.Instance.ProceedFromTerminalRewardsScreen(); return; }
      const num = deathAnimRemaining();
      if (room.RoomType === G.RoomType.Boss) await G.Cmd.CustomScaledWait(num * 0.5, num + 1);
      else await G.Cmd.CustomScaledWait(0.5, num + 1);
      const me = room.CombatState?.Players?.[0] ?? G.RunManager.Instance.State.Players[0];
      await G.RewardsCmd.OfferForRoomEnd(me, room);
    };
    run().catch((e) => console.error(e));
  });
  // NOrbManager.OnCombatSetup: the players' orb slots fly out
  G.CombatManager.Instance.CombatSetUp = $.dcombine(G.CombatManager.Instance.CombatSetUp, () => {
    for (const v of creatureViewsRef.get()) (v as any).OrbManager?.onCombatSetup();
  });
  // NCombatUi.AnimOut (CombatEnded): the hand sinks away and the play queue gives its cards back; NCreature.OnCombatEnded
  // clears the orbs
  G.CombatManager.Instance.CombatEnded = $.dcombine(G.CombatManager.Instance.CombatEnded, () => {
    for (const v of creatureViewsRef.get()) (v as any).OrbManager?.ClearOrbs();
    const u = NCombatRoom.Instance?.Ui;
    u?.Hand?.AnimOut?.();
    u?.PlayQueue?.AnimOut?.();
  });
  log('installed');
}
export function attachRun(runState: any) {
  NRun.Instance = new RunView(runState);
  musicController.SetRunState(runState);
}
