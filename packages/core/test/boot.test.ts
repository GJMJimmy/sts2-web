import { describe, it, expect } from 'vitest';
import { boot } from './helpers';

describe('headless boot', () => {
  it('initializes ModelDb and localization', () => {
    const G: any = boot();
    expect(Array.from(G.ModelDb.AllCards).length).toBeGreaterThan(500);
    const bash = G.ModelDb.Card(G.Bash);
    expect(bash.Title).toBe('Bash');
  });
});

describe('localization', () => {
  it('formats card descriptions through SmartFormat', () => {
    const G: any = boot();
    const bash = G.ModelDb.Card(G.Bash).ToMutable();
    const text = bash.GetDescriptionForPile(G.PileType.Deck, null);
    console.log('Bash:', JSON.stringify(text));
    expect(text).toContain('8');
  });
});
