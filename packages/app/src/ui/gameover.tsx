// NGameOverScreen (screens/game_over_screen.tscn), pushed on the overlay stack: the texture wipe over the room (the dying
// creatures stay above it), the banner with a red quote (or the Architect damage on a "victory"), Continue, then the
// summary — badges one by one, the score bar that unlocks epochs, this run's discoveries — and Main Menu / Unlock.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { G, $, N, list } from '../game';
import { ui, invalidate } from '../store';
import { locv } from '../i18n';
import { toMenu } from '../flow';
import { textureWipe } from './transition';
import { RichText, glyphs } from './richtext';
import { setTip } from './tooltip';
import { openTimelineFromGameOver } from './timeline';
import { deathQuote } from './history';
import { CommonBanner } from './overlays';
import { frameByName, frameStyle, imageUrl } from '../assets';
import { hsvFilter } from '../filters';
import { Application } from 'pixi.js';
import { activeStage, creatureSpine, playCreatureAction, visualsKey } from '../render/stage';
import { playOneShot } from '../audio';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
const fmt = (ls: any) => safe(() => ls?.GetFormattedText?.() ?? String(ls ?? ''), '');
const go = (k: string, vars: Record<string, any> = {}) => locv('game_over_screen', k, vars);

/** NGameOverScreen.GetScoreThreshold: the score each of the 18 score unlocks needs. */
const THRESHOLDS = [200, 500, 750, 1000, 1250, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2500, 2500];
const threshold = (remaining: number) => THRESHOLDS[18 - remaining] ?? 0;

/** NGameOverScreen.AnimateBadges. */
function badges(rs: any, sr: any, me: any, win: boolean): string[] {
  const out: string[] = [go('BADGE.floorsClimbed', { FloorCount: rs.TotalFloor })];
  const rooms = list(sr.MapPointHistory).flatMap((act: any) => list(act)).flatMap((e: any) => list(e.Rooms));
  let elites = rooms.filter((r: any) => r.RoomType === G.RoomType.Elite).length;
  if (rooms.length && rooms[rooms.length - 1].RoomType === G.RoomType.Elite) elites--;
  out.push(go('BADGE.elitesKilled', { EliteCount: elites }));
  const gained = list(sr.MapPointHistory).flatMap((act: any) => list(act)).reduce((a: number, e: any) => a + safe(() => e.GetEntry(me.NetId).GoldGained, 0), 0);
  out.push(go('BADGE.goldGained', { GoldAmount: gained }));
  if (me.Relics.Count >= 25) out.push(go('BADGE.iLikeShiny', { RelicCount: me.Relics.Count }));
  const gold = me.Gold;
  if (gold >= 3000) out.push(go('BADGE.goldenGod', { GoldAmount: gold }));
  else if (gold >= 2000) out.push(go('BADGE.scrooge', { GoldAmount: gold }));
  else if (gold >= 1000) out.push(go('BADGE.miser', { GoldAmount: gold }));
  if (win) {
    const n = me.Deck.Cards.Count;
    if (n <= 10) out.push(go('BADGE.tinyDeck', { DeckSize: n }));
    else if (n <= 20) out.push(go('BADGE.smallDeck', { DeckSize: n }));
    else if (n >= 60) out.push(go('BADGE.hugeDeck', { DeckSize: n }));
    else if (n >= 40) out.push(go('BADGE.bigDeck', { DeckSize: n }));
    const start = me.Character.StartingHp, max = me.Creature.MaxHp, diff = max - start;
    if (max / start < 0.50001) out.push(go('BADGE.famished', { HpDiff: diff }));
    else if (diff >= 50) out.push(go('BADGE.glutton', { HpDiff: diff }));
    else if (diff >= 30) out.push(go('BADGE.stuffed', { HpDiff: diff }));
    else if (diff >= 15) out.push(go('BADGE.wellFed', { HpDiff: diff }));
  }
  return out;
}

/**
 * NGameOverScreen.AnimateScoreBar's bookkeeping, done up front: the run's score fills the bar; reaching the threshold
 * unlocks the next score epoch (obtained, not yet revealed) and the overflow carries over (never a second unlock at
 * once). The result describes what the bar animates.
 */
interface ScorePlan { remaining: number; current: number; need: number; unlocked: boolean; message: string; next: number; after: 'none' | 'cap' | 'overflow'; final: number }
function scoreBar(score: number, me: any, sr: any): ScorePlan | null {
  const sm = G.SaveManager.Instance, p = sm.Progress;
  const remaining = sm.GetUnlocksRemaining();
  if (remaining <= 0) return null;
  let current = sm.GetCurrentScore();
  const need = threshold(remaining);
  const plan: ScorePlan = { remaining, current, need, unlocked: false, message: '', next: need, after: 'none', final: current + score };
  if (current + score >= need) {
    const epoch = sm.IncrementUnlock();
    current -= need;
    const next = threshold(remaining - 1);
    Object.assign(plan, { unlocked: true, next, message: go(next === 0 ? 'SCORE.unlockedAllMessage' : 'SCORE.unlockedEpochMessage') });
    if (epoch != null && !sm.IsEpochRevealed$String(epoch)) {
      const model = G.EpochModel.Get$String(epoch);
      sm.ObtainEpoch(epoch);
      me.DiscoveredEpochs.Add(model.Id);
      safe(() => G.LocalContext.GetMe$SerializableRun(sr).DiscoveredEpochs.Add(model.Id), undefined);
    }
    current += score;
    if (next === 0 || current === 0) { p.CurrentScore = 0; plan.after = 'none'; plan.final = 0; }
    else if (current >= next) { p.CurrentScore = next - 1; plan.after = 'cap'; plan.final = Math.floor((next * 99) / 100); }
    else { p.CurrentScore = current; plan.after = 'overflow'; plan.final = current; }
  } else p.CurrentScore += score;
  sm.SaveProgressFile();
  return plan;
}

/** NRunSummary.AnimateInDiscoveries: what this run showed for the first time, with its tip (up to 10 names, one per line). */
function discoveries(me: any): { kind: string; count: number; tip: [string, string] }[] {
  const titles = (ids: any, T: any) => list(ids).map((id: any) => safe(() => fmt(G.ModelDb.GetById(T, id).Title), String(id?.Entry ?? id)));
  const body = (key: string, param: string, names: string[]) => {
    let text = names.slice(0, 10).join('\n');
    if (names.length > 10) text += '\n....';
    return `${go(key, { [param]: names.length })}\n\n${text}`;
  };
  const out: { kind: string; count: number; tip: [string, string] }[] = [];
  for (const [kind, param, ids, T] of [['CARD', 'CardCount', me.DiscoveredCards, G.CardModel], ['RELIC', 'RelicCount', me.DiscoveredRelics, G.RelicModel],
    ['POTION', 'PotionCount', me.DiscoveredPotions, G.PotionModel], ['ENEMY', 'EnemyCount', me.DiscoveredEnemies, G.MonsterModel]] as [string, string, any, any][]) {
    const names = titles(ids, T);
    if (names.length) out.push({ kind, count: names.length, tip: [go(`DISCOVERY_HEADER_${kind}`), body(`DISCOVERY_BODY_${kind}`, param, names)] });
  }
  const epochs = safe(() => me.DiscoveredEpochs.Count, 0);
  if (epochs) out.push({ kind: 'EPOCH', count: epochs, tip: [go('DISCOVERY_HEADER_EPOCH'), go('DISCOVERY_BODY_EPOCH', { EpochCount: epochs })] });
  return out;
}

const TR = { Linear: 0, Sine: 1, Quart: 3, Expo: 5, Cubic: 7, Back: 10, Spring: 11 }, EZ = { In: 0, Out: 1, InOut: 2 };
/** Run `t`, painting every frame while it is valid; resolves when it finishes. */
function run(t: any, paint: () => void) {
  const stop = $.onFrame(() => { paint(); return t.IsValid(); });
  return new Promise<void>((ok) => t.whenFinished(() => { stop(); paint(); ok(); }));
}
const wait = (s: number) => new Promise((ok) => setTimeout(ok, s * 1000));
/** WAAPI keyframes sampled from Godot's easing for one property. */
function tw(el: Element | null | undefined, prop: (v: number) => Keyframe, from: number, to: number, ms: number, trans: number, easeType: number) {
  if (!el) return Promise.resolve();
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 24; i++) frames.push({ ...prop(from + (to - from) * $.ease(trans, easeType, i / 24)), offset: i / 24 });
  return el.animate(frames, { duration: ms, fill: 'forwards' }).finished.catch(() => {});
}

/** The texture wipe: game_over_transition at 0.9 alpha in (0.12, 0, 0.042) over the screen. */
const wipeCanvas = () => textureWipe('images/ui/transitions/game_over_transition.png', [31, 0, 11], 230);

let appP: Promise<Application> | null = null;
const creaturesApp = () => (appP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
  a.canvas.classList.add('go-creatures-canvas');
  return a;
})());
/**
 * MoveCreaturesToDifferentLayerAndDisableUi outside combat: the players' visuals, 250 px apart (at most), 200 px under
 * the screen centre, playing "die" above the wipe.
 */
function Creatures({ players }: { players: any[] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false;
    const made: any[] = [];
    void creaturesApp().then(async (a) => {
      if (dead) return;
      a.stage.removeChildren();
      host.current?.appendChild(a.canvas);
      const step = players.length > 1 ? Math.min(250, 1720 / (players.length - 1)) : 0;
      let x = ((players.length - 1) * -step) / 2;
      for (const p of players) {
        const c = await creatureSpine(visualsKey(p.Creature));
        if (dead || !c) break;
        c.root.position.set(960 + x, 740);
        if (c.spine) playCreatureAction(c.spine, c.names, 'die');
        a.stage.addChild(c.root);
        made.push(c.root);
        x += step;
      }
    });
    return () => {
      dead = true;
      for (const m of made) m.destroy({ children: true });
      void creaturesApp().then((a) => { if (a.canvas.parentElement === host.current) a.canvas.remove(); });
    };
  }, []);
  return <div class="go-creatures" ref={host} />;
}

export function GameOver({ g }: { g: any }) {
  const rs = g.runState, sr = g.serializableRun;
  if (!g.view) {
    const me = G.LocalContext.GetMe$IPlayerCollection(rs);
    const win = safe(() => !!rs.CurrentRoom?.IsVictoryRoom, false);
    const history = G.RunManager.Instance.History;
    const table = safe(() => G.LocManager.Instance.GetTable('game_over_screen'), null);
    const pick = (prefix: string) => safe(() => fmt(G.Rng.Chaotic.NextItem(G.LocString, list(table.GetLocStringsWithPrefix(prefix)))), '');
    const score = safe(() => G.ScoreUtility.CalculateScore$SerializableRun_Boolean(sr, win), 0);
    let victory = '';
    if (win) {
      victory = go('VICTORY_DAMAGE_LOCAL', { PlayerDamage: score, PersonalDamage: safe(() => Number(G.StatsManager.GetPersonalArchitectDamage()).toLocaleString(), '0') });
      const asc = rs.AscensionLevel;
      if (asc < 10 && asc > 0 && asc >= me.MaxAscensionWhenRunStarted) victory += '\n\n' + go('VICTORY_UNLOCKED_ASCENSION', { AscensionLevel: asc + 1 });
    }
    g.view = {
      win, score, victory,
      banner: win ? go('BANNER.falseWin') : pick('BANNER.lose'),
      quote: win ? '' : pick('QUOTES'),
      encounterQuote: history ? safe(() => deathQuote(history, me.Character.Id), '') : '',
      badges: safe(() => badges(rs, sr, me, win), [] as string[]),
      bar: safe(() => scoreBar(score, me, sr), null),
      found: safe(() => discoveries(me), []),
      epochs: safe(() => me.DiscoveredEpochs.Count > 0, false),
      event: ui.room?.kind === 'event',
    };
  }
  const v = g.view;
  const [phase, setPhase] = useState<'intro' | 'continue' | 'summary' | 'done'>('intro');
  const [quote, setQuote] = useState<string>(v.win ? '' : v.quote);
  const [remaining, setRemaining] = useState(v.bar?.remaining ?? 0);
  const [found, setFound] = useState(0);
  const r = {
    black: useRef<HTMLDivElement>(null), wipe: useRef<HTMLDivElement>(null), back: useRef<HTMLDivElement>(null), uiNode: useRef<HTMLDivElement>(null),
    banner: useRef<HTMLDivElement>(null), quote: useRef<HTMLDivElement>(null), victory: useRef<HTMLDivElement>(null), cont: useRef<HTMLDivElement>(null),
    badges: useRef<HTMLDivElement>(null), bar: useRef<HTMLDivElement>(null), fg: useRef<HTMLDivElement>(null), progress: useRef<HTMLDivElement>(null),
    unlock: useRef<HTMLDivElement>(null), header: useRef<HTMLDivElement>(null), items: useRef<HTMLDivElement>(null), menu: useRef<HTMLDivElement>(null),
  };
  const fx = (g.fx ??= { Black: 0, T: 0, UiA: 0, QuoteY: 90, QuoteA: 0, VictoryA: 0, Ratio: 0, BackA: 0, Score: v.bar?.current ?? 0, Of: v.bar?.need ?? 1, Fill: 0 });
  const paint = () => {
    if (r.black.current) r.black.current.style.opacity = String(fx.Black);
    if (r.uiNode.current) r.uiNode.current.style.opacity = String(fx.UiA);
    if (r.quote.current) { r.quote.current.style.top = `${206 + fx.QuoteY}px`; r.quote.current.style.opacity = String(fx.QuoteA); }
    if (r.victory.current) {
      r.victory.current.style.opacity = String(fx.VictoryA);
      const gs = glyphs(r.victory.current);
      const n = Math.floor(fx.Ratio * gs.length);
      gs.forEach((e, i) => { e.style.visibility = i < n ? '' : 'hidden'; });
    }
    if (r.back.current) r.back.current.style.opacity = String(fx.BackA);
    if (r.fg.current) r.fg.current.style.scale = `${Math.min(1, Math.max(0, fx.Fill))} 1`;
    if (r.progress.current) r.progress.current.textContent = `[${Math.round(fx.Score)}/${fx.Of}]`;
  };
  useLayoutEffect(paint);

  // AfterOverlayOpened: MoveCreaturesToDifferentLayerAndDisableUi, then AnimateIn
  useEffect(() => {
    let alive = true;
    const u = N('Rooms.NCombatRoom').Instance?.Ui;
    safe(() => { u?.Hand?.AnimOut?.(); u?.PlayQueue?.AnimOut?.(); }, undefined);
    const stage = ui.room?.kind === 'combat' ? activeStage : null;
    (async () => {
      const w = await wipeCanvas();
      if (!alive) return;
      if (w) {
        w.draw(fx.T);
        if (stage) stage.setUnderlay(w.canvas);
        else if (r.wipe.current) { w.canvas.className = 'go-wipe-canvas'; r.wipe.current.appendChild(w.canvas); }
      }
      const t = new $.WebTween();
      if (v.event) t.TweenProperty(fx, 'black', 1, 0.2);
      t.TweenProperty(fx, 't', 1, 1.5).SetEase(EZ.InOut).SetTrans(TR.Sine);
      await run(t, () => { paint(); if (w) { w.draw(fx.T); stage?.refreshUnderlay(); } });
      if (!alive) return;
      setPhase('continue'); // banner AnimateIn with the UI fading in, then the quote and Continue
      const t2 = new $.WebTween();
      t2.TweenProperty(fx, 'ui_a', 1, 0.25);
      await run(t2, paint);
      if (alive) void animateQuote(false);
    })();
    return () => { alive = false; stage?.setUnderlay(null); };
  }, []);

  /** AnimateInQuote: on the second call the random quote gives way to the encounter's death quote. */
  const animateQuote = async (swap: boolean) => {
    if (swap && fx.QuoteA !== 0) {
      const t = new $.WebTween();
      t.TweenProperty(fx, 'quote_a', 0, 0.25);
      await run(t, paint);
      setQuote(v.encounterQuote);
      await wait(1);
    }
    const t = new $.WebTween().SetParallel();
    if (v.win && !swap) {
      t.TweenProperty(fx, 'ratio', 1, 2).SetEase(EZ.Out).SetTrans(TR.Sine);
      t.TweenProperty(fx, 'victory_a', 1, 2);
    } else {
      t.TweenProperty(fx, 'quote_y', 156, 2).SetEase(EZ.Out).SetTrans(TR.Expo).From(90);
      t.TweenProperty(fx, 'quote_a', 1, 1.5);
    }
    await run(t, paint);
  };

  /** OpenSummaryScreen → AnimateRunSummary: badges, score bar, discoveries, then Main Menu (or Unlock). */
  const openSummary = async () => {
    setPhase('summary');
    fx.VictoryA = 0;
    const t = new $.WebTween();
    t.TweenProperty(fx, 'back_a', 1, 0.5);
    void run(t, paint);
    void animateQuote(true);
    void tw(r.banner.current, (y) => ({ translate: `0 ${y}px` }), 0, -32, 500, TR.Cubic, EZ.Out);
    // AnimateBadges
    await wait(0.5);
    for (const b of Array.from(r.badges.current?.children ?? [])) {
      (b as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });
      await tw(b, (x) => ({ translate: `${x}px 0` }), -50, 0, 300, TR.Spring, EZ.Out);
      await wait(0.1);
    }
    await animateScore();
    // AnimateInDiscoveries
    if (v.found.length) {
      r.header.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
      await wait(0.1);
      for (let i = 0; i < v.found.length; i++) {
        setFound(i + 1);
        await new Promise(requestAnimationFrame);
        const el = r.items.current?.children[i] as HTMLElement | undefined;
        el?.animate([{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], { duration: 300, fill: 'forwards' });
        await tw(el, (y) => ({ translate: `0 ${y}px` }), 100, 0, 300, TR.Back, EZ.Out);
      }
    }
    setPhase('done');
  };
  const animateScore = async () => {
    const b = v.bar as ScorePlan | null;
    if (!b) return;
    fx.Score = b.current; fx.Of = b.need; fx.Fill = b.current / b.need;
    paint();
    await r.bar.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' }).finished.catch(() => {});
    if (!b.unlocked) {
      const t = new $.WebTween().SetParallel();
      t.TweenInterval(0.5);
      t.TweenProperty(fx, 'score', b.final, 1);
      t.TweenProperty(fx, 'fill', b.final / b.need, 1);
      await run(t, paint);
      return;
    }
    let t = new $.WebTween().SetParallel();
    t.TweenInterval(1);
    t.Chain();
    t.TweenProperty(fx, 'score', b.need, 1).SetEase(EZ.Out).SetTrans(TR.Cubic);
    t.TweenProperty(fx, 'fill', 1, 1).SetEase(EZ.Out).SetTrans(TR.Cubic);
    await run(t, paint);
    r.unlock.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
    await tw(r.unlock.current, (y) => ({ translate: `0 ${y}px` }), 0, -92.5, 250, TR.Spring, EZ.Out);
    setRemaining(b.remaining - 1);
    if (b.after === 'none') return;
    fx.Of = b.next;
    t = new $.WebTween().SetParallel();
    t.TweenInterval(0.5);
    t.Chain();
    t.TweenProperty(fx, 'score', b.final, 1).From(0).SetEase(EZ.Out).SetTrans(TR.Cubic);
    t.TweenProperty(fx, 'fill', b.after === 'cap' ? 1 : b.final / b.next, 1).From(0).SetEase(EZ.Out).SetTrans(TR.Cubic);
    await run(t, paint);
  };
  // OnMainMenuButtonPressed: the timeline when an epoch was found, else the main menu
  const leave = () => { if (v.epochs) void toMenu().then(openTimelineFromGameOver); else void toMenu(); };
  const floorIcon = frameByName('ui_atlas', 'top_bar/top_bar_floor');
  const cols = v.badges.length < 6 ? 1 : 2;
  return (
    <div class="gameover">
      {v.event && <div class="go-black" ref={r.black} style={{ opacity: 0 }} />}
      <div class="go-wipe" ref={r.wipe} />
      {ui.room?.kind !== 'combat' && <Creatures players={list(rs.Players)} />}
      <div class="go-summary-back" ref={r.back} style={{ opacity: 0 }} />
      {phase !== 'intro' && phase !== 'continue' && (
        <div class="go-summary">
          <div class="go-badges" ref={r.badges} style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
            {v.badges.map((b: string, i: number) => (
              <div class="go-badge" style={{ opacity: 0 }}>
                <div class="go-badge-icon">{i === 0 && <div style={frameStyle(floorIcon, 48, 48)} />}</div>
                <div class="go-badge-label"><RichText text={b} /></div>
              </div>
            ))}
          </div>
          <div class="go-scorebar" ref={r.bar} style={{ opacity: 0, visibility: v.bar ? undefined : 'hidden' }}>
            <div class="go-score-bg">
              <div class="go-score-fg" ref={r.fg}><div class="go-score-shadow" /></div>
              <div class="go-score-progress" ref={r.progress} />
              <div class="go-score-remaining">{go('SCORE.unlocksRemaining', { UnlockCount: remaining })}</div>
            </div>
            {v.bar?.unlocked && <div class="go-unlock" ref={r.unlock} style={{ opacity: 0 }}>{v.bar.message}</div>}
          </div>
          <div class="go-discoveries">
            <div class="go-disc-header" ref={r.header} style={{ opacity: 0 }}>
              <div class="go-disc-line" /><div class="go-disc-label">{go('DISCOVERY_HEADER')}</div><div class="go-disc-line flip" />
            </div>
            <div class="go-disc-items" ref={r.items}>
              {v.found.slice(0, found).map((d: any) => <DiscoveredItem d={d} />)}
            </div>
          </div>
        </div>
      )}
      <div class="go-ui" ref={r.uiNode} style={{ opacity: 0 }}>
        <div class="go-banner" ref={r.banner}>{phase !== 'intro' && <CommonBanner text={v.banner} />}</div>
        {!v.win || phase === 'summary' || phase === 'done' ? <div class="go-quote" ref={r.quote} style={{ opacity: 0 }}><RichText text={quote} /></div> : null}
        {v.win && (phase === 'intro' || phase === 'continue') && <div class="go-victory" ref={r.victory} style={{ opacity: 0 }}><RichText text={v.victory} /></div>}
        {phase === 'continue' && <GameOverButton label={go('BUTTON.continue')} x={830} y={910} hsv={[1, 1, 1]} outline="rgb(30, 66, 74)" slide onClick={() => void openSummary()} />}
        {phase === 'done' && <GameOverButton label={go(v.epochs ? 'BUTTON.unlock' : 'BUTTON.mainMenu')} x={818} y={909} hsv={[0.5, 1.1, 0.9]} outline="rgb(74, 30, 30)" onClick={leave} />}
      </div>
    </div>
  );
}

/** NDiscoveredItem: the 48 px discovery_* icon and the count; the tip sits at the item + (−76, −200). */
function DiscoveredItem({ d }: { d: { kind: string; count: number; tip: [string, string] } }) {
  const icon = { CARD: 'card', RELIC: 'relic', POTION: 'potion', ENEMY: 'monster', EPOCH: 'epoch' }[d.kind];
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div class="go-disc-item" ref={ref}
      onPointerEnter={() => {
        playOneShot('event:/sfx/ui/clicks/ui_hover');
        const st = document.querySelector('.stage-root')!.getBoundingClientRect(), rr = ref.current!.getBoundingClientRect(), k = 1920 / st.width;
        setTip(d.tip[0], d.tip[1], { kind: 'at', x: (rr.left - st.left) * k - 76, y: (rr.top - st.top) * k - 200 });
      }}
      onPointerLeave={() => setTip(null)}>
      <img src={imageUrl(`images/ui/game_over_screen/discovery_${icon}.png`) ?? ''} />
      <div class="go-disc-count">{d.count}</div>
    </div>
  );
}

/**
 * NGameOverContinueButton / NReturnToMainMenuButton (260 × 58): reward_skip_button and the label; hover 1.1, s 1.2 v 1.4
 * (0.05 s), back over 1 s Expo Out. Continue slides up 190 px (0.5 s Quart Out); both fade in from black.
 */
function GameOverButton({ label, x, y, hsv, outline, slide, onClick }: { label: string; x: number; y: number; hsv: number[]; outline: string; slide?: boolean; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.animate([{ filter: 'brightness(0)', opacity: 0 }, { filter: 'brightness(1)', opacity: 1 }], { duration: 500, fill: 'forwards' });
    if (slide) void tw(el, (dy) => ({ translate: `0 ${dy}px` }), 190, 0, 500, TR.Quart, EZ.Out);
  }, []);
  const hot = st === 'hover';
  const t = hot ? '.05s linear' : '1s cubic-bezier(0.16, 1, 0.3, 1)';
  return (
    <div class="go-btn" ref={ref} style={{ left: `${x}px`, top: `${y}px` }}
      onPointerEnter={() => { setSt('hover'); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (e.button === 0) { setSt('press'); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && st === 'press') { setSt(''); onClick(); } }}>
      <div class="gob-visual" style={{ scale: hot ? '1.1' : '1', transition: `scale ${t}` }}>
        <img class="gob-img" src={imageUrl('images/ui/reward_screen/reward_skip_button.png') ?? ''}
          style={{ filter: `${hsvFilter(hsv[0], 1, 1)} saturate(${hot ? 1.2 : hsv[1]}) brightness(${hot ? 1.4 : hsv[2]})`, transition: `filter ${t}` }} />
        <div class="gob-label" style={{ WebkitTextStrokeColor: outline }}>{label}</div>
      </div>
    </div>
  );
}
