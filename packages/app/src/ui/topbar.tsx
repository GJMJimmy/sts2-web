// top_bar.tscn (NTopBar): the textured band with the portrait, HP, gold, potion belt, room / floor / boss icons, the
// timer and the Map / Deck / Settings buttons; NRelicInventory under it; NPotionPopup. Fixed positions from the scene.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G, $, N, list } from '../game';
import { ui, invalidate, acquired } from '../store';
import { atlasFrame, frameByName, frameStyle, frameUrl, imageUrl } from '../assets';
import { setTip, setTips, hoverTipsOf, tipBlock, pinTips } from './tooltip';
import { RichText } from './richtext';
import { hsvFilter } from '../filters';
import { loc } from '../i18n';
import { playOneShot } from '../audio';
import { targetManager } from '../cardnodes';
import { topBarMapPressed } from './map';
import { inspectRelic } from './inspect';
import { openPauseMenu, toggleCardsView } from './pause';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const tb = (n: string) => frameByName('ui_atlas', 'top_bar/' + n);
/** atlas frame drawn keep-aspect-centred in a box (original sizes are twice the half-resolution atlas) */
function fit(f: any, x: number, y: number, w: number, h: number, extra: any = {}) {
  const k = f ? Math.min(w / (f.sw * 2), h / (f.sh * 2)) : 1, dw = f ? f.sw * 2 * k : w, dh = f ? f.sh * 2 * k : h;
  return { ...frameStyle(f, dw, dh), position: 'absolute', left: `${x + (w - dw) / 2}px`, top: `${y + (h - dh) / 2}px`, ...extra } as any;
}
function staticTip(key: string, x: number, y: number, rightEdge = false) {
  const ls = (k: string) => safe(() => new G.LocString().$ctor_LocString('static_hover_tips', k).GetFormattedText(), '');
  setTip(ls(`${key}.title`), ls(`${key}.description`), { kind: 'at', x, y, rightEdge });
}
/** Keyframes sampled from Godot's easing (Tween TransitionType / EaseType) for one property. */
function tw(el: HTMLElement | null, prop: (v: number) => Keyframe, from: number, to: number, ms: number, trans: number, easeType: number) {
  if (!el) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 24; i++) frames.push({ ...prop(from + (to - from) * $.ease(trans, easeType, i / 24)), offset: i / 24 });
  return el.animate(frames, { duration: ms, fill: 'forwards', composite: 'replace' });
}
const T = { Linear: 0, Sine: 1, Quad: 4, Expo: 5, Elastic: 6, Cubic: 7, Back: 10 }, E = { In: 0, Out: 1, InOut: 2 };
/**
 * NRelicInventoryHolder / NPotion.PlayNewlyAcquiredAnimation on `el` (whose rest place is `home`): from a start point
 * it moves home over 0.35 s (relics Sine Out, scaling back to 1; potions Quad Out), otherwise it fades in over 0.1 s
 * while rising 40 px (0.35 s Back Out).
 */
/** The acquire motion; `onDone` is its DoFlash (the relic / potion flash at the end). */
function useAcquired(model: any, el: { current: HTMLElement | null }, home: [number, number], trans: number, onDone?: () => void) {
  const a = model ? acquired.get(model) : undefined;
  useLayoutEffect(() => {
    const e = el.current;
    if (!a || !e) return;
    acquired.delete(model);
    let anim: Animation | undefined;
    if (a.from) {
      const [dx, dy] = [a.from[0] - home[0], a.from[1] - home[1]], k = a.scale;
      anim = tw(e, (v) => ({ translate: `${dx * (1 - v)}px ${dy * (1 - v)}px`, scale: String(k + (1 - k) * v) }), 0, 1, 350, trans, E.Out);
    } else {
      e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100 });
      anim = tw(e, (v) => ({ translate: `0 ${v}px` }), 40, 0, 350, T.Back, E.Out);
    }
    anim?.finished.then((x) => { x.cancel(); onDone?.(); }).catch(() => {});
  }, [a?.gen]);
}

// ------------------------------------------------------------------ NTopBarHp, NTopBarGold, NTopBarDeckButton count, NSaveIndicator
/** NTopBarHp.LerpAtNeow (AncientEventModel.BeforeEventStarted): "0/max", then after 0.5 s the HP counts up over 1 s (Cubic InOut). */
let hpLerp: number | null = null;
$.ext('MegaCrit.sts2.Core.Nodes.TopBar.NTopBarHp').prototype.LerpAtNeow = function () {
  return $.async(function* () {
    hpLerp = 0; invalidate();
    yield G.Cmd.Wait$2(0.5);
    const t = new $.WebTween();
    t.TweenMethod((v: number) => { hpLerp = v; invalidate(); }, 0, 1, 1).SetEase(E.InOut).SetTrans(T.Cubic);
    t.whenFinished(() => { hpLerp = null; invalidate(); });
  }, this);
};
/** C# Math.Round (midpoint to even). */
const roundEven = (x: number) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * NTopBarGold.UpdateGoldAnim on GoldChanged: after 0.25 + 0.15 s the label counts the difference in steps of 75 / 10 / 1
 * (over 100 / over 50 / else), 10–110 ms apart, then settles 0.25 s later (its "+N" popup is hidden in top_bar.tscn).
 */
function useGoldLabel(me: any) {
  const [, force] = useState(0);
  const st = useRef<{ me: any; cur: number; add: number; running: boolean; label: number } | null>(null);
  if (st.current?.me !== me) st.current = { me, cur: me.Gold, add: 0, running: false, label: me.Gold };
  useEffect(() => {
    const s = st.current!;
    let alive = true;
    const show = (n: number) => { s.label = n; if (alive) force((x) => x + 1); };
    const changed = async () => {
      s.add = me.Gold - s.cur; s.cur = me.Gold;
      if (s.running) return;
      s.running = true;
      await wait(250);
      await wait(150);
      while (s.add !== 0) {
        const a = Math.abs(s.add), n = a > 100 ? 75 : a > 50 ? 10 : 1;
        s.add = s.add > 0 ? s.add - n : s.add + n;
        show(me.Gold - s.add);
        await wait(Math.trunc(10 + 10 * Math.max(0, 10 - Math.abs(s.add))));
      }
      await wait(250);
      show(me.Gold);
      s.running = false;
    };
    me.GoldChanged = $.dcombine(me.GoldChanged, changed);
    return () => { alive = false; me.GoldChanged = $.dremove(me.GoldChanged, changed); };
  }, [me]);
  return st.current!.label;
}
/** NTopBarDeckButton.OnPileContentsChanged: the count follows CardAddFinished / CardRemoveFinished; a new high bumps it 1.5 → 1 (0.5 s Expo Out). */
function DeckCount({ me }: { me: any }) {
  const el = useRef<HTMLDivElement>(null);
  const st = useRef({ n: me.Deck.Cards.length, max: 0 });
  const [, force] = useState(0);
  useLayoutEffect(() => {
    const pile = me.Deck;
    const changed = () => {
      const n = pile.Cards.length;
      if (n > st.current.max) { tw(el.current, (v) => ({ scale: String(v) }), 1.5, 1, 500, T.Expo, E.Out); st.current.max = n; }
      st.current.n = n;
      force((x) => x + 1);
    };
    changed(); // Initialize
    pile.CardAddFinished = $.dcombine(pile.CardAddFinished, changed);
    pile.CardRemoveFinished = $.dcombine(pile.CardRemoveFinished, changed);
    return () => { pile.CardAddFinished = $.dremove(pile.CardAddFinished, changed); pile.CardRemoveFinished = $.dremove(pile.CardRemoveFinished, changed); };
  }, [me]);
  return <div class="tb-deck-count" ref={el}>{st.current.n}</div>;
}
/**
 * NSaveIndicator (RightAlignedStuff, left of the timer): on each run save (SaveManager.Saved, i.e. RunSaveManager.Saved)
 * "Game Saved" waits 0.5 s, fades in over 1 s, holds 0.5 s and fades out over 1 s, from wherever it was.
 */
function SaveIndicator({ x }: { x: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sm = safe(() => G.SaveManager.Instance, null);
    if (!sm) return;
    const saved = () => {
      const e = el.current;
      if (!e) return;
      const a = Number(getComputedStyle(e).opacity);
      for (const x of e.getAnimations()) x.cancel();
      e.animate([{ opacity: a }, { opacity: a, offset: 0.5 / 3 }, { opacity: 1, offset: 1.5 / 3 }, { opacity: 1, offset: 2 / 3 }, { opacity: 0 }], { duration: 3000, fill: 'forwards' });
    };
    sm.$add_Saved(saved);
    return () => sm.$remove_Saved(saved);
  }, []);
  return <div class="tb-save" ref={el} style={{ left: `${x}px` }}><RichText text={loc('gameplay_ui', 'GAME_SAVED')} /></div>;
}

// ------------------------------------------------------------------ NTopBarButton (Map, Deck, Settings)
function TopButton({ kind, x, y, w, h, frame, open, onClick, tip, count, disabled }: any) {
  const img = useRef<HTMLDivElement>(null);
  const st = useRef({ rot: 0, v: kind === 'settings' ? 0.9 : 1, s: 1 });
  const base = kind === 'settings' ? 0.9 : 1, hoverRot = kind === 'settings' ? -180 : -12, pressRot = kind === 'settings' ? 45 : 24;
  const apply = () => { const e = img.current; if (e) { e.style.rotate = `${st.current.rot}deg`; e.style.scale = String(st.current.s); e.style.filter = `brightness(${st.current.v})`; } };
  const anim = useRef<number>(0);
  // run a small tween on st.current (rot / v / s) — the three share one button, like the original's tweens
  const go = (to: Partial<typeof st.current>, ms: number, trans: Record<string, [number, number]>) => {
    const from = { ...st.current }, t0 = performance.now(), id = ++anim.current;
    const step = () => {
      if (id !== anim.current) return;
      const p = Math.min(1, (performance.now() - t0) / ms);
      for (const k of Object.keys(to) as (keyof typeof st.current)[]) { const [tr, ez] = trans[k] ?? [0, 2]; st.current[k] = from[k] + ((to[k] as number) - from[k]) * $.ease(tr, ez, p); }
      apply();
      if (p < 1) requestAnimationFrame(step);
    };
    step();
  };
  // while its screen is open: the deck rocks, settings spins, the map swings
  useEffect(() => {
    if (!open) return;
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      const t = (performance.now() - t0) / 1000, e = img.current;
      if (e) e.style.rotate = kind === 'deck' ? `${0.12 * Math.sin(4 * t) * 57.3}deg` : kind === 'settings' ? `${(t * 57.3) % 360}deg` : `${0.12 * 57.3 * Math.sin((t / 0.8) * Math.PI / 2 * 2 - Math.PI / 2)}deg`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); st.current.rot = 0; apply(); };
  }, [open]);
  return (
    // NTopBarButton.OnDisable: modulate (0.5, 0.5, 0.5, 0.75), no input
    <div class={"tb-button tb-" + kind + (disabled ? ' disabled' : '')} style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
      onPointerEnter={() => { playOneShot('event:/sfx/ui/clicks/ui_hover'); st.current.s = 1.1; st.current.v = 1.1; apply(); if (!open) go({ rot: hoverRot }, 500, { rot: [T.Back, E.Out] }); tip(); }}
      onPointerLeave={() => { if (!open) go({ rot: 0, v: base, s: 1 }, 1000, { rot: [T.Elastic, E.Out], v: [T.Expo, E.Out], s: [T.Expo, E.Out] }); else { st.current.v = base; st.current.s = 1; apply(); } setTip(null); }}
      onPointerDown={(e) => { if (e.button !== 0) return; playOneShot('event:/sfx/ui/clicks/ui_click'); go({ rot: st.current.rot + pressRot, v: 0.4 }, 250, { rot: [T.Cubic, E.Out], v: [T.Cubic, E.Out] }); }}
      onPointerUp={(e) => { if (e.button !== 0) return; st.current.v = 1.1; go({ rot: hoverRot }, 500, { rot: [T.Back, E.Out] }); onClick(); }}>
      <div ref={img} class="tb-button-img" style={{ ...fit(frame, 0, 0, w, h), filter: `brightness(${base})` }} />
      {count}
    </div>
  );
}

// ------------------------------------------------------------------ potions (NPotionContainer / NPotionHolder / NPotionPopup)
export function potionActions(p: any) {
  const me = p.Owner, c = me?.Creature, cm = G.CombatManager.Instance;
  const blocked = !p || p.IsQueued || !c || c.IsDead || !me.CanRemovePotions;
  const U = G.PotionUsage;
  let use = !blocked && p.PassesCustomUsabilityCheck !== false;
  if (use && p.Usage === U.CombatOnly) use = cm.IsInProgress && safe(() => c.CombatState.CurrentSide === c.Side, false) && !cm.PlayerActionsDisabled;
  else if (use && p.Usage !== U.AnyTime) use = false;
  if (use && safe(() => N('Rooms.NCombatRoom').Instance?.Ui?.Hand?.IsInCardSelection, false)) use = false;
  const Tt = G.TargetType;
  const throws = p.TargetType === Tt.AnyEnemy || p.TargetType === Tt.TargetedNoCreature || safe(() => p.CanThrowAtAlly(), false);
  return { use, discard: !blocked, throws };
}
/** NPotionHolder.DisableUntilPotionRemoved (grey 0.1 s after a use is queued) and how a potion left its slot. */
const greyed = new Set<any>();
/** NPotion.DoBounce: the potion hops 12 px (0.125 s Sine Out up, 0.125 s Sine In down). */
const bounce = (el: Element | null | undefined) => (el as HTMLElement | null)?.animate(
  [{ translate: '0 0' }, { translate: '0 -12px', easing: 'cubic-bezier(.61, 1, .88, 1)' }, { translate: '0 0', easing: 'cubic-bezier(.12, 0, .39, 0)' }], { duration: 250 });
const slosh = (volume: number) => safe(() => $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play(`potion_slosh_${1 + Math.floor(Math.random() * 3)}.mp3`, volume, G.PitchVariance.Large), null);
const leaving = new Map<any, 'use' | 'discard'>();
function greyAfterUse(p: any) { setTimeout(() => { if (p.IsQueued !== false) { greyed.add(p); invalidate(); } }, 100); }
function PotionSlot({ p, i, me }: any) {
  const x = 503 + 62 * i, y = 9;
  const holder = useRef<HTMLDivElement>(null);
  // NPotion.DoFlash → NPotionFlashVfx: the potion image, additive (strength 2), 54 → 96 px over 1 s
  const [flashT, setFlashT] = useState(0);
  useAcquired(p, holder, [x, y], T.Quad, () => setFlashT(performance.now()));
  // RemoveUsedPotion: the potion scales to 0 (0.2 s Back In); DiscardPotion: it rises 100 px (0.4 s Back In); either
  // way the empty placeholder fades in after 0.2 s
  const prev = useRef<any>(null);
  const [ghost, setGhost] = useState<{ p: any; kind: 'use' | 'discard' } | null>(null);
  useLayoutEffect(() => {
    const q = prev.current;
    if (q && q !== p) {
      const kind = leaving.get(q) ?? 'use';
      leaving.delete(q); greyed.delete(q);
      setGhost({ p: q, kind });
      setTimeout(() => setGhost((g) => (g?.p === q ? null : g)), 450);
    }
    prev.current = p;
  }, [p]);
  const img = (q: any) => (
    <>
      <div class="tb-potion-outline" style={frameStyle(atlasFrame(safe(() => q.ImagePath, '').replace('potion_atlas', 'potion_outline_atlas')) ?? frameByName('potion_outline_atlas', String(q.Id.Entry).toLowerCase()), 54, 54)} />
      <div class="tb-potion-img" style={frameStyle(atlasFrame(safe(() => q.ImagePath, '')), 54, 54)} />
    </>
  );
  const open = !!p && ui.potionMenu === p;
  const hover = () => {
    if (open) return;
    bounce(holder.current);
    if (p) slosh(0.5);
    // CreateAndShow(…, Center): the text 1.5 slot heights down, card previews under it
    if (p) setTips(hoverTipsOf(p), { kind: 'align', rect: [x, y, 60, 60], align: 'center' });
    else staticTip('POTION_SLOT', x, y + 90);
  };
  return (
    <div class={'tb-potion' + (p ? '' : ' empty') + (open ? ' open' : '')} style={{ left: `${x}px`, top: `${y}px` }}
      onPointerEnter={hover} onPointerLeave={() => setTip(null)}
      onClick={() => { if (!p) return; setTip(null); ui.potionMenu = open ? null : p; tipBlock.on = !open; invalidate(); }}>
      <div class="tb-potion-holder" ref={holder} style={p && greyed.has(p) ? { filter: 'brightness(.5)' } : undefined}>
        {p && flashT > 0 && <div class="tb-potion-flash" key={flashT} style={frameStyle(atlasFrame(safe(() => p.ImagePath, '')), 54, 54)} onAnimationEnd={() => setFlashT(0)} />}
        {p ? img(p) : (
          <>
            <img class={'tb-potion-empty' + (ghost ? ' after-use' : '')} src={imageUrl('images/packed/potions/potion_placeholder.png') ?? ''} />
            {ghost && <div class={'tb-potion-ghost ' + ghost.kind}>{img(ghost.p)}</div>}
          </>
        )}
      </div>
    </div>
  );
}
/** NPotionPopup: 259 × 239 under the slot; Use / Throw and Discard; closes on any click. */
function PotionPopup({ p, i, me }: any) {
  const a = potionActions(p), x = 503 + 62 * i - 99.5, y = 9 + 90;
  const close = () => { ui.potionMenu = null; tipBlock.on = false; invalidate(); };
  // _Ready: the potion's tips beside HoverTipBounds (−5, 38, 268 × 202), made before tips are blocked; Remove drops both
  useEffect(() => {
    pinTips(hoverTipsOf(p), { kind: 'align', rect: [x - 5, y + 38, 268, 202], align: 'right' });
    tipBlock.on = true;
    return () => { pinTips(null); tipBlock.on = false; };
  }, [p]);
  useEffect(() => {
    const h = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.potion-popup-btn')) setTimeout(close, 0); };
    window.addEventListener('pointerup', h, true);
    return () => window.removeEventListener('pointerup', h, true);
  }, [p]);
  const use = () => {
    close();
    const room = ui.room, Tt = G.TargetType;
    // TargetedNoCreature (the Foul Potion outside combat) aims at a node: a merchant room's NMerchantButton
    const noCreature = p.TargetType === Tt.TargetedNoCreature;
    if ((p.TargetType === Tt.AnyEnemy && room?.kind === 'combat') || noCreature) {
      // NPotionHolder.TargetNode: the arrow starts under the potion slot, a click picks the target
      safe(() => G.RunManager.Instance.HoveredModelTracker.OnLocalPotionSelected(p), null);
      // ShouldCancelTargeting: outside combat only the potion leaving its slot ends it
      const cancel = noCreature ? () => !p.Owner : () => !G.CombatManager.Instance.IsInProgress || !p.Owner;
      targetManager.StartTargeting(p.TargetType, new $.Vector2(503 + 62 * i + 30, 9 + 50), 2, cancel).then((node: any) => {
        safe(() => G.RunManager.Instance.HoveredModelTracker.OnLocalPotionDeselected(), null);
        // an NCreature's creature; the merchant button is none (null)
        if (node) { safe(() => p.EnqueueManualUse(node.Entity ?? null), null); greyAfterUse(p); }
        invalidate();
      });
      return;
    }
    safe(() => p.EnqueueManualUse(p.TargetType === G.TargetType.TargetedNoCreature ? null : me.Creature), null);
    greyAfterUse(p);
    invalidate();
  };
  const discard = () => {
    close();
    leaving.set(p, 'discard');
    G.RunManager.Instance.ActionQueueSynchronizer.RequestEnqueue(new G.DiscardPotionGameAction().$ctor_DiscardPotionGameAction(me, i >>> 0));
    invalidate();
  };
  const [hov, setHov] = useState(-1);
  return (
    <div class="potion-popup" style={{ left: `${x}px`, top: `${y}px` }}>
      <img class="potion-popup-bg" src={imageUrl('images/potions/potion_pop_up/potion_popup.png') ?? ''} />
      {[{ key: a.throws ? 'POTION_POPUP.throw' : 'POTION_POPUP.drink', ok: a.use, fn: use, top: true }, { key: 'POTION_POPUP.discard', ok: a.discard, fn: discard, top: false }].map((b, k) => (
        <div class={'potion-popup-btn' + (b.ok ? '' : ' disabled')} style={{ left: `${k ? 12 : 11}px`, top: `${k ? 143 : 50}px` }}
          onPointerEnter={() => { if (b.ok) { setHov(k); playOneShot('event:/sfx/ui/clicks/ui_hover'); } }} onPointerLeave={() => setHov(-1)}
          onPointerUp={(e) => { if (e.button === 0 && b.ok) { playOneShot('event:/sfx/ui/clicks/ui_click'); b.fn(); } }}>
          <span style={{ color: k ? '#FF5555' : '#FFF6E2' }}>{loc('gameplay_ui', b.key)}</span>
          <img class="potion-popup-hl" src={imageUrl(`images/potions/potion_pop_up/potion_popup_${b.top ? 'top' : 'bottom'}.png`) ?? ''}
            style={b.top ? { left: '-2px', top: '-39px', width: '241px', height: '129px', opacity: hov === k ? 0.25 : 0 } : { left: '-3px', top: '-3px', width: '241px', height: '93px', opacity: hov === k ? 0.25 : 0 }} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ NRelicInventory
/** NRelicInventory.AnimHide: y − 68·lines − 90 over 0.25 s Cubic Out while the capstone stack is open. */
function RelicBar({ me }: { me: any }) {
  const lines = Math.max(1, Math.ceil(list(me.Relics).length / 26));
  return <div class="relic-inventory" style={{ translate: `0 ${ui.pauseOpen ? -68 * lines - 90 : 0}px`, transition: 'translate .25s cubic-bezier(0.33, 1, 0.68, 1)' }}>{list(me.Relics).map((r: any, i: number) => <RelicHolder r={r} i={i} key={r} />)}</div>;
}
function RelicHolder({ r, i }: { r: any; i: number }) {
  const x = 12 + 68 * (i % 26), y = 82 + 68 * Math.floor(i / 26);
  const icon = useRef<HTMLDivElement>(null);
  const status = safe(() => r.Status, 0);
  const id = String(safe(() => r.Id.Entry, '')).toLowerCase();
  // NRelicInventoryHolder.OnRelicFlashed / DoFlash (at the end of the acquire) → relic_inventory_flash_vfx
  const [flashes, setFlashes] = useState<number[]>([]);
  const flash = () => {
    const t = performance.now();
    setFlashes((f) => [...f, t]);
    setTimeout(() => setFlashes((f) => f.filter((x) => x !== t)), 1100);
  };
  useAcquired(r, icon, [x + 4, y + 4], T.Sine, flash);
  useEffect(() => {
    const h = flash;
    r.Flashed = $.dcombine(r.Flashed, h);
    return () => { r.Flashed = $.dremove(r.Flashed, h); };
  }, [r]);
  const iconFrame = atlasFrame(safe(() => r.IconPath, '')) ?? frameByName('relic_atlas', id);
  return (
    <div class={'relic-holder' + (status === 1 ? ' active' : status === 2 ? ' disabled' : '')} style={{ left: `${x}px`, top: `${y}px` }}
      // an NButton whose OnFocus skips the hover sound; NButton.OnPress plays ui_click
      onPointerEnter={() => setTips(hoverTipsOf(r), { kind: 'relic', rect: [x + 4, y + 4, 60, 60] })}
      onPointerLeave={() => setTip(null)}
      onPointerDown={(e) => { if (e.button === 0) playOneShot('event:/sfx/ui/clicks/ui_click'); }}
      onPointerUp={(e) => { if (e.button === 0) { setTip(null); inspectRelic(list(r.Owner?.Relics ?? []), r); } }}>
      <div class="relic-icon" ref={icon}>
        <div class="relic-outline" style={frameStyle(frameByName('relic_outline_atlas', id), 60, 60)} />
        <div class="relic-img" style={frameStyle(iconFrame, 60, 60)} />
        {status === 1 && <div class="relic-pulse" style={{ ...frameStyle(iconFrame, 60, 60), animationDelay: `${-(performance.now() / 1000) % (Math.PI / 3)}s` }} />}
      </div>
      {safe(() => r.ShowCounter, false) && <div class="relic-amount">{safe(() => r.DisplayAmount, '')}</div>}
      {flashes.map((t) => (
        <div class="relic-flash" key={t}>
          {[0, 1, 2].map((k) => <div style={{ ...frameStyle(iconFrame, 126, 126), animationDelay: `${k * 0.15}s` }} />)}
        </div>
      ))}
    </div>
  );
}

/**
 * NPotionContainer: PlayAddFailedAnim (AddPotionFailed) shakes the holders 3·sin(5t)·sin(t/2) px for t 0 → 2π over 0.5 s
 * while the error backdrop flashes (0.15 s in, out over 0.5 s after 0.35 s); OnCombatSetUp → ShinePotions: after 1 s each
 * filled holder in turn bounces, then 0.25 s later sloshes (0.3, large pitch variance).
 */
function usePotionBelt(me: any) {
  const holders = useRef<HTMLDivElement>(null), err = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let full: any = null;
    const e = { A: 0 };
    const failed = () => {
      if (full?.IsRunning()) { full.Kill(); if (holders.current) holders.current.style.translate = ''; }
      const t = (full = new $.WebTween().SetParallel());
      t.TweenMethod((v: number) => { if (holders.current) holders.current.style.translate = `${3 * Math.sin(v * 5) * Math.sin(v * 0.5)}px 0`; }, 0, Math.PI * 2, 0.5);
      t.TweenProperty(e, 'a', 1, 0.15);
      t.TweenProperty(e, 'a', 0, 0.5).SetDelay(0.35);
      $.onFrame(() => { if (err.current) err.current.style.opacity = String(e.A * 0.553); return t.IsValid(); });
    };
    const shine = async () => {
      await G.Cmd.Wait$2(1);
      for (let i = 0; i < list(me.PotionSlots ?? []).length; i++) {
        if (!list(me.PotionSlots)[i]) continue;
        bounce(holders.current?.children[i]?.querySelector('.tb-potion-holder'));
        await G.Cmd.Wait$2(0.25);
        slosh(0.3);
      }
    };
    const cm = G.CombatManager.Instance;
    me.AddPotionFailed = $.dcombine(me.AddPotionFailed, failed);
    cm.CombatSetUp = $.dcombine(cm.CombatSetUp, shine);
    return () => { full?.Kill(); me.AddPotionFailed = $.dremove(me.AddPotionFailed, failed); cm.CombatSetUp = $.dremove(cm.CombatSetUp, shine); };
  }, [me]);
  return { holders, err };
}

// ------------------------------------------------------------------ the bar
export function TopBar({ rs }: { rs: any }) {
  useEffect(() => { const h = setInterval(() => { if (timerShown()) invalidate(); }, 1000); return () => clearInterval(h); }, []);
  const me = rs.Players[0];
  const c = me.Creature;
  const gold = useGoldLabel(me);
  const belt = usePotionBelt(me);
  const charId = String(safe(() => me.Character.Id.Entry, 'ironclad')).toLowerCase();
  const asc = safe(() => rs.AscensionLevel, 0);
  const slots = list(me.PotionSlots ?? []);
  const potW = Math.max(140, 18 + slots.length * 60 + Math.max(0, slots.length - 1) * 2 + 19);
  const roomX = 485 + potW + 29, floorX = roomX + 44;
  const floorLabelW = String(rs.TotalFloor).length * 19 + 4;
  // NTopBarRoomIcon / NTopBarBossIcon
  const room = safe(() => rs.BaseRoom ?? rs.CurrentRoom, null);
  const mpt = safe(() => rs.CurrentMapPoint?.PointType ?? G.MapPointType.Unassigned, 0);
  const roomModel = mpt === G.MapPointType.Boss ? safe(() => (rs.CurrentMapPoint === rs.Map.SecondBossMapPoint ? rs.Act.SecondBossEncounter.Id : rs.Act.BossEncounter.Id), null)
    : mpt === G.MapPointType.Ancient ? safe(() => rs.Act.Ancient.Id, null) : null;
  const roomIcon = room ? safe(() => G.ImageHelper.GetRoomIconPath(mpt, room.RoomType, roomModel), null) : null;
  const roomOutline = room ? safe(() => G.ImageHelper.GetRoomIconOutlinePath(mpt, room.RoomType, roomModel), null) : null;
  const showRoom = !!roomIcon && !safe(() => room.RoomType === G.RoomType.Map || room.IsVictoryRoom, false);
  const inBoss = safe(() => room.RoomType === G.RoomType.Boss, false);
  const bossId = safe(() => rs.Act.BossEncounter.Id, null);
  const bossIcon = bossId ? safe(() => G.ImageHelper.GetRoomIconPath(G.MapPointType.Boss, G.RoomType.Boss, bossId), null) : null;
  const bossOutline = bossId ? safe(() => G.ImageHelper.GetRoomIconOutlinePath(G.MapPointType.Boss, G.RoomType.Boss, bossId), null) : null;
  const bossX = floorX + 59 + floorLabelW + 6;
  const roomKey = safe(() => roomTipKey(mpt, room), 'ROOM_MAP');
  return (
    <>
      {/* NTopBar.AnimHide / AnimShow: y −100 / 0 over 0.25 s Cubic Out while the capstone stack is open */}
      <div class="top-bar" style={{ translate: `0 ${ui.pauseOpen ? -100 : 0}px`, transition: 'translate .25s cubic-bezier(0.33, 1, 0.68, 1)' }}>
        <div class="tb-bg" style={frameStyle(tb('top_bar'), 2585.6, 101)} />
        {/* portrait */}
        <div style={{ ...frameStyle(tb('top_bar_char_backdrop'), 72, 71), position: 'absolute', left: '16px', top: '4px' }} />
        <img class="tb-char" src={imageUrl(`images/ui/top_panel/character_icon_${charId}.png`) ?? ''} />
        {asc > 0 && (
          <div class="tb-asc" onPointerEnter={() => setTip(loc('ascension', 'PORTRAIT_TITLE'), loc('ascension', 'PORTRAIT_DESCRIPTION'), { kind: 'at', x: 16, y: 95 })} onPointerLeave={() => setTip(null)}>
            <div style={fit(tb('top_bar_ascension'), 59, 32, 42, 45)} />
            <div class="tb-asc-label">{asc}</div>
          </div>
        )}
        {/* HP, gold */}
        <div class="tb-hit" style={{ left: '120px', width: '179px' }} onPointerEnter={() => staticTip('HIT_POINTS', 120, 103)} onPointerLeave={() => setTip(null)}>
          <div style={fit(tb('top_bar_heart'), 0, 0, 53, 83)} />
          <div class="tb-label hp" style={{ left: '59px' }}>{hpLerp === null ? c.CurrentHp : roundEven(c.CurrentHp * hpLerp)}/{c.MaxHp}</div>
        </div>
        <div class="tb-hit" style={{ left: '323px', width: '138px' }} onPointerEnter={() => staticTip('MONEY_POUCH', 323, 103)} onPointerLeave={() => setTip(null)}>
          <div style={fit(tb('top_bar_gold'), 0, 0, 54, 83)} />
          <div class="tb-label gold" style={{ left: '58px' }}>{gold}</div>
        </div>
        {/* potion belt */}
        <div class="tb-potion-bg" style={{ left: '485px', width: `${potW}px`, borderImageSource: `url(${frameUrl(tb('top_bar_char_backdrop'), invalidate) ?? ''})` }} />
        {/* PotionErrorBg: the backdrop again through hsv (0.463, 3.918, 2), self-modulate alpha 0.553 */}
        <div class="tb-potion-bg" ref={belt.err} style={{ left: '485px', width: `${potW}px`, borderImageSource: `url(${frameUrl(tb('top_bar_char_backdrop'), invalidate) ?? ''})`, filter: hsvFilter(0.463, 3.918, 2), opacity: 0 }} />
        <div class="tb-potions" ref={belt.holders}>{slots.map((p: any, i: number) => <PotionSlot p={p} i={i} me={me} />)}</div>
        {/* room, floor, boss */}
        {showRoom && (
          <div class="tb-hit" style={{ left: `${roomX}px`, top: '17.5px', width: '44px', height: '44px' }} onPointerEnter={() => staticTip(roomKey, roomX, 103)} onPointerLeave={() => setTip(null)}>
            {roomOutline && <img class="tb-room outline" src={imageUrl(roomOutline) ?? ''} />}
            <img class="tb-room" src={imageUrl(roomIcon) ?? ''} />
          </div>
        )}
        <div class="tb-hit" style={{ left: `${floorX}px`, width: `${59 + floorLabelW}px` }} onPointerEnter={() => staticTip('FLOOR', floorX, 103)} onPointerLeave={() => setTip(null)}>
          <div style={fit(tb('top_bar_floor'), 0, 10, 60, 60)} />
          <div class="tb-label floor" style={{ left: '59px' }}>{rs.TotalFloor}</div>
        </div>
        {bossIcon && !inBoss && (
          <div class="tb-hit" style={{ left: `${bossX}px`, top: '17.5px', width: '44px', height: '44px' }}
            onPointerEnter={() => { const l = new G.LocString().$ctor_LocString('static_hover_tips', 'BOSS.description'); safe(() => l.Add$String_String('BossName', rs.Act.BossEncounter.Title.GetFormattedText()), null); setTip(loc('static_hover_tips', 'BOSS.title'), safe(() => l.GetFormattedText(), ''), { kind: 'at', x: bossX, y: 103 }); }}
            onPointerLeave={() => setTip(null)}>
            {bossOutline && <img class="tb-room outline" src={imageUrl(bossOutline) ?? ''} />}
            <img class="tb-room" src={imageUrl(bossIcon) ?? ''} />
          </div>
        )}
        {/* NTopBarModifier (custom / daily runs): 56 × 80 each after the room icons, a 48 px icon at (4, 13) */}
        {list(safe(() => rs.Modifiers, [])).map((m: any, i: number) => {
          const mx = (bossIcon && !inBoss ? bossX + 48 : bossX - 6) + 24 + 56 * i;
          return (
            <div class="tb-hit" style={{ left: `${mx}px`, width: '56px', height: '80px' }}
              onPointerEnter={() => setTip(safe(() => m.Title.GetFormattedText(), ''), safe(() => m.Description.GetFormattedText(), ''), { kind: 'at', x: mx, y: 100 })} onPointerLeave={() => setTip(null)}>
              <img class="tb-modifier" src={imageUrl(safe(() => m.IconPath, '')) ?? imageUrl('images/powers/missing_power.png') ?? ''} />
            </div>
          );
        })}
        <SaveIndicator x={timerShown() ? 1264 : 1428} />
        {/* NRunTimer: with ShowRunTimer, or while the map / a capstone screen is up */}
        {timerShown() && (
          <>
            <div style={{ ...frameStyle(tb('timer_icon'), 40, 40), position: 'absolute', left: '1500px', top: '20px' }} />
            <div class="tb-label timer" style={{ left: '1544px' }}>{safe(() => G.TimeFormatting.Format(G.RunManager.Instance.RunTime), '')}</div>
          </>
        )}
        <TopButton kind="map" x={1664} y={8} w={80} h={64} frame={tb('top_bar_map')} open={ui.mapOpen} disabled={ui.room?.kind === 'maproom'}
          tip={() => staticTip('MAP', 1744, 100, true)} onClick={topBarMapPressed} />
        <TopButton kind="deck" x={1744} y={0} w={80} h={80} frame={tb('top_bar_deck')} open={ui.cardsView?.kind === 'deck'}
          tip={() => staticTip('DECK', 1824, 100, true)} onClick={() => toggleCardsView('deck')}
          count={<DeckCount me={me} />} />
        <TopButton kind="settings" x={1832} y={8} w={64} h={64} frame={tb('top_bar_settings')} open={ui.pauseOpen}
          tip={() => staticTip('SETTINGS', 1896, 100, true)} onClick={openPauseMenu} />
      </div>
      <RelicBar me={me} />
      {ui.potionMenu && slots.includes(ui.potionMenu) && <PotionPopup p={ui.potionMenu} i={slots.indexOf(ui.potionMenu)} me={me} />}
    </>
  );
}
const timerShown = () => safe(() => G.SaveManager.Instance.PrefsSave.ShowRunTimer, false) || ui.mapOpen || ui.pauseOpen || !!ui.cardsView;
/** static_hover_tips ROOM_* by the current room. */
function roomTipKey(mpt: number, room: any) {
  const M = G.MapPointType, R = G.RoomType;
  if (mpt === M.Unknown) return room.RoomType === R.Monster ? 'ROOM_UNKNOWN_ENEMY' : room.RoomType === R.Treasure ? 'ROOM_UNKNOWN_TREASURE' : room.RoomType === R.Shop ? 'ROOM_UNKNOWN_MERCHANT' : 'ROOM_UNKNOWN_EVENT';
  return ({ [R.Monster]: 'ROOM_ENEMY', [R.Elite]: 'ROOM_ELITE', [R.Shop]: 'ROOM_MERCHANT', [R.Treasure]: 'ROOM_TREASURE', [R.RestSite]: 'ROOM_REST', [R.Boss]: 'ROOM_BOSS' } as Record<number, string>)[room.RoomType]
    ?? (mpt === M.Ancient ? 'ROOM_ANCIENT' : 'ROOM_MAP');
}
