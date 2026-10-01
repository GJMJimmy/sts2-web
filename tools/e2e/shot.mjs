import { travel, toCharSelect, embark } from './start.mjs';
// Drive the web build with Playwright: menu → character select → embark; screenshot each step.
import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
const out = process.argv[2] ?? '/tmp/sts2shots';
const steps = (process.argv[3] ?? 'menu,charselect,run').split(',');
import fs from 'node:fs';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(url + (url.includes('?') ? '&' : '?') + 'tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 }).catch(() => {});
console.log('boot ms', Date.now() - t0);
await page.screenshot({ path: `${out}/01-menu.png` });
if (steps.includes('charselect')) {
  await toCharSelect(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/02-charselect.png` });
}
if (steps.includes('run')) {
  await embark(page);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/03-run.png` });
}
if (steps.includes('combat')) {
  await travel(page);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/04-room.png` });
  for (let turn = 0; turn < (+process.env.TURNS || 2); turn++) {
    for (let k = 0; k < 4; k++) {
      // drag the first playable hand card up; targeted cards are released over the first enemy
      const p = await page.evaluate(() => {
        const st = document.querySelector('.stage-root').getBoundingClientRect(), s = st.width / 1920;
        const h = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand.ActiveHolders.find((x) => x.CardModel.CanPlay$0());
        if (!h) return null;
        const e = document.querySelector('.creature[data-side="enemy"]:not(.dead) .cr-hitbox')?.getBoundingClientRect();
        return { x: st.left + h.GlobalPosition.X * s, y: st.top + (h.GlobalPosition.Y - 80) * s, to: h.CardModel.TargetType === window.G.TargetType.AnyEnemy && e ? [e.left + e.width / 2, e.top + e.height / 2] : null };
      });
      if (!p) break;
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x, p.y - 350, { steps: 8 });
      if (p.to) await page.mouse.move(p.to[0], p.to[1], { steps: 8 });
      await page.mouse.up();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(1200);
    }
    await page.screenshot({ path: `${out}/05-turn${turn}.png` });
    const end = await page.$('.end-turn:not(.off)');
    if (end) { await end.click({ force: true }); await page.waitForTimeout(4500); }
  }
  await page.screenshot({ path: `${out}/06-after.png` });
}
fs.writeFileSync(`${out}/console.log`, logs.join('\n'));
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 30).join('\n'));
await browser.close();
