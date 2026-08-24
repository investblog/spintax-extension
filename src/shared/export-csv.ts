/**
 * Operational CSV export (plan step 15, spec §14.1): the user's columns plus status columns
 * prefixed with `_`. The same file imports back through the wizard: `_` columns are dropped
 * (stripMetaColumns), rows merge by key, and statuses — which live in the journal — are untouched.
 */
import type { ImportedTable } from './import/table';
import type { Campaign, Row } from './model';

export const META_HEADERS = [
  '_row_id',
  '_key',
  '_target',
  '_lang',
  '_status',
  '_reason',
  '_step',
  '_due',
  '_updated',
] as const;

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function metaValues(r: Row): string[] {
  const due =
    r.followupState === 'due' ? r.followupDueAt : r.deliveryStatus === 'deferred' ? r.deferredUntil : undefined;
  return [
    r.rowId,
    r.seedKey,
    r.target,
    r.lang ?? '',
    r.deliveryStatus,
    r.failureReason ?? '',
    String(r.currentStep),
    due ?? '',
    r.updatedAt,
  ];
}

/** UTF-8 BOM + CRLF so Excel opens it directly; comma-separated per RFC 4180. */
export function rowsToCsv(campaign: Campaign, rows: Row[]): string {
  const columns = campaign.columns;
  const header = [...columns.map((c) => c.header), ...META_HEADERS];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    const cells = [...columns.map((c) => r.values[c.id] ?? ''), ...metaValues(r)];
    lines.push(cells.map(csvEscape).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Drop OUR export metadata columns (exact names) before an import; other `_x` columns are the user's. */
export function stripMetaColumns<T extends ImportedTable>(table: T): T {
  const meta = new Set<string>(META_HEADERS);
  const keep = table.headers.map((h) => !meta.has(h.trim().toLowerCase()));
  if (keep.every(Boolean)) return table;
  return {
    ...table,
    headers: table.headers.filter((_, i) => keep[i]),
    rows: table.rows.map((r) => r.filter((_, i) => keep[i])),
  };
}

export function csvFileName(campaign: Campaign, now = new Date()): string {
  const safe =
    campaign.name
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'campaign';
  return `${safe}-${now.toISOString().slice(0, 10)}.csv`;
}
