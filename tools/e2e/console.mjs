// The dev console (ui/devconsole.tsx): open it with `, complete and run commands on the menu and in a run, close it.
// Usage: CHROME=<path> [URL=<dev server>] node tools/e2e/console.mjs <outDir>   (exit 1 on failure)
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2console';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fail = async (msg) => { console.log('FAIL', msg, errors); await page.screenshot({ path: `${out}/fail.png` }); await browser.close(); process.exit(1); };
const check = async (ok, msg) => { if (!ok) await fail(msg); };
const input = () => page.evaluate(() => document.querySelector('.dc-line input').value);
const output = () => page.evaluate(() => document.querySelector('.dc-output').textContent);
// the panel repaints on the next frame
const shows = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.dc-output').textContent), re.source, { timeout: 3000 }).then(() => true, () => false);
const gold = () => page.evaluate(() => window.G.RunManager.Instance.State.Players[0].Gold);

await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=CONSOLE1&unlock=all&tutorials=off&dev=1');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });

// menu: ` opens, Tab completes the only candidate, Enter runs, a blocked command is unknown
await page.keyboard.press('Backquote');
await page.waitForSelector('.dev-console-viewport.open').catch(() => fail('` did not open the console'));
await check((await input()) === '', 'the toggle key was typed into the input');
await page.keyboard.type('gol');
await page.keyboard.press('Tab');
await check((await input()) === 'gold ', `Tab completed to '${await input()}'`);
await page.keyboard.press('Control+u');
await page.keyboard.type('help');
await page.keyboard.press('Enter');
await check((await shows(/gold/)) && !/cloud|sentry/.test(await output()), 'help output: ' + (await output()).slice(0, 300));
await page.screenshot({ path: `${out}/help.png` });
// several candidates open the selection menu; Escape leaves it, a second one closes the console
await page.keyboard.type('g');
await page.keyboard.press('Tab');
await check(await shows(/Select command:/), 'no selection menu: ' + (await output()).slice(0, 200));
await page.keyboard.press('Escape');
await check((await shows(/^(?![^]*Select command:)/)) && (await page.$('.dev-console-viewport.open')), 'Escape did not leave the selection menu');
await page.keyboard.press('Escape');
await page.waitForSelector('.dev-console-viewport.open', { state: 'detached', timeout: 3000 }).catch(() => fail('Escape did not close the console'));

// run: a command changes the run, the history comes back with Up, Escape closes the console and nothing else
await startRun(page);
const before = await gold();
await page.keyboard.press('Backquote');
await page.waitForSelector('.dev-console-viewport.open').catch(() => fail('` did not open the console in a run'));
await page.keyboard.press('Control+u'); // the input keeps its text while the console is closed
await page.keyboard.type('gold 999');
await page.keyboard.press('Enter');
await page.waitForFunction((b) => window.G.RunManager.Instance.State.Players[0].Gold !== b, before, { timeout: 5000 }).catch(() => fail('gold 999 changed nothing: ' + before));
const after = await gold();
await page.keyboard.press('ArrowUp');
await check((await input()) === 'gold 999', `Up recalled '${await input()}'`);
await page.screenshot({ path: `${out}/run.png` });
await page.keyboard.press('Escape');
await page.waitForSelector('.dev-console-viewport.open', { state: 'detached', timeout: 3000 }).catch(() => fail('Escape did not close the console in a run'));
await check(!(await page.evaluate(() => window.ui.pauseOpen)), 'Escape reached the game under the console');

// reload: the history written under user:// (console_history.log) loads back
await page.waitForTimeout(500);
await page.reload();
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
await page.keyboard.press('Backquote');
await page.waitForSelector('.dev-console-viewport.open', { timeout: 5000 }).catch(() => fail('the console did not open after a reload'));
await page.keyboard.press('ArrowUp');
await check((await input()) === 'gold 999', `after a reload Up recalled '${await input()}'`);
await check(errors.length === 0, 'page errors');
console.log('OK', { gold: [before, after] });
await browser.close();
