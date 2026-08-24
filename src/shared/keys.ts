/**
 * Derived keys — ADR 0006 / ADR 0011 p.2 / docs/data-model.md §1.
 * Pure functions: seedKey from target, seed string, variable names from headers.
 */
import type { TargetKind } from './model';

/** Host-specific profile-URL shapes that reduce to a handle (outreach scenario only). */
const PROFILE_PATTERNS: { host: RegExp; path: RegExp }[] = [
  { host: /^(t|telegram)\.me$/, path: /^\/([A-Za-z0-9_]{3,})\/?$/ },
  { host: /^(x|twitter)\.com$/, path: /^\/@?([A-Za-z0-9_]{1,15})\/?$/ },
  { host: /^linkedin\.com$/, path: /^\/in\/([^/]+)\/?$/ },
  { host: /^instagram\.com$/, path: /^\/([A-Za-z0-9_.]+)\/?$/ },
  { host: /^facebook\.com$/, path: /^\/([A-Za-z0-9.]+)\/?$/ },
  { host: /^github\.com$/, path: /^\/([A-Za-z0-9-]+)\/?$/ },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripMailto(v: string): string {
  return v.replace(/^mailto:/i, '').split('?')[0] ?? '';
}

/** Parse a URL-ish string into a URL; bare hosts get https://. Returns null when unparsable. */
export function parseUrl(raw: string): URL | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

/** A plausible public host: IPv4/IPv6, or dotted labels whose TLD is alphabetic (or punycode). */
export function isValidHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (/^\[[0-9a-f:]+\]$/.test(h)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h === 'localhost') return true; // RFC 6761 loopback — dev servers, E2E fixtures
  const labels = h.split('.');
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length === 0 || l.length > 63 || /^-|-$/.test(l) || !/^[a-z0-9-]+$/.test(l))) return false;
  const tld = labels.at(-1) ?? '';
  return /^[a-z]{2,}$/.test(tld) || tld.startsWith('xn--');
}

/** A bare file name ("icon.png") is a cell of a file column, not a site — unless written as a URL. */
const FILE_NAME_RE = /^[^/:@\s]+\.(png|jpe?g|gif|webp|svg|ico|pdf|docx?|xlsx?|pptx?|csv|txt|md|mp4|mov|webm|mp3)$/i;

export function detectTargetKind(raw: string): TargetKind {
  const value = stripMailto(raw.trim());
  if (!value) return 'unknown';
  if (/^@[\w.]+$/.test(value)) return 'handle';
  if (/^(chrome|moz|edge)-extension:\/\//i.test(value)) return 'url'; // the bundled demo pages
  if (EMAIL_RE.test(value)) return 'email';
  if (/\s/.test(value)) return 'unknown';
  if (FILE_NAME_RE.test(value)) return 'unknown';
  // Numbers, decimals, phones and bare IPv4 literals are ids/metrics/phones, never sites — the
  // URL parser would happily read "265712" as 0.4.13.240 and "8.5" as 8.0.0.5.
  if (/^\+?[\d\s().,-]+$/.test(value)) return 'unknown';
  const url = parseUrl(value);
  return url && isValidHost(url.hostname) ? 'url' : 'unknown';
}

/** hostname without `www.`, lower-case, punycode (URL already gives ASCII). Subdomains kept. */
export function hostnameKey(raw: string): string | null {
  const url = parseUrl(stripMailto(raw));
  if (!url || !isValidHost(url.hostname)) return null;
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return host || null;
}

function handleFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const p of PROFILE_PATTERNS) {
    if (!p.host.test(host)) continue;
    const m = url.pathname.match(p.path);
    return m?.[1] ? m[1].toLowerCase() : null;
  }
  return null;
}

/**
 * ADR 0006 table. Outreach: email / handle / profile URL → handle / hostname.
 * Submit (ADR 0010 E1): always hostname, plus `:lang` when the row has a language.
 */
export function deriveSeedKey(
  target: string,
  opts: { scenario?: 'outreach' | 'submit'; lang?: string } = {},
): string | null {
  const kind = detectTargetKind(target);
  if (kind === 'unknown') return null;
  const lang = opts.lang?.trim().toLowerCase();
  if (opts.scenario === 'submit') {
    const host =
      kind === 'url'
        ? hostnameKey(target)
        : kind === 'email'
          ? (stripMailto(target.trim()).toLowerCase().split('@')[1] ?? null)
          : null;
    if (!host) return null;
    return lang ? `${host}:${lang}` : host;
  }
  if (kind === 'email') return stripMailto(target.trim()).toLowerCase();
  if (kind === 'handle') return target.trim().replace(/^@/, '').toLowerCase();
  const url = parseUrl(target);
  if (!url) return null;
  return handleFromUrl(url) ?? hostnameKey(target);
}

/** seed = seedKey:step[:salt]  (salt > 0 only). */
export function buildSeed(seedKey: string, step: number, salt = 0): string {
  return salt > 0 ? `${seedKey}:${step}:${salt}` : `${seedKey}:${step}`;
}

// ── Variable names from headers ────────────────────────────────────────────────

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // uk / be extras
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
  ў: 'u',
  // common Latin diacritics (contract: data-model §1)
  ä: 'a',
  ö: 'o',
  ü: 'u',
  ß: 'ss',
  é: 'e',
  è: 'e',
  ê: 'e',
  á: 'a',
  à: 'a',
  â: 'a',
  ç: 'c',
  ñ: 'n',
  ó: 'o',
  ô: 'o',
  í: 'i',
  ú: 'u',
  ã: 'a',
  õ: 'o',
  ı: 'i',
  ş: 's',
  ğ: 'g',
  ć: 'c',
  ł: 'l',
  ż: 'z',
  ź: 'z',
  ś: 's',
  ń: 'n',
};

/** Engine rule: `[A-Za-z_]\w*`, case-insensitive. docs/data-model.md §1. */
export function variableNameFromHeader(header: string, taken: ReadonlySet<string> = new Set()): string {
  let s = header.trim().toLowerCase();
  s = Array.from(s)
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('');
  s = s
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s) s = 'col';
  if (/^[0-9]/.test(s)) s = `v_${s}`;
  let candidate = s;
  let n = 2;
  while (taken.has(candidate)) candidate = `${s}_${n++}`;
  return candidate;
}

/** Assign unique variable names to a list of headers, in order. */
export function variableNamesFromHeaders(headers: string[]): string[] {
  const taken = new Set<string>();
  return headers.map((header) => {
    const name = variableNameFromHeader(header, taken);
    taken.add(name);
    return name;
  });
}
