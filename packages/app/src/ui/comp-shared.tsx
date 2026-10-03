// Pieces the compendium screens share: NScrollableContainer (lerp / drag / spring scrolling with its NScrollbar), the
// BorderGradient fades, and the NTickbox checkbox visuals (ui/tickbox.tscn).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { $ } from '../game';
import { frameByName, frameStyle } from '../assets';
import { playOneShot } from '../audio';
import { NScrollbar, wheelDrag } from './scrollbar';
import './compendium.css';
import { view } from '../view';

export const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
export const fmt = (ls: any) => safe(() => (typeof ls === 'string' ? ls : ls?.GetFormattedText?.() ?? String(ls ?? '')), '');
export const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const BACK_OUT = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const hoverSfx = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
export const clickSfx = () => playOneShot('event:/sfx/ui/clicks/ui_click');
/** Pointer y in the 1920 × 1080 stage. */
export function stageY(e: PointerEvent) {
  const st = (e.currentTarget as HTMLElement).closest('.stage-root')?.getBoundingClientRect();
  return st ? (e.clientY - st.top) * (1080 / st.height) : e.clientY;
}

/**
 * NScrollableContainer: the content (`inner`, top at `top` + position) follows its target at lerp 15·dt (snapping
 * within 0.5 px); wheel, left-drag anywhere 1:1, and past the ends the target springs back at 12·dt. The limit is
 * the container's height (the screen's) − content height; content that fits does not scroll. `onMove` runs while the content moves (tips that follow).
 */
export function useScroller({ top = 0, range, barOn, onMove }: { top?: number; range?: [number, number]; barOn?: boolean; onMove?: () => void } = {}) {
  const inner = useRef<HTMLDivElement>(null);
  const s = useRef({ pos: 0, target: 0, drag: false, last: 0, moved: 0, lo: 0, hi: 0, bar: -1 });
  const [bar, setBar] = useState<{ on: boolean; v: number }>({ on: false, v: 0 });
  const move = useRef(onMove);
  move.current = onMove;
  // NCardGrid passes its own limits ([min(top, bottom), max(top, bottom)]); NScrollableContainer measures its content
  useLayoutEffect(() => {
    const h = range ? 0 : inner.current?.offsetHeight ?? 0;
    const [lo, hi] = range ?? [Math.min(0, view.h - h), 0];
    const on = range ? !!barOn : h > view.h;
    s.current.lo = lo; s.current.hi = hi;
    if (bar.on !== on) setBar((b) => ({ ...b, on }));
  });
  useEffect(() => $.onFrame((dt: number) => {
    const g = s.current;
    if (Math.abs(g.pos - g.target) > 0.1) {
      g.pos += (g.target - g.pos) * Math.min(1, dt * 15);
      if (Math.abs(g.pos - g.target) < 0.5) g.pos = g.target;
      if (inner.current) inner.current.style.top = `${top + g.pos}px`;
      move.current?.();
    }
    if (!g.drag) {
      if (g.target < g.lo) g.target += (g.lo - g.target) * Math.min(1, dt * 12);
      else if (g.target > g.hi) g.target += (g.hi - g.target) * Math.min(1, dt * 12);
    }
    const v = g.lo < 0 ? Math.min(1, Math.max(0, g.pos / g.lo)) : 0;
    if (Math.abs(v - g.bar) > 0.002) { g.bar = v; setBar((b) => ({ ...b, v })); }
    return true;
  }), []);
  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const g = s.current;
      if (!g.drag) return;
      const st = document.querySelector('.stage-root')!.getBoundingClientRect(), y = (e.clientY - st.top) * (1080 / st.height);
      g.target += y - g.last; g.moved += Math.abs(y - g.last); g.last = y;
    };
    const up = () => { s.current.drag = false; };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  }, []);
  /** InstantlyScrollToTop */
  const reset = () => { const g = s.current; g.pos = g.target = 0; if (inner.current) inner.current.style.top = `${top}px`; };
  const handlers = {
    onWheel: (e: WheelEvent) => { if (s.current.lo !== s.current.hi) s.current.target += wheelDrag(e); },
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 || s.current.lo === s.current.hi) return;
      const g = s.current;
      g.drag = true; g.last = stageY(e); g.moved = 0;
    },
  };
  const scrollbar = (x: number, y: number, w: number, h: number) => bar.on && (
    <NScrollbar x={x} y={y} w={w} h={h} value={bar.v} onSet={(v) => { s.current.target = v * s.current.lo; }} />
  );
  return { inner, handlers, scrollbar, reset, state: s.current, innerStyle: { top: `${top + s.current.pos}px` } };
}

/** BorderGradient: black 0.9 → 0 over the top 5 % and 0 → 0.9 over the bottom 5 % (scaled 1.01 around the middle) of its container, or of `w` from `x`. */
export function BorderGradient({ x, w }: { x?: number; w?: number }) {
  return <div class="border-gradient" style={x == null ? undefined : { left: `${x}px`, width: `${w}px` }} />;
}

export type TickState = '' | 'hover' | 'press';
/** NTickbox visuals: checkbox_ticked / _unticked at 0.8 in a 64 box. Hover ×1.05 and v 1.2 (0.05 s); unhover and press ease over 0.5 s Expo Out. */
export function TickboxVisual({ ticked, st, size = 64 }: { ticked: boolean; st: TickState; size?: number }) {
  const k = st === 'hover' ? 1.05 : st === 'press' ? 0.95 : 1, v = st === 'hover' ? 1.2 : st === 'press' ? 0.8 : 1;
  const t = st === 'hover' ? '.05s linear' : `.5s ${EXPO_OUT}`;
  return (
    <div class="tickbox-visual" style={{ width: `${size}px`, height: `${size}px`, scale: String(k), filter: `brightness(${v})`, transition: `scale ${t}, filter ${t}` }}>
      <div style={{ ...frameStyle(frameByName('ui_atlas', ticked ? 'checkbox_ticked' : 'checkbox_unticked'), size * 0.8, size * 0.8), margin: `${size * 0.1}px` }} />
    </div>
  );
}
/** NTickbox input: hover ui_hover, press ui_click, release toggles with ui_checkbox_on / _off. */
export function useTick(ticked: boolean, toggle: () => void, enabled = true) {
  const [st, set] = useState<TickState>('');
  return {
    st,
    handlers: {
      onPointerEnter: () => { if (enabled) { set('hover'); hoverSfx(); } },
      onPointerLeave: () => set(''),
      onPointerDown: (e: PointerEvent) => { if (enabled && e.button === 0) { set('press'); clickSfx(); } },
      onPointerUp: (e: PointerEvent) => {
        if (!enabled || e.button !== 0 || st !== 'press') return;
        set('hover');
        playOneShot(ticked ? 'event:/sfx/ui/clicks/ui_checkbox_off' : 'event:/sfx/ui/clicks/ui_checkbox_on');
        toggle();
      },
    },
  };
}
