import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  correctLastEvent,
  countRowsByStatus,
  createCampaign,
  deleteCampaign,
  deleteRecipe,
  findRecipes,
  findTemplate,
  getAsset,
  getRow,
  lastSavedText,
  listCampaigns,
  listEvents,
  listRows,
  makeRow,
  putAsset,
  putRows,
  updateCampaign,
  upsertRecipe,
  upsertTemplate,
} from './repo';

const ENGINE = '0.6.1';

async function seedCampaign() {
  const campaign = await createCampaign({
    name: 'Test',
    columns: [{ id: 'c1', header: 'Name', variable: 'name', role: 'none', type: 'text', fillable: false }],
  });
  const rows = [
    makeRow(campaign, { target: 'https://www.A.com/contact', values: { c1: 'Anna' } }),
    makeRow(campaign, { target: 'b@b.io', values: { c1: '' } }),
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  await putRows(rows);
  return { campaign, rows };
}

describe('campaigns and rows', () => {
  it('creates a campaign with derived seedKeys', async () => {
    const { campaign, rows } = await seedCampaign();
    expect((await listCampaigns()).map((c) => c.id)).toEqual([campaign.id]);
    expect(rows.map((r) => r.seedKey)).toEqual(['a.com', 'b@b.io']);
    expect(rows.map((r) => r.targetKind)).toEqual(['url', 'email']);
    expect(await listRows(campaign.id)).toHaveLength(2);
    expect(await countRowsByStatus(campaign.id, 'not_started')).toBe(2);
  });

  it('makeRow returns null for an unusable target', async () => {
    const { campaign } = await seedCampaign();
    expect(makeRow(campaign, { target: 'no target', values: {} })).toBeNull();
  });

  it('updateCampaign bumps updatedAt and keeps id', async () => {
    const { campaign } = await seedCampaign();
    const next = await updateCampaign(campaign.id, { name: 'Renamed', wizardStep: 3 });
    expect(next.id).toBe(campaign.id);
    expect(next.name).toBe('Renamed');
    expect(next.wizardStep).toBe(3);
  });

  it('deleteCampaign removes rows, templates and journal', async () => {
    const { campaign, rows } = await seedCampaign();
    const row = rows[0] as NonNullable<(typeof rows)[0]>;
    await appendEvent({ rowId: row.rowId, step: 1, event: 'sent', engineVersion: ENGINE, body: 'hi' });
    await upsertTemplate({
      campaignId: campaign.id,
      channel: 'body',
      step: 1,
      locale: 'en',
      source: 'x',
      includes: {},
      engineVersion: ENGINE,
    });
    await deleteCampaign(campaign.id);
    expect(await listCampaigns()).toHaveLength(0);
    expect(await listRows(campaign.id)).toHaveLength(0);
    expect(await listEvents(row.rowId)).toHaveLength(0);
  });
});

describe('journal projection (ADR 0011 p.3)', () => {
  it('filled → filled_unconfirmed, sent → sent, seed follows seedKey:step[:salt]', async () => {
    const { rows } = await seedCampaign();
    const row = rows[0] as NonNullable<(typeof rows)[0]>;
    const filled = await appendEvent({
      rowId: row.rowId,
      step: 1,
      event: 'filled',
      engineVersion: ENGINE,
      body: 'Hello',
    });
    expect(filled.seed).toBe('a.com:1');
    expect((await getRow(row.rowId))?.deliveryStatus).toBe('filled_unconfirmed');
    await appendEvent({ rowId: row.rowId, step: 1, event: 'sent', engineVersion: ENGINE, body: 'Hello' });
    expect((await getRow(row.rowId))?.deliveryStatus).toBe('sent');
    const alt = await appendEvent({
      rowId: row.rowId,
      step: 2,
      event: 'edited',
      engineVersion: ENGINE,
      salt: 2,
      body: 'Alt',
    });
    expect(alt.seed).toBe('a.com:2:2');
    expect((await getRow(row.rowId))?.salt).toBe(2);
  });

  it('failed carries a reason; replied/declined/excluded stop follow-ups', async () => {
    const { rows } = await seedCampaign();
    const row = rows[1] as NonNullable<(typeof rows)[0]>;
    await appendEvent({ rowId: row.rowId, step: 1, event: 'failed', reason: 'no_form', engineVersion: ENGINE });
    let r = await getRow(row.rowId);
    expect(r?.deliveryStatus).toBe('not_sent');
    expect(r?.failureReason).toBe('no_form');
    await appendEvent({ rowId: row.rowId, step: 1, event: 'replied', engineVersion: ENGINE });
    r = await getRow(row.rowId);
    expect(r?.deliveryStatus).toBe('replied');
    expect(r?.followupState).toBe('stopped');
  });

  it('lastSavedText returns the latest body for a step; correctLastEvent re-projects', async () => {
    const { rows } = await seedCampaign();
    const row = rows[0] as NonNullable<(typeof rows)[0]>;
    await appendEvent({ rowId: row.rowId, step: 1, event: 'sent', engineVersion: ENGINE, body: 'v1' });
    await appendEvent({ rowId: row.rowId, step: 1, event: 'edited', engineVersion: ENGINE, body: 'v2' });
    expect(await lastSavedText(row.rowId, 1)).toEqual({ subject: undefined, body: 'v2' });
    expect(await lastSavedText(row.rowId, 2)).toBeNull();

    await correctLastEvent(row.rowId, { step: 1, event: 'failed', reason: 'captcha', engineVersion: ENGINE });
    const events = await listEvents(row.rowId);
    expect(events.map((e) => e.event)).toEqual(['sent', 'edited', 'corrected', 'failed']);
    expect(events[2]?.correctsEventId).toBe(events[1]?.id);
    // the corrected `edited` no longer counts: v1 is the last saved text, status re-projected
    expect(await lastSavedText(row.rowId, 1)).toEqual({ subject: undefined, body: 'v1' });
    expect((await getRow(row.rowId))?.deliveryStatus).toBe('not_sent');
    expect((await getRow(row.rowId))?.failureReason).toBe('captcha');
    // correcting again: failed → deferred clears failureReason
    await correctLastEvent(row.rowId, {
      step: 1,
      event: 'deferred',
      until: '2026-09-01T00:00:00.000Z',
      engineVersion: ENGINE,
    });
    const r = await getRow(row.rowId);
    expect(r?.deliveryStatus).toBe('deferred');
    expect(r?.failureReason).toBeUndefined();
    expect(r?.deferredUntil).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('follow-ups (ADR 0011 p.3)', () => {
  it('sent on step 1 schedules step 2 by delayDays; last step → done; replied → stopped', async () => {
    const { campaign, rows } = await seedCampaign();
    await updateCampaign(campaign.id, {
      steps: [
        { step: 1, kind: 'initial' },
        { step: 2, kind: 'followup', delayDays: 5 },
      ],
    });
    const row = rows[0] as NonNullable<(typeof rows)[0]>;
    const sent = await appendEvent({ rowId: row.rowId, step: 1, event: 'sent', engineVersion: ENGINE, body: 'hi' });
    let r = await getRow(row.rowId);
    expect(r?.followupState).toBe('due');
    expect(r?.currentStep).toBe(2);
    expect(new Date(r?.followupDueAt ?? 0).getTime() - new Date(sent.at).getTime()).toBe(5 * 86_400_000);
    await appendEvent({ rowId: row.rowId, step: 2, event: 'sent', engineVersion: ENGINE, body: 'follow-up' });
    r = await getRow(row.rowId);
    expect(r?.followupState).toBe('done');
    expect(r?.followupDueAt).toBeUndefined();
    await appendEvent({ rowId: row.rowId, step: 2, event: 'replied', engineVersion: ENGINE });
    expect((await getRow(row.rowId))?.followupState).toBe('stopped');
  });
  it('rejects malformed events and keeps seq strictly increasing', async () => {
    const { rows } = await seedCampaign();
    const row = rows[0] as NonNullable<(typeof rows)[0]>;
    // @ts-expect-error reason is required
    await expect(appendEvent({ rowId: row.rowId, step: 1, event: 'failed', engineVersion: ENGINE })).rejects.toThrow(
      /reason/,
    );
    const a = await appendEvent({ rowId: row.rowId, step: 1, event: 'filled', engineVersion: ENGINE });
    const b = await appendEvent({ rowId: row.rowId, step: 1, event: 'sent', engineVersion: ENGINE });
    expect(b.seq).toBeGreaterThan(a.seq);
  });
});

describe('templates, recipes, assets', () => {
  it('upsertTemplate is unique per (campaign, channel, step, locale)', async () => {
    const { campaign } = await seedCampaign();
    const a = await upsertTemplate({
      campaignId: campaign.id,
      channel: 'body',
      step: 1,
      locale: 'en',
      source: 'a',
      includes: {},
      engineVersion: ENGINE,
    });
    const b = await upsertTemplate({
      campaignId: campaign.id,
      channel: 'body',
      step: 1,
      locale: 'en',
      source: 'b',
      includes: {},
      engineVersion: ENGINE,
    });
    expect(b.id).toBe(a.id);
    expect((await findTemplate(campaign.id, 'body', 1, 'en'))?.source).toBe('b');
  });

  it('recipes are found by origin + routePattern and versioned', async () => {
    const r1 = await upsertRecipe({
      key: { origin: 'https://a.com', routePattern: '/contact', formSignature: 'sig', frame: '' },
      fields: [],
      source: 'heuristic',
    });
    const r2 = await upsertRecipe({ key: r1.key, fields: [], source: 'manual' });
    expect(r2.id).toBe(r1.id);
    expect(r2.version).toBe(2);
    expect(r2.createdAt).toBe(r1.createdAt);
    expect((await findRecipes('https://a.com', '/contact')).map((r) => r.id)).toEqual([r1.id]);
    await deleteRecipe(r1.id);
    expect(await findRecipes('https://a.com', '/contact')).toEqual([]);
    await expect(deleteRecipe('no-such-id')).resolves.toBeUndefined();
  });

  it('assets dedupe by sha256', async () => {
    const a = await putAsset(new Blob(['png-bytes'], { type: 'image/png' }), 'logo.png', { width: 128, height: 128 });
    const b = await putAsset(new Blob(['png-bytes'], { type: 'image/png' }), 'logo-copy.png');
    expect(b.sha256).toBe(a.sha256);
    expect(b.name).toBe('logo.png');
    expect((await getAsset(a.sha256))?.size).toBe(9);
  });
});
