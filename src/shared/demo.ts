/**
 * Demo campaign — "guest posts to five blogs": four demo pages bundled with the extension (a
 * classic form, a rich editor, a select + limit + file, no form) plus one e-mail row. It shows
 * the whole path — variables → template → queue → Fill — without touching a real site, and it
 * can be removed in one click. Seeded from the welcome page; never automatically.
 */

import { accountDomain, deleteAccounts, saveAccount } from './accounts';
import { ENGINE_VERSION } from './engine';
import { extUrl } from './ext-url';
import type { Campaign, ColumnDef, Row } from './model';
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  getSetting,
  listCampaigns,
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

export const DEMO_SUBMIT_KEY = 'demo.submitCampaignId';
export const DEMO_SUBMIT_NAME = 'Demo — profiles and submissions';

const SUBMIT_TITLE = '{Alex Demo|Alex D.} — {notes on|writing about} {small budgets|side projects}';

const SUBMIT_BODY = `{Hi|Hello} %site_name%! I'm %my_name% and I {write about|collect notes on} {small budgets|side projects} at %my_site%.

{Glad to join|Happy to be here} — {I'll share|expect} {practical notes|short how-tos} {now and then|every few weeks}.`;

/** Account domains of the submissions demo (one per folder under /demo/, see accountDomain). */
const DEMO_SITES = ['demo/hub', 'demo/board'];

const SUBMIT_COLUMNS: Omit<ColumnDef, 'id'>[] = [
  { header: 'url', variable: 'url', role: 'target', type: 'text', fillable: false },
  { header: 'site_name', variable: 'site_name', role: 'none', type: 'text', fillable: false },
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

/** Both demo campaigns; a demo seeded before the submissions one existed gets it added. */
async function seedDemoOnce(): Promise<Campaign> {
  const guest = (await demoCampaign()) ?? (await seedGuestPosts());
  if (!(await submitDemoCampaign())) await seedSubmissions();
  return guest;
}

export async function submitDemoCampaign(): Promise<Campaign | null> {
  const id = await getSetting<string | null>(DEMO_SUBMIT_KEY, null);
  return id ? ((await getCampaign(id)) ?? null) : null;
}

/**
 * The submissions demo (ADR 0014): two sites under /demo/hub and /demo/board, each asking for an
 * account first. The account notes are seeded with each site's sign-up page, so the panel's
 * Sign-up tab can open it.
 */
async function seedSubmissions(): Promise<Campaign> {
  const base = await createCampaign({ name: DEMO_SUBMIT_NAME, scenario: 'submit' });
  const columns: ColumnDef[] = SUBMIT_COLUMNS.map((c) => ({ ...c, id: uuid() }));
  const [url, siteName] = columns.map((c) => c.id) as [string, string];
  const profileId = uuid();
  const campaign = await updateCampaign(base.id, {
    columns,
    profiles: [
      {
        id: profileId,
        name: 'Demo sender',
        values: { name: 'Alex Demo', email: 'alex@example.com', site: 'https://example.com' },
        activation: { kind: 'always' },
      },
    ],
    wizardStep: 'done',
  });
  const sites: [string, string, string, string][] = [
    ['hub/profile.html', 'hub/join.html', 'Maker Hub', 'demo-hub'],
    ['board/submit.html', 'board/join.html', 'Story Board', 'demo-board'],
  ];
  const rows: Row[] = [];
  for (const [page, join, name, key] of sites) {
    const target = extUrl(`/demo/${page}`);
    const row = makeRow(campaign, { target, values: { [url]: target, [siteName]: name } }, key);
    if (!row) continue;
    rows.push(row);
    const domain = accountDomain(row);
    if (domain) await saveAccount(domain, profileId, { signupUrl: extUrl(`/demo/${join}`) });
  }
  await putRows(rows);
  const stamp = new Date().toISOString();
  for (const [channel, source] of [
    ['body', SUBMIT_BODY],
    ['subject', SUBMIT_TITLE],
  ] as const)
    await upsertTemplate({
      campaignId: campaign.id,
      channel,
      step: 1,
      locale: 'en',
      source,
      includes: {},
      engineVersion: ENGINE_VERSION,
      validatedAt: stamp,
    });
  await setSetting(DEMO_SUBMIT_KEY, campaign.id);
  return campaign;
}

async function seedGuestPosts(): Promise<Campaign> {
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
  const s = await submitDemoCampaign();
  if (!c && !s) return false;
  // The submissions demo's account notes go with it: notes on its sites whose profile is its own,
  // or belongs to no campaign any more (the demo campaign deleted on its own earlier). A demo-site
  // note of a profile still in use stays.
  const live = new Set(
    (await listCampaigns()).filter((x) => x.id !== s?.id).flatMap((x) => x.profiles.map((p) => p.id)),
  );
  await deleteAccounts((a) => DEMO_SITES.includes(a.domain) && !live.has(a.profileId));
  if (c) await deleteCampaign(c.id);
  if (s) await deleteCampaign(s.id);
  await setSetting(DEMO_SETTING_KEY, null);
  await setSetting(DEMO_SUBMIT_KEY, null);
  return true;
}
