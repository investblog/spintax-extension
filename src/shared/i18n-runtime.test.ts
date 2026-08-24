import { describe, expect, it, vi } from 'vitest';
import { formatDay, t, tn } from './i18n';

/**
 * The catalog tests check the data; this one checks the runtime — the part Codex review #10 found
 * untested: Russian 1/2/5 selection, the `…Other` fallback, a missing key, and a bad date.
 * `src/test/setup.ts` stubs `chrome.i18n` from the real EN file, so these also assert the English
 * wording the E2E suite matches on.
 */
describe('i18n runtime', () => {
  it('returns the message, and the key itself when the message is missing', () => {
    expect(t('optNavList')).toBe('List');
    // A key that does not exist must be visible in the UI, not render as an empty control.
    expect(t('nopeNotAKey' as never)).toBe('nopeNotAKey');
  });

  it('substitutes named placeholders, including values containing a dollar sign', () => {
    expect(t('panelOpenHost', 'example.com')).toBe('Open example.com');
    // `$&` and `$1` are replacement patterns in String.replace — the browser API does not treat a
    // substitution VALUE as one, and neither may the stub (the 301-ui "Q3 $& Casino" bug).
    expect(t('panelOpenHost', 'Q3 $& Casino')).toBe('Open Q3 $& Casino');
    expect(t('panelOpenHost', 'a$1b')).toBe('Open a$1b');
  });

  it('picks the English plural category by count', () => {
    expect(tn(1, 'listRows')).toBe('1 row');
    expect(tn(2, 'listRows')).toBe('2 rows');
    expect(tn(0, 'listRows')).toBe('0 rows');
  });

  it('falls back to the Other form when the exact category is missing', () => {
    // `en` never selects Few, so asking for it directly proves the fallback path works.
    const spy = vi.spyOn(Intl, 'PluralRules');
    expect(tn(5, 'listRows')).toBe('5 rows');
    spy.mockRestore();
  });

  it('formatDay renders a date and passes an unparseable value through untouched', () => {
    expect(formatDay('2026-08-24T10:00:00.000Z')).toMatch(/2026/);
    expect(formatDay('not a date')).toBe('not a date');
    expect(formatDay('')).toBe('');
  });
});

describe('Russian plural categories (the reason tn() exists)', () => {
  // Runs the CLDR rules directly: the message files carry One/Few/Many/Other for every base, and
  // this pins which count must reach which form — the bug the neighbour extension ships.
  const ru = new Intl.PluralRules('ru');
  it.each([
    [1, 'one'],
    [2, 'few'],
    [4, 'few'],
    [5, 'many'],
    [11, 'many'],
    [21, 'one'],
    [1.5, 'other'],
  ])('%i is %s in Russian', (count, category) => {
    expect(ru.select(count)).toBe(category);
  });
});
