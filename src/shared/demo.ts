/**
 * Demo campaign — "guest posts to five blogs": four demo pages bundled with the extension (a
 * classic form, a rich editor, a select + limit + file, no form) plus one e-mail row. It shows
 * the whole path — variables → template → queue → Fill — without touching a real site, and it
 * can be removed in one click. Seeded from the welcome page; never automatically.
 */

import { ENGINE_VERSION } from './engine';
import { extUrl } from './ext-url';
import type { Campaign, ColumnDef, Row } from './model';
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  getSetting,
  makeRow,
  putRows,
  setSetting,
  updateCampaign,
  upsertTemplate,
  uuid,
} from './repo';

export const DEMO_SETTING_KEY = 'demo.campaignId';
export const DEMO_NAME = 'Demo — guest posts';

const BODY = `{Hi|Hello} %name%,

{I run|I write for} %my_site% and {really enjoyed|liked} your {piece|post} on %topic% — {the practical angle|the examples} {stood out|stayed with me}.

{Would you|Do you} accept a guest post for %blog% {on a related angle|that builds on it}? {I can|Happy to} send {an outline|two ideas} first, {no strings attached|and you pick}.

{Thanks|Best},
%my_name%`;

const SUBJECT = '{Guest post|Article idea} for %blog%: %topic%';

const COLUMNS: Omit<ColumnDef, 'id'>[] = [
  { header: 'site', variable: 'site', role: 'target', type: 'text', fillable: false },
  { header: 'blog', variable: 'blog', role: 'none', type: 'text', fillable: false },
  { header: 'name', variable: 'name', role: 'none', type: 'text', fillable: false },
  { header: 'topic', variable: 'topic', role: 'none', type: 'text', fillable: true },
  { header: 'logo', variable: 'logo', role: 'none', type: 'file', fillable: true },
];

export async function demoCampaign(): Promise<Campaign | null> {
  const id = await getSetting<string | null>(DEMO_SETTING_KEY, null);
  return id ? ((await getCampaign(id)) ?? null) : null;
}

let seeding: Promise<Campaign> | null = null;

/** Create the demo (idempotent, also against a double click) and return it. */
export function seedDemo(): Promise<Campaign> {
  if (!seeding)
    seeding = seedDemoOnce().finally(() => {
      seeding = null;
    });
  return seeding;
}

async function seedDemoOnce(): Promise<Campaign> {
  const existing = await demoCampaign();
  if (existing) return existing;
  const base = await createCampaign({ name: DEMO_NAME });
  const columns: ColumnDef[] = COLUMNS.map((c) => ({ ...c, id: uuid() }));
  const [site, blog, name, topic, logo] = columns.map((c) => c.id) as [string, string, string, string, string];
  const page = (n: number): string => extUrl(`/demo/blog-${n}.html`);
  const demoRows: [string, string, string, string, string][] = [
    [page(1), 'Nomad Finance', 'Maya', 'budgeting while travelling', 'demo-blog-1'],
    [page(2), 'TechNotes', 'Daniel', 'self-hosted note apps', 'demo-blog-2'],
    [page(3), 'Wellness Weekly', 'Priya', 'Sleep', 'demo-blog-3'],
    [page(4), 'Garden Diaries', 'Tom', 'balcony composting', 'demo-blog-4'],
    ['editor@garden-diaries.test', 'Garden Diaries', 'Tom', 'balcony composting', 'demo-email'],
  ];
  const campaign = await updateCampaign(base.id, {
    columns,
    profiles: [
      {
        id: uuid(),
        name: 'Demo sender',
        values: { name: 'Alex Demo', email: 'alex@example.com', site: 'example.com' },
        activation: { kind: 'always' },
      },
    ],
    wizardStep: 'done',
  });
  const rows = demoRows
    .map(([target, blogName, person, subject, key]) =>
      makeRow(
        campaign,
        { target, values: { [site]: target, [blog]: blogName, [name]: person, [topic]: subject, [logo]: 'logo.png' } },
        key,
      ),
    )
    .filter((r): r is Row => r !== null);
  await putRows(rows);
  const stamp = new Date().toISOString();
  await upsertTemplate({
    campaignId: campaign.id,
    channel: 'body',
    step: 1,
    locale: 'en',
    source: BODY,
    includes: {},
    engineVersion: ENGINE_VERSION,
    validatedAt: stamp,
  });
  await upsertTemplate({
    campaignId: campaign.id,
    channel: 'subject',
    step: 1,
    locale: 'en',
    source: SUBJECT,
    includes: {},
    engineVersion: ENGINE_VERSION,
    validatedAt: stamp,
  });
  await setSetting(DEMO_SETTING_KEY, campaign.id);
  return campaign;
}

/** Remove the demo campaign with everything it owns (rows, journal, templates). */
export async function removeDemo(): Promise<boolean> {
  const c = await demoCampaign();
  if (!c) return false;
  await deleteCampaign(c.id);
  await setSetting(DEMO_SETTING_KEY, null);
  return true;
}
