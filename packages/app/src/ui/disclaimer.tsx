// NEarlyAccessDisclaimer (screens/main_menu/early_access_disclaimer.tscn): the first main menu of a release build opens
// it in the modal container until SettingsSave.SeenEaDisclaimer. reward_panel (keep-aspect in 596…1324 × 125…955) holds
// the header (Kreon Bold 40, auto-sized 28–40, gold) and the description (Kreon 26, auto-sized 18–26, cream) in a
// 542-wide VBox (separation 24), with NDisclaimerProceedButton (reward_skip_button, hsv .48 / 1.5 / .8) at the bottom.
// Proceed: the panel rises 1000 px (0.5 s Back In), then the flag is saved and the modal cleared.
import { useRef, useState } from 'preact/hooks';
import { G, $ } from '../game';
import { imageUrl } from '../assets';
import { playOneShot } from '../audio';
import { loc, appText } from '../i18n';
import { hsvFilter } from '../filters';
import { RichText } from './richtext';
import { useFit } from './card';
import { openModal, closeModal, setPopupKeys } from './modal';

export function showEarlyAccessDisclaimer() {
  const s = G.SaveManager.Instance?.SettingsSave;
  if (!s || s.SeenEaDisclaimer) return;
  openModal(() => <Disclaimer />);
}

function Disclaimer() {
  const panel = useRef<HTMLDivElement>(null), header = useRef<HTMLDivElement>(null), desc = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const [closing, setClosing] = useState(false);
  // the port's own notice (i18n.ts APP) stands in for EARLY_ACCESS_DISCLAIMER.header / description_mkb
  const headerText = appText('aboutHeader');
  const descText = appText('aboutBody');
  useFit(header, `ea-h|${headerText}`, 40, 28, (el) => el.scrollWidth <= 542);
  // the description fills the VBox below the header (680 − 64 − 24)
  useFit(desc, `ea-d|${descText}`, 26, 18, (el) => el.scrollHeight <= 592);
  const close = () => {
    if (closing) return;
    setClosing(true);
    const o = { Y: 0 }, t = new $.WebTween();
    t.TweenProperty(o, 'y', -1000, 0.5).SetEase(0).SetTrans(10);
    $.onFrame(() => { if (panel.current) panel.current.style.translate = `0 ${o.Y}px`; return t.IsValid(); });
    t.whenFinished(() => {
      G.SaveManager.Instance.SettingsSave.SeenEaDisclaimer = true;
      setPopupKeys({});
      closeModal();
    });
  };
  setPopupKeys({ yes: () => { playOneShot('event:/sfx/ui/clicks/ui_click'); close(); } }); // Hotkeys: accept
  const scale = st === 'hover' ? 1.05 : st === 'press' ? 0.95 : 1;
  const tr = st === 'hover' ? 'scale .05s linear' : st === 'press' ? 'scale .25s cubic-bezier(0.16, 1, 0.3, 1)' : 'scale .5s cubic-bezier(0.16, 1, 0.3, 1)';
  return (
    <div class="ea-panel" ref={panel}>
      <img class="ea-bg" src={imageUrl('images/ui/reward_screen/reward_panel.png') ?? ''} />
      <div class="ea-box">
        <div class="ea-header" ref={header}>{headerText}</div>
        <div class="ea-desc" ref={desc}><RichText text={descText} /></div>
      </div>
      <div class={'ea-proceed' + (closing ? ' off' : '')} style={{ scale: String(scale), transition: tr }}
        onPointerEnter={() => { if (closing) return; setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
        onPointerLeave={() => setSt('')}
        onPointerDown={(e) => { if (e.button === 0 && !closing) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
        onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt(''); close(); } }}>
        <img src={imageUrl('images/ui/reward_screen/reward_skip_button.png') ?? ''} style={{ filter: hsvFilter(0.48, 1.5, 0.8) }} />
        <span>{loc('main_menu_ui', 'EARLY_ACCESS_DISCLAIMER.proceedButton')}</span>
      </div>
    </div>
  );
}
