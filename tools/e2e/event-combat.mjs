// The Lantern Key: event → playable combat, Save & Quit → reload → fight again, then claim the key.
// Usage: CHROME=<path> [URL=<server>] node tools/e2e/event-combat.mjs <outDir>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startRun, travel } from './start.mjs';

const out = process.argv[2] ?? '/tmp/sts2-event-combat';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
// Vite preview does not serve the service worker's CDN-style %40 asset URLs.
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const click = async (locator) => { await locator.click({ delay: 100 }); await page.mouse.move(5, 5); };
const state = () => page.evaluate(() => {
  const G = window.G, rs = G.RunManager.Instance.State, cm = G.CombatManager.Instance;
  return { room: window.ui.room?.kind, live: window.ui.live, round: cm.DebugOnlyGetState()?.RoundNumber,
    hand: rs.Players[0].PlayerCombatState?.Hand.Cards.length, cards: document.querySelectorAll('.combat-ui .card-node').length,
    energy: rs.Players[0].PlayerCombatState?.Energy, block: rs.Players[0].Creature.Block };
});
async function fight() {
  for (const suffix of ['KEEP_THE_KEY', 'FIGHT']) {
    await page.waitForFunction((key) => {
      const v = window.ui.room;
      return v?.kind === 'event' && v.ready && !v.disabled && v.options.some((o) => o.TextKey?.endsWith('.' + key));
    }, suffix);
    const index = await page.evaluate((key) => window.ui.room.options.findIndex((o) => o.TextKey?.endsWith('.' + key)), suffix);
    const option = page.locator('.event-option').nth(index);
    await option.evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });
    await option.hover();
    await page.waitForFunction((i) => document.querySelectorAll('.event-option')[i]?.classList.contains('hover'), index);
    await click(option);
  }
  await page.waitForFunction(() => window.G.CombatManager.Instance.IsPlayPhase);
  const s = await state();
  assert.equal(s.hand, 5, 'the rules must draw the starting hand');
  assert.equal(s.room, 'combat', 'the event must switch to the playable combat screen');
  assert.equal(s.live, true);
  await page.waitForSelector('.combat-ui .card-node .card');
  await page.waitForSelector('.end-turn-btn.shown:not(.disabled)');
  assert.equal((await state()).cards, 5, 'the starting hand must be visible');
}

try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=LANTERN_REGRESSION&lang=zhs&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await startRun(page);
  // Seed a normal map entry, including its persisted event queue. Reload uses the actual save/load path.
  await page.evaluate(() => {
    const G = window.G, rs = G.RunManager.Instance.State;
    for (const p of G.$.iter(rs.Map.StartingMapPoint.Children)) p.PointType = G.MapPointType.Unknown;
    rs.Act._rooms.events.splice(0, rs.Act._rooms.events.length, G.ModelDb.Event(G.TheLanternKey));
    rs.Act._rooms.eventsVisited = 0;
    const odds = rs.Odds.UnknownMapPoint;
    odds.MonsterOdds = odds.TreasureOdds = odds.ShopOdds = 0;
  });
  await travel(page);
  await fight();
  console.log('initial combat', await state());
  await page.waitForTimeout(1500); // Let the hand and combat banner settle for visual inspection.
  await page.screenshot({ path: `${out}/initial.png` });

  await click(page.locator('.tb-settings'));
  await page.waitForSelector('.pause-menu');
  await click(page.locator('.pause-btn').last());
  await page.waitForFunction(() => window.ui?.screen === 'menu');
  await page.waitForTimeout(500); // IndexedDB writes are asynchronous.
  await page.reload();
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.G.$.vfs.backend), 'indexeddb');
  await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
  await click(page.locator('.mm-continue'));
  await fight();
  console.log('continued combat', await state());

  // Play a starting Defend through the hand's mouse drag path, not through the rules API.
  await page.waitForFunction(() => window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand.ActiveHolders
    .some((h) => h.hitboxEnabled && h.CardModel.Id.Entry === 'DEFEND_IRONCLAD'));
  const drag = await page.evaluate(() => {
    const hand = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance.Ui.Hand;
    const h = hand.ActiveHolders.find((h) => h.CardModel.Id.Entry === 'DEFEND_IRONCLAD');
    const r = document.querySelector('.stage-root').getBoundingClientRect(), k = r.width / 1920;
    return { x: r.left + h.GlobalPosition.X * k, from: r.top + (h.GlobalPosition.Y - 60) * k, to: r.top + 500 * k };
  });
  const before = await state();
  await page.mouse.move(drag.x, drag.from);
  await page.waitForTimeout(120);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(drag.x, drag.from + (drag.to - drag.from) * i / 6);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.waitForFunction((energy) => window.G.RunManager.Instance.State.Players[0].PlayerCombatState.Energy < energy, before.energy);
  assert.ok((await state()).block > before.block, 'playing Defend must grant block');
  await click(page.locator('.end-turn-btn.shown:not(.disabled)'));
  await page.waitForFunction(() => window.G.CombatManager.Instance.IsPlayPhase && window.G.CombatManager.Instance.DebugOnlyGetState().RoundNumber === 2);
  assert.equal((await state()).hand, 5, 'the second turn must draw cards');
  console.log('second turn', await state());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/second-turn.png` });

  // Finish the encounter after exercising normal input; reward collection still goes through the UI.
  await page.evaluate(async () => {
    const G = window.G, cm = G.CombatManager.Instance;
    for (const e of [...cm.DebugOnlyGetState().Enemies]) await G.CreatureCmd.Kill$Creature_Boolean(e, true);
    await cm.CheckWinCondition();
  });
  await page.waitForSelector('.rewards-screen');
  await click(page.locator('.reward-btn').filter({ hasText: '灯火钥匙' }));
  await page.waitForFunction(() => window.G.RunManager.Instance.State.Players[0].Deck.Cards.some((c) => c.Id.Entry === 'LANTERN_KEY'));
  await page.screenshot({ path: `${out}/key-claimed.png` });
  assert.deepEqual(errors, [], 'no page errors');
  console.log('OK: visible hand, reload, card play, next-turn draw and Lantern Key reward');
} catch (e) {
  await page.screenshot({ path: `${out}/fail.png` });
  console.error('FAIL', e, await state().catch(() => null), await page.evaluate(() => ({ ready: window.ui.room?.ready, disabled: window.ui.room?.disabled, options: window.ui.room?.options?.map((o) => o.TextKey) })).catch(() => null), errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
