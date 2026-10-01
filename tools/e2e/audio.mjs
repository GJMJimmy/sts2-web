// Every FMOD event path named in the rule layer must resolve to samples. Usage: URL=<dev server> CHROME=<path> node tools/e2e/audio.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const src = fs.readFileSync('packages/core/src/gen/sts2.ts', 'utf8');
// static paths only (interpolated ones are built from model ids at runtime); music goes through the stem matcher
const events = [...new Set(src.match(/"event:\/[^"{}$`]+"/g).map((s) => s.slice(1, -1)))].filter((e) => !e.startsWith('event:/music') && !e.endsWith('_')); // "…/wipe_" + id: a prefix
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage();
await page.goto(process.env.URL ?? 'http://127.0.0.1:47173/');
await page.waitForFunction(() => window.ui?.screen === 'menu' && window.__resolveSfx);
const bad = await page.evaluate((es) => es.filter((e) => !window.__resolveSfx(e).length), events);
console.log(`${events.length - bad.length}/${events.length} sfx events resolve`);
for (const e of bad) console.log('  unresolved', e);
await browser.close();
process.exit(bad.length ? 1 : 0);
