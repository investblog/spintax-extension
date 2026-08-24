import { describe, expect, it } from 'vitest';
import { exportCampaignZip, importCampaignZip } from './backup';
import { deleteDb } from './db';
import {
  appendEvent,
  createCampaign,
  getAsset,
  getRow,
  listEvents,
  listRows,
  listTemplates,
  makeRow,
  putAsset,
  putRows,
  upsertTemplate,
} from './repo';

describe('backup zip round-trip', () => {
  it('exports campaign.json + assets and restores them', async () => {
    const campaign = await createCampaign({
      name: 'Store submit',
      scenario: 'submit',
      columns: [
        { id: 'name', header: 'Name', variable: 'name', role: 'none', type: 'text', fillable: true },
        { id: 'logo', header: 'Logo', variable: 'logo', role: 'none', type: 'file', fillable: true },
      ],
    });
    const asset = await putAsset(new Blob(['logo'], { type: 'image/png' }), 'logo.png', { width: 300, height: 300 });
    const row = makeRow(campaign, {
      target: 'https://chrome.google.com/webstore',
      lang: 'de',
      values: { name: 'Spintax', logo: asset.sha256 },
    });
    if (!row) throw new Error('row');
    await putRows([row]);
    await upsertTemplate({
      campaignId: campaign.id,
      channel: 'body',
      step: 1,
      locale: 'en',
      source: '{Hi|Hello} %name%',
      includes: {},
      engineVersion: '0.6.1',
    });
    await appendEvent({ rowId: row.rowId, step: 1, event: 'sent', engineVersion: '0.6.1', body: 'Hi Spintax' });

    const zip = await exportCampaignZip(campaign.id);
    expect(zip.type).toBe('application/zip');
    expect(zip.size).toBeGreaterThan(100);

    await deleteDb();
    const result = await importCampaignZip(zip);
    expect(result).toMatchObject({
      campaignId: campaign.id,
      rows: 1,
      templates: 1,
      journal: 1,
      assets: 1,
      missingAssets: [],
    });
    expect((await listRows(campaign.id))[0]?.seedKey).toBe('chrome.google.com:de');
    expect((await getRow(row.rowId))?.deliveryStatus).toBe('sent');
    expect((await listTemplates(campaign.id))[0]?.source).toBe('{Hi|Hello} %name%');
    expect((await listEvents(row.rowId))[0]?.body).toBe('Hi Spintax');
    expect((await getAsset(asset.sha256))?.width).toBe(300);
  });

  it('rejects a zip without campaign.json', async () => {
    await expect(
      importCampaignZip(
        new Blob([new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]),
      ),
    ).rejects.toThrow(/campaign.json/);
  });
});
