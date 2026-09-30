// Game shell: the non-UI parts of NGame (startup, starting runs) re-expressed over the transpiled rule layer.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as G from './gen/sts2';
import './overrides';
import { headless } from './rt/core';

const g = G as any;

export interface InitOptions {
  /** Headless tests: no timers, instant waits, mock save store. */
  test?: boolean;
}

let initialized = false;
export function initGame(opts: InitOptions = {}) {
  if (initialized) return;
  initialized = true;
  if (opts.test) {
    g.TestMode.IsOn = true;
    headless.on = true;
  }
  g.OneTimeInitialization.ExecuteEssential();
  const sm = g.SaveManager.Instance;
  sm.InitProfileId(null);
  sm.InitProgressData();
  sm.InitPrefsData();
}

export interface NewRunOptions {
  character: any;
  seed: string;
  ascension?: number;
  modifiers?: any[];
  shouldSave?: boolean;
  /** Daily runs: the day (DateTimeOffset) the run belongs to (RunState.DailyTime, daily score). */
  dailyTime?: any;
  /** Called where NGame.StartRun swaps in the NRun scene (the web app binds its views there). */
  attach?: (runState: any) => void;
}

/** NCharacterSelectScreen + NGame.StartNewSingleplayerRun minus scene/asset loading. Resolves once act 1's map is ready. */
export async function startNewSingleplayerRun(o: NewRunOptions) {
  const unlockState = g.SaveManager.Instance.GenerateUnlockStateFromProgress();
  const player = g.Player.CreateForNewRun$CharacterModel_UnlockState_UInt64(o.character, unlockState, 1);
  const acts = Array.from(g.ActModel.GetRandomList(o.seed, unlockState, false)).map((a: any) => a.ToMutable());
  const runState = g.RunState.CreateForNewRun([player], acts, o.modifiers ?? [], o.ascension ?? 0, o.seed);
  const rm = g.RunManager.Instance;
  rm.SetUpNewSinglePlayer(runState, o.shouldSave ?? false, o.dailyTime ?? null);
  await rm.FinalizeStartingRelics();
  rm.Launch();
  o.attach?.(runState);
  await rm.EnterAct(0, false);
  return runState;
}

/**
 * NMainMenu "Continue" + NGame.LoadRun without scenes: rebuild the run from the saved SerializableRun and re-enter
 * the latest map point. `attach` runs where NGame swaps in the NRun scene (the web app binds its views there).
 * Returns null when there is no readable save.
 */
export async function continueSavedRun(attach?: (runState: any) => void) {
  const sm = g.SaveManager.Instance;
  if (!sm.HasRunSave) return null;
  const res = sm.LoadRunSave();
  if (!res?.Success || !res.SaveData) return null;
  const save = res.SaveData;
  const runState = g.RunState.FromSerializable(save);
  const rm = g.RunManager.Instance;
  rm.SetUpSavedSinglePlayer(runState, save);
  rm.Launch();
  attach?.(runState);
  await rm.GenerateMap();
  await rm.LoadIntoLatestMapCoord(g.AbstractRoom.FromSerializable$SerializableRoom_IRunState(save.PreFinishedRoom, runState));
  return runState;
}

/** NMainMenu.AbandonRun: count the saved run as a loss in progress/history, then delete it. */
export function abandonSavedRun() {
  const sm = g.SaveManager.Instance;
  const res = sm.HasRunSave ? sm.LoadRunSave() : null;
  if (res?.Success && res.SaveData) {
    try {
      sm.UpdateProgressWithRunData(res.SaveData, false);
      g.RunHistoryUtilities.CreateRunHistoryEntry(res.SaveData, false, true, res.SaveData.PlatformType);
    } catch (e) { g.Log.Error(`Failed to record abandoned run: ${e}`); }
  }
  sm.DeleteCurrentRun();
}

/**
 * NTreasureRoomRelicCollection.AnimateRelicAwards without the animation: every awarded relic is obtained by its
 * player and moved to the fallback pool of the others. Subscribe it to TreasureRoomRelicSynchronizer.RelicsAwarded.
 */
export function obtainTreasureRelics(results: any) {
  for (const r of Array.from(results ?? []) as any[]) {
    g.TaskHelper.RunSafely(g.RelicCmd.Obtain$3(r.relic.ToMutable(), r.player, -1));
    for (const p of Array.from(r.player.RunState.Players) as any[]) if (p !== r.player) p.RelicGrabBag.MoveToFallback(r.relic);
  }
}
