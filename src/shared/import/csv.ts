/**
 * CSV / TSV parsing — RFC 4180 with delimiter auto-detection and byte decoding
 * (BOM → UTF-8 / UTF-16; otherwise strict UTF-8, then windows-1251). docs/data-model.md §7.1.
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [',', ';', '\t', '|'];

/** Pick the delimiter that yields the most consistent column count over the first lines. */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 20);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === d && !inQuotes) n++;
  }
  return n;
}

export function parseCsv(text: string, opts: { delimiter?: string } = {}): ParsedTable {
  const src = text.replace(/^﻿/, '');
  const delimiter = opts.delimiter ?? detectDelimiter(src);
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  const width = headers.length;
  const rows = nonEmpty.map((r) => {
    const out = r.slice(0, width).map((c) => c.trim());
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows, delimiter };
}

/** Decode raw bytes: BOM first; then strict UTF-8; then windows-1251 (the common CP for RU/UK CSV). */
export function decodeBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf)
    return new TextDecoder('utf-8').decode(u8.subarray(3));
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    try {
      return new TextDecoder('windows-1251').decode(u8);
    } catch {
      return new TextDecoder('utf-8').decode(u8);
    }
  }
}
