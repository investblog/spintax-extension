import fs from 'node:fs';
import path from 'node:path';
import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { deleteDb } from '@/shared/db';

/**
 * `browser.i18n` does not exist in node, and half the pure modules now render their text through
 * `t()`. The stub answers from the real EN messages file, so a unit test that asserts a sentence is
 * also asserting that the key exists and still carries the English wording — the byte-identity rule
 * of docs/i18n-conventions.md, guarded by the suite instead of by discipline.
 */
const messages: Record<string, { message: string; placeholders?: Record<string, { content: string }> }> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../public/_locales/en/messages.json'), 'utf8'),
);

const getMessage = (key: string, substitutions?: string | string[]): string => {
  const entry = messages[key];
  if (!entry) return ''; // Chrome returns '' for a missing key; t() then falls back to the key
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name: string) => {
    const declared = Object.entries(entry.placeholders ?? {}).find(([p]) => p.toLowerCase() === name.toLowerCase());
    const index = declared ? Number(declared[1].content.replace('$', '')) - 1 : Number.NaN;
    return Number.isNaN(index) ? whole : (subs[index] ?? '');
  });
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  i18n: { getMessage, getUILanguage: () => 'en-US' },
};

beforeEach(async () => {
  await deleteDb();
});
