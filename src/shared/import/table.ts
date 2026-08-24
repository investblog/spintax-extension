/**
 * From a parsed table to campaign columns and rows: role detection by VALUES (spec §14.1),
 * variable names (data-model §1), and the import plan with a conflicts screen (§8, ADR 0011 p.2).
 */
import { deriveSeedKey, detectTargetKind, variableNameFromHeader, variableNamesFromHeaders } from '../keys';
import type { Campaign, ColumnDef, Row } from '../model';
import { makeRow, uuid } from '../repo';

export interface ImportedTable {
  headers: string[];
  rows: string[][];
}

export type ColumnRole = ColumnDef['role'];

const LANG_CODES = new Set(
  'en ru de es fr it pt pt-br tr uk be pl cs sk sl bg sr hr bs nl sv da no fi et lv lt ro hu el ja ko zh zh-cn zh-tw ar he hi id vi th ms'.split(
    ' ',
  ),
);

/** Share of non-empty values in a column that satisfy `pred`. */
function ratio(values: string[], pred: (v: string) => boolean): number {
  const filled = values.filter((v) => v.trim() !== '');
  if (filled.length === 0) return 0;
  return filled.filter(pred).length / filled.length;
}

export interface RoleGuess {
  role: ColumnRole;
  confidence: number;
}

/** Guess a column's role from its values, not its header. */
export function guessRole(values: string[]): RoleGuess {
  const targetRatio = ratio(values, (v) => detectTargetKind(v) !== 'unknown');
  const langRatio = ratio(values, (v) => LANG_CODES.has(v.trim().toLowerCase()));
  if (targetRatio >= 0.6) return { role: 'target', confidence: targetRatio };
  if (langRatio >= 0.8) return { role: 'lang', confidence: langRatio };
  return { role: 'none', confidence: 1 - Math.max(targetRatio, langRatio) };
}

/**
 * Columns for a table: one `target` (the column with the highest target ratio), at most one
 * `lang`, the rest `none`. Headers that look like a key column are NOT auto-assigned — `key`
 * is derived (ADR 0006) unless the user picks a column.
 */
export function buildColumns(table: ImportedTable): ColumnDef[] {
  const variables = variableNamesFromHeaders(table.headers);
  const sample = table.rows.slice(0, 2000);
  const guesses = table.headers.map((_, i) => guessRole(sample.map((r) => r[i] ?? '')));
  let targetIdx = -1;
  let targetBest = 0;
  let langIdx = -1;
  let langBest = 0;
  guesses.forEach((g, i) => {
    if (g.role === 'target' && g.confidence > targetBest) {
      targetBest = g.confidence;
      targetIdx = i;
    }
    if (g.role === 'lang' && g.confidence > langBest) {
      langBest = g.confidence;
      langIdx = i;
    }
  });
  return table.headers.map((header, i) => ({
    id: uuid(),
    header,
    variable: variables[i] ?? `col_${i + 1}`,
    role: i === targetIdx ? 'target' : i === langIdx ? 'lang' : 'none',
    type: 'text',
    fillable: false,
  }));
}

export interface RowConflict {
  existing: Row;
  incoming: Row;
  /** Column ids whose values differ (existing non-empty vs incoming non-empty and different). */
  diffs: string[];
  /** Column ids where existing is empty and incoming has a value. */
  fillable: string[];
  /** Both rows come from the file being imported (same seedKey twice) — a merge, not an update. */
  inFile: boolean;
}

export interface ImportPlan {
  add: Row[];
  exactDuplicates: { existing: Row; incoming: Row }[];
  conflicts: RowConflict[];
  /** Input rows with no usable target. */
  excluded: { index: number; reason: 'no_target' }[];
}

/** Map table rows onto campaign columns (by column order) and produce the conflicts plan. */
export function planImport(
  campaign: Campaign,
  existing: Row[],
  table: ImportedTable,
  columns: ColumnDef[] = campaign.columns,
): ImportPlan {
  const targetCol = columns.findIndex((c) => c.role === 'target');
  const langCol = columns.findIndex((c) => c.role === 'lang');
  const keyCol = columns.findIndex((c) => c.role === 'key');
  const bySeedKey = new Map<string, Row>();
  for (const r of existing) bySeedKey.set(r.seedKey, r);

  const plan: ImportPlan = { add: [], exactDuplicates: [], conflicts: [], excluded: [] };
  const seenInFile = new Map<string, Row>();

  table.rows.forEach((cells, index) => {
    const values: Record<string, string> = {};
    columns.forEach((c, i) => {
      values[c.id] = cells[i] ?? '';
    });
    const target = targetCol >= 0 ? (cells[targetCol] ?? '') : '';
    const lang = langCol >= 0 ? cells[langCol] : undefined;
    const keyOverride = keyCol >= 0 ? cells[keyCol] : undefined;
    const incoming = makeRow(campaign, { target, values, lang }, keyOverride);
    if (!incoming) {
      plan.excluded.push({ index, reason: 'no_target' });
      return;
    }
    const inCampaign = bySeedKey.get(incoming.seedKey);
    const prior = inCampaign ?? seenInFile.get(incoming.seedKey);
    if (!prior) {
      plan.add.push(incoming);
      seenInFile.set(incoming.seedKey, incoming);
      return;
    }
    const diffs: string[] = [];
    const fillable: string[] = [];
    for (const c of columns) {
      const a = (prior.values[c.id] ?? '').trim();
      const b = (incoming.values[c.id] ?? '').trim();
      if (a === b) continue;
      if (a === '' && b !== '') fillable.push(c.id);
      else if (b !== '') diffs.push(c.id);
    }
    if (diffs.length === 0 && fillable.length === 0) plan.exactDuplicates.push({ existing: prior, incoming });
    else plan.conflicts.push({ existing: prior, incoming, diffs, fillable, inFile: !inCampaign });
  });
  return plan;
}

export type ConflictDecision = 'keep' | 'take' | 'fillEmpty';

/** Resolve a conflict into the row to store: existing identity, values per decision. */
export function resolveConflict(
  conflict: RowConflict,
  decision: ConflictDecision | Record<string, ConflictDecision>,
  targetColumnId?: string,
): Row {
  const values = { ...conflict.existing.values };
  const ids = new Set([...conflict.diffs, ...conflict.fillable]);
  for (const id of ids) {
    const d = typeof decision === 'string' ? decision : (decision[id] ?? 'keep');
    const incoming = conflict.incoming.values[id] ?? '';
    const current = values[id] ?? '';
    if (d === 'take') values[id] = incoming;
    else if (d === 'fillEmpty' && current.trim() === '') values[id] = incoming;
  }
  const next: Row = { ...conflict.existing, values, updatedAt: new Date().toISOString() };
  // Taking the new value of the target column also moves the row's target (seedKey is unchanged by
  // construction: both rows share it).
  if (targetColumnId && values[targetColumnId] !== conflict.existing.values[targetColumnId]) {
    next.target = conflict.incoming.target;
    next.targetKind = conflict.incoming.targetKind;
  }
  return next;
}

/** Summary line for the conflicts screen (wireframe 2). */
export function summarize(plan: ImportPlan): {
  total: number;
  add: number;
  update: number;
  mergedInFile: number;
  excluded: number;
  exact: number;
} {
  const mergedInFile = plan.conflicts.filter((c) => c.inFile).length;
  return {
    total: plan.add.length + plan.exactDuplicates.length + plan.conflicts.length + plan.excluded.length,
    add: plan.add.length,
    update: plan.conflicts.length - mergedInFile,
    mergedInFile,
    excluded: plan.excluded.length,
    exact: plan.exactDuplicates.length,
  };
}

/** Re-derive seedKey when the user changes roles after import (ADR 0006 rules are pure). */
export function seedKeyFor(campaign: Campaign, columns: ColumnDef[], cells: string[]): string | null {
  const targetCol = columns.findIndex((c) => c.role === 'target');
  const langCol = columns.findIndex((c) => c.role === 'lang');
  if (targetCol < 0) return null;
  return deriveSeedKey(cells[targetCol] ?? '', {
    scenario: campaign.scenario,
    lang: langCol >= 0 ? cells[langCol] : undefined,
  });
}

// ── Header row detection (lists exported from CRMs often have none) ───────────────────────────

const PHONE_RE = /^\+?[\d\s()-]{7,}$/;
const NUMBER_RE = /^\d+([.,]\d+)?$/;
const HANDLE_RE = /^@?[A-Za-z0-9_.]{4,32}$/;

/** Common column labels that the value detectors would mistake for data ("@handle", "e-mail"). */
const HEADER_WORDS = new Set(
  'handle handles username user login nick email e-mail mail site url website domain host phone tel telephone mobile id key lang language домен сайт почта телефон имя ссылка логин ник хэндл'.split(
    ' ',
  ),
);
const isHeaderWord = (cell: string): boolean =>
  HEADER_WORDS.has(
    cell
      .trim()
      .toLowerCase()
      .replace(/^[@#%$]+|[@#%$:]+$/g, ''),
  );

/** A cell that is a value, not a name: e-mail, site, handle, phone, number/metric. */
function looksLikeValue(cell: string): boolean {
  const v = cell.trim();
  if (!v) return false;
  if (isHeaderWord(v)) return false;
  return detectTargetKind(v) !== 'unknown' || PHONE_RE.test(v) || NUMBER_RE.test(v);
}

/**
 * Is this row a header row? All its non-empty cells are names (no values), it is at least half
 * filled, and none of its cells repeats as a value in its own column below ("telegram" over a
 * column of "telegram" is data).
 */
function isHeaderRow(row: string[], below: string[][], width: number): boolean {
  const filled = row.filter((c) => c.trim() !== '');
  if (filled.length < Math.max(2, Math.ceil(width / 2))) return false;
  if (filled.some(looksLikeValue)) return false;
  const sample = below.slice(0, 200);
  return !row.some((cell, i) => {
    const v = cell.trim().toLowerCase();
    return v !== '' && sample.some((r) => (r[i] ?? '').trim().toLowerCase() === v);
  });
}

/** A short English name for a column from its values (used when the file has no header row). */
export function synthesizeHeader(values: string[], index: number): string {
  const filled = values
    .slice(0, 2000)
    .map((v) => v.trim())
    .filter(Boolean);
  if (filled.length === 0) return `col_${index + 1}`;
  const r = (pred: (v: string) => boolean): number => filled.filter(pred).length / filled.length;
  const distinct = new Set(filled.map((v) => v.toLowerCase())).size / filled.length;
  if (r((v) => detectTargetKind(v) === 'email') >= 0.6) return 'email';
  if (r((v) => detectTargetKind(v) === 'url') >= 0.6) return 'site';
  if (r((v) => detectTargetKind(v) === 'handle') >= 0.6) return 'handle';
  if (r((v) => PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 7) >= 0.6) return 'phone';
  if (r((v) => NUMBER_RE.test(v)) >= 0.8) return distinct > 0.8 ? 'id' : `number_${index + 1}`;
  if (r((v) => LANG_CODES.has(v.toLowerCase())) >= 0.8) return 'lang';
  if (r((v) => HANDLE_RE.test(v)) >= 0.8 && distinct > 0.8) return 'handle';
  // A few repeated values (channel, role, tag): a category column — works for small samples too.
  const distinctCount = new Set(filled.map((v) => v.toLowerCase())).size;
  if (filled.length >= 3 && distinctCount <= Math.max(3, filled.length * 0.2)) return `label_${index + 1}`;
  if (r((v) => /\s/.test(v) && v.length > 20) >= 0.5) return `text_${index + 1}`;
  return `col_${index + 1}`;
}

/**
 * Find the header row among the first rows: exports often carry a banner/title row (one merged
 * cell) above the real headers — those rows are dropped. When no row qualifies (the first row is
 * already data: e-mails, phones, ids…), every row is data and names are guessed per column. The
 * user renames them in step 2 — the guess only has to be good enough to read.
 */
export function ensureHeaders(table: ImportedTable): { table: ImportedTable; synthesized: boolean; skipped: number } {
  const width = table.headers.length;
  if (width === 0) return { table, synthesized: false, skipped: 0 };
  const all = [table.headers, ...table.rows];
  const limit = Math.min(10, all.length - 1);
  for (let i = 0; i <= limit; i++) {
    const row = all[i] ?? [];
    if (isHeaderRow(row, all.slice(i + 1), width))
      return { table: { headers: row, rows: all.slice(i + 1) }, synthesized: false, skipped: i };
  }
  const taken = new Set<string>();
  const names = table.headers.map((_, i) => {
    const base = synthesizeHeader(
      all.map((r) => r[i] ?? ''),
      i,
    );
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base}_${n++}`;
    taken.add(name);
    return name;
  });
  return { table: { headers: names, rows: all }, synthesized: true, skipped: 0 };
}

// ── Cell normalisation ────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Source lists carry HTML entities from scrapers ("Sony &#8212; phones", "&amp;") — a template
 * must never paste them verbatim. Also trims and collapses inner whitespace runs.
 */
export function normalizeCell(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n: string) => NAMED_ENTITIES[n] ?? '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

export function normalizeTable<T extends ImportedTable>(table: T): T {
  return { ...table, headers: table.headers.map(normalizeCell), rows: table.rows.map((r) => r.map(normalizeCell)) };
}

// ── Helpers shared by the wizard and the "add rows" drawer ─────────────────────────────────

/**
 * When the campaign already has columns, map incoming headers onto them: by header name, then by
 * variable name (a renamed header usually keeps its variable), and — when nothing matches but the
 * shape is the same (a header-less file loaded again after its guessed names were renamed) — by
 * position. Existing column ids are what every stored row refers to; a new id means lost values.
 */
export function matchColumns(existing: ColumnDef[], headers: string[]): ColumnDef[] {
  const norm = (s: string): string => s.trim().toLowerCase();
  const byHeader = new Map(existing.map((c) => [norm(c.header), c]));
  const byVariable = new Map(existing.map((c) => [c.variable.toLowerCase(), c]));
  const fresh = buildColumns({ headers, rows: [] });
  const direct = headers.map((h) => byHeader.get(norm(h)) ?? byVariable.get(variableNameFromHeader(h)) ?? null);
  const sameShape = !direct.some(Boolean) && headers.length === existing.length;
  return headers.map((_, i) => direct[i] ?? (sameShape ? (existing[i] as ColumnDef) : (fresh[i] as ColumnDef)));
}

/** Existing columns stay (rows refer to their ids); incoming ones are updated in place or appended. */
export function mergeColumns(existing: ColumnDef[], incoming: ColumnDef[]): ColumnDef[] {
  const known = new Set(existing.map((c) => c.id));
  return [
    ...existing.map((c) => incoming.find((x) => x.id === c.id) ?? c),
    ...incoming.filter((c) => !known.has(c.id)),
  ];
}

/** Per-column decisions for one conflict: the user's choices, else fill empty cells and keep the rest. */
export function decisionsFor(
  conflict: RowConflict,
  decisions: Map<string, ConflictDecision>,
): Record<string, ConflictDecision> {
  const out: Record<string, ConflictDecision> = {};
  for (const id of [...conflict.diffs, ...conflict.fillable])
    out[id] =
      decisions.get(`${conflict.existing.rowId}:${id}`) ?? (conflict.fillable.includes(id) ? 'fillEmpty' : 'keep');
  return out;
}
