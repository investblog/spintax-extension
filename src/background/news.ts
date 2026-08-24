/**
 * 301.sh news — background side: alarm-driven feed polling and notifications (spec §15.6).
 *
 * Enable flow (message from a page after the user granted the optional permissions): seed the
 * seen-set with every current slug so the backlog is never pushed, then start a 6-hour alarm. Each
 * tick fetches the feed and notifies about unseen posts (newest first, capped at 3). Ported from
 * redirect-inspector/src/background/news.ts; storage is local-only (ADR 0011 p.9).
 */
import { browser } from 'wxt/browser';
import { extUrl } from '@/shared/ext-url';
import {
  capMap,
  getNewsEnabled,
  hasNewsPermissions,
  MAX_NOTIF_URL_ENTRIES,
  MAX_NOTIFICATIONS_PER_CHECK,
  MAX_SEEN_SLUGS,
  NEWS_ALARM_NAME,
  NEWS_ALARM_PERIOD_MINUTES,
  NEWS_FEED_URL,
  NEWS_NOTIF_URLS_KEY,
  NEWS_SEEDED_KEY,
  NEWS_SEEN_KEY,
  type NewsPost,
  nextSeen,
  parseFeed,
  unseenNewestFirst,
} from '@/shared/news';

/**
 * Every storage read-modify-write of the news state runs through this chain: the click map is a
 * whole-object write, and enable/disable can interleave with a slow first fetch (Codex #6 / #7).
 */
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

interface Notifications {
  create: (id: string, o: object) => Promise<string>;
  clear?: (id: string) => Promise<boolean>;
  onClicked?: { addListener: (fn: (id: string) => void) => void };
  onClosed?: { addListener: (fn: (id: string) => void) => void };
}
/** The namespace is absent until the optional permission is granted (Firefox: until restart). */
const notifications = (): Notifications | undefined =>
  (browser as unknown as { notifications?: Notifications }).notifications;

async function fetchPosts(): Promise<NewsPost[]> {
  const res = await fetch(NEWS_FEED_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`news feed: HTTP ${res.status}`);
  return parseFeed(await res.json());
}

async function getSeenSlugs(): Promise<Set<string>> {
  const r = await browser.storage.local.get({ [NEWS_SEEN_KEY]: [] });
  const stored = r[NEWS_SEEN_KEY];
  return new Set(Array.isArray(stored) ? (stored as string[]) : []);
}

async function notifyPost(post: NewsPost): Promise<void> {
  const api = notifications();
  if (!api?.create) return;
  const id = `news-${post.slug}`;
  try {
    // Persist the click target BEFORE the toast exists — a fast click must not race an unwritten map.
    await serialized(async () => {
      const stored = await browser.storage.local.get({ [NEWS_NOTIF_URLS_KEY]: {} });
      const urls = capMap(
        { ...(stored[NEWS_NOTIF_URLS_KEY] as Record<string, string>), [id]: post.url },
        MAX_NOTIF_URL_ENTRIES,
      );
      await browser.storage.local.set({ [NEWS_NOTIF_URLS_KEY]: urls });
    });
    await api.create(id, {
      type: 'basic',
      iconUrl: extUrl('/icons/128.png'),
      title: post.title,
      message: (post.description || '').slice(0, 200),
    });
  } catch (e) {
    console.warn('news notification failed', e);
  }
}

function takeNotifUrl(id: string): Promise<string | undefined> {
  return serialized(async () => {
    const stored = await browser.storage.local.get({ [NEWS_NOTIF_URLS_KEY]: {} });
    const urls = stored[NEWS_NOTIF_URLS_KEY] as Record<string, string>;
    const url = urls[id];
    if (url !== undefined) {
      delete urls[id];
      await browser.storage.local.set({ [NEWS_NOTIF_URLS_KEY]: urls });
    }
    return url;
  });
}

/** One feed check; `seedOnly` marks every current slug seen without notifying (enable time). */
export async function checkNews(options: { seedOnly?: boolean } = {}): Promise<boolean> {
  try {
    // Without the grants nothing can be fetched or shown — skip entirely.
    if (!(await hasNewsPermissions())) return false;
    const posts = await fetchPosts();
    const seen = await getSeenSlugs();
    const unseen = unseenNewestFirst(posts, seen);
    const seededResult = await browser.storage.local.get({ [NEWS_SEEDED_KEY]: false });
    const seeding = options.seedOnly || !seededResult[NEWS_SEEDED_KEY];
    if (!seeding) for (const post of unseen.slice(0, MAX_NOTIFICATIONS_PER_CHECK)) await notifyPost(post);
    if (unseen.length > 0) await browser.storage.local.set({ [NEWS_SEEN_KEY]: nextSeen(seen, posts, MAX_SEEN_SLUGS) });
    await browser.storage.local.set({ [NEWS_SEEDED_KEY]: true });
    return true;
  } catch (e) {
    console.warn('news check failed', e);
    return false;
  }
}

/** alarms.create with an existing name restarts the countdown — create only when absent. */
async function ensureNewsAlarm(): Promise<void> {
  const existing = await browser.alarms.get(NEWS_ALARM_NAME);
  if (!existing) await browser.alarms.create(NEWS_ALARM_NAME, { periodInMinutes: NEWS_ALARM_PERIOD_MINUTES });
}

export function enableNews(): Promise<void> {
  return serialized(async () => {
    registerNotificationListeners();
    await browser.storage.local.set({ [NEWS_SEEDED_KEY]: false });
    await checkNews({ seedOnly: true });
    // The user may have switched it back off while the first fetch was in flight.
    if (await getNewsEnabled()) await ensureNewsAlarm();
  });
}

export function disableNews(): Promise<void> {
  return serialized(async () => {
    await browser.alarms.clear(NEWS_ALARM_NAME);
  });
}

let listenersRegistered = false;

/** Idempotent; called again once the optional permission appears (Firefox persistent page). */
function registerNotificationListeners(): void {
  if (listenersRegistered) return;
  const api = notifications();
  if (!api?.onClicked) return;
  listenersRegistered = true;
  api.onClicked.addListener((id) => {
    void (async () => {
      const url = await takeNotifUrl(id);
      if (url) await browser.tabs.create({ url });
      void api.clear?.(id);
    })();
  });
  api.onClosed?.addListener((id) => void takeNotifUrl(id));
}

/** Register listeners and restore the alarm after browser / service-worker restarts. */
export function setupNews(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === NEWS_ALARM_NAME) void checkNews();
  });
  registerNotificationListeners();
  browser.permissions.onAdded?.addListener((added) => {
    if (added.permissions?.includes('notifications')) registerNotificationListeners();
  });
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const msg = raw as { type?: string; enabled?: boolean };
    if (msg?.type !== 'news') return;
    void (msg.enabled ? enableNews() : disableNews());
  });
  void getNewsEnabled().then((enabled) => {
    if (enabled) void ensureNewsAlarm();
  });
}
