// Save & Quit → reload → Continue in the browser: start a run, enter the first fight, quit from the pause menu, reload
// the page, continue from the menu.
// Usage: CHROME=<path> [URL=<dev server>] node tools/e2e/continue.mjs <outDir>   (exit 1 on failure)
import { chromium } from 'playwright';
import { startRun, travel, viewport, setAspect } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2continue';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport }); // VIEW / ASPECT: see start.mjs
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = async (msg) => { console.log('FAIL', msg, errors); await page.screenshot({ path: `${out}/fail.png` }); await browser.close(); process.exit(1); };
const state = () => page.evaluate(() => {
  const rs = window.G.RunManager.Instance.State;
  return { screen: window.ui.screen, room: rs?.CurrentRoom?.constructor?.$name, floor: rs?.TotalFloor, hp: rs?.Players?.[0]?.Creature?.CurrentHp, gold: rs?.Players?.[0]?.Gold };
});

await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=CONTINUE1&unlock=all&tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
await setAspect(page);
await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
await startRun(page);
await travel(page);
await page.waitForFunction(() => document.querySelector('.end-turn-btn.shown:not(.disabled)'), null, { timeout: 30000 }).catch(() => fail('no combat'));
const before = await state();
await page.click('.tb-settings'); // pause (top-bar settings button)
await page.waitForSelector('.pause-menu');
await page.click('.pause-btn >> nth=-1'); // Save and Quit
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 30000 }).catch(() => fail('did not return to menu'));
// the save must survive a reload (IndexedDB, written asynchronously)
await page.waitForTimeout(500);
await page.reload();
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
if (await page.evaluate(() => window.G.$.vfs.backend) !== 'indexeddb') await fail('saves are not in IndexedDB');
await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
const cont = await page.waitForSelector('.mm-continue', { timeout: 10000 }).catch(() => null); // the menu draws it a moment after it is up
if (!cont) await fail('no Continue button');
await cont.click();
await page.waitForFunction(() => window.ui?.screen === 'run' && window.G.RunManager.Instance.State?.CurrentRoom, null, { timeout: 60000 }).catch(() => fail('continue did not load'));
await page.waitForFunction(() => document.querySelector('.end-turn-btn.shown:not(.disabled)'), null, { timeout: 30000 }).catch(() => fail('continued fight not playable'));
const after = await state();
await page.screenshot({ path: `${out}/continued.png` });
console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
if (after.floor !== before.floor || after.room !== before.room) await fail('continued into a different place');
if (errors.length) await fail('page errors');
console.log('OK');
await browser.close();
