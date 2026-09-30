// Hand-written replacements for generated members whose C# semantics JS numbers cannot express (int32 overflow etc.).
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as G from './gen/sts2';
import { ext, stubOf } from './rt/core';
import { toSignal } from './rt/godot';
import { WebTween } from './rt/tween';

const g = G as any;

/** StringHelper.GetDeterministicHashCode relies on unchecked int32 arithmetic; it seeds every named Rng stream. */
g.StringHelper.GetDeterministicHashCode = (s: string): number => {
  let a = 352654597, b = a;
  for (let i = 0; i < s.length; i += 2) {
    a = ((a << 5) + a) ^ s.charCodeAt(i);
    a |= 0;
    if (i === s.length - 1) break;
    b = ((b << 5) + b) ^ s.charCodeAt(i + 1);
    b |= 0;
  }
  return (a + Math.imul(b, 1566083941)) | 0;
};

/** GodotFileIo's async paths stream through FileAccessStream (a System.IO.Stream subclass); the sync paths already hit the FileAccess shim. */
const Task = ext('System.Threading.Tasks.Task') as any;
const io = g.GodotFileIo.prototype;
io.ReadFileAsync = function (path: string) { return Task.FromResult(this.ReadFile(path)); };
io.WriteFileAsync$String_ByteArr = function (path: string, bytes: any) { this.WriteFile$String_ByteArr(path, bytes); return Task.CompletedTask; };

/** Combat replays (.mcr bug-report recordings) are written through FileAccessStream; the web build has no use for them. */
Object.defineProperty(g.CombatReplayWriter.prototype, 'IsEnabled', { get: () => false, set: () => {}, configurable: true });

/** Save loading: the original parses into a JsonDocument DOM to run schema migrations. Web saves are always written by
 *  this build at the current schema version, so deserialize directly.
 *  ponytail: no migrations; add a JsonNode DOM shim once a schema bump has to read older web saves. */
g.MigrationManager.prototype.LoadWithAggressiveRecovery = function (T: any, filePath: string, content: string) {
  try {
    const data = (ext('System.Text.Json.JsonSerializer') as any).Deserialize(T, content, g.JsonSerializationUtility.GetTypeInfo$1(T));
    return new g.ReadSaveResult().$ctor_ReadSaveResult$1(T, data);
  } catch (e: any) {
    g.Log.Error(`Could not load ${filePath}: ${e?.message ?? e}`);
    return new g.ReadSaveResult().$ctor_ReadSaveResult$2(T, g.ReadSaveStatus.JsonParseError, String(e?.message ?? e));
  }
};

/** Inert Godot nodes (stubs and the web bridge's views) still take part in frame/timer waits: GetTree() is the runtime's
 *  main loop and ToSignal() yields real awaitables (e.g. CombatStateTracker waits a frame before notifying). */
const godotObject = stubOf('Godot.GodotObject');
if (godotObject) godotObject.prototype.ToSignal = function (src: any, sig: any) { return toSignal(src, sig); };
const godotNode = stubOf('Godot.Node');
if (godotNode) godotNode.prototype.GetTree = function () { return (ext('Godot.Engine') as any).GetMainLoop(); };
/** Node.CreateTween: real tweens (timed steps, callbacks, Finished), so waits on card and creature tweens take their
 *  original time and the web views they animate move. A node is valid until it is freed. */
if (godotNode) godotNode.prototype.CreateTween = () => new WebTween();
if (godotObject) godotObject.IsInstanceValid = (o: any) => o != null && !o.$freed;
const tweenHelper = stubOf('MegaCrit.Sts2.Core.Nodes.GodotExtensions.TweenHelper');
if (tweenHelper) tweenHelper.FastForwardToCompletion = (t: any) => t?.CustomStep?.(999);

/** Achievements: this build leaves AchievementsUtil.Unlock (platform) and AchievementsHelper empty. The achievement
 *  models (Models/Achievements, hook listeners) already call Unlock; record unlocks in the progress save and fill in
 *  the helper checks from the achievement descriptions. */
const Ach = g.Achievement;
g.AchievementsUtil.Unlock = (achievement: number) => {
  const progress = g.SaveManager.Instance.Progress;
  if (progress.IsAchievementUnlocked(achievement)) return;
  progress.AddUnlockedAchievement(achievement, Math.floor(Date.now() / 1000));
  g.SaveManager.Instance.SaveProgressFile();
  g.AchievementsUtil.AchievementsChanged?.();
};
const WIN_BY_CHARACTER: Record<string, number> = { IRONCLAD: Ach.IroncladWin, SILENT: Ach.SilentWin, REGENT: Ach.RegentWin, NECROBINDER: Ach.NecrobinderWin, DEFECT: Ach.DefectWin };
g.AchievementsHelper.AfterRunEnded = (state: any, player: any, isVictory: boolean) => {
  if (!player) return;
  if (g.SaveManager.Instance.Progress.FloorsClimbed >= 10000) g.AchievementsUtil.Unlock(Ach.FloorTenThousand, player);
  if (!isVictory) return;
  const win = WIN_BY_CHARACTER[player.Character?.Id?.Entry];
  if (win != null) g.AchievementsUtil.Unlock(win, player);
  const starting = new Set(Array.from(player.Character.StartingRelics ?? [], (r: any) => r.Id.Entry));
  if (Array.from(player.Relics).every((r: any) => starting.has(r.Id.Entry))) g.AchievementsUtil.Unlock(Ach.NoRelicWin, player);
  if (Array.from(player.Deck.Cards).every((c: any) => !c.IsUpgradable)) g.AchievementsUtil.Unlock(Ach.AllCardsUpgraded, player);
};
g.AchievementsHelper.AfterBossDefeated = (player: any) => g.AchievementsUtil.Unlock(Ach.DefeatOneBoss, player);
const ACT_ACHIEVEMENT: Record<string, number> = { UNDERDOCKS: Ach.DefeatUnderdocksEnemies, OVERGROWTH: Ach.DefeatOvergrowthEnemies, HIVE: Ach.DefeatHiveEnemies, GLORY: Ach.DefeatGloryEnemies };
g.AchievementsHelper.CheckForDefeatedAllEnemiesAchievement = (act: any, player: any) => {
  const achievement = ACT_ACHIEVEMENT[act?.Id?.Entry];
  if (achievement == null) return;
  const beaten = new Set(Array.from(g.SaveManager.Instance.Progress.EnemyStats.Values).filter((e: any) => e.TotalWins > 0).map((e: any) => e.Id.Entry));
  if (Array.from(act.AllMonsters).every((m: any) => beaten.has(m.Id.Entry))) g.AchievementsUtil.Unlock(achievement, player);
};
