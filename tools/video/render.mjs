// Renders video.html frame by frame (headless Chrome, GPU) and muxes the score.
// Usage: node tools/video/render.mjs                    full video → _work/video/sts2-web-intro.mp4
//        node tools/video/render.mjs stills 4.5,20,50   single frames → _work/video/stills/ (+ contact sheet)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const WORK = path.join(root, '_work/video');
const cues = JSON.parse(fs.readFileSync(path.join(here, 'cues.json'), 'utf8'));
const FPS = 60, TOTAL = Math.round(cues.duration * FPS);

const clipsDir = path.join(WORK, 'clips');
const clips = Object.fromEntries(fs.readdirSync(clipsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => [d.name, fs.readdirSync(path.join(clipsDir, d.name)).filter((f) => f.endsWith('.jpg')).length]));
const pdir = path.join(root, 'assets/images/packed/card_portraits');
const portraits = ['ironclad', 'silent', 'defect', 'necrobinder', 'regent', 'colorless']
  .flatMap((c) => fs.readdirSync(path.join(pdir, c)).filter((f) => f.endsWith('.webp')).map((f) => `../../assets/images/packed/card_portraits/${c}/${f}`));
// background code rain: three blocks of the real transpiler output
const gen = fs.readFileSync(path.join(root, 'packages/core/src/gen/sts2.ts'), 'utf8').split('\n');
const rain = [0.21, 0.47, 0.73].map((k) => gen.slice(Math.floor(gen.length * k), Math.floor(gen.length * k) + 110).map((l) => l.slice(0, 80)));
const data = { cues, clips, portraits, rain };

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await page.goto('file://' + path.join(here, 'video.html'));
  await page.evaluate((d) => window.setup(d), data);
  return page;
}
const frame = async (page, f) => { await page.evaluate((t) => window.renderFrame(t), f / FPS); return page.screenshot({ type: 'jpeg', quality: 95 }); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
if (process.argv[2] === 'stills') {
  const out = path.join(WORK, 'stills');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const page = await openPage(browser);
  const ts = process.argv[3].split(',').map(Number);
  for (const t of ts) fs.writeFileSync(path.join(out, `${t.toFixed(2).padStart(6, '0')}.jpg`), await frame(page, Math.round(t * FPS)));
  const cols = Math.min(4, ts.length), rows = Math.ceil(ts.length / cols);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-pattern_type', 'glob', '-i', path.join(out, '*.jpg'), '-vf', `scale=640:-1,tile=${cols}x${rows}:padding=6`, '-frames:v', '1', path.join(WORK, 'stills.jpg')]);
  console.log('stills', ts.join(' '));
} else {
  const P = +(process.env.PAGES ?? 4);
  const from = Math.round(+(process.env.FROM ?? 0) * FPS), to = Math.round(+(process.env.TO ?? cues.duration) * FPS);
  const per = Math.ceil((to - from) / P);
  const t0 = Date.now();
  let done = 0;
  const segs = await Promise.all(Array.from({ length: P }, async (_, i) => {
    const a = from + i * per, b = Math.min(to, a + per), file = path.join(WORK, `seg${i}.mp4`);
    const page = await openPage(browser);
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = a; f < b; f++) {
      const buf = await frame(page, f);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (++done % 300 === 0) console.log(`${done}/${to - from} frames, ${((Date.now() - t0) / done).toFixed(0)} ms/frame`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    return file;
  }));
  const list = path.join(WORK, 'segs.txt');
  fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join('\n'));
  const out = path.join(WORK, process.env.OUT ?? 'sts2-web-intro.mp4');
  const ss = String(from / FPS), dur = String((to - from) / FPS);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ss', ss, '-t', dur, '-i', path.join(WORK, 'score.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-af', 'volume=' + (process.env.GAIN ?? '0') + 'dB,alimiter=limit=0.94', '-c:a', 'aac', '-b:a', '256k', '-shortest', out]);
  for (const f of [...segs, list]) fs.rmSync(f); // near-lossless intermediates are large
  console.log('wrote', out, `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
