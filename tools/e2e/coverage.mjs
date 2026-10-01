// Browser coverage through the real web bridge (TestMode off, the path players hit): every card played, every event
// option path, every encounter fought, every potion used, every relic carried through a fight. Each item that logs an
// error, throws, or leaves the game busy is reported.
// Usage: CHROME=<path> [URL=<build>] node tools/e2e/coverage.mjs <outDir> [cards,events,encounters,potions,relics] [filter]
// Exit code 1 when any item failed. Results also go to <outDir>/coverage.json.
import { chromium } from 'playwright';
import { startRun } from './start.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? '/tmp/sts2cov';
const modes = (process.argv[3] ?? 'cards,events,encounters,potions,relics').split(',');
const filter = process.argv[4] ? new RegExp(process.argv[4], 'i') : null;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
let page;
let fastMode = 'Instant';
let logs = [];
const IGNORE = /GL Driver|GPU stall|WebGL|Autofocus/;

async function openRun() {
  await page?.close().catch(() => {});
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.test(m.text())) logs.push(`[${m.type()}] ${m.text().slice(0, 600)}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));
  await page.goto((process.env.URL ?? 'http://127.0.0.1:47173/') + '?seed=COVERAGE&unlock=all&tutorials=off');
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await page.evaluate((m) => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType[m]; }, fastMode);
  // CHAR=<n>: play as the nth character (cards mode then covers that character's own pool)
  await startRun(page, { char: process.env.CHAR });
  await page.evaluate(installDriver);
}

// ------------------------------------------------------------------ in-page driver
function installDriver() {
  const G = window.G;
  G.$.onFrame(() => { window.__frames = (window.__frames ?? 0) + 1; });
  // tweens something is waiting on (reported when an item stalls)
  const waiting = (window.__tweenWaits = new Set());
  const whenFinished = G.$.WebTween.prototype.whenFinished;
  G.$.WebTween.prototype.whenFinished = function (done) {
    const t = this, stack = new Error().stack.split('\n').slice(2, 8).map((l) => l.trim().replace(/\(?http[^)]*\/js\//, '(')).join(' | ');
    const info = { toJSON: () => ({ steps: t.steps?.map((s) => s.map((tw) => [tw.delay, tw.dur, tw.begun, tw.ended])), idx: t.idx, stepTime: t.stepTime, state: t.state, started: t.started, stack }) };
    waiting.add(info);
    return whenFinished.call(this, () => { waiting.delete(info); done(); });
  };
  const rm = () => G.RunManager.Instance;
  const cm = () => G.CombatManager.Instance;
  const me = () => rm().State.Players[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d = (window.__cov = {
    /** Resolve the top overlay the way a player would; true if it acted. */
    answer() {
      const o = window.ui.overlays[window.ui.overlays.length - 1];
      if (!o) return false;
      if (o.kind === 'cardchoice') {
        if (o.alternatives) { o.skip(); return true; }
        if (o.groups) { o.toggle(o.groups[0][0]); return true; }
        const want = Math.max(o.min, Math.min(1, o.max));
        const next = o.cards.find((c) => !o.selected.includes(c));
        if (o.selected.length < want && next) { o.toggle(next); return true; }
        if (o.canConfirm) { o.confirm(); return true; }
        if (o.canSkip) { o.skip(); return true; }
        return false;
      }
      if (o.kind === 'grid') {
        // deck select / upgrade / transform / enchant grids: pick the minimum (at least one), then confirm or its preview
        if (o.preview) { o.confirmPreview(); return true; }
        const next = o.cards.find((c) => !o.selected.includes(c));
        if (o.selected.length < Math.max(o.min, 1) && next) { o.click(next); return true; }
        if (o.confirmEnabled) { o.confirm(); return true; }
        if (o.cancelable) { o.close(); return true; }
        return false;
      }
      if (o.kind === 'bundle') { if (o.picked < 0) o.pick(0); else o.confirm([]); return true; }
      if (o.kind === 'chooseacard') { if (!o.clickable) return false; o.select(o.cards[0]); return true; }
      if (o.kind === 'rewards' && !o.isTerminal) { o.proceed(); return true; }
      if (o.kind === 'crystalsphere') {
        if (o.done) { o.close(); return true; }
        if (o.game.IsFinished) return false; // its rewards come up next
        if (o.busy) return false;
        const hidden = [...o.game.cells].flatMap((col) => [...col]).filter((c) => c.IsHidden);
        if (hidden.length) { o.click(hidden[Math.floor(hidden.length / 2)]); return true; }
        return false;
      }
      return false;
    },
    /** Await a game Task while answering the prompts it opens (on-obtain card picks, reward screens). */
    async run(task, maxMs = 15000) {
      let done = false, err = null;
      Promise.resolve(task).then(() => { done = true; }, (e) => { done = true; err = e; });
      const t0 = performance.now();
      while (!done && performance.now() - t0 < maxMs) { d.answer(); await sleep(20); }
      if (err) throw err;
      return done;
    },
    /** What the game is waiting on when an item does not settle. */
    stallInfo() {
      const ex = rm().ActionExecutor, act = ex?.CurrentlyRunningAction;
      return JSON.stringify({ running: !!ex?.IsRunning, paused: !!ex?.IsPaused, action: act?.constructor?.$name, card: act?.NetCombatCard?.ToCardModelOrNull?.()?.Id?.Entry ?? act?.Card?.Id?.Entry,
        playPhase: cm().IsPlayPhase, frames: window.__frames ?? 0, hand: me().PlayerCombatState?.Hand?.Cards?.length, draw: me().PlayerCombatState?.DrawPile?.Cards?.length,
        discard: [...(me().PlayerCombatState?.DiscardPile?.Cards ?? [])].map((c) => c.Id.Entry).join(' ').slice(0, 200),
        powers: [...(me().Creature?.Powers ?? [])].map((p) => p.Id.Entry).join(' '),
        overlays: window.ui.overlays.map((o) => o.kind), tweens: [...(window.__tweenWaits ?? [])].slice(0, 4), frameFns: window.__frameCount?.() });
    },
    busy() { return !!rm().ActionExecutor?.IsRunning || (cm().IsInProgress && !cm().IsPlayPhase); },
    /** Wait until the action queue is idle (answering prompts); false on timeout. */
    async settle(maxMs = 8000) {
      const t0 = performance.now();
      let quiet = 0;
      while (performance.now() - t0 < maxMs) {
        await sleep(15);
        if (d.answer()) { quiet = 0; continue; }
        if (!d.busy()) { if (++quiet >= 6) return true; } else quiet = 0;
      }
      return false;
    },
    god() {
      const c = me().Creature;
      if (c.IsAlive && c.MaxHp < 80) c.SetMaxHpInternal(80); // events that cost max HP add up over the sweep
      if (c.IsAlive && c.CurrentHp < c.MaxHp) c.SetCurrentHpInternal(c.MaxHp);
      const pcs = me().PlayerCombatState;
      if (pcs && cm().IsInProgress) { pcs.Energy = 9; if ('Stars' in pcs) pcs.Stars = 9; }
    },
    async fight(encounter) {
      const enc = (encounter ?? G.ModelDb.Encounter(G.MockTwoMonsterEncounter)).ToMutable();
      await rm().EnterRoomDebug(G.RoomType.Monster, G.MapPointType.Unassigned, enc, false);
      const t0 = performance.now();
      while (!(cm().IsInProgress && cm().IsPlayPhase) && performance.now() - t0 < 10000) { d.answer(); await sleep(20); }
      return cm().IsInProgress;
    },
    async endTurn() {
      const cs = cm().DebugOnlyGetState();
      const round = cs.RoundNumber;
      rm().ActionQueueSynchronizer.RequestEnqueue(new G.EndPlayerTurnAction().$ctor_EndPlayerTurnAction(me(), round));
      const t0 = performance.now();
      while (cm().IsInProgress && !(cm().IsPlayPhase && cm().DebugOnlyGetState()?.RoundNumber > round) && performance.now() - t0 < 10000) { d.god(); d.answer(); await sleep(20); }
      return !cm().IsInProgress || cm().IsPlayPhase;
    },
    /** Kill every enemy (phases may revive) and leave through the rewards like a player. */
    async win() {
      for (let i = 0; i < 6 && cm().IsInProgress; i++) {
        for (const e of [...cm().DebugOnlyGetState().Enemies]) if (e.IsAlive) await G.CreatureCmd.Kill$Creature_Boolean(e, true);
        await cm().CheckWinCondition(); // actions check it after resolving; a direct Kill does not
        await d.settle(4000);
        // some bosses refuse to die (Waterfall Giant blows up on its next turn): let the enemies act
        if (cm().IsInProgress && cm().IsPlayPhase) await d.endTurn();
      }
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        const o = window.ui.overlays[window.ui.overlays.length - 1];
        if (o?.kind === 'rewards' && o.isTerminal) { o.proceed(); await sleep(50); break; }
        if (!d.answer()) await sleep(20);
      }
      await d.settle(3000);
      if (cm().IsInProgress) window.__covWhy = { alive: [...cm().DebugOnlyGetState().Enemies].filter((e) => e.IsAlive).map((e) => `${e.Monster?.Id?.Entry}:${e.CurrentHp}`), overlays: window.ui.overlays.map((o) => o.kind) };
      return !cm().IsInProgress;
    },
    target(card, cs) {
      const cands = [...cs.Enemies.filter((e) => e.IsHittable), me().Creature, ...cs.Allies];
      return cands.find((t) => { try { return card.IsValidTarget(t); } catch { return false; } }) ?? null;
    },
    async card(id) {
      if (!cm().IsInProgress && !(await d.fight())) return { skip: 'no fight' };
      const cs = cm().DebugOnlyGetState();
      d.god();
      for (const e of cs.Enemies) if (e.IsAlive) e.SetCurrentHpInternal(Math.max(e.CurrentHp, 9000));
      const hand = me().PlayerCombatState.Hand;
      if (hand.Cards.length >= 7) for (const c of [...hand.Cards]) hand.RemoveInternal(c, true);
      const canonical = [...G.ModelDb.AllCards].find((c) => c.Id.Entry === id);
      const card = cs.CreateCard$CardModel_Player(canonical, me());
      hand.AddInternal(card, -1, false);
      let played = card.TryManualPlay(null) || card.TryManualPlay(d.target(card, cs));
      const settled = await d.settle();
      if (!settled) console.warn('[cov] stalled: ' + d.stallInfo());
      // take the tested card out of combat so it does not leak into later items (MAD_SCIENCE logs whenever drawn)
      if (settled) {
        // every copy, wherever it went (played, shuffled, copied): MAD_SCIENCE logs whenever its description formats
        for (const pile of [...me().PlayerCombatState.AllPiles]) for (const c of [...pile.Cards]) if (c.Id.Entry === id) try { pile.RemoveInternal(c, true); } catch { /* already gone */ }
        // and a node the play left behind (the bare MAD_SCIENCE never finishes its play)
        const walk = (n) => { for (const k of [...(n?.$kids ?? [])]) { if (k.Model?.Id?.Entry === id && !k.Model.Pile) k.QueueFree?.(); else walk(k); } };
        walk(G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance?.Ui);
      }
      if (++d.n % 10 === 0 && cm().IsInProgress) await d.endTurn();
      return { played, settled };
    },
    n: 0,
    async potion(id) {
      if (!cm().IsInProgress && !(await d.fight())) return { skip: 'no fight' };
      const cs = cm().DebugOnlyGetState();
      d.god();
      const canonical = [...G.ModelDb.AllPotions].find((p) => p.Id.Entry === id);
      await d.run(G.PotionCmd.TryToProcure$3(canonical.ToMutable(), me(), -1));
      const p = [...me().Potions].filter(Boolean).pop();
      if (!p) return { skip: 'no slot' };
      const t = p.TargetType === G.TargetType.AnyEnemy ? cs.Enemies.find((e) => e.IsHittable) : p.TargetType === G.TargetType.TargetedNoCreature ? null : me().Creature;
      p.EnqueueManualUse(t);
      const settled = await d.settle();
      for (const q of [...me().Potions].filter(Boolean)) { try { await G.PotionCmd.Discard(q); } catch { /* slot already empty */ } }
      return { settled };
    },
    async encounter(id) {
      if (cm().IsInProgress) await d.win();
      const enc = [...G.ModelDb.AllEncounters].find((e) => e.Id.Entry === id);
      if (!(await d.fight(enc))) return { skip: 'did not start' };
      const turns = [await d.endTurn(), await d.endTurn(), await d.endTurn()];
      return { turns: turns.every(Boolean), won: await d.win() };
    },
    async relic(id) {
      if (cm().IsInProgress) await d.win();
      const canonical = [...G.ModelDb.AllRelics].find((r) => r.Id.Entry === id);
      const relic = canonical.ToMutable();
      // ancients offer some relics only after SetupForPlayer found what they work on (ARCHAIC_TOOTH: a transformable
      // starter card, which earlier relics in this shared run may have transformed already)
      if (relic.SetupForPlayer && !relic.SetupForPlayer(me())) return { skip: 'not offered: SetupForPlayer found nothing in this deck' };
      if (!(await d.run(G.RelicCmd.Obtain$3(relic, me(), -1)))) return { obtained: false };
      await d.settle();
      if (!(await d.fight())) return { skip: 'no fight' };
      const hand = [...me().PlayerCombatState.Hand.Cards];
      const cs = cm().DebugOnlyGetState();
      for (const c of hand.slice(0, 3)) { d.god(); c.TryManualPlay(null) || c.TryManualPlay(d.target(c, cs)); await d.settle(); }
      const turned = await d.endTurn();
      const won = await d.win();
      try { await d.run(G.RelicCmd.Remove(relic)); } catch { /* some relics cannot be removed */ }
      await d.settle();
      return { turned, won };
    },
    async event(id, first) {
      if (cm().IsInProgress) await d.win();
      d.god(); // one run hosts every event: start each at full HP with gold to spend
      if (me().Gold < 300) me().Gold = 300;
      const all = [...G.ModelDb.AllEvents, ...G.ModelDb.AllAncients];
      const ev = all.find((e) => e.Id.Entry === id);
      const isAncient = [...G.ModelDb.AllAncients].includes(ev);
      rm().State.AppendToMapPointHistory(isAncient ? G.MapPointType.Ancient : G.MapPointType.Unknown, G.RoomType.Event, ev.Id);
      await d.run(rm().EnterRoom(new G.EventRoom().$ctor_EventRoom$EventModel(ev)));
      await d.settle();
      const live = rm().EventSynchronizer.GetLocalEvent();
      const path = [];
      for (let step = 0; step < 12 && live && !live.IsFinished; step++) {
        const opts = [...(live.CurrentOptions ?? [])];
        if (!opts.length) break;
        let i = step === 0 ? first : opts.findIndex((o) => !o.IsLocked);
        if (i >= opts.length) return { skip: `option ${first} of ${opts.length}` };
        if (opts[i].IsLocked) { if (step === 0) return { skip: 'locked' }; i = Math.max(0, opts.findIndex((o) => !o.IsLocked)); }
        path.push(opts[i].TextKey?.split('.').pop());
        // choose through the UI view (NEventRoom.OptionButtonClicked): options stay hidden until the event's
        // StateChanged, so an option that awaits (Task.Delay, a combat) is not chosen twice
        const view = window.ui.room;
        if (view?.kind === 'event') view.choose(i); else rm().EventSynchronizer.ChooseLocalOption(i);
        for (let t = 0; t < 500 && view?.choosing && !cm().IsInProgress && !live.IsFinished; t++) { d.answer(); await sleep(20); }
        await d.settle();
        if (cm().IsInProgress) { await d.endTurn(); await d.win(); }
        await d.settle();
      }
      return { finished: !!live?.IsFinished, path: path.join('>') };
    },
  });
  d.god();
}

// ------------------------------------------------------------------ run
// items whose failure the original game shares (reported, not counted)
const EXPECTED = {
  'card:MAD_SCIENCE': 'its CardType var is only configured by the Tinker Time event; the bare card errors in the original too',
  'relic:SEA_GLASS': 'its character id is set by the event that grants it (the original logs "could have used the console")',
  'relic:DUSTY_TOME': 'its AncientCard is set by the Ancient that grants it',
  'relic:MASSIVE_SCROLL': 'offers MultiplayerOnly cards: an empty pool in single player',
  'relic:FUR_COAT': 'reads CurrentMapPoint, which debug fights (EnterRoomDebug) do not have',
};
const bad0 = (r, error) => !!(error || (r && (r.won === false)));
const results = [];
const fail = [];
async function runItem(kind, id, fn, timeout = 30000, arg = id) {
  logs = [];
  let r, error = null;
  try {
    r = await Promise.race([page.evaluate(fn, arg), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
  } catch (e) { error = String(e.message ?? e).split('\n')[0]; }
  const bad = error || logs.length || (r && (r.settled === false || r.turns === false || r.won === false || r.turned === false || r.obtained === false));
  const why = bad0(r, error) ? await page.evaluate(() => { const w = window.__covWhy; window.__covWhy = null; return w; }).catch(() => null) : null;
  const row = { kind, id, ...r, error, ...(why ? { why } : {}), logs: logs.slice(0, 5) };
  results.push(row);
  if (bad && EXPECTED[`${kind}:${id}`]) { row.expected = EXPECTED[`${kind}:${id}`]; return; }
  if (bad) {
    fail.push(row);
    console.log(`FAIL ${kind} ${id} ${JSON.stringify({ ...r, error })}\n  ${logs.slice(0, 3).join('\n  ')}`);
    // fresh page after a hang (a stalled action blocks every later item), or after a broken event (its state would leak)
    if (error === 'timeout' || r?.settled === false || /Target closed|crashed/.test(error ?? '') || kind === 'event') await openRun();
  }
}
const list = (expr, arg) => page.evaluate(expr, arg);

await openRun();
for (const mode of modes) {
  const t0 = Date.now();
  if (mode === 'cards') {
    const ids = await list((own) => [...(own ? window.G.RunManager.Instance.State.Players[0].Character.CardPool.AllCards : window.G.ModelDb.AllCards)].map((c) => c.Id.Entry), !!process.env.CHAR);
    for (const id of ids.filter((x) => !filter || filter.test(x))) await runItem('card', id, (x) => window.__cov.card(x));
  } else if (mode === 'potions') {
    const ids = await list(() => [...window.G.ModelDb.AllPotions].map((c) => c.Id.Entry));
    for (const id of ids.filter((x) => !filter || filter.test(x))) await runItem('potion', id, (x) => window.__cov.potion(x));
  } else if (mode === 'encounters') {
    const ids = await list(() => [...window.G.ModelDb.AllEncounters].map((c) => c.Id.Entry));
    for (const id of ids.filter((x) => !filter || filter.test(x))) await runItem('encounter', id, (x) => window.__cov.encounter(x), 60000);
  } else if (mode === 'relics') {
    fastMode = 'Instant';
    await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant; });
    const ids = await list(() => [...window.G.ModelDb.AllRelics].map((c) => c.Id.Entry));
    for (const id of ids.filter((x) => !filter || filter.test(x))) await runItem('relic', id, (x) => window.__cov.relic(x), 45000);
  } else if (mode === 'events') {
    // Fast, not Instant: event layouts run animation loops (PunchOff) that only yield through real waits
    fastMode = 'Fast';
    await page.evaluate(() => { window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Fast; });
    const ids = await list(() => [...window.G.ModelDb.AllEvents, ...window.G.ModelDb.AllAncients].map((c) => c.Id.Entry));
    for (const id of ids.filter((x) => !filter || filter.test(x)))
      for (let first = 0; first < 4; first++) {
        await runItem('event', `${id}#${first}`, ([x, f]) => window.__cov.event(x, f), 60000, [id, first]);
        const last = results[results.length - 1];
        if (last?.skip) { results.pop(); break; } // no such option
      }
  }
  const n = results.filter((r) => r.kind === mode.replace(/s$/, '')).length;
  console.log(`${mode}: ${n} items, ${fail.filter((r) => r.kind === mode.replace(/s$/, '')).length} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
fs.writeFileSync(`${out}/coverage.json`, JSON.stringify({ results, fail }, null, 1));
console.log(`RESULT ${fail.length ? 'FAILED' : 'OK'}: ${results.length} items, ${fail.length} failed`);
await browser.close();
process.exit(fail.length ? 1 : 0);
