/**
 * Links to the authoring tools (ADR 0002: authoring lives in Studio / the playground; the
 * extension imports and validates). The playground share link carries the template and a
 * `#set %var% = value` vocabulary so it opens already rendering with this campaign's variables.
 */

export const PLAYGROUND_URL = 'https://spintax.net/play/';

/**
 * spintax.net locale routing: EN at the apex root, RU on its own subdomain (Cloudflare is
 * unreachable from Russia, so `spintax.net/ru/*` 301s to `ru.spintax.net/*`), every other language
 * under `/{lang}/`. The editors page carries the Studio section at `#studio`.
 */
export const SITE_LOCALES = [
  'en',
  'ru',
  'de',
  'es',
  'fr',
  'pt',
  'tr',
  'it',
  'nl',
  'uk',
  'ja',
  'ko',
  'zh',
  'ar',
  'be',
  'sr',
] as const;

export function siteUrl(path: string, locale = uiLocale()): string {
  const clean = path.replace(/^\/+/, '');
  if (locale === 'ru') return `https://ru.spintax.net/${clean}`;
  return locale === 'en' ? `https://spintax.net/${clean}` : `https://spintax.net/${locale}/${clean}`;
}

/** The browser's UI language, narrowed to a language the site actually publishes. */
export function uiLocale(): string {
  const raw = (globalThis.navigator?.language ?? 'en').toLowerCase();
  const lang = raw.split('-')[0] ?? 'en';
  return (SITE_LOCALES as readonly string[]).includes(lang) ? lang : 'en';
}

/** Spintax Studio (Windows, offline) — the editors page, Studio section. */
export const studioUrl = (locale?: string): string => `${siteUrl('spintax-editor/', locale)}#studio`;
/** The playground exists only in EN and RU; other locales get the EN one. */
export const playgroundHome = (locale = uiLocale()): string => siteUrl('play/', locale === 'ru' ? 'ru' : 'en');
/**
 * One privacy page for the whole Spintax line, with a per-product anchor (decision of 2026-08-24,
 * spintax.net). Published in EN and RU only — a `/de/privacy/` would 404, so every other UI
 * language gets the EN page rather than a dead link in a store listing.
 */
export const privacyUrl = (locale = uiLocale()): string =>
  `${siteUrl('privacy/', locale === 'ru' ? 'ru' : 'en')}#extension`;
/** Browsers cap the address line around 8 KB before things get flaky; measured, not guessed. */
export const PLAYGROUND_URL_LIMIT = 8000;

function b64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** `#set %name% = value` lines — the playground's Variables panel format. */
export function varsPreset(context: Record<string, string>): string {
  return Object.entries(context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `#set %${k}% = ${String(v).replace(/\r?\n/g, ' ')}`)
    .join('\n');
}

/** Share link for the playground; null when the template is too long for a URL. */
export function playgroundUrl(
  template: string,
  context: Record<string, string> = {},
  seed?: string,
  locale?: string,
): string | null {
  const url = new URL(playgroundHome(locale ?? uiLocale()));
  url.searchParams.set('t', b64EncodeUtf8(template));
  const vars = varsPreset(context);
  if (vars) url.searchParams.set('v', b64EncodeUtf8(vars));
  if (seed) url.searchParams.set('s', seed);
  const out = url.toString();
  return out.length <= PLAYGROUND_URL_LIMIT ? out : null;
}

/** File name for a `.spintax` export: `<campaign>-<channel>-step<N>-<locale>.spintax`. */
export function spintaxFileName(campaignName: string, channel: string, step: number, locale: string): string {
  const slug =
    campaignName
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'campaign';
  return `${slug}-${channel}-step${step}-${locale}.spintax`;
}
