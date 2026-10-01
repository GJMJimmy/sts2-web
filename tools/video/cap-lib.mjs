// Frame-exact capture of the running game (virtual clock from vtime.js). Frames: _work/video/clips/<name>/00000.jpg …
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const WORK = path.resolve(here, '../../_work/video');
export const URL = process.env.URL ?? 'http://127.0.0.1:47190/';

export async function open(query = '') {
  // system Chrome on the GPU (Metal); the Playwright headless shell would rasterize WebGL on the CPU at half resolution
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL/.test(m.text())) console.log('[console]', m.text().slice(0, 300)); });
  page.on('dialog', (d) => d.dismiss());
  await page.addInitScript({ path: path.join(here, 'vtime.js') });
  await page.goto(URL + (query ? `?${query}` : ''));
  const vt = {
    frame: () => page.evaluate(() => window.__vt.frame()),
    run: (ms) => page.evaluate((m) => window.__vt.run(m), ms),
    /** Advance virtual time until `fn` (page predicate) holds. */
    async until(fn, arg, maxMs = 60000) {
      for (let t = 0; t < maxMs; t += 100) {
        if (await page.evaluate(fn, arg)) return true;
        await page.evaluate(() => window.__vt.run(100));
      }
      throw new Error('until: timed out ' + fn.toString().slice(0, 120));
    },
  };
  let recording = null;
  const rec = {
    start(name) {
      const dir = path.join(WORK, 'clips', name);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      recording = { dir, n: 0 };
    },
    stop() { const r = recording; recording = null; console.log('clip', path.basename(r.dir), r.n, 'frames'); },
    get frames() { return recording?.n ?? 0; },
    /** Advance `ms` of virtual time, one screenshot per 1/60 s while recording. */
    async play(ms) {
      for (let t = 0; t < ms - 1e-6; t += 1000 / 60) {
        await vt.frame();
        if (recording) await page.screenshot({ path: path.join(recording.dir, String(recording.n++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 });
      }
    },
  };
  // mouse moves that take virtual time (hover and drag feedback animate)
  const mouse = {
    async move(x, y, ms = 300) {
      const from = mouse.at ?? [960, 900];
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        await page.mouse.move(from[0] + (x - from[0]) * e, from[1] + (y - from[1]) * e);
        await rec.play(1000 / 60);
      }
      mouse.at = [x, y];
    },
    async click(x, y, ms = 300) { await mouse.move(x, y, ms); await page.mouse.down(); await rec.play(50); await page.mouse.up(); },
  };
  return { browser, page, vt, rec, mouse };
}

/** Centre of the first element matching `sel` (page coordinates), or null. */
export const center = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];
}, sel);
