// Cloud save sync (a port-only feature, see docs/cloud-sync.md): the OnscripterShiki save-sync protocol —
// POST/GET {server}/save/{slot} with an opaque body — against a self-hosted sync server or Cloudflare Worker.
// Save files travel as a JSON envelope of {vfs path → file text}; the servers store the bytes verbatim.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { $, G } from './game';

const SERVER_KEY = 'sts2web_sync_server', SLOT_KEY = 'sts2web_sync_slot';
/** The sync servers' slot rule (ons_shiki_sync_server.py / workers): 1–64 letters, digits, _ or -. */
const SLOT_RE = /^[\p{L}\p{N}_\-]{1,64}$/u;
// *.tmp files are GodotFileIo's transient write step (write .tmp, then rename): never upload or restore them.
const TMP = /\.tmp$/;

export const savedServer = (): string => { try { return localStorage.getItem(SERVER_KEY) ?? ''; } catch { return ''; } };
export const savedSlot = (): string => { try { return localStorage.getItem(SLOT_KEY) ?? ''; } catch { return ''; } };
/** Persist the panel's server/slot for the next visit (independent keys: other ports' sync codes stay theirs). */
export function rememberSync(server: string, slot: string) {
  try { localStorage.setItem(SERVER_KEY, server); localStorage.setItem(SLOT_KEY, slot); } catch { /* best effort */ }
}
export const serverUrl = (server: string) => server.trim().replace(/\/+$/, '');
export const slotOk = (slot: string) => SLOT_RE.test(slot);

/** Every user:// file as {path → text}: the same dump the e2e tools take as "everything the player has". */
export function collectSaves(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const p of $.vfs.list('user://')) {
    if (TMP.test(p)) continue;
    const s = $.vfs.read(p);
    if (s !== null) files[p] = s;
  }
  return files;
}

/** The pagehide quit-saves (main.tsx): push the live in-memory state into the vfs, so an upload never misses it. */
function flushLive() {
  const sm = G.SaveManager.Instance;
  for (const save of ['SaveSettings', 'SavePrefsFile', 'SaveProgressFile', 'SaveProfile']) try { sm[save](); } catch (e) { console.warn(save, e); }
}

export async function uploadToCloud(server: string, slot: string): Promise<number> {
  flushLive();
  const files = collectSaves();
  const n = Object.keys(files).length;
  if (!n) throw new Error('no local saves to upload');
  const resp = await fetch(`${serverUrl(server)}/save/${encodeURIComponent(slot)}`, { method: 'POST', body: JSON.stringify({ version: 1, app: 'sts2-web', files }) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return n;
}

/** 'miss': the server holds no save under this slot. Restores by replacing every local save with the cloud set and
 *  waits for the writes to commit — the caller must reload right after, before the game saves anything over them. */
export async function restoreFromCloud(server: string, slot: string): Promise<'miss' | 'ok'> {
  const resp = await fetch(`${serverUrl(server)}/save/${encodeURIComponent(slot)}`);
  if (resp.status === 404) return 'miss';
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json: any = await resp.json();
  if (!json || typeof json !== 'object' || !json.files || typeof json.files !== 'object') throw new Error('unexpected payload');
  // Replace, not merge: a leftover local current_run.save would fake a "Continue" that is not in the cloud copy.
  for (const p of $.vfs.list('user://')) if (!TMP.test(p)) $.vfs.remove(p);
  for (const [p, s] of Object.entries<any>(json.files)) if (!TMP.test(p) && typeof s === 'string') $.vfs.write(p, s);
  await $.vfs.flush();
  return 'ok';
}

// restoreFromCloud() rewrites the vfs under the (stale) in-memory SaveManager: the pagehide quit-saves would clobber
// the restored files with that state. The UI sets this after a successful restore; main.tsx skips one quit-save for it.
let restored = false;
export const suppressQuitSave = () => restored;
export const markRestored = () => { restored = true; };
