// Device locales → game language: the default before the player picks one in settings.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { platformLanguage } from '../src/shell';
import { ASSETS } from './helpers';

it('picks the first shipped language among the device locales', () => {
  const cases: [string[], string][] = [
    [['zh-CN', 'en'], 'zhs'],
    [['zh-Hans-SG'], 'zhs'],
    [['zh-TW', 'ja'], 'jpn'], // Traditional Chinese is not shipped: next preference
    [['zh-Hant-HK', 'zh'], 'zhs'],
    [['pt-BR'], 'ptb'],
    [['pt-PT', 'fr-CA'], 'fra'], // nor is European Portuguese
    [['es-ES'], 'spa'],
    [['es-419'], 'esp'],
    [['de_DE'], 'deu'],
    [['en-US', 'zh-CN'], 'eng'],
    [['nl', 'sv'], 'eng'],
    [[], 'eng'],
  ];
  for (const [locales, lang] of cases) expect(platformLanguage(locales), locales.join()).toBe(lang);
  // every language it can answer has tables to load
  const shipped: string[] = JSON.parse(fs.readFileSync(path.join(ASSETS, 'i18n/index.json'), 'utf8')).languages;
  const tags = ['en', 'de', 'fr', 'it', 'ja', 'ko', 'pl', 'ru', 'th', 'tr', 'zh', 'pt', 'es', 'es-MX'];
  for (const t of tags) expect(shipped, t).toContain(platformLanguage([t]));
});
