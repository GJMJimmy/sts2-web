// Screenshots of every menu-side screen (fresh profile, then everything unlocked). Usage: URL=<build> CHROME=<path> node tools/e2e/screens.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import { toCharSelect, embark } from './start.mjs';
const out = process.argv[2] ?? '/tmp/sts2screens';
fs.mkdirSync(out, { recursive: true });
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|WebGL/.test(m.text())) errors.push(`[console] ${m.text().slice(0, 400)}`); });
page.on('dialog', (d) => d.dismiss());
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const go = (screen) => page.evaluate((s) => { window.ui.screen = s; window.invalidate(); }, screen);
// timeline, daily, custom and profile are main-menu submenus (credits: a modal from settings)
const SUBMENUS = ['timeline', 'daily', 'custom', 'profile'];
const sub = (menu) => page.evaluate((m) => { window.ui.screen = 'menu'; window.ui.menuStack = [m]; window.invalidate(); }, menu);
const credits = async () => { await sub('settings'); await page.waitForTimeout(500); await page.locator('.st-button').first().click(); };

await page.goto(url);
await page.waitForFunction(() => window.ui?.screen === 'menu');
await page.waitForTimeout(3000); // NMainMenu fades in from black over 3 s
await shot('00-menu-fresh');
await toCharSelect(page); // a fresh profile skips the singleplayer submenu
await shot('02-charselect-fresh');

await page.goto(url + '?unlock=all');
await page.waitForFunction(() => window.ui?.screen === 'menu');
await page.waitForTimeout(3000);
await shot('03-menu-unlocked');
await sub('singleplayer'); // Singleplayer only opens the submenu once a run exists (NumberOfRuns > 0)
await shot('01-single-sub');
await page.click('.submenu-btn >> nth=0');
await shot('04-charselect-unlocked');
const screens = ['timeline', 'daily', 'custom', 'library', 'relics', 'potions', 'stats', 'profile', 'credits'];
for (const s of screens) {
  if (s === 'credits') await credits();
  else if (SUBMENUS.includes(s)) await sub(s);
  else await go(s);
  await shot(`10-${s}`);
  if (s === 'credits') { await page.waitForTimeout(2000); await page.keyboard.press('Escape'); await sub('singleplayer'); }
}
// interactions: stats (the Achievements tab is disabled), library card inspect, relic inspect, timeline slot
await go('stats');
await page.hover('.stats-tabs .settings-tab:not(.disabled)').catch((e) => errors.push('stats tab ' + e.message));
await shot('20-stats-tab');
await go('library');
await page.click('.cl-grid .grid-holder .card').catch((e) => errors.push('lib card ' + e.message));
await shot('21-card-inspect');
await page.keyboard.press('Escape');
await go('relics');
await page.click('.relic-entry').catch((e) => errors.push('relic entry ' + e.message));
await shot('22-relic-inspect');
await page.keyboard.press('Escape');
await sub('timeline');
await page.waitForTimeout(1500);
await page.evaluate(() => { // a revealed slot in view (the strip is wider than the screen)
  const el = [...document.querySelectorAll('.tl-slot.complete')].find((e) => { const r = e.getBoundingClientRect(); return r.left > 100 && r.right < innerWidth - 100; });
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}).then(([x, y]) => page.mouse.click(x, y)).catch((e) => errors.push('tl slot ' + e.message));
await shot('23-timeline-inspect');
// in-run: ancient dialogue, pause menu (+ compendium over the run), deck view with sorting, card inspect
await page.goto(url + '?unlock=all&tutorials=off&seed=SCREENS1');
await page.waitForFunction(() => window.ui?.screen === 'menu');
await toCharSelect(page);
await embark(page);
await page.waitForFunction(() => window.ui?.room?.kind === 'event', null, { timeout: 60000 });
await page.waitForTimeout(1500);
await shot('30-ancient');
for (let i = 0; i < 6 && await page.$('.ancient-next'); i++) await page.click('.ancient-next');
await shot('31-ancient-options');
await page.keyboard.press('Escape');
await shot('32-pause');
// the compendium entry only exists once a run has been played (IsCompendiumAvailable): open the library directly
await page.evaluate(() => { window.ui.subscreen = 'library'; window.invalidate(); });
await shot('33-pause-library');
await page.keyboard.press('Escape'); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(700); // the library closes before the pause menu takes Escape
await page.evaluate(() => { window.ui.pauseOpen = false; window.ui.cardsView = { kind: 'deck' }; window.invalidate(); });
await page.click('.sort-btn >> nth=1');
await shot('34-deck-sorted');
await page.click('.ncard-grid .grid-holder .card >> nth=0');
await page.click('.ic-upgrade').catch((e) => errors.push('inspect upg ' + e.message));
await shot('35-inspect-upgrade');
// give up from the pause menu (abandon popup: Yes) → game over → Continue (badges, score bar, discoveries)
await page.keyboard.press('Escape'); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(700);
await page.evaluate(() => { window.ui.cardsView = null; window.invalidate(); });
if (!(await page.evaluate(() => window.ui.pauseOpen))) await page.keyboard.press('Escape');
await page.screenshot({ path: `${out}/39-before-giveup.png` });
await page.click('.pause-btn >> nth=-2'); // Give Up
await page.click('.vp-btn.yes').catch((e) => errors.push('abandon popup ' + e.message));
await page.waitForSelector('.gameover', { timeout: 30000 }).catch((e) => errors.push('no game over ' + e.message));
await page.waitForSelector('.gameover .go-btn', { timeout: 30000 }).catch((e) => errors.push('no continue ' + e.message));
await shot('40-gameover');
await page.click('.gameover .go-btn').catch((e) => errors.push('continue ' + e.message));
await page.waitForTimeout(4000);
await shot('41-summary');
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
