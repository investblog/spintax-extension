import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: { runtime: { getURL: (p: string) => `chrome-extension://demo-id${p}` } },
}));

import { demoCampaign, removeDemo, seedDemo } from './demo';
import { findTemplate, listRows } from './repo';

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
});
