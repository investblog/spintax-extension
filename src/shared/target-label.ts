/** Readable target labels and "is the tab on this row's page" — shared by the panel and the list. */
import { t } from './i18n';

/** Short form: host + path for sites (www. stripped, ≤ 44 chars), the address for e-mail/handles. */
export function targetLabel(target: string, url: string | null, ownOrigin?: string): string {
  if (!url) return target;
  // Own origin is compared as a string prefix: non-special schemes (chrome-extension://) report
  // `origin === 'null'` in some engines.
  if (ownOrigin && url.startsWith(`${ownOrigin}/`)) return t('tgtDemoPage', url.replace(/^.*blog-(\d+).*$/, '$1'));
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const label = `${u.hostname.replace(/^www\./, '')}${path}`;
    return label.length > 44 ? `${label.slice(0, 41)}…` : label;
  } catch {
    return target;
  }
}

const norm = (u: URL): string => `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;

/**
 * Same page = same origin and path; the hash is ignored, and the query only has to match when the
 * TARGET carries one — `?lead=alice` and `?lead=bob` are different forms, but a tab that picked up
 * `?utm_source=…` on the way to the target page still counts. A bare host ("a.com") matches any
 * page of that host: the contact page is found later.
 */
export function samePage(tabUrl: string, targetUrl: string): boolean {
  try {
    const a = new URL(tabUrl);
    const b = new URL(targetUrl);
    if (a.origin !== b.origin) return false;
    if (b.search && a.search !== b.search) return false;
    if (b.pathname === '/' || b.pathname === '') return true;
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

/**
 * A path for a fixed-width control. `pathOf` is unbounded — a real contact URL with a query is
 * easily 50 characters, and the panel's primary button is 100% wide and nowrap, so the label spilled
 * out of the button (Codex review #4). The full value stays available for a `title`.
 */
export function shortPath(url: string, max = 22): string {
  const p = pathOf(url);
  if ([...p].length <= max) return p;
  const chars = [...p];
  return `${chars.slice(0, max - 1).join('')}…`;
}
