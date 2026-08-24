/**
 * Repository — campaign-level operations over the IndexedDB stores (docs/data-model.md).
 * The row's status fields are a PROJECTION of the journal: `appendEvent` writes the event and
 * replays the row's effective events through `reduceRow` in one transaction (ADR 0011 p.3).
 */
import { countByIndex, del, get, getAll, getAllByIndex, put, req, runTx, type StoreName } from './db';
import { buildSeed, deriveSeedKey, detectTargetKind } from './keys';
import type {
  Asset,
  Campaign,
  CampaignId,
  ColumnDef,
  DeliveryStatus,
  FailureReason,
  JournalEvent,
  JournalEventKind,
  Recipe,
  ReviewState,
  Row,
  RowId,
  Scenario,
  Setting,
  StepDef,
  Template,
  TemplateChannel,
} from './model';
import { SCHEMA_VERSION } from './model';

export const now = (): string => new Date().toISOString();
export const uuid = (): string => crypto.randomUUID();

const SEQ_KEY = 'journalSeq';

type Store = (name: StoreName) => IDBObjectStore;

// ── Campaigns ──────────────────────────────────────────────────────────────────

export interface NewCampaign {
  name: string;
  scenario?: Scenario;
  defaultLocale?: string;
  columns?: ColumnDef[];
}

export async function createCampaign(input: NewCampaign): Promise<Campaign> {
  const ts = now();
  const campaign: Campaign = {
    id: uuid(),
    schemaVersion: SCHEMA_VERSION,
    name: input.name,
    scenario: input.scenario ?? 'outreach',
    columns: input.columns ?? [],
    profiles: [],
    steps: [{ step: 1, kind: 'initial' }],
    defaultLocale: input.defaultLocale ?? 'en',
    wizardStep: 1,
    createdAt: ts,
    updatedAt: ts,
  };
  await put('campaigns', campaign);
  return campaign;
}

export const getCampaign = (id: CampaignId): Promise<Campaign | undefined> => get<Campaign>('campaigns', id);
export const listCampaigns = (): Promise<Campaign[]> => getAll<Campaign>('campaigns');

export async function updateCampaign(id: CampaignId, patch: Partial<Omit<Campaign, 'id'>>): Promise<Campaign> {
  return runTx('campaigns', 'readwrite', async (s) => {
    const current = (await req(s('campaigns').get(id))) as Campaign | undefined;
    if (!current) throw new Error(`campaign ${id} not found`);
    const next: Campaign = { ...current, ...patch, id, updatedAt: now() };
    await req(s('campaigns').put(next));
    return next;
  });
}

/** Delete every record of a campaign (journal, rows, templates) inside the caller's transaction. */
export async function deleteCampaignSubgraph(s: Store, id: CampaignId): Promise<void> {
  for (const store of ['journal', 'rows', 'templates'] as const) {
    const keys = (await req(s(store).index('campaignId').getAllKeys(id))) as IDBValidKey[];
    for (const key of keys) await req(s(store).delete(key));
  }
}

export async function deleteCampaign(id: CampaignId): Promise<void> {
  await runTx(['campaigns', 'rows', 'templates', 'journal'], 'readwrite', async (s) => {
    await deleteCampaignSubgraph(s, id);
    await req(s('campaigns').delete(id));
  });
}

// ── Rows ───────────────────────────────────────────────────────────────────────

export interface NewRow {
  target: string;
  values: Record<string, string>;
  lang?: string;
  note?: string;
}

/** Build a Row from raw input; seedKey is derived (ADR 0006), never typed by the user. */
export function makeRow(campaign: Campaign, input: NewRow, keyOverride?: string): Row | null {
  const seedKey =
    keyOverride?.trim().toLowerCase() || deriveSeedKey(input.target, { scenario: campaign.scenario, lang: input.lang });
  if (!seedKey) return null;
  const ts = now();
  return {
    rowId: uuid(),
    campaignId: campaign.id,
    seedKey,
    target: input.target.trim(),
    targetKind: detectTargetKind(input.target),
    lang: input.lang?.trim().toLowerCase() || undefined,
    values: input.values,
    deliveryStatus: 'not_started',
    reviewState: 'unreviewed',
    followupState: 'none',
    currentStep: 1,
    salt: 0,
    note: input.note,
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function putRows(rows: Row[]): Promise<void> {
  await runTx('rows', 'readwrite', async (s) => {
    for (const row of rows) await req(s('rows').put(row));
  });
}

export const getRow = (rowId: RowId): Promise<Row | undefined> => get<Row>('rows', rowId);
export const listRows = (campaignId: CampaignId): Promise<Row[]> =>
  getAllByIndex<Row>('rows', 'campaignId', campaignId);
export const findRowsBySeedKey = (campaignId: CampaignId, seedKey: string): Promise<Row[]> =>
  getAllByIndex<Row>('rows', 'campaign_seedKey', [campaignId, seedKey]);
export const countRowsByStatus = (campaignId: CampaignId, status: DeliveryStatus): Promise<number> =>
  countByIndex('rows', 'campaign_status', [campaignId, status]);

/** Only non-projected fields can be patched directly; status changes go through events. */
/** seedKey is included for the row editor (a changed target re-derives it); status fields stay projections. */
export type RowPatch = Partial<
  Pick<Row, 'target' | 'targetKind' | 'lang' | 'values' | 'overrides' | 'note' | 'seedKey'>
>;

export async function updateRow(rowId: RowId, patch: RowPatch): Promise<Row> {
  return runTx('rows', 'readwrite', async (s) => {
    const current = (await req(s('rows').get(rowId))) as Row | undefined;
    if (!current) throw new Error(`row ${rowId} not found`);
    const next: Row = { ...current, ...patch, rowId, campaignId: current.campaignId, updatedAt: now() };
    await req(s('rows').put(next));
    return next;
  });
}

export async function deleteRow(rowId: RowId): Promise<void> {
  await runTx(['rows', 'journal'], 'readwrite', async (s) => {
    const keys = (await req(s('journal').index('rowId').getAllKeys(rowId))) as IDBValidKey[];
    for (const key of keys) await req(s('journal').delete(key));
    await req(s('rows').delete(rowId));
  });
}

// ── Journal + projection (ADR 0011 p.3) ────────────────────────────────────────

const TERMINAL: ReadonlySet<JournalEventKind> = new Set(['replied', 'declined', 'excluded']);

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Events that count: not `corrected` markers, not events a marker points at. Sorted by seq. */
export function effectiveEvents(events: JournalEvent[]): JournalEvent[] {
  const corrected = new Set(
    events.filter((e) => e.event === 'corrected' && e.correctsEventId).map((e) => e.correctsEventId),
  );
  return events.filter((e) => e.event !== 'corrected' && !corrected.has(e.id)).sort((a, b) => a.seq - b.seq);
}

/** Projected fields reset to their initial values. */
export function resetProjection(row: Row): Row {
  return {
    ...row,
    deliveryStatus: 'not_started',
    failureReason: undefined,
    deferredUntil: undefined,
    reviewState: 'unreviewed',
    followupState: 'none',
    followupDueAt: undefined,
    currentStep: 1,
    salt: 0,
  };
}

/** Pure reducer: apply one effective event. */
export function projectEvent(row: Row, event: JournalEvent, steps: StepDef[]): Row {
  const next: Row = { ...row };
  switch (event.event) {
    case 'filled':
      next.deliveryStatus = 'filled_unconfirmed';
      next.salt = event.salt;
      break;
    case 'sent': {
      next.deliveryStatus = 'sent';
      next.failureReason = undefined;
      next.deferredUntil = undefined;
      const following = steps.find((s) => s.step === event.step + 1);
      if (following) {
        next.currentStep = following.step;
        next.followupState = 'due';
        next.followupDueAt = addDays(event.at, following.delayDays ?? 0);
      } else {
        next.currentStep = event.step;
        next.followupState = 'done';
        next.followupDueAt = undefined;
      }
      break;
    }
    case 'failed':
      next.deliveryStatus = 'not_sent';
      next.failureReason = event.reason;
      next.deferredUntil = undefined;
      break;
    case 'deferred':
      next.deliveryStatus = 'deferred';
      next.deferredUntil = event.until;
      next.failureReason = undefined;
      break;
    case 'replied':
      next.deliveryStatus = 'replied';
      break;
    case 'declined':
      next.deliveryStatus = 'declined';
      break;
    case 'excluded':
      next.deliveryStatus = 'not_applicable';
      break;
    case 'reviewed':
      next.reviewState = event.reviewState ?? 'approved';
      break;
    case 'edited':
    case 'translated':
      next.reviewState = 'edited';
      next.salt = event.salt;
      break;
    case 'corrected':
      break;
  }
  if (TERMINAL.has(event.event)) {
    next.followupState = 'stopped';
    next.followupDueAt = undefined;
    next.failureReason = undefined;
    next.deferredUntil = undefined;
  }
  return next;
}

/** Replay the whole journal of a row from the reset baseline. */
export function reduceRow(row: Row, events: JournalEvent[], steps: StepDef[]): Row {
  let state = resetProjection(row);
  for (const e of effectiveEvents(events)) state = projectEvent(state, e, steps);
  return state;
}

interface EventBase {
  rowId: RowId;
  step: number;
  engineVersion: string;
  salt?: number;
  subject?: string;
  body?: string;
  recipeId?: string;
  recipeVersion?: number;
  fillReport?: JournalEvent['fillReport'];
  ai?: JournalEvent['ai'];
  source?: JournalEvent['source'];
}

/** Discriminated input: `failed` needs a reason, `deferred` an until, `reviewed` may carry a verdict. */
export type NewEvent =
  | (EventBase & { event: 'failed'; reason: FailureReason })
  | (EventBase & { event: 'deferred'; until: string })
  | (EventBase & { event: 'reviewed'; reviewState?: ReviewState })
  | (EventBase & { event: Exclude<JournalEventKind, 'failed' | 'deferred' | 'reviewed' | 'corrected'> });

type CorrectionMarker = { event: 'corrected'; correctsEventId: string; step: number; engineVersion: string };

/** Omit that distributes over a union (plain Omit collapses the discriminant). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewEventInput = DistributiveOmit<NewEvent, 'rowId'>;

function assertEvent(input: NewEvent): void {
  if (input.event === 'failed' && !input.reason) throw new Error('failed event needs a reason');
  if (input.event === 'deferred' && !input.until) throw new Error('deferred event needs an until date');
  if (!Number.isInteger(input.step) || input.step < 1) throw new Error('step must be a positive integer');
}

async function readSeq(s: Store): Promise<number> {
  const setting = (await req(s('settings').get(SEQ_KEY))) as Setting<number> | undefined;
  return setting?.value ?? 0;
}

/** Inside a tx: append events for one row, then re-project the row. */
async function appendEventsTx(
  s: Store,
  rowId: RowId,
  inputs: (NewEvent | CorrectionMarker)[],
): Promise<JournalEvent[]> {
  const row = (await req(s('rows').get(rowId))) as Row | undefined;
  if (!row) throw new Error(`row ${rowId} not found`);
  const campaign = (await req(s('campaigns').get(row.campaignId))) as Campaign | undefined;
  const steps = campaign?.steps ?? [{ step: 1, kind: 'initial' as const }];
  let seq = await readSeq(s);
  const existing = (await req(s('journal').index('rowId').getAll(rowId))) as JournalEvent[];
  const written: JournalEvent[] = [];
  const at = now();
  for (const input of inputs) {
    if (input.event !== 'corrected') assertEvent(input);
    seq = Math.max(Date.now(), seq + 1);
    const salt = input.event !== 'corrected' && input.salt !== undefined ? input.salt : row.salt;
    const event: JournalEvent = {
      id: uuid(),
      rowId,
      campaignId: row.campaignId,
      step: input.step,
      event: input.event,
      seed: buildSeed(row.seedKey, input.step, salt),
      salt,
      engineVersion: input.engineVersion,
      at,
      seq,
    };
    if (input.event === 'corrected') event.correctsEventId = input.correctsEventId;
    else {
      if (input.event === 'failed') event.reason = input.reason;
      if (input.event === 'deferred') event.until = input.until;
      if (input.event === 'reviewed') event.reviewState = input.reviewState;
      event.subject = input.subject;
      event.body = input.body;
      event.recipeId = input.recipeId;
      event.recipeVersion = input.recipeVersion;
      event.fillReport = input.fillReport;
      event.ai = input.ai;
      event.source = input.source;
    }
    await req(s('journal').put(event));
    existing.push(event);
    written.push(event);
  }
  await req(s('settings').put({ key: SEQ_KEY, value: seq } satisfies Setting<number>));
  const next = { ...reduceRow(row, existing, steps), updatedAt: at };
  await req(s('rows').put(next));
  return written;
}

const JOURNAL_STORES: StoreName[] = ['rows', 'journal', 'campaigns', 'settings'];

/** Write the event and the row projection in ONE transaction. Returns the stored event. */
export async function appendEvent(input: NewEvent): Promise<JournalEvent> {
  return runTx(JOURNAL_STORES, 'readwrite', async (s) => {
    const [event] = await appendEventsTx(s, input.rowId, [input]);
    return event as JournalEvent;
  });
}

export const listEvents = (rowId: RowId): Promise<JournalEvent[]> =>
  getAllByIndex<JournalEvent>('journal', 'row_seq', IDBKeyRange.bound([rowId, 0], [rowId, Number.MAX_SAFE_INTEGER]));

export const listCampaignEvents = (campaignId: CampaignId): Promise<JournalEvent[]> =>
  getAllByIndex<JournalEvent>('journal', 'campaignId', campaignId);

/** Last text the human actually sent/edited for a step — the source of truth for re-display (spec §4). */
export async function lastSavedText(rowId: RowId, step: number): Promise<{ subject?: string; body?: string } | null> {
  const events = effectiveEvents(await listEvents(rowId));
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.step === step && e.body !== undefined) return { subject: e.subject, body: e.body };
  }
  return null;
}

/**
 * Correct the latest effective event: writes a `corrected` marker and the replacement in ONE
 * transaction, then re-projects the row from the remaining effective events (ADR 0011 p.2).
 */
export async function correctLastEvent(rowId: RowId, replacement: NewEventInput): Promise<JournalEvent> {
  return runTx(JOURNAL_STORES, 'readwrite', async (s) => {
    const all = (await req(s('journal').index('rowId').getAll(rowId))) as JournalEvent[];
    const last = effectiveEvents(all).at(-1);
    if (!last) throw new Error('nothing to correct');
    const written = await appendEventsTx(s, rowId, [
      { event: 'corrected', correctsEventId: last.id, step: last.step, engineVersion: replacement.engineVersion },
      { ...replacement, rowId } as NewEvent,
    ]);
    return written[1] as JournalEvent;
  });
}

/** Replay projections for every row of a campaign (after a restore or a steps change). */
export async function reprojectCampaign(campaignId: CampaignId): Promise<number> {
  return runTx(['rows', 'journal', 'campaigns'], 'readwrite', async (s) => {
    const campaign = (await req(s('campaigns').get(campaignId))) as Campaign | undefined;
    if (!campaign) throw new Error(`campaign ${campaignId} not found`);
    const rows = (await req(s('rows').index('campaignId').getAll(campaignId))) as Row[];
    for (const row of rows) {
      const events = (await req(s('journal').index('rowId').getAll(row.rowId))) as JournalEvent[];
      await req(s('rows').put(reduceRow(row, events, campaign.steps)));
    }
    return rows.length;
  });
}

// ── Templates ──────────────────────────────────────────────────────────────────

/** Unique per (campaign, channel, step, locale): the stored tuple keeps its id; a passed id is used only for new rows. */
export async function upsertTemplate(template: Omit<Template, 'id'> & { id?: string }): Promise<Template> {
  return runTx('templates', 'readwrite', async (s) => {
    const existing = (await req(
      s('templates')
        .index('campaign_channel_step_locale')
        .get([template.campaignId, template.channel, template.step, template.locale]),
    )) as Template | undefined;
    const next: Template = { ...template, id: existing?.id ?? template.id ?? uuid() };
    await req(s('templates').put(next));
    return next;
  });
}

export const listTemplates = (campaignId: CampaignId): Promise<Template[]> =>
  getAllByIndex<Template>('templates', 'campaignId', campaignId);

export async function findTemplate(
  campaignId: CampaignId,
  channel: TemplateChannel,
  step: number,
  locale: string,
): Promise<Template | undefined> {
  const all = await getAllByIndex<Template>('templates', 'campaign_channel_step_locale', [
    campaignId,
    channel,
    step,
    locale,
  ]);
  return all[0];
}

// ── Recipes ────────────────────────────────────────────────────────────────────

export type RecipeInput = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt' | 'version'> & { id?: string };

/** Version and createdAt come from the stored record; a matching key tuple reuses the stored id. */
export async function upsertRecipe(recipe: RecipeInput): Promise<Recipe> {
  return runTx('recipes', 'readwrite', async (s) => {
    let existing: Recipe | undefined;
    if (recipe.id) existing = (await req(s('recipes').get(recipe.id))) as Recipe | undefined;
    if (!existing) {
      const candidates = (await req(
        s('recipes').index('origin_route').getAll([recipe.key.origin, recipe.key.routePattern]),
      )) as Recipe[];
      existing = candidates.find(
        (c) => c.key.formSignature === recipe.key.formSignature && c.key.frame === recipe.key.frame,
      );
    }
    const ts = now();
    const next: Recipe = {
      ...recipe,
      id: existing?.id ?? recipe.id ?? uuid(),
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    await req(s('recipes').put(next));
    return next;
  });
}

export const findRecipes = (origin: string, routePattern: string): Promise<Recipe[]> =>
  getAllByIndex<Recipe>('recipes', 'origin_route', [origin, routePattern]);
export const listRecipes = (): Promise<Recipe[]> => getAll<Recipe>('recipes');
/** Forget a site recipe — the next fill maps the form by heuristics again. Unknown id is a no-op. */
export const deleteRecipe = (id: string): Promise<void> => del('recipes', id);

// ── Assets (dedup by sha256) ───────────────────────────────────────────────────

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putAsset(
  file: Blob,
  name: string,
  dims?: { width: number; height: number },
  createdAt?: string,
): Promise<Asset> {
  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const existing = await get<Asset>('assets', sha256);
  if (existing) return existing;
  const asset: Asset = {
    sha256,
    name,
    mime: file.type || 'application/octet-stream',
    size: bytes.byteLength,
    width: dims?.width,
    height: dims?.height,
    bytes,
    createdAt: createdAt ?? now(),
  };
  await put('assets', asset);
  return asset;
}

export const getAsset = (sha256: string): Promise<Asset | undefined> => get<Asset>('assets', sha256);
export const listAssets = (): Promise<Asset[]> => getAll<Asset>('assets');
export const deleteAsset = (sha256: string): Promise<void> => del('assets', sha256);
/**
 * A file cell holds the asset name (what the user sees) or its sha256. Assets are global, so a
 * name used twice is ambiguous — the caller must ask for the sha256 rather than guess.
 */
export async function findAsset(ref: string): Promise<Asset | 'ambiguous' | undefined> {
  const bySha = await getAsset(ref);
  if (bySha) return bySha;
  const wanted = ref.trim().toLowerCase();
  const all = (await listAssets()).filter((a) => a.name.toLowerCase() === wanted);
  if (all.length > 1) return 'ambiguous';
  return all[0];
}
export const assetBlob = (asset: Asset): Blob => new Blob([asset.bytes], { type: asset.mime });

// ── Settings ───────────────────────────────────────────────────────────────────

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await get<Setting<T>>('settings', key);
  return s ? s.value : fallback;
}

export const setSetting = <T>(key: string, value: T): Promise<void> => put<Setting<T>>('settings', { key, value });

/** Raise the journal sequence high-water mark (used by restore) inside the caller's transaction. */
export async function bumpSeq(s: Store, atLeast: number): Promise<void> {
  const current = await readSeq(s);
  if (atLeast > current) await req(s('settings').put({ key: SEQ_KEY, value: atLeast } satisfies Setting<number>));
}

/** Storage usage for the settings screen (ADR 0011 p.2). */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
