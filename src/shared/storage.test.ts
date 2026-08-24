import { describe, expect, it } from 'vitest';
import { createCampaign, listAssets, makeRow, putAsset, putRows, updateCampaign, uuid } from './repo';
import { listOrphanAssets, purgeOrphanAssets } from './storage';

describe('storage hygiene — orphan assets', () => {
  it('keeps files referenced by name or by sha256 and removes the rest', async () => {
    const campaign = await createCampaign({ name: 'Files' });
    const col = {
      id: uuid(),
      header: 'icon',
      variable: 'icon',
      role: 'none' as const,
      type: 'file' as const,
      fillable: true,
    };
    const site = {
      id: uuid(),
      header: 'site',
      variable: 'site',
      role: 'target' as const,
      type: 'text' as const,
      fillable: false,
    };
    await updateCampaign(campaign.id, { columns: [site, col] });
    const byName = await putAsset(new Blob(['a']), 'logo.png');
    const bySha = await putAsset(new Blob(['b']), 'shot.png');
    const orphan = await putAsset(new Blob(['c']), 'old.png');
    const updated = { ...campaign, columns: [site, col] };
    const rows = [
      makeRow(updated, { target: 'a.com', values: { [site.id]: 'a.com', [col.id]: 'logo.png' } }),
      makeRow(updated, { target: 'b.io', values: { [site.id]: 'b.io', [col.id]: bySha.sha256 } }),
    ].filter((r): r is NonNullable<typeof r> => r !== null);
    await putRows(rows);

    expect((await listOrphanAssets()).map((a) => a.name)).toEqual(['old.png']);
    const gone = await purgeOrphanAssets();
    expect(gone).toEqual({ count: 1, bytes: orphan.size });
    expect((await listAssets()).map((a) => a.sha256).sort()).toEqual([byName.sha256, bySha.sha256].sort());
  });
});
