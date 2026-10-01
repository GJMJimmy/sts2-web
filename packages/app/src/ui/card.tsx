// scenes/cards/card.tscn: a 300 × 422 card with its origin at the centre, laid out at native size and scaled to
// `width`. NCard.UpdateVisuals: dynamic-var previews (Strength, Vulnerable, targets), cost colours, star cost,
// enchantment tab, affliction overlays, the ancient layout and the NotSeen / Locked states.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { G, $ } from '../game';
import { atlasFrame, frameByName, frameStyle, imageUrl } from '../assets';
import { matFilter } from '../filters';
import { RichText } from './richtext';
import { flipbook } from './anim';

export interface CardProps {
  card: any; pile?: number; width?: number; target?: any;
  /** CardPreviewMode (Normal 1, Upgrade 2, MultiCreatureTargeting 3); `preview` = Upgrade. */
  mode?: number; preview?: boolean;
  /** ModelVisibility: shown normally, not seen yet (blurred, "?"), or locked. */
  visibility?: 'visible' | 'notSeen' | 'locked';
  /** NCard.SetPretendCardCanBePlayed: an unaffordable cost keeps its normal colour. */
  pretend?: boolean;
  /** NCard.SetForceUnpoweredPreview: base numbers, no power / target modifiers. */
  unpowered?: boolean;
  /** NCard.EnchantmentTab.Visible off (NCardEnchantVfx draws the tab through EnchantmentVfxOverride instead). */
  hideEnch?: boolean;
  glow?: boolean; onClick?: (e: MouseEvent) => void; onPointerDown?: (e: PointerEvent) => void; style?: any; class?: string;
}
const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const css = (c: any, d = '#000') => (c && 'R' in c ? `rgba(${Math.round(c.R * 255)}, ${Math.round(c.G * 255)}, ${Math.round(c.B * 255)}, ${c.A ?? 1})` : d);
/** Card-centre rect → absolute CSS box inside the 300 × 422 card. */
const at = (l: number, t: number, w: number, h: number) => ({ left: `${150 + l}px`, top: `${211 + t}px`, width: `${w}px`, height: `${h}px` });
const img = (fr: any, l: number, t: number, w: number, h: number, extra: any = {}) => ({ ...frameStyle(fr, w, h), position: 'absolute', left: `${150 + l}px`, top: `${211 + t}px`, ...extra });

/** Title outline by rarity (NCard.UpdateTitleLabel); upgraded cards use green text with the event outline. */
const TITLE_OUTLINE: Record<string, string> = { Uncommon: '#005C75', Rare: '#6B4B00', Curse: '#550B9E', Quest: '#7E3E15', Status: '#4F522F', Event: '#1B6131' };
const COST = { Unmodified: 0, Increased: 1, Decreased: 2, InsufficientResources: 3 };
/** GetCostTextColorInHand / GetCostOutlineColorInHand. */
function costColors(color: number, pretend: boolean, text: string, outline: string): [string, string] {
  if (color === COST.Increased) return ['#40FFFF', '#20595C'];
  if (color === COST.Decreased) return ['#7FFF00', '#1F5923'];
  if (color === COST.InsufficientResources && !pretend) return ['#FF5555', '#501717'];
  return [text, outline];
}

// ------------------------------------------------------------------ MegaLabel auto-size
/** SetTextAutoSize: the largest font size in [min, max] at which the text fits its box (binary search, cached). */
const fitCache = new Map<string, number>();
export function useFit(ref: { current: HTMLElement | null }, key: string, max: number, min: number, fits: (el: HTMLElement) => boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = fitCache.get(key);
    if (size == null) {
      el.style.fontSize = `${max}px`;
      if (fits(el)) size = max;
      else {
        let lo = min, hi = max;
        while (lo <= hi) { const mid = (lo + hi) >> 1; el.style.fontSize = `${mid}px`; if (fits(el)) lo = mid + 1; else hi = mid - 1; }
        size = Math.min(lo, hi);
      }
      if (document.fonts?.status === 'loaded') fitCache.set(key, size);
    }
    el.style.fontSize = `${size}px`;
  });
}
const lang = () => safe(() => G.LocManager.Instance.Language, '');

// ------------------------------------------------------------------ affliction / card overlays (cards/overlays/*.tscn)
/** `len`: the animation's length when its last key is held past 1/fps (the flipbook repeats the last frame). */
interface Layer { src: string; x: number; y: number; w: number; h: number; frames?: number; fps?: number; len?: number }
const OVERLAYS: Record<string, Layer[]> = {
  entangled: [{ src: 'afflictions/affliction_entangled', x: 0, y: -15, w: 327, h: 466 }],
  smog: [{ src: 'afflictions/affliction_smog', x: 0, y: -15, w: 327, h: 466 }],
  galvanized: [{ src: 'afflictions/affliction_galvanic', x: 6, y: -10, w: 225.5, h: 321.4 }],
  hexed: [{ src: 'afflictions/affliction_hexed', x: 6, y: -10, w: 225.5, h: 321.4 }],
  // ringing.tscn: VisualLayer2's "new_animation" keys ringingb_00…12 every 1/15 s over the default 1 s length, looped
  ringing: [{ src: 'afflictions/ringing/affliction_ringinga', x: 0, y: 0, w: 299, h: 420.3 }, { src: 'afflictions/ringing/affliction_ringingb_', x: 0, y: 0, w: 299, h: 422, frames: 13, fps: 15, len: 1 }],
  bound: [{ src: 'afflictions/shattered/affliction_shattereda', x: -2.5, y: -8, w: 283.4, h: 398.4 }, { src: 'afflictions/shattered/affliction_shatteredb_', x: -2, y: -5, w: 283.5, h: 396.7, frames: 13, fps: 12 }],
  infection: [{ src: 'infection/infectiona', x: -2.5, y: -8, w: 280.5, h: 396.5 }, { src: 'infection/infection_', x: -0.5, y: -7.5, w: 333, h: 457, frames: 30, fps: 12 }],
};
function Overlay({ id }: { id: string }) {
  const layers = OVERLAYS[id];
  if (!layers) return null;
  return (
    <>
      {layers.map((l) => {
        const box = at(l.x - l.w / 2, l.y - l.h / 2, l.w, l.h);
        if (!l.frames) return <img class="card-part" src={imageUrl(`images/card_overlays/${l.src}.png`) ?? ''} style={box} />;
        const n = l.len ? Math.round(l.len * (l.fps ?? 12)) : l.frames;
        const urls = Array.from({ length: n }, (_, i) => imageUrl(`images/card_overlays/${l.src}${String(Math.min(i, l.frames! - 1)).padStart(2, '0')}.png`) ?? '');
        return <div class="card-part" style={{ ...box, backgroundSize: '100% 100%', ...flipbook(`ov-${id}`, urls.map((u) => ({ backgroundImage: `url(${u})` })), l.fps ?? 12) }} />;
      })}
    </>
  );
}
export function Card({ card, pile, width = 300, target = null, mode, preview, visibility = 'visible', pretend = false, unpowered = false, hideEnch = false, glow, onClick, onPointerDown, style, class: cls }: CardProps) {
  const k = width / 300;
  const T = G.CardType, typeName = safe(() => $.enumStr(T, card.Type), 'Skill');
  const rarity = safe(() => $.enumStr(G.CardRarity, card.Rarity), 'Common');
  const ancient = rarity === 'Ancient';
  const pileType = pile ?? G.PileType.None;
  const inHand = pileType === G.PileType.Hand;
  const shown = visibility === 'visible';
  const previewMode = preview ? 2 : mode ?? 1;
  // NCard.UpdateVisuals: dynamic vars are previewed for the target (or the card's current target) before the text is built
  const tgt = target ?? safe(() => card.CurrentTarget, null);
  safe(() => {
    card.DynamicVars.ClearPreview();
    if (unpowered) return;
    card.UpdateDynamicVarPreview(previewMode, tgt, card.DynamicVars);
    if (card.Enchantment) { card.Enchantment.DynamicVars.ClearPreview(); card.UpdateDynamicVarPreview(previewMode, tgt, card.Enchantment.DynamicVars); }
  }, null);
  const desc = !shown
    ? `[center][font_size=40]${safe(() => new G.LocString().$ctor_LocString('card_library', visibility === 'locked' ? 'LOCKED.description' : 'UNKNOWN.description').GetFormattedText(), '')}[/font_size][/center]`
    : safe(() => (previewMode === 2 ? card.GetDescriptionForUpgradePreview() : card.GetDescriptionForPile(pileType, tgt)), '');
  const title = !shown
    ? safe(() => new G.LocString().$ctor_LocString('card_library', visibility === 'locked' ? 'LOCKED.title' : 'UNKNOWN.title').GetFormattedText(), '')
    : safe(() => card.Title, String(card.Id?.Entry ?? ''));
  const upgraded = safe(() => card.CurrentUpgradeLevel !== 0, false);
  const titleColor = upgraded ? '#7FFF00' : '#FFF6E2';
  const titleOutline = upgraded ? '#1B6131' : TITLE_OUTLINE[rarity] ?? '#4D4B40';

  // frame / border / banner textures and materials
  const frameKind = typeName === 'Attack' || typeName === 'Power' || typeName === 'Quest' ? typeName.toLowerCase() : 'skill';
  const borderKind = typeName === 'Attack' || typeName === 'Power' ? typeName.toLowerCase() : 'skill';
  const frameMat = matFilter(safe(() => card.VisualCardPool.FrameMaterialPath, ''));
  const bannerMat = matFilter(safe(() => card.BannerMaterialPath, ''));
  const portrait = atlasFrame(safe(() => card.PortraitPath, '')) ?? frameByName('card_atlas', 'beta');
  const blur = shown ? undefined : 'blur(14px)';

  // energy cost (UpdateEnergyCostVisuals / UpdateEnergyCostColor)
  const costsX = safe(() => card.EnergyCost.CostsX, false);
  const cost = safe(() => card.EnergyCost.GetWithModifiers(G.CostModifiers.All), -1);
  const showEnergy = !shown || costsX || cost >= 0;
  const poolOutline = css(safe(() => card.Pool.EnergyOutlineColor, null), '#5C5440');
  let [energyText, energyOutline] = ['#FFF6E2', poolOutline];
  if (shown) {
    if (!costsX && safe(() => card.EnergyCost.WasJustUpgraded, false)) [energyText, energyOutline] = ['#7FFF00', '#1F5923'];
    else if (inHand) [energyText, energyOutline] = costColors(safe(() => G.CardCostHelper.GetEnergyCostColor(card, card.CombatState), 0), pretend, energyText, energyOutline);
  }
  const reason = { v: 0 };
  const unplayable = shown && inHand && !safe(() => card.CanPlay$2(reason, { v: null }), true) && !safe(() => G.UnplayableReasonExtensions.HasResourceCostReason(reason.v), false);
  // star cost (Regent)
  const starX = safe(() => card.HasStarCostX, false);
  const star = safe(() => card.GetStarCostWithModifiers(), -1);
  const showStar = shown && (starX || star >= 0);
  let [starText, starOutline] = ['#FFF6E2', 'rgba(23, 85, 97, .863)'];
  if (showStar) {
    if (!starX && safe(() => card.WasStarCostJustUpgraded, false)) [starText, starOutline] = ['#7FFF00', '#1F5923'];
    else if (inHand) [starText, starOutline] = costColors(safe(() => G.CardCostHelper.GetStarCostColor(card, card.CombatState), 0), pretend, starText, starOutline);
  }
  // enchantment tab
  const ench = shown && !hideEnch ? safe(() => card.Enchantment, null) : null;
  const enchTop = starX || safe(() => card.CurrentStarCost, -1) >= 0 ? -116 : -161;
  const enchOff = ench && safe(() => ench.Status === G.EnchantmentStatus.Disabled, false);
  const typeLabel = safe(() => G.CardTypeExtensions.ToLocString(card.Type).GetFormattedText(), typeName);
  const overlay = shown ? safe(() => card.Affliction?.Id?.Entry?.toLowerCase(), null) ?? (safe(() => card.Id.Entry, '') === 'INFECTION' ? 'infection' : null) : null;

  const titleRef = useRef<HTMLDivElement>(null), descRef = useRef<HTMLDivElement>(null), costRef = useRef<HTMLDivElement>(null), starRef = useRef<HTMLDivElement>(null);
  const L = lang();
  useFit(titleRef, `t|${L}|${title}`, 26, 8, (el) => (el.firstChild as HTMLElement).offsetWidth <= 210 && (el.firstChild as HTMLElement).offsetHeight <= 54);
  useFit(descRef, `d|${L}|${desc}`, 21, 12, (el) => (el.firstChild as HTMLElement).offsetHeight <= 136);
  const costText = !shown ? '?' : costsX ? 'X' : String(cost);
  useFit(costRef, `c|${costText}`, 32, 22, (el) => (el.firstChild as HTMLElement).offsetWidth <= 46);
  const starStr = starX ? 'X' : String(star);
  useFit(starRef, `s|${starStr}`, 22, 16, (el) => (el.firstChild as HTMLElement).offsetWidth <= 28);

  return (
    <div class={'card' + (glow ? ' glow' : '') + (cls ? ' ' + cls : '')} style={{ width: `${300 * k}px`, height: `${422 * k}px`, ...style }} onClick={onClick} onPointerDown={onPointerDown}>
      <div class="card-inner" style={{ transform: k === 1 ? undefined : `scale(${k})` }}>
        {/* Shadow: the attack frame silhouette, black at 25 %, +12 / +12 */}
        <div style={img(frameByName('ui_atlas', 'card/card_frame_attack_s'), -137.5, -199, 299, 422, { filter: 'brightness(0)', opacity: 0.251 })} />
        {ancient ? (
          <>
            <div style={img(portrait, -153, -215, 299, 421, { filter: blur, ...maskFor(frameByName('compressed', 'card_template/ancient_portrait_mask_large')) })} />
            <div style={img(frameByName('compressed', 'card_template/card_highlight_ancient'), -156, -218, 310, 433, { mixBlendMode: 'overlay', opacity: 0.753 })} />
            <div style={img(frameByName('compressed', 'card_template/ancient_card_border'), -154, -216.5, 306, 427)} />
            <div style={img(frameByName('compressed', `card_template/ancient_card_text_bg_${frameKind === 'quest' ? 'skill' : frameKind}`), -131.5, -20, 263, 203)} />
          </>
        ) : <div style={img(portrait, -125, -168, 250, 190, { filter: blur })} />}
        {visibility === 'locked' && <img class="card-part" src={imageUrl('images/packed/common_ui/locked_card.png') ?? ''} style={at(-125, -175, 250, 190)} />}
        {!ancient && <div style={img(frameByName('ui_atlas', `card/card_frame_${frameKind}_s`), -149.5, -211, 299, 422, { filter: frameMat })} />}
        <div class="card-desc" ref={descRef} style={at(-122, 37, 243, 136)}><div><RichText text={desc} /></div></div>
        {overlay && <Overlay id={overlay} />}
        {!ancient && <div style={img(frameByName('ui_atlas', `card/card_portrait_border_${borderKind}_s`), -137.5, -164, 275, 210, { filter: bannerMat })} />}
        {!ancient
          ? <div style={img(frameByName('ui_atlas', 'card/card_banner'), -163, -207.94, 327, 84.87, { filter: bannerMat })} />
          : <AncientBanner />}
        <div class="card-title" ref={titleRef} style={{ ...at(-105, -204, 210, 54), color: titleColor, WebkitTextStrokeColor: titleOutline }}><span>{title}</span></div>
        <div class="card-plaque" style={{ top: `${211 + 1}px` }}>
          <div class="card-plaque-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/cards/card_portrait_border_plaque2.png')})`, filter: ancient ? matFilter('card_banner_ancient_mat.tres') : bannerMat }} />
          <span>{typeLabel}</span>
        </div>
        {showEnergy && <div style={img(atlasFrame(safe(() => card.EnergyIconPath, '')) ?? frameByName('ui_atlas', 'card/energy_colorless'), -166, -227, 64, 64)} />}
        {showEnergy && <div class="card-cost" ref={costRef} style={{ ...at(-157, -221, 46, 56), color: energyText, WebkitTextStrokeColor: energyOutline }}><span>{costText}</span></div>}
        {showEnergy && unplayable && <div style={img(frameByName('ui_atlas', 'card/card_unplayable_icon'), -158, -219, 48, 48)} />}
        {showStar && <img class="card-part" src={imageUrl('images/ui/combat/energy_star.png') ?? ''} style={at(-186, -189, 58, 58)} />}
        {showStar && <div class="card-star" ref={starRef} style={{ ...at(-171, -180, 28, 40), color: starText, WebkitTextStrokeColor: starOutline }}><span>{starStr}</span></div>}
        {showStar && unplayable && <img class="card-part" src={imageUrl('images/ui/combat/energy_star.png') ?? ''} style={at(-181, -184, 48, 48)} />}
        {ench && (
          <div class="card-ench" style={{ ...at(-166, enchTop, 72, 54), opacity: enchOff ? 0.9 : 1 }}>
            <div style={{ ...frameStyle(frameByName('ui_atlas', 'card/card_enchant_s'), 71, 54), position: 'absolute', left: '0.5px', top: '0px', filter: `url(#${enchOff ? 'enchant_tab_off' : 'enchant_tab'})` }} />
            <img src={imageUrl(`images/enchantments/${String(ench.Id.Entry).toLowerCase()}.png`) ?? imageUrl('images/enchantments/missing_enchantment.png') ?? ''}
              style={{ position: 'absolute', left: '14px', top: '9px', width: '35px', height: '35px', filter: enchOff ? `url(#enchant_tab_off)` : undefined }} />
            {safe(() => ench.ShowAmount, false) && <div class="card-ench-amt" style={{ color: enchOff ? 'rgb(128, 128, 128)' : '#FFF6E2' }}>{safe(() => ench.DisplayAmount, '')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
/** CSS mask from an atlas frame (the ancient portrait mask), stretched over the element. */
function maskFor(fr: any) {
  if (!fr) return {};
  const s = frameStyle(fr, 299, 421);
  return { WebkitMaskImage: s.backgroundImage, maskImage: s.backgroundImage, WebkitMaskSize: s.backgroundSize, maskSize: s.backgroundSize, WebkitMaskPosition: s.backgroundPosition, maskPosition: s.backgroundPosition, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' };
}
/** AncientBanner with its looping flame (ancient_card_flame_0..9 at 10 fps). */
function AncientBanner() {
  const frames = Array.from({ length: 10 }, (_, i) => frameStyle(frameByName('compressed', `card_template/ancient_flame/ancient_card_flame_${i}`), 29, 41))
    .map((f) => ({ padding: f.padding, backgroundImage: f.backgroundImage, backgroundSize: f.backgroundSize, backgroundPosition: f.backgroundPosition }));
  return (
    <>
      <div style={{ ...img(frameByName('ui_atlas', 'card/ancient_banner'), -163, -209.85, 327, 88.69), clipPath: 'inset(2.85px 0 2.85px 0)' }} />
      <div style={{ ...img(frameByName('compressed', 'card_template/ancient_flame/ancient_card_flame_0'), 1 - 14.5, -217 - 20.5, 29, 41), ...flipbook('ancient-flame', frames, 10) }} />
    </>
  );
}
