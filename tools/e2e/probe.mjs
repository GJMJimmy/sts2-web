// Evaluate an expression in the running app after a scripted prefix of UI steps.
import { chromium } from 'playwright';
import { toCharSelect, embark } from './start.mjs';
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'tutorials=off');
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
await toCharSelect(page);
await embark(page);
await page.waitForTimeout(2500);
for (const expr of process.argv.slice(2)) {
  if (expr.startsWith('click:')) { await page.click(expr.slice(6), { force: true }); await page.waitForTimeout(2500); continue; }
  if (expr.startsWith('wait:')) { await page.waitForTimeout(+expr.slice(5)); continue; }
  try { console.log('>', expr, '\n', JSON.stringify(await page.evaluate(expr), null, 1)?.slice(0, 3000)); } catch (e) { console.log('ERR', e.message); }
}
console.log(logs.filter((l) => !/vite|bridge\] installed/.test(l)).slice(0, 40).join('\n'));
await browser.close();
