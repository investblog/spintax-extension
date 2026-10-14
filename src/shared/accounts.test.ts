import { describe, expect, it } from 'vitest';
import { accountDomain, canonicalAccount, getAccount, saveAccount } from './accounts';

describe('site accounts (ADR 0014)', () => {
  it('the site comes from the target, not from a row key that may be overridden', () => {
    expect(accountDomain({ target: 'https://www.Ko-fi.com/account/register', targetKind: 'url' })).toBe('ko-fi.com');
    // two rows with the same custom key on different sites are different accounts
    const a = { seedKey: 'promo', target: 'https://a.test/', targetKind: 'url' as const };
    const b = { seedKey: 'promo', target: 'https://b.test/', targetKind: 'url' as const };
    expect(accountDomain(a)).not.toBe(accountDomain(b));
    expect(accountDomain({ target: 'mailto:Hi@Mail.Test', targetKind: 'email' })).toBe('mail.test');
    expect(accountDomain({ target: '@handle', targetKind: 'handle' })).toBeNull();
  });

  it('keeps a sign-up URL only when it is plain http(s) without credentials', async () => {
    await saveAccount('s.test', 'p', { signupUrl: 'https://user:secret@s.test/join' });
    expect((await getAccount('s.test', 'p'))?.signupUrl).toBeUndefined();
    await saveAccount('s.test', 'p', { signupUrl: 'https://s.test/join?ref=1' });
    expect((await getAccount('s.test', 'p'))?.signupUrl).toBe('https://s.test/join?ref=1');
    const now = new Date().toISOString();
    for (const bad of ['http://%', 'javascript:alert(1)', 'ftp://s.test/'])
      expect(
        canonicalAccount({ domain: 's', profileId: 'p', state: 'none', updatedAt: now, signupUrl: bad })?.signupUrl,
      ).toBeUndefined();
  });

  it('one transaction per change: a state and a sign-up page saved together both land', async () => {
    await Promise.all([
      saveAccount('t.test', 'p', { state: 'awaiting_email' }),
      saveAccount('t.test', 'p', { signupUrl: 'https://t.test/signup' }),
    ]);
    expect(await getAccount('t.test', 'p')).toMatchObject({
      state: 'awaiting_email',
      signupUrl: 'https://t.test/signup',
    });
  });
});
