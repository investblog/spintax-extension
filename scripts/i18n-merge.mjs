/**
 * Merge per-surface key fragments into the EN messages file.
 *
 * Extraction runs surface by surface (and several surfaces in parallel), so each one writes its own
 * `scripts/i18n/fragments/<surface>.json` instead of all of them fighting over one file. This merges
 * them in a stable order, refuses duplicate keys across fragments, and keeps the manifest keys first.
 *
 *   node scripts/i18n-merge.mjs           merge fragments → src/public/_locales/en/messages.json
 *   node scripts/i18n-merge.mjs --check   fail if the merged result differs from what is on disk
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fragmentsDir = path.join(root, 'scripts', 'i18n', 'fragments');
const enFile = path.join(root, 'src', 'public', '_locales', 'en', 'messages.json');
const MANIFEST_KEYS = ['extName', 'extDescription'];

const current = JSON.parse(fs.readFileSync(enFile, 'utf8'));
const merged = {};
for (const key of MANIFEST_KEYS) if (current[key]) merged[key] = current[key];

const files = fs.existsSync(fragmentsDir) ? fs.readdirSync(fragmentsDir).filter((f) => f.endsWith('.json')).sort() : [];
const owner = new Map();
for (const file of files) {
  const fragment = JSON.parse(fs.readFileSync(path.join(fragmentsDir, file), 'utf8'));
  for (const [key, entry] of Object.entries(fragment)) {
    if (owner.has(key)) {
      console.error(`✖ duplicate key "${key}": ${owner.get(key)} and ${file}`);
      process.exit(1);
    }
    if (MANIFEST_KEYS.includes(key)) {
      console.error(`✖ fragment ${file} redefines the manifest key "${key}"`);
      process.exit(1);
    }
    owner.set(key, file);
    merged[key] = entry;
  }
}

const out = `${JSON.stringify(merged, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const same = fs.readFileSync(enFile, 'utf8') === out;
  console.log(same ? 'i18n merge: en/messages.json is up to date' : '✖ en/messages.json differs from the fragments');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(enFile, out);
console.log(`i18n merge: ${files.length} fragment(s) → ${Object.keys(merged).length} keys`);
