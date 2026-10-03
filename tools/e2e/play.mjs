// Autoplay the web build through the real UI: menu → run → rooms, screenshotting each new screen.
// Usage: node tools/e2e/play.mjs <outDir> [maxSteps]   (env CHROME=<chromium path>, URL=<dev server>, SEED=<run seed>, FAST=1, GOD=1, CHAR=1..5,
// VIEW=<w>x<h> and ASPECT=<setting> for another window size / aspect ratio setting: see start.mjs)
// Player paths beyond the rooms: POTIONS=1 uses a held potion each player turn (throw ones aimed at an enemy); VIEWS=1
// opens the deck (every 5th floor's map) and a combat pile (round 2) and closes them; SAVEQUIT=6,25 saves & quits on
// those floors' maps, reloads the page and continues; POSTRUN=1 follows the game over through the timeline back to the
// main menu and checks the run history and the cleared save; SAVECHECK=1 loads the run save the game wrote (as Continue
// does) on every floor's map and rebuilds a RunState from it. FULL=1 turns all five on.
// DUMP=<dir> copies the player's save files out at each of those points (see dump below): the old-save fixtures of
// packages/core/test/old-saves.test.ts are made this way.
// Exit code: 0 when the run reached the game-over screen (prints RESULT WIN/LOSS) or ran out of steps cleanly;
// 1 on a hang, a stuck/looping UI or uncaught page errors.
// CHROME: a Playwright chromium, e.g. `npx playwright install chromium-headless-shell` →
//   ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { toCharSelect, embark, viewport, setAspect } from './start.mjs';
const url = process.env.URL ?? 'http://127.0.0.1:47173/';
const out = process.argv[2] ?? '/tmp/sts2play';
const maxSteps = +(process.argv[3] ?? 400);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
// NETLOG blocks the service worker so every download shows up as a page request
const page = await browser.newPage({ viewport, ...(process.env.NETLOG ? { serviceWorkers: 'block' } : {}) });
const logs = [];
const logFile = `${out}/console.log`;
fs.writeFileSync(logFile, '');
const addLog = (l) => { logs.push(l); fs.appendFileSync(logFile, l + '\n'); };
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver/.test(m.text())) addLog(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => addLog(`[pageerror] ${e.message}\n${e.stack}`));
page.on('crash', () => console.log('RENDERER CRASHED'));
// NETLOG=<file>: every finished request (URL, body bytes, the floor it happened on) as JSON lines, for bandwidth costs
const netLog = process.env.NETLOG;
let netFloor = 'boot';
if (netLog) {
  fs.writeFileSync(netLog, '');
  page.on('requestfinished', async (req) => {
    const sizes = await req.sizes().catch(() => null);
    fs.appendFileSync(netLog, JSON.stringify({ t: Date.now(), floor: netFloor, url: req.url(), bytes: sizes?.responseBodySize ?? 0, type: req.resourceType() }) + '\n');
  });
}
// LANG_UI=<code> plays with that UI language (e.g. zhs); SEED fixes the run seed
// UNLOCK=0 plays a fresh profile (locked characters and epochs, first-run progression) instead of `?unlock=all`
const qs = new URLSearchParams({ ...(process.env.UNLOCK === '0' ? {} : { unlock: 'all' }), ...(process.env.SEED ? { seed: process.env.SEED } : {}), ...(process.env.LANG_UI ? { lang: process.env.LANG_UI } : {}) }).toString();
await page.goto(url + (qs ? `?${qs}` : ''));
await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
// FAST=1 → the game's own Instant fast mode (PrefsSave.FastMode), so combats resolve without animation waits
const FULL = !!process.env.FULL;
const flags = { potions: FULL || !!process.env.POTIONS, views: FULL || !!process.env.VIEWS, saveCheck: FULL || !!process.env.SAVECHECK, saveQuit: (process.env.SAVEQUIT ?? (FULL ? '6,25,41' : '')).split(',').filter(Boolean).map(Number) };
const postRun = FULL || !!process.env.POSTRUN;
// page state the driver reads (set again after a reload; the save & quits already done are remembered out here)
const sqDone = new Set();
const setup = () => setAspect(page).then(() => page.evaluate(([g, f, fast]) => {
  if (g) window.__god = g;
  window.__flags = f;
  if (fast) window.G.SaveManager.Instance.PrefsSave.FastMode = window.G.FastModeType.Instant;
}, [process.env.GOD ?? '', { ...flags, saveQuit: flags.saveQuit.filter((f) => !sqDone.has(f)) }, !!process.env.FAST]));
await setup();
// DUMP=<dir>: every user:// file the player has at that point goes to <dir>/<point>/, and what the browser knew about
// them to <dir>/<point>.json: `fresh` on the first main menu, `f<floor>` after each save & quit and reload (before
// Continue), `postrun` on the main menu after the run.
const dumpDir = process.env.DUMP;
async function dump(point, facts = {}) {
  if (!dumpDir) return;
  const files = await page.evaluate(() => window.G.$.vfs.list('user://').map((p) => [p, window.G.$.vfs.read(p)]));
  fs.mkdirSync(path.join(dumpDir, point), { recursive: true });
  for (const [p, text] of files) {
    const f = path.join(dumpDir, point, p.slice('user://'.length));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  fs.writeFileSync(path.join(dumpDir, `${point}.json`), JSON.stringify({ query: qs, char: +(process.env.CHAR ?? 1), files: files.length, ...facts }, null, 2) + '\n');
}
await dump('fresh');
// HEAP=1: collect garbage before each heap sample (leak checks; slows the run)
if (process.env.HEAP) await page.evaluate(() => { window.__heap = true; });
await toCharSelect(page);
// CHAR=<n> picks the nth character button on the select screen (1 = Ironclad; order follows ModelDb.AllCharacters)
await embark(page, process.env.CHAR);
// first embark on a fresh profile asks whether to enable tutorials (NAcceptTutorialsFtue): yes, so the tips get exercised
await page.click('.vp-btn.yes', { timeout: 3000 }).catch(() => {}); // NAcceptTutorialsFtue
await page.waitForFunction(() => window.ui?.screen === 'run', null, { timeout: 60000 });

// One decision per call, made inside the page from what is on screen.
const step = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const click = (el) => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
  const rs = window.G?.RunManager?.Instance?.State;
  const room = rs?.CurrentRoom;
  const me = rs?.Players?.[0]?.Creature;
  // GOD=1 (test only): keep the player alive so the driver reaches bosses and act transitions
  if (window.__god && me && me.CurrentHp > 0 && me.CurrentHp < me.MaxHp) me.SetCurrentHpInternal(me.MaxHp);
  // GOD=2 also leaves every enemy at 1 HP, to walk the whole run (acts, bosses, ending) quickly
  if (window.__god === '2') for (const e of window.G.CombatManager.Instance.DebugOnlyGetState()?.Enemies ?? []) if (e.CurrentHp > 1) e.SetCurrentHpInternal(1);
  const info = { floor: rs?.TotalFloor, room: room?.constructor?.$name, hp: me ? `${me.CurrentHp}/${me.MaxHp}` : '', seed: rs?.Rng?.StringSeed, heapMB: (window.__heap && window.gc?.(), Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6)) };
  const act = (screen, el) => { if (el) { click(el); return { ...info, screen, did: true }; } return { ...info, screen, did: false }; };
  if (q('.gameover')) return { ...info, screen: 'gameover', done: true, win: !!room?.IsVictoryRoom };
  // first-time tips sit above everything: page through and confirm (everything answers the mouse: enter, press, release)
  const tapOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const tap = (screen, el) => (el ? { ...info, screen, did: true, tap: tapOf(el) } : { ...info, screen, did: false });
  if (q('.ftue')) return tap('ftue', q('.ftue-confirm') ?? q('.cr-arrow.right'));
  const F = window.__flags ?? {};
  // a deck / pile view opened by VIEWS: look, then leave through its back button
  if (window.ui.cardsView && q('.cards-screen')) return tap('pile-view', q('.cards-screen .back-btn.shown'));
  if (q('.map-screen') && q('.map-screen .mp.travelable')) {
    window.__done = window.__done ?? {};
    const fl = rs?.TotalFloor ?? 0;
    // SAVECHECK: the save written on entering this floor's map point must load back into a run
    if (F.saveCheck && !window.__done['sc' + fl]) {
      window.__done['sc' + fl] = true;
      try {
        const r = window.G.SaveManager.Instance.LoadRunSave();
        // a new run has no save until its first map point is entered (the act's MapRoom is entered unsaved)
        const none = fl === 0 && r.Status === window.G.ReadSaveStatus.FileNotFound;
        if (!r.Success && !none) throw new Error(`LoadRunSave: ${r.Status} ${r.ErrorMessage ?? ''}`);
        if (!none) window.G.RunState.FromSerializable(r.SaveData);
      } catch (e) { return { ...info, screen: 'savecheck', saveError: String(e?.stack ?? e).slice(0, 800) }; }
    }
    // SAVEQUIT: the outer loop quits from the pause menu, reloads and continues
    if (F.saveQuit?.includes(fl) && !window.__done['sq' + fl]) { window.__done['sq' + fl] = true; return { ...info, screen: 'savequit', saveQuit: true }; }
    if (F.views && fl % 5 === 0 && !window.__done['deck' + fl]) { window.__done['deck' + fl] = true; return tap('deck-view', q('.tb-deck')); }
  }
  if (q('.map-screen')) {
    // NMapPoint answers the mouse (enter, press, release): tap a travelable node once it is on screen
    const n = q('.map-screen .mp.travelable'), st = q('.stage-root').getBoundingClientRect(), r = n?.getBoundingClientRect();
    const y = r ? r.top + r.height / 2 : -1;
    if (!r || y < st.top + 80 || y > st.bottom - 40) return { ...info, screen: 'map', did: false };
    return { ...info, screen: 'map', did: true, tap: [r.left + r.width / 2, y] };
  }
  const top = window.ui.overlays[window.ui.overlays.length - 1];
  if (top && q('.grid-screen')) {
    if (top.preview) return tap('grid', q('.grid-preview .confirm-btn.shown'));
    const want = Math.max(1, top.min);
    if (top.selected.length < Math.min(want, top.cards.length)) {
      const i = top.cards.findIndex((c) => !top.selected.includes(c));
      return tap('grid', document.querySelectorAll('.card-grid .grid-holder .gh-card')[i]);
    }
    return tap('grid', q('.grid-screen > .confirm-btn.shown') ?? q('.grid-screen > .back-btn.shown'));
  }
  if (top && q('.choose-card-screen')) return top.clickable ? tap('choice', q('.choose-card-screen .gh-card')) : { ...info, screen: 'choice', did: false };
  if (top && q('.bundle-screen')) return top.picked < 0 ? tap('bundle', q('.bundle')) : tap('bundle', q('.bundle-preview .confirm-btn.shown'));
  if (top && q('.card-reward-screen')) return top.clickable ? tap('choice', q('.card-reward-screen .gh-card')) : { ...info, screen: 'choice', did: false };
  if (q('.rewards-screen')) {
    // a reward that stays unclaimed after a few clicks (e.g. potion slots full) is skipped, as a player would
    const r = [...document.querySelectorAll('.reward-btn')].find((el) => (window.__tries?.[el.textContent] ?? 0) < 3);
    if (r && top?.busy?.size === 0) { window.__tries = window.__tries ?? {}; window.__tries[r.textContent] = (window.__tries[r.textContent] ?? 0) + 1; return tap('rewards', r); }
    if (r) return { ...info, screen: 'rewards', did: false };
    window.__tries = {};
    return tap('rewards', q('.proceed-btn.shown'));
  }
  // Crystal Sphere minigame (under its own reward screen): divine fog cells (mouse enter / release) until the reading
  // ends, then leave through Proceed
  if (q('.crystal-sphere')) {
    const fog = [...document.querySelectorAll('.csph-cell:not(.open)')];
    return tap('crystal', q('.crystal-sphere .proceed-btn.shown') ?? fog[Math.floor(fog.length / 2)]);
  }
  if (q('.combat .combat-ui') || (q('.combat') && !q('.event'))) {
    // NEndTurnButton answers the mouse (enter, press, release)
    const etb = q('.end-turn-btn.shown:not(.disabled)'), er0 = etb?.getBoundingClientRect();
    const endTurn = () => (er0 ? { ...info, screen: 'combat', did: true, tap: [er0.left + er0.width / 2, er0.top + er0.height / 2] } : { ...info, screen: 'combat-wait' });
    // play a playable hand card with the mouse like a player: drag it up (and click an enemy for targeted cards)
    const cr = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance, hand = cr?.Ui?.Hand;
    // a play still open after our release waits for a click, as in the game: released over no enemy (the aimed one
    // died or left meanwhile) → NTargetManager's ClickMouseToTarget; released before the card reached the play zone →
    // NMouseCardPlay's click mode. Click a live enemy like a player would.
    if (hand?.currentPlay) {
      const e = q('.creature[data-side="enemy"]:not(.dead) .cr-hitbox');
      return e ? { ...info, screen: 'combat-wait', tap: tapOf(e) } : { ...info, screen: 'combat-wait' };
    }
    const stage = q('.stage-root').getBoundingClientRect(), k = stage.width / 1920;
    const vp = (x, y) => [stage.left + x * k, stage.top + y * k];
    // a thrown potion aims like a card: click a live enemy
    if (q('.combat.targeting')) {
      const e = q('.creature[data-side="enemy"]:not(.dead) .cr-hitbox');
      return e ? { ...info, screen: 'potion-aim', did: true, tap: tapOf(e) } : { ...info, screen: 'combat-wait' };
    }
    const cs = window.G.CombatManager.Instance.DebugOnlyGetState?.();
    if (etb && cs && !hand?.IsInCardSelection) {
      const turn = `${rs?.TotalFloor}:${cs.RoundNumber}`;
      // POTIONS: once per player turn, the first held potion: open its popup, press Drink / Throw (or close it if unusable)
      if (F.potions && window.__potTurn !== turn) {
        const pop = q('.potion-popup');
        if (pop) {
          window.__potTurn = turn;
          const use = pop.querySelectorAll('.potion-popup-btn')[0];
          return use && !use.classList.contains('disabled') ? tap('potion', use) : { ...info, screen: 'potion', did: true, tap: vp(960, 300) };
        }
        const slot = document.querySelector('.tb-potion:not(.empty)');
        if (slot) return tap('potion', slot);
        window.__potTurn = turn;
      }
      // VIEWS: the draw pile once per combat, on round 2
      if (F.views && cs.RoundNumber === 2 && !window.__done?.['pile' + rs?.TotalFloor]) {
        window.__done = { ...window.__done, ['pile' + rs?.TotalFloor]: true };
        const pile = q('.pile-btn.draw');
        if (pile) return tap('pile-view', pile);
      }
    }
    // NPlayerHand selection mode (CardSelectCmd.FromHand, e.g. True Grit+): press hand cards until Confirm lights up
    if (hand?.IsInCardSelection) {
      const ok = q('.combat-ui .confirm-btn.shown'), s = hand.ActiveHolders[0]?.GlobalPosition;
      return ok ? tap('hand-select', ok) : { ...info, screen: 'hand-select', did: !!s, tap: s && vp(s.X, s.Y - 60) };
    }
    const h = hand?.ActiveHolders.find((x) => x.hitboxEnabled && x.CardModel?.CanPlay$0?.());
    if (h) {
      const g = h.GlobalPosition, T = window.G.TargetType, tt = h.CardModel.TargetType;
      const enemy = [...document.querySelectorAll('.creature[data-side="enemy"]:not(.dead) .cr-hitbox')][0];
      const er = enemy?.getBoundingClientRect();
      const to = tt === T.AnyEnemy && er ? [er.left + er.width / 2, er.top + er.height / 2] : null;
      if (tt === T.AnyEnemy && !to) return endTurn();
      return { ...info, screen: 'combat', did: true, play: { from: vp(g.X, g.Y - 60), up: vp(g.X, 500), to } };
    }
    return endTurn();
  }
  if (q('.event')) {
    // NEventOptionButton: mouse press / release once it has slid in; ancients advance their dialogue on any click
    if (q('.anc-hitbox')) return tap('event', q('.anc-hitbox'));
    const view = window.ui.room;
    // repeatable events (Abyssal Baths…) offer the same first option forever: after a few picks, take the last one
    const open = (view?.options ?? []).map((o, i) => [o, i]).filter(([o]) => !o.IsLocked);
    const key = `${rs?.TotalFloor}:${view?.optionsGen ?? ''}`;
    window.__evPicks = window.__evPicks ?? {};
    const n = Object.keys(window.__evPicks).filter((k) => k.startsWith(`${rs?.TotalFloor}:`)).length;
    const pick = open.length ? open[n >= 4 ? open.length - 1 : 0][1] : -1;
    if (pick < 0 || view.disabled) return { ...info, screen: 'event', did: false };
    window.__evPicks[key] = true;
    return tap('event', document.querySelectorAll('.event-option')[pick]);
  }
  // rest: alternate between the options (smith exercises the manual-confirm deck picker)
  // rest: alternate between the enabled options (smith exercises the upgrade grid), then proceed once it is offered
  if (q('.rest')) {
    const view = window.ui.room;
    if (view.proceedOn) return tap('rest', q('.proceed-btn.shown'));
    if (view.disabled) return { ...info, screen: 'rest', did: false };
    const opts = view.options.map((o, i) => [o, i]).filter(([o]) => o.IsEnabled);
    const pick = opts[(rs?.TotalFloor ?? 0) % Math.max(1, opts.length)];
    return pick ? tap('rest', document.querySelectorAll('.rest-btn')[pick[1]]) : { ...info, screen: 'rest', did: false };
  }
  // shop: open the rug (the merchant), buy the card removal and one affordable item per visit, close it (back) and leave (proceed)
  if (q('.shop')) {
    const view = window.ui.room.custom ?? window.ui.room, inv = view.inv; // the Fake Merchant's room is an event's scene
    const shopped = window.__shopped?.[rs?.TotalFloor];
    if (!view.open) return shopped ? tap('shop', q('.shop > .proceed-btn.shown')) : tap('shop', q('.merchant-btn'));
    if (view.fx.RugY !== 80) return { ...info, screen: 'shop', did: false };
    if ((shopped ?? 0) < 2) {
      window.__shopped = { ...window.__shopped, [rs?.TotalFloor]: (shopped ?? 0) + 1 };
      // card removal first (its deck picker, an overlay, must open over the rug and take the taps), then one item
      const stocked = Array.from(window.G.$.iter(inv.AllEntries)).filter((x) => x.IsStocked && x.EnoughGold && view.slotEls.get(x)?.querySelector('.shop-hit'));
      const removal = stocked.find((x) => x === inv.CardRemovalEntry), item = stocked.find((x) => x !== inv.CardRemovalEntry);
      const e = shopped ? item : removal ?? item;
      if (e) return tap('shop', view.slotEls.get(e).querySelector('.shop-hit'));
    }
    return tap('shop', q('.shop-inv .back-btn.shown'));
  }
  // treasure: the chest, then the relic once it has risen (it takes clicks after its entrance), then proceed
  if (q('.treasure')) {
    const view = window.ui.room;
    if (!view.opened) return tap('treasure', q('.chest-btn'));
    if (view.claimed) return tap('treasure', q('.treasure > .proceed-btn.shown'));
    return view.clickable && !view.selectionOff ? tap('treasure', q('.relic-holder-t')) : { ...info, screen: 'treasure', did: false };
  }
  return { ...info, screen: 'idle' };
});

// Watchdog: if the page stops answering, pause it via CDP and print where the main thread is spinning.
const cdp = await page.context().newCDPSession(page);
await cdp.send('Debugger.enable');
async function dumpHang() {
  const paused = new Promise((r) => cdp.once('Debugger.paused', r));
  await withTimeout(cdp.send('Debugger.pause'), 5000).catch(() => {});
  const ev = await withTimeout(paused, 5000).catch(() => null);
  if (!ev) { console.log('HANG: page did not pause (renderer dead?)'); return; }
  console.log('HANG stack:\n' + ev.callFrames.slice(0, 25).map((f) => `  ${f.functionName || '<anon>'} ${f.url.replace(/^.*\/(src|@fs)\//, '')}:${f.location.lineNumber + 1}`).join('\n'));
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// SNAP_FLOORS=6,42: heap snapshot summary (per constructor) on the map screen of those floors, then a diff
const snapFloors = new Set((process.env.SNAP_FLOORS ?? '').split(',').filter(Boolean).map(Number));
const snaps = [];
async function heapSummary() {
  const chunks = [];
  const onChunk = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const snap = JSON.parse(chunks.join(''));
  const f = snap.snapshot.meta.node_fields, n = f.length, T = f.indexOf('type'), N = f.indexOf('name'), S = f.indexOf('self_size');
  const types = snap.snapshot.meta.node_types[0];
  const by = new Map();
  for (let i = 0; i < snap.nodes.length; i += n) {
    const t = types[snap.nodes[i + T]];
    if (t !== 'object' && t !== 'closure' && t !== 'array') continue;
    const k = `${t}:${snap.strings[snap.nodes[i + N]]}`;
    const e = by.get(k) ?? by.set(k, { count: 0, size: 0 }).get(k);
    e.count++; e.size += snap.nodes[i + S];
  }
  return by;
}
const mouseTap = async (sel) => {
  const at = await page.evaluate((q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, sel);
  if (!at) return false;
  await page.mouse.move(at[0], at[1]); await page.waitForTimeout(80); await page.mouse.down(); await page.mouse.up(); await page.mouse.move(5, 5);
  return true;
};
const runState = () => page.evaluate(() => { const rs = window.G.RunManager.Instance.State, p = rs?.Players?.[0]; return rs ? { floor: rs.TotalFloor, room: rs.CurrentRoom?.constructor?.$name, hp: p?.Creature?.CurrentHp, maxHp: p?.Creature?.MaxHp, gold: p?.Gold, deck: p?.Deck?.Cards?.length, relics: p?.Relics?.length } : null; });
async function saveQuitContinue(s) {
  sqDone.add(s.floor);
  // what Continue must restore: the run save the game last wrote (on entering a map point, or when a combat ended with
  // its rewards still to claim), not the live state — progress made in the room since is replayed, as in the game
  const saved = await page.evaluate(() => {
    const r = window.G.SaveManager.Instance.LoadRunSave(), p = r.SaveData?.Players?.[0];
    return r.Success && p ? { hp: p.CurrentHp, maxHp: p.MaxHp, gold: p.Gold, deck: p.Deck?.length ?? p.Deck?.Count, relics: p.Relics?.length ?? p.Relics?.Count } : null;
  });
  if (!saved) { console.log('savequit: no run save to continue from'); return false; }
  if (!(await mouseTap('.tb-settings'))) { console.log('savequit: no settings button'); return false; }
  await page.waitForSelector('.pause-btn', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const quit = await page.evaluate(() => { const b = [...document.querySelectorAll('.pause-btn:not(.disabled)')].pop()?.getBoundingClientRect(); return b ? [b.left + b.width / 2, b.top + b.height / 2] : null; });
  if (!quit) { console.log('savequit: no Save and Quit'); return false; }
  await page.mouse.move(quit[0], quit[1]); await page.waitForTimeout(80); await page.mouse.down(); await page.mouse.up(); await page.mouse.move(5, 5);
  if (!(await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 30000 }).then(() => true, () => false))) { console.log('savequit: did not reach the menu'); return false; }
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => window.ui?.screen === 'menu', null, { timeout: 60000 });
  await dump(`f${s.floor}`, { floor: s.floor, ...saved });
  await setup();
  await page.waitForTimeout(3200); // the menu fades in
  await page.screenshot({ path: `${out}/${String(++shots).padStart(3, '0')}-f${s.floor}-savequit-menu.png` });
  if (!(await mouseTap('.mm-continue'))) { console.log('savequit: no Continue on the menu'); return false; }
  if (!(await page.waitForFunction(() => window.ui?.screen === 'run' && window.G.RunManager.Instance.State?.CurrentRoom, null, { timeout: 60000 }).then(() => true, () => false))) { console.log('savequit: Continue did not load the run'); return false; }
  await page.waitForTimeout(1500);
  const after = await runState();
  const same = ['hp', 'maxHp', 'gold', 'deck', 'relics'].every((k) => saved[k] === after?.[k]) && after?.floor === s.floor;
  console.log(`savequit floor ${s.floor}: ${same ? 'restored the save' : 'MISMATCH'} save ${JSON.stringify(saved)} → run ${JSON.stringify(after)}`);
  await page.screenshot({ path: `${out}/${String(++shots).padStart(3, '0')}-f${s.floor}-continued.png` });
  return same;
}
/**
 * After the game over: the timeline (a run that obtained epochs opens it) — reveal each epoch, confirm its unlock
 * screens, leave — until the main menu has no submenu; then the run must be in the run history and the save cleared.
 */
async function afterRun() {
  const historyBefore = runHistoryCount0;
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => {
      const q = (s) => document.querySelector(s), box = (el) => { const r = el?.getBoundingClientRect(); return r && r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; };
      // still on NGameOverScreen: its button (Continue / Main Menu / Unlock) once it has risen
      if (window.ui.screen !== 'menu') return { where: window.ui.screen, at: box(q('.gameover .go-btn')) };
      const top = window.ui.menuStack[window.ui.menuStack.length - 1];
      if (!top) return { where: 'menu', idle: true };
      if (q('.ftue')) return { where: 'ftue', at: box(q('.ftue-confirm') ?? q('.cr-arrow.right')) };
      const btn = [...document.querySelectorAll('.tl-btn:not(.disabled)')].pop();
      if (btn) return { where: top + ':button', at: box(btn) };
      // an obtained epoch on screen (the strip is wider than the screen: scroll towards the others like a player)
      const slots = [...document.querySelectorAll('.tl-slot.obtained')].map(box).filter(Boolean);
      const seen = slots.find(([x]) => x > 60 && x < innerWidth - 60);
      if (seen) return { where: top + ':reveal', at: seen };
      if (slots.length) return { where: top + ':scroll', wheel: slots[0][0] < 60 ? 400 : -400, over: [innerWidth / 2, slots[0][1]] };
      const back = q('.back-btn.shown');
      if (back) return { where: top + ':back', at: box(back) };
      return { where: top + ':wait' };
    });
    // the menu fades in and opens the timeline 0.5 s later (OpenTimelineFromGameOverScreen): done once it stays put 5 s
    afterRun.idle = st.idle ? (afterRun.idle ?? 0) + 1 : 0;
    if (afterRun.idle >= 10) break;
    if (st.where !== afterRun.last) { console.log('after-run ' + st.where); afterRun.last = st.where; await page.screenshot({ path: `${out}/${String(++shots).padStart(3, '0')}-post-${st.where.replace(/[^a-z-]/gi, '_')}.png` }); }
    if (st.at) { await page.mouse.move(st.at[0], st.at[1]); await page.waitForTimeout(80); await page.mouse.down(); await page.mouse.up(); await page.mouse.move(5, 5); }
    if (st.wheel) { await page.mouse.move(st.over[0], st.over[1]); await page.mouse.wheel(0, st.wheel); await page.mouse.move(5, 5); }
    await page.waitForTimeout(st.at ? 900 : 500);
    if (i === 399) { console.log('after-run: stuck at ' + st.where); await page.screenshot({ path: `${out}/post-stuck.png` }); return false; }
  }
  const end = await page.evaluate(() => ({ history: [...window.G.SaveManager.Instance.GetAllRunHistoryNames()].length, hasRun: !!document.querySelector('.mm-continue'), screen: window.ui.screen }));
  console.log(`after-run: main menu, run history ${historyBefore} → ${end.history}, continue button ${end.hasRun ? 'STILL THERE' : 'gone'}`);
  await page.screenshot({ path: `${out}/${String(++shots).padStart(3, '0')}-post-menu.png` });
  return end.history === historyBefore + 1 && !end.hasRun;
}
const runHistoryCount0 = await page.evaluate(() => [...window.G.SaveManager.Instance.GetAllRunHistoryNames()].length);
let last = '', shots = 0, idle = 0, since = 0, failed = false, result = null;
for (let i = 0; i < maxSteps; i++) {
  let s;
  try { s = await withTimeout(step(), 4000); } catch { await dumpHang(); failed = true; break; }
  if (s.screen === 'map' && snapFloors.has(s.floor)) {
    snapFloors.delete(s.floor);
    snaps.push({ floor: s.floor, by: await heapSummary() });
    if (snaps.length === 2) {
      const [a, b] = snaps;
      const rows = [...b.by].map(([k, v]) => ({ k, dc: v.count - (a.by.get(k)?.count ?? 0), ds: v.size - (a.by.get(k)?.size ?? 0) })).sort((x, y) => y.ds - x.ds).slice(0, 30);
      console.log(`heap growth floor ${a.floor} → ${b.floor} (after GC), top by retained size:`);
      for (const r of rows) console.log(`  ${(r.ds / 1e6).toFixed(2).padStart(7)}MB ${String(r.dc).padStart(8)} objs  ${r.k.slice(0, 120)}`);
    }
  }
  netFloor = s.floor ?? netFloor;
  const key = `${s.floor}:${s.screen}`;
  if (key !== last) {
    console.log(`#${i} seed=${s.seed} floor=${s.floor} room=${s.room} screen=${s.screen} hp=${s.hp} heap=${s.heapMB}MB`);
    try { await page.screenshot({ path: `${out}/${String(++shots).padStart(3, '0')}-f${s.floor}-${s.screen}.png`, timeout: 15000 }); }
    catch { console.log('screenshot timed out'); await dumpHang(); failed = true; break; }
    last = key;
    since = 0;
  }
  if (++since > 400) {
    console.log('looping', JSON.stringify(s));
    console.log('state', await page.evaluate(() => { const rs = window.G?.RunManager?.Instance?.State; return JSON.stringify({ room: String(rs?.CurrentRoom?.constructor?.$name ?? rs?.CurrentRoom), coord: rs?.CurrentMapCoord, point: !!rs?.CurrentMapPoint, visited: rs?.VisitedMapCoords?.length, mapScreen: (() => { const m = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Screens.Map.NMapScreen').Instance; return { traveling: m?.IsTraveling, open: m?.IsOpen, nrunMap: window.G.$.ext('MegaCrit.Sts2.Core.Nodes.NRun').Instance?.GlobalUi?.MapScreen === m }; })(), ui: { screen: window.ui.screen, map: window.ui.mapOpen, room: window.ui.room?.kind, overlays: window.ui.overlays.map((o) => o.kind) } }); }).catch((e) => String(e)));
    await page.screenshot({ path: `${out}/looping.png` });
    failed = true;
    break;
  }
  if (s.done) {
    result = s.win ? 'WIN' : 'LOSS';
    // NGameOverScreen: Continue once it has slid in, then (after the summary) Main Menu / Unlock → the timeline
    const press = async () => {
      const at = await page.evaluate(() => { const b = document.querySelector('.gameover .go-btn')?.getBoundingClientRect(); return b ? [b.left + b.width / 2, b.top + b.height / 2] : null; });
      if (!at) return false;
      await page.mouse.move(at[0], at[1]); await page.waitForTimeout(80); await page.mouse.down(); await page.mouse.up(); await page.mouse.move(5, 5);
      return true;
    };
    for (let i = 0; i < 60 && !(await press()); i++) await page.waitForTimeout(250);
    await page.waitForTimeout(700);
    for (let i = 0; i < 80 && (await page.evaluate(() => !!document.querySelector('.gameover .go-btn'))) === false; i++) await page.waitForTimeout(250);
    await press();
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.ui.screen);
    console.log(`after game over: ${after}`);
    await page.screenshot({ path: `${out}/${String(++shots).padStart(3, '0')}-after-${after}.png` });
    if (postRun && !(await afterRun())) failed = true;
    if (postRun) await dump('postrun', { result, history: await page.evaluate(() => [...window.G.SaveManager.Instance.GetAllRunHistoryNames()].length) });
    break;
  }
  if (s.saveError) { console.log(`SAVE CHECK FAILED on floor ${s.floor}: ${s.saveError}`); failed = true; break; }
  if (s.saveQuit) {
    // pause (top-bar settings) → Save and Quit → reload (the save must survive in IndexedDB) → Continue
    const ok = await saveQuitContinue(s);
    if (!ok) { failed = true; break; }
    last = '';
    continue;
  }
  if (s.tap) {
    await page.mouse.move(s.tap[0], s.tap[1]);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.mouse.move(5, 5);
  }
  if (s.play) {
    const { from, up, to } = s.play;
    await page.mouse.move(from[0], from[1]);
    await page.waitForTimeout(120);
    await page.mouse.down();
    for (let j = 1; j <= 6; j++) { await page.mouse.move(from[0] + ((up[0] - from[0]) * j) / 6, from[1] + ((up[1] - from[1]) * j) / 6); await page.waitForTimeout(30); }
    if (to) { for (let j = 1; j <= 6; j++) { await page.mouse.move(up[0] + ((to[0] - up[0]) * j) / 6, up[1] + ((to[1] - up[1]) * j) / 6); await page.waitForTimeout(30); } }
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.mouse.move(5, 5);
  }
  idle = s.did ? 0 : idle + 1;
  if (idle > 40) {
    console.log('stuck', JSON.stringify(s));
    console.log('combat', await page.evaluate(() => {
      const cs = window.G.CombatManager.Instance.DebugOnlyGetState?.();
      const hand = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance?.Ui?.Hand;
      return JSON.stringify({ enemies: (cs?.Enemies ?? []).map((e) => e.Monster?.Id?.Entry), play: !!hand?.currentPlay,
        hitboxes: [...document.querySelectorAll('.creature[data-side="enemy"] .cr-hitbox')].map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); }) });
    }).catch((e) => String(e)));
    await page.screenshot({ path: `${out}/stuck.png` }); failed = true; break;
  }
  await page.waitForTimeout(s.did ? 350 : 500);
}

console.log(logs.slice(0, 20).map((l) => l.slice(0, 400)).join('\n'));
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]')).length;
if (process.env.PROBE) {
  await page.evaluate(() => { const q = window.G.RunManager.Instance.ActionQueueSynchronizer; const f = q.RequestEnqueue; window.__enq = []; q.RequestEnqueue = function (a) { window.__enq.push(a?.constructor?.$name); return f.apply(this, arguments); };
    window.__ev = []; for (const t of ['pointerover', 'pointerenter', 'pointerdown', 'pointerup']) document.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.target.className?.baseVal ?? e.target.className)), true); });
  const at = await page.evaluate(() => { const r = document.querySelector('.mp.travelable').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(at[0], at[1]); await page.waitForTimeout(100); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(1500);
  console.log('enq', await page.evaluate(() => JSON.stringify({ enq: window.__enq, ev: window.__ev.slice(0, 12) })), at);
  console.log('elementAt', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.className + ' < ' + e?.parentElement?.className + ' < ' + e?.parentElement?.parentElement?.className; }, at));
}
if (process.env.PROBE) console.log('probe', await page.evaluate(() => { const m = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Screens.Map.NMapScreen').Instance; return JSON.stringify({ traveling: m?.IsTraveling, open: m?.IsOpen, trav: [...document.querySelectorAll('.mp.travelable')].length, exec: window.G.RunManager.Instance.ActionExecutor?.IsRunning, act: window.G.RunManager.Instance.ActionExecutor?.CurrentlyRunningAction?.constructor?.$name }); }));
console.log(`RESULT ${result ?? (failed ? 'FAILED' : 'UNFINISHED')} floor=${last.split(':')[0]} errors=${logs.filter((l) => l.startsWith('[error]')).length} pageerrors=${pageErrors}`);
await browser.close();
process.exit(failed || pageErrors ? 1 : 0);
