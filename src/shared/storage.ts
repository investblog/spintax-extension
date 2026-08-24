/**
 * Storage hygiene: assets are global and content-addressed, so nothing removes them when a row,
 * a column or a campaign goes away. This module finds files no campaign refers to any more
 * (by sha256 or by name — both are valid cell values) and removes them on request.
 */
import { referencedAssets } from './backup';
import { deleteDb } from './db';
import type { Asset } from './model';
import { deleteAsset, findAsset, listAssets, listCampaigns, listRows } from './repo';

/** sha256 of every asset some campaign's file cell or default points at. */
export async function referencedAssetShas(): Promise<Set<string>> {
  const shas = new Set<string>();
  for (const campaign of await listCampaigns()) {
    const rows = await listRows(campaign.id);
    for (const ref of referencedAssets(campaign, rows)) {
      const asset = await findAsset(ref);
      if (asset && asset !== 'ambiguous') shas.add(asset.sha256);
      else if (asset === 'ambiguous')
        for (const a of await listAssets()) if (a.name.toLowerCase() === ref.trim().toLowerCase()) shas.add(a.sha256);
    }
  }
  return shas;
}

export async function listOrphanAssets(): Promise<Asset[]> {
  const used = await referencedAssetShas();
  return (await listAssets()).filter((a) => !used.has(a.sha256));
}

/** Remove every unreferenced asset; returns what went. */
export async function purgeOrphanAssets(): Promise<{ count: number; bytes: number }> {
  const orphans = await listOrphanAssets();
  let bytes = 0;
  for (const a of orphans) {
    await deleteAsset(a.sha256);
    bytes += a.size;
  }
  return { count: orphans.length, bytes };
}

/** Everything: campaigns, rows, journal, templates, recipes, assets, settings. */
export async function deleteAllData(): Promise<void> {
  await deleteDb();
}
