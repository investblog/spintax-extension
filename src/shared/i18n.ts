/**
 * UI strings — `browser.i18n` over `src/public/_locales/<locale>/messages.json` (the house pattern,
 * ADR: i18n интерфейса). Two things are deliberately different from redirect-inspector's helper:
 *
 * 1. **Keys are typed.** WXT regenerates `.wxt/types/i18n.d.ts` from the EN messages file on
 *    `wxt prepare`, so a typo is a compile error instead of a raw key on screen.
 * 2. **Plurals go through `Intl.PluralRules`.** A one/other pair renders "2 переходов" in Russian —
 *    that bug is shipping in the neighbour extension. Keys carry a CLDR category suffix
 *    (`…One/…Few/…Many/…Other`) and the rule picks the right one for the UI language.
 *
 * Substitutions always use NAMED placeholders in messages.json (`$COUNT$` + a `placeholders`
 * block), never a bare `$1` in the text: Turkish and Russian reorder arguments, and a named
 * placeholder lets the translator move it.
 */
import { browser } from 'wxt/browser';

/** Every key of the EN messages file, from the type WXT generates. */
export type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

/** The plural categories Chrome's message files may carry for a key. */
export type PluralCategory = 'One' | 'Two' | 'Few' | 'Many' | 'Other' | 'Zero';

/**
 * A plural BASE: every key that ends in `Other` in the message file, minus the suffix. Typing the
 * base this way means a typo in `tn()` is a compile error too, not a raw key on screen — the last
 * gap in the typed-key guarantee (Codex review #10).
 */
export type PluralBase = MessageKey extends infer K ? (K extends `${infer Base}Other` ? Base : never) : never;

/** A message; a missing key returns the key itself (visible in dev, harmless in production). */
export function t(key: MessageKey, ...substitutions: string[]): string {
  const msg = browser.i18n.getMessage(key, substitutions.length > 0 ? substitutions : undefined);
  return msg || key;
}

let rules: Intl.PluralRules | undefined;
function pluralRules(): Intl.PluralRules {
  if (!rules) {
    // The UI language, not the OS one: the message file that answers is chosen the same way.
    const locale = browser.i18n.getUILanguage?.() || 'en';
    rules = new Intl.PluralRules(locale);
  }
  return rules;
}

/**
 * Plural message: `base` + the CLDR category for `count` in the UI language, with the count as the
 * `$COUNT$` substitution. `tn(2, 'listRows')` asks for `listRowsFew` in Russian, `listRowsOther` in
 * English. Falls back to `…Other` when a locale file lacks the exact category.
 */
export function tn(count: number, base: PluralBase, ...rest: string[]): string {
  const category = pluralRules().select(count);
  const suffix = (category.charAt(0).toUpperCase() + category.slice(1)) as PluralCategory;
  const exact = `${base}${suffix}` as MessageKey;
  const withCount = [String(count), ...rest];
  const msg = browser.i18n.getMessage(exact, withCount);
  if (msg) return msg;
  return t(`${base}Other` as MessageKey, ...withCount);
}

/**
 * Tell the document which language it is in. Without this a Russian page is announced as English to
 * a screen reader and hyphenated by English rules (Codex #7). Called by every entrypoint.
 */
export function applyDocumentLanguage(): void {
  document.documentElement.lang = (browser.i18n.getUILanguage?.() || 'en').replace('_', '-');
}

/** The UI language as a bare language tag ('ru', 'pt_BR' → 'pt'), for site links and Intl. */
export function uiLanguage(): string {
  const raw = browser.i18n.getUILanguage?.() || 'en';
  return raw.toLowerCase().split(/[-_]/)[0] ?? 'en';
}

/** Dates and numbers follow the UI language, not the OS (301-ui's lesson: mixed-locale screens). */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(browser.i18n.getUILanguage?.() || 'en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
