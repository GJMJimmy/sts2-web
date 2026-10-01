// NCombatStartBanner, NPlayerTurnBanner and NEnemyTurnBanner (CombatManager adds them to NCombatRoom), with their
// scenes' layout and tweens. The start banner hands over to "Player Turn" for round 1 when its text has faded.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'preact/hooks';
import { G, $ } from '../game';
import { invalidate } from '../store';
import { loc, locv } from '../i18n';

const TR = { Sine: 1, Expo: 5, Cubic: 7 }, EZ = { Out: 1 };
type Kind = 'start' | 'player' | 'enemy';
interface Banner { id: number; kind: Kind; round: number; extra: boolean }
const banners: Banner[] = [];
let ids = 0;
export function spawnCombatBanner(kind: Kind, round = 0) {
  const extra = kind === 'player' && (() => { try { return G.CombatManager.Instance.PlayersTakingExtraTurn.Count > 0; } catch { return false; } })();
  banners.push({ id: ++ids, kind, round, extra });
  invalidate();
}
export function clearCombatBanners() { banners.length = 0; }
const done = (b: Banner) => { const i = banners.indexOf(b); if (i >= 0) banners.splice(i, 1); invalidate(); };
const debugPlay = (name: string) => { try { $.ext('MegaCrit.Sts2.Core.Audio.Debug.NDebugAudioManager').Instance?.Play(name); } catch { /* no audio */ } };
/** Run `t`, calling `paint` every frame while it is valid; resolves when it finishes. */
function run(t: any, paint: () => void) {
  const stop = $.onFrame(() => { paint(); return t.IsValid(); });
  return new Promise<void>((ok) => t.whenFinished(() => { stop(); paint(); ok(); }));
}

export function CombatBanners() {
  return <>{banners.map((b) => (b.kind === 'start' ? <StartBanner b={b} key={b.id} /> : b.kind === 'player' ? <PlayerTurnBanner b={b} key={b.id} /> : <EnemyTurnBanner b={b} key={b.id} />))}</>;
}

/** combat_start_banner.tscn: a dark band (y 395–575) and "Battle Start" (Spectral Bold 96, gold) centred at y 492. */
function StartBanner({ b }: { b: Banner }) {
  const rect = useRef<HTMLDivElement>(null), label = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = { RectA: 0, RectS: 1.2, LabelA: 0, LabelS: 2 };
    const paint = () => {
      if (rect.current) { rect.current.style.opacity = String(o.RectA); rect.current.style.scale = String(o.RectS); }
      if (label.current) { label.current.style.opacity = String(o.LabelA); label.current.style.scale = String(o.LabelS); }
    };
    const battleStart = ['battle_start_1.mp3', 'battle_start_2.mp3'];
    debugPlay(battleStart[Math.floor(Math.random() * battleStart.length)]);
    let alive = true;
    const t = new $.WebTween().SetParallel();
    t.TweenInterval(0.3);
    t.Chain();
    t.TweenProperty(o, 'rect_a', 0.5, 0.75).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'rect_s', 1, 0.75).SetEase(EZ.Out).SetTrans(TR.Expo).From(1.2);
    t.TweenProperty(o, 'label_a', 1, 1.3).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'label_s', 1, 0.75).SetEase(EZ.Out).SetTrans(TR.Expo).From(2);
    t.TweenProperty(o, 'label_a', 0, 1).SetEase(EZ.Out).SetTrans(TR.Cubic).SetDelay(1.3);
    void run(t, paint).then(() => {
      if (!alive) return;
      spawnCombatBanner('player', 1);
      const t2 = new $.WebTween();
      t2.TweenProperty(o, 'rect_a', 0, 1).SetEase(EZ.Out).SetTrans(TR.Cubic).SetDelay(1.5);
      return run(t2, paint).then(() => done(b));
    });
    return () => { alive = false; t.Kill(); };
  }, []);
  return (
    <div class="combat-banner">
      <div class="cbn-start-rect" ref={rect} style={{ opacity: 0 }} />
      <div class="cbn-label cbn-start" ref={label} style={{ opacity: 0 }}>{loc('gameplay_ui', 'BATTLE_START')}</div>
    </div>
  );
}

/** player_turn_banner.tscn: "Player Turn" rises 50 px from y 518 while "Turn N" (Kreon Bold 36, sky blue) drops 50 from y 490. */
function PlayerTurnBanner({ b }: { b: Banner }) {
  const root = useRef<HTMLDivElement>(null), label = useRef<HTMLDivElement>(null), turn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = { A: 0, LabelY: 0, TurnY: 0 };
    const paint = () => {
      if (root.current) root.current.style.opacity = String(o.A);
      if (label.current) label.current.style.translate = `0 ${o.LabelY}px`;
      if (turn.current) turn.current.style.translate = `0 ${o.TurnY}px`;
    };
    debugPlay('player_turn.mp3');
    let alive = true;
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 'a', 1, 1).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'label_y', -50, 1.5).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'turn_y', 50, 1.5).SetEase(EZ.Out).SetTrans(TR.Expo);
    void run(t, paint).then(() => {
      if (!alive) return;
      const t2 = new $.WebTween();
      t2.TweenInterval(0.4);
      t2.TweenProperty(o, 'a', 0, 0.3).SetEase(EZ.Out).SetTrans(TR.Sine);
      return run(t2, paint).then(() => done(b));
    });
    return () => { alive = false; t.Kill(); };
  }, []);
  return (
    <div class="combat-banner" ref={root} style={{ opacity: 0 }}>
      <div class="cbn-label cbn-player" ref={label}>{loc('gameplay_ui', b.extra ? 'PLAYER_TURN_EXTRA' : 'PLAYER_TURN')}</div>
      <div class="cbn-turn" ref={turn}>{locv('gameplay_ui', 'TURN_COUNT', { turnNumber: b.round })}</div>
    </div>
  );
}

/** enemy_turn_banner.tscn: "Enemy Turn" at y 468 shrinks from 2×, then turns from gold to red as it fades. */
function EnemyTurnBanner({ b }: { b: Banner }) {
  const root = useRef<HTMLDivElement>(null), label = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = { A: 0, S: 2, R: 0.937255, G: 0.784314, B: 0.317647 };
    const paint = () => {
      if (root.current) root.current.style.opacity = String(o.A);
      if (label.current) { label.current.style.scale = String(o.S); label.current.style.color = `rgb(${o.R * 255}, ${o.G * 255}, ${o.B * 255})`; }
    };
    debugPlay('enemy_turn.mp3');
    const t = new $.WebTween().SetParallel();
    t.TweenProperty(o, 's', 1, 0.75).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'a', 1, 1.3).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.Chain();
    t.TweenProperty(o, 'r', 1, 1).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'g', 0, 1).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'b', 0, 1).SetEase(EZ.Out).SetTrans(TR.Expo);
    t.TweenProperty(o, 'a', 0, 1).SetEase(EZ.Out).SetTrans(TR.Cubic);
    void run(t, paint).then(() => done(b));
    return () => t.Kill();
  }, []);
  return (
    <div class="combat-banner" ref={root} style={{ opacity: 0 }}>
      <div class="cbn-label cbn-enemy" ref={label}>{loc('gameplay_ui', 'ENEMY_TURN')}</div>
    </div>
  );
}
