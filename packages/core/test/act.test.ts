import { describe, it, expect } from 'vitest';
import { boot } from './helpers';
import { travelTo, autoCombat, autoRoom, nextPoints, settle, until, installFlowHooks } from './autoplay';

describe('headless act', () => {
  it('plays through act 1', async () => {
    const G: any = boot();
    const runState = await G.startNewSingleplayerRun({ character: G.ModelDb.Character(G.Ironclad), seed: 'ACT1RUN' });
    const me = runState.Players[0];
    installFlowHooks(G, runState);
    const log = (s: string) => console.log(s);
    const seen = { combats: 0, treasures: 0, events: 0 };
    for (let floor = 0; floor < 20; floor++) {
      const next = nextPoints(runState);
      if (!next.length) { log('no next points'); break; }
      const p = next[0];
      await travelTo(G, runState, p);
      await until(() => runState.CurrentMapPoint === p);
      const room = runState.CurrentRoom?.constructor?.$name;
      log(`floor ${runState.TotalFloor} ${G.$.enumStr(G.MapPointType, p.PointType)} → ${room}  hp ${me.Creature.CurrentHp}/${me.Creature.MaxHp} gold ${me.Gold} deck ${me.Deck.Cards.length}`);
      await settle();
      const relicsBefore = me.Relics.length;
      if (G.CombatManager.Instance.IsInProgress) { await autoCombat(G, runState); if (!me.Creature.IsDead) seen.combats++; }
      else {
        const offered = room === 'TreasureRoom';
        await autoRoom(G, runState, log);
        if (offered) {
          seen.treasures++;
          // the chest's relic is obtained (NTreasureRoomRelicCollection), not just picked
          expect(me.Relics.length).toBeGreaterThan(relicsBefore);
        }
        if (room === 'EventRoom') seen.events++;
      }
      await settle();
      if (me.Creature.IsDead) { log('died'); break; }
      if (runState.CurrentActIndex > 0) { log('reached act 2'); break; }
    }
    log(`relics: ${Array.from(me.Relics).map((r: any) => r.Id.Entry).join(', ')}`);
    log(`deck: ${Array.from(me.Deck.Cards).map((c: any) => c.Id.Entry).join(', ')}`);
    log(`visited ${JSON.stringify(seen)}`);
    expect(runState.TotalFloor).toBeGreaterThan(3);
    expect(seen.combats).toBeGreaterThan(1);
  }, 300000);
});
