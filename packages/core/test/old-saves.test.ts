/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { boot } from './helpers';

// What players have in their browsers: saves written by the web build of each game version it has shipped
// (fixtures/saves-v<game version>/, see the README there for how the samples were made). No later build may fail to
// read them or drop anything they hold.
const ROOT = path.resolve(__dirname, 'fixtures');
const dirs = (d: string) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const VERSIONS = dirs(ROOT).filter((v) => v.startsWith('saves-v'));
const POINTS = VERSIONS.flatMap((v) => dirs(path.join(ROOT, v))
  .flatMap((run) => fs.readdirSync(path.join(ROOT, v, run)).filter((f) => f.endsWith('.json')).map((f) => `${v}/${run}/${f.slice(0, -5)}`)));

/** [path under user://, text] of every file of a sample. */
const filesOf = (dir: string) => (fs.readdirSync(dir, { recursive: true }) as string[])
  .filter((f) => fs.statSync(path.join(dir, f)).isFile())
  .map((f) => [f.split(path.sep).join('/'), fs.readFileSync(path.join(dir, f), 'utf8')] as const);

/** Where `now` (the loaded save, written back) no longer holds what `old` (the file) held. Added members are fine. */
function lost(old: any, now: any, at: string, out: string[] = []): string[] {
  if (old === null || typeof old !== 'object') { if (old !== now) out.push(`${at}: ${JSON.stringify(old)} → ${JSON.stringify(now)}`); return out; }
  if (now === null || typeof now !== 'object' || Array.isArray(old) !== Array.isArray(now)) { out.push(`${at}: gone`); return out; }
  if (Array.isArray(old) && old.length !== now.length) out.push(`${at}: ${old.length} → ${now.length} items`);
  for (const k of Object.keys(old)) {
    // a type may be renamed as long as old saves still come back as an instance of a class
    if (k === '$t') { if (typeof now.$t !== 'string') out.push(`${at}: no longer a ${old.$t}`); continue; }
    // a generic instance's type argument (SavedProperty<int>.$T_T): transpiler bookkeeping that leaks into the file;
    // a primitive's has never come back from restore(), and nothing reads it
    if (k.startsWith('$T_')) continue;
    lost(old[k], now[k], Array.isArray(old) ? `${at}[${k}]` : `${at}.${k}`, out);
  }
  return out;
}

// Saves hold enums as numbers (snapshot() in rt/json.ts). enums.json is the name → number table of every enum the
// original stores in saves, frozen with tools/save-enums.mjs when the samples next to it were made. A member that has
// since moved to another number makes those saves mean something else, without any read error.
describe.each(VERSIONS)('enums of %s', (version) => {
  it('still have the numbers its saves were written with', () => {
    const G: any = boot();
    const stubs: string[] = G.$.extKeys().stubs;
    const frozen: Record<string, Record<string, number>> = JSON.parse(fs.readFileSync(path.join(ROOT, version, 'enums.json'), 'utf8'));
    const moved = Object.entries(frozen).flatMap(([name, members]) => {
      const stub = stubs.find((k) => k.endsWith(`.${name}`)); // an enum of the untranslated layers (ControllerMappingType)
      const now = G[name] ?? (stub && G.$.ext(stub));
      return Object.entries(members).filter(([m, n]) => now?.[m] !== n).map(([m, n]) => `${name}.${m}: ${n} → ${now?.[m]}`);
    });
    expect(moved).toEqual([]);
  });
});

describe.each(POINTS)('web save %s', (point) => {
  const dir = path.join(ROOT, point);
  const facts = JSON.parse(fs.readFileSync(`${dir}.json`, 'utf8')); // what the browser read from these files
  const files = filesOf(dir);
  const has = (name: string) => files.some(([f]) => f.endsWith(`/${name}`));

  it('holds the files the browser had', () => {
    expect(files.length).toBe(facts.files);
  });

  it('every file comes back whole through the save serializer', () => {
    const G: any = boot();
    const bad = files.flatMap(([f, text]) => { const raw = JSON.parse(text); return lost(raw, G.$.snapshot(G.$.restore(raw)), f); });
    expect(bad).toEqual([]);
  });

  it('every model id in it still names a model', () => {
    const G: any = boot();
    const ids = new Set(files.flatMap(([, text]) => Array.from(text.matchAll(/"\$_Category":"(\w+)","\$_Entry":"(\w+)"/g), (m) => `${m[1]}.${m[2]}`)));
    ids.delete('NONE.NONE'); // ModelId.none
    const gone = [...ids].filter((id) => { const [category, entry] = id.split('.'); return G.ModelDb.GetByIdOrNull(G.AbstractModel, new G.ModelId().$ctor_ModelId$2(category, entry)) == null; });
    expect(gone).toEqual([]);
  });

  it('SaveManager reads it, and its run continues where the browser left it', async () => {
    const G: any = boot();
    if (G.RunManager.Instance.IsInProgress) G.RunManager.Instance.CleanUp(true); // the previous sample's run
    for (const p of G.$.vfs.list('user://')) G.$.vfs.remove(p);
    for (const [f, text] of files) G.$.vfs.write(`user://${f}`, text);
    // the browser's SaveManager (GodotFileIo over user://): test mode's own keeps saves in a mock store
    const sm = new G.SaveManager().$ctor_SaveManager(new G.GodotFileIo().$ctor_GodotFileIo(G.UserDataPathProvider.GetAccountScopedBasePath(null, null, null)), false);
    G.SaveManager.MockInstanceForTesting(sm);
    const ok = G.ReadSaveStatus.Success;
    // the order of initGame
    const settings = sm.InitSettingsData();
    sm.InitProfileId(null);
    const progress = sm.InitProgressData(), prefs = sm.InitPrefsData();
    if (has('settings.save')) expect(settings.Status).toBe(ok);
    if (has('progress.save')) expect(progress.Status).toBe(ok);
    if (has('prefs.save')) expect(prefs.Status).toBe(ok);

    const histories = [...sm.GetAllRunHistoryNames()];
    if (facts.history != null) expect(histories.length).toBe(facts.history);
    for (const name of histories) expect(sm.LoadRunHistory(name).Status).toBe(ok);

    expect(sm.HasRunSave).toBe(has('current_run.save'));
    if (!sm.HasRunSave) return;
    expect(sm.LoadRunSave().Status).toBe(ok);
    const run = await G.continueSavedRun();
    const me = run.Players[0];
    expect({ floor: run.TotalFloor, hp: me.Creature.CurrentHp, maxHp: me.Creature.MaxHp, gold: me.Gold, deck: me.Deck.Cards.length, relics: me.Relics.length })
      .toEqual({ floor: facts.floor, hp: facts.hp, maxHp: facts.maxHp, gold: facts.gold, deck: facts.deck, relics: facts.relics });
  });
});
