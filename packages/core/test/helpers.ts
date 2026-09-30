import fs from 'node:fs';
import path from 'node:path';
import * as G from '../src/index';

export const ASSETS = path.resolve(__dirname, '../../../assets');
const map = (rel: string) => {
  const m = /^localization\/(.*)$/.exec(rel);
  return m ? path.join(ASSETS, 'i18n', m[1]) : path.join(ASSETS, rel);
};
let booted = false;
/** Headless boot: resources from ./assets, same init order as NGame. */
export function boot() {
  if (booted) return G;
  booted = true;
  G.$.setResourceReader((rel) => { const f = map(rel); return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null; });
  G.$.setResourceLister((dir) => { const d = map(dir.replace(/\/$/, '')); return fs.existsSync(d) ? fs.readdirSync(d) : []; });
  G.initGame({ test: true });
  return G;
}
