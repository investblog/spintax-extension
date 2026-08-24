/**
 * Full campaign backup — ZIP with campaign.json + assets/<sha256>.<ext> (ADR 0011 p.2,
 * docs/data-model.md §7). Export takes a consistent snapshot in one readonly transaction; import
 * is a RESTORE: the bundle is validated entirely before the first write, then the campaign
 * subgraph with the same id is replaced in one transaction. fflate's sync API is used — campaigns
 * are tens of MB at most; a streaming writer can replace it behind the same signatures.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { req, runTx } from './db';
import type { Asset, Campaign, JournalEvent, Recipe, Row, Template } from './model';
import { SCHEMA_VERSION } from './model';
import { bumpSeq, deleteCampaignSubgraph, findAsset, putAsset, sha256Hex } from './repo';

export const MAX_ASSET_BYTES = 512 * 1024 * 1024;

export interface CampaignBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  campaign: Campaign;
  rows: Row[];
  templates: Template[];
  journal: JournalEvent[];
  /** Global recipes — all of them; they are not campaign-scoped. */
  recipes: Recipe[];
  /** sha256 → metadata — bytes live in assets/ */
  assets: Record<string, Pick<Asset, 'name' | 'mime' | 'width' | 'height' | 'size' | 'createdAt'>>;
}

function extFor(asset: Pick<Asset, 'name' | 'mime'>): string {
  const fromName = asset.name.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromMime = asset.mime.split('/')[1];
  return fromMime ? fromMime.replace(/[^a-z0-9]/gi, '').toLowerCase() : 'bin';
}

/** sha256 values referenced by file-typed columns (cell values and column defaults). */
export function referencedAssets(campaign: Campaign, rows: Row[]): Set<string> {
  const fileColumns = campaign.columns.filter((c) => c.type === 'file');
  const out = new Set<string>();
  for (const col of fileColumns) {
    if (col.defaultValue) out.add(col.defaultValue);
    for (const row of rows) {
      const v = row.values[col.id];
      if (v) out.add(v);
    }
  }
  return out;
}

export async function exportCampaignZip(campaignId: string): Promise<Blob> {
  const snapshot = await runTx(['campaigns', 'rows', 'templates', 'journal', 'recipes'], 'readonly', async (s) => {
    const campaign = (await req(s('campaigns').get(campaignId))) as Campaign | undefined;
    if (!campaign) throw new Error(`campaign ${campaignId} not found`);
    const rows = (await req(s('rows').index('campaignId').getAll(campaignId))) as Row[];
    const templates = (await req(s('templates').index('campaignId').getAll(campaignId))) as Template[];
    const journal = (await req(s('journal').index('campaignId').getAll(campaignId))) as JournalEvent[];
    const recipes = (await req(s('recipes').getAll())) as Recipe[];
    return { campaign, rows, templates, journal, recipes };
  });

  const files: Record<string, Uint8Array> = {};
  const assets: CampaignBundle['assets'] = {};
  let total = 0;
  for (const ref of referencedAssets(snapshot.campaign, snapshot.rows)) {
    // A file cell holds the asset name (what the UI tells users to type) or its sha256.
    const asset = await findAsset(ref);
    if (asset === 'ambiguous')
      throw new Error(`several files are named "${ref}" — put the sha256 into the cell before exporting`);
    if (!asset) continue;
    const sha = asset.sha256;
    if (assets[sha]) continue;
    total += asset.size;
    if (total > MAX_ASSET_BYTES)
      throw new Error(`assets exceed ${MAX_ASSET_BYTES / 1024 / 1024} MB — export without assets`);
    assets[sha] = {
      name: asset.name,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      size: asset.size,
      createdAt: asset.createdAt,
    };
    files[`assets/${sha}.${extFor(asset)}`] = new Uint8Array(asset.bytes);
  }

  const bundle: CampaignBundle = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...snapshot,
    journal: [...snapshot.journal].sort((a, b) => a.seq - b.seq),
    assets,
  };
  files['campaign.json'] = strToU8(JSON.stringify(bundle, null, 2));
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export interface ImportResult {
  campaignId: string;
  rows: number;
  templates: number;
  journal: number;
  recipes: number;
  assets: number;
  missingAssets: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Structural + referential checks; throws with a readable reason. No side effects. */
export function validateBundle(raw: unknown): CampaignBundle {
  if (!isRecord(raw)) throw new Error('campaign.json is not an object');
  if (raw.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  const campaign = raw.campaign;
  if (!isRecord(campaign) || !isStr(campaign.id) || !Array.isArray(campaign.columns) || !Array.isArray(campaign.steps))
    throw new Error('campaign.json: invalid campaign');
  const cid = campaign.id;
  const rows = Array.isArray(raw.rows) ? raw.rows : null;
  const templates = Array.isArray(raw.templates) ? raw.templates : null;
  const journal = Array.isArray(raw.journal) ? raw.journal : null;
  const recipes = Array.isArray(raw.recipes) ? raw.recipes : [];
  if (!rows || !templates || !journal) throw new Error('campaign.json: rows, templates and journal must be arrays');
  const rowIds = new Set<string>();
  for (const r of rows) {
    if (!isRecord(r) || !isStr(r.rowId) || r.campaignId !== cid || !isStr(r.seedKey))
      throw new Error('campaign.json: invalid row');
    if (rowIds.has(r.rowId)) throw new Error(`campaign.json: duplicate rowId ${r.rowId}`);
    rowIds.add(r.rowId);
  }
  for (const t of templates)
    if (!isRecord(t) || !isStr(t.id) || t.campaignId !== cid) throw new Error('campaign.json: invalid template');
  const seqs = new Set<number>();
  for (const e of journal) {
    if (!isRecord(e) || !isStr(e.id) || !isStr(e.rowId) || typeof e.seq !== 'number')
      throw new Error('campaign.json: invalid journal event');
    if (!rowIds.has(e.rowId)) throw new Error(`campaign.json: journal event ${e.id} points at unknown row`);
    if (seqs.has(e.seq)) throw new Error(`campaign.json: duplicate seq ${e.seq}`);
    seqs.add(e.seq);
  }
  for (const r of recipes)
    if (!isRecord(r) || !isStr(r.id) || !isRecord(r.key)) throw new Error('campaign.json: invalid recipe');
  const assets = isRecord(raw.assets) ? raw.assets : {};
  for (const [sha, meta] of Object.entries(assets)) {
    if (!/^[0-9a-f]{64}$/.test(sha) || !isRecord(meta) || !isStr(meta.name) || !isStr(meta.mime))
      throw new Error(`campaign.json: invalid asset ${sha}`);
  }
  return raw as unknown as CampaignBundle;
}

/**
 * Restore a backup. Validation first (no writes), then assets (content-addressed, idempotent),
 * then ONE transaction replacing the campaign subgraph with the same id. Events keep their seq.
 */
export async function importCampaignZip(blob: Blob): Promise<ImportResult> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const json = entries['campaign.json'];
  if (!json) throw new Error('campaign.json missing in backup');
  const bundle = validateBundle(JSON.parse(strFromU8(json)));

  // Assets: verify the hash BEFORE storing anything; a mismatch is reported, never written.
  const missingAssets: string[] = [];
  let assetCount = 0;
  let total = 0;
  for (const [sha, meta] of Object.entries(bundle.assets ?? {})) {
    const entryName = Object.keys(entries).find((k) => k.startsWith(`assets/${sha}.`));
    const bytes = entryName ? entries[entryName] : undefined;
    if (!bytes) {
      missingAssets.push(sha);
      continue;
    }
    total += bytes.byteLength;
    if (total > MAX_ASSET_BYTES) throw new Error('backup assets exceed the size limit');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if ((await sha256Hex(buffer)) !== sha) {
      missingAssets.push(sha);
      continue;
    }
    await putAsset(
      new Blob([bytes as BlobPart], { type: meta.mime }),
      meta.name,
      meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined,
      meta.createdAt,
    );
    assetCount++;
  }

  const maxSeq = bundle.journal.reduce((m, e) => Math.max(m, e.seq), 0);
  await runTx(['campaigns', 'rows', 'templates', 'journal', 'recipes', 'settings'], 'readwrite', async (s) => {
    await deleteCampaignSubgraph(s, bundle.campaign.id);
    await req(s('campaigns').put(bundle.campaign));
    for (const r of bundle.rows) await req(s('rows').put(r));
    for (const t of bundle.templates) await req(s('templates').put(t));
    for (const e of bundle.journal) await req(s('journal').put({ ...e, campaignId: bundle.campaign.id }));
    for (const r of bundle.recipes ?? []) await req(s('recipes').put(r));
    await bumpSeq(s, maxSeq);
  });

  return {
    campaignId: bundle.campaign.id,
    rows: bundle.rows.length,
    templates: bundle.templates.length,
    journal: bundle.journal.length,
    recipes: bundle.recipes?.length ?? 0,
    assets: assetCount,
    missingAssets,
  };
}
