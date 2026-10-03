// First-time tips (Nodes/Ftue/*) in the modal container: the ftue_popup (hsv s .5 v 1.2) at each tip's own rect with its
// header, text and the pulsing "Got it!" button, a pointer arrow, and the element the tip is about raised above the
// backstop (a hole in it: still lit and clickable). Each is marked seen in the progress save when it is shown, as the
// originals do; SeenFtue is true for everything once tutorials are turned off.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G, $, N } from '../game';
import { invalidate } from '../store';
import { loc, locv } from '../i18n';
import { imageUrl } from '../assets';
import { playOneShot } from '../audio';
import { hsvFilter, tint } from '../filters';
import { RichText, glyphs } from './richtext';
import { openModal, closeModal, confirmPopup } from './modal';
import { logicalRect } from './tooltip';
import { NGoldArrowButton } from './buttons';
import { anchored } from '../view';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
export const seenFtue = (id: string) => safe(() => G.SaveManager.Instance.SeenFtue(id), true);
const f = (k: string) => loc('ftues', k);
const OUT_A = 'rgb(84, 63, 0)', OUT_B = 'rgb(56, 49, 26)';

/** `to` / `popupTo`: the screen edges it is anchored to, when what it points at is (view.ts anchored); unset: the centre. */
interface Arrow { x: number; y: number; rot?: number; flipH?: boolean; flipV?: boolean; scale?: number; origin?: string; to?: string }
interface Def {
  popup: number[]; popupTo?: string; outline: string; margin?: number; size?: number;
  header?: number[]; desc?: number[]; button?: number[]; arrow?: Arrow; targets?: string[]; sneaky?: number[] | string;
}
/** The scenes' layouts (ftue/*.tscn): popup rect, header / description boxes inside it, arrow, raised elements. */
const DEFS: Record<string, Def> = {
  rest_site_ftue: { popup: [672, 643, 579, 257], outline: OUT_B, targets: ['.rest-btn'] },
  merchant_ftue: { popup: [257, 412, 579, 257], outline: OUT_A, button: [157, 188, 275, 75], arrow: { x: 928, y: 228, flipH: true }, targets: ['.merchant-btn'], sneaky: [1132, 428, 262, 320] },
  combat_reward_ftue: { popup: [1238, 611, 579, 257], outline: OUT_A, margin: 32, arrow: { x: 1280, y: 383, rot: 1.0472 }, targets: ['.rw-window'] },
  obtain_relic_ftue: { popup: [1207.5, 671, 639.8, 284], outline: OUT_B, arrow: { x: 926, y: 620, flipV: true }, targets: ['.reward-btn.relic', '.relic-holder-t'] },
  obtain_potion_ftue: { popup: [671, 412, 579, 257], outline: OUT_B, size: 20, arrow: { x: 540, y: 118, flipV: true, to: 'lt' }, targets: ['.tb-potion'] },
  power_card_ftue: { popup: [1243, 762, 579, 257], outline: OUT_A, margin: 19, arrow: { x: 1256, y: 558, rot: 1.25316, scale: 0.8, origin: '0 0' }, targets: ['.card-reward-screen .grid-holder.power'] },
  shuffle_ftue: { popup: [670.5, 607, 579, 257], popupTo: 'b', outline: OUT_B, margin: 32, targets: ['.pile-btn.draw', '.pile-btn.discard'] },
  cannot_play_card_ftue: { popup: [671, 412, 579, 257], outline: OUT_B, margin: 6, targets: ['.end-turn-btn'], sneaky: '.end-turn-btn' },
  can_play_cards_ftue: { popup: [580.1, 412, 768.3, 341], outline: OUT_A, margin: 6, header: [99, 37, 115, 93], desc: [61.9, 97, 53.4, 41], arrow: { x: 188, y: 599, to: 'lb' }, targets: ['.energy-counter'] },
  map_select_ftue: { popup: [125, -506, 579, 257], outline: OUT_A, desc: [40, 75, 38, 61], arrow: { x: -213, y: 214, rot: -0.548695 }, targets: ['.map-screen .mp.travelable'] },
};

interface Tip { id: string; key: string; def: Def; done: () => void; sneaky?: () => void; anchor?: number[] }
const queue: Tip[] = [];
function next() {
  const t = queue[0];
  if (!t) return;
  const holes = () => (t.def.targets ?? []).flatMap((sel) => Array.from(document.querySelectorAll(sel)).map((el) => logicalRect(el)).filter(Boolean) as number[][]).slice(0, 8);
  openModal(() => <FtuePopup t={t} />, holes);
}
/**
 * Show a single-page tip from the `ftues` table (`<key>_TITLE` / `<key>_DESCRIPTION`); resolves once dismissed.
 * `sneaky` is what the tip's hidden hitbox does (the merchant opens the rug, the end-turn button ends the turn).
 */
export function showFtue(id: string, key: string, sneaky?: () => void): Promise<void> {
  if (queue.some((t) => t.id === id)) return Promise.resolve();
  safe(() => G.SaveManager.Instance.MarkFtueAsComplete(id), undefined);
  const def = DEFS[id] ?? { popup: [671, 412, 579, 257], outline: OUT_B };
  return new Promise((done) => {
    // map_select: NMapSelectFtue sits at the first node's centre; the relic tip's arrow points at the reward's bottom
    let anchor: number[] | undefined;
    if (id === 'map_select_ftue') { const r = logicalRect(document.querySelector('.map-screen .mp.travelable')); if (r) anchor = [r[0] + r[2] / 2, r[1] + r[3] / 2]; }
    if (id === 'obtain_relic_ftue') { const r = logicalRect(document.querySelector('.reward-btn.relic, .relic-holder-t')); if (r) anchor = [r[0] + r[2] / 2, r[1] + r[3]]; }
    queue.push({ id, key, def, done, sneaky, anchor });
    if (queue.length === 1) next();
  });
}
function closeTip() {
  const t = queue.shift();
  closeModal();
  t?.done();
  invalidate();
  if (queue.length) setTimeout(next, 0);
}
export const ftueActive = () => queue.length > 0;

/** An FTUE popup: ftue_popup with the header (Kreon Bold 26, gold) and description (Kreon 22, cream), and "Got it!". */
function FtuePopup({ t }: { t: Tip }) {
  const d = t.def;
  const [px, py, pw, ph] = t.id === 'map_select_ftue' && t.anchor ? [t.anchor[0] + d.popup[0], t.anchor[1] + d.popup[1], d.popup[2], d.popup[3]]
    : [...anchored(d.popup[0], d.popup[1], d.popupTo ?? ''), d.popup[2], d.popup[3]];
  const hd = d.header ?? [82, 20, 36, 76], ds = d.desc ?? [37, 73, 35, 65];
  const arrow = d.arrow && (t.id === 'obtain_relic_ftue' && t.anchor ? { ...d.arrow, x: t.anchor[0], y: t.anchor[1] } : t.id === 'map_select_ftue' ? { ...d.arrow, x: px + d.arrow.x, y: py + d.arrow.y }
    : (([x, y]) => ({ ...d.arrow!, x, y }))(anchored(d.arrow.x, d.arrow.y, d.arrow.to ?? '')));
  const sneaky = typeof d.sneaky === 'string' ? logicalRect(document.querySelector(d.sneaky)) : d.sneaky;
  return (
    <div class="ftue">
      {arrow && (
        <img class="ftue-arrow" src={imageUrl('images/ftue/ftue_pointer_arrow.png') ?? ''}
          style={{ left: `${arrow.x}px`, top: `${arrow.y}px`, transformOrigin: arrow.origin ?? '122px 102px', rotate: `${arrow.rot ?? 0}rad`,
            scale: `${(arrow.flipH ? -1 : 1) * (arrow.scale ?? 1)} ${(arrow.flipV ? -1 : 1) * (arrow.scale ?? 1)}` }} />
      )}
      <div class="ftue-popup" style={{ left: `${px}px`, top: `${py}px`, width: `${pw}px`, height: `${ph}px` }}>
        <img class="ftue-popup-bg" src={imageUrl('images/ftue/ftue_popup.png') ?? ''} style={{ filter: hsvFilter(0, 0.5, 1.2) }} />
        <div class="ftue-header" style={{ left: `${hd[0]}px`, top: `${hd[1]}px`, width: `${pw - hd[0] - hd[2]}px`, height: `${hd[3] - hd[1]}px`, WebkitTextStrokeColor: d.outline }}>{f(`${t.key}_TITLE`)}</div>
        <div class="ftue-desc" style={{ left: `${ds[0]}px`, top: `${ds[1] + (d.margin ?? 0)}px`, width: `${pw - ds[0] - ds[2]}px`, height: `${ph - ds[1] - ds[3] - (d.margin ?? 0)}px`, fontSize: `${d.size ?? 22}px` }}>
          <RichText text={f(`${t.key}_DESCRIPTION`)} />
        </div>
        <FtueConfirmButton rect={d.button ?? [pw / 2 - 137.5, ph - 67, 275, 75]} onClick={closeTip} />
      </div>
      {sneaky && t.sneaky && <div class="ftue-sneaky" style={{ left: `${sneaky[0]}px`, top: `${sneaky[1]}px`, width: `${sneaky[2]}px`, height: `${sneaky[3]}px` }} onPointerUp={() => { const s = t.sneaky!; closeTip(); s(); }} />}
    </div>
  );
}

/** NFtueConfirmButton: the gold outline pulses α 0.25 ↔ 1 (0.6 s each way); hover 1.05 and v 1.4 with a steady outline. */
function FtueConfirmButton({ rect, onClick }: { rect: number[]; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const hot = st === 'hover';
  return (
    <div class="ftue-confirm" style={{ left: `${rect[0]}px`, top: `${rect[1]}px`, width: `${rect[2]}px`, height: `${rect[3]}px`, scale: hot ? '1.05' : '1', transition: hot ? 'scale .05s cubic-bezier(0.16, 1, 0.3, 1)' : 'scale .5s cubic-bezier(0.16, 1, 0.3, 1)' }}
      onPointerEnter={() => { setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt(''); onClick(); } }}>
      <img class={'fc-outline' + (hot ? ' hot' : '')} src={imageUrl('images/ftue/ftue_confirm_button_outline.png') ?? ''} style={{ filter: tint(0.94, 0.726, 0.085) }} />
      <img class="fc-img" src={imageUrl('images/ftue/ftue_confirm_button.png') ?? ''} style={{ filter: `brightness(${hot ? 1.4 : 1})`, transition: 'filter .05s' }} />
      <div class="fc-label">{loc('ftues', 'CONFIRM_BUTTON')}</div>
    </div>
  );
}

/** NAcceptTutorialsFtue (before the first embark): a vertical popup; "no" turns every tip off. */
export async function acceptTutorialsFtue() {
  if (seenFtue('accept_tutorials_ftue')) return;
  const yes = await confirmPopup({
    header: loc('main_menu_ui', 'ENABLE_TUTORIALS.title'), body: loc('main_menu_ui', 'ENABLE_TUTORIALS.description'),
    yes: loc('main_menu_ui', 'GENERIC_POPUP.confirm'), no: loc('main_menu_ui', 'GENERIC_POPUP.cancel'),
  });
  const sm = G.SaveManager.Instance;
  sm.MarkFtueAsComplete('accept_tutorials_ftue');
  if (!yes) sm.SetFtuesEnabled(false);
}

// NCombatRulesFtue: three illustrated pages at the first combat, started once the first turn has begun; closing it on the
// last page brings the combat start banner.
const NCombatRulesFtue = N('Ftue.NCombatRulesFtue');
NCombatRulesFtue.Create = () => ({
  Start: () => new Promise<void>((done) => {
    const ok = openModal(() => <CombatRules onClose={() => {
      G.SaveManager.Instance.MarkFtueAsComplete('combat_rules_ftue');
      closeModal();
      safe(() => N('Combat.NCombatStartBanner').Create(), null);
      done();
    }} />);
    if (!ok) done();
  }),
});
/**
 * combat_rules_ftue.tscn: combat_ftue_N (671 × 512 at (292, 252)), the text (1005, 271)–(1628, 754), header and page
 * count under them, and the gold arrows at x 40 / 1752. Pages slide in from −200 px (0.5 s Expo Out) while the text is
 * revealed over 0.6 s; the right arrow on the last page closes it.
 */
function CombatRules({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [dir, setDir] = useState(0);
  const img = useRef<HTMLImageElement>(null), text = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    const gs = glyphs(el);
    let t = 0;
    const stop = $.onFrame((dt: number) => {
      t += dt;
      const k = Math.min(1, t / 0.6), n = Math.floor(Math.sin((k * Math.PI) / 2) * gs.length);
      gs.forEach((g, i) => { g.style.visibility = i < n ? '' : 'hidden'; });
      return k < 1;
    });
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dir ? 600 : 1000 });
    img.current?.animate([{ opacity: dir ? 0.5 : 0 }, { opacity: 1 }], { duration: 500, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' });
    if (dir) for (const e of [img.current, el]) e?.animate([{ translate: `${-200 * dir}px 0` }, { translate: '0 0' }], { duration: 500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    return stop;
  }, [page]);
  const turn = (d: number) => { if (d > 0 && page === 3) { onClose(); return; } setDir(d); setPage(page + d); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft' && page > 1) turn(-1); if (e.key === 'ArrowRight') turn(1); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <div class="ftue combat-rules">
      <img class="cr-image" ref={img} src={imageUrl(`images/ftue/combat_ftue_${page - 1}.png`) ?? ''} key={`i${page}`} />
      <div class="cr-text" ref={text} key={`t${page}`}><RichText text={f(`TUTORIAL_FTUE_BODY_${page}`)} /></div>
      <div class="cr-header">{f('COMBAT_BASICS_FTUE_HEADER')}</div>
      <div class="cr-count">{locv('ftues', 'COMBAT_BASICS_FTUE_PAGE_COUNT', { currentPage: page, totalPages: 3 })}</div>
      {page > 1 && <NGoldArrowButton left class="cr-arrow left" onClick={() => turn(-1)} />}
      <NGoldArrowButton class="cr-arrow right" onClick={() => turn(1)} />
    </div>
  );
}
// CardPileCmd.ShuffleFtueCheck: the first reshuffle waits for the tip to be confirmed
G.CardPileCmd.ShuffleFtueCheck = () => {
  if (seenFtue('shuffle_ftue')) return $.Task.CompletedTask;
  const t = new $.TaskCompletionSource();
  showFtue('shuffle_ftue', 'SHUFFLE_FTUE').then(() => t.TrySetResult());
  return t.Task;
};
