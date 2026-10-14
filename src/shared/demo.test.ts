import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: { runtime: { getURL: (p: string) => `chrome-extension://demo-id${p}` } },
}));

import { accountDomain, getAccount, listAccounts, saveAccount } from './accounts';
import { DEMO_SUBMIT_KEY, demoCampaign, removeDemo, seedDemo, submitDemoCampaign } from './demo';
import { createCampaign, deleteCampaign, findTemplate, listRows, setSetting, updateCampaign } from './repo';

describe('demo campaign', () => {
  it('seeds once, with five rows on distinct keys, a profile and both templates; removes cleanly', async () => {
    const [a, b] = await Promise.all([seedDemo(), seedDemo()]); // a double click
    expect(b.id).toBe(a.id);
    const rows = await listRows(a.id);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.seedKey)).size).toBe(5);
    expect(rows.filter((r) => r.targetKind === 'url')).toHaveLength(4);
    expect(rows.filter((r) => r.targetKind === 'email')).toHaveLength(1);
    // IndexedDB returns rows in key order (uuid) — check the set, not the first one
    expect(
      rows
        .filter((r) => r.targetKind === 'url')
        .every((r) => r.target.startsWith('chrome-extension://demo-id/demo/blog-')),
    ).toBe(true);
    expect(a.profiles[0]?.values.name).toBe('Alex Demo');
    expect((await findTemplate(a.id, 'body', 1, 'en'))?.source).toContain('%blog%');
    expect((await findTemplate(a.id, 'subject', 1, 'en'))?.source).toContain('%topic%');
    expect(await removeDemo()).toBe(true);
    expect(await demoCampaign()).toBeNull();
    expect(await listRows(a.id)).toHaveLength(0);
    expect(await removeDemo()).toBe(false);
  });

  it('seeds the submissions demo: two sites with their own account notes, removed with the demo', async () => {
    await seedDemo();
    const s = await submitDemoCampaign();
    expect(s?.scenario).toBe('submit');
    const rows = await listRows(s?.id ?? '');
    expect(rows).toHaveLength(2);
    const domains = rows.map((r) => accountDomain(r)).sort();
    expect(domains).toEqual(['demo/board', 'demo/hub']);
    const profileId = s?.profiles[0]?.id ?? '';
    const hub = await getAccount('demo/hub', profileId);
    expect(hub?.state).toBe('none');
    expect(hub?.signupUrl).toBe('chrome-extension://demo-id/demo/hub/join.html');
    // A demo seeded before this one existed gets it added, once.
    await deleteCampaign(s?.id ?? '');
    await setSetting(DEMO_SUBMIT_KEY, null);
    await seedDemo();
    const again = await submitDemoCampaign();
    expect(again?.id).not.toBe(s?.id);
    // Removing the demo takes its notes — the current profile's and the orphans of the campaign
    // deleted above — but a demo-site note of a profile another campaign still uses stays.
    const other = await createCampaign({ name: 'Mine' });
    const mine = await updateCampaign(other.id, {
      profiles: [
        { id: 'mine', name: 'Me', values: { name: 'Me', email: 'me@mine.test' }, activation: { kind: 'always' } },
      ],
    });
    await saveAccount('demo/hub', 'mine', { state: 'ready' });
    expect(await removeDemo()).toBe(true);
    expect(await submitDemoCampaign()).toBeNull();
    const left = await listAccounts();
    expect(left.map((a) => `${a.domain}:${a.profileId}`)).toEqual([`demo/hub:${mine.profiles[0]?.id}`]);
    expect(left.some((a) => a.profileId === profileId)).toBe(false);
  });
});
