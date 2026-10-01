// NMerchantRoom (view: MerchantView in bridge.ts): the shop scene with the merchant as a button, the proceed button, and
// NMerchantInventory over it — the black backstop, the rug (shop_rug stretched to 1747 × 978 at x 118) with its slots
// (merchant_card / _relic / _potion / _card_removal scenes, at 0.65), the back button, the merchant's hand (Spine) and
// the rug dialogue. Slot-local numbers below are the scenes' own (unscaled) units. The Fake Merchant event's NFakeMerchant
// (FakeMerchantView) is the same room on its own scene: fake_merchant.tscn and fake_merchant_inventory.tscn.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Application, Assets, Container } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { G, $, list } from '../game';
import { A, imageUrl, frameByName, frameStyle, atlasFrame } from '../assets';
import { playOneShot } from '../audio';
import { loc, locv } from '../i18n';
import { hsvFilter } from '../filters';
import { RichText } from './richtext';
import { Card } from './card';
import { Backdrop } from './backdrop';
import { BackButton, ProceedButton } from './buttons';
import { setTip, setTips, hoverTipsOf } from './tooltip';
import { inspectCard } from './cards-view';
import { merchantBackdrop, fakeMerchantBackdrop } from '../render/scene';
import { creatureSpine, visualsKey } from '../render/stage';
import { bubbles, type MerchantView, type FakeMerchantView } from '../bridge';
import { noise } from './screenshake';
import { SpeechBubble } from './creature-ui';
import { TargetingArrow, TintFilters, usePointer } from './cardlayer';
import { bigIcon, inspectRelic } from './inspect';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const img = (p: string) => imageUrl(p) ?? '';
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const TR = { Sine: 1, Expo: 5, Back: 10 }, EZ = { Out: 1 };
type ShopView = MerchantView | FakeMerchantView;
const outlineSkin = (view: ShopView) => (sp: Spine) => { if (sp.skeleton.data.findSkin('outline')) view.MerchantButton.spine = sp; };
const reticle = (view: ShopView) => (r: any) => { view.MerchantButton.reticle = r; };
/** The top of SceneContainer in the backdrop: scenes added to the room's container (the Foul Potion's splash) play there. */
const withSceneFx = (view: ShopView) => (c: Container | null) => { if (c) { const fx = new Container(); c.addChild(fx); view.MerchantButton.scene.layer = fx; } return c; };

export function ShopScreen({ view }: { view: MerchantView }) {
  const players = safe(() => list(view.players), []);
  return <ShopRoom view={view} backdrop={() => merchantBackdrop(players, outlineSkin(view), reticle(view)).then(withSceneFx(view))} />;
}

/**
 * NFakeMerchant: the fake merchant's room; its CharacterContainer holds the player's combat visuals
 * (Character.CreateVisuals) playing relaxed_loop at the rolled time scale, from the rolled track time.
 */
export function FakeMerchantScreen({ view }: { view: FakeMerchantView }) {
  const build = async () => {
    const cs = await safe(() => creatureSpine(visualsKey(view.me.Creature)), Promise.resolve(null));
    const sp = cs?.spine;
    if (sp?.skeleton.data.findAnimation('relaxed_loop')) {
      sp.state.clearTracks();
      const e = sp.state.setAnimation(0, 'relaxed_loop', true);
      const [scale, offset] = view.charAnim;
      e.timeScale = scale;
      e.trackTime = (e.animationEnd + offset) % e.animationEnd;
    }
    return withSceneFx(view)(await fakeMerchantBackdrop(cs?.root ?? null, view.MerchantButton.shown, view.rugHidden, outlineSkin(view), reticle(view)));
  };
  return <ShopRoom view={view} backdrop={build} />;
}

/**
 * The room over its backdrop: SceneContainer's speech bubbles, the merchant button, proceed, the inventory; and the
 * targeting arrow (a potion aimed at the merchant) with its pointer plumbing.
 */
function ShopRoom({ view, backdrop }: { view: ShopView; backdrop: () => Promise<Container | null> }) {
  usePointer(() => null);
  return (
    <div class="shop" data-shake>
      <Backdrop id={`shop:${view.rug}`} build={backdrop} />
      <div class="shop-scene-fx">{bubbles.filter((b) => !b.c).map((b) => <SpeechBubble key={'b' + b.id} b={b} s={undefined} />)}</div>
      {view.MerchantButton.shown && <MerchantButton view={view} />}
      <ProceedButton enabled={view.proceedOn} pulse={view.pulse} onClick={() => view.proceed()} />
      <Inventory view={view} />
      {view.blocked && <div class="shop-blocker" />}
      <TargetingArrow />
      <TintFilters />
    </div>
  );
}

/**
 * NMerchantButton over the merchant (the real one (1206, 468) 270 × 330, the fake one (1164, 361) 270 × 437): hover
 * switches his skin to the outlined one — or targets him (the selection reticle) while a potion is aimed.
 */
function MerchantButton({ view }: { view: ShopView }) {
  const b = view.MerchantButton, [x, y, w, h] = b.rect;
  const pressed = useRef(false);
  const enabled = !view.open;
  const focused = useRef(false);
  // NClickableControl.RefreshFocus: focus follows hover while enabled
  const focus = (on: boolean) => { if (focused.current === on) return; focused.current = on; if (on) b.OnFocus(); else b.OnUnfocus(); };
  useEffect(() => { if (!enabled) focus(false); }, [enabled]);
  return (
    <div class="merchant-btn" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
      onPointerEnter={() => { if (enabled) focus(true); }}
      onPointerLeave={() => { pressed.current = false; focus(false); }}
      onPointerDown={(e) => { if (enabled && focused.current && e.button === 0) { pressed.current = true; b.OnPress(); } }}
      onPointerUp={(e) => { if (enabled && focused.current && e.button === 0 && pressed.current) { pressed.current = false; b.OnRelease(); } }} />
  );
}

function Inventory({ view }: { view: ShopView }) {
  const backstop = useRef<HTMLDivElement>(null), rug = useRef<HTMLDivElement>(null);
  const paint = () => {
    if (backstop.current) backstop.current.style.opacity = String(view.fx.BackstopA);
    if (rug.current) rug.current.style.top = `${view.fx.RugY}px`;
  };
  useLayoutEffect(() => { view.paint = paint; paint(); return () => { if (view.paint === paint) view.paint = undefined; }; });
  const inv = view.inv, S = view.slots;
  return (
    <div class={'shop-inv' + (view.open ? ' open' : '')}>
      <div class="shop-backstop" ref={backstop} />
      <div class="shop-rug" ref={rug}>
        <img class="shop-rug-img" src={img(view.rug)} />
        {list(inv.CharacterCardEntries).map((e: any, i: number) => <CardSlot view={view} e={e} at={S.cards[i]} key={i} />)}
        {list(inv.ColorlessCardEntries).map((e: any, i: number) => <CardSlot view={view} e={e} at={S.colorless[i]} key={'c' + i} />)}
        {list(inv.RelicEntries).map((e: any, i: number) => <RelicSlot view={view} e={e} at={S.relics[i]} key={'r' + i} />)}
        {list(inv.PotionEntries).map((e: any, i: number) => <PotionSlot view={view} e={e} at={S.potions[i]} key={'p' + i} />)}
        {inv.CardRemovalEntry && S.removal && <RemovalSlot view={view} e={inv.CardRemovalEntry} at={S.removal} />}
      </div>
      <BackButton enabled={view.backOn} onClick={() => view.close()} />
      <MerchantHand view={view} />
      <Dialogue line={view.line} y={271} hsv={[1, 1.2, 0.4]} hold={1} />
    </div>
  );
}

// ------------------------------------------------------------------ slots
/**
 * NMerchantSlot: 0.65, 0.8 at once while hovered (0.65 again over 0.5 s Expo Out); a left release tries the purchase,
 * a right release previews. The hand points at the slot while it is hovered. Slots are not buttons: no sounds.
 * A failed purchase wiggles the visual: x = sin(p·2π)·10 for p 0 → 2 over 0.4 s Quad Out.
 */
function Slot({ view, e, at, hit, visual, children, tip, onPreview, disabled }: {
  view: ShopView; e: any; at: number[]; hit: number[]; visual: any; children?: any; tip: () => void; onPreview?: () => void; disabled?: boolean;
}) {
  const [hot, setHotState] = useState(false);
  const hotRef = useRef(false);
  const setHot = (v: boolean) => { hotRef.current = v; setHotState(v); };
  useEffect(() => { if (disabled && hotRef.current) { setHot(false); setTip(null); } }, [disabled]);
  const vis = useRef<HTMLDivElement>(null);
  const wiggle = view.wiggles.get(e) ?? 0;
  useEffect(() => {
    if (!wiggle || !vis.current) return;
    const frames = Array.from({ length: 25 }, (_, i) => { const t = i / 24, p = (1 - (1 - t) * (1 - t)) * 2; return { translate: `${Math.sin(p * 2 * Math.PI) * 10}px 0` }; });
    vis.current.animate(frames, { duration: 400 });
  }, [wiggle]);
  const [x, y] = at;
  const leave = () => { setHot(false); setTip(null); view.stopPointing(2); };
  return (
    <div class="shop-slot" ref={(el) => { if (el) view.slotEls.set(e, el); }}
      style={{ left: `${x - 118}px`, top: `${y - 80}px`, scale: hot ? '0.8' : '0.65', transition: hot ? 'none' : `scale .5s ${EXPO_OUT}` }}>
      <div class="shop-visual" ref={vis}>{visual}</div>
      {children}
      {!disabled && (
        <div class="shop-hit" style={{ left: `${hit[0]}px`, top: `${hit[1]}px`, width: `${hit[2]}px`, height: `${hit[3]}px` }}
          onPointerEnter={() => { setHot(true); tip(); const o = view.slotOrigin(e); if (o) view.pointAt(o[0], o[1]); }}
          onPointerLeave={leave}
          onPointerUp={async (ev) => {
            if (!hotRef.current) return;
            if (ev.button === 2) { setTip(null); onPreview?.(); return; }
            if (ev.button !== 0) return;
            setTip(null);
            await view.buy(e);
            if (safe(() => e.IsStocked, false) && hotRef.current) tip();
          }}
          onContextMenu={(ev) => ev.preventDefault()} />
      )}
    </div>
  );
}

/** The cost HBox (separation 6, centred): the top-bar gold icon in 54 × 54 and the price (Kreon Bold 39, outline 15). */
function Price({ e, x, y, w, h, sale }: { e: any; x: number; y: number; w: number; h: number; sale?: boolean }) {
  const f = frameByName('ui_atlas', 'top_bar/top_bar_gold');
  const k = f ? Math.min(54 / (f.sw * 2), 54 / (f.sh * 2)) : 1;
  const color = !safe(() => e.EnoughGold, true) ? '#FF5555' : sale ? '#7FFF00' : '#FFF6E2';
  return (
    <div class="shop-price" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}>
      <div class="shop-gold"><div style={frameStyle(f, f ? f.sw * 2 * k : 54, f ? f.sh * 2 * k : 54)} /></div>
      <span style={{ color }}>{safe(() => e.Cost, 0)}</span>
    </div>
  );
}

/** NMerchantCard: the card centred on the slot, the price under it, the sale tag at its top right. */
function CardSlot({ view, e, at }: { view: ShopView; e: any; at: number[] }) {
  const card = view.shown.get(e) ?? safe(() => e.CreationResult?.Card ?? null, null);
  if (!card || !safe(() => e.CreationResult, null)) return null;
  const [x, y] = at;
  return (
    <Slot view={view} e={e} at={at} hit={[-150, -211, 300, 422]}
      visual={<div class="shop-card"><Card card={card} width={300} /></div>}
      tip={() => setTips(hoverTipsOf(card), { kind: 'align', rect: [x - 120, y - 168.8, 300, 422], align: x > 1440 ? 'left' : 'right' })}
      onPreview={() => inspectCard([card], card)}>
      <Price e={e} x={-148} y={220} w={297} h={58} sale={safe(() => e.IsOnSale, false)} />
      {safe(() => e.IsOnSale, false) && <img class="shop-sale" src={img('images/rooms/merchant_room/shop_sales_tag.png')} />}
    </Slot>
  );
}

/**
 * NMerchantRelic: the small NRelic at 2× (icon 120 at (−56, −72), black outline at 0.5), the hit box on the icon. With
 * the Large icon size (the fake merchant's) the NRelic is 128² with the BigIcon (120, no outline), raised by the cost
 * label's height — the label's minimum height when the slot is filled (its HBox sorts later): Kreon Bold 39, ascent 38 +
 * descent 11 = 49.
 * ponytail: 49 is FreeType's rounding of Kreon's metrics at 1× oversampling; Godot at a larger window may round ±1 px.
 * The tips go left of the slot right of the screen's middle, else right (CreateHoverTip, at the hover scale 0.8).
 */
const COST_LABEL_H = 49;
function RelicSlot({ view, e, at }: { view: ShopView; e: any; at: number[] }) {
  const relic = safe(() => e.Model, null);
  if (!relic) return null;
  const id = String(safe(() => relic.Id.Entry, '')).toLowerCase();
  const icon = atlasFrame(safe(() => relic.IconPath, '')) ?? frameByName('relic_atlas', id);
  const large = view.largeRelics, top = large ? -72 - 2 * COST_LABEL_H : -72, size = large ? 240 : 120;
  const k = 122 * 0.5 * 0.8;
  return (
    <Slot view={view} e={e} at={at} hit={[-56, top, size, size]}
      visual={large
        ? <div class="shop-relic" style={{ top: `${top}px`, width: `${size}px`, height: `${size}px` }}><img class="shop-relic-big" src={bigIcon(relic)} /></div>
        : <div class="shop-relic">
          <div class="relic-outline" style={frameStyle(frameByName('relic_outline_atlas', id), 120, 120)} />
          <div class="shop-relic-icon" style={frameStyle(icon, 120, 120)} />
        </div>}
      onPreview={() => inspectRelic([relic], relic)}
      tip={() => setTips(hoverTipsOf(relic), at[0] > 960 ? { kind: 'at', x: at[0] - k, y: at[1] - k, rightEdge: true } : { kind: 'at', x: at[0] + k, y: at[1] - k })}>
      <Price e={e} x={-148} y={52} w={296} h={54} />
    </Slot>
  );
}

/** NMerchantPotion: the potion at 1.5× (90 at (−44, −50)) with its black outline. */
function PotionSlot({ view, e, at }: { view: ShopView; e: any; at: number[] }) {
  const p = safe(() => e.Model, null);
  if (!p) return null;
  const path = safe(() => p.ImagePath, '');
  return (
    <Slot view={view} e={e} at={at} hit={[-56, -56, 112, 112]}
      visual={<div class="shop-potion">
        <div class="tb-potion-outline" style={frameStyle(atlasFrame(path.replace('potion_atlas', 'potion_outline_atlas')) ?? frameByName('potion_outline_atlas', String(p.Id.Entry).toLowerCase()), 90, 90)} />
        <div class="shop-potion-img" style={frameStyle(atlasFrame(path), 90, 90)} />
      </div>}
      tip={() => setTips(hoverTipsOf(p), { kind: 'at', x: at[0] - 122 * 0.4, y: at[1] - 122 * 0.4, rightEdge: true })}>
      <Price e={e} x={-147.7} y={47.7} w={297} h={54} />
    </Slot>
  );
}

/**
 * NMerchantCardRemoval: card_removal_00 at 0.56 with a black 0.25 shadow; once used the "Used" animation runs the
 * frames 00 → 01 (0.533 s) → 02 (0.6) → 04 (0.667) → 05 (0.733, crossed out), the price hides and the slot stays.
 */
function RemovalSlot({ view, e, at }: { view: ShopView; e: any; at: number[] }) {
  const used = view.removalUsed;
  const [frame, setFrame] = useState('00');
  useEffect(() => {
    if (!used) { setFrame('00'); return; }
    const ts = [[533, '01'], [600, '02'], [667, '04'], [733, '05']].map(([ms, f]) => setTimeout(() => setFrame(f as string), ms as number));
    return () => ts.forEach(clearTimeout);
  }, [used]);
  const src = img(`images/rooms/merchant_room/card_removal_${frame}.png`);
  const tip = () => setTip(loc('merchant_room', 'MERCHANT.cardRemovalService.title'),
    locv('merchant_room', 'MERCHANT.cardRemovalService.description', { Amount: safe(() => e.CalcPriceIncrease(), 25) }),
    { kind: 'at', x: at[0] - 218 * 0.4, y: at[1] - 218 * 0.4, rightEdge: true });
  return (
    <Slot view={view} e={e} at={at} hit={[-157, -126, 311, 300]} disabled={used} tip={tip}
      visual={<div class="shop-removal">
        <img class="shop-removal-shadow" src={src} />
        <img class="shop-removal-img" src={src} />
      </div>}>
      {!used && <Price e={e} x={-147.7} y={176.9} w={297} h={54} />}
    </Slot>
  );
}

// ------------------------------------------------------------------ the merchant's hand
let appP: Promise<Application> | null = null;
const handApp = () => (appP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, autoStart: false, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
  a.canvas.classList.add('shop-hand');
  return a;
})());
const handLoads = new Map<string, Promise<boolean>>();
/**
 * NMerchantHand: the hand skeleton (0.4, from (234, −54)) drifts towards its target (a slot − 50, or home) plus Perlin
 * noise × 100, easing at delta·4; its "rotate_me" bone turns with x: lerp(−10, 10, (x − 960 − 50)·0.01) degrees.
 * The skeleton is the inventory scene's (`view.handSkel`: the merchant's or the fake merchant's hand).
 */
function MerchantHand({ view }: { view: ShopView }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false, stop = () => {};
    const holder = new Container();
    holder.position.set(234, -54);
    holder.scale.set(0.4);
    void handApp().then(async (a) => {
      if (dead) return;
      a.stage.removeChildren();
      a.stage.addChild(holder);
      host.current?.appendChild(a.canvas);
      const path = view.handSkel;
      let load = handLoads.get(path);
      if (!load) {
        Assets.add({ alias: `${path}:skel`, src: `${A}${path}.skel` });
        Assets.add({ alias: `${path}:atlas`, src: `${A}${path}.atlas` });
        handLoads.set(path, (load = Assets.load([`${path}:skel`, `${path}:atlas`]).then(() => true).catch(() => false)));
      }
      if (!(await load) || dead) return;
      const sp = Spine.from({ skeleton: `${path}:skel`, atlas: `${path}:atlas`, scale: 1 });
      sp.autoUpdate = false;
      safe(() => sp.state.setAnimation(0, 'default', true), null);
      holder.addChild(sp);
      const bone = sp.skeleton.findBone('rotate_me');
      let time = 0;
      stop = $.onFrame((dt: number) => {
        const h = view.hand;
        if (h.home && performance.now() >= h.home) { h.home = 0; h.tx = 234; h.ty = -54; }
        time += dt;
        const nx = noise(time * 0.1) + 0.4, ny = noise((time + 0.25) * 0.1) - 0.5;
        const k = Math.min(1, dt * 4);
        holder.x += (h.tx + nx * 100 - holder.x) * k;
        holder.y += (h.ty + ny * 100 - holder.y) * k;
        if (bone) bone.rotation = -10 + 20 * ((holder.x - 960 - 50) * 0.01);
        sp.update(dt);
        a.render();
      });
    });
    return () => {
      dead = true;
      stop();
      holder.parent?.removeChild(holder);
      holder.destroy({ children: true });
      void handApp().then((a) => { if (a.canvas.parentElement === host.current) a.canvas.remove(); });
    };
  }, []);
  return <div class="shop-hand-host" ref={host} />;
}

// ------------------------------------------------------------------ the rug dialogue
/**
 * NMerchantDialogue at (x, 271): speech_bubble3 turned 180° at (−43, −25) (hsv s 1.2 v 0.4, shadow 0.25 below), the
 * line in a 280 × 130 box with [fly_in]. α 0 → 1 over 0.25 s, the text revealed over 0.4 s, the bubble 0.25 → 0.75 over
 * 0.5 s Expo Out and the box y −80 → 0 over 0.5 s Back Out; after `hold` seconds it fades over 0.5 s Sine Out. The
 * Crystal Sphere's NCrystalSphereDialogue is the same scene with its own tint, hold and text colour (`cls`).
 */
export function Dialogue({ line: l, y, hsv, hold, cls = '' }: { line: { gen: number; text: string; x: number }; y: number; hsv: number[]; hold: number; cls?: string }) {
  const root = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null), bubble = useRef<HTMLDivElement>(null), text = useRef<HTMLDivElement>(null);
  const { gen, text: line, x } = l;
  useLayoutEffect(() => {
    if (!gen) return;
    const glyphs = Array.from(text.current?.querySelectorAll<HTMLElement>('.rt-c') ?? []);
    const o = { A: 0, Ratio: 0, BubbleS: 0.25, BoxY: -80 };
    const paint = () => {
      if (root.current) root.current.style.opacity = String(o.A);
      if (bubble.current) bubble.current.style.scale = String(o.BubbleS);
      if (box.current) box.current.style.translate = `0 ${o.BoxY}px`;
      const n = Math.floor(o.Ratio * glyphs.length);
      glyphs.forEach((g, i) => { g.style.visibility = i < n ? '' : 'hidden'; });
    };
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'a', 1, 0.25);
    t.TweenProperty(o, 'ratio', 1, 0.4).From(0);
    t.TweenProperty(o, 'bubble_s', 0.75, 0.5).From(0.25).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'box_y', 0, 0.5).From(-80).SetEase(EZ.Out).SetTrans(TR.Back);
    t.Chain();
    t.TweenInterval(hold);
    t.Chain();
    t.TweenProperty(o, 'a', 0, 0.5).SetEase(EZ.Out).SetTrans(TR.Sine);
    paint();
    const stop = $.onFrame(() => { paint(); return t.IsValid(); });
    t.whenFinished(paint);
    return () => { stop(); t.Kill(); };
  }, [gen]);
  if (!gen) return null;
  const bubbleSrc = img('images/packed/vfx/speech_bubble3.png');
  return (
    <div class={'rug-dialogue ' + cls} ref={root} style={{ left: `${x}px`, top: `${y}px`, opacity: 0 }} key={gen}>
      <div class="rd-box" ref={box}>
        <div class="rd-bubble" ref={bubble}>
          <img class="rd-shadow" src={bubbleSrc} />
          <img class="rd-img" src={bubbleSrc} style={{ filter: hsvFilter(hsv[0], hsv[1], hsv[2]) }} />
        </div>
        <div class="rd-text" ref={text}><RichText text={`[fly_in]${line}[/fly_in]`} /></div>
      </div>
    </div>
  );
}
