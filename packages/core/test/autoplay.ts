/* eslint-disable @typescript-eslint/no-explicit-any */
// Headless driver that submits the same actions the Godot UI would.
export const tick = () => new Promise((r) => setTimeout(r, 0));
export async function settle(n = 30) { for (let i = 0; i < n; i++) await tick(); }
export async function until(cond: () => boolean, max = 2000) { for (let i = 0; i < max && !cond(); i++) await tick(); return cond(); }

export async function travelTo(G: any, runState: any, point: any) {
  const me = runState.Players[0];
  const src = new G.RunLocation().$ctor_RunLocation$2(runState.CurrentMapCoord, runState.CurrentActIndex);
  const vote = new G.MapVote().$zero_MapVote();
  vote.coord = point.coord;
  vote.mapGenerationCount = G.RunManager.Instance.MapSelectionSynchronizer.MapGenerationCount;
  G.RunManager.Instance.ActionQueueSynchronizer.RequestEnqueue(new G.VoteForMapCoordAction().$ctor_VoteForMapCoordAction(me, src, vote));
  await settle();
}

export function combatState(G: any) { return G.CombatManager.Instance.DebugOnlyGetState(); }

/** What NCombatUi does on victory: offer the room's rewards (TestMode takes them all). */
let hooked = false;
export function installFlowHooks(G: any, _runState?: any) {
  if (hooked) return; // selector scope and CombatManager are process-wide; the handler reads the current run
  hooked = true;
  G.CardSelectCmd.UseSelector(new G.TestCardSelector().$ctor_TestCardSelector());
  G.CombatManager.Instance.CombatWon = G.$.dcombine(G.CombatManager.Instance.CombatWon, (room: any) => {
    if (room.Encounter.ShouldGiveRewards) G.RewardsCmd.OfferForRoomEnd(G.RunManager.Instance.State.Players[0], room);
  });
}

/** Plays every playable card (first living enemy as target) each turn until combat ends. */
export async function autoCombat(G: any, runState: any, log: (s: string) => void = () => {}) {
  const cm = G.CombatManager.Instance;
  const me = runState.Players[0];
  for (let turn = 0; turn < 60; turn++) {
    await until(() => cm.IsPlayPhase || !cm.IsInProgress);
    if (!cm.IsInProgress) return turn;
    const st = combatState(G);
    log(`turn ${st.RoundNumber}: hp ${me.Creature.CurrentHp}/${me.Creature.MaxHp} energy ${me.PlayerCombatState.Energy} enemies ${Array.from(st.Enemies).map((e: any) => `${e.Monster?.Id.Entry}:${e.CurrentHp}`).join(' ')}`);
    for (let guard = 0; guard < 20 && cm.IsInProgress; guard++) {
      const enemy = Array.from(st.Enemies).find((e: any) => e.IsAlive && e.IsHittable);
      const hand = Array.from(me.PlayerCombatState.Hand.Cards) as any[];
      const card = hand.find((c) => c.TryManualPlay(c.TargetType === G.TargetType.AnyEnemy ? enemy : null));
      if (!card) break;
      log(`  play ${card.Id.Entry}`);
      await settle();
    }
    if (!cm.IsInProgress) return turn;
    G.RunManager.Instance.ActionQueueSynchronizer.RequestEnqueue(new G.EndPlayerTurnAction().$ctor_EndPlayerTurnAction(me, st.RoundNumber));
    await settle();
    await until(() => !cm.IsInProgress || combatState(G)?.RoundNumber > st.RoundNumber);
  }
  throw new Error('combat did not finish in 60 turns');
}

/** Resolves whatever non-combat room we are in with the first available choice. */
export async function autoRoom(G: any, runState: any, log: (s: string) => void = () => {}) {
  const room = runState.CurrentRoom;
  const kind = room?.constructor?.$name;
  const rm = G.RunManager.Instance;
  if (kind === 'EventRoom') {
    const ev = rm.EventSynchronizer.GetLocalEvent();
    for (let i = 0; i < 12 && !ev.IsFinished; i++) {
      const opts = Array.from(ev.CurrentOptions ?? []) as any[];
      const idx = Math.max(0, opts.findIndex((o) => !o.IsLocked));
      log(`  event ${ev.Id.Entry}: ${opts.length} options, choose ${idx} (${opts[idx]?.TextKey ?? ''})`);
      if (!opts.length) break;
      rm.EventSynchronizer.ChooseLocalOption(idx);
      await settle();
      if (G.CombatManager.Instance.IsInProgress) { await autoCombat(G, runState, log); await settle(); }
    }
  } else if (kind === 'RestSiteRoom') {
    const opts = Array.from(rm.RestSiteSynchronizer.GetLocalOptions()) as any[];
    log(`  rest: ${opts.map((o: any) => o.OptionId).join(',')}`);
    await rm.RestSiteSynchronizer.ChooseLocalOption(0);
    await settle();
  } else if (kind === 'TreasureRoom') {
    const sync = rm.TreasureRoomRelicSynchronizer;
    const onAwarded = (results: any) => { sync.RelicsAwarded = G.$.dremove(sync.RelicsAwarded, onAwarded); G.obtainTreasureRelics(results); };
    sync.RelicsAwarded = G.$.dcombine(sync.RelicsAwarded, onAwarded);
    await room.DoNormalRewards();
    await room.DoExtraRewardsIfNeeded();
    await settle();
    const offered = Array.from(sync.CurrentRelics ?? []) as any[];
    log(`  treasure: ${offered.map((r: any) => r.Id.Entry).join(',') || 'empty'}`);
    if (offered.length) sync.PickRelicLocally(0); else sync.CompleteWithNoRelics();
    await settle();
  }
}

/** Travel one step: first child of the current map point (or the act start). */
/** NMapScreen.RecalculateTravelability: the start point first (act 1's Ancient), then children, then the boss. */
export function nextPoints(runState: any): any[] {
  const map = runState.Map;
  const visited = Array.from(runState.VisitedMapCoords ?? []) as any[];
  if (!visited.length) return [map.StartingMapPoint];
  const last = visited[visited.length - 1];
  const all = [map.StartingMapPoint, ...Array.from(map.GetAllMapPoints()), map.BossMapPoint, map.SecondBossMapPoint].filter(Boolean) as any[];
  const at = (c: any) => all.find((p) => p.coord.row === c.row && p.coord.col === c.col);
  if (map.SecondBossMapPoint && last.row === map.BossMapPoint.coord.row && last.col === map.BossMapPoint.coord.col) return [map.SecondBossMapPoint];
  if (last.row !== map.GetRowCount() - 1) return Array.from(at(last)?.Children ?? []) as any[];
  return [map.BossMapPoint];
}
