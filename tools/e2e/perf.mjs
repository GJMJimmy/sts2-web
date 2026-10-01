// Idle CPU per screen (menu, map, combat) from Chrome's own counters, plus a CPU profile of the combat screen.
// Usage: CHROME=<path> [URL=<build>] [HEADED=1] node tools/e2e/perf.mjs <outDir>
// Headless shells render WebGL in software (SwiftShader), so compare Script/Style/Layout time, not GPU/paint.
import { chromium } from 'playwright';
import { startRun, travel } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2perf';
fs.mkdirSync(out, { recursive: true });
// CHANNEL=chrome uses the installed Google Chrome; GPU=1 asks it for Metal/ANGLE instead of SwiftShader
const browser = await chromium.launch({
  ...(process.env.CHANNEL ? { channel: process.env.CHANNEL } : { executablePath: process.env.CHROME }),
  headless: !process.env.HEADED,
  args: process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : [],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
await page.evaluate(() => 0);

async function measure(label, secs = 5) {
  await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
  const a = await metrics();
  const t0 = Date.now();
  await page.waitForTimeout(secs * 1000);
  const b = await metrics();
  const wall = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames; });
  const d = (k) => ((b[k] - a[k]) / wall) * 100; // % of one core
  const row = { screen: label, fps: +(frames / wall).toFixed(1), task: d('TaskDuration'), script: d('ScriptDuration'), style: d('RecalcStyleDuration'), layout: d('LayoutDuration'), heapMB: +(b.JSHeapUsedSize / 1e6).toFixed(0), nodes: b.Nodes };
  for (const k of ['task', 'script', 'style', 'layout']) row[k] = +row[k].toFixed(1) + '%';
  console.log(JSON.stringify(row));
  return row;
}

const tLoad = Date.now();
await page.goto((process.env.URL ?? 'http://127.0.0.1:47174/') + '?seed=PERF1&unlock=all&tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
console.log(`time to main menu: ${Date.now() - tLoad}ms (cold cache, local server)`);
await page.waitForTimeout(2000);
console.log('GL renderer:', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : String(gl?.getParameter(gl.RENDERER)); }), 'dpr', await page.evaluate(() => devicePixelRatio));
await measure('menu');
const tRun = Date.now();
await startRun(page);
console.log(`new run → map (through Neow): ${Date.now() - tRun}ms`);
await page.waitForTimeout(2000);
await measure('map');
const tFight = Date.now();
await travel(page);
await page.waitForFunction(() => document.querySelector('.end-turn:not(.off)'), null, { timeout: 60000 });
console.log(`map click → first fight playable: ${Date.now() - tFight}ms`);
await page.waitForTimeout(3000);
await measure('combat (idle, player turn)');

await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.waitForTimeout(5000);
const { profile } = await cdp.send('Profiler.stop');
fs.writeFileSync(`${out}/combat.cpuprofile`, JSON.stringify(profile));
// self time per function, top 25
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const js = [...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k));
const jsTotal = js.reduce((a, [, v]) => a + v, 0);
console.log(`combat idle: JS ${((jsTotal / total) * 100).toFixed(1)}% of wall time; top JS self time (share of JS):`);
for (const [k, v] of js.sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${((v / jsTotal) * 100).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
