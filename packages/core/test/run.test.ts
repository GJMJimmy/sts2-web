import { describe, it, expect } from 'vitest';
import { boot } from './helpers';

describe('headless run', () => {
  it('starts an Ironclad run and enters act 1', async () => {
    const G: any = boot();
    const runState = await G.startNewSingleplayerRun({ character: G.ModelDb.Character(G.Ironclad), seed: 'TESTSEED' });
    const player = runState.Players[0];
    console.log('act', runState.Act.Id.Entry, 'deck', Array.from(player.Deck.Cards).map((c: any) => c.Id.Entry).join(','));
    console.log('relics', Array.from(player.Relics).map((r: any) => r.Id.Entry).join(','), 'hp', player.Creature.CurrentHp, '/', player.Creature.MaxHp, 'gold', player.Gold);
    expect(player.Deck.Cards.length).toBeGreaterThan(5);
  });

  it('constructs a target-less UsePotionAction (a C# `return;` in a constructor still hands back the object)', async () => {
    const G: any = boot();
    const me = G.RunManager.Instance.State.Players[0];
    const foul = [...G.ModelDb.AllPotions].find((p: any) => p.Id.Entry === 'FOUL_POTION').ToMutable();
    await G.PotionCmd.TryToProcure$3(foul, me, -1);
    const action = new G.UsePotionAction().$ctor_UsePotionAction$3(foul, null, false);
    expect(action?.PotionIndex).toBe(me.GetPotionSlotIndex(foul));
  });
});
