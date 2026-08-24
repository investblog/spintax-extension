import { describe, expect, it } from 'vitest';
import { pathOf, samePage, targetLabel } from './target-label';

describe('target labels and page matching', () => {
  it('labels sites by host + path, demo pages by number, e-mail as is', () => {
    expect(targetLabel('https://www.site.com/contact/', 'https://www.site.com/contact/')).toBe('site.com/contact/');
    expect(targetLabel('a@b.c', null)).toBe('a@b.c');
    expect(
      targetLabel(
        'chrome-extension://id/demo/blog-3.html',
        'chrome-extension://id/demo/blog-3.html',
        'chrome-extension://id',
      ),
    ).toBe('demo page 3');
  });
  it('samePage: path matters when the target has one; a bare host matches any page of that host', () => {
    expect(samePage('https://site.com/blog-1?x=1#top', 'https://site.com/blog-1/')).toBe(true);
    expect(samePage('https://site.com/blog-1', 'https://site.com/blog-2')).toBe(false);
    expect(samePage('https://site.com/anything', 'https://site.com')).toBe(true);
    expect(samePage('https://other.com/', 'https://site.com')).toBe(false);
    expect(pathOf('https://site.com/blog-2?y=1')).toBe('/blog-2?y=1');
  });
});
