// Draws the web card nodes (cardnodes.ts) every frame — hand holders (NHandCardHolder Flash and index label), the play
// queue and container, cards on the Ui root and in CombatVfxContainer — with their NCardHighlight glow; the targeting
// arrow (NTargetingArrow); and the pointer plumbing NMouseCardPlay / NTargetManager listen to.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'preact/hooks';
import { G, $ } from '../game';
import { imageUrl } from '../assets';
import { Card } from './card';
import { setTips, setTip, hoverTipsOf } from './tooltip';
import { CardNodeView, HolderView, SelectedHolderView, HandView, arrow, mouse, targetManager, type Xf } from '../cardnodes';
import { highlightImage } from '../render/highlight';
import { playOneShot } from '../audio';
import type { FxSlot } from '../render/cardfx';

type AnyHolder = HolderView | SelectedHolderView;
interface Entry { node: CardNodeView; holder: AnyHolder | null; z: number; slot?: FxSlot }
/**
 * Cards under `root` in drawing order: tree order, lifted by (relative) ZIndex like Godot's canvas sort. `skip`: a
 * subtree drawn elsewhere. A VFX node with an FX slot (render/cardfx.ts) comes after its own children's cards.
 */
function collect(root: any, skip: any): Entry[] {
  const out: Entry[] = [];
  const walk = (n: any, z: number, holder: AnyHolder | null) => {
    if (!n || n.$freed || n.Visible === false || n === skip) return;
    const zz = z + (n.ZIndex || 0);
    if (n instanceof CardNodeView) out.push({ node: n, holder, z: zz });
    for (const c of n.$kids ?? []) walk(c, zz, n instanceof HolderView || n instanceof SelectedHolderView ? n : holder);
    if (n.$fxSlot) out.push({ node: n, holder: null, z: zz, slot: n.$fxSlot });
  };
  walk(root, 0, null);
  return out;
}
const keyOf = (e: Entry) => (e.slot ? -e.slot.id : e.node.id);
const css = (t: Xf) => `translate(${t.x}px, ${t.y}px) rotate(${t.rot}rad) scale(${t.sx}, ${t.sy})`;
const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const showIndices = () => { try { return !!G.SaveManager.Instance.PrefsSave.ShowCardIndices; } catch { return false; } };
export function CardLayer({ root, hand, skip }: { root: any; hand?: HandView | null; skip?: any }) {
  const els = useRef(new Map<number, HTMLElement>());
  const entries = collect(root, skip);
  const live = useRef(entries);
  live.current = entries;
  useEffect(() => {
    let frame = 0;
    return $.onFrame(() => {
      frame++;
      const time = performance.now() / 1000;
      live.current.forEach((e, order) => {
        const el = els.current.get(keyOf(e));
        if (!el) return;
        if (e.slot) { el.style.zIndex = String(e.z * 1000 + order); return; }
        const n = e.node, h = e.holder;
        const outer = h ? h.xf() : n.xf();
        el.style.transform = css(outer);
        el.style.zIndex = String(e.z * 1000 + order);
        if (el.style.filter !== n.cssFilter) el.style.filter = n.cssFilter;
        const body = el.children[1] as HTMLElement;
        const bs = n.Body.Scale;
        body.style.transform = h
          ? `translate(${n.Position.X}px, ${n.Position.Y}px) rotate(${n.Rotation}rad) scale(${n.Scale.X * bs.X}, ${n.Scale.Y * bs.Y})`
          : `scale(${bs.X}, ${bs.Y})`;
        const m = n.modulate(), bm = n.Body.Modulate;
        el.style.opacity = String(Math.max(0, Math.min(1, m[3] * bm.A)));
        const b = m[0] * bm.R;
        body.style.filter = b < 0.999 ? `brightness(${b})` : '';
        // NCardHighlight
        const cv = body.children[0] as HTMLCanvasElement;
        const img = highlightImage(n.CardHighlight.width, n.CardHighlight.color, frame, time);
        cv.style.display = img ? '' : 'none';
        if (img) { const g = cv.getContext('2d')!; g.clearRect(0, 0, 256, 256); g.drawImage(img, 0, 0); }
        // holder Flash + index label
        const flash = el.children[0] as HTMLElement;
        if (h instanceof HolderView && h.flash.a > 0) { flash.style.display = ''; flash.style.opacity = String(h.flash.a); flash.style.filter = `url(#tint-${h.flash.color.join('-').replace(/\./g, '_')})`; }
        else flash.style.display = 'none';
        const idx = el.children[2] as HTMLElement;
        const showIdx = h instanceof HolderView && h.indexLabel > 0 && showIndices();
        idx.style.display = showIdx ? '' : 'none';
        if (showIdx) idx.textContent = String((h as HolderView).indexLabel % 10);
        // NHandCardHolder hitbox: live once it is near its slot, ignored while a card is dragged or targeted
        const hit = !!h && !!hand && ((h instanceof HolderView && h.$parent === hand.CardHolderContainer && h.hitboxEnabled) || h instanceof SelectedHolderView) && !hand.dragging && !targetManager.IsInSelection;
        el.style.pointerEvents = hit ? 'auto' : 'none';
      });
    });
  }, [root, hand]);
  return (
    <div class="card-layer">
      {entries.map((e) => {
        const n = e.node, h = e.holder, model = n.Model, slot = e.slot;
        if (slot) return <canvas key={'fx' + slot.id} class="fx-slot" ref={(c) => { if (c) els.current.set(-slot.id, c); else els.current.delete(-slot.id); slot.canvas = c; }} />;
        return (
          <div key={n.id} class="card-node" ref={(el) => { if (el) els.current.set(n.id, el); else els.current.delete(n.id); }}
            onPointerEnter={h instanceof HolderView ? () => {
              h.focus(true);
              // SetAlignmentForCardHolder: beside the lifted card (hitbox 300 × 422 around the holder)
              // SetFollowOwner: the set moves with the holder while it is still on its way to its slot
              const g = h.GlobalPosition;
              setTips(hoverTipsOf(model), { kind: 'holder', rect: [g.X - 150, g.Y - 211, 300, 422], x: g.X, starCost: safe(() => model.CurrentStarCost > 0 || model.HasStarCostX, false) },
                () => (h.$freed ? null : [h.GlobalPosition.X, h.GlobalPosition.Y]));
            } : h instanceof SelectedHolderView ? () => h.focus(true) : undefined}
            onPointerLeave={h ? () => { h.focus(false); setTip(null); } : undefined}
            onPointerDown={h && hand ? (ev) => {
              if (ev.button !== 0) return;
              setTip(null);
              if (h instanceof SelectedHolderView) { playOneShot('event:/sfx/ui/clicks/ui_click'); h.container.DeselectHolder(h); }
              else hand.press(h);
            } : undefined}>
            <img class="holder-flash" src={imageUrl('images/packed/card_template/card_flash.png') ?? ''} style={{ display: 'none' }} />
            <div class="card-body">
              <canvas class="card-highlight" width={256} height={256} />
              <Card card={model} pile={n.pileType} target={n.previewTarget} width={300} mode={n.previewMode || 1} pretend={n.pretend} unpowered={n.unpowered} hideEnch={!n.EnchantmentTab.Visible} style={{ left: '-150px', top: '-211px', position: 'absolute' }} />
              {/* card.tscn EnchantmentVfxOverride (−202, −142, 144 × 108) */}
              {n.EnchantmentVfxOverride.Visible && <canvas width={144} height={108} style={{ position: 'absolute', left: '-202px', top: '-142px' }}
                ref={(c) => { n.EnchantmentVfxOverride.canvas = c; }} />}
            </div>
            <span class="hand-index" style={{ display: 'none' }} />
          </div>
        );
      })}
    </div>
  );
}

/** SVG colour-multiply filters for Godot modulates on textures (targeting arrow, holder flash). */
export function TintFilters() {
  const tints = [[1, 1, 1], [0xe6 / 255, 0x1e / 255, 0x1b / 255], [0x36 / 255, 0xc7 / 255, 0x8a / 255], [0, 0.957, 0.988, 0.98], [1, 0.784, 0, 0.98], [0.83, 0, 0.33, 0.98], [0.25, 0.875, 1], [0, 0.831, 1]];
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      {tints.map((c) => (
        <filter id={'tint-' + c.join('-').replace(/\./g, '_')} color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values={`${c[0]} 0 0 0 0 0 ${c[1]} 0 0 0 0 0 ${c[2]} 0 0 0 0 0 1 0`} />
        </filter>
      ))}
    </svg>
  );
}

/** NTargetingArrow: 19 Bézier segments from the card to the cursor and the head, tinted on a valid target. */
export function TargetingArrow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => $.onFrame(() => {
    const el = ref.current;
    if (!el) return;
    el.style.display = arrow.visible ? '' : 'none';
    if (!arrow.visible) return;
    el.style.filter = `url(#tint-${arrow.color.join('-').replace(/\./g, '_')})`;
    const kids = el.children;
    arrow.segments.forEach((s, i) => { (kids[i] as HTMLElement).style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.rot}rad) scale(${s.scale})`; });
    const h = arrow.head;
    (kids[19] as HTMLElement).style.transform = `translate(${h.x}px, ${h.y}px) rotate(${h.rot}rad) scale(${h.scale})`;
  }), []);
  return (
    <div class="targeting-arrow" ref={ref} style={{ display: 'none' }}>
      {arrow.segments.map(() => <img class="arrow-seg" src={imageUrl('images/ui/combat/targeting_arrow_segment.png') ?? ''} />)}
      <img class="arrow-head" src={imageUrl('images/ui/combat/targeting_arrow_head.png') ?? ''} />
    </div>
  );
}

/** Viewport (1920 × 1080) mouse position and buttons for the card play and the target manager. */
export function usePointer(hand: () => HandView | null) {
  useEffect(() => {
    const root = document.querySelector('.stage-root') as HTMLElement | null;
    const move = (e: PointerEvent) => {
      const r = (root ?? document.body).getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 1920;
      mouse.y = ((e.clientY - r.top) / r.height) * 1080;
    };
    const button = (down: boolean) => (e: PointerEvent) => {
      move(e);
      hand()?.currentPlay?.button(e.button, down);
      targetManager.button(e.button, down);
    };
    const bd = button(true), bu = button(false);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', bd, true);
    window.addEventListener('pointerup', bu, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', bd, true);
      window.removeEventListener('pointerup', bu, true);
    };
  }, []);
}
