// NOrbManager / NOrb (orbs/orb_manager.tscn, orb.tscn) for the local player: orb slots on an arc around the creature's
// IntentPos + (0, 195), laid out by TweenLayout (radius lerp(225, 300, (cap − 3) / 7), −150° … −25°, the front orb on
// the right), with the slot fly-out, channel, evoke, replace and clear animations. The orb visuals (orb_visuals/<id>
// spine + particles) and the passive flash are drawn by the combat stage (render/stage.ts); the numbers, the empty
// slot outline and the hover box are DOM here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { G, $, list } from '../game';
import { invalidate } from '../store';
import { imageUrl, spineIndex } from '../assets';
import { orbEvoke } from '../cardnodes';
import { setTip, setTips, hoverTipsOf } from './tooltip';
import type { Slot } from '../render/stage';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const TR = { Sine: 1, Back: 10 }, EZ = { Out: 1, InOut: 2 };
let nextId = 0;

/** One NOrb: its model (null = empty slot), position relative to the orb container, alpha, sprite scale, flashes. */
export interface OrbNode { id: number; model: any | null; X: number; Y: number; A: number; SpriteS: number; flashes: number[] }
const run = (t: any) => { $.onFrame(() => { invalidate(); return t.IsValid(); }); return t; };

export class OrbManagerView {
  /** _orbs, in slot order (index 0 = the front orb). */
  orbs: OrbNode[] = [];
  /** Every drawn NOrb, including those fading out or clearing. */
  nodes: OrbNode[] = [];
  private tween: any = null;
  constructor(private creature: any) {}
  private get capacity() { return safe(() => this.creature.Player.PlayerCombatState.OrbQueue.Capacity, 0); }
  private make(model: any, x = 0, y = 0): OrbNode {
    const n: OrbNode = { id: ++nextId, model, X: x, Y: y, A: 1, SpriteS: 1, flashes: [] };
    this.nodes.push(n);
    if (model) {
      this.spriteIn(n);
      // _EnterTree: Model.Triggered += Flash (a replaced orb stays subscribed to its first model, as in the game)
      model.Triggered = $.dcombine(model.Triggered, () => { n.flashes.push(performance.now()); invalidate(); });
    }
    return n;
  }
  private drop(n: OrbNode) { this.nodes = this.nodes.filter((x) => x !== n); invalidate(); }
  /** UpdateVisuals: a new sprite scales 0 → 1 over 0.5 s (Back Out). */
  private spriteIn(n: OrbNode) {
    n.SpriteS = 0;
    run(new $.WebTween()).TweenProperty(n, 'sprite_s', 1, 0.5).SetTrans(TR.Back).SetEase(EZ.Out);
  }
  /** OnCombatSetup: the empty slots fly out from the centre. */
  onCombatSetup() { if (safe(() => this.creature.IsAlive && !!this.creature.Player.PlayerCombatState, false)) this.AddSlotAnim(this.capacity); }
  AddSlotAnim(amount: number) {
    for (let i = 0; i < amount; i++) this.orbs.push(this.make(null));
    this.layout();
  }
  RemoveSlotAnim(amount: number) {
    for (let i = 0; i < amount && this.orbs.length; i++) this.drop(this.orbs.pop()!);
    this.layout();
  }
  ReplaceOrb(oldOrb: any, newOrb: any) {
    for (const n of this.orbs) if (n.model === oldOrb) { n.model = newOrb; this.spriteIn(n); }
    invalidate();
  }
  /** AddOrbAnim: the channelled orb takes the first empty slot's place (evoking the front orb if none is empty). */
  AddOrbAnim() {
    const model = list(safe(() => this.creature.Player.PlayerCombatState.OrbQueue.Orbs, [])).pop() ?? null;
    let empty = this.orbs.find((n) => !n.model);
    if (!empty) {
      const front = this.orbs.find((n) => n.model);
      if (front) this.EvokeOrbAnim(front.model);
      empty = this.orbs.find((n) => !n.model);
      if (!empty) return;
    }
    const n = this.make(model, empty.X, empty.Y);
    this.orbs.splice(this.orbs.indexOf(empty), 0, n);
    this.orbs = this.orbs.filter((x) => x !== empty);
    this.drop(empty);
    this.layout();
  }
  /** EvokeOrbAnim: the evoked orb fades out in place (0.25 s); a new empty slot flies out from the centre. */
  EvokeOrbAnim(orb: any) {
    const n = [...this.orbs].reverse().find((x) => x.model === orb);
    if (!n) return;
    this.orbs = this.orbs.filter((x) => x !== n);
    const t = run(new $.WebTween());
    t.TweenProperty(n, 'a', 0, 0.25);
    t.Chain().TweenCallback(() => this.drop(n));
    this.orbs.push(this.make(null));
    this.layout();
  }
  /** ClearOrbs (combat end): every orb goes back to the centre (1 s, Sine InOut) while fading (0.25 s), then is freed. */
  ClearOrbs() {
    this.tween?.Kill();
    if (!this.orbs.length) return;
    const t = (this.tween = run(new $.WebTween()));
    for (const n of this.orbs) {
      t.Parallel().TweenProperty(n, 'x', 0, 1).SetEase(EZ.InOut).SetTrans(TR.Sine);
      t.Parallel().TweenProperty(n, 'y', 0, 1).SetEase(EZ.InOut).SetTrans(TR.Sine);
      t.Parallel().TweenProperty(n, 'a', 0, 0.25);
    }
    const gone = this.orbs;
    t.Chain().TweenCallback(() => { for (const n of gone) this.drop(n); });
    this.orbs = [];
  }
  UpdateVisuals() { invalidate(); }
  /** TweenLayout: slot i at angle −25° − (125° − i · 125 / (cap − 1)), radius lerp(225, 300, (cap − 3) / 7); 0.45 s Sine InOut. */
  private layout() {
    const cap = this.capacity;
    if (!cap) return;
    let a = 125;
    const step = a / (cap - 1), r = 225 + (300 - 225) * ((cap - 3) / 7);
    this.tween?.Kill();
    const t = (this.tween = run(new $.WebTween().SetParallel()));
    for (let i = 0; i < cap && i < this.orbs.length; i++) {
      const s = ((-25 - a) * Math.PI) / 180;
      t.TweenProperty(this.orbs[i], 'x', -Math.cos(s) * r, 0.45).SetEase(EZ.InOut).SetTrans(TR.Sine);
      t.TweenProperty(this.orbs[i], 'y', Math.sin(s) * r, 0.45).SetEase(EZ.InOut).SetTrans(TR.Sine);
      a -= step;
    }
  }
}

/** The orb container's origin, creature-local: OrbPos (the IntentPos marker for players) + (0, 195). */
export function orbCentre(c: any): [number, number] {
  const e = spineIndex[`scenes/creature_visuals/${String(c.Player?.Character?.Id?.Entry ?? '').toLowerCase()}.tscn`];
  const p = e?.intentPos ?? [0, -300];
  return [p[0], p[1] + 195];
}

/**
 * The DOM side of each NOrb (× 0.85): the empty-slot outline, the numbers (Kreon Bold 24: passive cream, evoke cyan;
 * Dark shows both, Plasma none; the evoke value replaces the passive one on the orbs an evoking card is aimed at) and
 * the 60 × 60 Bounds that shows the orb's tips to its right.
 */
export function OrbLabels({ view, c, s }: { view: OrbManagerView; c: any; s: Slot }) {
  const [cx, cy] = orbCentre(c);
  const inProgress = safe(() => G.CombatManager.Instance.IsInProgress, false);
  return (
    <>
      {view.nodes.map((n) => {
        const x = s.x + (cx + n.X) * s.s, y = s.y + (cy + n.Y) * s.s, k = 0.85 * s.s;
        const m = n.model, i = view.orbs.indexOf(n);
        const evoking = !!m && (orbEvoke.type === 2 || (orbEvoke.type === 1 && i === 0));
        const id = m ? String(m.Id?.Entry ?? '') : '';
        const dark = id === 'DARK_ORB', plasma = id === 'PLASMA_ORB';
        const passive = m && !plasma && (dark || !evoking), evoke = m && !plasma && (dark || evoking);
        const num = (v: any) => safe(() => Number(v).toFixed(0), '');
        return (
          <div class="orb-node" key={n.id} style={{ left: `${x}px`, top: `${y}px`, scale: String(k), opacity: n.A }}>
            {!m && inProgress && <img class="orb-outline" src={imageUrl('images/orbs/empty_orb.png') ?? ''} />}
            {m && inProgress && (
              <div class="orb-labels">
                {passive && <div class="orb-passive">{num(m.PassiveVal)}</div>}
                {evoke && <div class="orb-evoke">{num(m.EvokeVal)}</div>}
              </div>
            )}
            <div class="orb-bounds"
              onPointerEnter={() => {
                const tips = m ? hoverTipsOf(m) : [{ title: safe(() => G.OrbModel.EmptySlotHoverTipHoverTip.Title, ''), body: safe(() => G.OrbModel.EmptySlotHoverTipHoverTip.Description, '') }];
                setTips(tips, { kind: 'at', x: x - 29 * k + 60, y: y - 29 * k });
              }}
              onPointerLeave={() => setTip(null)} />
          </div>
        );
      })}
    </>
  );
}
