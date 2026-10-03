// NCrystalSphereScreen (events/custom/crystal_sphere/crystal_sphere_screen.tscn): the fortune teller's divination board.
// Bg (2560 × 1200 at (−320, −48), 1.04 about its centre) holds the Sphere (scry_reveal shader), the Items under the
// ScryMask fog (the same shader, per-cell fades), the Border and the 11 × 11 Cells. The Pixi side (bg, sphere, items,
// fog) draws on its own canvas; the border, cells, buttons, texts and dialogue are DOM above it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Application, ColorMatrixFilter, Container, Matrix, Sprite, Texture } from 'pixi.js';
import { G, list } from '../game';
import { imageUrl } from '../assets';
import { loc, locv } from '../i18n';
import { playOneShot } from '../audio';
import { hsvFilter, hsvMatrix, matHsv, tint } from '../filters';
import { loadShader, QuadBatch } from '../render/canvas';
import { sceneTexture } from '../render/scene';
import { RichText } from './richtext';
import { ProceedButton } from './buttons';
import { Dialogue } from './shop';
import type { CrystalSphereView } from '../bridge';
import { renderResolution } from '../render/quality';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Bg's transform, and the Sphere's rect inside it (anchors 0.424 / 0.562–0.565 of 2560 × 1200 plus offsets). */
const BG = new Matrix().translate(-1280, -600).scale(1.04, 1.04).translate(-320 + 1280, -48 + 600);
const SX = 690.577, SY = 277.885, SW = 792;
const CELL = 57, ORIGIN = -(CELL * 11) / 2;

let appP: Promise<Application> | null = null;
const sphereApp = () => (appP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, resolution: renderResolution(), autoDensity: true });
  a.canvas.classList.add('csph-canvas');
  return a;
})());

// ShaderMaterial_r1hel (Sphere) and ShaderMaterial_r3co4 (ScryMask)
const rgb = (c: number[]) => c.flatMap((x, i) => (i % 4 === 3 ? [] : [x]));
const SPHERE = {
  borderColor: [0.87451, 0.878431, 0.992157],
  colors: rgb([0.12549, 0.0431373, 0.411765, 1, 0.164706, 0.0980392, 0.745098, 1, 0.305882, 0.243137, 0.882353, 1, 0.313726, 0.286275, 0.929412, 1, 0.396078, 0.337255, 0.972549, 1, 0.541176, 0.556863, 0.980392, 1, 0.839216, 0.870588, 0.980392, 1, 0.952941, 1, 1, 1]),
  circleData: [0, 1.04, 0.065, 0.315, 0.495, 0.3, 0.2, 0.42, 0.57, 0.3, 0.1, 0.445, 0.615, 0.3, 0.1, 0.415, 0.625, 0.3, 0.5, 0.255, 0.775, 0.2, 0.1, 0.285, 0.785, 0.2, 0.1, 0.1, 0.835, 0.185, 0.1, 0.1],
  circles: 8, outerCircle: 4, time: 0, uvMargin: 0.145,
};
const MASK = {
  borderColor: [0.870588, 0.878431, 1],
  colors: rgb([0.541176, 0.552941, 0.980392, 1, 0.25098, 0.231373, 0.854902, 1, 0.541176, 0.552941, 0.980392, 1, 0.313726, 0.286275, 0.929412, 1]),
  circleData: [0.045, 1.435, 0.325, 0.56, 0.325, 0.295, 0.265, 0.075, 0.555, 0.94, 0.09, 0.52],
  circles: 3, outerCircle: -1, time: 0, uvMargin: 0.145,
};
const hsvColorMatrix = (hsv: number[] | null) => {
  if (!hsv) return [];
  const m = hsvMatrix(hsv[0], hsv[1], hsv[2]);
  const f = new ColorMatrixFilter();
  f.matrix = [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0] as any;
  return [f];
};
const rect = (b: QuadBatch, x: number, y: number, w: number, h: number) => { b.quad(0, [x, y, x + w, y, x + w, y + h, x, y + h], 0, 0, 1, 1, 1, 1, 1, 1); b.flush(); };

/** Bg, Sphere, Items (under the fog) and ScryMask on the sphere canvas, painted from the view each frame. */
async function buildSphere(v: CrystalSphereView, stage: Container) {
  const [scry, shine, bgTex, n1, n2] = await Promise.all([
    loadShader('shaders/scry_reveal.gdshader'), loadShader('shaders/crystal_sphere_item.gdshader'),
    sceneTexture('images/events/crystal_sphere/crystal_sphere_minigame_bg.png'), sceneTexture('images/vfx/crystal_sphere_noise.png'), sceneTexture('images/vfx/scry_voronoi_noise.png'),
  ]);
  const root = new Container();
  root.setFromMatrix(BG);
  if (bgTex) { const bg = new Sprite(bgTex); bg.width = 2560; bg.height = 1200; root.addChild(bg); }
  const noise = { noiseTex1: n1 ?? Texture.WHITE, noiseTex2: n2 ?? Texture.WHITE };
  let fog: QuadBatch | null = null;
  if (scry) {
    const sphere = new QuadBatch(1, scry, Texture.WHITE, { ...noise, ...SPHERE });
    rect(sphere, SX, SY, SW, SW);
    root.addChild(sphere);
  }
  // Items: centred in the sphere + (6, 7); each at ORIGIN + 57 · position, item.Size · 57 big
  const items = new Container();
  items.position.set(SX + SW / 2 + 6, SY + SW / 2 + 7);
  const shines: [any, QuadBatch, Container | null][] = [];
  for (const it of list(v.game.Items)) {
    const w = it.Size.X * CELL, h = it.Size.Y * CELL;
    const node = new Container();
    node.position.set(ORIGIN + CELL * it.Position.X, ORIGIN + CELL * it.Position.Y);
    items.addChild(node);
    const layer = async (path: string, x: number, y: number, lw: number, lh: number, withShine: boolean, hsv: number[] | null) => {
      const t = await sceneTexture(path);
      if (!t) return null;
      if (withShine && shine) {
        const b = new QuadBatch(1, shine, t, { val: 0 });
        rect(b, 0, 0, lw, lh);
        const c = new Container();
        c.position.set(x, y);
        c.addChild(b);
        return { c, b };
      }
      const sp = new Sprite(t);
      sp.position.set(x, y); sp.width = lw; sp.height = lh;
      sp.filters = hsvColorMatrix(hsv);
      return { c: sp, b: null };
    };
    if (G.CrystalSphereCardReward && it instanceof G.CrystalSphereCardReward) {
      // Card: the outline (shine), the back in the pool's frame material and the banner in the rarity's
      const frame = safe(() => matHsv(it._owner.Character.CardPool.FrameMaterialPath), null);
      const banner = safe(() => matHsv(it.BannerMaterialPath), null);
      const parts = await Promise.all([
        layer('images/events/crystal_sphere/crystal_sphere_card_outline.png', 0, 0, w, h, true, null),
        layer('images/events/crystal_sphere/crystal_sphere_card_back.png', 0, 0, w, h, false, frame),
        layer('images/events/crystal_sphere/crystal_sphere_card_banner.png', 0, 0, w, h, false, banner),
      ]);
      for (const p of parts) if (p) node.addChild(p.c);
      if (parts[0]?.b) shines.push([it, parts[0].b, null]);
    } else {
      // Icon: inset (6, 4, −4, −6), bumped about the item's centre
      const p = await layer(safe(() => it.TexturePath, ''), 0, 0, w - 10, h - 10, true, null);
      if (p) {
        const pivot = new Container();
        pivot.position.set(6 + w / 2, 4 + h / 2);
        p.c.position.set(-w / 2, -h / 2);
        pivot.addChild(p.c);
        node.addChild(pivot);
        if (p.b) shines.push([it, p.b, pivot]);
      }
    }
  }
  root.addChild(items);
  if (scry) {
    fog = new QuadBatch(1, scry, Texture.WHITE, { ...noise, ...MASK, gridFadeParams: Array.from(v.fades) });
    rect(fog, SX - 8.654, SY - 5.770, SW + 8.654, SW + 5.770 + 5);
    root.addChild(fog);
  }
  stage.addChild(root);
  v.paint = () => {
    items.visible = v.itemsShown;
    for (const [it, b, pivot] of shines) {
      const r = v.items.get(it);
      if (!r) continue;
      b.group.uniforms.val = r.Val; b.group.update();
      pivot?.scale.set(r.Scale);
    }
    if (fog) { fog.group.uniforms.time = v.time; (fog.group.uniforms.gridFadeParams as Float32Array).set(v.fades); fog.group.update(); }
  };
  return root;
}

export function CrystalSphereScreen({ v }: { v: CrystalSphereView }) {
  const host = useRef<HTMLDivElement>(null), rootEl = useRef<HTMLDivElement>(null);
  const cellEls = useRef(new Map<any, HTMLDivElement>());
  useEffect(() => {
    let dead = false, built: Container | null = null;
    void sphereApp().then(async (a) => {
      if (dead) return;
      a.stage.removeChildren();
      host.current?.appendChild(a.canvas);
      a.ticker.start();
      built = await buildSphere(v, a.stage);
      if (dead) built.destroy({ children: true });
    });
    // the screen fade and the cells' highlight tweens (the Pixi side is painted by buildSphere's v.paint)
    const tick = () => {
      if (rootEl.current) rootEl.current.style.opacity = String(v.fx.A);
      for (const [cell, el] of cellEls.current) el.style.opacity = String(v.cellA.get(cell)?.A ?? 0);
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      v.paint = undefined;
      built?.destroy({ children: true });
      void sphereApp().then((a) => { a.ticker.stop(); if (a.canvas.parentElement === host.current) a.canvas.remove(); });
    };
  }, [v]);
  const g = v.game;
  const cols: any[][] = safe(() => Array.from(g.cells as any[], (col: any) => Array.from(col as any[])), []);
  const finished = v.done;
  return (
    <div class="crystal-sphere" ref={rootEl} style={{ opacity: v.fx.A }}>
      <div class="csph-host" ref={host} />
      <div class="csph-bg">
        <img class="csph-border" src={imageUrl('images/vfx/crystal_sphere_outline.png') ?? ''} />
        <div class="csph-cells" onPointerLeave={() => v.hover(null)}>
          {cols.flatMap((col, x) => col.map((c: any, y: number) => (
            <div class={'csph-cell' + (c.IsHidden ? '' : ' open')} style={{ left: `${ORIGIN + CELL * x}px`, top: `${ORIGIN + CELL * y}px` }}
              onPointerEnter={() => c.IsHidden && v.hover(c)} onPointerLeave={() => v.hover(null)}
              onPointerUp={(e) => { if (e.button === 0 && c.IsHidden) v.click(c); }}>
              <div class="csph-cell-fx" ref={(el) => { if (el) cellEls.current.set(c, el); else cellEls.current.delete(c); }} style={{ opacity: v.cellA.get(c)?.A ?? 0 }}>
                <img src={imageUrl('images/events/crystal_sphere/crystal_ball_single_square_ui.png') ?? ''} />
                {c.IsHovered && <div class="csph-hovered" />}
              </div>
            </div>
          )))}
        </div>
      </div>
      {!finished && (
        <>
          <div class="csph-left"><RichText text={locv('events', 'CRYSTAL_SPHERE.minigame.divinationsRemain', { Count: g.DivinationCount })} /></div>
          <DivinationButton y={237.96} big active={v.big} onClick={() => v.tool(true)} />
          <DivinationButton y={389.96} active={!v.big} onClick={() => v.tool(false)} />
          <div class="csph-instructions">
            <div class="csi-bg" style={{ borderImageSource: `url(${imageUrl('images/ui/tiny_nine_patch.png')})`, filter: tint(0.0157, 0, 0.157, 0.753) }} />
            <div class="csi-title"><RichText text={`[center]${loc('events', 'CRYSTAL_SPHERE.minigame.instructions.title')}[/center]`} /></div>
            <div class="csi-desc"><RichText text={loc('events', 'CRYSTAL_SPHERE.minigame.instructions.description')} /></div>
          </div>
        </>
      )}
      {finished && <ProceedButton enabled={v.proceedOn} onClick={() => v.proceed()} />}
      <Dialogue line={v.line} y={243} hsv={[0.25, 0.75, 1]} hold={1.5} cls="csph-dialogue" />
    </div>
  );
}

/**
 * NDivinationButton (395 × 128): divine_button (395 × 154) in hsv s 0.9 v 0.8, its additive orange outline while it is
 * the active tool; focus → s / v 1 (0.05 s), unfocus back over 0.5 s (Expo Out), neither while active. The label
 * (Kreon Bold 24, gold) and the size icon (83 × 83).
 */
function DivinationButton({ y, big, active, onClick }: { y: number; big?: boolean; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const lit = hover && !active;
  return (
    <div class="csph-divine" style={{ top: `${y}px` }}
      onPointerEnter={() => { if (active) return; setHover(true); playOneShot('event:/sfx/ui/clicks/ui_hover'); }}
      onPointerLeave={() => { setHover(false); setDown(false); }}
      onPointerDown={(e) => { if (e.button === 0) { setDown(true); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && down) { setDown(false); setHover(false); onClick(); } }}>
      <img class="csd-img" src={imageUrl('images/events/crystal_sphere/divine_button.png') ?? ''}
        style={{ filter: `${hsvFilter(1, 1, 1)} saturate(${lit ? 1 : 0.9}) brightness(${lit ? 1 : 0.8})`, transition: lit ? `filter .05s ${EXPO_OUT}` : `filter .5s ${EXPO_OUT}` }} />
      {active && <img class="csd-outline" src={imageUrl('images/events/crystal_sphere/divine_button_outline.png') ?? ''} style={{ filter: tint(1, 0.667, 0) }} />}
      <div class="csd-label">{loc('events', `CRYSTAL_SPHERE.button.DIVINATION_LABEL_${big ? 'BIG' : 'SMALL'}`)}</div>
      <img class="csd-icon" src={imageUrl(`images/events/crystal_sphere/${big ? 'big' : 'small'}_divination_icon.png`) ?? ''} />
    </div>
  );
}
