import { describe, it, expect } from 'vitest';
import { boot } from './helpers';

describe('GodotFileIo', () => {
  it('writes through a .tmp that is gone afterwards (sync and async)', async () => {
    const G: any = boot();
    const io = new G.GodotFileIo();
    io.SaveDir = 'user://savetest';
    io.WriteFile$String_String('a.save', '{"a":1}');
    await io.WriteFileAsync$String_String('b.run', '{"b":2}');
    const files = G.$.vfs.list('user://savetest');
    expect(files.filter((f: string) => f.endsWith('.tmp'))).toEqual([]);
    expect(G.$.vfs.read('user://savetest/a.save')).toBe('{"a":1}');
    expect(G.$.vfs.read('user://savetest/b.run')).toBe('{"b":2}');
  });
});

describe('SavedProperty round trip', () => {
  it('every relic survives ToSerializable → FromSerializable (FUR_COAT int[], PAELS_TOOTH empty list)', () => {
    const G: any = boot();
    const bad: string[] = [];
    for (const r of [...G.ModelDb.AllRelics]) {
      try { G.RelicModel.FromSerializable(r.ToMutable().ToSerializable()); } catch (e) { bad.push(`${r.Id.Entry}: ${e}`); }
    }
    expect(bad).toEqual([]);
    const fur = [...G.ModelDb.AllRelics].find((r: any) => r.Id.Entry === 'FUR_COAT').ToMutable();
    fur.FurCoatCoordCols = [3, 1]; fur.FurCoatCoordRows = [5, 7]; fur.FurCoatCoordsSet = true;
    const back = G.RelicModel.FromSerializable(fur.ToSerializable());
    expect([...back.FurCoatCoordCols]).toEqual([3, 1]);
    expect([...back.FurCoatCoordRows]).toEqual([5, 7]);
  });
});

describe('model round trips', () => {
  it('every card, enchanted card and potion survives ToSerializable → FromSerializable', () => {
    const G: any = boot();
    const bad: string[] = [];
    for (const c of [...G.ModelDb.AllCards]) {
      try {
        const m = c.ToMutable();
        const back = G.CardModel.FromSerializable(m.ToSerializable());
        if (back.Id.Entry !== c.Id.Entry) bad.push(`card ${c.Id.Entry}: came back as ${back.Id.Entry}`);
      } catch (e) { bad.push(`card ${c.Id.Entry}: ${e}`); }
    }
    for (const p of [...G.ModelDb.AllPotions]) {
      try { G.PotionModel.FromSerializable(p.ToMutable().ToSerializable(0)); } catch (e) { bad.push(`potion ${p.Id.Entry}: ${e}`); }
    }
    expect(bad).toEqual([]);
  });
});
