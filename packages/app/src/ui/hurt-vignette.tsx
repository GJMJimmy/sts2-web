// PlayerHurtVignetteHelper / NLowHpBorderVfx (vfx/ui/vfx_low_hp_border.tscn): a full-screen ColorRect over the global UI
// (self_modulate α 0.753) with vfx_ui_low_hp_border_shader — a dark-red noisy border. Play() runs 1 s: the alpha
// multiplier follows its curve (full until 0.255, then out) and the colour its gradient; a replay restarts the timer.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'preact/hooks';
import { Application, Texture } from 'pixi.js';
import { $ } from '../game';
import { loadShader, QuadBatch } from '../render/canvas';
import { sceneTexture } from '../render/scene';
import { curveAt } from '../render/cardfx';

const ALPHA = [[0.2551724, 1, 0, 0], [1, 0.002529502, 0, 0]];
const C0 = [0.7372549, 0, 0], C1 = [0.32156864, 0.02745098, 0.02745098];
const state = { playing: false, t: 0, offset: [0, 0], start: null as null | (() => void) };

let appP: Promise<Application> | null = null;
const vignetteApp = () => (appP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, antialias: false, autoStart: false, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
  a.canvas.classList.add('hurt-vignette');
  return a;
})());

/** NLowHpBorderVfx.Play. */
function play() {
  if (state.playing) { state.t = 0; return; }
  state.playing = true;
  state.t = 0;
  state.offset = [Math.random(), Math.random()];
  state.start?.();
}
$.ext('MegaCrit.Sts2.Core.Nodes.Vfx.PlayerHurtVignetteHelper').Play = play;

export function HurtVignette() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false, quad: QuadBatch | null = null, app: Application | null = null;
    void Promise.all([vignetteApp(), loadShader('shaders/vfx/ui/vfx_ui_low_hp_border_shader.gdshader'), sceneTexture('images/vfx/noise/vfx_noise_1.png')]).then(([a, sh, noise]) => {
      if (dead || !sh) return;
      app = a;
      a.stage.removeChildren();
      host.current?.appendChild(a.canvas);
      quad = new QuadBatch(1, sh, Texture.WHITE, {
        alpha: 1, alpha_multiplier: 0, inner_radius: 0.5, outer_radius: 1.75, noise: noise ?? Texture.WHITE, noise_tiling: [1, 3], noise_panning: [-3, 0],
        noise_initial_offset: [0, 0], noise_additional_offset: 0, smoothstep_factors: [0.1, 0.8], main_color: [...C1, 1],
      });
      quad.quad(0, [0, 0, 1920, 0, 1920, 1080, 0, 1080], 0, 0, 1, 1, 1, 1, 1, 0.7529);
      quad.flush();
      a.stage.addChild(quad);
      a.render();
    });
    // PlaySequence: 1 s, properties from the curve and the gradient at t / 1 s
    state.start = () => $.onFrame((dt: number) => {
      if (dead || !quad || !app) { state.playing = false; return false; }
      const p = Math.min(state.t / 1, 1), g = Math.min(p / 0.75, 1), u = quad.group.uniforms as any;
      u.alpha_multiplier = curveAt(ALPHA, p);
      u.main_color = new Float32Array([C0[0] + (C1[0] - C0[0]) * g, C0[1] + (C1[1] - C0[1]) * g, C0[2] + (C1[2] - C0[2]) * g, 1]);
      u.noise_initial_offset = new Float32Array(state.offset);
      quad.group.update();
      app.render();
      state.t += dt;
      if (p < 1) return true;
      state.playing = false;
      return false;
    });
    return () => {
      dead = true;
      state.start = null;
      quad?.destroy();
      void vignetteApp().then((a) => { a.stage.removeChildren(); a.render(); if (a.canvas.parentElement === host.current) a.canvas.remove(); });
    };
  }, []);
  return <div class="hurt-vignette-host" ref={host} />;
}
