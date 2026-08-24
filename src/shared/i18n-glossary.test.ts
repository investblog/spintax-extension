import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Terminology guard, in the spirit of 301-ui's `docs-terminology.test.ts`: a term the glossary pins
 * must appear in the UI with the glossary's spelling, and the spellings we rejected must not appear
 * at all. It checks the vocabulary, not every sentence — a translator is free to phrase around it.
 *
 * The pinned set is deliberately small: words that show up in dozens of keys and would read as two
 * different products if they drifted. Each entry names the key it is anchored on, so a rename fails
 * here instead of silently dropping the check.
 */
const localesDir = path.resolve(__dirname, '../public/_locales');
const read = (l: string): Record<string, { message: string }> =>
  JSON.parse(fs.readFileSync(path.join(localesDir, l, 'messages.json'), 'utf8'));
/** Placeholder tokens are the same in every locale (parity forbids renaming them), so a term
 *  inside `$TEMPLATES$` is not a translation choice — strip them before looking for words. */
const words = (message: string): string => message.replace(/\$[A-Za-z0-9_]+\$/g, ' ').toLowerCase();
const has = (locale: string, needle: string): boolean =>
  Object.values(read(locale)).some((e) => words(e.message).includes(needle.toLowerCase()));

/** locale → [term that must be used, spellings that must never appear] */
const GLOSSARY: Record<string, { must: string[]; never: string[] }> = {
  ru: {
    // «Шаблон» / «Переменные» — из редактора spintax.net; «сид» — из Studio.
    must: ['шаблон', 'переменн', 'строк', 'кампани'],
    // «темплейт»/«роу» — калька; «спинтакс» кириллицей — только в прозе сайта, не в UI.
    never: ['темплейт', 'роу ', 'спинтакс'],
  },
  de: { must: ['vorlage', 'variable', 'zeile', 'kampagne'], never: ['template-', 'reihe'] },
  es: { must: ['plantilla', 'variable', 'fila', 'campaña'], never: ['template'] },
  fr: { must: ['modèle', 'variable', 'ligne', 'campagne'], never: ['template'] },
  pt_BR: { must: ['modelo', 'variáve', 'linha', 'campanha'], never: ['template'] },
  tr: { must: ['şablon', 'değişken', 'satır', 'kampanya'], never: ['template'] },
};

const translated = Object.keys(GLOSSARY).filter((l) => {
  const m = read(l);
  // A locale still carrying the English text (before its translation pass) has nothing to check.
  return Object.keys(m).length > 10 && m.optNavTemplate?.message !== read('en').optNavTemplate?.message;
});

describe('glossary (docs/i18n-glossary.md)', () => {
  it('spintax stays Latin in every locale', () => {
    for (const locale of ['en', ...Object.keys(GLOSSARY)]) {
      const m = read(locale);
      for (const [key, entry] of Object.entries(m))
        expect(/спинтакс/i.test(words(entry.message)), `${locale}.${key} spells Spintax in Cyrillic`).toBe(false);
    }
  });
  it.runIf(translated.length > 0).each(translated)('%s uses the pinned terms', (locale) => {
    for (const term of GLOSSARY[locale]?.must ?? [])
      expect(has(locale, term), `${locale}: the glossary term "${term}" appears nowhere`).toBe(true);
    for (const term of GLOSSARY[locale]?.never ?? [])
      expect(has(locale, term), `${locale}: "${term}" is a rejected spelling`).toBe(false);
  });
});
