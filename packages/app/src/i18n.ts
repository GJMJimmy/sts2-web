// Localization preload: the rule layer reads tables synchronously through Godot FileAccess (res://localization/...).
import { $, G } from './game';
import { A } from './assets';

export let languages: string[] = [];
/** The tables as lazy js/ chunks rather than fetched .json (CDN-cacheable, see loadAssetIndex). */
const tables = import.meta.glob<string>('../../../assets/i18n/*/*.json', { query: '?raw', import: 'default' });
export async function preloadLocalization(langs: string[]) {
  const idx = await (await fetch(A + 'i18n/index.json')).json();
  languages = idx.languages;
  const files = new Map<string, string>();
  await Promise.all(langs.flatMap((l) => idx.tables.map(async (t: string) => {
    const text = await tables[`../../../assets/i18n/${l}/${t}.json`]?.();
    if (text != null) files.set(`localization/${l}/${t}.json`, text);
  })));
  files.set('localization/completion.json', await (await fetch(A + 'i18n/completion.json')).text());
  $.setResourceReader((p: string) => files.get(p) ?? null);
  $.setResourceLister((dir: string) => {
    const pre = dir.replace(/\/$/, '') + '/';
    return [...files.keys(), ...listed].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length));
  });
}
/** Extra res:// paths that DirAccess listings should see (converted scenes, e.g. background layer directories). */
const listed: string[] = [];
export function addListedFiles(paths: string[]) { listed.push(...paths); }
export async function setLanguage(lang: string) {
  await preloadLocalization(lang === 'eng' ? ['eng'] : ['eng', lang]);
  try { localStorage.setItem('sts2web.lang', lang); } catch { /* private mode: not remembered */ }
  G.SaveManager.Instance.SettingsSave.Language = lang;
  G.LocManager.Instance.SetLanguage(lang);
  document.documentElement.dataset.lang = lang; // style.css: FontManager's per-language font substitution
}
/** A localized string with SmartFormat variables (numbers are added as decimals, like LocString.Add). */
export const locv = (table: string, key: string, vars: Record<string, string | number | boolean>) => {
  try {
    const ls = new G.LocString().$ctor_LocString(table, key);
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === 'number') ls.Add$String_Decimal(k, v);
      else if (typeof v === 'boolean') ls.Add$String_Boolean(k, v);
      else ls.Add$String_String(k, v);
    }
    return ls.GetFormattedText();
  } catch { return key; }
};
export const loc = (table: string, key: string) => {
  try { return new G.LocString().$ctor_LocString(table, key).GetFormattedText(); } catch { return key; }
};

/** App labels resolved through the game's own tables (English fallback when a table lacks the key). */
const UI = {
  endTurn: ['settings_ui', 'INPUT_SETTINGS.INPUT_TITLE.endTurn', 'End Turn'],
  enemyTurn: ['gameplay_ui', 'ENEMY_TURN', 'Enemy Turn'],
  proceed: ['gameplay_ui', 'PROCEED_BUTTON', 'Proceed'],
  skip: ['gameplay_ui', 'CHOOSE_CARD_SKIP_BUTTON', 'Skip'],
  loot: ['gameplay_ui', 'COMBAT_REWARD_HEADER_LOOT', 'Loot!'],
  drawPile: ['gameplay_ui', 'DRAW_PILE', 'Draw Pile'],
  discardPile: ['gameplay_ui', 'DISCARD_PILE', 'Discard Pile'],
  exhaust: ['card_keywords', 'EXHAUST.title', 'Exhaust'],
  chooseCard: ['gameplay_ui', 'CHOOSE_CARD_HEADER', 'Choose a Card'],
  chooseRelic: ['gameplay_ui', 'CHOOSE_RELIC_HEADER', 'Choose a Relic'],
  mainMenu: ['game_over_screen', 'BUTTON.mainMenu', 'Main Menu'],
  restSite: ['static_hover_tips', 'ROOM_REST.title', 'Rest Site'],
  restPrompt: ['rest_site_ui', 'PROMPT', 'What shall I do?'],
  merchant: ['map', 'LEGEND_MERCHANT.title', 'Merchant'],
  cardRemoval: ['merchant_room', 'MERCHANT.cardRemovalService.title', 'Card Removal Service'],
  treasure: ['map', 'LEGEND_TREASURE.title', 'Treasure'],
  map: ['map', 'LEGEND_MAP.hoverTip.title', 'Map'],
  back: ['extensions', 'EXTENSION.tutorial.back', 'Back'],
  close: ['timeline', 'EPOCH_INSPECT.closeButton', 'Close'],
  confirm: ['timeline', 'UNLOCK_CONFIRM', 'Confirm'],
  settings: ['gameplay_ui', 'PAUSE_MENU.SETTINGS', 'Settings'],
  language: ['settings_ui', 'LANGUAGE', 'Language'],
  fastMode: ['settings_ui', 'FASTMODE', 'Fast Mode'],
  masterVolume: ['settings_ui', 'MASTER_VOLUME', 'Master Volume'],
  musicVolume: ['settings_ui', 'MUSIC_VOLUME', 'BGM Volume'],
  sfxVolume: ['settings_ui', 'SFX_VOLUME', 'SFX Volume'],
  ambienceVolume: ['settings_ui', 'AMBIENCE_VOLUME', 'Ambience Volume'],
  deck: ['static_hover_tips', 'DECK.title', 'Deck'],
  fpsCap: ['settings_ui', 'FPS_CAP', 'FPS Limit'],
  msaa: ['settings_ui', 'MSAA', 'MSAA'],
  credits: ['settings_ui', 'CREDITS_BUTTON_LABEL', 'Credits'],
  stars: ['static_hover_tips', 'STAR_COUNT.title', 'Stars'],
} as const;
export function t(k: keyof typeof UI): string {
  const [table, key, fallback] = UI[k];
  const s = loc(table, key).replace(/\s*[(（][A-Z0-9]{1,3}[)）]$/, ''); // hover-tip titles carry a hotkey hint: "Deck (D)"
  return s && s !== key ? s : fallback;
}

/** App-only strings the game has no text for (it uses visuals instead); English fallback. */
const APP: Record<string, Record<string, string>> = {
  storageFull: { eng: 'Browser storage is full: progress could not be saved.', zhs: '浏览器存储已满，进度未能保存。' },
  afterReload: { eng: 'Applies the next time the game loads.', zhs: '下次载入游戏时生效。' },
  noStorage: { eng: 'This browser blocks storage: progress lasts until the tab closes.', zhs: '浏览器禁止了本地存储：进度只保留到关闭页面为止。' },
  // ui/disclaimer.tsx: the port's own notice in place of the game's Early Access text
  aboutHeader: { eng: 'About This Project', zhs: '关于本项目' },
  aboutBody: {
    eng: '[gold][b]Slay the Spire 2 Web[/b][/gold] is an unofficial, open-source fan port of the original game ([blue]v0.98.3[/blue]) that runs in your browser.\n\n'
      + 'If you like this project, come give it a [gold]Star[/gold] on GitHub! Every star keeps the updates coming:\n[url=https://github.com/moonrailgun/sts2-web]github.com/moonrailgun/sts2-web[/url]\n\n'
      + '[gray]Disclaimer: this project is for learning and technical exchange only, is non-commercial, and is not affiliated with Mega Crit. All game art, music and text are the property of Mega Crit. If you enjoy the game, please buy it on Steam and support the developers![/gray]\n\n'
      + 'Alright, you have a Spire to climb!',
    zhs: '[gold][b]杀戮尖塔2 网页版[/b][/gold]是由爱好者制作的非官方开源移植，基于原版 [blue]v0.98.3[/blue] 移植到网页上运行。\n\n'
      + '如果你喜欢这个项目，欢迎来 GitHub 给仓库点一个 [gold]Star[/gold]！你的每一颗 Star 都是项目继续更新的动力：\n[url=https://github.com/moonrailgun/sts2-web]github.com/moonrailgun/sts2-web[/url]\n\n'
      + '[gray]免责声明：本项目仅供学习与技术交流，不作任何盈利用途，与 Mega Crit 没有任何关联。游戏的美术、音乐、文本等全部内容的版权均归 Mega Crit 所有。喜欢这款游戏的话，请前往 Steam 购买正版支持原作者！[/gray]\n\n'
      + '好啦，让我们，在高塔的攀爬中相见！',
  },
};
export function appText(k: keyof typeof APP): string {
  const lang = (() => { try { return G.LocManager.Instance.Language; } catch { return 'eng'; } })();
  return APP[k][lang] ?? APP[k].eng;
}
