/**
 * Complete every plural base with the four CLDR categories the locale set needs.
 *
 * `Intl.PluralRules('ru')` selects one / few / many / other; `('en')` only one / other. The guard
 * refuses a key a locale has and English lacks, so Russian could never translate `…Few` unless the
 * English file declares it. English `Few`/`Many` repeat the `Other` wording — unreachable in
 * English, indispensable as a slot for Russian.
 *
 *   node scripts/i18n-plurals.mjs           complete the fragments in place
 *   node scripts/i18n-plurals.mjs --check   report incomplete bases, change nothing
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'scripts', 'i18n', 'fragments');
const NEEDED = ['One', 'Few', 'Many', 'Other'];
const SUFFIX = /^(.*?)(One|Two|Few|Many|Other|Zero)$/;
const check = process.argv.includes('--check');

let incomplete = 0;
let added = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const full = path.join(dir, file);
  const fragment = JSON.parse(fs.readFileSync(full, 'utf8'));
  const bases = new Map();
  for (const key of Object.keys(fragment)) {
    const m = key.match(SUFFIX);
    if (!m) continue;
    const base = m[1];
    if (!bases.has(base)) bases.set(base, new Set());
    bases.get(base).add(m[2]);
  }
  // Iterate the BASES, not the Other entries: a base whose Other form was deleted would otherwise
  // be reported complete while `tn()` has nothing to fall back to (Codex review #9).
  for (const [base, cats] of bases) {
    if (!cats.has('Other')) {
      console.log(`${file}: ${base} has no Other form — tn() has nothing to fall back to`);
      incomplete++;
    }
  }
  const out = {};
  for (const [key, entry] of Object.entries(fragment)) {
    out[key] = entry;
    const m = key.match(SUFFIX);
    if (!m || m[2] !== 'Other') continue;
    const base = m[1];
    for (const cat of NEEDED) {
      if (bases.get(base)?.has(cat)) continue;
      incomplete++;
      if (check) {
        console.log(`${file}: ${base} has no ${cat}`);
        continue;
      }
      // Insert right after Other so the file reads base-by-base.
      out[`${base}${cat}`] = JSON.parse(JSON.stringify(entry));
      added++;
    }
  }
  if (!check && added > 0) fs.writeFileSync(full, `${JSON.stringify(out, null, 2)}\n`);
}

console.log(check ? `${incomplete} missing plural form(s)` : `completed ${added} plural form(s)`);
process.exit(check && incomplete > 0 ? 1 : 0);
