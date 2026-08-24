/**
 * Locale guard — the static half of the length check (the dynamic half is e2e/i18n-overflow.mjs).
 *
 * Ported in spirit from spintax-studio (`gui/SpxStrings.pas` BUDGETS + `tests/studio_tests.dpr`
 * TestStrings): English is the base, every id must exist and be non-empty in every language, and a
 * caption that sits in a computed slot has a BUDGET in code points that every language must fit.
 * A budget of 0 (or a key absent from budgets.json) means "free to grow" — paragraphs, toasts.
 *
 * A message with a placeholder is measured SUBSTITUTED: a placeholder that fits proves nothing
 * about "128 000", so placeholders are replaced with the widest realistic value before measuring.
 *
 *   node scripts/i18n-check.mjs            check every locale
 *   node scripts/i18n-check.mjs --budgets  print the current length of every budgeted key
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const localesDir = path.join(root, 'src', 'public', '_locales');
const budgetsFile = path.join(root, 'scripts', 'i18n', 'budgets.json');
const BASE = 'en';
/** Store limits per locale (CWS/Edge/AMO): the name and the short description are hard caps. */
const STORE_LIMITS = { extName: 45, extDescription: 132 };

/**
 * Worst-case values used when measuring a message that carries placeholders. A name missing here
 * would be measured as a short word and could hide a real overflow, so an unknown placeholder is
 * reported as a failure rather than quietly substituted (Codex review #4).
 */
const WORST = {
  count: '128 000',
  n: '128 000',
  rows: '128 000',
  columns: '128 000',
  step: '9',
  key: 'S',
  date: '2026-08-24',
  day: '2026-08-24',
  name: 'Wellness Weekly',
  host: 'example-company.com',
  url: 'https://example-company.com/contact-us/partnerships',
  // The panel truncates the displayed path to 22 code points (shortPath); measure what is shown.
  path: '/contact-us/partnersh…',
  status: 'filled, unconfirmed',
  reason: 'no contact',
  state: 'unreviewed',
  slot: 'Your phone',
  field: 'Your message',
  provider: 'Outlook — Microsoft 365 (work)',
  size: '128.4 MB',
  used: '128.4 MB',
  quota: '2.9 GB',
};
const UNKNOWN_PLACEHOLDER = 'Wellness Weekly';

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const locales = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const messages = Object.fromEntries(locales.map((l) => [l, readJson(path.join(localesDir, l, 'messages.json'))]));
const budgets = fs.existsSync(budgetsFile) ? readJson(budgetsFile) : {};

const TOKEN = /\$([A-Za-z0-9_]+)\$/g;

/** Placeholder names a message uses, lowercased and sorted — the set must survive translation. */
const placeholdersOf = (entry) => {
  const inText = [...String(entry.message).matchAll(TOKEN)].map((m) => m[1].toLowerCase());
  return [...new Set(inText)].sort();
};

/**
 * name to argument mapping, sorted. A translation may reorder the words freely, but swapping which
 * argument a name points at renders the wrong value inside a right-looking sentence, and name
 * parity alone cannot see that (Codex review #8).
 */
const mappingOf = (entry) =>
  Object.entries(entry.placeholders ?? {})
    .map(([name, def]) => `${name.toLowerCase()}=${def?.content ?? '?'}`)
    .sort()
    .join(',');

const unknownPlaceholders = new Set();
/** The message as the user sees it: placeholders replaced with a wide realistic value. */
const rendered = (entry) =>
  String(entry.message).replace(TOKEN, (_, name) => {
    const known = WORST[name.toLowerCase()];
    if (!known) unknownPlaceholders.add(name.toLowerCase());
    return known ?? UNKNOWN_PLACEHOLDER;
  });

const baseKeys = Object.keys(messages[BASE] ?? {});
check(baseKeys.length > 0, `${BASE}/messages.json is empty`);

// 1. Key parity — the same ids everywhere.
for (const locale of locales) {
  if (locale === BASE) continue;
  const keys = Object.keys(messages[locale]);
  const missing = baseKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !baseKeys.includes(k));
  check(missing.length === 0, `${locale}: ${missing.length} key(s) missing: ${missing.slice(0, 8).join(', ')}`);
  check(extra.length === 0, `${locale}: ${extra.length} key(s) not in ${BASE}: ${extra.slice(0, 8).join(', ')}`);
}

for (const locale of locales) {
  for (const [key, entry] of Object.entries(messages[locale])) {
    const text = String(entry?.message ?? '');
    // 2. Nothing is blank — a missing caption makes the control disappear, worse than English.
    check(text.trim().length > 0, `${locale}.${key}: empty message`);

    // 3. Placeholder parity: same names AND same name-to-argument mapping as the base.
    if (locale !== BASE && messages[BASE][key]) {
      const want = placeholdersOf(messages[BASE][key]).join(',');
      const got = placeholdersOf(entry).join(',');
      check(want === got, `${locale}.${key}: placeholders [${got}] differ from ${BASE} [${want}]`);
      check(
        mappingOf(entry) === mappingOf(messages[BASE][key]),
        `${locale}.${key}: placeholder mapping ${mappingOf(entry)} differs from ${BASE} ${mappingOf(messages[BASE][key])}`,
      );
    }

    // 4. Every used placeholder is declared, every declaration is used, and each content is a real
    //    argument reference — anything else renders as literal text.
    const used = placeholdersOf(entry);
    for (const name of used)
      check(
        entry.placeholders && Object.keys(entry.placeholders).some((p) => p.toLowerCase() === name),
        `${locale}.${key}: placeholder ${name} is used but not declared`,
      );
    for (const [name, def] of Object.entries(entry.placeholders ?? {})) {
      check(used.includes(name.toLowerCase()), `${locale}.${key}: placeholder ${name} is declared but unused`);
      check(
        /^\$[1-9]$/.test(String(def?.content ?? '')),
        `${locale}.${key}: placeholder ${name} has content ${def?.content}, expected an argument reference`,
      );
    }

    // 5. Budgets — measured on the substituted text, in code points.
    const budget = budgets[key] ?? STORE_LIMITS[key] ?? 0;
    if (budget > 0) {
      const len = [...rendered(entry)].length;
      check(len <= budget, `${locale}.${key}: ${len} chars, budget ${budget} — "${text.slice(0, 60)}"`);
    }
  }
}

// 6. Budgets must name real keys, or a renamed key silently loses its guard.
for (const key of Object.keys(budgets))
  check(baseKeys.includes(key), `budgets.json names "${key}", which is not a key in ${BASE}`);

// 7. A placeholder measured blind is a hole in the guard, not a pass.
for (const name of unknownPlaceholders)
  check(false, `placeholder ${name} has no worst-case value in WORST — its budget is measured blind`);

if (process.argv.includes('--budgets')) {
  const rows = Object.keys(budgets).map((key) => {
    const worst = locales
      .map((l) => ({ l, n: [...rendered(messages[l][key] ?? { message: '' })].length }))
      .sort((a, b) => b.n - a.n)[0];
    return `${String(budgets[key]).padStart(3)}  ${String(worst.n).padStart(3)} ${worst.l}  ${key}`;
  });
  console.log('bud  worst        key');
  console.log(rows.sort().join('\n'));
}

console.log(`i18n: ${locales.length} locales · ${baseKeys.length} keys · ${Object.keys(budgets).length} budgets`);
if (failures.length > 0) {
  for (const f of failures) console.error(`✖ ${f}`);
  console.error(`\ni18n check FAILED: ${failures.length} problem(s)`);
  process.exit(1);
}
console.log('i18n check OK');
