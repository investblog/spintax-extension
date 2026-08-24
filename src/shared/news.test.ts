import { describe, expect, it } from 'vitest';
import { capMap, parseFeed, unseenNewestFirst } from './news';

const post = (slug: string) => ({
  slug,
  title: slug,
  description: '',
  date: '',
  url: `https://301.sh/${slug}`,
  image: '',
  tags: [],
});

describe('301.sh news feed logic', () => {
  it('parseFeed keeps only posts with slug and url; tolerates a bad payload', () => {
    expect(parseFeed({ posts: [post('a'), { slug: 'no-url' }, null, post('b')] }).map((p) => p.slug)).toEqual([
      'a',
      'b',
    ]);
    expect(parseFeed(null)).toEqual([]);
    expect(parseFeed({ posts: 'x' })).toEqual([]);
  });
  it('unseenNewestFirst returns what came after the newest seen post, newest first', () => {
    const posts = [post('old'), post('mid'), post('new')];
    // "mid" is the cursor: "new" is newer, "old" is behind it and was already dealt with
    expect(unseenNewestFirst(posts, new Set(['mid'])).map((p) => p.slug)).toEqual(['new']);
    expect(unseenNewestFirst(posts, new Set(['old', 'mid', 'new']))).toEqual([]);
    // nothing seen yet (seeding): the whole feed, newest first
    expect(unseenNewestFirst(posts, new Set()).map((p) => p.slug)).toEqual(['new', 'mid', 'old']);
  });
  it('capMap drops the oldest entries beyond the cap', () => {
    expect(capMap({ a: '1', b: '2', c: '3' }, 2)).toEqual({ b: '2', c: '3' });
    expect(capMap({ a: '1' }, 5)).toEqual({ a: '1' });
  });
});
