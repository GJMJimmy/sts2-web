// App-level flow: starting runs, returning to menu. Mirrors NGame without scene loading.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { G, list } from './game';
import { ui, invalidate } from './store';
import { attachRun } from './bridge';
import { loc } from './i18n';
import { resetCombatUi } from './ui/combat';
import { resetMap } from './ui/map';
import { stopMusic, stopAmbience, stopAllLoops, playOneShot } from './audio';
import { transitionView } from './ui/transition';

const stopAudio = () => { stopMusic(); stopAmbience(); stopAllLoops(); };

export let run: any = null;
function resetUi() {
  ui.screen = 'run';
  ui.room = null;
  ui.overlays = [];
  ui.gameOver = null;
  resetMap();
  resetCombatUi();
  invalidate();
}
export interface RunOptions { ascension?: number; seed?: string | null; modifiers?: any[]; dailyTime?: any }
/** NCharacterSelectScreen / NCustomRunScreen / NDailyRunScreen → NGame.StartNewSingleplayerRun. */
export async function startRun(character: any, o: RunOptions = {}) {
  resetUi();
  ui.menuStack = [];
  const seed = o.seed || new URLSearchParams(location.search).get('seed') || G.SeedHelper.GetRandomSeed(10);
  if (G.RandomCharacter && character instanceof G.RandomCharacter) character = rollRandomCharacter();
  // StartRunLobby.UpdatePreferredAscension: remember the level picked for this character (not for dailies)
  if (!o.dailyTime && o.ascension != null) safe(() => { G.SaveManager.Instance.Progress.GetOrCreateCharacterStats(character.Id).PreferredAscension = o.ascension; });
  await G.startNewSingleplayerRun({
    character, seed, shouldSave: true, ascension: o.ascension ?? 0, modifiers: o.modifiers ?? [], dailyTime: o.dailyTime,
    attach: (rs: any) => { run = rs; attachRun(rs); },
  });
  invalidate();
}
/** NCharacterSelectScreen.RollRandomCharacter: any unlocked character. */
function rollRandomCharacter() {
  const unlocked = list(G.SaveManager.Instance.GenerateUnlockStateFromProgress().Characters);
  return unlocked[Math.floor(Math.random() * unlocked.length)];
}
const safe = (f: () => void) => { try { f(); } catch (e) { console.warn(e); } };
/**
 * NMainMenu.OnContinueButtonPressedAsync: the character's wipe (sfx + transition material), then rebuild the saved run,
 * re-enter its latest map point and fade in.
 */
export async function continueRun() {
  stopMusic();
  const save = (() => { try { return G.SaveManager.Instance.LoadRunSave()?.SaveData; } catch { return null; } })();
  const ch = (() => { try { return G.ModelDb.GetById(G.CharacterModel, save.Players[0].CharacterId); } catch { return null; } })();
  if (ch) {
    playOneShot(ch.CharacterTransitionSfx);
    await transitionView.FadeOut(0.8, ch.CharacterSelectTransitionPath);
  }
  resetUi();
  ui.menuStack = [];
  const rs = await G.continueSavedRun((runState: any) => { run = runState; attachRun(runState); });
  if (!rs) { ui.screen = 'menu'; ui.toast = loc('main_menu_ui', 'INVALID_SAVE_POPUP.description_run'); }
  invalidate();
  await transitionView.FadeIn();
}
export function abandonRun() { G.abandonSavedRun(); invalidate(); }
/** NGame.ReturnToMainMenu: fade to black, clean up the run, load the main menu (which fades itself in). */
export async function toMenu() {
  await transitionView.FadeOut();
  try { G.RunManager.Instance.CleanUp(true); } catch (e) { console.warn(e); }
  run = null;
  ui.screen = 'menu';
  ui.room = null;
  ui.overlays = [];
  ui.gameOver = null;
  resetMap();
  ui.live = false;
  ui.menuStack = [];
  resetCombatUi();
  stopAudio();
  invalidate();
}
