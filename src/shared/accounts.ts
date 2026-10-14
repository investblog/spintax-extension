/**
 * Site accounts (ADR 0014, #6): on submission sites the human registers first, then submits. The
 * extension keeps a local note of where that stands — per site and sender profile, shared by every
 * campaign and language row of the site. Never a password: the browser's password manager owns it.
 *
 * Stored in the `settings` store under `account:<domain>:<profileId>` (no schema change).
 */
import { req, runTx } from './db';
import { extUrl } from './ext-url';
import { hostnameKey } from './keys';
import type { Row, Setting } from './model';
import { getSetting } from './repo';

export type AccountState = 'none' | 'awaiting_email' | 'ready' | 'not_needed';

export interface SiteAccount {
  domain: string;
  profileId: string;
  state: AccountState;
  /** The sign-up page, as the user marked it ("this is the sign-up page"). */
  signupUrl?: string;
  updatedAt: string;
}

export const ACCOUNT_PREFIX = 'account:';
const keyOf = (domain: string, profileId: string): string => `${ACCOUNT_PREFIX}${domain}:${profileId}`;

/** A page of the bundled demo (src/public/demo/), which is served from the extension's own origin. */
export const isDemoUrl = (url: string): boolean =>
  /^(chrome|moz|edge)-extension:/i.test(url) && url.startsWith(extUrl('/demo/'));

/**
 * The demo stands in for several sites on one origin: each folder under /demo/ is a site of its
 * own (`demo/hub`). Not the extension id — it differs per install, and the note would not travel.
 */
function demoSite(url: string): string | null {
  if (!isDemoUrl(url)) return null;
  const folder = url.slice(extUrl('/demo/').length).split(/[?#]/)[0]?.split('/');
  return folder && folder.length > 1 ? `demo/${folder[0]}` : 'demo';
}

/**
 * The site a row belongs to: the host of its target (www. dropped), or the domain of an e-mail
 * target. Never the row key — a key can be overridden on import (Codex review of #6).
 */
export function accountDomain(row: Pick<Row, 'target' | 'targetKind'>): string | null {
  if (row.targetKind === 'url') return demoSite(row.target) ?? hostnameKey(row.target);
  if (row.targetKind === 'email')
    return (
      row.target
        .replace(/^mailto:/i, '')
        .split('@')[1]
        ?.toLowerCase() || null
    );
  return null;
}

/** Sign-up is done (or not needed): the panel opens on the submission tab. */
export const accountSettled = (a: SiteAccount | null): boolean => a?.state === 'ready' || a?.state === 'not_needed';

export async function getAccount(domain: string, profileId: string): Promise<SiteAccount | null> {
  return canonicalAccount(await getSetting<unknown>(keyOf(domain, profileId), null));
}

/** Read-modify-write in one transaction: two quick clicks (a state and the sign-up page) both land. */
export async function saveAccount(
  domain: string,
  profileId: string,
  patch: Partial<Pick<SiteAccount, 'state' | 'signupUrl'>>,
): Promise<SiteAccount> {
  const key = keyOf(domain, profileId);
  return runTx('settings', 'readwrite', async (s) => {
    const stored = (await req(s('settings').get(key))) as Setting<unknown> | undefined;
    const current = canonicalAccount(stored?.value);
    const next: SiteAccount = {
      domain,
      profileId,
      state: patch.state ?? current?.state ?? 'none',
      ...(patch.signupUrl !== undefined || current?.signupUrl
        ? { signupUrl: httpUrl(patch.signupUrl ?? current?.signupUrl) }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    if (!next.signupUrl) delete next.signupUrl;
    await req(s('settings').put({ key, value: next } satisfies Setting<SiteAccount>));
    return next;
  });
}

/** Every account note — for the backup bundle (global, like recipes). */
export async function listAccounts(): Promise<SiteAccount[]> {
  return runTx('settings', 'readonly', async (s) => {
    const all = (await req(s('settings').getAll(ACCOUNT_RANGE()))) as Setting<unknown>[];
    return all.map((x) => canonicalAccount(x.value)).filter((a): a is SiteAccount => !!a);
  });
}

/** Delete the account notes that match (the demo's, when the demo is removed). */
export async function deleteAccounts(match: (a: SiteAccount) => boolean): Promise<void> {
  await runTx('settings', 'readwrite', async (s) => {
    const all = (await req(s('settings').getAll(ACCOUNT_RANGE()))) as Setting<unknown>[];
    for (const x of all) {
      const a = canonicalAccount(x.value);
      if (a && match(a)) await req(s('settings').delete(x.key));
    }
  });
}

/** The key range of every account note in `settings`. */
export const ACCOUNT_RANGE = (): IDBKeyRange => IDBKeyRange.bound(ACCOUNT_PREFIX, `${ACCOUNT_PREFIX}￿`);

const STATES: readonly AccountState[] = ['none', 'awaiting_email', 'ready', 'not_needed'];
/** An http(s) URL the browser can parse with a host — anything else is dropped. */
function httpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    const u = new URL(v);
    // No user:password@ — a credential must never ride into settings or a backup.
    const ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && !u.username && !u.password;
    // The one exception: a sign-up page of the bundled demo (another install has another id, and
    // its demo URL is dropped on restore — harmless).
    return ok || isDemoUrl(u.href) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The exact stored shape, or null. Anything else a backup carries (an extra field, a password) is
 * dropped, a URL that is not http(s) is dropped, and a note without a valid timestamp is rejected —
 * restore compares timestamps to keep the newer note (Codex review of #6).
 */
export function canonicalAccount(v: unknown): SiteAccount | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.domain !== 'string' || !a.domain || typeof a.profileId !== 'string' || !a.profileId) return null;
  if (!STATES.includes(a.state as AccountState)) return null;
  if (typeof a.updatedAt !== 'string' || Number.isNaN(Date.parse(a.updatedAt))) return null;
  const out: SiteAccount = {
    domain: a.domain,
    profileId: a.profileId,
    state: a.state as AccountState,
    updatedAt: new Date(a.updatedAt).toISOString(),
  };
  const url = httpUrl(a.signupUrl);
  if (url) out.signupUrl = url;
  return out;
}

export const accountKey = (a: SiteAccount): string => keyOf(a.domain, a.profileId);
