// NScrollableContainer without padding (the custom run's modifier list, the patch notes): the content follows its
// target at lerp 15·dt, wheel via ScrollHelper, left-drag outside controls ([data-ctl]); past either end the target
// springs back at 12·dt. The NScrollbar shows only when the content is taller than the view.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { $ } from '../game';
import { NScrollbar, wheelDrag } from './scrollbar';

type Rect = [number, number, number, number];
export function ScrollArea({ rect: [x, y, w, h], bar, class: cls, children }: { rect: Rect; bar: Rect; class?: string; children: any }) {
  const content = useRef<HTMLDivElement>(null);
  const st = useRef({ pos: 0, target: 0, drag: false, limit: 0, value: 0 });
  const [sb, setSb] = useState({ on: false, v: 0 });
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => { st.current.limit = h - el.offsetHeight; setSb((b) => ({ ...b, on: el.offsetHeight > h })); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [h]);
  useEffect(() => $.onFrame((dt: number) => {
    const s = st.current, lim = s.limit;
    if (Math.abs(s.pos - s.target) > 0.001) {
      s.pos += (s.target - s.pos) * Math.min(1, dt * 15);
      if (Math.abs(s.pos - s.target) < 0.5) s.pos = s.target;
      if (content.current) content.current.style.top = `${s.pos}px`;
      if (lim < 0) { const v = Math.min(1, Math.max(0, s.pos / lim)); if (Math.abs(v - s.value) > 0.001) { s.value = v; setSb((b) => ({ ...b, v })); } }
    }
    if (!s.drag) {
      if (s.target < Math.min(lim, 0)) s.target += (lim - s.target) * Math.min(1, dt * 12);
      else if (s.target > Math.max(lim, 0)) s.target += (0 - s.target) * Math.min(1, dt * 12);
    }
    return true;
  }), []);
  const scale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
  return (
    <>
      <div class={'scroll-area' + (cls ? ' ' + cls : '')} style={{ position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, overflow: 'hidden' }}
        onWheel={(e) => { st.current.target += wheelDrag(e); }}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('[data-ctl]')) return;
          st.current.drag = true;
          const move = (m: PointerEvent) => { if (st.current.drag) st.current.target += m.movementY / scale(); };
          const up = () => { st.current.drag = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}>
        <div ref={content} style={{ position: 'absolute', left: 0, top: 0, width: '100%' }}>{children}</div>
      </div>
      {sb.on && <NScrollbar x={bar[0]} y={bar[1]} w={bar[2]} h={bar[3]} value={sb.v} onSet={(v) => { st.current.target = v * Math.min(0, st.current.limit); }} />}
    </>
  );
}
