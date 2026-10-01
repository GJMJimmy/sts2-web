// Daily run leaderboards offline, as the original without Steam: LeaderboardManager's NullLeaderboardStrategy keeps
// leaderboards.save in the account folder, one board per day ("{Y}_{M}_{D}_1p"), entries appended unsorted.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { G, list } from './game';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
/** LeaderboardManager.Initialize (NGame does it at start-up; Steam is never initialised here). */
function manager() {
  if (!G.LeaderboardManager._strategy) G.LeaderboardManager.Initialize();
  return G.LeaderboardManager;
}
/** The run's player ids as DailyRunUtility sends them: the single local player (net id 1 → the platform's local id). */
const localIds = () => [G.PlatformUtil.GetLocalPlayerId(manager().CurrentPlatform)];

/** DailyRunUtility.UploadScore for a singleplayer daily: only the first score of the day is kept. */
export async function recordDailyScore(time: any, score: number) {
  try {
    const lm = manager(), ids = localIds();
    const name = G.DailyRunUtility.GetLeaderboardName(time, 1);
    if (!(await G.DailyRunUtility.ShouldUploadScore(await lm.GetLeaderboard(name), ids))) return;
    await lm.UploadLocalScore(await lm.GetOrCreateLeaderboard(name), score, ids);
  } catch (e) { console.warn('daily score upload failed', e); }
}

export interface DailyBoard { exists: boolean; entries: { rank: number; name: string; score: number }[]; count: number; uploaded: boolean }
/** NDailyRunLeaderboard.LoadLeaderboard: page `page` (10 a page) of the day's board, and whether today's score is in. */
export async function loadDailyBoard(time: any, page: number): Promise<DailyBoard> {
  const lm = manager(), ids = localIds();
  const h = await lm.GetLeaderboard(G.DailyRunUtility.GetLeaderboardName(time, 1));
  const uploaded = !(await G.DailyRunUtility.ShouldUploadScore(h, ids));
  if (!h) return { exists: false, entries: [], count: 0, uploaded };
  const rows = list(await lm.QueryLeaderboard(h, G.LeaderboardQueryType.Global, page * 10, 10));
  return {
    exists: true, uploaded, count: safe(() => lm.GetLeaderboardEntryCount(h), rows.length),
    entries: rows.map((e: any) => ({ rank: Number(e.rank), score: Number(e.score), name: list(e.userIds).map((id: any) => safe(() => G.PlatformUtil.GetPlayerName(lm.CurrentPlatform, id), '')).join(',') || e.name })),
  };
}
