// Web stand-ins for the combat card nodes the rule layer choreographs, keeping the original parameters: NCard,
// NPlayerHand + NHandCardHolder (HandPosHelper layout, hover, per-frame lerps), NCardPlayQueue, NCardPlay /
// NMouseCardPlay, NTargetManager + NTargetingArrow, the NCombatUi containers and piles, and the card VFX (NCardFlyVfx,
// NCardFlyShuffleVfx, NCardFlyPowerVfx, NExhaustVfx, NCardTrailVfx). CardPileCmd's tweens (rt/tween) move these
// nodes; ui/cardlayer.tsx draws them every frame.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { G, $, N } from './game';
import { invalidate, animateAcquired } from './store';
import { view, edge, fracY, anchored } from './view';

const NCard = N('Cards.NCard');
const NPlayerHand = N('Combat.NPlayerHand');
const NHandCardHolder = N('Cards.Holders.NHandCardHolder');
const NCardPlayQueue = N('Combat.NCardPlayQueue');
const NCombatUi = N('Combat.NCombatUi');
const NCardFlyVfx = N('Vfx.NCardFlyVfx');
const NCardFlyShuffleVfx = N('Vfx.NCardFlyShuffleVfx');
const NCardFlyPowerVfx = N('Vfx.NCardFlyPowerVfx');
const NExhaustVfx = N('Vfx.Cards.NExhaustVfx');
const NThoughtBubbleVfx = N('Vfx.NThoughtBubbleVfx');
const NCreature = N('Combat.NCreature');
/** NodeUtil.IsDescendant over the web nodes' parent links. */
$.ext('MegaCrit.Sts2.Core.Nodes.GodotExtensions.NodeUtil').IsDescendant = (parent: any, node: any) => !!parent?.IsAncestorOf?.(node);
const Control = $.ext('Godot.Control');

const v2 = (x = 0, y = 0) => new $.Vector2(x, y);
const white = () => new $.Color(1, 1, 1, 1);
const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const tween = () => new $.WebTween();
/** Godot's Mathf.Lerp(a, b, delta * speed) per frame; capped so a long frame cannot overshoot. */
const k = (dt: number, speed: number) => Math.min(1, dt * speed);
/** MathHelper.BezierCurve: quadratic Bézier through control point c. */
export function bezier(a: any, b: any, c: any, t: number) {
  const u = 1 - t;
  return v2(u * u * a.X + 2 * u * t * c.X + t * t * b.X, u * u * a.Y + 2 * u * t * c.Y + t * t * b.Y);
}

// ------------------------------------------------------------------ scene tree + 2D transforms
export interface Xf { x: number; y: number; rot: number; sx: number; sy: number }
/** AddChild / RemoveChild / Reparent / QueueFree and local ↔ global transforms for the web nodes. */
export function Web<B extends new (...a: any[]) => any>(Base: B) {
  return class extends Base {
    $parent: any = null;
    $kids: any[] = [];
    $freed = false;
    $onExit: (() => void)[] = [];
    Position = v2();
    Rotation = 0;
    Scale = v2(1, 1);
    Modulate = white();
    Visible = true;
    ZIndex = 0;
    get RotationDegrees() { return (this.Rotation * 180) / Math.PI; }
    set RotationDegrees(d: number) { this.Rotation = (d * Math.PI) / 180; }
    xf(): Xf {
      const l = { x: this.Position.X, y: this.Position.Y, rot: this.Rotation, sx: this.Scale.X, sy: this.Scale.Y };
      const p: Xf | null = this.$parent?.xf?.() ?? null;
      if (!p) return l;
      const c = Math.cos(p.rot), s = Math.sin(p.rot), x = l.x * p.sx, y = l.y * p.sy;
      return { x: p.x + x * c - y * s, y: p.y + x * s + y * c, rot: p.rot + l.rot, sx: p.sx * l.sx, sy: p.sy * l.sy };
    }
    get GlobalPosition() { const t = this.xf(); return v2(t.x, t.y); }
    set GlobalPosition(g: any) {
      const p: Xf | null = this.$parent?.xf?.() ?? null;
      if (!p) { this.Position = v2(g.X, g.Y); return; }
      const c = Math.cos(-p.rot), s = Math.sin(-p.rot), dx = g.X - p.x, dy = g.Y - p.y;
      this.Position = v2((dx * c - dy * s) / (p.sx || 1), (dx * s + dy * c) / (p.sy || 1));
    }
    /** Product of the modulates down the tree (Godot's CanvasItem modulate inheritance). */
    modulate(): number[] {
      const p = this.$parent?.modulate?.() ?? [1, 1, 1, 1], m = this.Modulate;
      return [p[0] * m.R, p[1] * m.G, p[2] * m.B, p[3] * m.A];
    }
    AddChild(c: any) {
      // only web nodes live in this tree; the bridge draws its other VFX stand-ins (damage numbers, sparks) itself
      if (!c || c === this || !('$kids' in c)) return;
      c.$parent?.RemoveChild?.(c);
      this.$kids.push(c);
      c.$parent = this;
      c.$entered?.();
      this.$childEntered?.(c);
      invalidate();
    }
    RemoveChild(c: any) {
      const i = this.$kids.indexOf(c);
      if (i >= 0) this.$kids.splice(i, 1);
      if (c?.$parent === this) c.$parent = null;
      this.$childExited?.(c);
      invalidate();
    }
    GetParent() { return this.$parent; }
    GetChildren() { return [...this.$kids]; }
    GetChildCount() { return this.$kids.length; }
    GetIndex() { return this.$parent ? this.$parent.$kids.indexOf(this) : 0; }
    MoveChild(c: any, i: number) {
      const ks = this.$kids, j = ks.indexOf(c);
      if (j < 0) return;
      ks.splice(j, 1);
      ks.splice(i < 0 ? ks.length + 1 + i : Math.min(i, ks.length), 0, c);
      invalidate();
    }
    IsAncestorOf(n: any) { for (let p = n?.$parent; p; p = p.$parent) if (p === this) return true; return false; }
    IsInsideTree() { return !this.$freed && !!this.$parent; }
    Reparent(p: any, keepGlobal = true) {
      const g = this.xf();
      p.AddChild(this);
      if (keepGlobal) {
        this.GlobalPosition = v2(g.x, g.y);
        const pp: Xf | null = p.xf?.() ?? null;
        if (pp) { this.Rotation = g.rot - pp.rot; this.Scale = v2(g.sx / (pp.sx || 1), g.sy / (pp.sy || 1)); }
      }
    }
    QueueFree() {
      if (this.$freed) return;
      this.$freed = true;
      for (const c of [...this.$kids]) c.QueueFree?.();
      this.$parent?.RemoveChild(this);
      for (const f of this.$onExit.splice(0)) f();
    }
  };
}
/** A node property that follows the viewport (an anchor or offsets against its edges). */
const pin = <T extends object>(n: T, prop: string, get: () => any): T => Object.defineProperty(n, prop, { get, set() {}, configurable: true });
/** A plain Control at a fixed position (the NCombatUi containers, CombatVfxContainer). */
export class ContainerNode extends Web(Control) {
  /** Full-rect containers (combat_ui.tscn anchors 0..1) are the frame: its centre is the viewport's. */
  Size = v2(1920, 1080);
  constructor(x = 0, y = 0, public label = '') { super(); this.Position = v2(x, y); }
  IsInsideTree() { return true; }
}

/** NCardPreviewContainer: a row of cards 325 px apart, centred 50 px below the middle. */
export class PreviewRow extends ContainerNode {
  $childEntered() {
    const n = this.$kids.length, cx = this.Size.X / 2, cy = this.Size.Y / 2 + 50;
    this.$kids.forEach((c: any, i: number) => { c.Position = v2(cx - ((n - 1) * 325) / 2 + 325 * i, cy); });
  }
}
/** NGridCardPreviewContainer: rows of cards (NCard.defaultSize + 25 px) as many as fit across the screen. */
export class PreviewGrid extends ContainerNode {
  private forced: number | null = null;
  ForceMaxColumnsUntilEmpty(n: number) { this.forced = n; }
  $childEntered() {
    const n = this.$kids.length, W = 325, H = 447;
    let cols = Math.floor(view.w / W);
    const rows = Math.ceil(n / cols);
    if (this.forced != null) cols = Math.min(cols, this.forced);
    const cx = this.Size.X / 2, cy = this.Size.Y / 2 + 50;
    this.$kids.forEach((c: any, i: number) => {
      const r = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, n - r * cols);
      c.Position = v2(cx - ((inRow - 1) * W) / 2 + W * col, cy - ((rows - 1) * H) / 2 + H * r);
    });
  }
  $childExited() { if (!this.$kids.length) this.forced = null; }
}
/** NMessyCardPreviewContainer: cards scattered by Poisson-disc samples (radius 150), restarting after 2 s of quiet. */
export class PreviewMessy extends ContainerNode {
  private samples: Iterator<number[]> | null = null;
  private resetAt = 0;
  $childEntered(c: any) {
    const now = performance.now();
    if (now > this.resetAt || !this.samples) this.samples = poisson(this.Size.X, this.Size.Y, 150);
    this.resetAt = now + 2000;
    let r = this.samples.next();
    if (r.done) { this.samples = poisson(this.Size.X, this.Size.Y, 150); r = this.samples.next(); }
    c.Position = v2(r.value[0], r.value[1]);
  }
}
function* poisson(w: number, h: number, radius: number): Generator<number[]> {
  const cell = radius / Math.SQRT2, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), r2 = radius * radius;
  const grid: (number[] | null)[] = new Array(gw * gh).fill(null), active: number[][] = [];
  const add = (p: number[]) => { active.push(p); grid[Math.floor(p[1] / cell) * gw + Math.floor(p[0] / cell)] = p; return p; };
  const far = (p: number[]) => {
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    for (let y = Math.max(gy - 2, 0); y <= Math.min(gy + 2, gh - 1); y++)
      for (let x = Math.max(gx - 2, 0); x <= Math.min(gx + 2, gw - 1); x++) {
        const q = grid[y * gw + x];
        if (q && (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r2) return false;
      }
    return true;
  };
  yield add([w / 2, h / 2]);
  while (active.length) {
    const i = Math.floor(Math.random() * active.length), v = active[i];
    let found = false;
    for (let j = 0; j < 30; j++) {
      const a = Math.PI * 2 * Math.random(), d = Math.sqrt(Math.random() * 3 * r2 + r2);
      const p = [v[0] + d * Math.cos(a), v[1] + d * Math.sin(a)];
      if (p[0] >= 0 && p[1] >= 0 && p[0] < w && p[1] < h && far(p)) { found = true; yield add(p); break; }
    }
    if (!found) { active[i] = active[active.length - 1]; active.pop(); }
  }
}

// ------------------------------------------------------------------ NCard
const TRANSPARENT = () => new $.Color(0, 0, 0, 0);
/** NCardHighlight: the SDF glow's shader width, tweened by AnimShow / AnimHide / AnimFlash. */
export class CardHighlight {
  static playable = [0, 0.957, 0.988, 0.98];
  static gold = [1, 0.784, 0, 0.98];
  static red = [0.83, 0, 0.33, 0.98];
  width = 0;
  color = CardHighlight.playable;
  private tw: any = null;
  private set = (v: number) => { this.width = v; };
  AnimShow() { this.tw?.Kill(); this.tw = tween(); this.tw.TweenMethod(this.set, this.width, 0.075, 0.5).SetEase(1).SetTrans(7); }
  AnimHide() { this.tw?.Kill(); this.tw = tween(); this.tw.TweenMethod(this.set, this.width, 0, 0.5); }
  AnimHideInstantly() { this.tw?.Kill(); this.width = 0; }
  AnimFlash() {
    this.tw?.Kill();
    this.tw = tween();
    this.tw.TweenMethod(this.set, this.width, 0.15, 0.1);
    this.tw.TweenMethod(this.set, 0.15, 0.075, 0.35).SetEase(1).SetTrans(7);
  }
}
let cardIds = 0;
export class CardNodeView extends Web(NCard) {
  id = ++cardIds;
  /** NCard.Body: the card visuals NCardFlyVfx shrinks and darkens. */
  Body = { Scale: v2(1, 1), Modulate: white() };
  CardHighlight = new CardHighlight();
  pileType = G.PileType.None;
  previewMode = 0;
  previewTarget: any = null;
  PlayPileTween: any = null;
  /** SetPretendCardCanBePlayed / SetForceUnpoweredPreview (hand selection prefs). */
  pretend = false;
  unpowered = false;
  /** NCard.EnchantmentTab / EnchantmentVfxOverride: NCardEnchantVfx hides the tab and paints its reveal into `canvas`. */
  EnchantmentTab = { Visible: true };
  EnchantmentVfxOverride = { Visible: false, canvas: null as HTMLCanvasElement | null };
  /** CSS filter on the drawn card (NCardTransformVfx's shader on its SubViewport render). */
  cssFilter = '';
  get Size() { return v2(0, 0); }
  constructor(model: any) { super(); this.Model = model; }
  UpdateVisuals(pile: number, mode: number) { this.pileType = pile; this.previewMode = mode; this.EnchantmentTab.Visible = true; invalidate(); }
  SetPreviewTarget(c: any) { this.previewTarget = c; invalidate(); }
  /** NCard.FlashRelicOnCard: an NRelicFlashVfx on the body at 2×, at Size × 0.5 (the centre). */
  FlashRelicOnCard(relic: any) {
    const v = N('Vfx.NRelicFlashVfx').Create(relic);
    if (!v) return;
    this.AddChild(v);
    v.Scale = v2(2, 2);
    v.Position = v2(0, 0);
  }
  PlayRandomizeCostAnim() {}
  AnimMultiCardPlay() { return $.Task.CompletedTask; }
  /** NCard.AnimCardToPlayPile. */
  AnimCardToPlayPile() {
    const target = G.PileTypeExtensions.GetTargetPosition(G.PileType.Play, this);
    this.PlayPileTween?.CustomStep?.(999);
    this.PlayPileTween = tween().SetParallel(true);
    this.PlayPileTween.TweenProperty(this, 'position', target, 0.25).SetEase(1).SetTrans(7);
    this.PlayPileTween.TweenProperty(this, 'scale', v2(0.8, 0.8), 0.25).SetEase(1).SetTrans(7);
  }
}
NCard.Create = (card: any) => (card && !G.TestMode.IsOn ? new CardNodeView(card) : null);
/** NCard.FindOnTable: hand holders, then the play queue, then the play container. */
NCard.FindOnTable = (card: any, overridePile?: any) => {
  if (!card || G.TestMode.IsOn || !G.CombatManager.Instance.IsInProgress) return null;
  const ui = N('Rooms.NCombatRoom').Instance?.Ui;
  if (!(ui instanceof CombatUiView)) return null;
  const t = card.Pile != null ? card.Pile.Type : overridePile;
  if (t === G.PileType.Hand) return ui.Hand.GetCard(card) ?? ui.PlayQueue.GetCardNode(card) ?? ui.GetCardFromPlayContainer(card);
  if (t === G.PileType.Play) return ui.GetCardFromPlayContainer(card);
  return null;
};

// ------------------------------------------------------------------ HandPosHelper
const POS: number[][][] = [
  [[0, -50]],
  [[-100, -50], [100, -50]],
  [[-180, -50], [0, -59], [180, -50]],
  [[-240, -25], [-80, -50], [80, -50], [240, -25]],
  [[-340, 10], [-170, -30], [0, -50], [170, -30], [340, 10]],
  [[-460, 13], [-273, -25], [-90, -50], [90, -50], [273, -25], [460, 13]],
  [[-534, 18], [-365, -14], [-189, -39], [0, -50], [189, -39], [365, -14], [534, 18]],
  [[-565, 28], [-400, -14], [-231, -39], [-80, -50], [80, -50], [231, -39], [400, -14], [565, 28]],
  [[-600, 37], [-445, -2], [-300, -29], [-150, -45], [0, -50], [150, -45], [300, -29], [445, -2], [600, 37]],
  [[-610, 38], [-472, 5], [-340, -21], [-200, -41], [-64, -50], [64, -50], [200, -41], [340, -21], [472, 5], [610, 38]],
];
const ANG = [[0], [-2, 2], [-3, 0, 3], [-8, -4, 4, 8], [-8, -4, 0, 4, 8], [-9, -6, -3, 3, 6, 9], [-9, -6, -3, 0, 3, 6, 9],
  [-12, -9, -6, -3, 3, 6, 9, 12], [-12, -9, -6, -3, 0, 3, 6, 9, 12], [-15, -12, -9, -6, -3, 3, 6, 9, 12, 15]];
const handPos = (n: number, i: number) => { const p = POS[Math.min(n, 10) - 1]?.[i] ?? [0, -50]; return v2(p[0], p[1]); };
const handAngle = (n: number, i: number) => ANG[Math.min(n, 10) - 1]?.[i] ?? 0;
const handScale = (n: number) => 0.8 * ({ 8: 0.95, 9: 0.9, 10: 0.85, 11: 0.8, 12: 0.75 } as Record<number, number>)[n] || 0.8;

// ------------------------------------------------------------------ NHandCardHolder
const CARD_EVENTS = ['Upgraded', 'KeywordsChanged', 'ReplayCountChanged', 'AfflictionChanged', 'EnergyCostChanged', 'StarCostChanged'];
export class HolderView extends Web(NHandCardHolder) {
  CardNode: CardNodeView | null = null;
  targetPos = v2();
  targetAngle = 0;
  targetScale = v2(1, 1);
  private anim = { pos: false, angle: false, scale: false };
  hitboxEnabled = false;
  /** The Flash TextureRect's alpha and colour (card_flash.png behind the card). */
  flash = { a: 0, color: CardHighlight.playable };
  private flashTw: any = null;
  private hoverTw: any = null;
  indexLabel = 0;
  isHovered = false;
  private isFocused = false;
  constructor(card: CardNodeView, public hand: HandView) {
    super();
    this.SetCard(card);
  }
  get CardModel() { return this.CardNode?.Model ?? null; }
  get Hitbox() { return { Size: v2(300, 422), IsEnabled: this.hitboxEnabled }; }
  private readonly onFlash = () => this.Flash();
  SetCard(node: CardNodeView) {
    this.CardNode = node;
    if (!node.$parent) this.AddChild(node);
    else node.Reparent(this);
    node.Position = v2(); // NCardHolder.ConnectSignals
    for (const e of CARD_EVENTS) node.Model[e] = $.dcombine(node.Model[e], this.onFlash);
    if (node.Scale.X !== 1 || node.Scale.Y !== 1) tween().TweenProperty(node, 'scale', v2(1, 1), 0.25);
    this.UpdateCard();
  }
  Clear() {
    const n = this.CardNode;
    if (n) {
      for (const e of CARD_EVENTS) n.Model[e] = $.dremove(n.Model[e], this.onFlash);
      if (n.$parent === this) this.RemoveChild(n);
    }
    this.CardNode = null;
  }
  private get shouldGlowGold() {
    const m = this.CardModel;
    if (!m) return false;
    // NPlayerHand.SelectModeGoldGlowOverride (CardSelectorPrefs.ShouldGlowGold) replaces the usual rule while selecting
    const override = this.hand.SelectModeGoldGlowOverride;
    if (override) return !!safe(() => override(m), false);
    return G.CombatManager.Instance.IsPlayPhase && safe(() => m.CanPlay$0(), false) && safe(() => m.ShouldGlowGold, false);
  }
  private get shouldGlowRed() {
    const m = this.CardModel;
    return !!m && G.CombatManager.Instance.IsPlayPhase && safe(() => m.ShouldGlowRed, false);
  }
  /** NHandCardHolder.UpdateCard: playable cards glow cyan (gold / red when the card asks for it). */
  UpdateCard() {
    const n = this.CardNode;
    if (!n) return;
    n.UpdateVisuals(G.PileType.Hand, 0);
    if (!G.CombatManager.Instance.IsInProgress) return;
    const red = this.shouldGlowRed, gold = this.shouldGlowGold;
    if (safe(() => n.Model.CanPlay$0(), false) || red || gold) {
      n.CardHighlight.AnimShow();
      n.CardHighlight.color = red ? CardHighlight.red : gold ? CardHighlight.gold : CardHighlight.playable;
    } else n.CardHighlight.AnimHide();
  }
  Flash() {
    this.flash.color = this.shouldGlowGold ? CardHighlight.gold : this.shouldGlowRed ? CardHighlight.red : CardHighlight.playable;
    this.flashTw?.Kill();
    this.flashTw = tween();
    this.flashTw.TweenProperty(this.flash, 'a', 0.6, 0.15);
    this.flashTw.TweenProperty(this.flash, 'a', 0, 0.3);
  }
  SetIndexLabel(i: number) { this.indexLabel = i; }
  SetTargetPosition(p: any) { this.targetPos = p; this.anim.pos = true; }
  SetTargetAngle(a: number) { this.targetAngle = a; this.anim.angle = true; }
  SetTargetScale(s: any) { this.targetScale = s; this.anim.scale = true; }
  SetAngleInstantly(a: number) { this.anim.angle = false; this.RotationDegrees = a; }
  SetScaleInstantly(s: any) { this.anim.scale = false; this.Scale = s; }
  /** AnimAngle / AnimScale / AnimPosition: exponential approach with snap thresholds. */
  step(dt: number) {
    if (this.anim.angle) {
      const d = lerp(this.RotationDegrees, this.targetAngle, k(dt, 10));
      this.RotationDegrees = Math.abs(d - this.targetAngle) < 0.1 ? this.targetAngle : d;
      if (this.RotationDegrees === this.targetAngle) this.anim.angle = false;
    }
    if (this.anim.scale) {
      this.Scale = this.Scale.Lerp(this.targetScale, k(dt, 8));
      if (Math.abs(this.targetScale.X - this.Scale.X) < 0.002) { this.Scale = this.targetScale; this.anim.scale = false; }
    }
    if (this.anim.pos) {
      this.Position = this.Position.Lerp(this.targetPos, k(dt, 7));
      if (!this.hitboxEnabled && Math.abs(this.Position.X - this.targetPos.X) < 200) this.hitboxEnabled = true;
      if (this.Position.DistanceSquaredTo(this.targetPos) < 1) { this.Position = this.targetPos; this.anim.pos = false; }
    }
  }
  /** Mouse entered / left the hitbox (NCardHolder.OnFocus / OnUnfocus → NHandCardHolder). */
  focus(on: boolean) {
    if (this.isHovered === on) return;
    this.isHovered = on;
    if (on) this.hand.OnHolderFocused(this);
    else this.hand.OnHolderUnfocused(this);
    if (this.isFocused !== this.isHovered) {
      this.isFocused = this.isHovered;
      this.ZIndex = this.isFocused ? 1 : 0; // NHandCardHolder.DoCardHoverEffects
    }
  }
  BeginDrag() { this.SetAngleInstantly(0); this.SetScaleInstantly(v2(1, 1)); }
  CancelDrag() { this.ZIndex = 0; this.SetAngleInstantly(0); this.SetScaleInstantly(v2(1, 1)); }
  SetDefaultTargets() {
    this.ZIndex = 0;
    const act = this.hand.ActiveHolders, i = act.indexOf(this);
    if (i < 0) return;
    this.SetTargetPosition(handPos(act.length, i));
    this.SetTargetAngle(handAngle(act.length, i));
    this.SetTargetScale(v2(handScale(act.length), handScale(act.length)));
  }
  QueueFree() { this.hoverTw?.Kill(); super.QueueFree(); }
}

// ------------------------------------------------------------------ NPlayerHand
export class HandView extends Web(NPlayerHand) {
  /** player_hand.tscn CardHolderContainer: a point anchored bottom-centre. */
  CardHolderContainer = pin(new ContainerNode(960, 1080, 'holders'), 'Position', () => v2(960, edge.b));
  SelectedHandCardContainer: SelectedContainerView = new SelectedContainerView(this);
  /** NPlayerHand.Mode: Play 1, SimpleSelect 2, UpgradeSelect 3. */
  mode = 1;
  private prefs: any = null;
  private filter: ((c: any) => boolean) | null = null;
  private selectTcs: any = null;
  selected: any[] = [];
  /** the selection UI (backstop, header, confirm button, peek button, upgrade preview) */
  select = { header: '', confirm: false, peekEnabled: false, peeking: false, upgradeCard: null as any, upgradeShown: false, wiggle: 0 };
  private awaiting = new Map<HolderView, number>();
  FocusedHolder: HolderView | null = null;
  private draggedIndex = -1;
  private lastFocusedIdx = -1;
  private isDisabled = false;
  private enableTw: any = null;
  currentPlay: MouseCardPlay | null = null;
  private stop: () => void;
  constructor() {
    super();
    this.AddChild(this.CardHolderContainer);
    this.AddChild(this.SelectedHandCardContainer);
    this.stop = $.onFrame((dt: number) => {
      if (this.$freed) return false;
      for (const h of this.allHolders()) h.step(dt);
      if (!this.IsInCardSelection) this.updateDisabledState();
    });
  }
  IsInsideTree() { return !this.$freed; }
  get Holders(): HolderView[] { return this.CardHolderContainer.$kids.filter((h: any) => h instanceof HolderView); }
  get ActiveHolders(): HolderView[] { return this.Holders.filter((h) => h.Visible); }
  allHolders(): HolderView[] { return [...this.Holders, ...this.awaiting.keys()]; }
  get InCardPlay() { return !!this.currentPlay; }
  get IsInCardSelection() { return this.mode === 2 || this.mode === 3; }
  get SelectModeGoldGlowOverride(): ((c: any) => boolean) | null {
    const f = this.prefs?.ShouldGlowGold;
    return f ? (c: any) => (typeof f === 'function' ? f(c) : f.Invoke?.(c)) : null;
  }
  /** Hand holders, then the selected ones, then those awaiting play (NPlayerHand.GetCardHolder). */
  GetCardHolder(card: any): any {
    return this.Holders.find((h) => h.CardNode?.Model === card) ?? this.SelectedHandCardContainer.Holders.find((h) => h.CardNode?.Model === card)
      ?? [...this.awaiting.keys()].find((h) => h.CardNode?.Model === card) ?? null;
  }
  GetCard(card: any) { return this.GetCardHolder(card)?.CardNode ?? null; }
  IsAwaitingPlay(h: HolderView) { return this.awaiting.has(h); }
  Add(card: CardNodeView, index = -1) {
    const g = card.GlobalPosition;
    const h = new HolderView(card, this);
    this.AddCardHolder(h, index);
    h.GlobalPosition = g;
    this.RefreshLayout();
    return h;
  }
  Remove(card: any) {
    const h = this.GetCardHolder(card);
    if (!h) throw new Error(`No holder for card ${card?.Id?.Entry}`);
    if (this.currentPlay && card === this.currentPlay.holder.CardModel) this.currentPlay.CancelPlayCard();
    this.RemoveCardHolder(h);
  }
  private AddCardHolder(h: HolderView, index: number) {
    this.CardHolderContainer.AddChild(h);
    if (index >= 0) this.CardHolderContainer.MoveChild(h, index);
    this.RefreshLayout();
  }
  RemoveCardHolder(h: any) {
    this.awaiting.delete(h);
    if (this.currentPlay && this.currentPlay.holder === h) this.currentPlay.CancelPlayCard();
    if (this.FocusedHolder === h) this.FocusedHolder = null;
    h.Clear();
    h.$parent?.RemoveChild(h);
    h.QueueFree();
    this.RefreshLayout();
  }
  OnHolderFocused(h: HolderView) {
    this.FocusedHolder = h;
    this.lastFocusedIdx = h.GetIndex();
    safe(() => G.RunManager.Instance.HoveredModelTracker.OnLocalCardHovered(h.CardModel), null);
    this.RefreshLayout();
  }
  OnHolderUnfocused(h: HolderView) {
    if (this.FocusedHolder === h) this.FocusedHolder = null;
    safe(() => G.RunManager.Instance.HoveredModelTracker.OnLocalCardUnhovered(), null);
    this.RefreshLayout();
  }
  TryCancelCardPlay(card: any) {
    const h = this.GetCardHolder(card);
    if (!h || !this.awaiting.has(h)) return;
    this.ReturnHolderToHand(h);
    h.UpdateCard();
    if (this.currentPlay && this.currentPlay.holder === h) this.currentPlay.CancelPlayCard();
    else this.RefreshLayout();
  }
  CancelAllCardPlay() {
    this.currentPlay?.CancelPlayCard();
    for (const h of [...this.awaiting.keys()]) this.ReturnHolderToHand(h);
  }
  private ReturnHolderToHand(h: HolderView) {
    if (!this.awaiting.has(h)) return;
    const i = this.awaiting.get(h)!;
    this.awaiting.delete(h);
    h.Reparent(this.CardHolderContainer);
    if (i >= 0) this.CardHolderContainer.MoveChild(h, i);
    h.SetDefaultTargets();
  }
  /** NPlayerHand.RefreshLayout. */
  RefreshLayout() {
    const act = this.ActiveHolders, n = act.length;
    if (n <= 0) return;
    const s = handScale(n);
    const f = this.FocusedHolder ? act.indexOf(this.FocusedHolder) : -1;
    for (let i = 0; i < n; i++) {
      let p = handPos(n, i);
      if (f > -1) p = v2(p.X - Math.sign(f - i) * lerp(100, 0, Math.min(1, Math.abs(f - i) / 4)), p.Y);
      const h = act[i];
      if (f === i) {
        h.SetAngleInstantly(0);
        h.SetScaleInstantly(v2(1, 1));
        let y = -422 * 0.5 + 2;
        if (this.isDisabled) y -= 100;
        p = v2(p.X, y);
        h.Position = v2(h.Position.X, y);
        h.SetTargetPosition(p);
      } else {
        h.SetTargetPosition(p);
        h.SetTargetScale(v2(s, s));
        h.SetTargetAngle(handAngle(n, i));
      }
      h.SetIndexLabel(this.draggedIndex >= 0 && i >= this.draggedIndex ? i + 2 : i + 1);
    }
    invalidate();
  }
  get dragging() { return this.draggedIndex >= 0; }
  /** NPlayerHand.FlashPlayableHolders (hovering End Turn with cards still playable). */
  FlashPlayableHolders() { for (const h of this.Holders) if (h.CardNode && safe(() => h.CardNode!.Model.CanPlay$0(), false)) h.Flash(); }
  /** Called by CombatStateTracker.CombatStateChanged (NPlayerHand.OnCombatStateChanged). */
  OnCombatStateChanged() {
    for (const h of this.allHolders()) h.UpdateCard();
  }
  /** UpdateHandDisabledState → AnimDisable / AnimEnable: the hand drops 100 px and greys out while actions are disabled. */
  private updateDisabledState() {
    const cm = G.CombatManager.Instance;
    let off = !!cm.PlayerActionsDisabled;
    const me = safe(() => G.LocalContext.GetMe$IPlayerCollection(cm._state ?? G.RunManager.Instance.State), null);
    if (!off && safe(() => cm.PlayersTakingExtraTurn.Count > 0 && me && !cm.PlayersTakingExtraTurn.Contains(me), false)) off = true;
    if (off !== this.isDisabled) this.animDisabled(off);
  }
  /** NPlayerHand.AnimOut (combat ended): selection cancelled, the hand sinks to (0, 500) over 0.8 s Back In. */
  AnimOut() {
    // CancelHandSelectionIfNecessary
    if (this.IsInCardSelection && this.selectTcs) { this.selectTcs.TrySetCanceled?.() ?? this.selectTcs.TrySetResult([]); this.AfterCardsSelected(null); }
    this.enableTw?.Kill();
    this.enableTw = tween();
    this.enableTw.TweenProperty(this, 'position', v2(0, 500), 0.8).SetEase(0).SetTrans(10);
  }
  /** AnimDisable / AnimEnable. */
  private animDisabled(off: boolean) {
    this.isDisabled = off;
    this.enableTw?.Kill();
    this.enableTw = tween().SetParallel(true);
    this.enableTw.TweenProperty(this, 'position', off ? v2(0, 100) : v2(0, 0), 0.2).SetEase(1).SetTrans(7);
    this.enableTw.TweenProperty(this, 'modulate', off ? new $.Color(0.5, 0.5, 0.5, 1) : white(), 0.2).SetEase(1).SetTrans(7);
    if (off) this.CancelAllCardPlay();
  }
  /** OnHolderPressed: while peeking the peek button wiggles; Mode.Play → StartCardPlay; the selection modes pick the card. */
  press(h: HolderView) {
    if (this.select.peeking) { this.select.wiggle++; invalidate(); return; }
    if (this.IsInCardSelection) {
      if (!h.CardNode || !G.CombatManager.Instance.IsInProgress || safe(() => N('Screens.Overlays.NOverlayStack').Instance.ScreenCount > 0, false)) return;
      if (this.mode === 2) this.SelectCardInSimpleMode(h); else this.SelectCardInUpgradeMode(h);
      return;
    }
    if (!h.CardNode || !G.CombatManager.Instance.IsInProgress || this.currentPlay) return;
    if (!this.cardActionsAllowed()) return;
    this.StartCardPlay(h, false);
  }
  /**
   * NPlayerHand._UnhandledInput selectCard1–10: the dragged card keeps its number; in play mode a card already being
   * played is cancelled for the new one; while peeking a selection ignores the keys.
   */
  selectCardShortcut(i: number) {
    if (G.CombatManager.Instance.IsOverOrEnding) return;
    const list: (HolderView | null)[] = [...this.ActiveHolders];
    if (this.dragging) list.splice(this.draggedIndex, 0, null);
    const h = list[i];
    if (!h) return;
    if (targetManager.IsInSelection) targetManager.CancelTargeting();
    if (this.mode === 1) {
      if (!this.cardActionsAllowed()) return;
      this.currentPlay?.CancelPlayCard();
      this.StartCardPlay(h, true);
    } else if (!this.select.peeking) {
      if (this.mode === 2) this.SelectCardInSimpleMode(h); else this.SelectCardInUpgradeMode(h);
    }
  }
  private StartCardPlay(h: HolderView, viaShortcut: boolean) {
    this.draggedIndex = h.GetIndex();
    this.awaiting.set(h, this.draggedIndex);
    h.Reparent(this);
    h.BeginDrag();
    this.currentPlay = new MouseCardPlay(h, this, viaShortcut);
    safe(() => G.RunManager.Instance.HoveredModelTracker.OnLocalCardSelected(h.CardNode!.Model), null);
    this.currentPlay.Start();
    this.RefreshLayout();
    h.SetIndexLabel(this.draggedIndex + 1);
  }
  private cardActionsAllowed() {
    const cm = G.CombatManager.Instance;
    if (safe(() => cm.PlayersTakingExtraTurn.Count > 0, false)) {
      const me = safe(() => G.LocalContext.GetMe$IPlayerCollection(G.RunManager.Instance.State), null);
      if (!me || !cm.PlayersTakingExtraTurn.Contains(me)) return false;
    }
    return !cm.PlayerActionsDisabled;
  }
  cardPlayFinished(h: HolderView, success: boolean) {
    safe(() => G.RunManager.Instance.HoveredModelTracker.OnLocalCardDeselected(), null);
    this.currentPlay = null;
    if (!success) this.ReturnHolderToHand(h);
    this.draggedIndex = -1;
    this.RefreshLayout();
  }
  QueueFree() { this.CancelAllCardPlay(); this.selectTcs?.TrySetResult([]); this.stop(); super.QueueFree(); }

  // ---------------------------------------------------------------- selection (NPlayerHand.SelectCards)
  SelectCards(prefs: any, filter: ((c: any) => boolean) | null, source: any, mode: number) {
    this.CancelAllCardPlay();
    const wasDisabled = this.isDisabled;
    if (wasDisabled) this.animDisabled(false);
    this.mode = mode;
    this.filter = filter;
    this.prefs = prefs;
    this.select.header = '[center]' + safe(() => prefs.Prompt.GetFormattedText(), '') + '[/center]';
    this.select.peekEnabled = true;
    this.select.peeking = false;
    this.UpdateSelectModeCardVisibility();
    this.RefreshSelectModeConfirmButton();
    const tcs = (this.selectTcs = new $.TaskCompletionSource());
    const hand = this;
    return $.async(function* (): Generator<any, any, any> {
      const result = yield tcs.Task;
      hand.AfterCardsSelected(source);
      if (wasDisabled) hand.animDisabled(true);
      return result;
    }, this);
  }
  private UpdateSelectModeCardVisibility() {
    const peeking = this.select.peeking;
    for (const h of this.Holders) {
      const n = h.CardNode;
      if (!n) continue;
      h.Visible = peeking ? true : this.filter ? !!safe(() => this.filter!(n.Model), true) : true;
      n.pretend = !peeking && !!safe(() => this.prefs.PretendCardsCanBePlayed, false);
      n.unpowered = !peeking && !!safe(() => this.prefs.UnpoweredPreviews, false);
      h.UpdateCard();
    }
    this.RefreshLayout();
  }
  private RefreshSelectModeConfirmButton() {
    const n = this.selected.length;
    this.select.confirm = !!this.prefs && n >= this.prefs.MinSelect && n <= this.prefs.MaxSelect;
    invalidate();
  }
  /** The confirm button (NConfirmButton → OnSelectModeConfirmButtonPressed). */
  confirmSelection() { if (this.select.confirm) this.selectTcs?.TrySetResult([...this.selected]); }
  private SelectCardInSimpleMode(h: HolderView) {
    if (this.selected.length >= this.prefs.MaxSelect) this.SelectedHandCardContainer.DeselectCard(this.selected[this.selected.length - 1]);
    this.selected.push(h.CardNode!.Model);
    this.SelectedHandCardContainer.Add(h);
    this.RemoveCardHolder(h);
    this.RefreshSelectModeConfirmButton();
  }
  private SelectCardInUpgradeMode(h: HolderView) {
    const model = h.CardNode!.Model;
    if (this.selected.length) this.returnUpgradeCard();
    this.selected.push(model);
    this.select.upgradeShown = true;
    this.select.upgradeCard = model;
    this.RemoveCardHolder(h);
    this.RefreshSelectModeConfirmButton();
  }
  /** NUpgradePreview.ReturnCard (clicking the chosen card): a fresh card node flies back into the hand. */
  returnUpgradeCard() {
    const model = this.select.upgradeCard;
    if (!model) return;
    const n = NCard.Create(model) as CardNodeView;
    n.GlobalPosition = UPGRADE_BEFORE;
    this.DeselectCard(n);
    this.select.upgradeCard = null;
    invalidate();
  }
  /** NPlayerHand.DeselectCard: back into the hand at the card's index in the hand pile. */
  DeselectCard(card: CardNodeView) {
    const pile = safe(() => G.PileTypeExtensions.GetPile(G.PileType.Hand, card.Model.Owner), null);
    const idx = Math.min(safe(() => pile.Cards.IndexOf(card.Model), -1), this.CardHolderContainer.$kids.length);
    const h = this.Add(card, idx);
    h.Visible = true;
    this.selected = this.selected.filter((c) => c !== card.Model);
    this.RefreshSelectModeConfirmButton();
  }
  togglePeek() {
    if (!this.select.peekEnabled) return;
    this.select.peeking = !this.select.peeking;
    this.SelectedHandCardContainer.Visible = !this.select.peeking;
    this.UpdateSelectModeCardVisibility();
    (this.$parent as CombatUiView | null)?.OnPeekButtonToggled?.(this.select.peeking, this.Position);
  }
  private AfterCardsSelected(source: any) {
    this.selected = [];
    for (const h of this.Holders) {
      h.Visible = true;
      if (h.CardNode) { h.CardNode.pretend = false; h.CardNode.unpowered = false; }
      h.UpdateCard();
    }
    this.RefreshLayout();
    Object.assign(this.select, { confirm: false, upgradeShown: false, header: '', peekEnabled: false, peeking: false });
    this.SelectedHandCardContainer.Visible = true;
    this.prefs = null;
    this.filter = null;
    this.mode = 1;
    this.selectTcs = null;
    // the picks stay in their slots until the source finishes (its discard / exhaust takes them from there)
    const finished = () => {
      if (source) source.ExecutionFinished = $.dremove(source.ExecutionFinished, finished);
      for (const sh of [...this.SelectedHandCardContainer.Holders]) {
        const card = sh.CardNode;
        sh.Clear();
        sh.QueueFree();
        if (card) this.Add(card);
      }
      if (this.select.upgradeCard) {
        const n = NCard.Create(this.select.upgradeCard) as CardNodeView;
        n.GlobalPosition = UPGRADE_BEFORE;
        this.Add(n);
        this.select.upgradeCard = null;
      }
      invalidate();
    };
    if (source && 'ExecutionFinished' in source) source.ExecutionFinished = $.dcombine(source.ExecutionFinished, finished);
    else finished();
    invalidate();
  }
}

/** NUpgradePreview "Before" card centre (preview at (960, 490), scale 0.9; holder at x −280 offset (3, −4)). */
export const UPGRADE_BEFORE = v2(960 + (-280 + 3) * 0.9, 490 - 4 * 0.9);
export const UPGRADE_AFTER = v2(960 + (280 + 3) * 0.9, 490 - 4 * 0.9);
const NSelectedHandCardHolder = N('Cards.Holders.NSelectedHandCardHolder');
/** NSelectedHandCardHolder: a picked card at 0.8 (1.0 while hovered); clicking it puts it back. */
export class SelectedHolderView extends Web(NSelectedHandCardHolder) {
  CardNode: CardNodeView | null = null;
  private tw: any = null;
  constructor(public container: SelectedContainerView) { super(); this.Scale = v2(0.8, 0.8); }
  get CardModel() { return this.CardNode?.Model ?? null; }
  SetCard(node: CardNodeView) {
    this.CardNode = node;
    if (!node.$parent) this.AddChild(node);
    else node.Reparent(this);
  }
  Clear() {
    if (this.CardNode?.$parent === this) this.RemoveChild(this.CardNode);
    this.CardNode = null;
  }
  focus(on: boolean) {
    this.tw?.Kill();
    if (on) { this.Scale = v2(1, 1); return; }
    this.tw = tween();
    this.tw.TweenProperty(this, 'scale', v2(0.8, 0.8), 0.5).SetEase(1).SetTrans(5);
  }
}
/** NSelectedHandCardContainer: the picks in a centred row 300 apart; the row shrinks and rises as it fills. */
export class SelectedContainerView extends ContainerNode {
  private tw: any = null;
  constructor(private hand: HandView) { super(960, 488, 'selected'); }
  get Holders(): SelectedHolderView[] { return this.$kids.filter((k: any) => k instanceof SelectedHolderView); }
  Add(orig: HolderView) {
    const card = orig.CardNode!;
    const g = card.GlobalPosition;
    const h = new SelectedHolderView(this);
    this.AddChild(h);
    h.SetCard(card);
    this.RefreshHolderPositions();
    card.GlobalPosition = g;
    card.Rotation = 0;
    tween().TweenProperty(card, 'position', v2(0, 0), 0.15).SetEase(1).SetTrans(7);
    return h;
  }
  RefreshHolderPositions() {
    const hs = this.Holders;
    let x = (-300 * (hs.length - 1)) / 2;
    for (const h of hs) { h.Position = v2(x, 0); x += 300; }
  }
  /** Clicking a picked card (DeselectHolder). */
  DeselectHolder(h: SelectedHolderView) {
    const card = h.CardNode;
    if (card) this.hand.DeselectCard(card);
    h.QueueFree();
    this.RefreshHolderPositions();
  }
  DeselectCard(model: any) { const h = this.Holders.find((x) => x.CardModel === model); if (h) this.DeselectHolder(h); }
  $childEntered() { this.resize(this.Holders.length); }
  $childExited() { this.resize(this.Holders.length); this.RefreshHolderPositions(); }
  /** UpdateSelectedCardContainer: ≤ 3 cards at y 540 scale 1, 4–6 at 465 × 0.8, more at 390 × 0.55 (0.5 s quad in-out). */
  private resize(n: number) {
    const [y, s] = n <= 3 ? [540, 1] : n <= 6 ? [465, 0.8] : [390, 0.55];
    this.tw?.Kill();
    this.tw = tween().SetParallel(true);
    this.tw.TweenProperty(this, 'position', v2(960, y), 0.5).SetEase(2).SetTrans(4);
    this.tw.TweenProperty(this, 'scale', v2(s, s), 0.5).SetEase(2).SetTrans(4);
  }
}

// ------------------------------------------------------------------ NCardPlayQueue
interface QueueItem { card: CardNodeView; action: any; tw: any }
export class PlayQueueView extends Web(NCardPlayQueue) {
  private items: QueueItem[] = [];
  private readonly onEnqueued = (a: any) => this.OnActionEnqueued(a);
  constructor(private ui: CombatUiView) {
    super();
    const q = G.RunManager.Instance.ActionQueueSet;
    q.ActionEnqueued = $.dcombine(q.ActionEnqueued, this.onEnqueued);
  }
  IsInsideTree() { return true; }
  detach() {
    const q = G.RunManager.Instance.ActionQueueSet;
    if (q) q.ActionEnqueued = $.dremove(q.ActionEnqueued, this.onEnqueued);
    this.items = [];
  }
  private OnActionEnqueued(action: any) {
    if (!(action instanceof G.PlayCardAction)) return;
    const card = safe(() => action.NetCombatCard.ToCardModelOrNull(), null);
    if (!card || !safe(() => G.LocalContext.IsMe$Player(action.Player), true)) return;
    const holder = this.ui.Hand.GetCardHolder(card);
    const node: CardNodeView = holder?.CardNode ?? NCard.Create(card);
    if (node.Model?.Pile?.Type !== G.PileType.Hand) return;
    const item: QueueItem = { card: node, action, tw: null };
    if (node.IsInsideTree()) node.Reparent(this);
    else this.AddChild(node);
    this.MoveChild(node, 0);
    if (holder) this.ui.Hand.RemoveCardHolder(holder);
    this.items.push(item);
    this.tweenTo(item, this.items.length - 1);
  }
  GetCardNode(card: any) { return this.items.find((i) => i.card.Model === card)?.card ?? null; }
  RemoveCardFromQueueForExecution(card: any) {
    const i = this.items.findIndex((x) => x.card.Model === card);
    if (i >= 0) this.removeAt(i);
  }
  RemoveCardFromQueueForCancellation(a: any, forceReturnToHand = false) {
    const i = this.items.findIndex((x) => x.action === a || x.card === a);
    if (i < 0) return;
    const it = this.items[i];
    this.removeAt(i);
    if (it.card.Model?.Pile?.Type === G.PileType.Hand || forceReturnToHand) this.ui.Hand.Add(it.card);
    else this.tweenForCancellation(it);
  }
  UpdateCardBeforeExecution(action: any) {
    const it = this.items.find((x) => x.action === action);
    if (!it) return;
    it.card.Model = safe(() => action.NetCombatCard.ToCardModel(), it.card.Model);
    it.card.SetPreviewTarget(action.Target);
    it.card.UpdateVisuals(it.card.Model.Pile?.Type ?? G.PileType.None, 0);
    if (this.ui.Hand.GetCardHolder(it.card.Model)) this.ui.Hand.Remove(it.card.Model);
  }
  /** NCombatUi.OnCombatEnded / turn end: queued cards return to the hand or fade out. */
  AnimOut() {
    for (const it of this.items) {
      it.tw?.Kill();
      if (it.card.Model?.Pile?.Type === G.PileType.Hand) this.ui.Hand.Add(it.card);
      else this.tweenForCancellation(it);
    }
    this.items = [];
  }
  private removeAt(i: number) {
    this.items[i].tw?.Kill();
    this.items.splice(i, 1);
    this.items.forEach((it, j) => this.tweenTo(it, j));
  }
  private tweenForCancellation(it: QueueItem) {
    it.tw?.Kill();
    it.tw = tween().SetParallel(true);
    it.tw.TweenProperty(it.card, 'position:y', 30, 0.5).AsRelative().SetEase(1).SetTrans(7);
    it.tw.TweenProperty(it.card, 'modulate:a', 0, 0.5).SetEase(1).SetTrans(7);
    it.tw.Chain().TweenCallback(() => it.card.QueueFree());
  }
  private tweenTo(it: QueueItem, index: number) {
    const i = index + 1;
    const pos = G.PileTypeExtensions.GetTargetPosition(G.PileType.Play, it.card);
    const target = v2(pos.X - 300 * (i / (i + 2)), pos.Y);
    const s = (1 - i / (i + 1)) * 0.8;
    it.tw?.Kill();
    it.tw = tween().SetParallel(true);
    it.tw.TweenProperty(it.card, 'position', target, 0.35).SetEase(1).SetTrans(7);
    it.tw.TweenProperty(it.card, 'scale', v2(s, s), 0.35).SetEase(1).SetTrans(7);
    it.tw.TweenProperty(it.card, 'modulate:a', 1, 0.35).SetEase(1).SetTrans(7);
  }
}

// ------------------------------------------------------------------ NCombatUi + NCombatRoom containers
/** combat_piles_container.tscn button rects (x, y, w, h) and the corner each is anchored to. */
const PILE_RECTS = { draw: [15, 985, 80, 80, 'lb'], discard: [1826, 985, 80, 80, 'rb'], exhaust: [1830, 800, 80, 80, 'rb'] } as const;
const pileButton = (r: readonly [number, number, number, number, string]) => ({ get GlobalPosition() { return v2(...anchored(r[0], r[1], r[4])); }, Size: v2(r[2], r[3]) });
export class CombatUiView extends Web(NCombatUi) {
  DrawPile = pileButton(PILE_RECTS.draw);
  DiscardPile = pileButton(PILE_RECTS.discard);
  ExhaustPile = pileButton(PILE_RECTS.exhaust);
  CardPreviewContainer = new PreviewRow(0, 0, 'preview');
  MessyCardPreviewContainer = messy();
  Hand = new HandView();
  PlayQueue = new PlayQueueView(this);
  PlayContainer = new ContainerNode(0, 0, 'play');
  constructor() {
    super();
    for (const c of [this.CardPreviewContainer, this.MessyCardPreviewContainer, this.Hand, this.PlayQueue, this.PlayContainer]) this.AddChild(c);
  }
  IsInsideTree() { return true; }
  get PlayContainerCards(): CardNodeView[] { return this.PlayContainer.$kids.filter((c: any) => c instanceof CardNodeView); }
  GetCardFromPlayContainer(card: any) { return this.PlayContainerCards.find((n) => n.Model === card) ?? null; }
  AddToPlayContainer(card: any) {
    card.$parent?.RemoveChild(card);
    this.PlayContainer.AddChild(card);
  }
  private peekTw: any = null;
  private peekFrom = new Map<CardNodeView, { p: any; s: any }>();
  /**
   * OnPeekButtonToggled: peeking hides the play queue and sends the cards being played to the peek button's
   * CurrentCardMarker ((64, −105) from the button at (100, 476) from the hand's left edge) at half their scale; un-peeking brings them back.
   */
  OnPeekButtonToggled(peeking: boolean, handPos: any) {
    if (this.peekTw) { this.peekTw.Pause(); this.peekTw.CustomStep(0.25); this.peekTw.Kill(); this.peekTw = null; }
    this.PlayQueue.Visible = !peeking;
    for (const c of this.PlayContainerCards) {
      let pos: any, s: any;
      if (peeking) {
        this.peekFrom.set(c, { p: c.Position, s: c.Scale });
        pos = v2(handPos.X + 164 - view.ox, handPos.Y + 371);
        s = v2(c.Scale.X * 0.5, c.Scale.Y * 0.5);
      } else {
        const o = this.peekFrom.get(c);
        pos = o?.p ?? v2(960, 540);
        s = o?.s ?? v2(1, 1);
      }
      this.peekTw ??= tween();
      this.peekTw.TweenProperty(c, peeking ? 'global_position' : 'position', pos, 0.25).SetEase(1).SetTrans(7);
      this.peekTw.Parallel().TweenProperty(c, 'scale', s, 0.25).SetEase(1).SetTrans(7);
    }
    if (!peeking) this.peekFrom.clear();
    invalidate();
  }
  /** The combat room is going away: free every node and drop the play-queue subscription. */
  destroy() {
    this.PlayQueue.detach();
    targetManager.CancelTargeting();
    this.QueueFree();
  }
}
/** combat_ui.tscn / run.tscn MessyCardPreviewContainer: offsets 263, 196, −302, −122. */
function messy() {
  const m = new PreviewMessy(0, 0, 'messy');
  pin(m, 'Position', () => v2(edge.l + 263, edge.t + 196));
  return pin(m, 'Size', () => v2(view.w - 263 - 302, view.h - 196 - 122));
}

// ------------------------------------------------------------------ NGlobalUi (previews outside combat, the deck button)
const NGlobalUi = $.ext('MegaCrit.Sts2.Core.Nodes.CommonUi.NGlobalUi');
const NTopBar = $.ext('MegaCrit.Sts2.Core.Nodes.CommonUi.NTopBar');
/** A DOM element's rect in viewport coordinates (the top bar is drawn by ui/run.tsx). */
function domRect(sel: string) {
  const el = document.querySelector(sel), st = document.querySelector('.stage-root');
  if (!el || !st) return { GlobalPosition: v2(1830, 0), Size: v2(80, 80) };
  const r = el.getBoundingClientRect(), sr = st.getBoundingClientRect(), k = 1920 / sr.width;
  return { GlobalPosition: v2((r.left - sr.left) * k, (r.top - sr.top) * k), Size: v2(r.width * k, r.height * k) };
}
/** NTopBarButton: persistent input state, with live geometry for card-flight targets. */
class TopBarButtonView {
  IsEnabled = true;
  constructor(private selector: string) {}
  get GlobalPosition() { return domRect(this.selector).GlobalPosition; }
  get Size() { return domRect(this.selector).Size; }
  Enable() { this.IsEnabled = true; invalidate(); }
  Disable() { this.IsEnabled = false; invalidate(); }
}
export class TopBarView extends Web(NTopBar) {
  TrailContainer = new ContainerNode(0, 0, 'trail');
  PotionContainer = Object.assign($.dummy(N('Potions.NPotionContainer')), { AnimatePotion: (p: any, start?: any) => animateAcquired(p, start) });
  Map = new TopBarButtonView('.tb-map');
  Deck = new TopBarButtonView('.tb-deck');
  constructor() { super(); this.AddChild(this.TrailContainer); }
  IsInsideTree() { return true; }
}
export class GlobalUiView extends Web(NGlobalUi) {
  TopBar = new TopBarView();
  RelicInventory = Object.assign($.dummy(N('Relics.NRelicInventory')), { AnimateRelic: (r: any, start?: any, scale?: any) => animateAcquired(r, start, scale) });
  get MapScreen() { return $.ext('MegaCrit.Sts2.Core.Nodes.Screens.Map.NMapScreen').Instance; }
  AboveTopBarVfxContainer = new ContainerNode(0, 0, 'above-top-bar');
  CardPreviewContainer = new PreviewRow(0, 0, 'preview');
  GridCardPreviewContainer = new PreviewGrid(0, 0, 'grid');
  /** run.tscn EventCardPreviewContainer: the viewport less 931 px on the right. */
  EventCardPreviewContainer = pin(pin(new PreviewGrid(0, 0, 'event'), 'Position', () => v2(edge.l, edge.t)), 'Size', () => v2(view.w - 931, view.h));
  MessyCardPreviewContainer = messy();
  constructor() {
    super();
    for (const c of [this.TopBar, this.AboveTopBarVfxContainer, this.CardPreviewContainer, this.GridCardPreviewContainer, this.EventCardPreviewContainer, this.MessyCardPreviewContainer]) this.AddChild(c);
  }
  IsInsideTree() { return true; }
  /** NGlobalUi.ReparentCard: into the top bar's trail container, keeping its place on screen. */
  ReparentCard(card: any) {
    const g = card.GlobalPosition;
    card.$parent?.RemoveChild(card);
    this.TopBar.TrailContainer.AddChild(card);
    card.GlobalPosition = g;
  }
}

/** Per-combat-room web UI: NCombatRoom.Ui and CombatVfxContainer (flying cards pass under the combat UI). */
export function createCombatNodes() {
  return { ui: new CombatUiView(), vfx: new ContainerNode(0, 0, 'vfx') };
}

// ------------------------------------------------------------------ mouse (viewport coordinates, 1920 × 1080)
export const mouse = { x: 960, y: 540 };
const frame = () => new Promise<number>((r) => $.onFrame((dt: number) => { r(dt); return false; }));

// ------------------------------------------------------------------ NTargetingArrow + NTargetManager
export const arrow = {
  visible: false,
  from: null as any, // node whose GlobalPosition the arrow starts from, or a fixed point
  fromPos: v2(),
  to: v2(),
  head: { x: 0, y: 0, rot: 0, scale: 0.95 },
  segments: Array.from({ length: 19 }, () => ({ x: 0, y: 0, rot: 0, scale: 0.28 })),
  color: [1, 1, 1] as number[],
};
let headTw: any = null;
/** NTargetingArrow._Process / UpdateArrowPosition / UpdateSegments. */
function updateArrow() {
  const from = arrow.from ? arrow.from.GlobalPosition : arrow.fromPos;
  arrow.to = v2(mouse.x, mouse.y);
  const t = arrow.to, h = arrow.head;
  const back = v2(0, 88).Rotated(h.rot);
  h.x = t.X + back.X; h.y = t.Y + back.Y;
  const fin = v2(0, 40).Rotated(h.rot);
  const end = v2(t.X + fin.X, t.Y + fin.Y);
  const c = v2(from.X - (h.x - from.X) * 0.25, from.Y > 540 ? h.y + (h.y - from.Y) * 0.5 : h.y * 0.75 + from.Y * 0.25);
  h.rot = Math.atan2(t.Y - c.Y, t.X - c.X) + Math.PI / 2;
  const seg = arrow.segments;
  for (let i = 0; i < 19; i++) {
    const p = bezier(from, end, c, i / 20);
    seg[i].scale = lerp(0.28, 0.42, (i * 2) / 19);
    seg[i].x = p.X; seg[i].y = p.Y;
    seg[i].rot = i === 0 ? (p.Y > 540 ? 0 : Math.PI) : Math.atan2(p.Y - seg[i - 1].y, p.X - seg[i - 1].x) + Math.PI / 2;
  }
  seg[0].rot = Math.atan2(seg[0].y - seg[1].y, seg[0].x - seg[1].x) - Math.PI / 2;
}
function arrowHighlight(on: boolean, enemy = true) {
  headTw?.Kill();
  if (on) {
    headTw = tween();
    headTw.TweenProperty(arrow.head, 'scale', 1.05, 1).SetEase(1).SetTrans(6);
    arrow.color = enemy ? [0xe6 / 255, 0x1e / 255, 0x1b / 255] : [0x36 / 255, 0xc7 / 255, 0x8a / 255];
  } else {
    arrow.head.scale = 0.95;
    arrow.color = [1, 1, 1];
  }
}

const TM = { None: 0, ReleaseMouseToTarget: 1, ClickMouseToTarget: 2 };
class TargetManager {
  mode = TM.None;
  private validType = 0;
  hovered: any = null;
  private exitEarly: (() => boolean) | null = null;
  private filter: ((n: any) => boolean) | null = null;
  private resolve: ((n: any) => void) | null = null;
  private stop: (() => void) | null = null;
  onHover: ((c: any) => void) | null = null;
  onUnhover: ((c: any) => void) | null = null;
  get IsInSelection() { return this.mode !== TM.None; }
  StartTargeting(type: number, from: any, mode: number, exitEarly: (() => boolean) | null, filter: ((n: any) => boolean) | null = null) {
    this.validType = type;
    arrow.from = from && 'xf' in from ? from : null;
    arrow.fromPos = from && !('xf' in from) ? from : v2();
    arrow.visible = true;
    arrowHighlight(false);
    this.exitEarly = exitEarly;
    this.filter = filter;
    this.mode = mode;
    const p = new Promise<any>((r) => { this.resolve = r; });
    safe(() => G.RunManager.Instance.InputSynchronizer.SyncLocalIsTargeting(true), null);
    // NCreature.OnTargetingStarted: a creature already under the mouse becomes the target
    for (const cv of creatureViews()) if (cv.IsFocused) this.OnNodeHovered(cv);
    this.stop = $.onFrame(() => {
      if (!this.IsInSelection) return false;
      if (this.exitEarly?.()) { this.FinishTargeting(true); return false; }
      updateArrow();
    });
    updateArrow();
    invalidate();
    return p;
  }
  /** NTargetManager._Input: left release / click confirms, right click cancels. */
  button(btn: number, down: boolean) {
    if (!this.IsInSelection) return;
    let finish = false, cancel = false;
    if (btn === 0 && !down) {
      if (this.mode === TM.ReleaseMouseToTarget) { if (this.hovered) finish = true; else this.mode = TM.ClickMouseToTarget; }
      else if (this.mode === TM.ClickMouseToTarget) finish = true;
    } else if (btn === 2) { finish = down; cancel = true; }
    if (this.exitEarly?.()) { finish = true; cancel = true; }
    if (finish) this.FinishTargeting(cancel);
  }
  CancelTargeting() { if (this.IsInSelection) this.FinishTargeting(true); }
  private FinishTargeting(cancel: boolean) {
    const r = this.resolve, node = cancel ? null : this.hovered;
    this.resolve = null;
    this.exitEarly = null;
    this.mode = TM.None;
    this.stop?.();
    arrow.visible = false;
    arrow.from = null;
    arrowHighlight(false);
    this.hovered?.HideMultiselectReticle?.();
    this.hovered = null;
    safe(() => G.RunManager.Instance.InputSynchronizer.SyncLocalIsTargeting(false), null);
    invalidate();
    r?.(node);
  }
  private allowed(node: any) {
    if (this.filter && !this.filter(node)) return false;
    const c = node?.Entity;
    if (!c) return true;
    const T = G.TargetType;
    switch (this.validType) {
      case T.AnyEnemy: return c.Side === G.CombatSide.Enemy;
      case T.AnyPlayer: return c.IsPlayer && !c.IsDead;
      case T.AnyAlly: return c.IsPlayer && !c.IsDead && !G.LocalContext.IsMe$Player(c.Player);
      default: return true;
    }
  }
  AllowedToTargetNode(node: any) { return this.allowed(node); }
  OnNodeHovered(node: any) {
    if (!this.IsInSelection || !this.allowed(node)) return;
    if (!(node instanceof NCreature)) {
      // any other node (the merchant, for a TargetedNoCreature potion) is the target as it is; the arrow lights up green
      this.hovered = node;
      arrowHighlight(true, false);
      invalidate();
      return;
    }
    const c = node.Entity, pre = { v: null as any };
    if (!G.Hook.ShouldAllowTargeting(c.CombatState, c, pre)) { safe(() => G.TaskHelper.RunSafely(pre.v.AfterTargetingBlockedVfx(c)), null); return; }
    this.hovered = node;
    arrowHighlight(true, c.IsEnemy);
    node.ShowSingleSelectReticle();
    this.onHover?.(node);
    invalidate();
  }
  OnNodeUnhovered(node: any) {
    if (!this.IsInSelection || !this.allowed(node)) return;
    if (!(node instanceof NCreature)) { this.hovered = null; arrowHighlight(false); invalidate(); return; }
    this.onUnhover?.(node);
    if (this.hovered === node) this.hovered = null;
    arrowHighlight(false);
    node.HideSingleSelectReticle();
    invalidate();
  }
}
export const targetManager = new TargetManager();
/** Creature views of the current combat room (bridge.ts CreatureView), registered there. */
export const creatureViewsRef = { get: (): any[] => [] };
const creatureViews = () => creatureViewsRef.get();

// ------------------------------------------------------------------ NCardPlay / NMouseCardPlay
let cardsPlayedForFtue = 0;
export class MouseCardPlay {
  private cancelled = false;
  private trying = false;
  private target: any = null;
  private leftDown: boolean;
  private dragStartY = 0;
  private done = false;
  constructor(public holder: HolderView, private hand: HandView, private skipDrag: boolean) { this.leftDown = !skipDrag; }
  get cardNode() { return this.holder.CardNode; }
  get card() { return this.cardNode?.Model ?? null; }
  private get playZone() {
    const n = fracY(0.75);
    if (this.skipDrag) return n + 100;
    return this.dragStartY > n ? Math.max(n, this.dragStartY - 100) : Math.min(n, this.dragStartY - 50);
  }
  private inPlayZone() { return mouse.y < this.playZone; }
  private inCancelZone() { return mouse.y > fracY(0.95); }
  /** Left button state and right-click cancel (NMouseCardPlay._Input). */
  button(btn: number, down: boolean) {
    if (btn === 0) this.leftDown = down;
    else if (btn === 2 && down) this.CancelPlayCard();
  }
  Start() { void this.run(); }
  private async run() {
    if (!this.card || !this.cardNode) return;
    this.dragStartY = mouse.y;
    if (!this.skipDrag) {
      do await this.lerpToMouse();
      while (!this.inPlayZone() && !this.cancelled);
    }
    if (this.cancelled) return;
    const reason = { v: 0 }, preventer = { v: null as any };
    if (!this.card.CanPlay$2(reason, preventer)) {
      cannotPlayFtueCheck(this.card);
      this.CancelPlayCard();
      const line = safe(() => G.UnplayableReasonExtensions.GetPlayerDialogueLine(reason.v, preventer.v), null);
      if (line) NThoughtBubbleVfx.Create(safe(() => line.GetFormattedText(), ''), this.card.Owner.Creature, 1);
      return;
    }
    this.cardNode.CardHighlight.AnimFlash();
    const mode = this.skipDrag ? TM.ClickMouseToTarget : this.leftDown ? TM.ReleaseMouseToTarget : TM.ClickMouseToTarget;
    this.tryShowEvokingOrbs();
    this.cardNode?.CardHighlight.AnimFlash();
    const T = G.TargetType, tt = this.card.TargetType;
    if (tt === T.AnyEnemy || tt === T.AnyAlly) await this.singleTargeting(mode, tt);
    else await this.multiTargeting(mode);
    if (this.cancelled) return;
    if (!this.inPlayZone()) this.CancelPlayCard();
    if (!this.cancelled) this.TryPlayCard(this.target);
  }
  private async lerpToMouse() {
    this.holder.SetTargetPosition(v2(mouse.x - this.hand.Position.X, mouse.y - this.hand.Position.Y));
    await frame();
  }
  /** NCardPlay.CenterCard. */
  private centerCard() {
    this.holder.SetTargetPosition(v2(960 - this.hand.Position.X, edge.b - (422 * 0.75) / 2 - this.hand.Position.Y));
    this.holder.SetTargetScale(v2(0.75, 0.75));
  }
  private async singleTargeting(mode: number, type: number) {
    if (this.cancelled) return;
    this.centerCard();
    targetManager.onHover = (c) => this.cardNode?.SetPreviewTarget(c.Entity);
    targetManager.onUnhover = () => this.cardNode?.SetPreviewTarget(null);
    const node = await targetManager.StartTargeting(type, this.cardNode, mode, () => this.inCancelZone() || this.cancelled);
    targetManager.onHover = targetManager.onUnhover = null;
    if (node) this.target = node.Entity;
  }
  private async multiTargeting(mode: number) {
    let showing = false;
    const finished = mode === TM.ReleaseMouseToTarget ? () => !this.leftDown : () => this.leftDown;
    do {
      if (showing) { if (!this.inPlayZone()) { this.hideTargetingVisuals(); showing = false; } }
      else if (this.inPlayZone()) { this.showMultiTargetingVisuals(); showing = true; }
      await this.lerpToMouse();
    } while (!finished() && !this.cancelled && !this.inCancelZone());
    if (!this.cancelled && this.inCancelZone()) this.CancelPlayCard();
  }
  private TryPlayCard(target: any) {
    const card = this.card;
    if (!card) return;
    const T = G.TargetType, single = card.TargetType === T.AnyEnemy || card.TargetType === T.AnyAlly;
    if (single && !target) { this.CancelPlayCard(); return; }
    if (!safe(() => card.CanPlayTargeting(target), false)) { cannotPlayFtueCheck(card); this.CancelPlayCard(); return; }
    this.trying = true;
    const ok = card.TryManualPlay(single ? target : null);
    this.trying = false;
    if (ok) {
      if (++cardsPlayedForFtue === 8 && !safe(() => G.SaveManager.Instance.SeenFtue('cannot_play_card_ftue'), true)) G.SaveManager.Instance.MarkFtueAsComplete('cannot_play_card_ftue');
      if (single && this.holder.IsInsideTree()) this.holder.SetTargetPosition(v2(960, edge.b));
      this.cleanup();
      this.finish(true);
    } else this.CancelPlayCard();
  }
  CancelPlayCard() {
    if (this.trying) return;
    this.cardNode?.SetPreviewTarget(null);
    this.cleanup();
    this.finish(false);
    this.cancelled = true;
  }
  private finish(success: boolean) {
    if (this.done) return;
    this.done = true;
    this.hand.cardPlayFinished(this.holder, success);
  }
  private cleanup() {
    this.hideTargetingVisuals();
    this.hideEvokingOrbs();
    if (targetManager.IsInSelection) targetManager.CancelTargeting();
  }
  private hideTargetingVisuals() {
    for (const cv of creatureViews()) cv.HideMultiselectReticle();
    this.cardNode?.SetPreviewTarget(null);
    this.cardNode?.UpdateVisuals(this.card?.Pile?.Type ?? G.PileType.None, 0);
  }
  /** NCardPlay.ShowMultiCreatureTargetingVisuals. */
  private showMultiTargetingVisuals() {
    const card = this.card, cs = card?.CombatState, node = this.cardNode;
    if (!card || !cs || !node) return;
    const T = G.TargetType, room = N('Rooms.NCombatRoom').Instance, tt = card.TargetType;
    if (tt === T.AllEnemies || tt === T.RandomEnemy) {
      const hit = [...$.iter(cs.HittableEnemies)];
      if (hit.length === 1) node.SetPreviewTarget(hit[0]);
      node.UpdateVisuals(card.Pile?.Type ?? G.PileType.None, G.CardPreviewMode.MultiCreatureTargeting);
      for (const c of hit) room?.GetCreatureNode(c)?.ShowMultiselectReticle();
    }
    if (tt === T.AllAllies) {
      for (const c of $.iter(cs.PlayerCreatures)) if (c.IsAlive) room?.GetCreatureNode(c)?.ShowMultiselectReticle();
      return;
    }
    if (tt === T.Self) room?.GetCreatureNode(card.Owner.Creature)?.ShowMultiselectReticle();
    else if (tt === T.Osty) room?.GetCreatureNode(card.Owner.Osty)?.ShowMultiselectReticle();
  }
  private tryShowEvokingOrbs() { orbEvoke.type = safe(() => this.card.OrbEvokeType, 0); invalidate(); }
  private hideEvokingOrbs() { orbEvoke.type = 0; invalidate(); }
}
/** NOrbManager.UpdateVisuals(OrbEvokeType) while a card that evokes is being played. */
export const orbEvoke = { type: 0 };
function cannotPlayFtueCheck(card: any) {
  const reason = { v: 0 };
  if (!safe(() => G.SaveManager.Instance.SeenFtue('cannot_play_card_ftue'), true) && !safe(() => card.CanPlay$2(reason, { v: null }), true) && reason.v === G.UnplayableReason.EnergyCostTooHigh) {
    ftueHook.cannotPlay?.();
    G.SaveManager.Instance.MarkFtueAsComplete('cannot_play_card_ftue');
  }
}
/** ui/ftue.tsx shows NCannotPlayCardFtue through this hook. */
export const ftueHook: { cannotPlay?: () => void } = {};

// ------------------------------------------------------------------ card VFX
/** NCardTrailVfx: Line2D trails, sparks and silhouettes following a node (drawn by render/cardfx.ts). */
export class TrailVfx {
  static all = new Set<TrailVfx>();
  alpha = 1;
  spritesAlpha = 0;
  spritesScale = 1;
  following = true;
  x = 0; y = 0; rot = 0;
  constructor(public follow: any, public character: string) {
    const tw = tween().SetParallel(true);
    tw.TweenProperty(this, 'sprites_scale', 0.5, 0.5).SetEase(0).SetTrans(7).SetDelay(0.25);
    tw.TweenProperty(follow, 'modulate:a', 0.75, 0.5).SetEase(1).SetTrans(7);
    tw.TweenProperty(this, 'sprites_alpha', 1, 1).SetEase(1).SetTrans(7);
    this.track();
    TrailVfx.all.add(this);
  }
  get SpritesScale() { return this.spritesScale; }
  set SpritesScale(v: number) { this.spritesScale = v; }
  get SpritesAlpha() { return this.spritesAlpha; }
  set SpritesAlpha(v: number) { this.spritesAlpha = v; }
  track() {
    if (!this.following) return;
    const t = this.follow?.xf?.() ?? { x: this.follow?.X ?? 0, y: this.follow?.Y ?? 0, rot: 0 };
    this.x = t.x; this.y = t.y; this.rot = this.follow?.Rotation ?? t.rot;
  }
  /** NCardTrailVfx.FadeOut: stops following, fades over 0.5 s. */
  FadeOut(): Promise<void> {
    this.following = false;
    return new Promise((r) => {
      const tw = tween();
      tw.TweenProperty(this, 'alpha', 0, 0.5);
      tw.whenFinished(() => { this.free(); r(); });
    });
  }
  get Alpha() { return this.alpha; }
  set Alpha(v: number) { this.alpha = v; }
  free() { TrailVfx.all.delete(this); }
}
const trailOf = (path: string) => (/card_trail_(\w+)/.exec(String(path ?? ''))?.[1] ?? 'ironclad');
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** NCardFlyVfx: the card arcs to its pile, darkening and shrinking to a trail, then swooshes away. */
export class CardFlyVfx extends Web(NCardFlyVfx) {
  SwooshAwayCompletion = new $.TaskCompletionSource();
  private trail: TrailVfx | null = null;
  constructor(private card: CardNodeView, private end: any, private adding: boolean, private trailPath: string) { super(); }
  $entered() {
    if (this.trail) return;
    const card = this.card, start = card.GlobalPosition;
    this.trail = new TrailVfx(card, trailOf(this.trailPath));
    const arc = this.end.Y < 540 ? -500 : 500 + rand(100, 400);
    let speed = rand(1.1, 1.25);
    const accel = rand(2, 2.5), dur = rand(1, 1.75);
    card.$onExit.push(() => { this.trail?.free(); this.SwooshAwayCompletion.TrySetResult(); this.QueueFree(); });
    const c = v2(start.X + (this.end.X - start.X) * 0.5, start.Y + (this.end.Y - start.Y) * 0.5 - arc);
    let time = 0, phase = 0, fading = false;
    $.onFrame((dt: number) => {
      if (this.$freed || card.$freed) return false;
      time += speed * dt;
      if (phase === 0) {
        speed += accel * dt;
        if (time / dur <= 1) {
          const ahead = bezier(start, this.end, c, (time + 0.05) / dur);
          card.GlobalPosition = bezier(start, this.end, c, time / dur);
          const p = card.GlobalPosition, want = Math.atan2(ahead.Y - p.Y, ahead.X - p.X) + Math.PI / 2 - (card.$parent?.Rotation ?? 0);
          card.Rotation = lerpAngle(card.Rotation, want, k(dt, 12));
          const f = Math.min(Math.max((time * 3) / dur, 0), 1);
          card.Body.Modulate = new $.Color(1 - f, 1 - f, 1 - f, 1);
          card.Body.Scale = v2(lerp(1, 0.1, f), lerp(1, 0.1, f));
          this.trail?.track();
          return;
        }
        card.GlobalPosition = this.end;
        this.trail?.track();
        if (this.adding) safe(() => card.Model.Pile?.InvokeCardAddFinished(), null);
        phase = 1;
        time = 0;
        return;
      }
      if (time / dur <= 1) {
        if (time / dur > 0.25 && !fading) { fading = true; void this.trail?.FadeOut(); }
        const s = Math.max(lerp(0.1, -0.15, time / dur), 0);
        card.Body.Scale = v2(s, s);
        return;
      }
      this.SwooshAwayCompletion.TrySetResult();
      card.QueueFree();
      return false;
    });
  }
}
const lerpAngle = (a: number, b: number, t: number) => { const d = ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; return a + d * t; };
NCardFlyVfx.Create = (card: any, end: any, adding: boolean, trailPath: string) => (G.TestMode.IsOn || !(card instanceof CardNodeView) ? null : new CardFlyVfx(card, end, adding, trailPath));

/** NCardFlyShuffleVfx: a card silhouette arcs from pile to pile (cards moving without a node, e.g. the shuffle). */
export class ShuffleFlyVfx extends Web(NCardFlyShuffleVfx) {
  static all = new Set<ShuffleFlyVfx>();
  alpha = 1;
  trail: TrailVfx | null = null;
  constructor(private start: any, private end: any, private trailPath: string, private target: any) { super(); }
  get Alpha() { return this.alpha; }
  set Alpha(v: number) { this.alpha = v; }
  $entered() {
    if (this.trail) return;
    const cpo = rand(-300, 400);
    let speed = rand(1.1, 1.25);
    const accel = rand(2, 2.5), arc = this.end.Y < 540 ? -500 : 500 + cpo, dur = rand(1, 1.75);
    this.trail = new TrailVfx(this, trailOf(this.trailPath));
    ShuffleFlyVfx.all.add(this);
    const c = v2(this.start.X + (this.end.X - this.start.X) * 0.5, this.start.Y + (this.end.Y - this.start.Y) * 0.5 - arc);
    let time = 0, phase = 0, fading = false;
    this.Scale = v2(1, 1);
    $.onFrame((dt: number) => {
      if (this.$freed) return false;
      time += speed * dt;
      if (phase === 0) {
        speed += accel * dt;
        if (time / dur <= 1) {
          const p = bezier(this.start, this.end, c, time / dur), q = bezier(this.start, this.end, c, (time + 0.05) / dur);
          this.Position = p;
          this.Rotation = Math.atan2(q.Y - p.Y, q.X - p.X) + Math.PI / 2;
          this.trail?.track();
          return;
        }
        this.Position = this.end;
        this.trail?.track();
        safe(() => this.target.InvokeCardAddFinished(), null);
        phase = 1; time = 0;
        return;
      }
      if (time / dur <= 1) {
        if (time / dur > 0.25 && !fading) { fading = true; void this.trail?.FadeOut(); }
        const s = Math.max(lerp(0.1, -0.1, time / dur), 0);
        this.Scale = v2(s, s);
        return;
      }
      const tw = tween();
      tw.TweenProperty(this, 'alpha', 0, 0.8);
      tw.TweenCallback(() => { ShuffleFlyVfx.all.delete(this); this.QueueFree(); });
      return false;
    });
  }
}
NCardFlyShuffleVfx.Create = (startPile: any, targetPile: any, trailPath: string) => {
  if (G.TestMode.IsOn) return null;
  const at = (t: number) => G.PileTypeExtensions.GetTargetPosition(t, null);
  return new ShuffleFlyVfx(at(startPile.Type), at(targetPile.Type), trailPath, targetPile);
};

/**
 * NCardSmithVfx (vfx_card_smith.tscn): with cards, each (a new NCard in an HBox, 345 px apart) scales 0 → 1 over
 * 0.25 s (Cubic Out); then three hammer hits 0.25 s apart — card_smith.mp3 on the first, Spark1..3 (hammer mark, impact
 * circle, sparks; render/cardfx.ts), a weak vertical punch (180 ± 10°) and the card snapping to 20° / −10° / 5°
 * (0.05 s Elastic Out); 0.4 s later the cards fly to their pile (or shrink away if they have none). On a hand card
 * (Create(NCard)) only the three sparks play, where the card is.
 */
export class CardSmithVfx extends Web(N('Vfx.NCardSmithVfx')) {
  static pending: { node: any; spark: number }[] = [];
  constructor(private cards: any[], private cardNode: CardNodeView | null, private sfx: boolean) { super(); }
  private spark(n: number) { CardSmithVfx.pending.push({ node: this, spark: n }); }
  private shake() { safe(() => N('NGame').Instance?.ScreenShake?.(G.ShakeStrength.Weak, G.ShakeDuration.Short, 180 + rand(-10, 10)), null); }
  $entered() {
    const audio = () => { if (this.sfx) safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play('card_smith.mp3', 1, 1), null); };
    if (this.cardNode || !this.cards.length) {
      if (this.cardNode) { this.GlobalPosition = this.cardNode.GlobalPosition; this.Scale = v2(this.cardNode.Scale.X, this.cardNode.Scale.Y); }
      audio();
      const t = tween();
      t.Parallel().TweenCallback(() => this.spark(1));
      t.TweenInterval(0.25);
      t.Chain().TweenCallback(() => this.spark(2));
      t.TweenInterval(0.25);
      t.Chain().TweenCallback(() => this.spark(3));
      t.TweenInterval(0.4);
      t.whenFinished(() => this.QueueFree());
      return;
    }
    const nodes = this.cards.map((c: any, i: number) => {
      const n = NCard.Create(c) as CardNodeView;
      this.AddChild(n);
      n.Position = v2((i - (this.cards.length - 1) / 2) * 345, 0);
      n.Scale = v2(0, 0);
      return n;
    });
    const t = tween();
    for (const n of nodes) t.Parallel().TweenProperty(n, 'scale', v2(1, 1), 0.25).SetEase(1).SetTrans(7);
    if (this.sfx) t.Chain().TweenCallback(audio);
    t.Parallel().TweenCallback(() => this.spark(1));
    t.Parallel().TweenCallback(() => this.shake());
    for (const n of nodes) t.Parallel().TweenProperty(n, 'rotation_degrees', 20, 0.05).SetTrans(6).SetEase(1);
    t.TweenInterval(0.25);
    t.Chain().TweenCallback(() => this.spark(2));
    for (const n of nodes) t.Parallel().TweenProperty(n, 'rotation_degrees', -10, 0.05).SetTrans(6).SetEase(1);
    t.Parallel().TweenCallback(() => this.shake());
    t.TweenInterval(0.25);
    t.Chain().TweenCallback(() => this.spark(3));
    for (const n of nodes) t.Parallel().TweenProperty(n, 'rotation_degrees', 5, 0.05).SetTrans(6).SetEase(1);
    t.Parallel().TweenCallback(() => this.shake());
    t.TweenInterval(0.4);
    t.whenFinished(() => {
      if (this.$freed || !nodes[0].IsInsideTree()) return;
      if (safe(() => this.cards[0].Pile, null) == null) {
        const out = tween();
        for (const n of nodes) out.SetParallel().TweenProperty(n, 'scale', v2(0, 0), 0.15);
        out.whenFinished(() => this.QueueFree());
        return;
      }
      let last: any = null;
      nodes.forEach((n) => {
        const target = G.PileTypeExtensions.GetTargetPosition(n.Model.Pile.Type, n);
        const g = n.GlobalPosition;
        n.Reparent(this);
        n.GlobalPosition = g;
        last = NCardFlyVfx.Create(n, target, false, n.Model.Owner.Character.TrailPath);
        G.GodotTreeExtensions.AddChildSafely(N('NRun').Instance.GlobalUi.TopBar.TrailContainer, last);
      });
      if (last) void last.SwooshAwayCompletion.Task.then(() => this.QueueFree());
      else this.QueueFree();
    });
  }
}
N('Vfx.NCardSmithVfx').Create = (a?: any, playSfx = true) => {
  if (G.TestMode.IsOn) return null;
  if (a instanceof CardNodeView) return new CardSmithVfx([], a, playSfx);
  return new CardSmithVfx(a ? [...$.iter(a)] : [], null, playSfx);
};

/** NExhaustVfx: the burn particles at the card (render/cardfx.ts plays vfx/cards/exhaust_vfx there). */
export class ExhaustVfx extends Web(NExhaustVfx) {
  static pending: { x: number; y: number }[] = [];
  constructor(private card: CardNodeView) { super(); }
  $entered() {
    const p = this.card.GlobalPosition;
    ExhaustVfx.pending.push({ x: p.X, y: p.Y });
    safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play('card_exhaust.mp3'), null);
    setTimeout(() => this.QueueFree(), 2000);
  }
}
NExhaustVfx.Create = (card: any) => (G.TestMode.IsOn || !(card instanceof CardNodeView) ? null : new ExhaustVfx(card));

/** Curve2D of vfx_card_power_fly.tscn (in, out, position per point), baked for length sampling. */
const SWOOSH = [0, 0, 0, 0, 0, 0, 50.0031, 14.2866, -50.0031, -14.2866, -85, -37, 1.86905, 73.8276, -1.86905, -73.8276, -182, -149,
  -115.699, -12.5866, 115.699, 12.5866, 67, -228, 40.9602, -107.087, -40.9602, 107.087, 209, 41, 162.128, 8.78094, -162.128, -8.78094, -167, 160, 0, 0, 0, 0, -427, 27];
function bakeSwoosh(endX: number, endY: number) {
  const pts: { p: number[]; i: number[]; o: number[] }[] = [];
  for (let j = 0; j < SWOOSH.length; j += 6) pts.push({ i: [SWOOSH[j], SWOOSH[j + 1]], o: [SWOOSH[j + 2], SWOOSH[j + 3]], p: [SWOOSH[j + 4], SWOOSH[j + 5]] });
  pts[pts.length - 1].p = [endX, endY];
  const out: number[][] = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s].p, b = pts[s + 1].p, c1 = [a[0] + pts[s].o[0], a[1] + pts[s].o[1]], c2 = [b[0] + pts[s + 1].i[0], b[1] + pts[s + 1].i[1]];
    for (let q = s ? 1 : 0; q <= 32; q++) {
      const t = q / 32, u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
  }
  const len = [0];
  for (let q = 1; q < out.length; q++) len.push(len[q - 1] + Math.hypot(out[q][0] - out[q - 1][0], out[q][1] - out[q - 1][1]));
  const total = len[len.length - 1];
  const sample = (d: number) => {
    let q = 1;
    while (q < len.length - 1 && len[q] < d) q++;
    const f = (d - len[q - 1]) / (len[q] - len[q - 1] || 1), a = out[q - 1], b = out[q];
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  return { total, sample };
}
/** NCardFlyPowerVfx: a played power swooshes along a curve into its owner, spinning faster as it goes. */
export class CardFlyPowerVfx extends Web(NCardFlyPowerVfx) {
  private trail: TrailVfx | null = null;
  private curve: ReturnType<typeof bakeSwoosh>;
  constructor(public CardNode: CardNodeView) {
    super();
    const g = CardNode.GlobalPosition;
    this.Position = g;
    const owner = CardNode.Model.Owner;
    const node = N('Rooms.NCombatRoom').Instance?.GetCreatureNode(owner.Creature);
    const spawn = node?.VfxSpawnPosition ?? v2(g.X, g.Y);
    this.curve = bakeSwoosh(spawn.X - g.X, spawn.Y - g.Y);
    this.trailPath = owner.Character.TrailPath;
  }
  private trailPath: string;
  $entered() { if (!this.trail) this.trail = new TrailVfx(this.CardNode, trailOf(this.trailPath)); }
  GetDuration() { return this.curve.total / 3000 + 0.05; }
  async PlayAnim() {
    const card = this.CardNode, dur = this.curve.total / 3000;
    tween().TweenProperty(card, 'scale', v2(0.1, 0.1), 0.3);
    let acc = 0, shrinking = false;
    while (acc < dur) {
      const dt = await frame();
      if (this.$freed) break;
      acc += dt;
      const n = acc / dur, s = this.curve.sample(n * n * this.curve.total);
      card.GlobalPosition = v2(this.Position.X + s.x, this.Position.Y + s.y);
      const d = s.rot - card.Rotation, max = lerp(Math.PI, Math.PI * 50, n) * dt;
      card.Rotation += Math.sign(d) * Math.min(Math.abs(d), max);
      this.trail?.track();
      if (n >= 0.9 && !shrinking) { shrinking = true; tween().TweenProperty(card, 'scale', v2(0, 0), Math.max(0.01, dur - acc)); }
    }
    safe(() => N('NGame').Instance?.ScreenShake?.(G.ShakeStrength.Medium, G.ShakeDuration.Short), null);
    if (this.trail) await this.trail.FadeOut();
    card.QueueFree();
    this.QueueFree();
  }
}
NCardFlyPowerVfx.Create = (card: any) => (G.TestMode.IsOn || !(card instanceof CardNodeView) ? null : new CardFlyPowerVfx(card));
