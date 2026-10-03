// Lord's Parasol: entering a shop buys its stock for free, removes a card, and restores navigation.
// Usage: CHROME=<path> [URL=<server>] node tools/e2e/lords-parasol.mjs <outDir>
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const out = process.argv[2] ?? '/tmp/sts2-lords-parasol';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || /TaskHelper|TypeError/.test(m.text())) errors.push(m.text()); });
const state = () => page.evaluate(() => {
  const p = window.G.RunManager.Instance.State.Players[0];
  return {
    gold: p.Gold, deck: p.Deck.Cards.length,
    relics: [...p.Relics].map((r) => r.Id.Entry), potions: [...p.Potions].map((p) => p.Id.Entry),
    map: window.ui.mapOpen, cards: window.ui.cardsView?.kind ?? null,
    stocked: [...(window.ui.room?.inv?.AllEntries ?? [])].filter((e) => e !== window.ui.room.inv.CardRemovalEntry && e.IsStocked).length,
  };
});

try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=PARASOL1&unlock=all&tutorials=off&lang=zhs');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  await page.evaluate(async () => {
    const G = window.G, p = G.RunManager.Instance.State.Players[0];
    await G.RelicCmd.Obtain$3(G.ModelDb.Relic(G.LordsParasol).ToMutable(), p, -1);
  });
  const before = await state();
  await page.evaluate(() => {
    const G = window.G;
    G.SaveManager.Instance.PrefsSave.FastMode = G.FastModeType.Normal;
    window.__parasolEnter = G.RunManager.Instance.EnterRoomDebug(G.RoomType.Shop, G.MapPointType.Unassigned, null, false);
  });

  // Exercise real pointer input and hotkeys while the relic is buying, before any selection screens open.
  await page.waitForSelector('.tb-deck.disabled', { timeout: 10000 });
  assert.ok(await page.$('.tb-map.disabled'), 'map must be disabled during automatic purchases');
  for (const [button, key] of [['deck', 'd'], ['map', 'm']]) {
    const rect = await page.locator(`.tb-${button}`).boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.keyboard.press(key);
    const s = await state();
    assert.equal(s.cards, null, 'deck input must not interrupt automatic purchases');
    assert.equal(s.map, false, 'map input must not interrupt automatic purchases');
  }
  await page.mouse.move(5, 850);
  await page.waitForFunction((count) => window.G.RunManager.Instance.State.Players[0].Deck.Cards.length > count, before.deck, { timeout: 10000 });
  await page.screenshot({ path: `${out}/buying.png` });
  await page.waitForSelector('.grid-screen .gh-card', { timeout: 30000 });
  await page.evaluate(async () => { await window.__parasolEnter; });
  const purchased = await state();
  assert.equal(purchased.gold, before.gold, 'automatic purchases must be free');
  assert.equal(purchased.deck, before.deck + 7, 'all seven shop cards must reach the deck');
  assert.equal(purchased.relics.length, before.relics.length + 3, 'all three relics must be acquired');
  assert.equal(purchased.potions.length, 3, 'all three potions must fill the empty belt');
  assert.equal(purchased.stocked, 0, 'the shop stock must be exhausted');
  await page.waitForTimeout(2500); // Let acquired-card and upgrade animations settle for visual inspection.
  await page.screenshot({ path: `${out}/removal.png` });
  // The removal is mandatory: Escape cannot cancel the selection.
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => window.ui.overlays.some((o) => o.kind === 'grid')), 'free removal must not be cancellable');
  // Escape may show the pause menu, but resuming must return to the same selection.
  if (await page.evaluate(() => window.ui.pauseOpen)) {
    await page.locator('.pause-menu .pause-btn').first().click();
    await page.waitForSelector('.pause-menu', { state: 'detached' });
  }
  await page.locator('.grid-screen .gh-card').first().click();
  await page.click('.grid-preview .confirm-btn.shown');
  await page.waitForSelector('.grid-screen', { state: 'detached' });
  await page.waitForFunction(() => !window.ui.room.blocked && window.ui.room.removalUsed);
  const removed = await state();
  assert.equal(removed.deck, before.deck + 6, 'exactly one card must be removed');
  assert.equal(removed.gold, before.gold, 'removal must also be free');

  await page.waitForSelector('.tb-deck:not(.disabled)');
  await page.waitForSelector('.tb-map:not(.disabled)');
  await page.click('.tb-deck');
  await page.waitForFunction(() => window.ui.cardsView?.kind === 'deck');
  await page.keyboard.press('d');
  await page.waitForFunction(() => !window.ui.cardsView);
  await page.click('.tb-map');
  await page.waitForFunction(() => window.ui.mapOpen);
  await page.keyboard.press('m');
  await page.waitForFunction(() => !window.ui.mapOpen);
  await page.mouse.move(5, 850);
  await page.waitForTimeout(1500); // Let the map close and the removed card finish its animation.
  await page.screenshot({ path: `${out}/complete.png` });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.ui.room.open), false, 'Escape must close the inventory after buying');
  await page.waitForSelector('.shop-inv .back-btn[data-esc]', { state: 'detached' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-menu .back-btn[data-esc]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-menu', { state: 'detached' });
  assert.deepEqual(errors, [], 'no browser or background task errors');
  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ before, purchased, removed, errors }, null, 2));
  console.log('OK: free stock and mandatory removal; map/deck blocked while buying and restored afterward');
} catch (e) {
  await page.screenshot({ path: `${out}/fail.png` }).catch(() => {});
  console.error('FAIL', e, errors, await state().catch(() => null));
  process.exitCode = 1;
} finally {
  await browser.close();
}
