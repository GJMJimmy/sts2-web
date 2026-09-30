import { describe, it, expect } from 'vitest';
import { boot } from './helpers';
import { travelTo, autoCombat, until } from './autoplay';

describe('headless combat', () => {
  it('walks to the first room and wins the fight', async () => {
    const G: any = boot();
    const runState = await G.startNewSingleplayerRun({ character: G.ModelDb.Character(G.Ironclad), seed: 'COMBAT1' });
    const first = Array.from(runState.Map.StartingMapPoint.Children)[0] as any;
    console.log('first point', first.PointType, first.coord.col, first.coord.row);
    await travelTo(G, runState, first);
    await until(() => G.CombatManager.Instance.IsInProgress);
    console.log('room', runState.CurrentRoom?.constructor?.$name, 'combat', G.CombatManager.Instance.IsInProgress);
    const me = runState.Players[0];
    const enemies = Array.from(runState.CurrentRoom.CombatState.Enemies) as any[];
    expect(enemies.length).toBeGreaterThan(0);
    const turns = await autoCombat(G, runState, (s) => console.log(s));
    console.log('won in', turns, 'turns; hp', me.Creature.CurrentHp, 'gold', me.Gold);
    expect(G.CombatManager.Instance.IsInProgress).toBe(false);
    expect(me.Creature.CurrentHp).toBeGreaterThan(0);
    expect(enemies.every((e) => e.IsDead)).toBe(true);
  }, 60000);
});

describe('await using', () => {
  it('disposes AttackContext asynchronously so AfterAttack hooks run (Omnislice)', async () => {
    const G: any = boot();
    G.RunManager.Instance.CleanUp(true); // the previous test's run
    const runState = await G.startNewSingleplayerRun({ character: G.ModelDb.Character(G.Ironclad), seed: 'COMBAT2' });
    const first = Array.from(runState.Map.StartingMapPoint.Children)[0] as any;
    await travelTo(G, runState, first);
    await until(() => runState.CurrentMapPoint === first && G.CombatManager.Instance.IsInProgress && G.CombatManager.Instance.IsPlayPhase);
    const me = runState.Players[0];
    const cs = runState.CurrentRoom.CombatState;
    const card = cs.CreateCard$Player_T1(G.Omnislice, me);
    me.PlayerCombatState.Hand.AddInternal(card);
    let afterAttacks = 0;
    const orig = G.Hook.AfterAttack;
    G.Hook.AfterAttack = (...a: any[]) => { afterAttacks++; return orig(...a); };
    try {
      const enemy = Array.from(cs.Enemies).find((e: any) => e.IsHittable);
      expect(card.TryManualPlay(enemy)).toBe(true);
      await until(() => afterAttacks > 0, 500);
    } finally { G.Hook.AfterAttack = orig; }
    expect(afterAttacks).toBe(1);
  }, 60000);
});
