// The Crystal Sphere event's board (ui/crystal-sphere.tsx) through the mouse: divine until the divinations run out, the
// rewards screen that comes up over the board must take the clicks, and claiming it all leaves the board on Proceed.
// Usage: CHROME=<path> [URL=<dev server>] node tools/e2e/crystal-sphere.mjs <outDir>   (exit 1 on failure)
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2crystal';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = async (msg) => { console.log('FAIL', msg, errors); await page.screenshot({ path: `${out}/fail.png` }); await browser.close(); process.exit(1); };
/** Press and release on the nth match, holding like a hand does; false when it is not on screen. */
const tap = async (sel, nth = 0) => {
  const at = await page.evaluate(([s, n]) => { const r = document.querySelectorAll(s)[n]?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, [sel, nth]);
  if (!at) return false;
  await page.mouse.move(at[0], at[1]); await page.waitForTimeout(100); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); await page.mouse.move(5, 5);
  return true;
};

await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=CRYSTAL1&unlock=all&tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
await startRun(page);
// straight into the event, as tools/e2e/coverage.mjs enters events
await page.evaluate(() => {
  const G = window.G, rm = G.RunManager.Instance;
  const ev = [...G.ModelDb.AllEvents].find((e) => e.Id.Entry === 'CRYSTAL_SPHERE');
  rm.State.Players[0].Gold = 500;
  rm.State.AppendToMapPointHistory(G.MapPointType.Unknown, G.RoomType.Event, ev.Id);
  G.TaskHelper.RunSafely(rm.EnterRoom(new G.EventRoom().$ctor_EventRoom$EventModel(ev)));
});
await page.waitForFunction(() => window.ui.room?.kind === 'event' && document.querySelector('.event-option'), null, { timeout: 30000 });
await page.evaluate(() => { if (window.ui.mapOpen) window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Screens.Map.NMapScreen').Instance.Close(); });
await page.waitForTimeout(1500);
await tap('.event-option');
await page.waitForSelector('.crystal-sphere', { timeout: 20000 }).catch(() => fail('the board did not open'));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/board.png` });

for (let i = 0; i < 60 && !(await page.$('.rewards-screen')); i++) {
  const hidden = await page.evaluate(() => document.querySelectorAll('.csph-cell:not(.open)').length);
  await tap('.csph-cell:not(.open)', Math.floor(hidden / 2));
  await page.waitForTimeout(700);
}
if (!(await page.$('.rewards-screen'))) await fail('no rewards after the divinations ran out');
await page.waitForTimeout(2500); // the rewards window slides in
await page.screenshot({ path: `${out}/rewards.png` });
// the rewards screen is NOverlayStack's top screen: what is under the pointer at its button must be its own
const hit = await page.evaluate(() => {
  const r = (document.querySelector('.rewards-screen .reward-btn') ?? document.querySelector('.rewards-screen .proceed-btn')).getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { cls: String(el?.className), inRewards: !!el?.closest('.rewards-screen') };
});
if (!hit.inRewards) await fail(`the rewards screen is covered: its button's spot hits .${hit.cls}`);

for (let i = 0; i < 12 && (await page.$('.rewards-screen')); i++) {
  if (!(await tap('.rewards-screen .reward-btn'))) await tap('.rewards-screen .proceed-btn.shown');
  await page.waitForTimeout(900);
  if (await page.$('.card-reward-screen .gh-card')) { await tap('.card-reward-screen .gh-card'); await page.waitForTimeout(900); }
}
const end = await page.evaluate(() => ({ overlays: window.ui.overlays.map((o) => o.kind), done: !!window.ui.overlays[0]?.done, proceed: !!document.querySelector('.crystal-sphere .proceed-btn') }));
await page.screenshot({ path: `${out}/done.png` });
if (end.overlays.join() !== 'crystalsphere' || !end.done || !end.proceed) await fail(`the board did not finish: ${JSON.stringify(end)}`);
if (errors.length) await fail('page errors');
console.log('OK');
await browser.close();
