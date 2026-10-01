// NCard.ActivateRewardScreenGlow on the card reward / choose-a-card screens: NCardRareGlow / NCardUncommonGlow
// (rare_glow_vfx / uncommon_glow_vfx, additive, local coordinates) behind each card and, for rares, the CardSparkles
// (card_sparkles_vfx, global coordinates) over it. They follow their holder's centre and scale (fly-out, hover) and fade
// in with its black → white entrance; each glow's own script then eases its alpha to 0.9 (and a rare's scale to 0.92×)
// over 1 s (Cubic In, a rare after a random 0–0.2 s). Both are children of the card's Body: a picked card keeps them on
// its NCardFlyVfx flight, where the Body shrinks and darkens to black over the first third (additive → gone); the
// canvas outlives the closing screen for that long, under the global card layer.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'preact/hooks';
import { Container } from 'pixi.js';
import { G, $ } from '../game';
import { overlayApp } from '../render/cardfx';
import { loadScene, particleItem, followParticles } from '../render/scene';
import { logicalRect } from './tooltip';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const cubicIn = (t: number) => t * t * t;

/**
 * `slots()`: the card-slot elements in card order; `fade(i)`: that card's entrance brightness (fx[i].V); `node(card)`: a
 * picked card's flying NCard node.
 */
export function RewardGlows({ cards, slots, fade, layer, node }: {
  cards: any[]; slots: () => (HTMLElement | null)[]; fade: (i: number) => number; layer: 'glow' | 'over'; node?: (card: any) => any;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false, lingering: HTMLDivElement | null = null, app: any = null;
    const root = new Container(), stops: (() => void)[] = [];
    const t0 = performance.now();
    /** The card's centre, scale, rotation and Body brightness: its slot, else its node in flight while not yet black. */
    const place = (i: number) => {
      const el = !lingering && slots()[i]?.isConnected ? slots()[i]!.querySelector('.gh-card, .card') : null;
      const r = el ? logicalRect(el) : null;
      if (r) return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2, s: r[2] / 300, rot: 0, v: 1 };
      const n = cards[i] && node?.(cards[i]), v = n && !n.$freed ? safe(() => n.Body.Modulate.R, 0) : 0;
      return v > 0 ? { x: n.GlobalPosition.X, y: n.GlobalPosition.Y, s: n.Scale.X * n.Body.Scale.X, rot: n.Rotation, v } : null;
    };
    const flying = () => cards.some((_, i) => !!place(i));
    const teardown = () => {
      dead = true;
      for (const s of stops) s();
      root.destroy({ children: true });
      if (app) { app.render(); if (app.canvas.parentElement === (lingering ?? host.current)) app.canvas.remove(); }
      lingering?.remove();
    };
    void overlayApp(`reward-${layer}`).then(async (a) => {
      if (dead) return;
      app = a;
      a.stage.removeChildren();
      a.stage.addChild(root);
      host.current?.appendChild(a.canvas);
      a.canvas.classList.add('reward-glow-canvas');
      const [rare, unc, spark] = await Promise.all(['rare_glow_vfx', 'uncommon_glow_vfx', 'card_sparkles_vfx'].map((n) => loadScene(`scenes/vfx/${n}.tscn`)));
      if (dead) return;
      const ticks: (() => void)[] = [];
      cards.forEach((c, i) => {
        const r = safe(() => c.Rarity, -1), isRare = r === G.CardRarity.Rare, isUnc = r === G.CardRarity.Uncommon;
        if (layer === 'glow' && (isRare || isUnc)) {
          const sc = isRare ? rare : unc, it = sc?.items[0];
          if (!sc || !it) return;
          const g = new Container(), delay = isRare ? Math.random() * 0.2 : 0;
          g.addChild(particleItem({ ...it, m: [1, 0, 0, 1, 0, 0] }, true));
          root.addChild(g);
          ticks.push(() => {
            const p = place(i);
            g.visible = !!p;
            if (!p) return;
            const k = cubicIn(Math.min(Math.max((performance.now() - t0) / 1000 - delay, 0), 1));
            const ks = isRare ? 1 - 0.08 * k : 1;
            g.position.set(p.x, p.y);
            g.rotation = p.rot;
            g.scale.set(p.s * sc.root.scale[0] * ks, p.s * sc.root.scale[1] * ks);
            g.alpha = fade(i) * (1 - 0.1 * k) * p.v; // additive: the Body's modulate darkening = less light
          });
        }
        if (layer === 'over' && isRare && spark?.items[0]) {
          let last = place(i);
          const f = followParticles(spark.items[0], () => { const p = place(i) ?? last; last = p; return p ? [p.x, p.y, p.rot, p.s] : [-9999, -9999, 0, 1]; });
          root.addChild(f.view);
          stops.push(f.stop);
          ticks.push(() => { f.view.alpha = fade(i) * (place(i)?.v ?? 0); });
        }
      });
      $.onFrame(() => {
        if (dead) return false;
        if (lingering && !flying()) { teardown(); return false; }
        for (const t of ticks) t();
        a.render();
        return true;
      });
    });
    return () => {
      // the screen closes while a picked card is still in the first third of its flight: keep drawing just under the
      // global card layer (NGlobalUi's TrailContainer) until its Body has gone black
      const cardsLayer = document.querySelector('.global-cards');
      if (app && !dead && cardsLayer && flying()) {
        lingering = document.createElement('div');
        lingering.className = 'reward-glow-host';
        cardsLayer.before(lingering);
        lingering.appendChild(app.canvas);
        return;
      }
      if (!app) dead = true; // still loading: the load sees `dead` and never draws
      else teardown();
    };
    // the parent keys this by the options' generation: the cards are fixed for its lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div class="reward-glow-host" ref={host} />;
}
