// NTreasureRoom (view: TreasureView in bridge.ts): the chest button over the chest skeleton (render/scene
// treasureBackdrop), the common banner, the relic collection's single-player holder and the proceed button.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G } from '../game';
import { frameByName, frameStyle, atlasFrame } from '../assets';
import { playOneShot } from '../audio';
import { loc } from '../i18n';
import { Backdrop } from './backdrop';
import { ProceedButton } from './buttons';
import { CommonBanner } from './overlays';
import { setTip, setTips, hoverTipsOf } from './tooltip';
import { treasureBackdrop, chestSkin, chestAlpha, chestRelicGlow } from '../render/scene';
import type { TreasureView } from '../bridge';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

export function TreasureScreen({ view }: { view: TreasureView }) {
  const rs = G.RunManager.Instance.State;
  const coll = useRef<HTMLDivElement>(null), holder = useRef<HTMLDivElement>(null);
  const paint = () => {
    chestAlpha(view.fx.ChestA);
    if (coll.current) coll.current.style.opacity = String(view.fx.CollectionA);
    if (holder.current) {
      holder.current.style.translate = `0 ${view.fx.HolderY}px`;
      holder.current.style.filter = `brightness(${view.fx.HolderV})`;
    }
  };
  useLayoutEffect(() => { view.paint = paint; paint(); return () => { if (view.paint === paint) view.paint = undefined; }; });
  return (
    <div class="treasure">
      <Backdrop id={`treasure:${rs?.TotalFloor}`} build={() => treasureBackdrop(rs)} />
      {!view.opened && <ChestButton view={view} />}
      <ProceedButton enabled={view.proceedOn} onClick={() => view.proceed()} />
      {view.collection && (
        <div class="relic-collection" ref={coll}>
          {view.empty
            ? <div class="treasure-empty">{loc('gameplay_ui', 'TREASURE_EMPTY')}</div>
            : view.holderShown && <RelicHolder view={view} el={holder} />}
        </div>
      )}
      {view.banner && <CommonBanner text={loc('gameplay_ui', 'TREASURE_BANNER')} out={view.banner === 'out'} />}
    </div>
  );
}

/** NTreasureButton: (602, 367) 800 × 500 over the chest; hover swaps to the stroke skin. */
function ChestButton({ view }: { view: TreasureView }) {
  const [press, setPress] = useState(false);
  return (
    <div class="chest-btn"
      onPointerEnter={() => { playOneShot('event:/sfx/ui/clicks/ui_hover'); chestSkin(true); }}
      onPointerLeave={() => { setPress(false); chestSkin(false); }}
      onPointerDown={(e) => { if (e.button === 0) { setPress(true); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && press) void view.open(); }} />
  );
}

/**
 * NTreasureRoomRelicHolder (204 × 204 at (858, 357)): the relic at 2× (a 120 icon centred at (960, 459) with its black
 * outline) over its rarity glow. Hover 2.1 (0.05 s), unhover 2.0 (0.4 s Expo Out), press 1.9; tips under the relic.
 */
function RelicHolder({ view, el }: { view: TreasureView; el: { current: HTMLDivElement | null } }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const relic = view.relic;
  const id = String(safe(() => relic.Id.Entry, '')).toLowerCase();
  const rarity = safe(() => relic.Rarity, 0);
  const scale = st === 'hover' ? 2.1 : st === 'press' ? 1.9 : 2;
  const glowScale = useRef(1);
  glowScale.current = scale / 2;
  useEffect(() => {
    const kind = rarity === G.RelicRarity.Rare ? 'rare' : rarity === G.RelicRarity.Uncommon ? 'uncommon' : null;
    if (!kind) return;
    let alive = true;
    void chestRelicGlow(kind, () => (alive && view.holderShown ? [960, 459 + view.fx.HolderY, view.fx.CollectionA * view.fx.HolderV, glowScale.current] : null));
    return () => { alive = false; };
  }, [relic]);
  const t = st === 'hover' ? 'scale .05s linear' : `scale .4s ${EXPO_OUT}`;
  const enabled = view.clickable && !view.selectionOff;
  return (
    <div class="relic-holder-t" ref={el}
      onPointerEnter={() => { if (!view.clickable) return; setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); setTips(hoverTipsOf(relic), { kind: 'relic', rect: [892, 391, 120, 120] }); }}
      onPointerLeave={() => { setSt(''); setTip(null); }}
      onPointerDown={(e) => { if (e.button === 0 && enabled) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt('hover'); setTip(null); view.pick(); } }}>
      <div class="rh-relic" style={{ scale: String(scale / 2), transition: t }}>
        <div class="relic-outline" style={frameStyle(frameByName('relic_outline_atlas', id), 120, 120)} />
        <div style={frameStyle(atlasFrame(safe(() => relic.IconPath, '')) ?? frameByName('relic_atlas', id), 120, 120)} />
      </div>
    </div>
  );
}
