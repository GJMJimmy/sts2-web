// Screenshot converted scenes full-screen through the dev server's ?scene= view (particles, shaders, skeletons).
// Usage: CHROME=<path> [URL=<dev server>] node tools/e2e/scene-shots.mjs <outDir> scenes/rest_site/hive_rest_site.tscn ...
import { chromium } from 'playwright';
const out = process.argv[2]; const scenes = process.argv.slice(3);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
for (const s of scenes) {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?scene=' + encodeURIComponent(s));
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${s.replace(/[\/.]/g, '_')}.png` });
  console.log('shot', s);
}
console.log(errs.slice(0, 20).join('\n') || 'no errors');
await browser.close();
