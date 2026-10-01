// NHoverTipSet: text tips (hover_tip.png nine-patch in a 360-wide column) and card tips (cards at 0.75), anchored to
// their owner with the original alignment rules (SetAlignment, SetAlignmentForCardHolder, SetAlignmentForRelic, fixed
// offsets). Tips appear and vanish instantly and never follow the mouse (a set may follow its owner: SetFollowOwner).
// Coordinates are the 1920 × 1080 viewport.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { G, $ } from '../game';
import { RichText } from './richtext';
import { invalidate } from '../store';
import { imageUrl, anyImage, frameStyle } from '../assets';
import { Card } from './card';
import { targetManager } from '../cardnodes';

/** `model`: IHoverTip.CanonicalModel (marked seen when the tip shows). */
export interface TipData { title: string; body: string; icon?: string | null; debuff?: boolean; card?: any; model?: any }
export type Rect = [number, number, number, number];
export type Placement =
  | { kind: 'align'; rect: Rect; align: 'left' | 'right' | 'center' }
  | { kind: 'holder'; rect: Rect; x: number; starCost?: boolean }
  | { kind: 'relic'; rect: Rect }
  | { kind: 'at'; x: number; y: number; rightEdge?: boolean };

let tips: TipData[] = [];
let place: Placement | null = null;
/** NHoverTipSet.shouldBlockHoverTips (targeting, the potion popup). */
export const tipBlock = { on: false };

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (x: any) => safe(() => (typeof x === 'string' ? x : x?.GetFormattedText?.() ?? String(x ?? '')), '');
/** IHoverTip → TipData (IHoverTip.RemoveDupes first); CardHoverTips become card previews. */
export function hoverTipsOf(model: any): TipData[] {
  const raw = safe(() => model?.HoverTips, null);
  if (!raw) return [];
  const list = safe(() => [...$.iter(G.IHoverTip.RemoveDupes(raw))], null) ?? safe(() => [...$.iter(raw)], []);
  return list.map((h: any) => ({
    ...(h instanceof G.CardHoverTip
      ? { title: '', body: '', card: h.Card }
      : { title: fmt(h?.Title), body: fmt(h?.Description), icon: safe(() => h.Icon?.ResourcePath ?? null, null), debuff: !!safe(() => h.IsDebuff, false) }),
    model: safe(() => h.CanonicalModel, null),
  }));
}
/** NHoverTipSet.Init: every shown tip's canonical card / relic / potion counts as seen for the compendium. */
function markSeen(list: TipData[]) {
  const sm = safe(() => G.SaveManager.Instance, null);
  for (const { model: m } of list) {
    if (!m || !sm) continue;
    if (m instanceof G.CardModel) safe(() => sm.MarkCardAsSeen(m), null);
    else if (m instanceof G.RelicModel) safe(() => sm.MarkRelicAsSeen(m), null);
    else if (m instanceof G.PotionModel) safe(() => sm.MarkPotionAsSeen(m), null);
  }
}

// ------------------------------------------------------------------ owner rects
function stageRect() { return (document.querySelector('.stage-root') as HTMLElement | null)?.getBoundingClientRect() ?? null; }
/** A DOM element's box in viewport (1920 × 1080) coordinates. */
export function logicalRect(el: Element | null): Rect | null {
  const st = stageRect();
  if (!el || !st) return null;
  const r = el.getBoundingClientRect(), k = 1920 / st.width;
  return [(r.left - st.left) * k, (r.top - st.top) * k, r.width * k, r.height * k];
}
/** The element under the pointer when a caller gives no placement: tips go beside it (Right, or Left past 75 % width). */
let hovered: Element | null = null;
window.addEventListener('pointerover', (e) => { hovered = e.target as Element; }, true);
function ownerPlacement(): Placement | null {
  let el = hovered;
  while (el && el !== document.body) {
    const r = logicalRect(el);
    if (r && r[2] >= 24 && r[3] >= 24) return { kind: 'align', rect: r, align: r[0] > 1440 ? 'left' : 'right' };
    el = el.parentElement;
  }
  return null;
}

export function setTip(title: string | null, body = '', at?: Placement | null) {
  if (!title && !body) { tips = []; place = null; follow = null; invalidate(); return; }
  setTips([{ title: title ?? '', body: typeof body === 'string' ? body : String(body ?? '') }], at);
}
/**
 * NHoverTipSet.SetFollowOwner: `owner` returns the owner's global position (null once it is gone); every frame the
 * whole set (text and card tips) moves by how far the owner has moved since the set was laid out.
 */
let follow: { owner: () => number[] | null; x: number; y: number } | null = null;
const shift = [0, 0];
/** Several stacked tips; `at` anchors them (default: beside the hovered element). */
export function setTips(list: TipData[], at?: Placement | null, owner?: () => number[] | null) {
  follow = null;
  shift[0] = shift[1] = 0;
  // NHoverTipSet.shouldBlockHoverTips: set by NTargetManager.StartTargeting (cleared at FinishTargeting) and NPotionPopup
  if (tipBlock.on || targetManager.IsInSelection) { tips = []; invalidate(); return; }
  tips = list.filter((t) => t.title || t.body || t.card);
  place = tips.length ? at ?? ownerPlacement() : null;
  const o = tips.length ? owner?.() : null;
  if (o && owner) follow = { owner, x: o[0], y: o[1] };
  markSeen(tips);
  invalidate();
}
/** NPotionPopup's own tip set (owner: its HoverTipBounds), made before it blocks tips; it stays until the popup closes. */
let pinned: { tips: TipData[]; place: Placement } | null = null;
export function pinTips(list: TipData[] | null, at?: Placement) {
  const shown = (list ?? []).filter((t) => t.title || t.body || t.card);
  pinned = shown.length && at ? { tips: shown, place: at } : null;
  markSeen(shown);
  invalidate();
}
window.addEventListener('pointerdown', () => { if (tips.length) setTip(null); }, true);

// ------------------------------------------------------------------ layout (NHoverTipSet placement code)
interface Box { x: number; y: number; w: number; h: number }
const W = 1920, H = 1080;
function layout(p: Placement, tw: number, th: number, cw: number, ch: number): { text: Box; cards: Box } {
  const text: Box = { x: 0, y: 0, w: tw, h: th }, cards: Box = { x: 0, y: 0, w: cw, h: ch };
  const cardsAt = (x: number, y: number, align: 'left' | 'right') => { cards.x = align === 'left' ? x - cw : x; cards.y = y; };
  if (p.kind === 'align') {
    const [x, y, w, hh] = p.rect;
    if (p.align === 'left') { text.x = x - tw; text.y = y; cardsAt(x + w, y, 'right'); }
    else if (p.align === 'right') { cardsAt(x, y, 'left'); text.x = x + w; text.y = y; }
    else { text.x = x; text.y = y + hh * 1.5; cards.x = text.x; cards.y = text.y + th; }
  } else if (p.kind === 'holder') {
    const [x, y, w] = p.rect;
    if (p.x > W * 0.75) { text.x = x - tw - 10; text.y = y; cardsAt(x + w, y, 'right'); }
    else { cardsAt(x - (p.starCost ? 15 : 0), y, 'left'); text.x = x + w + 10; text.y = y; }
  } else if (p.kind === 'relic') {
    // SetAlignmentForRelic: the cards go under the text, flush with its left edge (LayoutResizeAndReposition Right puts
    // them at the start point; for Left their x is then reset to the text's)
    const [x, y, w, hh] = p.rect, left = x > W * 0.75;
    text.x = x; text.y = y + hh + 10;
    if (left) text.x -= tw - w;
    cards.x = text.x; cards.y = text.y + th;
    if (y > H * 0.75) text.y = y - th;
    overflow(text, cards, tw, cw);
    // Rect2.Intersects (borders excluded): the cards move beside the text
    if (text.x < cards.x + cw && text.x + tw > cards.x && text.y < cards.y + ch && text.y + th > cards.y) {
      cards.x = left ? text.x + tw : text.x - cw; cards.y = text.y;
      if (cards.y + ch > H) cards.y = H - ch;
    }
    return { text, cards };
  } else {
    text.x = p.rightEdge ? p.x - tw : p.x; text.y = p.y;
    cards.x = text.x + tw; cards.y = text.y;
    return { text, cards };
  }
  overflow(text, cards, tw, cw);
  return { text, cards };
}
/** CorrectVerticalOverflow + CorrectHorizontalOverflow. */
function overflow(text: Box, cards: Box, tw: number, cw: number) {
  if (text.y + text.h > H) text.y = H - text.h;
  if (cards.y + cards.h > H) cards.y = H - cards.h;
  if (cards.x + cw <= W && text.x + tw > W) { text.x = cards.x - tw; text.y = cards.y; }
  else if (cards.x + cw > W || text.x + tw > W) { cards.x = text.x + tw - cw; text.x -= cw; }
  else if (cards.x < 0 || text.x < 0) { cards.x = text.x; text.x += cw; }
}
/**
 * The text tips' VFlowContainer: Init sizes it 360 × Σ(tip + 5) while that stays under the viewport height − 50 (past
 * that it switches to centred alignment instead of growing); the sort then flows the tips down columns of that height
 * (4 px separation, each column as wide as its widest tip, ReverseFill = columns right to left from the container's
 * right edge) and the container grows to its minimum width. Returns the container height the alignment uses.
 */
function flowTips(els: HTMLElement[], reverse: boolean) {
  for (const e of els) e.style.width = '';
  const sz = els.map((e) => [e.offsetWidth, e.offsetHeight]);
  let th = 0, center = false;
  for (const [, h] of sz) { if (th + h + 5 < H - 50) th += h + 5; else center = true; }
  const cols: { i: number[]; w: number; len: number }[] = [];
  let col = { i: [] as number[], w: 0, len: 0 };
  sz.forEach(([w, h], i) => {
    if (col.i.length && col.len + 4 + h > th) { cols.push(col); col = { i: [], w: 0, len: 0 }; }
    col.len += (col.i.length ? 4 : 0) + h; col.w = Math.max(col.w, w); col.i.push(i);
  });
  cols.push(col);
  const width = Math.max(360, cols.reduce((a, c, k) => a + c.w + (k ? 4 : 0), 0));
  let x = 0;
  for (const c of cols) {
    for (const i of c.i) els[i].style.width = `${c.w}px`; // SIZE_FILL: the column's width
    let y = center ? Math.trunc((th - c.len) / 2) : 0;
    for (const i of c.i) {
      els[i].style.left = `${reverse ? width - x - c.w : x}px`;
      els[i].style.top = `${y}px`;
      y += els[i].offsetHeight + 4;
    }
    x += c.w + 4;
  }
  return th;
}

const bg = () => ({ borderImageSource: `url(${imageUrl('images/ui/hover_tip.png')})` });
function TipBox({ t }: { t: TipData }) {
  const icon = t.icon ? anyImage(t.icon) : null;
  return (
    <div class={'hover-tip' + (t.debuff ? ' debuff' : '')}>
      <div class="hover-tip-bg shadow" style={bg()} />
      <div class="hover-tip-bg" style={bg()} />
      {(t.title || icon) && (
        <div class="hover-tip-head">
          {t.title && <span class="hover-tip-title"><RichText text={t.title} /></span>}
          {icon && ('frame' in icon ? <span class="hover-tip-icon" style={frameStyle(icon.frame, 28)} /> : <img class="hover-tip-icon" src={icon.url} />)}
        </div>
      )}
      {t.body && <div class="hover-tip-body"><RichText text={t.body} /></div>}
    </div>
  );
}
/** The laid-out containers, moved by `shift` while the set follows its owner. */
let laid: { te: HTMLElement; ce: HTMLElement; text: Box; cards: Box } | null = null;
function paint() {
  if (!laid) return;
  const { te, ce, text, cards } = laid, dx = pinned ? 0 : shift[0], dy = pinned ? 0 : shift[1];
  te.style.transform = `translate(${text.x + dx}px, ${text.y + dy}px)`;
  ce.style.transform = `translate(${cards.x + dx}px, ${cards.y + dy}px)`;
}
/** The tip layer, drawn above everything in viewport coordinates. */
export function Tip() {
  const textRef = useRef<HTMLDivElement>(null), cardRef = useRef<HTMLDivElement>(null);
  const cur = pinned ?? (tips.length && place ? { tips, place } : null);
  useLayoutEffect(() => {
    const te = textRef.current, ce = cardRef.current, p = cur?.place;
    if (!te || !ce || !p) { laid = null; return; }
    // ReverseFill: SetAlignment Left and SetAlignmentForCardHolder Left
    const th = flowTips(Array.from(te.children) as HTMLElement[], (p.kind === 'align' && p.align === 'left') || (p.kind === 'holder' && p.x > W * 0.75));
    // the text container is sized 360 wide once it holds a tip (zero-sized with card tips only)
    laid = { te, ce, ...layout(p, te.children.length ? 360 : 0, th, ce.offsetWidth, ce.offsetHeight) };
    paint();
    te.style.visibility = ce.style.visibility = 'visible';
  });
  // NHoverTipSet._Process: GlobalPosition = owner.GlobalPosition − _followOffset
  useEffect(() => $.onFrame(() => {
    const f = follow;
    if (!f) return;
    const o = f.owner();
    if (!o) { follow = null; return; }
    if (o[0] - f.x === shift[0] && o[1] - f.y === shift[1]) return;
    shift[0] = o[0] - f.x; shift[1] = o[1] - f.y;
    paint();
  }), []);
  if (!cur) return null;
  const text = cur.tips.filter((t) => !t.card), cards = cur.tips.filter((t) => t.card);
  return (
    <div class="viewport tips-viewport">
      <div class="stage-root tips-root">
        <div class="hover-tips" ref={textRef} style={{ visibility: 'hidden' }}>{text.map((t) => <TipBox t={t} />)}</div>
        <div class="hover-tip-cards" ref={cardRef} style={{ visibility: 'hidden' }}>
          {cards.map((t) => <div class="hover-tip-card"><Card card={t.card} pile={G.PileType.Deck} width={225} /></div>)}
        </div>
      </div>
    </div>
  );
}
