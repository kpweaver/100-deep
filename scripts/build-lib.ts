/**
 * Builds build/lib: the Angband data the engine runs with.  It is upstream's
 * lib (engine/upstream/lib, never edited) with the name changes in
 * engine/renames.txt applied, so the game uses no Tolkien-specific names.
 * Only what the engine needs is copied (Gervais tiles only, as in LICENSES.md).
 *
 *   node scripts/build-lib.ts          (run by build-engine.sh and build-web.ts)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'engine/upstream/lib');
const out = join(root, 'build/lib');

interface Rule { from: string; to: string; re: RegExp; ci: RegExp; hits: number }

/** Whole-word rules, longest first so "Sauron, the Sorcerer" wins over "Sauron" */
export function loadRules(file = join(root, 'engine/renames.txt')): Rule[] {
  const rules: Rule[] = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(.+?)\s+=>\s+(.+)$/);
    if (!m) throw new Error(`renames.txt: cannot parse "${line}"`);
    const from = m[1];
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundaries that understand accented letters (Dúnadan, Eöl...)
    const word = `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`;
    rules.push({ from, to: m[2], re: new RegExp(word, 'gu'), ci: new RegExp(word, 'giu'), hits: 0 });
  }
  return rules.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Apply every rule to a line in one pass, so replacements are never
 * re-replaced.  With ignoreCase (monster "friends" lines and the tile prefs'
 * monster: lines, which the engine looks up case-insensitively) a lowercase match gets a lowercase name.
 */
export function renameLine(line: string, rules: Rule[], ignoreCase = false): string {
  const marks: { at: number; end: number; to: string; rule: Rule }[] = [];
  for (const rule of rules) {
    const re = ignoreCase ? rule.ci : rule.re;
    re.lastIndex = 0;
    for (let m; (m = re.exec(line)); ) {
      const at = m.index, end = at + m[0].length;
      if (marks.some((k) => at < k.end && end > k.at)) continue;
      const lower = m[0] === m[0].toLowerCase() && m[0] !== rule.from;
      marks.push({ at, end, to: lower ? rule.to.toLowerCase() : rule.to, rule });
    }
  }
  if (!marks.length) return line;
  marks.sort((a, b) => a.at - b.at);
  let res = '', pos = 0;
  for (const k of marks) {
    res += line.slice(pos, k.at) + k.to;
    pos = k.end;
    k.rule.hits++;
  }
  return res + line.slice(pos);
}

/**
 * Split a long joined description back into desc: lines (the engine reads
 * lines into a 1 KiB buffer).  Splits before a space so the concatenation
 * is exactly the original text.
 */
function rewrapDesc(line: string, max = 300): string[] {
  if (!line.startsWith('desc:') || line.length <= max) return [line];
  const out: string[] = [];
  let text = line.slice(5);
  while (text.length > max) {
    let cut = text.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    out.push('desc:' + text.slice(0, cut));
    text = text.slice(cut);
  }
  out.push('desc:' + text);
  return out;
}

/** Plurals the engine would get wrong by adding "s" */
const PLURALS: Record<string, string> = { 'dire wolf': 'dire wolves' };

function renameFile(path: string, rules: Rule[]) {
  const isMonsterBase = path.endsWith('monster_base.txt');
  const isMonsters = path.endsWith('/monster.txt');
  // Join each multi-line description into one line, so names split across
  // lines ("Cirith" / " Ungol") still match.  The engine concatenates
  // consecutive desc: lines anyway, so the text is unchanged.
  const lines: string[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('desc:') && lines.length && lines[lines.length - 1].startsWith('desc:')) {
      lines[lines.length - 1] += line.slice(5);
    } else lines.push(line);
  }
  const outLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Comments, monster bases (internal; the engine looks up "Morgoth" by
    // name) and level names keep their text
    const keep = line.startsWith('#') || line.startsWith('base:') || (isMonsterBase && line.startsWith('name:'));
    const renamed = keep ? line : renameLine(line, rules, line.startsWith('friends:') || line.startsWith('monster:'));
    outLines.push(...rewrapDesc(renamed));
    const name = renamed.startsWith('name:') ? renamed.slice(5) : null;
    if (isMonsters && name && PLURALS[name] && !(lines[i + 1] ?? '').startsWith('plural:')) outLines.push(`plural:${PLURALS[name]}`);
  }
  writeFileSync(path, outLines.join('\n'));
}

/**
 * The engine stops reading a pref file at the first unknown monster, which
 * silently drops every tile after it, so a rename must reach both files.
 */
function checkTileNames() {
  const names = new Set(readFileSync(join(out, 'gamedata/monster.txt'), 'utf8').split('\n')
    .filter((l) => l.startsWith('name:')).map((l) => l.slice(5).toLowerCase()));
  const bad: string[] = [];
  for (const f of ['graf-dvg.prf', 'xtra-dvg.prf']) {
    for (const line of readFileSync(join(out, 'tiles/gervais', f), 'utf8').split('\n')) {
      const m = /^monster:([^:]+):/.exec(line);
      if (m && m[1] !== '<player>' && !names.has(m[1].toLowerCase())) bad.push(`${f}: ${m[1]}`);
    }
  }
  if (bad.length) throw new Error(`tile prefs name monsters that do not exist:\n  ${bad.join('\n  ')}`);
}

export function buildLib(): { rules: Rule[] } {
  if (!existsSync(join(src, 'gamedata'))) throw new Error(`missing ${src}: run git submodule update --init`);
  rmSync(out, { recursive: true, force: true });
  for (const dir of ['gamedata', 'customize', 'help', 'screens', 'tiles/gervais']) {
    cpSync(join(src, dir), join(out, dir), { recursive: true });
  }
  mkdirSync(join(out, 'tiles'), { recursive: true });
  cpSync(join(src, 'tiles/list.txt'), join(out, 'tiles/list.txt'));

  const rules = loadRules();
  const files = [
    ...readdirSync(join(out, 'gamedata')).filter((f) => f.endsWith('.txt')).map((f) => join(out, 'gamedata', f)),
    ...readdirSync(join(out, 'tiles/gervais')).filter((f) => f.endsWith('.prf')).map((f) => join(out, 'tiles/gervais', f)),
    join(out, 'customize/pref.prf'),
  ];
  for (const f of files) renameFile(f, rules);
  // The level list names levels "Angband 1" etc.; keep them short
  const world = join(out, 'gamedata/world.txt');
  writeFileSync(world, readFileSync(world, 'utf8').replaceAll('the Deep ', 'Deep '));
  checkTileNames();
  writeFileSync(join(out, 'README.txt'),
    'Generated by scripts/build-lib.ts from engine/upstream/lib and engine/renames.txt. Do not edit.\n');
  return { rules };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rules } = buildLib();
  const unused = rules.filter((r) => r.hits === 0);
  const total = rules.reduce((n, r) => n + r.hits, 0);
  console.log(`Built ${out} (${total} replacements, ${rules.length} rules)`);
  if (unused.length) console.log(`Rules with no match (check spelling): ${unused.map((r) => r.from).join(' | ')}`);
}
