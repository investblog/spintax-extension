/**
 * Minimal XLSX reader — values only (shared strings, inline strings, numbers, booleans, dates),
 * enough for a recipient list. XLSX is a ZIP of XML; fflate is already bundled for backups, so
 * this stays ~150 lines instead of a ~1 MB spreadsheet library (ADR 0011 p.1: XLSX in R0).
 */
import { strFromU8, unzipSync } from 'fflate';

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Text of a <si> or <is>: concatenates all <t> runs. */
function richText(xml: string): string {
  return Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (m) => decodeXml(m[1] ?? '')).join('');
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g), (m) => richText(m[1] ?? ''));
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial date → ISO date (1900 system, with the Lotus leap-year bug). */
function serialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86_400_000);
  const d = new Date(ms);
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

/** Style ids whose numFmt looks like a date — a cheap heuristic over styles.xml. */
function dateStyleIds(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g))
    custom.set(Number(m[1]), m[2] ?? '');
  const xfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const builtinDate = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*numFmtId="(\d+)"[^>]*>/g)) {
    const id = Number(m[1]);
    const code = custom.get(id) ?? '';
    if (builtinDate.has(id) || /[ymd]{2,}|h{1,2}:m{1,2}/i.test(code.replace(/\[[^\]]*\]/g, ''))) out.add(i);
    i++;
  }
  return out;
}

function parseSheet(xml: string, shared: string[], dateStyles: Set<number>): { headers: string[]; rows: string[][] } {
  const grid: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of (rowMatch[1] ?? '').matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const inner = c[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? '';
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? '-1');
      const idx = ref ? colIndex(ref) : cells.length;
      let value = '';
      if (type === 's') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = v !== undefined ? (shared[Number(v)] ?? '') : '';
      } else if (type === 'inlineStr') value = richText(inner);
      else if (type === 'b') value = inner.includes('<v>1</v>') ? 'TRUE' : 'FALSE';
      else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) {
          const text = decodeXml(v);
          value =
            type === 'str' || type === 'e'
              ? text
              : dateStyles.has(style) && /^-?\d+(\.\d+)?$/.test(text)
                ? serialToIso(Number(text))
                : /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(text)
                  ? String(Number(Number(text).toPrecision(15))) // 8.4749999999999996 → 8.475 (Excel's 15 digits)
                  : text;
        }
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    grid.push(cells);
  }
  const nonEmpty = grid.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  const width = headers.length;
  const rows = nonEmpty.map((r) => {
    const out = r.slice(0, width).map((c) => (c ?? '').trim());
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows };
}

export function parseXlsx(bytes: ArrayBuffer | Uint8Array): XlsxSheet[] {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const text = (name: string): string | undefined => (files[name] ? strFromU8(files[name] as Uint8Array) : undefined);
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('not an xlsx: xl/workbook.xml missing');
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const relTargets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
    relTargets.set(m[1] as string, m[2] as string);
  for (const m of rels.matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g))
    if (!relTargets.has(m[2] as string)) relTargets.set(m[2] as string, m[1] as string);
  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = dateStyleIds(text('xl/styles.xml'));
  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1] ?? '';
    const name = decodeXml(attrs.match(/\bname="([^"]*)"/)?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = attrs.match(/\br:id="([^"]+)"/)?.[1] ?? attrs.match(/\bid="([^"]+)"/)?.[1];
    const target = (rid && relTargets.get(rid)) ?? `worksheets/sheet${sheets.length + 1}.xml`;
    const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
    const xml = text(path);
    if (!xml) continue;
    const { headers, rows } = parseSheet(xml, shared, dateStyles);
    sheets.push({ name, headers, rows });
  }
  return sheets;
}
