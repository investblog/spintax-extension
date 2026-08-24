import { describe, expect, it } from 'vitest';
import { playgroundHome, playgroundUrl, privacyUrl, siteUrl, spintaxFileName, studioUrl, varsPreset } from './studio';

describe('playground share link (ADR 0002)', () => {
  it('carries the template and a #set vocabulary, UTF-8 safe', () => {
    const url = playgroundUrl('{Привет|Hi} %name%', { name: 'Анна', topic: 'crypto' }, 'a.com:1', 'en');
    expect(url).not.toBeNull();
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe('https://spintax.net/play/');
    const dec = (s: string): string => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
    expect(dec(u.searchParams.get('t') as string)).toBe('{Привет|Hi} %name%');
    expect(dec(u.searchParams.get('v') as string)).toBe('#set %name% = Анна\n#set %topic% = crypto');
    expect(u.searchParams.get('s')).toBe('a.com:1');
  });
  it('refuses a link the address bar cannot carry', () => {
    expect(playgroundUrl('x'.repeat(9000))).toBeNull();
  });
  it('site links follow the locale routing of spintax.net', () => {
    // EN at the apex root, RU on its own subdomain (apex /ru/* 301s there), the rest under /{lang}/
    expect(studioUrl('en')).toBe('https://spintax.net/spintax-editor/#studio');
    expect(studioUrl('ru')).toBe('https://ru.spintax.net/spintax-editor/#studio');
    expect(studioUrl('pt')).toBe('https://spintax.net/pt/spintax-editor/#studio');
    expect(siteUrl('spintax-editor/', 'de')).toBe('https://spintax.net/de/spintax-editor/');
    // the privacy hub is EN + RU only — a /de/privacy/ would 404 in a store listing
    expect(privacyUrl('en')).toBe('https://spintax.net/privacy/#extension');
    expect(privacyUrl('ru')).toBe('https://ru.spintax.net/privacy/#extension');
    expect(privacyUrl('de')).toBe('https://spintax.net/privacy/#extension');
    // the playground is published in EN and RU only — other locales get the EN one
    expect(playgroundHome('ru')).toBe('https://ru.spintax.net/play/');
    expect(playgroundHome('tr')).toBe('https://spintax.net/play/');
  });

  it('varsPreset flattens newlines; file name is a slug', () => {
    expect(varsPreset({ intro: 'two\nlines' })).toBe('#set %intro% = two lines');
    expect(spintaxFileName('My campaign', 'body', 1, 'en')).toBe('my-campaign-body-step1-en.spintax');
  });
});
