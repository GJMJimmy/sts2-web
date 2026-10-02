// The enums the original's saves hold are the ones its serializer contexts register a string converter for. The web
// build writes them as numbers (snapshot() in packages/core/src/rt/json.ts), so a member that moves to another number
// in a new game version silently changes what every existing save means. This prints the name → number table of those
// enums in the current rule layer; packages/core/test/old-saves.test.ts compares the frozen copy next to each set of
// save samples (fixtures/saves-v<game version>/enums.json) with the rule layer of the day.
// Usage: node tools/save-enums.mjs > packages/core/test/fixtures/saves-v<game version>/enums.json   (needs ref/decompiled)
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const names = new Set();
for (const f of fs.readdirSync(path.join(root, 'ref/decompiled'), { recursive: true })) {
  if (!f.endsWith('.cs')) continue;
  for (const m of read(`ref/decompiled/${f}`).matchAll(/JsonStringEnumConverter<([\w.]+)>/g)) names.add(m[1].split('.').pop());
}
names.delete('TEnum'); // SnakeCaseJsonStringEnumConverter<TEnum>'s own declaration

const members = (body) => Object.fromEntries(Array.from(body.matchAll(/(\w+)\s*[=:]\s*(-?\d+)/g), (m) => [m[1], Number(m[2])]));
const tables = new Map();
for (const m of read('packages/core/src/gen/sts2.ts').matchAll(/^export enum (\w+) \{(.*)\}$/gm)) tables.set(m[1], members(m[2]));
for (const m of read('packages/core/src/gen/stubs.ts').matchAll(/\$\.stubEnum\("(\w+)", \{([^}]*)\}/g)) if (!tables.has(m[1])) tables.set(m[1], members(m[2]));

const missing = [...names].filter((n) => !tables.has(n));
if (!names.size || missing.length) { console.error(names.size ? `not in the rule layer: ${missing.join(', ')}` : 'no enums found: is ref/decompiled there?'); process.exit(1); }
console.log(JSON.stringify(Object.fromEntries([...names].sort().map((n) => [n, tables.get(n)])), null, 2));
