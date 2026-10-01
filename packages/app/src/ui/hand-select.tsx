// NPlayerHand selection mode UI (CardSelectCmd.FromHand*): SelectionHeader, NConfirmButton, NPeekButton and the
// NUpgradePreview (chosen card, three arrows, the upgraded copy). The backstop and the cards are drawn by combat.tsx.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'preact/hooks';
import { G, $ } from '../game';
import { imageUrl, frameByName, frameStyle } from '../assets';
import { RichText } from './richtext';
import { Card } from './card';
import { ConfirmButton, type ButtonHotkey } from './buttons';
import { setTips, setTip, hoverTipsOf } from './tooltip';
import { playOneShot } from '../audio';
import { tint } from '../filters';
import { UPGRADE_BEFORE, UPGRADE_AFTER, type HandView } from '../cardnodes';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
/** NUpgradePreview: CloneCard + UpgradeInternal, previewed in combat. */
const clones = new WeakMap<any, any>();
function upgraded(card: any) {
  let c = clones.get(card);
  if (!c) {
    c = safe(() => { const x = card.CardScope.CloneCard(card); x.UpgradeInternal(); x.UpgradePreviewType = G.CardUpgradePreviewType.Combat; return x; }, null);
    if (c) clones.set(card, c);
  }
  return c;
}

export function HandSelectUi({ hand }: { hand: HandView }) {
  const s = hand.select;
  const [hoverBefore, setHoverBefore] = useState(false);
  const up = s.upgradeShown && s.upgradeCard && !s.peeking ? s.upgradeCard : null;
  const after = up ? upgraded(up) : null;
  const arrow = imageUrl('images/ui/cards/upgrade_preview/upgrade_arrow.png') ?? '';
  return (
    <>
      {up && (
        <div class="upgrade-preview">
          {/* NPreviewCardHolder (scaleOnHover): 1.1 at once on hover, back to 1 over 0.5 s */}
          <div class={'up-card' + (hoverBefore ? ' hover' : '')} style={{ left: `${UPGRADE_BEFORE.X}px`, top: `${UPGRADE_BEFORE.Y}px`, transform: `translate(-50%, -50%) scale(${hoverBefore ? 0.99 : 0.9})` }}
            onPointerEnter={() => setHoverBefore(true)} onPointerLeave={() => setHoverBefore(false)}
            onPointerDown={(e) => { if (e.button === 0) { playOneShot('event:/sfx/ui/clicks/ui_click'); setHoverBefore(false); hand.returnUpgradeCard(); } }}>
            <Card card={up} pile={G.PileType.Hand} />
          </div>
          <div class="up-arrows">{[0, 1, 2].map(() => <img src={arrow} />)}</div>
          <div class="up-arrows shadow">{[0, 1, 2].map(() => <img src={arrow} />)}</div>
          {after && (
            // SetAlignmentForCardHolder: text tips at the hitbox + (300 + 10) × the holder's own scale (1)
            <div class="up-card" style={{ left: `${UPGRADE_AFTER.X}px`, top: `${UPGRADE_AFTER.Y}px`, transform: 'translate(-50%, -50%) scale(.9)' }}
              onPointerEnter={() => setTips(hoverTipsOf(after), { kind: 'holder', rect: [UPGRADE_AFTER.X - 135, UPGRADE_AFTER.Y - 190, 300, 380], x: UPGRADE_AFTER.X })} onPointerLeave={() => setTip(null)}>
              <Card card={after} pile={G.PileType.Hand} mode={2} />
            </div>
          )}
        </div>
      )}
      {!s.peeking && s.header && <div class="select-header"><RichText text={s.header} /></div>}
      {s.peekEnabled && <PeekButton peeking={s.peeking} wiggle={s.wiggle} onToggle={() => hand.togglePeek()} hotkey={handPeek} />}
    </>
  );
}

/**
 * player_hand.tscn SelectModeConfirmButton: lives with the combat UI so that it slides in when the selection can be
 * confirmed and out (0.35 s) when it can't or the selection ends; a peek target (hidden at once while peeking).
 */
export function SelectConfirmButton({ hand }: { hand: HandView }) {
  return <ConfirmButton enabled={hand.IsInCardSelection && hand.select.confirm} onClick={() => hand.confirmSelection()} style={hand.select.peeking ? { visibility: 'hidden' } : undefined} hotkey={handConfirm} />;
}
/** The selection confirm button's accept hotkey (bound while it is enabled). */
const handConfirm: ButtonHotkey = { press: null, release: null };
/** E (MegaInput.accept) during a selection belongs to the confirm button: pressed on key down, released on key up. */
export function confirmHotkey(): (() => void) | null {
  if (!handConfirm.press) return null;
  handConfirm.press();
  return () => handConfirm.release?.();
}

// ------------------------------------------------------------------ NPeekButton
type PeekHotkey = { press: (() => void) | null; release: (() => void) | null };
/** The hand's peek button, for its Space hotkey (MegaInput.peek). */
const handPeek: PeekHotkey = { press: null, release: null };
export function peekHotkey(): (() => void) | null {
  if (!handPeek.press) return null;
  handPeek.press();
  return () => handPeek.release?.();
}
/** button_pulse.gdshader (COLOR.rgb += |sin(2 TIME)| × 0.2 × pulse_strength) as one shared SVG filter, updated per frame. */
let pulseFuncs: SVGElement[] | null = null;
function pulseFilter(add: number) {
  if (!pulseFuncs) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
    svg.innerHTML = '<filter id="peek-pulse" color-interpolation-filters="sRGB"><feComponentTransfer>'
      + '<feFuncR type="linear" slope="1" intercept="0"/><feFuncG type="linear" slope="1" intercept="0"/><feFuncB type="linear" slope="1" intercept="0"/>'
      + '</feComponentTransfer></filter>';
    document.body.appendChild(svg);
    pulseFuncs = Array.from(svg.querySelectorAll('feFuncR, feFuncG, feFuncB'));
  }
  const v = add.toFixed(4);
  for (const f of pulseFuncs) if (f.getAttribute('intercept') !== v) f.setAttribute('intercept', v);
  return 'url(#peek-pulse)';
}
/** NClickableControl + NPeekButton: Visuals scale on hover / press / release, Wiggle (rotation, scale and the tinted flash). */
class PeekCtl {
  hovered = false;
  pressed = false;
  n = { Scale: 1, Rot: 0, FlashA: 0, flash: false };
  private hoverTw: any = null;
  private wiggleTw: any = null;
  onToggle: () => void = () => {};
  private scaleTo(s: number, d: number) {
    this.hoverTw?.Kill();
    this.hoverTw = new $.WebTween();
    this.hoverTw.TweenProperty(this.n, 'scale', s, d);
  }
  hover(on: boolean) {
    if (on === this.hovered) return;
    this.hovered = on;
    if (on) { playOneShot('event:/sfx/ui/clicks/ui_hover'); this.scaleTo(1.1, 0.05); } else this.scaleTo(1, 0.15);
  }
  press() { this.pressed = true; playOneShot('event:/sfx/ui/clicks/ui_click'); this.scaleTo(0.95, 0.05); }
  release() { if (!this.pressed) return; this.pressed = false; this.onToggle(); this.scaleTo(1, 0.15); }
  wiggle() {
    const n = this.n;
    n.flash = true;
    n.FlashA = 0;
    this.wiggleTw?.Kill();
    const tw = (this.wiggleTw = new $.WebTween());
    n.Rot = 0;
    tw.TweenMethod((t: number) => { n.Rot = 10 * Math.sin(t * 3) * Math.sin(t * 0.5); }, 0, Math.PI * 2, 0.5);
    tw.Parallel().TweenMethod((t: number) => { n.Scale = 1 + 0.15 * Math.sin(t) * Math.sin(t * 0.5); }, 0, Math.PI, 0.25);
    tw.Parallel().TweenProperty(n, 'flash_a', 1, 0.1);
    tw.Chain().TweenProperty(n, 'flash_a', 0, 0.3).SetTrans(4).SetEase(1);
    safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play('deny.mp3', 0.5, G.PitchVariance.Medium), null);
  }
  kill() { this.hoverTw?.Kill(); this.wiggleTw?.Kill(); }
}
/** NPeekButton (128 × 128 at (100, 476)): hides its screen's targets and the backstop while peeking; Space toggles it. */
export function PeekButton({ peeking, onToggle, wiggle = 0, hotkey }: { peeking: boolean; onToggle: () => void; wiggle?: number; hotkey?: PeekHotkey }) {
  const ref = useRef<PeekCtl | null>(null);
  if (!ref.current) ref.current = new PeekCtl();
  const c = ref.current;
  c.onToggle = onToggle;
  const vis = useRef<HTMLDivElement>(null), flash = useRef<HTMLImageElement>(null);
  const on = useRef(peeking);
  on.current = peeking;
  useEffect(() => {
    const press = () => c.press();
    if (hotkey) { hotkey.press = press; hotkey.release = () => c.release(); }
    const stop = $.onFrame(() => {
      const n = c.n, xf = `rotate(${n.Rot}deg) scale(${n.Scale})`;
      if (vis.current) {
        vis.current.style.transform = xf;
        vis.current.style.filter = on.current ? pulseFilter(Math.abs(Math.sin((performance.now() / 1000) * 2)) * 0.2) : '';
      }
      if (flash.current) {
        flash.current.style.display = n.flash ? '' : 'none';
        flash.current.style.transform = xf;
        flash.current.style.opacity = String(n.FlashA);
      }
    });
    return () => { stop(); c.kill(); if (hotkey?.press === press) hotkey.press = hotkey.release = null; };
  }, []);
  // NPlayerHand.OnHolderPressed while peeking → Wiggle
  const seen = useRef(wiggle);
  useEffect(() => { if (wiggle !== seen.current) { seen.current = wiggle; c.wiggle(); } }, [wiggle]);
  return (
    <div class="peek-button" onPointerEnter={() => c.hover(true)} onPointerLeave={() => c.hover(false)}
      onPointerDown={(e) => { if (e.button === 0 && c.hovered) c.press(); }} onPointerUp={(e) => { if (e.button === 0 && c.hovered) c.release(); }}>
      {/* Flash: additive, show_behind_parent, modulate (0.918, 0.724, 0.676), turning with Visuals around its pivot */}
      <img class="peek-flash" ref={flash} src={imageUrl('images/packed/common_ui/peek_button_sdf.png') ?? ''} style={{ display: 'none', filter: tint(0.918008, 0.723657, 0.675867) }} />
      <div class="peek-img" ref={vis} style={frameStyle(frameByName('ui_atlas', 'peek_button'), 128, 128)} />
    </div>
  );
}
