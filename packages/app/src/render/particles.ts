// CPUParticles2D / GPUParticles2D (the ParticleProcessMaterial subset scenes use) simulated on the CPU into a QuadBatch.
// Emitters are static set dressing, so particles live in the emitter's local space. Turbulence, orbit velocity and
// sub-emitters are not simulated.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Texture } from 'pixi.js';
import { QuadBatch, animate, type GodotShader, type ShaderParams } from './canvas';

const rnd = (r: number[]) => r[0] + Math.random() * (r[1] - r[0]);
const DEG = Math.PI / 180;
/** Pre-sampled curve (32 points over [0, 1]) at t. */
function at(c: number[] | undefined, t: number, d = 1) {
  if (!c) return d;
  const x = Math.min(Math.max(t, 0), 1) * (c.length - 1), i = Math.floor(x), f = x - i;
  return i >= c.length - 1 ? c[c.length - 1] : c[i] + (c[i + 1] - c[i]) * f;
}
/**
 * hue_variation (ParticleProcessMaterial rotate_hue / CPUParticles2D): the colour times Godot's hue rotation matrix
 * (GLSL column vectors below) at `a` radians.
 */
function hueRotate(col: number[], a: number) {
  const c = Math.cos(a), s = Math.sin(a), [r, g, b] = col;
  const m = (k0: number, k1: number, k2: number) => k0 + k1 * c + k2 * s;
  col[0] = m(0.299, 0.701, 0.168) * r + m(0.299, -0.299, -0.328) * g + m(0.299, -0.300, 1.250) * b;
  col[1] = m(0.587, -0.587, 0.330) * r + m(0.587, 0.413, 0.035) * g + m(0.587, -0.588, -1.050) * b;
  col[2] = m(0.114, -0.114, -0.497) * r + m(0.114, -0.114, 0.292) * g + m(0.114, 0.886, -0.203) * b;
}
/** Pre-sampled gradient (32 RGBA stops) at t, multiplied into out. */
function rampMul(g: number[] | undefined, t: number, out: number[]) {
  if (!g) return;
  const n = g.length / 4, x = Math.min(Math.max(t, 0), 1) * (n - 1), i = Math.min(Math.floor(x), n - 2), f = x - i;
  for (let k = 0; k < 4; k++) out[k] *= g[i * 4 + k] + (g[(i + 1) * 4 + k] - g[i * 4 + k]) * f;
}

interface Particle { cycle: number; life: number; x: number; y: number; vx: number; vy: number; ang: number; angv: number; scale: number; accel: number; radial: number; damp: number; anim: number; animSpeed: number; init: number[]; hue: number }

export class Emitter {
  batch: QuadBatch;
  private ps: Particle[];
  private t: number;
  private fw: number; private fh: number;
  /** One-shot emitters finish once every particle has died. */
  done = false;
  /** Emitting off: live particles finish their lives, none respawn (CPUParticles2D.Emitting = false). */
  emitting = true;
  /**
   * `follow`: the emitter moves (a card trail's sparks) and its particles live in global space (local_coords off);
   * the batch then sits in an untransformed container.
   */
  constructor(private it: any, tex: Texture, sh: GodotShader, params: ShaderParams, emit: boolean, private follow?: () => number[]) {
    const n = Math.max(1, it.amount | 0);
    this.batch = new QuadBatch(n, sh, tex, params);
    this.fw = (it.tw || tex.width) / (it.hf || 1);
    this.fh = (it.th || tex.height) / (it.vf || 1);
    this.ps = Array.from({ length: n }, () => ({ cycle: -1 }) as Particle);
    // scenes/backgrounds/little_light_script.gd: `var random := randi_range(0, 5)`, `_ready(): set_pre_process_time(random)`
    // ponytail: Godot pre-simulates in 1/30 s steps and overshoots by up to one step; this starts at exactly `random` s
    this.t = it.script === 'scenes/backgrounds/little_light_script.gd' ? Math.floor(Math.random() * 6) : it.pre || 0;
    if (!emit) { this.done = true; this.draw(); return; }
    this.step(0);
    animate((dt) => {
      if (this.batch.destroyed) return false;
      if (this.done) return true;
      this.step(dt * (it.speed || 1));
      return true;
    });
  }
  private spawn(p: Particle) {
    const it = this.it;
    let x = 0, y = 0;
    const a = Math.random() * Math.PI * 2;
    if (it.shape === 1) { const r = it.ext[0] * Math.sqrt(Math.random()); x = Math.cos(a) * r; y = Math.sin(a) * r; }
    else if (it.shape === 2) { x = Math.cos(a) * it.ext[0]; y = Math.sin(a) * it.ext[0]; }
    else if (it.shape === 3) { x = (Math.random() * 2 - 1) * it.ext[0]; y = (Math.random() * 2 - 1) * it.ext[1]; }
    else if (it.shape === 6) { const r = it.ext[1] + (it.ext[0] - it.ext[1]) * Math.sqrt(Math.random()); x = Math.cos(a) * r; y = Math.sin(a) * r; }
    const dir = Math.atan2(it.dir[1], it.dir[0]) + (Math.random() * 2 - 1) * it.spread * DEG;
    const v = rnd(it.vel);
    p.x = x + it.offset[0]; p.y = y + it.offset[1];
    p.vx = Math.cos(dir) * v; p.vy = Math.sin(dir) * v;
    if (this.follow) {
      const [ox, oy, r = 0, s = 1] = this.follow(), c = Math.cos(r), sn = Math.sin(r);
      const lx = p.x * s, ly = p.y * s, vx = p.vx, vy = p.vy;
      p.x = ox + lx * c - ly * sn; p.y = oy + lx * sn + ly * c;
      p.vx = vx * c - vy * sn; p.vy = vx * sn + vy * c;
    }
    p.ang = rnd(it.ang); p.angv = rnd(it.angv); p.scale = rnd(it.scale);
    p.accel = rnd(it.accel); p.radial = rnd(it.radial); p.damp = rnd(it.damp);
    p.anim = rnd(it.animOff); p.animSpeed = rnd(it.animSpeed);
    p.life = it.life * (1 - Math.random() * (it.lifeRand || 0));
    p.init = [1, 1, 1, 1];
    rampMul(it.initRamp, Math.random(), p.init);
    p.hue = it.hue ? 2 * Math.PI * rnd(it.hue) : 0;
  }
  private integrate(p: Particle, dt: number) {
    const it = this.it;
    let ax = it.grav[0], ay = it.grav[1];
    const sp = Math.hypot(p.vx, p.vy);
    if (p.accel && sp > 0) { ax += (p.vx / sp) * p.accel; ay += (p.vy / sp) * p.accel; }
    const d = Math.hypot(p.x, p.y);
    if (p.radial && d > 0) { ax += (p.x / d) * p.radial; ay += (p.y / d) * p.radial; }
    p.vx += ax * dt; p.vy += ay * dt;
    if (p.damp) { const s = Math.hypot(p.vx, p.vy); if (s > 0) { const k = Math.max(0, s - p.damp * dt) / s; p.vx *= k; p.vy *= k; } }
    p.x += p.vx * dt; p.y += p.vy * dt;
    // collision_mode rigid against a floor (a LightOccluder2D edge, emitter-local y): bounce, friction on the slide
    if (it.floor != null && p.y > it.floor && p.vy > 0) { p.y = it.floor; p.vy *= -(it.bounce ?? 0); p.vx *= 1 - (it.friction ?? 0); }
    p.ang += p.angv * dt;
  }
  /** Advance to time t + dt: slot i starts at i/N·life·(1 − explosiveness) and restarts every lifetime. */
  private step(dt: number) {
    const it = this.it, n = this.ps.length, L = it.life || 1;
    this.t += dt;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      const p = this.ps[i];
      const rel = this.t - (i / n) * L * (1 - (it.explo || 0));
      if (rel < 0) { alive++; continue; }
      const cycle = Math.floor(rel / L);
      if (it.oneShot && cycle > 0) { p.cycle = -2; continue; }
      if (!this.emitting && cycle !== p.cycle) { p.cycle = -2; continue; }
      alive++;
      const age = rel - cycle * L;
      if (cycle !== p.cycle) {
        // (re)spawn and catch up to the particle's current age (preprocess, or frames skipped while hidden)
        p.cycle = cycle;
        this.spawn(p);
        const steps = Math.min(60, Math.ceil(age * 30));
        for (let s = 0; s < steps; s++) this.integrate(p, age / steps);
      } else this.integrate(p, dt);
    }
    if (it.oneShot && !alive) this.done = true;
    this.draw();
  }
  private draw() {
    const it = this.it, b = this.batch, n = this.ps.length, L = it.life || 1;
    const hf = it.hf || 1, vf = it.vf || 1, frames = hf * vf;
    const base = [1, 1, 1, 1];
    if (it.tint) for (let k = 0; k < 4; k++) base[k] *= it.tint[k];
    if (it.color) for (let k = 0; k < 4; k++) base[k] *= it.color[k];
    const col = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const p = this.ps[i];
      const rel = this.t - (i / n) * L * (1 - (it.explo || 0));
      const age = rel - Math.max(0, p.cycle) * L;
      if (p.cycle < 0 || rel < 0 || age >= p.life || this.done) { b.hide(i); continue; }
      const tv = age / p.life;
      const sx = p.scale * at(it.scx, tv), sy = p.scale * at(it.scy ?? it.scx, tv);
      // GPU: (colour · initial ramp · ramp · alpha curve) hue-rotated; CPU: (colour · ramp) hue-rotated, then · initial ramp
      for (let k = 0; k < 4; k++) col[k] = base[k];
      rampMul(it.ramp, tv, col);
      if (it.hueCpu) hueRotate(col, p.hue * at(it.hueCurve, tv));
      for (let k = 0; k < 4; k++) col[k] *= p.init[k];
      col[3] *= at(it.alpha, tv);
      if (it.hue && !it.hueCpu) hueRotate(col, p.hue * at(it.hueCurve, tv));
      const rot = it.align ? Math.atan2(p.vy, p.vx) + Math.PI / 2 : p.ang * at(it.angCurve, tv) * DEG;
      const hw = (this.fw * sx) / 2, hh = (this.fh * sy) / 2, c = Math.cos(rot), s = Math.sin(rot);
      const cx = p.x, cy = p.y;
      const corner = (x: number, y: number) => [cx + x * c - y * s, cy + x * s + y * c];
      const fr = frames > 1 ? Math.min(frames - 1, Math.floor((p.anim + p.animSpeed * tv) * frames) % frames) : 0;
      const u0 = (fr % hf) / hf, v0 = Math.floor(fr / hf) / vf;
      b.quad(i, [...corner(-hw, -hh), ...corner(hw, -hh), ...corner(hw, hh), ...corner(-hw, hh)], u0, v0, u0 + 1 / hf, v0 + 1 / vf,
        col[0], col[1], col[2], col[3], [p.ang * DEG, tv, frames > 1 ? fr / frames : p.anim, p.life / L]);
    }
    b.flush();
  }
}
