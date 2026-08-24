/**
 * Fill a locale with the keys it is missing, using the English text as the placeholder value.
 *
 * Translation happens locale by locale; between extraction and the last translation pass the guard
 * would otherwise fail on key parity for every language still at two keys. Seeding keeps the parity
 * check meaningful (it now compares real key sets) while the untranslated values stay visibly
 * English — and `--report` says how much of each locale is still English.
 *
 *   node scripts/i18n-seed.mjs            seed every locale that is missing keys
 *   node scripts/i18n-seed.mjs --report   print translation coverage per locale
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const localesDir = path.join(root, 'src', 'public', '_locales');
const BASE = 'en';

const file = (l) => path.join(localesDir, l, 'messages.json');
const read = (l) => JSON.parse(fs.readFileSync(file(l), 'utf8'));
const locales = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== BASE)
  .map((e) => e.name)
  .sort();

const en = read(BASE);
const report = process.argv.includes('--report');

for (const locale of locales) {
  const current = read(locale);
  const next = {};
  let added = 0;
  let same = 0;
  for (const [key, entry] of Object.entries(en)) {
    if (current[key]) {
      next[key] = current[key];
      if (current[key].message === entry.message) same++;
    } else {
      next[key] = JSON.parse(JSON.stringify(entry));
      added++;
      same++;
    }
  }
  const total = Object.keys(en).length;
  if (report) {
    const done = total - same;
    console.log(`${locale}: ${done}/${total} translated (${Math.round((done / total) * 100)}%)`);
    continue;
  }
  if (added > 0) {
    fs.writeFileSync(file(locale), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`${locale}: +${added} key(s) seeded from ${BASE}`);
  } else {
    console.log(`${locale}: complete`);
  }
}
