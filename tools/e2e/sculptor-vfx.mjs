// Devoted Sculptor: idle particles stay off, animation events emit once, and later attacks can emit again.
// Usage: CHROME=<path> [URL=<dev server>] node tools/e2e/sculptor-vfx.mjs <outDir>
// Uses a fresh browser profile; requires Vite's /src modules for inspecting the rendered particle emitters.
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const out = process.argv[2] ?? '/tmp/sts2-sculptor-vfx';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=SCULPTORVFX&unlock=all&tutorials=off&lang=zhs');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await startRun(page);
  await page.evaluate(async () => {
    const G = window.G;
    await G.RunManager.Instance.EnterRoomDebug(G.RoomType.Monster, G.MapPointType.Unassigned, G.ModelDb.Encounter(G.DevotedSculptorWeak).ToMutable(), false);
    // Match Vite's timestamped URL so this is the stage module already used by the UI.
    const stageUrl = performance.getEntriesByType('resource').find((r) => new URL(r.name).pathname === '/src/render/stage.ts')?.name;
    window.__sculptorStage = await import(stageUrl ?? '/src/render/stage.ts');
  });
  await page.waitForFunction(() => {
    const cm = window.G.CombatManager.Instance;
    const stage = window.__sculptorStage.activeStage;
    return cm.IsInProgress && cm.IsPlayPhase && stage && [...stage.actors.values()].some((a) => /devoted_sculptor/.test(a.key) && a.spine);
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const actor = [...window.__sculptorStage.activeStage.actors.values()].find((a) => /devoted_sculptor/.test(a.key));
    const active = () => {
      const result = [];
      const visit = (c) => {
        const e = c.emitter;
        if (e && !e.done) result.push(e.it.p);
        for (const child of c.children ?? []) visit(child);
      };
      visit(actor.root);
      return result;
    };
    const probe = window.__sculptorVfx = { active, events: [], seen: [] };
    actor.spine.state.addListener({ event: (_, e) => probe.events.push(e.data.name) });
    window.G.$.onFrame(() => { for (const p of active()) if (!probe.seen.includes(p)) probe.seen.push(p); });
  });
  const active = () => page.evaluate(() => window.__sculptorVfx.active());
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${out}/idle.png` });
  assert.deepEqual(await active(), [], 'sculptor particles must be off before its first action');

  for (const [i, event, particle] of [[0, 'caw', 'VoiceParticles'], [1, 'attack', 'AttackParticles'], [2, 'attack', 'AttackParticles']]) {
    const round = await page.evaluate(() => {
      const G = window.G, rm = G.RunManager.Instance, cm = G.CombatManager.Instance;
      const round = cm.DebugOnlyGetState().RoundNumber;
      window.__sculptorVfx.events = [];
      window.__sculptorVfx.seen = [];
      rm.ActionQueueSynchronizer.RequestEnqueue(new G.EndPlayerTurnAction().$ctor_EndPlayerTurnAction(rm.State.Players[0], round));
      return round;
    });
    await page.waitForFunction((particle) => window.__sculptorVfx.active().some((p) => p.endsWith('/' + particle)), particle, { timeout: 15000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/action-${i + 1}.png` });
    await page.waitForFunction((round) => {
      const cm = window.G.CombatManager.Instance;
      return cm.IsPlayPhase && cm.DebugOnlyGetState().RoundNumber > round;
    }, round, { timeout: 30000 });
    await page.waitForTimeout(2200);
    const result = await page.evaluate(() => ({ events: window.__sculptorVfx.events, seen: window.__sculptorVfx.seen, active: window.__sculptorVfx.active() }));
    assert.ok(result.events.includes(event), `action ${i + 1} must fire ${event}`);
    assert.ok(result.seen.some((p) => p.endsWith('/' + particle)), `action ${i + 1} must show ${particle}`);
    assert.deepEqual(result.active, [], `action ${i + 1} particles must finish`);
    console.log(`action ${i + 1}`, JSON.stringify(result));
  }
  await page.screenshot({ path: `${out}/after-actions.png` });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('OK: idle off, cast and repeated attacks emit once and finish');
} catch (e) {
  await page.screenshot({ path: `${out}/fail.png` }).catch(() => {});
  console.error('FAIL', e, errors);
  console.error(await page.evaluate(() => ({ screen: window.ui?.screen, actors: [...(window.__sculptorStage?.activeStage?.actors?.values() ?? [])].map((a) => a.key) })).catch(() => null));
  process.exitCode = 1;
} finally {
  await browser.close();
}
