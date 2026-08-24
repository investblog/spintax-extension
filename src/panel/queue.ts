/**
 * Queue + fill orchestration for the side panel (spec §7, §14.5, ADR 0011 p.3–6).
 * Talks to the tab through the on-demand content script; everything else is local.
 */
import { browser } from 'wxt/browser';
import { checkConstraints, isBlocking, mimeAllowed } from '@/shared/constraints';
import { ENGINE_VERSION, type RowRender, renderRow } from '@/shared/engine';
import { extUrl } from '@/shared/ext-url';
import { type FieldInfo, formSignature, originOf, resolveField, routePattern } from '@/shared/fields';
import { t } from '@/shared/i18n';
import { CORE_SLOTS, fieldConstraints, mapSlots, type RowSlotSpec, stripInfo, toRecipeFields } from '@/shared/mapping';
import type { Campaign, Profile, Recipe, RecipeField, Row, Slot, Template } from '@/shared/model';
import {
  CONTENT_SCRIPT_VERSION,
  type ContentRequest,
  type ContentResponse,
  type FillInstruction,
  type FillReportItem,
  type ScanResult,
} from '@/shared/protocol';
import {
  appendEvent,
  deleteRecipe,
  findAsset,
  findRecipes,
  findTemplate,
  getSetting,
  listRows,
  setSetting,
  upsertRecipe,
} from '@/shared/repo';

// ── Ordering (shared with the list filters) ────────────────────────────────────

import { sortQueue, stepFor } from '@/shared/queue-order';

export { isDue, isWork, sortQueue, stepFor } from '@/shared/queue-order';

// ── Persisted cursor ───────────────────────────────────────────────────────────

export async function loadCursor(campaignId: string): Promise<string | null> {
  return getSetting<string | null>(`queue:${campaignId}:rowId`, null);
}
export async function saveCursor(campaignId: string, rowId: string | null): Promise<void> {
  await setSetting(`queue:${campaignId}:rowId`, rowId);
}

// ── Templates + render ─────────────────────────────────────────────────────────

export async function templatesFor(
  campaign: Campaign,
  row: Row,
  step: number,
): Promise<{ body: Template; subject?: Template } | null> {
  const locale = row.lang ?? campaign.defaultLocale;
  const body =
    (await findTemplate(campaign.id, 'body', step, locale)) ??
    (await findTemplate(campaign.id, 'body', step, campaign.defaultLocale));
  if (!body) return null;
  const subject =
    (await findTemplate(campaign.id, 'subject', step, locale)) ??
    (await findTemplate(campaign.id, 'subject', step, campaign.defaultLocale));
  return { body, subject };
}

export async function renderFor(campaign: Campaign, row: Row): Promise<{ render: RowRender; step: number } | null> {
  const step = stepFor(row);
  const t = await templatesFor(campaign, row, step);
  if (!t) return null;
  return { render: renderRow(campaign, row, step, t), step };
}

// ── Tab + content script ───────────────────────────────────────────────────────

/**
 * Without the `tabs` permission Chrome hides `tab.url` until the origin is permitted (or
 * activeTab was granted), so url/origin are optional: unknown ≠ wrong site (ADR 0011 p.4).
 */
export interface TabInfo {
  id: number;
  url?: string;
  origin?: string;
}

/**
 * The page the panel will act on: the active http(s) tab of the current window, else the most
 * recently accessed http(s) tab. Extension pages (the panel opened as a tab, options) never count —
 * otherwise "Open target" would navigate the panel itself.
 */
export async function activeTab(): Promise<TabInfo | null> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const demoRoot = extUrl('/demo/');
  const isDemo = (t: { url?: string }): boolean => (t.url ?? '').startsWith(demoRoot);
  const isExtension = (t: { url?: string }): boolean => /^(chrome|moz|edge)-extension:/.test(t.url ?? '') && !isDemo(t);
  const isWeb = (t: { url?: string }): boolean => /^https?:\/\//.test(t.url ?? '') || isDemo(t);
  // Active tab first; an extension page (panel opened as a tab) never counts. A tab whose URL is
  // hidden (no permission yet) is still a candidate — it is exactly the page we will ask about.
  const active = tabs.find((t) => t.active && !isExtension(t));
  const recent = [...tabs]
    .filter((t) => !isExtension(t) && (isWeb(t) || t.url === undefined))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  const tab = active ?? recent;
  if (!tab?.id) return null;
  if (tab.url && !isWeb(tab)) return null;
  return { id: tab.id, url: tab.url, origin: tab.url ? originOf(tab.url) : undefined };
}

export function originPattern(origin: string): string {
  return `${origin}/*`;
}

/** The bundled demo pages live on our own origin — always reachable, never asked for. */
export const isOwnOrigin = (origin: string | undefined): boolean => !!origin && origin === originOf(extUrl('/'));

export async function hasOriginPermission(origin: string | undefined): Promise<boolean> {
  if (isOwnOrigin(origin)) return true;
  if (!origin?.startsWith('http')) return false;
  try {
    return await browser.permissions.contains({ origins: [originPattern(origin)] });
  } catch {
    return false;
  }
}

/** Must be called from a user gesture (click) — ADR 0011 p.4. */
export async function requestOriginPermission(origin: string, all = false): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: all ? ['*://*/*'] : [originPattern(origin)] });
  } catch {
    return false;
  }
}

async function send(tabId: number, msg: ContentRequest): Promise<ContentResponse> {
  return (await browser.tabs.sendMessage(tabId, msg)) as ContentResponse;
}

/** An error the panel can branch on: the message is for the user, the code is for the code. */
function contentError(code: 'no-access' | 'old-helper', message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Inject the on-demand content script once per page load and ping it. */
async function ensureContent(tabId: number): Promise<void> {
  try {
    const pong = await send(tabId, { type: 'ping' });
    if (pong.ok && pong.type === 'pong') {
      if (pong.version === CONTENT_SCRIPT_VERSION) return;
      throw contentError('old-helper', t('panelOldHelper'));
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'old-helper') throw err;
    // not injected yet
  }
  await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/fill.js'] });
  const pong = await send(tabId, { type: 'ping' });
  if (!pong.ok || pong.type !== 'pong' || pong.version !== CONTENT_SCRIPT_VERSION)
    throw contentError('no-access', t('panelNoAccess'));
}

export async function scanTab(tabId: number): Promise<ScanResult> {
  await ensureContent(tabId);
  const r = await send(tabId, { type: 'scan' });
  if (!r.ok || r.type !== 'scan') throw new Error(r.ok ? 'unexpected reply' : r.error);
  return r.result;
}

export async function highlightFields(tabId: number, fieldIds: string[]): Promise<void> {
  await send(tabId, { type: 'highlight', fieldIds });
}

export async function startPicker(tabId: number): Promise<void> {
  await ensureContent(tabId);
  await send(tabId, { type: 'pick' });
}

// ── Recipes ────────────────────────────────────────────────────────────────────

export interface ResolvedMapping {
  recipe: Recipe | null;
  fields: { slot: Slot; field: FieldInfo | null; recipeField: RecipeField; score: number }[];
  unmapped: Slot[];
  stale: boolean;
  source: 'recipe' | 'heuristic';
}

/** Slots for a campaign: the core six plus `row.<id>` for fillable columns (scenario E). */
export function slotsFor(campaign: Campaign): { slots: Slot[]; specs: RowSlotSpec[] } {
  const specs: RowSlotSpec[] = campaign.columns
    .filter((c) => c.fillable)
    .map((c) => ({ slot: `row.${c.id}` as Slot, header: c.header, type: c.type }));
  return { slots: [...CORE_SLOTS, ...specs.map((s) => s.slot)], specs };
}

/**
 * Recipe for this page when its form signature still matches and every field resolves; a
 * changed form is NOT applied partially (ADR 0011 p.6) — heuristics run instead and the recipe is
 * updated on save. Manual fields of a stale recipe are kept when they still resolve.
 */
export async function resolveMapping(
  scan: ScanResult,
  slots: Slot[] = CORE_SLOTS,
  specs: RowSlotSpec[] = [],
  opts: { ignoreRecipes?: boolean } = {},
): Promise<ResolvedMapping> {
  const route = routePattern(scan.url);
  const signature = formSignature(scan.fields);
  const recipes = opts.ignoreRecipes ? [] : await findRecipes(scan.origin, route);
  const exact = recipes.find((r) => r.key.formSignature === signature) ?? null;
  if (exact) {
    const fields = exact.fields.map((rf) => {
      const hit = resolveField(rf.fingerprint, scan.fields);
      return { slot: rf.slot, field: hit?.field ?? null, recipeField: rf, score: hit?.score ?? 0 };
    });
    const missing = fields.filter((f) => !f.field).length;
    if (missing === 0) {
      const mappedSlots = new Set(fields.map((f) => f.slot));
      return {
        recipe: exact,
        fields,
        unmapped: slots.filter((s) => !mappedSlots.has(s)),
        stale: false,
        source: 'recipe',
      };
    }
  }
  const previous = recipes[0] ?? null;
  // Pinned (manual) fields of the previous recipe come FIRST and keep their slot; heuristics
  // only fill what is left (review 2026-08-23 #10: a pinned field must survive a form change).
  const pinned: ResolvedMapping['fields'] = [];
  for (const rf of previous?.fields.filter((f) => f.manual) ?? []) {
    const hit = resolveField(rf.fingerprint, scan.fields);
    if (!hit || !slots.includes(rf.slot)) continue;
    if (pinned.some((p) => p.slot === rf.slot || p.field?.fieldId === hit.field.fieldId)) continue;
    pinned.push({ slot: rf.slot, field: hit.field, recipeField: rf, score: hit.score });
  }
  const pinnedSlots = new Set(pinned.map((p) => p.slot));
  const pinnedFields = new Set(pinned.map((p) => p.field?.fieldId));
  const { mapped, unmapped } = mapSlots(
    scan.fields.filter((f) => !pinnedFields.has(f.fieldId)),
    slots.filter((s) => !pinnedSlots.has(s)),
    specs,
  );
  const recipeFields = toRecipeFields(mapped);
  const fields = [
    ...pinned,
    ...mapped.map((m, i) => ({
      slot: m.slot,
      field: m.field,
      recipeField: recipeFields[i] as RecipeField,
      score: m.confidence,
    })),
  ];
  return { recipe: previous, fields, unmapped, stale: !!previous, source: 'heuristic' };
}

/** Drop the recipe behind a mapping (the user says it is wrong); heuristics run on the next resolve. */
export async function forgetRecipe(mapping: ResolvedMapping): Promise<void> {
  if (mapping.recipe) await deleteRecipe(mapping.recipe.id);
}

export async function saveMapping(
  scan: ScanResult,
  mapping: ResolvedMapping,
  source: Recipe['source'],
): Promise<Recipe> {
  const signature = formSignature(scan.fields);
  return upsertRecipe({
    // A recipe of another form on the same route (stale) is never overwritten — new signature, new recipe.
    id: mapping.recipe?.key.formSignature === signature ? mapping.recipe.id : undefined,
    key: {
      origin: scan.origin,
      routePattern: routePattern(scan.url),
      formSignature: signature,
      frame: '',
    },
    fields: mapping.fields.filter((f) => f.field).map((f) => f.recipeField),
    source,
  });
}

/** User pointed at a field for a slot: replace/add the manual mapping. */
export function withManualField(mapping: ResolvedMapping, slot: Slot, field: FieldInfo): ResolvedMapping {
  const rf: RecipeField = {
    slot,
    fingerprint: stripInfo(field),
    confidence: 1,
    manual: true,
    fillPolicy: field.tag === 'select' ? 'replace' : 'skipIfFilled',
    constraints: fieldConstraints(field),
  };
  const fields = mapping.fields.filter((f) => f.slot !== slot && f.field?.fieldId !== field.fieldId);
  fields.push({ slot, field, recipeField: rf, score: 1 });
  return { ...mapping, fields, unmapped: mapping.unmapped.filter((s) => s !== slot) };
}

// ── Values per slot ────────────────────────────────────────────────────────────

export function slotValues(
  campaign: Campaign,
  row: Row,
  render: RowRender,
  profile?: Profile,
): Partial<Record<Slot, string>> {
  const values: Partial<Record<Slot, string>> = {
    'profile.name': profile?.values.name ?? '',
    'profile.email': profile?.values.email ?? '',
    'profile.site': profile?.values.site ?? '',
    'profile.phone': profile?.values.phone ?? '',
    'output.subject': render.subject?.text ?? '',
    'output.body': render.body.text,
  };
  for (const c of campaign.columns) if (c.fillable) values[`row.${c.id}`] = row.values[c.id] || c.defaultValue || '';
  return values;
}

export interface FillOutcomeSummary {
  report: FillReportItem[];
  clipboardSlots: Slot[];
  /** Non-blocking problems found BEFORE filling (spec §16.3: size mismatch, missing asset). */
  warnings: string[];
}

function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Fill mapped slots; returns the report and which slots must go through the clipboard. */
export async function fillTab(
  tabId: number,
  mapping: ResolvedMapping,
  values: Partial<Record<Slot, string>>,
  fileColumns: Map<string, string> = new Map(),
  token?: string,
): Promise<FillOutcomeSummary> {
  const items: FillInstruction[] = [];
  const warnings: string[] = [];
  for (const f of mapping.fields) {
    if (!f.field) continue;
    const value = values[f.slot];
    if (value === undefined || value === '') continue;
    // Field limits are checked here, before anything reaches the page (spec §16.3, ADR 0011 p.7).
    const violations = checkConstraints(value, f.recipeField.constraints);
    const label = f.field.label ?? f.field.name ?? f.slot;
    for (const v of violations)
      warnings.push(
        v.level === 'blocking' ? t('warnConstraintBlocked', label, v.message) : t('warnConstraint', label, v.message),
      );
    if (isBlocking(violations)) continue;
    const item: FillInstruction = {
      slot: f.slot,
      fingerprint: f.recipeField.fingerprint,
      fieldId: f.field.fieldId,
      value,
      policy: f.recipeField.fillPolicy,
    };
    const columnId = f.slot.startsWith('row.') ? f.slot.slice(4) : null;
    if (columnId && fileColumns.has(columnId)) {
      const column = fileColumns.get(columnId) ?? '';
      const asset = await findAsset(value);
      if (asset === 'ambiguous') {
        warnings.push(t('warnAssetAmbiguous', column, value));
        continue;
      }
      if (!asset) {
        warnings.push(t('warnAssetMissing', column, value));
        continue;
      }
      const mime = f.recipeField.constraints.find((c) => c.kind === 'mime');
      if (mime && !mimeAllowed(asset.mime, asset.name, mime.allow)) {
        warnings.push(t('warnAssetMime', column, asset.name, asset.mime, mime.allow.join(', ')));
        continue;
      }
      const want = f.recipeField.constraints.find((c) => c.kind === 'imageSize');
      if (want && asset.width && asset.height && (asset.width !== want.width || asset.height !== want.height))
        warnings.push(
          t('warnAssetSize', column, `${want.width}×${want.height}`, asset.name, `${asset.width}×${asset.height}`),
        );
      item.file = { name: asset.name, mime: asset.mime, base64: toBase64(asset.bytes) };
    }
    items.push(item);
  }
  await ensureContent(tabId);
  const r = await send(tabId, { type: 'fill', items, token });
  if (!r.ok || r.type !== 'fill') throw new Error(r.ok ? 'unexpected reply' : r.error);
  const clipboardSlots = r.report.filter((x) => x.outcome === 'clipboard').map((x) => x.slot);
  return { report: r.report, clipboardSlots, warnings };
}

export async function recordFilled(
  row: Row,
  step: number,
  render: RowRender,
  recipe: Recipe | null,
  report: FillReportItem[],
): Promise<void> {
  await appendEvent({
    rowId: row.rowId,
    step,
    event: 'filled',
    engineVersion: ENGINE_VERSION,
    body: render.body.text,
    subject: render.subject?.text,
    recipeId: recipe?.id,
    recipeVersion: recipe?.version,
    fillReport: report.map((r) => ({ slot: r.slot, outcome: r.outcome })),
  });
}

export async function loadRows(campaignId: string): Promise<Row[]> {
  return sortQueue(await listRows(campaignId));
}
