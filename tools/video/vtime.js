// Virtual clock for frame-exact capture (injected with addInitScript): timers, requestAnimationFrame, performance.now,
// Date.now and Web Animations only move when the driver calls window.__vt.frame(ms). Fetches and image decodes still
// run in real time; frame() waits for them first, so loading looks instant instead of stalling the clock.
(() => {
  const realSetTimeout = setTimeout.bind(window), realRaf = requestAnimationFrame.bind(window);
  const t0 = performance.now(), d0 = Date.now();
  let now = 0, nextId = 1, inflight = 0;
  const timers = new Map(); // id → { due, fn, args, every }
  let rafs = new Map();
  performance.now = () => t0 + now;
  Date.now = () => d0 + Math.floor(now);
  window.setTimeout = (fn, ms = 0, ...args) => { const id = nextId++; timers.set(id, { due: now + Math.max(0, +ms || 0), fn, args, seq: id }); return id; };
  window.setInterval = (fn, ms = 0, ...args) => { const id = nextId++; timers.set(id, { due: now + Math.max(1, +ms || 0), fn, args, every: Math.max(1, +ms || 0), seq: id }); return id; };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (fn) => { const id = nextId++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => rafs.delete(id);
  // Pixi's maxFPS check truncates the frame delta to whole ms (16.67 → 16 < 16.67 skips every other frame): uncap it
  Object.defineProperty(Object.prototype, '_minElapsedMS', {
    configurable: true,
    set() { Object.defineProperty(this, '_minElapsedMS', { configurable: true, get: () => 0, set() {} }); },
    get: () => 0,
  });
  const track = (p) => { inflight++; return p.finally(() => inflight--); };
  const realFetch = window.fetch.bind(window);
  window.fetch = (...a) => track(realFetch(...a));
  if (window.createImageBitmap) { const cib = window.createImageBitmap.bind(window); window.createImageBitmap = (...a) => track(cib(...a)); }
  const realDecode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () { return track(realDecode.call(this)); };
  const idle = async () => { for (let i = 0; i < 400 && inflight > 0; i++) await new Promise((r) => realSetTimeout(r, 10)); };
  const runTimers = () => {
    for (let n = 0; n < 20000; n++) {
      let best = null;
      for (const [id, t] of timers) if (t.due <= now && (!best || t.due < best[1].due || (t.due === best[1].due && t.seq < best[1].seq))) best = [id, t];
      if (!best) return;
      const [id, t] = best;
      if (t.every) { t.due += t.every; t.seq = nextId++; } else timers.delete(id);
      try { typeof t.fn === 'function' ? t.fn(...t.args) : (0, eval)(t.fn); } catch (e) { console.error(e); }
    }
  };
  // CSS animations/transitions and element.animate() run on the real document timeline: hold each one paused as it
  // appears and step it by hand. At its end it is let go a hair before the end (finish() is a no-op on a paused
  // animation in Chrome), so it finishes by itself: finish/animationend events are only dispatched in a real rendering
  // frame, so frame() then waits for two.
  // Held animations are tracked here: at its very end a paused one drops out of getAnimations().
  const held = new Set();
  const animations = (dt) => {
    let released = false;
    for (const a of document.getAnimations()) if (a.playState === 'running' && !a.__vtDone) { a.pause(); held.add(a); }
    for (const a of held) {
      if (a.playState !== 'paused') { held.delete(a); continue; } // cancelled or replaced meanwhile
      const t = (a.currentTime ?? 0) + dt * (a.playbackRate || 1), end = a.effect?.getComputedTiming().endTime ?? Infinity;
      if (t >= end - 0.02) { a.currentTime = end - 0.01; a.__vtDone = true; a.play(); held.delete(a); released = true; } else a.currentTime = t;
    }
    return released;
  };
  window.__vt = {
    get now() { return now; },
    /** Advance one frame of `ms`: timers due, animation frames, CSS/Web Animations; then let microtasks and loads settle. */
    async frame(ms = 1000 / 60) {
      await idle();
      now += ms;
      runTimers();
      const cbs = rafs; rafs = new Map();
      for (const fn of cbs.values()) { try { fn(t0 + now); } catch (e) { console.error(e); } }
      if (animations(ms)) for (let i = 0; i < 2; i++) await new Promise((r) => realRaf(() => r()));
      await new Promise((r) => realSetTimeout(r, 0));
      await idle();
    },
    async run(ms) { for (let t = 0; t < ms; t += 1000 / 60) await this.frame(); },
  };
})();
