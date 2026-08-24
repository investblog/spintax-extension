import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The locale files are data, so they get a data test: the same guarantees the static guard makes in
 * CI (`scripts/i18n-check.mjs`), asserted here too so a broken locale fails `vitest` as well.
 */
const localesDir = path.resolve(__dirname, '../public/_locales');
const locales = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
const read = (l: string): Record<string, { message: string; placeholders?: Record<string, unknown> }> =>
  JSON.parse(fs.readFileSync(path.join(localesDir, l, 'messages.json'), 'utf8'));
const placeholders = (msg: string): string[] =>
  [...new Set([...msg.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => (m[1] as string).toLowerCase()))].sort();

describe('locale files', () => {
  const en = read('en');
  it('ships the manifest locales the store listing promises', () => {
    expect(locales).toEqual(['de', 'en', 'es', 'fr', 'pt_BR', 'ru', 'tr']);
  });
  it.each(locales.filter((l) => l !== 'en'))('%s has exactly the keys of en', (locale) => {
    expect(Object.keys(read(locale)).sort()).toEqual(Object.keys(en).sort());
  });
  it.each(locales)('%s has no empty message and no undeclared placeholder', (locale) => {
    for (const [key, entry] of Object.entries(read(locale))) {
      expect(entry.message.trim(), `${locale}.${key} is empty`).not.toBe('');
      for (const name of placeholders(entry.message))
        expect(
          Object.keys(entry.placeholders ?? {}).map((p) => p.toLowerCase()),
          `${locale}.${key}: $${name.toUpperCase()}$ is not declared`,
        ).toContain(name);
    }
  });
  it.each(locales.filter((l) => l !== 'en'))('%s keeps the placeholder set of en', (locale) => {
    for (const [key, entry] of Object.entries(read(locale)))
      expect(placeholders(entry.message), `${locale}.${key}`).toEqual(placeholders(en[key]?.message ?? ''));
  });
  it('respects the store limits for the listing keys', () => {
    for (const locale of locales) {
      const m = read(locale);
      expect([...(m.extName?.message ?? '')].length, `${locale}.extName`).toBeLessThanOrEqual(45);
      expect([...(m.extDescription?.message ?? '')].length, `${locale}.extDescription`).toBeLessThanOrEqual(132);
    }
  });
});
