// Records the gameplay clips for the intro video: one seeded run played through the real UI under the virtual clock.
// Usage: node tools/video/capture.mjs   (URL=<build>, default the preview on :47190; FLOORS=<last floor>, default 17)
import { open, center } from './cap-lib.mjs';
const SEED = process.env.SEED ?? 'VIDEO1';
const LAST = +(process.env.FLOORS ?? 17);
const { browser, page, vt, rec, mouse } = await open(`unlock=all&tutorials=off&lang=zhs&seed=${SEED}`);
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('[nav]', f.url()); });
const fast = (on) => page.evaluate((f) => { const p = window.G.SaveManager.Instance.PrefsSave; p.FastMode = f ? window.G.FastModeType.Fast : window.G.FastModeType.Normal; }, on);
const click = async (sel, ms) => { const at = await center(page, sel); if (!at) throw new Error('no ' + sel); await mouse.click(at[0], at[1], ms); };

// ── menu → character select → embark ─────────────────────────────────────────────────────────────────────────────
await vt.until(() => window.ui?.screen === 'menu');
rec.start('menu');
await rec.play(4000); // NMainMenu fades in from black
await mouse.move(...await center(page, '.mm-single_player'), 700);
await rec.play(1200);
await click('.mm-single_player', 200);
await rec.play(400);
rec.stop();
await vt.until(() => document.querySelector('.charselect .confirm-btn.shown'));
rec.start('charselect');
await rec.play(1200);
for (const i of [2, 3, 4, 5, 1]) { await click(`.chs-buttons > :nth-child(${i})`, 350); await rec.play(1700); }
await click('.charselect .confirm-btn.shown', 400);
await rec.play(2500);
rec.stop();

// ── one decision per call, read from the screen (a trimmed tools/e2e/play.mjs step) ────────────────────────────────
const decide = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const at = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; };
  const rs = window.G?.RunManager?.Instance?.State, room = rs?.CurrentRoom, me = rs?.Players?.[0]?.Creature;
  if (me && me.CurrentHp > 0 && me.CurrentHp < me.MaxHp * 0.6) me.SetCurrentHpInternal(me.MaxHp); // keep the run alive
  const RT = window.G.RoomType, rt = room?.RoomType;
  const kinds = { [RT.Monster]: 'combat', [RT.Elite]: 'elite', [RT.Boss]: 'boss', [RT.Treasure]: 'treasure', [RT.Shop]: 'shop', [RT.Event]: 'event', [RT.RestSite]: 'rest' };
  const info = { floor: rs?.TotalFloor ?? 0, room: room?.constructor?.$name ?? '', kind: kinds[rt] ?? null };
  const tap = (screen, el) => ({ ...info, screen, tap: at(el) });
  if (q('.gameover')) return { ...info, screen: 'gameover' };
  if (q('.ftue')) return tap('ftue', q('.ftue-confirm') ?? q('.cr-arrow.right'));
  if (q('.map-screen')) {
    const n = q('.map-screen .mp.travelable'), st = q('.stage-root').getBoundingClientRect(), p = at(n);
    return { ...info, screen: 'map', tap: p && p[1] > st.top + 80 && p[1] < st.bottom - 40 ? p : null };
  }
  const top = window.ui.overlays[window.ui.overlays.length - 1];
  if (top && q('.grid-screen')) {
    if (top.preview) return tap('grid', q('.grid-preview .confirm-btn.shown'));
    if (top.selected.length < Math.min(Math.max(1, top.min), top.cards.length)) {
      const i = top.cards.findIndex((c) => !top.selected.includes(c));
      return tap('grid', document.querySelectorAll('.card-grid .grid-holder .gh-card')[i]);
    }
    return tap('grid', q('.grid-screen > .confirm-btn.shown') ?? q('.grid-screen > .back-btn.shown'));
  }
  if (top && q('.choose-card-screen')) return top.clickable ? tap('choice', q('.choose-card-screen .gh-card')) : { ...info, screen: 'choice' };
  if (top && q('.bundle-screen')) return top.picked < 0 ? tap('bundle', q('.bundle')) : tap('bundle', q('.bundle-preview .confirm-btn.shown'));
  if (top && q('.card-reward-screen')) return top.clickable ? tap('cardreward', document.querySelectorAll('.card-reward-screen .gh-card')[1] ?? q('.card-reward-screen .gh-card')) : { ...info, screen: 'cardreward' };
  if (q('.rewards-screen')) {
    const r = [...document.querySelectorAll('.reward-btn')].find((el) => (window.__tries?.[el.textContent] ?? 0) < 3);
    if (r && top?.busy?.size === 0) { window.__tries = window.__tries ?? {}; window.__tries[r.textContent] = (window.__tries[r.textContent] ?? 0) + 1; return tap('rewards', r); }
    if (r) return { ...info, screen: 'rewards' };
    window.__tries = {};
    return tap('rewards', q('.proceed-btn.shown'));
  }
  if (q('.crystal-sphere')) { const fog = [...document.querySelectorAll('.csph-cell:not(.open)')]; return tap('crystal', q('.crystal-sphere .proceed-btn.shown') ?? fog[Math.floor(fog.length / 2)]); }
  if (q('.combat .combat-ui') || (q('.combat') && !q('.event'))) {
    const cr = window.G.$.ext('MegaCrit.Sts2.Core.Nodes.Rooms.NCombatRoom').Instance, hand = cr?.Ui?.Hand;
    const enemy = q('.creature[data-side="enemy"]:not(.dead) .cr-hitbox');
    if (hand?.currentPlay || q('.combat.targeting')) return { ...info, screen: 'combat-wait', tap: at(enemy) };
    const stage = q('.stage-root').getBoundingClientRect(), k = stage.width / 1920, vp = (x, y) => [stage.left + x * k, stage.top + y * k];
    if (hand?.IsInCardSelection) {
      const ok = q('.combat-ui .confirm-btn.shown'), s = hand.ActiveHolders[0]?.GlobalPosition;
      return ok ? tap('hand-select', ok) : { ...info, screen: 'hand-select', tap: s && vp(s.X, s.Y - 60) };
    }
    const etb = q('.end-turn-btn.shown:not(.disabled)');
    // attacks first, so the clips show hits
    const T = window.G.TargetType, holders = hand?.ActiveHolders.filter((x) => x.hitboxEnabled && x.CardModel?.CanPlay$0?.()) ?? [];
    const h = holders.find((x) => x.CardModel.TargetType === T.AnyEnemy && enemy) ?? holders.find((x) => x.CardModel.TargetType !== T.AnyEnemy);
    if (h && etb) {
      const g = h.GlobalPosition;
      return { ...info, screen: 'combat', play: { from: vp(g.X, g.Y - 60), up: vp(g.X * 0.6 + 960 * 0.4, 520), to: h.CardModel.TargetType === T.AnyEnemy ? at(enemy) : null } };
    }
    return { ...info, screen: etb ? 'combat' : 'combat-wait', tap: at(etb), end: !!etb };
  }
  if (q('.event')) {
    if (q('.anc-hitbox')) return tap('event', q('.anc-hitbox'));
    const view = window.ui.room;
    const open = (view?.options ?? []).map((o, i) => [o, i]).filter(([o]) => !o.IsLocked);
    const key = `${rs?.TotalFloor}:${view?.optionsGen ?? ''}`;
    window.__evPicks = window.__evPicks ?? {};
    const n = Object.keys(window.__evPicks).filter((k) => k.startsWith(`${rs?.TotalFloor}:`)).length;
    const pick = open.length ? open[n >= 4 ? open.length - 1 : 0][1] : -1;
    if (pick < 0 || view.disabled) return { ...info, screen: 'event' };
    window.__evPicks[key] = true;
    return tap('event', document.querySelectorAll('.event-option')[pick]);
  }
  if (q('.rest')) {
    const view = window.ui.room;
    if (view.proceedOn) return tap('rest', q('.proceed-btn.shown'));
    if (view.disabled) return { ...info, screen: 'rest' };
    const opts = view.options.map((o, i) => [o, i]).filter(([o]) => o.IsEnabled);
    const pick = opts.find(([o]) => /smith/i.test(o.constructor?.$name ?? '')) ?? opts[0];
    return pick ? tap('rest', document.querySelectorAll('.rest-btn')[pick[1]]) : { ...info, screen: 'rest' };
  }
  if (q('.shop')) {
    const view = window.ui.room.custom ?? window.ui.room, inv = view.inv;
    const shopped = window.__shopped?.[rs?.TotalFloor];
    if (!view.open) return shopped ? tap('shop', q('.shop > .proceed-btn.shown')) : tap('shop', q('.merchant-btn'));
    if (view.fx.RugY !== 80) return { ...info, screen: 'shop' };
    if (!shopped) {
      window.__shopped = { ...window.__shopped, [rs?.TotalFloor]: true };
      const e = Array.from(window.G.$.iter(inv.AllEntries)).find((x) => x.IsStocked && x.EnoughGold && view.slotEls.get(x)?.querySelector('.shop-hit'));
      if (e) return tap('shop', view.slotEls.get(e).querySelector('.shop-hit'));
    }
    return tap('shop', q('.shop-inv .back-btn.shown'));
  }
  if (q('.treasure')) {
    const view = window.ui.room;
    if (!view.opened) return tap('treasure', q('.chest-btn'));
    if (view.claimed) return tap('treasure', q('.treasure > .proceed-btn.shown'));
    return view.clickable && !view.selectionOff ? tap('treasure', q('.relic-holder-t')) : { ...info, screen: 'treasure' };
  }
  return { ...info, screen: 'idle' };
});

// clip per first visit of a room kind; name → { max seconds, started? }
const kindOf = (s) => s.screen === 'map' ? null : s.kind === 'event' && s.floor <= 1 ? 'neow' : s.kind;
const budget = { neow: 20, combat: 60, rest: 16, shop: 20, treasure: 14, event: 14, elite: 45, boss: 60, map: 7 };
const done = new Set();
let clip = null, mapClips = 0;
const startClip = async (name) => { clip = name; done.add(name); rec.start(name); await fast(false); };
const stopClip = async () => { if (clip) { rec.stop(); clip = null; await fast(true); } };
const play = (ms) => rec.play(ms);
await fast(true);
let lastKey = '', idle = 0, same = 0;
for (let i = 0; i < 6000; i++) {
  const s = await decide();
  const kind = kindOf(s), key = `${s.floor}:${kind ?? s.screen}`;
  if (key === lastKey && ++same > 400) { console.log('looping', JSON.stringify(s)); await page.screenshot({ path: `${process.cwd()}/_work/video/looping.jpg` }); break; }
  if (key !== lastKey) {
    same = 0;
    console.log(`floor ${s.floor} ${s.room} ${s.screen}${clip ? ' [rec ' + clip + ']' : ''}`);
    // leaving a room ends its clip (map clips end on travel)
    if (clip && clip !== 'map' && kind !== clip) await stopClip();
    if (s.screen === 'map' && !clip && (mapClips === 0 || s.floor === 8) && mapClips < 2) { mapClips++; await startClip(mapClips === 1 ? 'map' : 'map2'); }
    else if (kind && !done.has(kind) && !clip) await startClip(kind);
    lastKey = key;
  }
  if (s.screen === 'gameover' || s.floor > LAST) break;
  if (clip && rec.frames > (budget[clip.replace(/\d$/, '')] ?? 10) * 60) await stopClip();
  if (s.play) {
    const { from, up, to } = s.play;
    await mouse.move(from[0], from[1], 350);
    await play(150);
    await page.mouse.down();
    await mouse.move(up[0], up[1], 280);
    if (to) await mouse.move(to[0], to[1], 320);
    await play(120);
    await page.mouse.up();
    await play(700);
    idle = 0;
  } else if (s.tap) {
    if (s.screen === 'map' && clip) await play(1500); // let the map settle on screen first
    await mouse.click(s.tap[0], s.tap[1], clip ? 450 : 120);
    await play(s.end ? 1200 : 500);
    if (s.screen === 'map' && clip) { await play(2000); await stopClip(); }
    idle = 0;
  } else {
    await play(200);
    if (++idle > 600) { console.log('stuck', JSON.stringify(s)); break; }
  }
}
await stopClip();
console.log('clips', [...done].join(' '));
await browser.close();
