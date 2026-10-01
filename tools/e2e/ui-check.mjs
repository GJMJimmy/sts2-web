// Visual checklist: map, card hover tips, a card in flight, settings. Usage: URL=<build> CHROME=<path> node tools/e2e/ui-check.mjs <outDir>
import { chromium } from 'playwright';
import { startRun, travel } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2ui';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=UICHECK&unlock=all&tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu');
await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Fast; });
await startRun(page);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-map.png` });
// map drawing (right-drag) and a legend hover highlighting that room type
await page.mouse.move(700, 450); await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 12; i++) await page.mouse.move(700 + i * 15, 450 + Math.sin(i / 2) * 40);
await page.mouse.up({ button: 'right' });
await page.hover('.map-legend-item >> nth=4');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/1b-map-drawing-legend.png` });
await page.mouse.move(10, 10);
await travel(page);
await page.waitForFunction(() => document.querySelector('.end-turn:not(.off)'), null, { timeout: 30000 });
await page.waitForTimeout(1500);
// hand holders in viewport coordinates (the stage is 1920 × 1080 scaled into the page)
const holders = await page.evaluate(() => {
  const st = document.querySelector('.stage-root').getBoundingClientRect(), k = st.width / 1920;
  const hand = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand;
  return hand.ActiveHolders.map((h) => ({ x: st.left + h.GlobalPosition.X * k, y: st.top + (h.GlobalPosition.Y - 80) * k, self: h.CardModel.TargetType === window.G.TargetType.Self }));
});
const last = holders[holders.length - 1];
await page.mouse.move(last.x, last.y);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/2-hover.png` });
// drag a self-targeted card (Defend) up into the play zone and release: it plays and flies to the discard pile
const d = holders.find((h) => h.self) ?? holders[0];
await page.mouse.move(d.x, d.y);
await page.mouse.down();
await page.mouse.move(d.x, d.y - 350, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/3-flying.png` });
await page.mouse.move(10, 10);
await page.evaluate(() => { window.ui.settingsOpen = true; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/4-settings.png` });
await browser.close();
