import { describe, expect, it } from 'vitest';
import {
  buildSeed,
  deriveSeedKey,
  detectTargetKind,
  hostnameKey,
  variableNameFromHeader,
  variableNamesFromHeaders,
} from './keys';

describe('detectTargetKind', () => {
  it('classifies urls, emails, handles', () => {
    expect(detectTargetKind('https://Site.com/contact')).toBe('url');
    expect(detectTargetKind('site.com')).toBe('url');
    expect(detectTargetKind('www.site.com/x')).toBe('url');
    expect(detectTargetKind('Anna@Site.com')).toBe('email');
    expect(detectTargetKind('@SomeOne')).toBe('handle');
    expect(detectTargetKind('just text')).toBe('unknown');
    expect(detectTargetKind('')).toBe('unknown');
  });
});

describe('deriveSeedKey (ADR 0006)', () => {
  it('url → hostname without www, lower-case, punycode, subdomains kept', () => {
    expect(deriveSeedKey('https://www.Site.com/contact?x=1')).toBe('site.com');
    expect(deriveSeedKey('blog.site.com')).toBe('blog.site.com');
    expect(deriveSeedKey('https://www.Пример.рф/contact')).toBe('xn--e1afmkfd.xn--p1ai');
    expect(deriveSeedKey('http://SITE.COM:8080/')).toBe('site.com');
  });
  it('email → whole address lower-case', () => {
    expect(deriveSeedKey('Anna@Site.com')).toBe('anna@site.com');
  });
  it('handle → without @, lower-case; profile urls → last segment', () => {
    expect(deriveSeedKey('@SomeOne')).toBe('someone');
    expect(deriveSeedKey('https://t.me/SomeOne')).toBe('someone');
    expect(deriveSeedKey('https://www.linkedin.com/in/Jane-Doe/')).toBe('jane-doe');
    expect(deriveSeedKey('https://x.com/@handle')).toBe('handle');
  });
  it('submit scenario appends lang', () => {
    expect(deriveSeedKey('https://chrome.google.com/webstore', { scenario: 'submit', lang: 'DE' })).toBe(
      'chrome.google.com:de',
    );
    expect(deriveSeedKey('https://chrome.google.com/webstore', { scenario: 'outreach', lang: 'de' })).toBe(
      'chrome.google.com',
    );
  });
  it('handles mailto, ports, unicode hosts, IPs and rejects numeric TLDs', () => {
    expect(detectTargetKind('mailto:Anna@Site.com')).toBe('email');
    expect(deriveSeedKey('mailto:Anna@Site.com?subject=x')).toBe('anna@site.com');
    expect(deriveSeedKey('site.com:8080/x')).toBe('site.com');
    expect(deriveSeedKey('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
    expect(deriveSeedKey('http://192.168.1.10/contact')).toBe('192.168.1.10');
    expect(detectTargetKind('release.2026')).toBe('unknown');
    expect(detectTargetKind('icon.png')).toBe('unknown'); // a file-column cell, not a site
    expect(detectTargetKind('265712')).toBe('unknown'); // an id, not the IPv4 0.4.13.240
    expect(detectTargetKind('+380 (99) 562-26-97')).toBe('unknown');
    expect(detectTargetKind('192.168.0.1')).toBe('unknown'); // an IP column, not a site
    expect(detectTargetKind('8.5')).toBe('unknown'); // a metric, not 8.0.0.5
    expect(detectTargetKind('http://192.168.0.1/contact')).toBe('url'); // written as a URL it counts
    expect(detectTargetKind('https://cdn.site.com/icon.png')).toBe('url');
    expect(detectTargetKind('http://localhost:8766/submit')).toBe('url');
    expect(detectTargetKind('store.localhost')).toBe('url');
    expect(detectTargetKind('chrome-extension://abcdefghijklmnop/demo/blog-1.html')).toBe('url');
  });
  it('deep social paths are plain URLs, not handles', () => {
    expect(deriveSeedKey('https://x.com/u/status/123')).toBe('x.com');
    expect(deriveSeedKey('https://www.linkedin.com/company/acme/')).toBe('linkedin.com');
    expect(deriveSeedKey('https://github.com/org/repo')).toBe('github.com');
    expect(deriveSeedKey('https://github.com/org')).toBe('org');
  });
  it('submit scenario always uses the hostname (+lang)', () => {
    expect(deriveSeedKey('https://x.com/user', { scenario: 'submit', lang: 'de' })).toBe('x.com:de');
    expect(deriveSeedKey('https://x.com/user', { scenario: 'submit' })).toBe('x.com');
    expect(deriveSeedKey('ops@store.example', { scenario: 'submit', lang: 'en' })).toBe('store.example:en');
  });
  it('returns null for unknown targets', () => {
    expect(deriveSeedKey('')).toBeNull();
    expect(deriveSeedKey('no target here')).toBeNull();
  });
  it('hostnameKey handles bare hosts', () => {
    expect(hostnameKey('Example.ORG')).toBe('example.org');
    expect(hostnameKey('::not a url::')).toBeNull();
  });
});

describe('buildSeed', () => {
  it('formats seedKey:step[:salt]', () => {
    expect(buildSeed('site.com', 1)).toBe('site.com:1');
    expect(buildSeed('site.com', 2, 0)).toBe('site.com:2');
    expect(buildSeed('site.com', 1, 3)).toBe('site.com:1:3');
  });
});

describe('variableNameFromHeader', () => {
  it('normalizes per data-model §1', () => {
    expect(variableNameFromHeader('First Name')).toBe('first_name');
    expect(variableNameFromHeader('  E-mail  ')).toBe('e_mail');
    expect(variableNameFromHeader('Имя редактора')).toBe('imya_redaktora');
    expect(variableNameFromHeader('2024 budget')).toBe('v_2024_budget');
    expect(variableNameFromHeader('Ціна (грн)')).toBe('tsina_grn');
    expect(variableNameFromHeader('Größe')).toBe('grosse');
    expect(variableNameFromHeader('___')).toBe('col');
  });
  it('dedupes within a campaign', () => {
    expect(variableNamesFromHeaders(['Name', 'name', 'NAME', 'Имя'])).toEqual(['name', 'name_2', 'name_3', 'imya']);
  });
});
