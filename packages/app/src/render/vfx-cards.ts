// Card and relic VFX nodes (NCardEnchantVfx, NCardUpgradeVfx, NCardTransformVfx, NRelicFlashVfx, NGainEpochVfx): ports of the scripted effects the rule layer creates.
// Each is a web node (cardnodes.ts Web) running the original _Ready / PlayAnimation sequence; card visuals stay DOM
// (ui/cardlayer.tsx), particles and additive sprites go to the node's FX slot among the cards of the layer that owns it
// (render/cardfx.ts pendingFx / FxSlot).
// ponytail: at a rest site the flash is in the room's VFX canvas, over the rest options rather than under them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { G, $, N } from '../game';
import { invalidate } from '../store';
import { Web, CardNodeView, HolderView } from '../cardnodes';
import { pendingFx } from './cardfx';
import { loadScene, particleItem, followParticles, sceneTexture } from './scene';
import { atlasFrame, frameStyle, imageUrl } from '../assets';
import { hsvMatrix, hsvFilter } from '../filters';
import { restVfxRoot } from '../ui/rest';

const NCard = N('Cards.NCard');
const NCardFlyVfx = N('Vfx.NCardFlyVfx');
const NRun = () => N('NRun').Instance;
const NCombatRoom = () => N('Rooms.NCombatRoom').Instance;
const v2 = (x = 0, y = 0) => new $.Vector2(x, y);
const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const tween = () => new $.WebTween();
const finished = (t: any) => new Promise<void>((r) => t.whenFinished(r));
const frame = () => new Promise<number>((r) => $.onFrame((dt: number) => { r(dt); return false; }));
const sfx = (path: string) => safe(() => G.SfxCmd.Play$2(path, 1), null);
const TR = { Linear: 0, Quad: 4, Expo: 5, Cubic: 7, Back: 10 }, EZ = { In: 0, Out: 1, InOut: 2 };
/** Cmd.Wait(seconds, token): false once cancelled (the awaiting task is abandoned, like the original's). */
async function wait(s: number, cts: any) {
  try { await G.Cmd.Wait$3(s, cts.Token); } catch { return false; }
  return !cts.IsCancellationRequested;
}
/** The pile (not the deck) → CombatVfxContainer, else the top bar's TrailContainer (NCardUpgradeVfx / NCardTransformVfx). */
async function flyToPile(node: CardNodeView, card: any, trailToTopBar: boolean) {
  const target = G.PileTypeExtensions.GetTargetPosition(card.Pile.Type, node);
  const fly = NCardFlyVfx.Create(node, target, false, card.Owner.Character.TrailPath);
  const parent = trailToTopBar ? NRun()?.GlobalUi.TopBar.TrailContainer : NCombatRoom()?.CombatVfxContainer;
  if (parent) G.GodotTreeExtensions.AddChildSafely(parent, fly);
  if (fly?.SwooshAwayCompletion) await fly.SwooshAwayCompletion.Task;
}
/** A one-shot CPUParticles2D of `scene` started at the node (its global position and scale), in the owning overlay. */
function emitAt(node: any, scene: string, name: string) {
  pendingFx.push({ node, draw: (root) => {
    const g = node.xf();
    void loadScene(scene).then((s) => {
      const it = s?.items.find((x: any) => x.p === name);
      if (!it || root.destroyed) return;
      const p = particleItem({ ...it, m: [g.sx, 0, 0, g.sy, g.x + it.m[4] * g.sx, g.y + it.m[5] * g.sy] }, true, () => { if (!p.destroyed) p.destroy({ children: true }); });
      root.addChild(p);
    });
  } });
}
/** An atlas frame (AtlasTexture) as a texture with its trim margins, so it stretches like the original region. */
async function frameTexture(path: string): Promise<Texture | null> {
  const f = atlasFrame(path);
  if (!f) return sceneTexture(path);
  const page = await Assets.load<Texture>(f.page).catch(() => null);
  return page && new Texture({ source: page.source, frame: new Rectangle(f.x, f.y, f.w, f.h), orig: new Rectangle(0, 0, f.sw, f.sh), trim: new Rectangle(f.ox, f.oy, f.w, f.h) });
}
const images = new Map<string, Promise<HTMLImageElement | null>>();
function image(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = images.get(url);
  if (!p) images.set(url, (p = new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = url; })));
  return p;
}

// ------------------------------------------------------------------ NRelicFlashVfx
/**
 * relic_flash_vfx.tscn: three additive 100 × 100 copies of the relic icon (self_modulate α 0.627, pivot centre, their
 * centre 50 px above the node, scale 0.75). StartVfx, all parallel: each copy snaps to α 1 (0.01 s), swells to 1.25 over
 * 1 s (Cubic Out) and fades out over 1.5 s, the copies 0.2 s apart; over a creature it starts at the top of its hitbox
 * 64 px low and rises back over 1 s (Expo Out). Freed when the tween finishes.
 */
const NRelicFlashVfx = N('Vfx.NRelicFlashVfx');
const NRestSiteCharacter = N('RestSite.NRestSiteCharacter');
export class RelicFlashVfx extends Web(NRelicFlashVfx) {
  imgs = [0, 1, 2].map(() => ({ Modulate: new $.Color(1, 1, 1, 0), Scale: v2(0.75, 0.75) }));
  private tw: any = null;
  constructor(private relic: any, private target: any = null) { super(); }
  $entered() {
    if (this.tw) return;
    if (this.target) this.GlobalPosition = NCombatRoom().GetCreatureNode(this.target).GetTopOfHitbox();
    const t = (this.tw = tween().SetParallel(true));
    if (this.target) {
      this.Position = v2(this.Position.X, this.Position.Y + 64);
      t.TweenProperty(this, 'position:y', this.Position.Y - 64, 1).SetEase(EZ.Out).SetTrans(TR.Expo);
    }
    this.imgs.forEach((im, i) => {
      t.TweenProperty(im, 'modulate:a', 1, 0.01).SetDelay(0.2 * i);
      t.TweenProperty(im, 'scale', v2(1.25, 1.25), 1).SetEase(EZ.Out).SetTrans(TR.Cubic).SetDelay(0.2 * i);
      t.TweenProperty(im, 'modulate:a', 0, 1.5).SetDelay(0.2 * i + 0.01);
    });
    t.whenFinished(() => this.QueueFree());
    if (this.$parent instanceof NRestSiteCharacter) { const r = restVfxRoot(); if (r) this.draw(r); }
    else pendingFx.push({ node: this, draw: (r) => this.draw(r) });
  }
  private draw(root: Container) {
    const c = new Container();
    root.addChild(c);
    const sprites = this.imgs.map(() => { const s = new Sprite(Texture.EMPTY); s.anchor.set(0.5); s.blendMode = 'add'; s.visible = false; c.addChild(s); return s; });
    void frameTexture(safe(() => this.relic.PackedIconPath, '')).then((t) => { if (t && !c.destroyed) for (const s of sprites) { s.texture = t; s.visible = true; } });
    $.onFrame(() => {
      if (this.$freed || c.destroyed) { if (!c.destroyed) c.destroy({ children: true }); return false; }
      // on a card it is a child of NCard.Body, which NCardFlyVfx shrinks and darkens
      const g = this.xf(), body = this.$parent?.Body, b = body?.Scale?.X ?? 1, bm = body?.Modulate, m = this.modulate();
      c.position.set(g.x, g.y);
      c.rotation = g.rot;
      c.scale.set(g.sx * b, g.sy * b);
      const ch = (v: number) => Math.round(255 * Math.max(0, Math.min(1, v)));
      const tint = (ch(m[0] * (bm?.R ?? 1)) << 16) | (ch(m[1] * (bm?.G ?? 1)) << 8) | ch(m[2] * (bm?.B ?? 1));
      sprites.forEach((s, i) => {
        const im = this.imgs[i];
        s.position.set(0, -50);
        if (s.visible) s.setSize(100 * im.Scale.X, 100 * im.Scale.Y);
        s.tint = tint;
        s.alpha = 0.627451 * im.Modulate.A * m[3] * (bm?.A ?? 1);
      });
    });
  }
  QueueFree() { this.tw?.Kill(); super.QueueFree(); }
}
NRelicFlashVfx.Create = (relic: any, target: any = null) => (G.TestMode.IsOn ? null : new RelicFlashVfx(relic, target));

/**
 * NRestSiteCharacter (bridge.ts's rest-site stand-ins) as a parent: NRestSiteRoom puts player i's character at (0, 0) in
 * rest_site_room.tscn BgContainer/Character_{i+1} (BgContainer (26, 74) + the slot offsets, scale 0.5); the relic
 * options add their NRelicFlashVfx there.
 */
const REST_SLOTS = [[651, 716], [1265.005, 723], [776, 659], [1118.005, 657]];
Object.assign(NRestSiteCharacter.prototype, {
  AddChild(c: any) { if (c && '$kids' in c) { c.$parent = this; c.$entered?.(); } },
  RemoveChild(c: any) { if (c?.$parent === this) c.$parent = null; },
  xf() {
    const i = Math.max(0, safe(() => N('Rooms.NRestSiteRoom').Instance.Characters.indexOf(this), 0));
    const p = REST_SLOTS[i] ?? REST_SLOTS[0];
    return { x: p[0], y: p[1], rot: 0, sx: 0.5, sy: 0.5 };
  },
});

// ------------------------------------------------------------------ NCardUpgradeVfx
/**
 * vfx_card_upgrade.tscn: a new NCard (child 0) scales 0 → 1 over 0.25 s (Cubic Out) while the star burst (Particle, 30
 * star1 at (1, −1)) goes off; 1.75 s later the card flies to its pile (the deck's trail runs in the top bar).
 */
export class CardUpgradeVfx extends Web(N('Vfx.NCardUpgradeVfx')) {
  private cts = new $.CancellationTokenSource();
  private started = false;
  constructor(private card: any) { super(); }
  $entered() { if (!this.started) { this.started = true; void this.play(); } }
  private async play() {
    const card = this.card, node = NCard.Create(card) as CardNodeView;
    this.AddChild(node);
    this.MoveChild(node, 0);
    node.UpdateVisuals(G.PileType.None, G.CardPreviewMode.Normal);
    emitAt(this, 'scenes/vfx/vfx_card_upgrade.tscn', 'Particle');
    node.Scale = v2(0, 0);
    tween().TweenProperty(node, 'scale', v2(1, 1), 0.25).From(v2(0, 0)).SetEase(EZ.Out).SetTrans(TR.Cubic);
    if (!(await wait(1.75, this.cts))) return;
    await flyToPile(node, card, card.Pile.Type === G.PileType.Deck);
    if (!this.cts.IsCancellationRequested) this.QueueFree();
  }
  QueueFree() { this.cts.Cancel(); super.QueueFree(); }
}
N('Vfx.NCardUpgradeVfx').Create = (card: any) => (G.TestMode.IsOn ? null : new CardUpgradeVfx(card));

// ------------------------------------------------------------------ NCardTransformVfx
/**
 * vfx_card_transform.gdshader on the SubViewport's card render, as an SVG filter on the card's DOM: displaced_uv.x =
 * uv.x + cx·(edgeClampPoint.x − dy²)·boing.x (boing.y stays 0, so no vertical term) through feDisplacementMap over the
 * 512 × 512 viewport, then rgb += brightness.
 */
const VP = 512, EDGE_X = 0.23, DMAX = 0.5 * EDGE_X;
let boingMapUrl: string | null = null;
/** R = 0.5 + D / (2·DMAX) with D = cx·(0.23 − dy²) in viewport UV; G = 0.5 (no y displacement). */
function boingMap() {
  if (boingMapUrl) return boingMapUrl;
  const c = document.createElement('canvas');
  c.width = c.height = VP;
  const g = c.getContext('2d')!, img = g.createImageData(VP, VP), d = img.data;
  for (let y = 0; y < VP; y++) {
    const dy = (y + 0.5) / VP - 0.5;
    for (let x = 0; x < VP; x++) {
      const cx = (x + 0.5) / VP - 0.5, D = cx * (EDGE_X - dy * dy), i = (y * VP + x) * 4;
      d[i] = Math.round(255 * (0.5 + D / (2 * DMAX))); d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return (boingMapUrl = c.toDataURL());
}
let svgHost: SVGSVGElement | null = null, filterIds = 0;
class BoingFilter {
  id = `card-transform-${++filterIds}`;
  private el: SVGFilterElement;
  private disp: Element;
  private mat: Element;
  constructor() {
    const ns = 'http://www.w3.org/2000/svg';
    if (!svgHost) {
      svgHost = document.createElementNS(ns, 'svg');
      svgHost.setAttribute('width', '0'); svgHost.setAttribute('height', '0'); svgHost.style.position = 'absolute';
      document.body.appendChild(svgHost);
    }
    const h = VP / 2;
    this.el = document.createElementNS(ns, 'filter');
    for (const [k, v] of Object.entries({ id: this.id, x: -h, y: -h, width: VP, height: VP, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) this.el.setAttribute(k, String(v));
    this.el.innerHTML = `<feImage href="${boingMap()}" x="${-h}" y="${-h}" width="${VP}" height="${VP}" preserveAspectRatio="none" result="m"/>`
      + '<feDisplacementMap in="SourceGraphic" in2="m" scale="0" xChannelSelector="R" yChannelSelector="G" result="d"/><feColorMatrix in="d" type="matrix"/>';
    this.disp = this.el.querySelector('feDisplacementMap')!;
    this.mat = this.el.querySelector('feColorMatrix')!;
    svgHost.appendChild(this.el);
  }
  set(boingX: number, b: number) {
    this.disp.setAttribute('scale', String(2 * DMAX * VP * boingX));
    this.mat.setAttribute('values', `1 0 0 0 ${b} 0 1 0 0 ${b} 0 0 1 0 ${b} 0 0 0 1 0`);
  }
  remove() { this.el.remove(); }
}
/**
 * NCardTransformVfx (vfx_card_transform.tscn): card_transform sfx; the old card, rendered in the SubViewport and shown by
 * RenderTexture at (−1, 3), scales in over 0.25 s (Cubic Out); 0.75 s later it whitens (brightness → 1, 0.5 s) and
 * squeezes (boing.x → 2, 0.4 s); 0.5 s later it becomes the new card, the miasma burst (Particle) goes off, brightness
 * falls back (0.2 s) and boing.x wobbles −0.75 (0.15 s Quad Out), 0.3, −0.2 (Quad InOut), 0 (0.3 s Back InOut); 0.3 s
 * on the modifying relics flash (also on the card), and 0.5 s later the card flies to its pile. Any wait stops early
 * (the effect is freed) once the card leaves the tree or the new card has no pile.
 */
const NCardTransformVfx = N('Vfx.NCardTransformVfx');
export class CardTransformVfx extends Web(NCardTransformVfx) {
  /** RenderTexture's ShaderMaterial parameters. */
  mat = { Brightness: 0, Boing: v2(0, 0) };
  private tw: any = null;
  private filter: BoingFilter | null = null;
  private started = false;
  constructor(private startCard: any, private endCard: any, private relics: any) { super(); }
  $entered() { if (!this.started) { this.started = true; void this.play(); } }
  private async waitOrInterrupt(s: number, node: CardNodeView) {
    for (let t = 0; t <= s; t += await frame()) if (this.$freed || !node.IsInsideTree() || this.endCard.Pile == null) return false;
    return true;
  }
  private async play() {
    sfx('event:/sfx/ui/cards/card_transform');
    const node = NCard.Create(this.startCard) as CardNodeView;
    this.AddChild(node);
    node.UpdateVisuals(G.PileType.None, G.CardPreviewMode.Normal);
    node.Position = v2(-1, 3);
    node.Scale = v2(0, 0);
    this.shade(node);
    this.tw = tween();
    this.tw.TweenProperty(node, 'scale', v2(1, 1), 0.25).From(v2(0, 0)).SetEase(EZ.Out).SetTrans(TR.Cubic);
    if (!(await this.waitOrInterrupt(0.75, node))) { this.QueueFree(); return; }
    let t = (this.tw = tween().SetParallel(true));
    t.TweenProperty(this.mat, 'brightness', 1, 0.5);
    t.TweenProperty(this.mat, 'boing:x', 2, 0.4);
    if (!(await this.waitOrInterrupt(0.5, node))) { this.QueueFree(); return; }
    node.Model = this.endCard;
    node.UpdateVisuals(G.PileType.None, G.CardPreviewMode.Normal);
    emitAt(this, 'scenes/vfx/vfx_card_transform.tscn', 'Particle');
    t = this.tw = tween().SetParallel(true);
    t.TweenProperty(this.mat, 'brightness', 0, 0.2);
    t.TweenProperty(this.mat, 'boing:x', -0.75, 0.15).SetEase(EZ.Out).SetTrans(TR.Quad);
    await finished(t);
    t = this.tw = tween().SetParallel(true);
    t.TweenProperty(this.mat, 'boing:x', 0.3, 0.2).SetEase(EZ.InOut).SetTrans(TR.Quad);
    await finished(t);
    t = this.tw = tween().SetParallel(true);
    t.TweenProperty(this.mat, 'boing:x', -0.2, 0.25).SetEase(EZ.InOut).SetTrans(TR.Quad);
    await finished(t);
    t = this.tw = tween().SetParallel(true);
    t.TweenProperty(this.mat, 'boing:x', 0, 0.3).SetEase(EZ.InOut).SetTrans(TR.Back);
    if (!(await this.waitOrInterrupt(0.3, node))) { this.QueueFree(); return; }
    for (const r of this.relics ? $.iter(this.relics) : []) { r.Flash(); node.FlashRelicOnCard(r); }
    if (!(await this.waitOrInterrupt(0.5, node))) { this.QueueFree(); return; }
    const deck = this.endCard.Pile?.Type === G.PileType.Deck;
    const target = G.PileTypeExtensions.GetTargetPosition(this.endCard.Pile.Type, node);
    node.Reparent(this);
    node.Position = v2(0, 0);
    const fly = NCardFlyVfx.Create(node, target, false, this.endCard.Owner.Character.TrailPath);
    const parent = deck ? NRun()?.GlobalUi.TopBar.TrailContainer : NCombatRoom()?.CombatVfxContainer;
    if (parent) G.GodotTreeExtensions.AddChildSafely(parent, fly);
    if (fly?.SwooshAwayCompletion) await fly.SwooshAwayCompletion.Task;
    this.QueueFree();
  }
  /** Keeps the card's filter in step with the material while it is not the identity. */
  private shade(node: CardNodeView) {
    $.onFrame(() => {
      if (this.$freed || node.$freed) return false;
      const bx = this.mat.Boing.X, b = this.mat.Brightness;
      if (bx === 0 && b === 0) { node.cssFilter = ''; return; }
      this.filter ??= new BoingFilter();
      this.filter.set(bx, b);
      node.cssFilter = `url("#${this.filter.id}")`; // as CSSOM serializes it (cardlayer compares)
    });
  }
  QueueFree() { this.tw?.Kill(); this.filter?.remove(); this.filter = null; super.QueueFree(); }
}
NCardTransformVfx.Create = (start: any, end: any, relics: any) => (G.TestMode.IsOn ? null : new CardTransformVfx(start, end, relics));
/**
 * PlayAnimOnCardInHand: card_transform sfx; the hand card swells 1 → 1.5 (0.25 s Cubic Out), becomes the new card
 * (its play cancelled) and shrinks back (0.25 s Cubic In) while its holder refreshes.
 */
NCardTransformVfx.PlayAnimOnCardInHand = (node: any, endCard: any) => $.toTask((async () => {
  if (G.TestMode.IsOn) return;
  sfx('event:/sfx/ui/cards/card_transform');
  const t = tween();
  t.TweenProperty(node, 'scale', v2(1.5, 1.5), 0.25).From(v2(1, 1)).SetEase(EZ.Out).SetTrans(TR.Cubic);
  await finished(t);
  const hand = NCombatRoom()?.Ui?.Hand; // NPlayerHand.Instance
  hand?.TryCancelCardPlay(node.Model);
  node.Model = endCard;
  node.UpdateVisuals(endCard.Pile.Type, G.CardPreviewMode.Normal);
  const t2 = tween();
  t2.TweenProperty(node, 'scale', v2(1, 1), 0.25).From(v2(1.5, 1.5)).SetEase(EZ.In).SetTrans(TR.Cubic);
  const h = hand?.GetCardHolder(endCard);
  if (h instanceof HolderView) h.UpdateCard();
  await finished(t2);
})());

// ------------------------------------------------------------------ NCardEnchantVfx
const ENCHANT = 'scenes/vfx/vfx_card_enchant.tscn';
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * vfx_card_enchant.tscn EnchantmentViewport (144 × 108, transparent): the tab (card_enchant_s, keep-aspect-centred in
 * 72 × 54 at (36, 27), hsv 0.25 / 0.4 / 1), its Icon (35 × 35 at (50, 36)) and amount Label (40 × 26 at (62, 54), drawn
 * as NCard's tab label is). Returned as the viewport stores it: 'mix' blending onto transparent black leaves the
 * colours premultiplied.
 */
async function enchantViewport(ench: any): Promise<Uint8ClampedArray | null> {
  const f = atlasFrame('images/atlases/ui_atlas.sprites/card/card_enchant_s.tres');
  const iconPath = safe(() => ench.IconPath, '') || `images/enchantments/${String(safe(() => ench.Id.Entry, '')).toLowerCase()}.png`;
  const [page, icon] = await Promise.all([image(f?.page ?? null), image(imageUrl(iconPath) ?? imageUrl('images/enchantments/missing_enchantment.png'))]);
  if (!f || !page) return null;
  const c = document.createElement('canvas');
  c.width = 144; c.height = 108;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const k = Math.min(72 / f.sw, 54 / f.sh), x0 = 36 + (72 - f.sw * k) / 2, y0 = 27 + (54 - f.sh * k) / 2;
  g.drawImage(page, f.x, f.y, f.w, f.h, x0 + f.ox * k, y0 + f.oy * k, f.w * k, f.h * k);
  const tab = g.getImageData(0, 0, 144, 108), d = tab.data, m = hsvMatrix(0.25, 0.4, 1);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    d[i] = m[0][0] * r + m[0][1] * gg + m[0][2] * b; d[i + 1] = m[1][0] * r + m[1][1] * gg + m[1][2] * b; d[i + 2] = m[2][0] * r + m[2][1] * gg + m[2][2] * b;
  }
  g.putImageData(tab, 0, 0);
  if (icon) g.drawImage(icon, 50, 36, 35, 35);
  if (safe(() => ench.ShowAmount, false)) {
    // .card-ench-amt: Kreon bold 16, letter spacing 1, outline #090F1C (outline_size 8), 25 % shadow at (1, 1)
    await document.fonts.load('700 16px Kreon').catch(() => null);
    const t = document.createElement('canvas');
    t.width = 144; t.height = 108;
    const tg = t.getContext('2d')!, s = String(safe(() => ench.DisplayAmount, ''));
    tg.font = "700 16px 'Kreon'";
    tg.letterSpacing = '1px';
    tg.textAlign = 'center'; tg.textBaseline = 'middle'; tg.lineJoin = 'round';
    tg.lineWidth = 4; tg.strokeStyle = '#090F1C'; tg.strokeText(s, 82, 67);
    tg.fillStyle = 'rgb(255, 246, 226)'; tg.fillText(s, 82, 67);
    g.filter = 'drop-shadow(1px 1px 0 rgba(0, 0, 0, 0.25))';
    g.drawImage(t, 0, 0);
    g.filter = 'none';
  }
  const out = g.getImageData(0, 0, 144, 108).data;
  for (let i = 0; i < out.length; i += 4) { const a = out[i + 3] / 255; out[i] *= a; out[i + 1] *= a; out[i + 2] *= a; }
  return out;
}
/** enchantment_tab_appear.gdshader over the viewport texture (linear filtering; only uv.y is displaced). */
function paintAppear(cv: HTMLCanvasElement, src: Uint8ClampedArray, progress: number) {
  const g = cv.getContext('2d')!, img = g.createImageData(144, 108), o = img.data, W = 144, H = 108;
  const tex = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, s1 = smooth(progress, progress + 0.2, u);
      const vv = v + ((v - 0.5) * 0.75 + 0.5 - v) * s1;
      const fy = Math.min(H - 1, Math.max(0, vv * H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), w = fy - y0;
      for (let c = 0; c < 4; c++) tex[c] = (src[(y0 * W + x) * 4 + c] * (1 - w) + src[(y1 * W + x) * 4 + c] * w) / 255;
      const s2 = smooth(progress + 0.2, progress + 0.25, u), add = [1, 0.75, 0.9], i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) o[i + c] = 255 * Math.min(1, (tex[c] + add[c] * s1) * (1 - s2) + add[c] * s2);
      o[i + 3] = 255 * Math.min(1, (tex[3] + (1 - tex[3]) * s1) * (1 - s2) * tex[3]);
    }
  }
  g.putImageData(img, 0, 0);
}
/**
 * NCardEnchantVfx: a new NCard (child 0) with its enchantment tab hidden and EnchantmentVfxOverride showing the
 * viewport through enchantment_tab_appear (progress 0 → 1 over 1 s, Quad InOut; enchant_shimmer sfx); at 0.2 s the
 * EnchantmentAppearSparkles start and slide 72 px right over 0.4 s. A second later the card flies to its pile (the
 * trail in the top bar), or shrinks away over 0.15 s when it has none.
 */
export class CardEnchantVfx extends Web(N('Vfx.NCardEnchantVfx')) {
  /** EnchantmentVfxOverride's ShaderMaterial. */
  mat = { Progress: 0 };
  sparkles = { Position: v2(-158, -93) };
  private card: CardNodeView | null = null;
  private tw: any = null;
  private cts: any = null;
  constructor(private model: any) { super(); }
  $entered() {
    if (this.card) return;
    const node = (this.card = NCard.Create(this.model) as CardNodeView);
    this.AddChild(node);
    this.MoveChild(node, 0);
    node.UpdateVisuals(G.PileType.None, G.CardPreviewMode.Normal);
    node.EnchantmentTab.Visible = false;
    node.EnchantmentVfxOverride.Visible = true;
    invalidate();
    void enchantViewport(this.model.Enchantment).then((src) => {
      if (!src) return;
      let last: HTMLCanvasElement | null = null, lastP = -1;
      $.onFrame(() => {
        if (node.$freed) return false;
        const cv = node.EnchantmentVfxOverride.canvas, p = this.mat.Progress;
        if (cv && (cv !== last || p !== lastP)) { paintAppear(cv, src, p); last = cv; lastP = p; }
      });
    });
    void this.play();
  }
  private async play() {
    this.cts = new $.CancellationTokenSource();
    this.mat.Progress = 0;
    const t = (this.tw = tween());
    sfx('event:/sfx/ui/enchant_shimmer');
    t.TweenProperty(this.mat, 'progress', 1, 1).SetEase(EZ.InOut).SetTrans(TR.Quad);
    t.Parallel().TweenCallback(() => this.emitSparkles()).SetDelay(0.2);
    t.Parallel().TweenProperty(this.sparkles, 'position:x', this.sparkles.Position.X + 72, 0.4).SetDelay(0.2);
    await finished(t);
    if (!(await wait(1, this.cts))) return;
    const node = this.card!, model = node.Model;
    if (node.IsInsideTree() && model.Pile == null) {
      const t2 = (this.tw = tween());
      t2.TweenProperty(this, 'scale', v2(0, 0), 0.15);
      await finished(t2);
    } else if (node.IsInsideTree()) {
      const fly = NCardFlyVfx.Create(node, G.PileTypeExtensions.GetTargetPosition(model.Pile.Type, node), false, model.Owner.Character.TrailPath);
      const tc = NRun()?.GlobalUi.TopBar.TrailContainer;
      if (tc) G.GodotTreeExtensions.AddChildSafely(tc, fly);
      if (fly?.SwooshAwayCompletion) await fly.SwooshAwayCompletion.Task;
    }
    this.QueueFree();
  }
  /** card_sparkles_vfx (20, one shot, explosiveness 0.9) in global space, emitted wherever the moving emitter is. */
  private emitSparkles() {
    pendingFx.push({ node: this, draw: (root) => void loadScene(ENCHANT).then((s) => {
      const it = s?.items.find((x: any) => x.p === 'EnchantmentAppearSparkles');
      if (!it || root.destroyed) return;
      const sp = followParticles(it, () => { const g = this.xf(); return [g.x + this.sparkles.Position.X * g.sx, g.y + this.sparkles.Position.Y * g.sy, 0, g.sx]; });
      root.addChild(sp.view);
      setTimeout(() => { if (!sp.view.destroyed) sp.view.destroy({ children: true }); }, (it.life + 0.5) * 1000);
    }) });
  }
  QueueFree() { this.tw?.Kill(); this.cts?.Cancel(); super.QueueFree(); }
}
N('Vfx.NCardEnchantVfx').Create = (card: any) => (G.TestMode.IsOn || !G.LocalContext.IsMine$CardModel(card) ? null : new CardEnchantVfx(card));

// ------------------------------------------------------------------ NGainEpochVfx
/**
 * vfx_gain_epoch.tscn on NGame (above everything): a Control at the left edge, vertically centred; EpochContainer (scale
 * 0.75) holds the "Epoch Discovered" label, the card-back shadow, the portrait (hsv 1 / 0 / 0.5) and the chains. After
 * 3 s per effect already showing, the container (rotated −30°) swings from x −151 to 164 with the rotation to 0
 * (0.5 s Back Out), holds 1.5 s, and the whole effect fades over 1 s.
 */
const NGainEpochVfx = N('Vfx.NGainEpochVfx');
export class GainEpochVfx extends Web(NGainEpochVfx) {
  static count = 0;
  epoch = { Position: v2(-151, 0), Rotation: 0 };
  private host: HTMLDivElement | null = null;
  private tw: any = null;
  constructor(private model: any) { super(); }
  $entered() {
    if (this.host) return;
    const host = (this.host = document.createElement('div'));
    host.className = 'viewport';
    host.style.cssText = 'pointer-events: none; z-index: 160;';
    const px = (l: number, t: number, w: number, h: number) => `position: absolute; left: ${l}px; top: ${t}px; width: ${w}px; height: ${h}px;`;
    const portrait = atlasFrame(safe(() => this.model.PackedPortraitPath, ''));
    const ps = Object.entries(frameStyle(portrait, 324, 200)).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v};`).join(' ');
    const text = safe(() => new G.LocString().$ctor_LocString('vfx', 'EPOCH_GAIN').GetRawText(), '');
    host.innerHTML = `<div class="stage-root" style="background: transparent; pointer-events: none;"><div class="gev-root" style="position: absolute; left: 0; top: 540px;">
      <div class="gev-epoch" style="position: absolute; left: 0; top: 0; transform-origin: 0 0;">
        <div class="gev-label" style="${px(-160, -165, 324, 57)} display: flex; align-items: flex-end; justify-content: center; white-space: nowrap;
          font: 700 28px 'Kreon', var(--font); letter-spacing: 1px; color: rgb(232, 220, 190); -webkit-text-stroke: 6px rgb(48, 43, 22); paint-order: stroke fill;"></div>
        <img style="${px(-151.333, -89.3333, 324, 200)} filter: brightness(0); opacity: 0.251;" src="${imageUrl('images/timeline/epoch_card_back.png') ?? ''}">
        <div style="position: absolute; left: -162px; top: -100px; ${ps} filter: ${hsvFilter(1, 0, 0.5)};"></div>
        <img style="${px(-181.44, -109.33325, 362.88, 224)} object-fit: contain;" src="${imageUrl('images/packed/timeline/epoch_slot_locked_small.png') ?? ''}">
      </div></div></div>`;
    (host.querySelector('.gev-label') as HTMLElement).textContent = text;
    document.body.appendChild(host);
    const root = host.querySelector('.gev-root') as HTMLElement, ep = host.querySelector('.gev-epoch') as HTMLElement;
    $.onFrame(() => {
      if (this.$freed) return false;
      const e = this.epoch;
      ep.style.transform = `translate(${e.Position.X}px, ${e.Position.Y}px) rotate(${e.Rotation}rad) scale(0.75)`;
      root.style.opacity = String(this.Modulate.A);
    });
    void this.animate();
  }
  private async animate() {
    if (GainEpochVfx.count > 1) await new Promise((r) => setTimeout(r, 3000 * (GainEpochVfx.count - 1)));
    if (this.$freed) return;
    this.epoch.Rotation = (-30 * Math.PI) / 180;
    const t = (this.tw = tween().SetParallel(true));
    t.TweenProperty(this.epoch, 'position:x', 164, 0.5).SetEase(EZ.Out).SetTrans(TR.Back);
    t.TweenProperty(this.epoch, 'rotation', 0, 0.5).SetEase(EZ.Out).SetTrans(TR.Back);
    t.Chain();
    t.TweenInterval(1.5);
    t.Chain();
    t.TweenProperty(this, 'modulate:a', 0, 1);
    await finished(t);
    this.QueueFree();
  }
  QueueFree() {
    if (this.$freed) return;
    this.tw?.Kill();
    this.host?.remove();
    GainEpochVfx.count--;
    super.QueueFree();
  }
}
NGainEpochVfx.Create = (model: any) => {
  if (G.TestMode.IsOn) return null;
  GainEpochVfx.count++;
  return new GainEpochVfx(model);
};
/** NGame (bridge.ts GameView) as a parent: the epoch effect enters the tree. */
const NGame = N('NGame'), gameAdd = NGame.prototype.AddChild;
NGame.prototype.AddChild = function (c: any, ...a: any[]) {
  if (!(c instanceof GainEpochVfx)) return gameAdd?.call(this, c, ...a);
  c.$parent = this;
  c.$entered();
};
