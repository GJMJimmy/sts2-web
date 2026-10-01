// NScrollbar (ui/scrollbar.tscn): a #2A4A52-tinted track (scrollbar_track_center with 48 px scrollbar_track_edge2 caps
// above and below) and the 72 px scrollbar_train_large handle centred at `value` (0–1). Pressing or dragging it sets
// the value from the pointer.
import { frameByName, frameStyle } from '../assets';

export function NScrollbar({ x, y, w, h, value, onSet, style }: { x: number; y: number; w: number; h: number; value: number; onSet?: (v: number, pressed: boolean) => void; style?: any }) {
  const set = (e: PointerEvent, pressed: boolean) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSet?.(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), pressed);
  };
  const edge = frameByName('ui_atlas', 'scrollbar_track_edge2');
  return (
    <div class="nscrollbar" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, ...style }}
      onPointerDown={(e) => { if (e.button !== 0) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); set(e, true); }}
      onPointerMove={(e) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) set(e, true); }}
      onPointerUp={(e) => set(e, false)}>
      <div class="nsb-track" style={{ ...frameStyle(edge, w, 48), top: '-48px' }} />
      <div class="nsb-track" style={{ ...frameStyle(frameByName('ui_atlas', 'scrollbar_track_center'), w, h), top: 0 }} />
      <div class="nsb-track" style={{ ...frameStyle(edge, w, 48), top: `${h}px`, scale: '1 -1' }} />
      <div class="nsb-train" style={{ ...frameStyle(frameByName('ui_atlas', 'scrollbar_train_large'), 72, 72), left: `${(w - 72) / 2}px`, top: `${h * value - 36}px` }} />
    </div>
  );
}

/**
 * ScrollHelper.GetDragForScrollEvent as the game's scroll views see it: a wheel notch arrives as WheelUp/Down pressed
 * and released (±40 each, nothing filters the release), so ±80; pixel deltas (trackpads) scroll 1:1.
 */
export function wheelDrag(e: WheelEvent) {
  const notch = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
  return notch ? -Math.sign(e.deltaY) * 80 : -e.deltaY;
}
