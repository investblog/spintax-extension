import { describe, expect, it } from 'vitest';
import { type NewsPost, nextSeen, unseenNewestFirst } from './news';

const post = (slug: string): NewsPost => ({
  slug,
  title: slug,
  description: '',
  date: '',
  url: `https://301.sh/${slug}`,
  image: '',
  tags: [],
});

describe('news seen-set window (Codex review #5)', () => {
  it('drops the OLDEST slugs when the feed is longer than the cap', () => {
    const posts = Array.from({ length: 305 }, (_, i) => post(`p${i}`)); // oldest → newest
    const stored = nextSeen(new Set(), posts, 300);
    expect(stored).toHaveLength(300);
    // the five newest must be inside the window, so they are never notified again
    for (const slug of ['p300', 'p301', 'p302', 'p303', 'p304']) expect(stored).toContain(slug);
    expect(stored).not.toContain('p0');
    // a second check over the same feed sees nothing new: the cursor is the newest seen slug, so
    // the five oldest posts that fell out of the window are NOT re-notified
    expect(unseenNewestFirst(posts, new Set(stored))).toEqual([]);
  });
  it('keeps previously seen slugs and appends only the new ones', () => {
    expect(nextSeen(new Set(['a']), [post('a'), post('b')], 10)).toEqual(['a', 'b']);
  });
});
