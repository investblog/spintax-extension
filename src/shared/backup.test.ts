import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { getAccount, listAccounts, saveAccount } from './accounts';
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
    await saveAccount('chrome.google.com', 'p1', {
      state: 'awaiting_email',
      signupUrl: 'https://chrome.google.com/join',
    });

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
    // Site account notes (ADR 0014) travel with the backup.
    expect(await getAccount('chrome.google.com', 'p1')).toMatchObject({
      state: 'awaiting_email',
      signupUrl: 'https://chrome.google.com/join',
    });
    expect(await listAccounts()).toHaveLength(1);
  });

  it('site account notes: newer wins on restore, extra fields dropped, malformed rejected (ADR 0014)', async () => {
    const campaign = await createCampaign({ name: 'Accounts' });
    await saveAccount('a.test', 'p', { state: 'awaiting_email' });
    await saveAccount('b.test', 'p', { state: 'awaiting_email' });
    const zip = await exportCampaignZip(campaign.id);
    // after the backup: a.test moved on on this device, b.test was deleted
    await new Promise((r) => setTimeout(r, 5));
    await saveAccount('a.test', 'p', { state: 'ready' });
    await deleteDb();
    await saveAccount('a.test', 'p', { state: 'ready' });
    await importCampaignZip(zip);
    expect((await getAccount('a.test', 'p'))?.state).toBe('ready'); // local note is newer
    expect((await getAccount('b.test', 'p'))?.state).toBe('awaiting_email'); // restored

    const doctor = async (accounts: unknown): Promise<Blob> => {
      const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
      const bundle = JSON.parse(strFromU8(entries['campaign.json'] as Uint8Array));
      if (accounts === undefined) delete bundle.accounts;
      else bundle.accounts = accounts;
      entries['campaign.json'] = strToU8(JSON.stringify(bundle));
      return new Blob([zipSync(entries) as BlobPart]);
    };
    const good = { domain: 'c.test', profileId: 'p', state: 'ready', updatedAt: new Date().toISOString() };
    await importCampaignZip(await doctor([{ ...good, password: 'x', signupUrl: 'javascript:alert(1)' }]));
    const c = await getAccount('c.test', 'p');
    expect(c).toEqual({ domain: 'c.test', profileId: 'p', state: 'ready', updatedAt: good.updatedAt });
    await expect(importCampaignZip(await doctor([{ ...good, updatedAt: 'yesterday' }]))).rejects.toThrow(
      /site account/,
    );
    await expect(importCampaignZip(await doctor(undefined))).resolves.toMatchObject({ campaignId: campaign.id });
  });

  it('rejects a zip without campaign.json', async () => {
    await expect(
      importCampaignZip(
        new Blob([new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]),
      ),
    ).rejects.toThrow(/campaign.json/);
  });
});
