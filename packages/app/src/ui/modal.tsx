// NModalContainer (one modal at a time over a black backstop, α 0 → 0.85 over 0.3 s and back) and the popups built on
// NVerticalPopup (ui/vertical_popup.tscn): the abandon-run confirmation and NGenericPopup.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'preact/hooks';
import { invalidate } from '../store';
import { frameByName, frameStyle } from '../assets';
import { playOneShot } from '../audio';
import { loc } from '../i18n';
import { hsvFilter, tint } from '../filters';
import { RichText } from './richtext';

let modal: { key: number; render: () => any; holes?: () => number[][] } | null = null;
let modalKey = 0;
export const modalOpen = () => !!modal;
/**
 * NModalContainer.Add: refused while another modal is open. `holes` are the rects (viewport units) of elements an FTUE
 * raises above the backstop: they stay lit and take the pointer.
 */
export function openModal(render: () => any, holes?: () => number[][]): boolean {
  if (modal) return false;
  modal = { key: ++modalKey, render, holes };
  invalidate();
  return true;
}
function holePath(rects: number[][]) {
  return `path(evenodd, "M0 0H1920V1080H0Z${rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}Z`).join('')}")`;
}
/** NModalContainer.Clear. */
export function closeModal() { modal = null; invalidate(); }

export function ModalLayer() {
  return (
    <div class={'viewport modal-viewport' + (modal ? ' open' : '')}>
      <div class="stage-root modal-root">
        <div class="modal-backstop" style={{ clipPath: modal?.holes ? holePath(modal.holes()) : undefined }} />
        {modal && <div class="modal-slot" key={modal.key}>{modal.render()}</div>}
      </div>
    </div>
  );
}

/** Hotkeys of the open popup's buttons: select (Enter) = yes, cancel (Escape) = no. */
let popupKeys: { yes?: () => void; no?: () => void } = {};
/** A modal's own accept / cancel hotkeys (NDisclaimerProceedButton's accept). */
export const setPopupKeys = (k: { yes?: () => void; no?: () => void }) => { popupKeys = k; };
window.addEventListener('keydown', (e) => {
  if (!modal) return;
  // a modal takes the keyboard: nothing under it reacts
  e.stopImmediatePropagation();
  const f = e.key === 'Enter' ? popupKeys.yes : e.key === 'Escape' ? popupKeys.no : undefined;
  if (!f) return;
  e.preventDefault();
  f();
}, true);

interface PopupOpts { header: string; body: string; yes: string; no?: string | null; abandon?: boolean }
/**
 * A vertical popup in the modal container; resolves true for Yes. `abandon` gives NAbandonRunConfirmPopup's entrance
 * (α over 0.1 s, y +100 → 0 over 0.3 s Back Out); NGenericPopup has none.
 */
export function confirmPopup(o: PopupOpts): Promise<boolean> {
  return new Promise((done) => {
    const finish = (v: boolean) => { popupKeys = {}; closeModal(); done(v); };
    if (!openModal(() => <VerticalPopup {...o} onYes={() => finish(true)} onNo={() => finish(false)} />)) done(false);
  });
}
/** NAbandonRunConfirmPopup: "Abandon Run?" with Confirm / Cancel. */
export const abandonRunPopup = () => confirmPopup({
  header: loc('main_menu_ui', 'ABANDON_RUN_CONFIRMATION.header'), body: loc('main_menu_ui', 'ABANDON_RUN_CONFIRMATION.body'),
  yes: loc('main_menu_ui', 'GENERIC_POPUP.confirm'), no: loc('main_menu_ui', 'GENERIC_POPUP.cancel'), abandon: true,
});

/**
 * NVerticalPopup: popup_vertical (hsv h .505 v .75) in a 522 × 600 panel centred on the screen, the header (Kreon Bold
 * 32 gold) and the centred body (Kreon 26 cream), No at the bottom left and Yes at the bottom right.
 */
function VerticalPopup({ header, body, yes, no, abandon, onYes, onNo }: PopupOpts & { onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  popupKeys = { yes: onYes, no: no ? onNo : undefined };
  useEffect(() => {
    if (!abandon || !ref.current) return;
    ref.current.animate([{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], { duration: 100 });
    ref.current.animate([{ translate: '0 100px' }, { translate: '0 0' }], { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }, []);
  const bg = frameByName('ui_atlas', 'popup_vertical');
  const k = bg ? Math.min(522 / (bg.sw * 2), 600 / (bg.sh * 2)) : 1;
  const w = bg ? bg.sw * 2 * k : 522, h = bg ? bg.sh * 2 * k : 600;
  return (
    <div class="vpopup" ref={ref}>
      <div class="vp-bg" style={{ ...frameStyle(bg, w, h), left: `${(522 - w) / 2}px`, top: `${(600 - h) / 2}px`, filter: hsvFilter(0.505, 1, 0.75) }} />
      <div class="vp-header">{header}</div>
      <div class="vp-body"><RichText text={body} /></div>
      {no && <PopupButton yes={false} text={no} onClick={onNo} />}
      <PopupButton yes text={yes} onClick={onYes} />
    </div>
  );
}

/**
 * NPopupYesNoButton (180 × 72): the confirm (hsv h .75 s 1.2 v 1.1) or cancel (h 1 s .75 v 1.2) texture over its outline
 * (a black shadow at 0.5, additive gold #F0B400 while hovered). Hover 1.025 and s / v + .25 (0.05 s); unhover back over
 * 0.5 s Expo Out; press 0.975 and s / v − .1.
 */
function PopupButton({ yes, text, onClick }: { yes: boolean; text: string; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const base = yes ? [0.75, 1.2, 1.1] : [1, 0.75, 1.2];
  const d = st === 'hover' ? 0.25 : st === 'press' ? -0.1 : 0;
  const t = st === 'hover' ? '.05s linear' : `.5s cubic-bezier(0.16, 1, 0.3, 1)`;
  const name = yes ? 'popup_confirm_button' : 'popup_cancel_button';
  const img = frameByName('ui_atlas', name), out = frameByName('compressed', name + '_outline');
  const fit = (f: any) => { const k = f ? Math.min(196 / (f.sw * 2), 96 / (f.sh * 2)) : 1; return frameStyle(f, f ? f.sw * 2 * k : 196, f ? f.sh * 2 * k : 96); };
  return (
    <div class={'vp-btn ' + (yes ? 'yes' : 'no')}
      onPointerEnter={() => { setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
      onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt(''); onClick(); } }}>
      <div class="vpb-visuals" style={{ scale: st === 'hover' ? '1.025' : st === 'press' ? '0.975' : '1', transition: `scale ${t}` }}>
        <div class="vpb-outline" style={{ ...fit(out), ...(st === 'hover' ? { filter: tint(0.941, 0.706, 0), mixBlendMode: 'plus-lighter', opacity: 1 } : {}) }} />
        <div class="vpb-image" style={{ ...fit(img), filter: `${hsvFilter(base[0], 1, 1)} saturate(${base[1] + d}) brightness(${base[2] + d})`, transition: `filter ${t}` }} />
        <div class="vpb-label">{text}</div>
      </div>
    </div>
  );
}
