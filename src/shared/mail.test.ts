import { describe, expect, it } from 'vitest';
import { bodyBudget, composeLink, MAIL_DEFAULTS } from './mail';

const msg = { to: 'anna@site.com', subject: 'Hello about crypto', body: 'Hi Anna, a short question.' };

describe('composeLink (spec §8: body travels in the link only when it fits)', () => {
  it('mailto carries subject and body, and bcc when set', () => {
    const l = composeLink({ ...MAIL_DEFAULTS, bcc: 'me@301.st' }, msg);
    expect(l.bodyIncluded).toBe(true);
    expect(l.url).toBe(
      'mailto:anna@site.com?subject=Hello%20about%20crypto&bcc=me%40301.st&body=Hi%20Anna%2C%20a%20short%20question.',
    );
    expect(l.origin).toBeUndefined();
  });
  it('gmail compose with the account index and origin', () => {
    const l = composeLink({ ...MAIL_DEFAULTS, provider: 'gmail', gmailAccount: 2 }, msg);
    expect(
      l.url.startsWith('https://mail.google.com/mail/u/2/?view=cm&fs=1&to=anna%40site.com&su=Hello+about+crypto'),
    ).toBe(true);
    expect(l.url).toContain('body=Hi+Anna');
    expect(l.origin).toBe('https://mail.google.com');
  });
  it('drops the body (not the link) when the message exceeds the provider limit', () => {
    const long = { ...msg, body: 'x'.repeat(2500) };
    const l = composeLink(MAIL_DEFAULTS, long);
    expect(l.bodyIncluded).toBe(false);
    expect(l.url).toBe('mailto:anna@site.com?subject=Hello%20about%20crypto');
    const g = composeLink({ ...MAIL_DEFAULTS, provider: 'gmail' }, long);
    expect(g.bodyIncluded).toBe(true); // 8 000 budget
  });
  it('custom template substitutes placeholders and yields its origin', () => {
    const l = composeLink(
      {
        ...MAIL_DEFAULTS,
        provider: 'custom',
        customTemplate: 'https://mail.example.com/compose?to=%to%&s=%subject%&b=%body%',
      },
      msg,
    );
    expect(l.url).toBe(
      'https://mail.example.com/compose?to=anna%40site.com&s=Hello%20about%20crypto&b=Hi%20Anna%2C%20a%20short%20question.',
    );
    expect(l.origin).toBe('https://mail.example.com');
  });
  it('bodyBudget is the plain-text length that still fits', () => {
    const budget = bodyBudget(MAIL_DEFAULTS, msg);
    expect(budget).toBeGreaterThan(500);
    expect(budget).toBeLessThan(2000);
    expect(bodyBudget({ ...MAIL_DEFAULTS, provider: 'gmail' }, msg)).toBeGreaterThan(budget);
  });
});
