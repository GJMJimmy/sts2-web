// What the hand-written code names in the generated rule layer must still exist there. The app reaches it through
// `G: any`, and missing nodes fall back to inert stubs, so a class, overload or node renamed by a new game version
// compiles and fails silently at run time. Run after every `pnpm gen` (game version upgrades above all).
// Usage: node tools/check-refs.mjs   (exit 1 when something no longer resolves)
// Checked: G.<Name> exports (g.<Name> in packages/core), overload- and constructor-suffixed members called or assigned
// (Foo$Bar, $ctor_X$1), the members packages/core/src/overrides.ts replaces, every quoted full type name
// ('MegaCrit.…', the runtime's own included), model ids compared as text (Id.Entry === 'X') and localization keys
// with literal arguments (loc('table', 'KEY')).
// Not seen: names built at run time, enum values written as bare numbers (`type !== 1 /* BaseDynamic */`), and whether
// a replaced member is still called or still does what the replacement assumes.
// Notes (no failure): N('…') nodes the rule layer does not reference, i.e. hooks nothing calls.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

const OVERRIDES = 'packages/core/src/overrides.ts';
const gen = read('packages/core/src/gen/sts2.ts'), stubs = read('packages/core/src/gen/stubs.ts');
const hand = [...walk('packages/app/src'), ...walk('packages/core/src/rt'), 'packages/core/src/shell.ts', OVERRIDES, ...walk('packages/core/test'), ...walk('tools/e2e')]
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f));
const exported = new Set(['$']);
for (const f of ['packages/core/src/gen/sts2.ts', 'packages/core/src/shell.ts'])
  for (const m of read(f).matchAll(/^export (?:abstract )?(?:class|enum|const|function|interface) (\w+)/gm)) exported.add(m[1]);
// declared by the rule layer or its stubs, or asked of the runtime by the rule layer ($.ext: what rt provides)
const fullNames = new Set([...gen.matchAll(/\$fullName = "([^"]+)"/g), ...stubs.matchAll(/\$fullName = "([^"]+)"/g), ...stubs.matchAll(/\$\.stub\("([^"]+)"/g), ...gen.matchAll(/\$\.ext\("([^"]+)"\)/g)].map((m) => m[1]));
// model ids are the class name in upper snake case: compare without the underscores
const classKeys = new Set([...exported].map((n) => n.toLowerCase()));
const tables = new Map();
const table = (t) => { if (!tables.has(t)) { const f = path.join(root, 'assets/i18n/eng', `${t}.json`); tables.set(t, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null); } return tables.get(t); };
/** Whether the generated class declares the member (method, accessor or static). */
const declares = (cls, member) => {
  const at = gen.search(new RegExp(`^export (?:abstract )?class ${cls}\\b`, 'm'));
  if (at < 0) return false;
  const end = gen.indexOf('\nexport ', at + 1);
  return new RegExp(`^  (?:static )?(?:get |set )?${member.replace(/\$/g, '\\$')}\\b`, 'm').test(gen.slice(at, end < 0 ? undefined : end));
};

const bad = [], notes = [];
for (const f of hand) {
  const aliases = new Map(); // overrides.ts: `const io = g.GodotFileIo.prototype`
  read(f).split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const miss = (what) => bad.push(`${f}:${i + 1}  ${what}`);
    // the rule layer is `G` everywhere; packages/core's own files also call it `g`
    for (const m of line.matchAll(f.startsWith('packages/core/src/') ? /(?<![\w$.])[Gg]\.([A-Z]\w*)/g : /(?<![\w$.])(?:window\.)?G\.([A-Z]\w*)/g)) if (!exported.has(m[1])) miss(`G.${m[1]} is not exported by the rule layer`);
    for (const m of line.matchAll(/\.((?:\$(?:ctor|zero)_\w+|[A-Za-z_]\w*\$\w+)(?:\$\w+)*)(?=\(|\s*=[^=])/g)) if (!gen.includes(`${m[1]}(`) && !stubs.includes(`${m[1]}(`)) miss(`member ${m[1]} is not in the rule layer`);
    for (const m of line.matchAll(/\bN\('([\w.]+)'\)/g)) if (!fullNames.has(`MegaCrit.Sts2.Core.Nodes.${m[1]}`)) notes.push(`${f}:${i + 1}  node ${m[1]} is not referenced by the rule layer`);
    for (const m of line.matchAll(/['"](MegaCrit\.[\w.+`]*[\w`])['"]/g)) if (!fullNames.has(m[1])) miss(`type ${m[1]} is not in the rule layer`);
    for (const m of line.matchAll(/\.Entry\s*[!=]==?\s*'([A-Z][A-Z0-9_]*)'/g)) if (!classKeys.has(m[1].replaceAll('_', '').toLowerCase())) miss(`model id ${m[1]} has no class`);
    for (const m of line.matchAll(/\bloc[v]?\('(\w+)',\s*'([^'$]+)'/g)) { const t = table(m[1]); if (!t) miss(`localization table ${m[1]} is missing`); else if (!(m[2] in t)) miss(`localization key ${m[1]}/${m[2]} is missing`); }
    if (f !== OVERRIDES) return;
    // a replacement only takes effect while the class still declares the member it replaces
    const alias = /\bconst (\w+) = g\.(\w+)\.prototype\b/.exec(line);
    if (alias) aliases.set(alias[1], alias[2]);
    const replaced = [
      ...Array.from(line.matchAll(/\bg\.(\w+)(?:\.prototype)?\.([\w$]+)\s*=[^=]/g), (m) => [m[1], m[2]]),
      ...Array.from(line.matchAll(/^(\w+)\.([\w$]+)\s*=[^=]/g), (m) => [aliases.get(m[1]), m[2]]),
      ...Array.from(line.matchAll(/Object\.defineProperty\(g\.(\w+)\.prototype,\s*'(\w+)'/g), (m) => [m[1], m[2]]),
    ];
    for (const [cls, member] of replaced) if (cls && !declares(cls, member)) miss(`${cls}.${member} is replaced but the rule layer no longer declares it`);
  });
}
if (notes.length) console.log(`notes (${notes.length}):\n${notes.join('\n')}\n`);
console.log(bad.length ? `unresolved (${bad.length}):\n${bad.join('\n')}` : `ok: ${hand.length} hand-written files checked against the rule layer`);
process.exit(bad.length ? 1 : 0);
