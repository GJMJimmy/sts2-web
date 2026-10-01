// Translate + compile every exported Godot shader in the browser. Usage: URL=<dev server> CHROME=<path> node tools/e2e/shaders.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const root = 'assets/shaders';
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.gdshader')) files.push(path.relative(root, p)); } })(root);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'debug' && m.text().startsWith('[shader]')) logs.push(m.text().slice(0, 300)); });
await page.goto(process.env.URL ?? 'http://127.0.0.1:47173/');
await page.waitForFunction(() => window.ui?.screen === 'menu' && window.__loadShader);
const res = await page.evaluate(async (fs) => Object.fromEntries(await Promise.all(fs.map(async (f) => [f, !!(await window.__loadShader(f))]))), files);
const bad = Object.entries(res).filter(([, ok]) => !ok).map(([f]) => f);
console.log(`${files.length - bad.length}/${files.length} shaders compile`);
for (const f of bad) console.log('  unsupported', f);
for (const l of logs) console.log(l);
await browser.close();
