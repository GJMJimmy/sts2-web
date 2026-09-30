// Formats every card/relic/potion text through the transpiled SmartFormat pipeline and fails on any localization error.
import { it, expect } from 'vitest';
import { boot } from './helpers';

// MadScience's CardType var is only valid after the Tinker Time event configures it (the original errors on the bare card too).
const CONTEXT_ONLY = new Set(['MAD_SCIENCE']);

for (const lang of ['eng', 'zhs']) {
  it(`formats all card, relic and potion text without errors (${lang})`, () => {
    const G: any = boot();
    G.LocManager.Instance.SetLanguage(lang);
    const errors: string[] = [];
    G.$.setGodotLogSink((level: string, msg: string) => { if (level === 'error') errors.push(msg.split('\n').slice(0, 3).join(' | ')); });
    let n = 0;
    try {
      for (const c of G.ModelDb.AllCards) {
        if (CONTEXT_ONLY.has(c.Id.Entry)) continue;
        const m = c.ToMutable();
        m.GetDescriptionForPile(G.PileType.Hand); n++;
        if (m.IsUpgradable) { m.UpgradeInternal?.(); m.GetDescriptionForPile(G.PileType.Hand); n++; }
      }
      for (const r of G.ModelDb.AllRelics) { r.ToMutable().DynamicDescription.GetFormattedText(); n++; }
      for (const p of G.ModelDb.AllPotions) { p.ToMutable().DynamicDescription.GetFormattedText(); n++; }
    } finally {
      G.$.setGodotLogSink(null);
      G.LocManager.Instance.SetLanguage('eng');
    }
    console.log(`${lang}: formatted ${n} texts, ${errors.length} errors`);
    expect(errors.slice(0, 20)).toEqual([]);
  });
}
