// The game's shared buttons, positioned on the 1920 × 1080 screen: NConfirmButton (tick, bottom right), NBackButton
// (arrow, bottom left), NProceedButton (labelled, bottom right). They slide in when enabled and out when disabled.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'preact/hooks';
import { frameByName, frameStyle, imageUrl } from '../assets';
import { playOneShot } from '../audio';
import { loc } from '../i18n';
import { tint } from '../filters';
import { invalidate } from '../store';

const GOLD = () => tint(0.941, 0.706, 0), CREAM = () => tint(1, 0.965, 0.886);

const hover = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
/** A button enabled as its screen opens starts from its hidden place and slides in (Enable from Disable). */
function useMounted() {
  const [on, set] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => set(true)); return () => cancelAnimationFrame(r); }, []);
  return on;
}
/** keep-aspect-centred atlas image in a local rect */
const fit = (atlas: string, name: string, x: number, y: number, w: number, h: number) => {
  const f = frameByName(atlas, name);
  const k = f ? Math.min(w / (f.sw * 2), h / (f.sh * 2)) : 1;
  const dw = f ? f.sw * 2 * k : w, dh = f ? f.sh * 2 * k : h;
  return { ...frameStyle(f, dw, dh), position: 'absolute', left: `${x + (w - dw) / 2}px`, top: `${y + (h - dh) / 2}px` } as any;
};

/** NButton.RegisterHotkeys while enabled: the pressed binding runs on key down, the released binding on key up. */
export type ButtonHotkey = { press: (() => void) | null; release: (() => void) | null };
/**
 * NConfirmButton: 200 × 110 at (1760, 726), hidden at x 1940; tick icon. Focus (hovered while enabled): 1.05 and the
 * gold outline at once; OnPress (mouse or `hotkey`): ui_click and AnimPressDown; the release only clicks; unfocus (or
 * Disable while focused): AnimUnhover. OnEnable clears the outline and the grey but keeps the scale ('small': a hotkey
 * press nobody unfocused stays at 0.95).
 */
export function ConfirmButton({ enabled: on, onClick, style, hotkey }: { enabled: boolean; onClick: () => void; style?: any; hotkey?: ButtonHotkey }) {
  const [st, set] = useState<'' | 'hover' | 'press' | 'small'>('');
  const enabled = useMounted() && on;
  const hovered = useRef(false), pressed = useRef(false);
  const press = () => { pressed.current = true; set('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); };
  const release = () => { if (pressed.current) { pressed.current = false; onClick(); } };
  const live = useRef({ press, release });
  live.current = { press, release };
  useEffect(() => {
    if (enabled) {
      set((s) => (hovered.current ? 'hover' : s === 'press' ? 'small' : s)); // OnEnable, then RefreshFocus
      if (hovered.current) hover();
    } else {
      pressed.current = false;
      if (hovered.current) set(''); // RefreshFocus → OnUnfocus
    }
    if (!enabled || !hotkey) return;
    const h = hotkey, p = () => live.current.press(), r = () => live.current.release();
    h.press = p; h.release = r;
    return () => { if (h.press === p) h.press = h.release = null; };
  }, [enabled]);
  return (
    <div class={`game-btn confirm-btn ${enabled ? 'shown' : ''} ${st}`} style={style}
      onPointerEnter={() => { hovered.current = true; if (enabled) { set('hover'); hover(); } }}
      onPointerLeave={() => { hovered.current = false; if (enabled) set(''); }}
      onPointerDown={(e) => { if (enabled && e.button === 0) press(); }}
      onPointerUp={(e) => { if (enabled && e.button === 0) release(); }}>
      <div class="gb-shadow" style={fit('ui_atlas', 'confirm_button', -41, -1, 267, 150)} />
      <div class="gb-outline" style={{ ...fit('compressed', 'confirm_button_outline', -56, -16, 273, 156), filter: GOLD() }} />
      <div class="gb-image" style={fit('ui_atlas', 'confirm_button', -53, -13, 267, 150)} />
      <div class="gb-icon" style={{ ...fit('compressed', 'confirm_button_tick', 35, 15, 80, 80), filter: CREAM() }} />
    </div>
  );
}

/** NBackButton: 200 × 110 at (−40, 726), hidden at x −220; arrow icon. (It stays at 1.05 after the first hover, as in the game.) */
export function BackButton({ enabled: on, onClick, style }: { enabled: boolean; onClick: () => void; style?: any }) {
  const [st, set] = useState<'' | 'hover' | 'press' | 'hovered'>('');
  const enabled = useMounted() && on;
  return (
    <div class={`game-btn back-btn ${enabled ? 'shown' : ''} ${st}`} style={style} data-esc={enabled ? '' : undefined}
      onClick={(e) => { if (enabled && e.detail === 0) onClick(); }}
      onPointerEnter={() => { if (enabled) { set('hover'); hover(); } }} onPointerLeave={() => set(st ? 'hovered' : '')}
      onPointerDown={(e) => { if (enabled && e.button === 0) { set('press'); playOneShot('event:/sfx/ui/clicks/ui_back'); } }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && st === 'press') { set('hover'); onClick(); } }}>
      <div class="gb-shadow" style={fit('ui_atlas', 'back_button', -9, -1, 267, 150)} />
      <div class="gb-outline" style={{ ...fit('compressed', 'back_button_outline', -24, -16, 273, 156), filter: GOLD() }} />
      <div class="gb-image" style={fit('ui_atlas', 'back_button', -21, -13, 267, 150)} />
      <div class="gb-icon" style={{ ...fit('compressed', 'back_button_arrow', 67, 15, 80, 80), filter: CREAM() }} />
    </div>
  );
}

/** NProceedButton: 269 × 108 at (1583, 764), hidden at x 1983; the outline pulses while `pulse`. No sounds. */
export function ProceedButton({ enabled, pulse, label, onClick, style }: { enabled: boolean; pulse?: boolean; label?: string; onClick: () => void; style?: any }) {
  const [st, set] = useState<'' | 'hover' | 'press'>('');
  const text = label ?? loc('gameplay_ui', 'PROCEED_BUTTON');
  return (
    <div class={`game-btn proceed-btn ${enabled ? 'shown' : ''} ${pulse && enabled ? 'pulse' : ''} ${st}`} style={style}
      onPointerEnter={() => enabled && set('hover')} onPointerLeave={() => set('')}
      onPointerDown={(e) => { if (enabled && e.button === 0) set('press'); }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && st === 'press') { set('hover'); onClick(); } }}>
      <div class="gb-shadow" style={fit('ui_atlas', 'proceed_button', 1, -5, 296, 155)} />
      <div class="gb-outline pb-outline" style={{ ...fit('compressed', 'proceed_button_outline', -11, -17, 296, 155), filter: tint(1, 0.8, 0) }} />
      <div class="gb-image" style={fit('ui_atlas', 'proceed_button', -11, -17, 296, 155)} />
      <div class="pb-label"><span>{text}</span></div>
    </div>
  );
}

/**
 * NGoldArrowButton: the settings_tiny arrow (keep-aspect in a `size` box) at hsv v 0.9. Hover: v 1.2 and 1.1× at once
 * (ui_hover); unhover: v back over 1 s, scale over 0.5 s (Expo Out); press: v 0.7 at once, scale → 1 over 0.5 s
 * (ui_click); release while hovered: v 1.2, 1.1×. `flip` mirrors the texture (flip_h).
 */
export function NGoldArrowButton({ left, flip, size = 128, class: cls, style, onClick }: {
  left?: boolean; flip?: boolean; size?: number; class?: string; style?: any; onClick: () => void;
}) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const f = frameByName('ui_atlas', left ? 'settings_tiny_left_arrow' : 'settings_tiny_right_arrow');
  const v = st === 'hover' ? 1.2 : st === 'press' ? 0.7 : 0.9;
  const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
  return (
    <div class={cls} style={style}
      onPointerEnter={() => { setSt('hover'); hover(); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); onClick(); invalidate(); } }}>
      <div style={{
        ...(f ? frameStyle(f, size, size) : { width: `${size}px`, height: `${size}px`, background: `url(${imageUrl(`images/packed/common_ui/settings_tiny_${left ? 'left' : 'right'}_arrow.png`)}) center / contain no-repeat` }),
        pointerEvents: 'none', scale: `${flip ? -1 : 1} 1`, transform: st === 'hover' ? 'scale(1.1)' : 'none', filter: `brightness(${v})`,
        transition: st === 'hover' ? 'none' : st === 'press' ? `transform .5s ${EXPO}` : `transform .5s ${EXPO}, filter 1s ${EXPO}`,
      }} />
    </div>
  );
}
