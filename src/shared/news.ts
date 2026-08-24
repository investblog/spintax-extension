/**
 * 301.sh publisher news — shared constants, settings and the pure feed logic (spec §15.6, ADR 0008).
 *
 * Strictly opt-in: no request leaves the browser until the user turns it on (bell in the header or
 * the welcome page). Turning it on asks for the optional `notifications` permission and the
 * `https://301.sh/*` host in one gesture; everything is stored in `storage.local` (ADR 0011 p.9 —
 * nothing roams). Ported from redirect-inspector/src/shared/news.ts.
 */
import { browser } from 'wxt/browser';

export const NEWS_FEED_URL = 'https://301.sh/posts.json';
export const NEWS_ORIGIN = 'https://301.sh/*';
export const NEWS_ALARM_NAME = 'news-check';
export const NEWS_ALARM_PERIOD_MINUTES = 6 * 60;

export const NEWS_ENABLED_KEY = 'spintaxOutreach:newsEnabled';
/** Slugs already seen — never notified again. */
export const NEWS_SEEN_KEY = 'spintaxOutreach:newsSeenSlugs';
/** Whether the seen-set was seeded at enable time (a failed seed must not push the whole backlog). */
export const NEWS_SEEDED_KEY = 'spintaxOutreach:newsSeeded';
/** notification id → article URL for click handling. */
export const NEWS_NOTIF_URLS_KEY = 'spintaxOutreach:newsNotifUrls';

/** Max toasts per check; caps for stored state so it cannot grow over years of feed history. */
export const MAX_NOTIFICATIONS_PER_CHECK = 3;
export const MAX_SEEN_SLUGS = 300;
export const MAX_NOTIF_URL_ENTRIES = 20;

/**
 * One entry of https://301.sh/posts.json (`posts`, oldest first). The schema and the order are a
 * documented contract of the 301.sh repo (`docs/distribution.md`, "Фид /posts.json — контракт").
 */
export interface NewsPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  url: string;
  image: string;
  tags: string[];
}

/** Valid posts of a feed payload (anything without slug/url is dropped). */
export function parseFeed(data: unknown): NewsPost[] {
  const posts = (data as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) return [];
  return posts.filter(
    (p): p is NewsPost => !!p && typeof p === 'object' && !!(p as NewsPost).slug && !!(p as NewsPost).url,
  );
}

/**
 * Posts to notify about, newest first. The feed is oldest → newest, so everything after the newest
 * slug we have already seen is new; a plain "not in the set" filter would re-notify the tail once
 * the stored window (MAX_SEEN_SLUGS) no longer reaches the start of the feed (Codex review #5).
 * With nothing seen yet the whole feed counts — that call only happens while seeding.
 */
export function unseenNewestFirst(posts: NewsPost[], seen: ReadonlySet<string>): NewsPost[] {
  let cursor = -1;
  for (let i = 0; i < posts.length; i++) if (seen.has((posts[i] as NewsPost).slug)) cursor = i;
  return posts
    .slice(cursor + 1)
    .filter((p) => !seen.has(p.slug))
    .reverse();
}

/**
 * The seen-set to store: feed order (oldest → newest) with the previously seen slugs first, capped
 * from the END so the cap drops the OLDEST. Storing insertion order of a newest-first loop would
 * push the newest slugs out of the window and re-notify them on the next check (Codex review #5).
 */
export function nextSeen(previous: ReadonlySet<string>, posts: NewsPost[], max: number): string[] {
  const out = [...previous];
  for (const p of posts) if (!previous.has(p.slug)) out.push(p.slug);
  return out.slice(-max);
}

/** Keep at most `max` entries of a notification-id → url map (oldest insertion dropped first). */
export function capMap(map: Record<string, string>, max: number): Record<string, string> {
  const keys = Object.keys(map);
  const out = { ...map };
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete out[k];
  return out;
}

export async function getNewsEnabled(): Promise<boolean> {
  try {
    const r = await browser.storage.local.get({ [NEWS_ENABLED_KEY]: false });
    return Boolean(r[NEWS_ENABLED_KEY]);
  } catch {
    return false;
  }
}

export async function setNewsEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [NEWS_ENABLED_KEY]: enabled });
}

const NEWS_PERMISSIONS = { permissions: ['notifications' as const], origins: [NEWS_ORIGIN] };

/** Both grants in one prompt; must run from a user gesture in an extension page. */
export async function requestNewsPermissions(): Promise<boolean> {
  try {
    return await browser.permissions.request(NEWS_PERMISSIONS);
  } catch (e) {
    console.warn('news permission request failed', e);
    return false;
  }
}

export async function hasNewsPermissions(): Promise<boolean> {
  try {
    return await browser.permissions.contains(NEWS_PERMISSIONS);
  } catch {
    return false;
  }
}

/** Off means off: the host grant goes away with the feature (spec §9 — zero network by default). */
export async function dropNewsPermissions(): Promise<void> {
  try {
    await browser.permissions.remove(NEWS_PERMISSIONS);
  } catch {
    /* Firefox may refuse to remove a permission that was never granted */
  }
}

/**
 * Turn the feature on or off from a page (header bell, welcome). Returns the resulting state:
 * enabling without the grants stays off. The background owns the alarm; it is told by message.
 *
 * Call it synchronously from the click handler with the state the control already shows: Firefox
 * accepts `permissions.request` only while the user-input handler is still running — any `await`
 * before it (e.g. reading the flag from storage) makes the prompt silently fail.
 */
export async function toggleNews(currentlyEnabled: boolean): Promise<boolean> {
  if (currentlyEnabled) {
    await setNewsEnabled(false);
    await dropNewsPermissions();
    await browser.runtime.sendMessage({ type: 'news', enabled: false }).catch(() => {});
    return false;
  }
  if (!(await requestNewsPermissions())) return false;
  await setNewsEnabled(true);
  await browser.runtime.sendMessage({ type: 'news', enabled: true }).catch(() => {});
  return true;
}
