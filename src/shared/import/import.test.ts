import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createCampaign, makeRow } from '../repo';
import { decodeBytes, detectDelimiter, parseCsv } from './csv';
import {
  buildColumns,
  ensureHeaders,
  guessRole,
  matchColumns,
  mergeColumns,
  normalizeCell,
  planImport,
  resolveConflict,
  summarize,
  synthesizeHeader,
} from './table';
import { parseXlsx } from './xlsx';

describe('csv', () => {
  it('detects delimiters and parses quotes, CRLF, ragged rows', () => {
    const text = 'site;Имя;topic\r\n"a.com";"Анна; ред.";crypto\r\nb.io;;"multi\nline"\r\n';
    expect(detectDelimiter(text)).toBe(';');
    const t = parseCsv(text);
    expect(t.headers).toEqual(['site', 'Имя', 'topic']);
    expect(t.rows).toEqual([
      ['a.com', 'Анна; ред.', 'crypto'],
      ['b.io', '', 'multi\nline'],
    ]);
  });
  it('handles TSV pasted from Sheets and a BOM', () => {
    const t = parseCsv('﻿site\tname\na.com\tAnna\n');
    expect(t.delimiter).toBe('\t');
    expect(t.headers).toEqual(['site', 'name']);
  });
  it('decodes windows-1251 when bytes are not valid UTF-8', () => {
    const cp1251 = new Uint8Array([0xc8, 0xec, 0xff]); // "Имя"
    expect(decodeBytes(cp1251)).toBe('Имя');
    expect(decodeBytes(new TextEncoder().encode('﻿abc'))).toBe('abc');
  });
});

describe('xlsx (minimal reader)', () => {
  it('reads shared strings, inline strings, numbers and dates from two sheets', () => {
    const files: Record<string, Uint8Array> = {
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Sites" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>site</t></si><si><r><t>An</t></r><r><t>na</t></r></si><si><t>a.com</t></si></sst>',
      ),
      'xl/styles.xml': strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>name</t></is></c><c r="C1" t="inlineStr"><is><t>price</t></is></c><c r="D1" t="inlineStr"><is><t>date</t></is></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>1</v></c><c r="C2"><v>12.5</v></c><c r="D2" s="1"><v>45000</v></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>b.io</t></is></c><c r="D3"><v>1</v></c></row>' +
          '</sheetData></worksheet>',
      ),
      'xl/worksheets/sheet2.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
      ),
    };
    const sheets = parseXlsx(zipSync(files));
    expect(sheets.map((s) => s.name)).toEqual(['Sites', 'Other']);
    const s = sheets[0];
    expect(s?.headers).toEqual(['site', 'name', 'price', 'date']);
    expect(s?.rows).toEqual([
      ['a.com', 'Anna', '12.5', '2023-03-15'],
      ['b.io', '', '', '1'],
    ]);
  });
  it('rejects non-xlsx zips', () => {
    expect(() => parseXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/workbook/);
  });
});

describe('roles and columns', () => {
  it('guesses target and lang from values, never from headers', () => {
    expect(guessRole(['https://a.com', 'b.io', 'anna@c.net', '']).role).toBe('target');
    expect(guessRole(['ru', 'EN', 'de', 'ru']).role).toBe('lang');
    expect(guessRole(['crypto', 'slots', 'news']).role).toBe('none');
  });
  it('buildColumns assigns one target, one lang, unique variables', () => {
    const cols = buildColumns({
      headers: ['Website', 'Name', 'Lang', 'Email'],
      rows: [
        ['a.com', 'Anna', 'ru', 'x@a.com'],
        ['b.io', 'Bob', 'en', 'y@b.io'],
      ],
    });
    expect(cols.map((c) => c.role)).toEqual(['target', 'none', 'lang', 'none']);
    expect(cols.map((c) => c.variable)).toEqual(['website', 'name', 'lang', 'email']);
  });
});

describe('planImport (conflicts screen)', () => {
  it('splits into add / exact duplicates / conflicts / excluded and resolves per field', async () => {
    const table = {
      headers: ['site', 'name', 'topic'],
      rows: [
        ['a.com', 'Anna', 'crypto'],
        ['https://www.a.com/contact', 'Anna Petrova', ''],
        ['b.io', 'Bob', 'slots'],
        ['', 'Nobody', 'x'],
        ['b.io', 'Bob', 'slots'],
      ],
    };
    const columns = buildColumns(table);
    const campaign = await createCampaign({ name: 'T', columns });
    const [site, name, topic] = columns.map((c) => c.id) as [string, string, string];
    const existing = makeRow(campaign, {
      target: 'a.com',
      values: { [site]: 'a.com', [name]: 'Anna', [topic]: 'crypto' },
    });
    if (!existing) throw new Error('row');

    const plan = planImport(campaign, [existing], table, columns);
    expect(summarize(plan)).toEqual({ total: 5, add: 1, update: 1, mergedInFile: 0, excluded: 1, exact: 2 });
    expect(plan.add[0]?.seedKey).toBe('b.io');
    const conflict = plan.conflicts[0];
    expect(conflict?.existing.rowId).toBe(existing.rowId);
    expect(conflict?.diffs).toEqual([site, name]); // target text differs too — the user picks which URL to keep
    expect(conflict?.fillable).toEqual([]);

    if (!conflict) throw new Error('conflict');
    expect(resolveConflict(conflict, 'keep').values[name]).toBe('Anna');
    expect(resolveConflict(conflict, 'take').values[name]).toBe('Anna Petrova');
    expect(resolveConflict(conflict, { [name]: 'fillEmpty' }).values[name]).toBe('Anna');
    expect(resolveConflict(conflict, 'take').rowId).toBe(existing.rowId);
    const moved = resolveConflict(conflict, { [site]: 'take' }, site);
    expect(moved.target).toBe('https://www.a.com/contact');
    expect(moved.seedKey).toBe('a.com');
    expect(resolveConflict(conflict, 'keep', site).target).toBe('a.com');
  });
});

describe('normalizeCell', () => {
  it('decodes HTML entities left by scrapers and tidies whitespace', () => {
    expect(normalizeCell('Sony Ericsson &#8212; phones &amp; more')).toBe('Sony Ericsson — phones & more');
    expect(normalizeCell('  a\u00a0\u00a0b  ')).toBe('a b');
    expect(normalizeCell('&#x1F600; ok')).toBe('😀 ok');
  });
});

describe('header row detection (CRM exports without headers)', () => {
  // Synthetic, but shaped like the CRM export this case came from: a 6-digit id that looks like an
  // IPv4 octet run, an e-mail, a bare international phone, a handle, and free-text labels — one of
  // them with a comma inside the cell. Never put a real contact list in a fixture (spec §9): the
  // rows that were here were live addresses and phone numbers.
  const rows = [
    ['265686', 'first@example.com', '380991234567', 'first_handle', 'telegram', 'fb', 'CPA'],
    ['265712', 'second@example.net', '79001234567', 'SecondHandle', 'telegram', 'FB', 'CPA'],
    ['265747', 'third@example.org', '380661234567', 'thirdhandle', 'telegram', 'FB ADS,соц.сети', 'RS'],
    ['265788', 'fourth@example.com', '380951234567', 'fourthone', 'telegram', 'Fb', 'RS'],
  ];
  it('turns a data-looking first row into a row and names the columns by their values', () => {
    const { table, synthesized } = ensureHeaders({ headers: rows[0] as string[], rows: rows.slice(1) });
    expect(synthesized).toBe(true);
    expect(table.rows).toHaveLength(4);
    expect(table.headers).toEqual(['id', 'email', 'phone', 'handle', 'label_5', 'label_6', 'label_7']);
    // Roles by values: the e-mail column is the target, not the numeric id (IPv4 look-alike).
    const cols = buildColumns(table);
    expect(cols.map((c) => c.role)).toEqual(['none', 'target', 'none', 'none', 'none', 'none', 'none']);
    expect(cols.map((c) => c.variable)).toEqual(['id', 'email', 'phone', 'handle', 'label_5', 'label_6', 'label_7']);
  });
  it('drops a banner row above the real header (SEO exports with a © line)', () => {
    const { table, synthesized, skipped } = ensureHeaders({
      headers: ['© Someone • Telegram: @chan • https://t.me/chan', '', '', ''],
      rows: [
        ['Домен', 'Статус', 'IP', 'DR'],
        ['getjob-agency.ru', 'новый', '185.12.125.28', '1'],
        ['sonyerics.ru', 'новый', '23.88.28.211', '2'],
      ],
    });
    expect(synthesized).toBe(false);
    expect(skipped).toBe(1);
    expect(table.headers).toEqual(['Домен', 'Статус', 'IP', 'DR']);
    expect(table.rows).toHaveLength(2);
    const cols = buildColumns(table);
    expect(cols.map((c) => c.role)).toEqual(['target', 'none', 'none', 'none']); // the domain, not the IP
  });
  it('a header whose label looks like a value ("@handle") is still a header', () => {
    const { table, synthesized } = ensureHeaders({
      headers: ['@handle', 'name', 'topic'],
      rows: [
        ['@anna', 'Anna', 'crypto'],
        ['@bob', 'Bob', 'slots'],
      ],
    });
    expect(synthesized).toBe(false);
    expect(table.headers).toEqual(['@handle', 'name', 'topic']);
    expect(table.rows).toHaveLength(2);
  });
  it('matchColumns keeps existing ids: by header, by variable, and by position for a renamed header-less file', () => {
    const existing = buildColumns({ headers: ['id', 'email', 'phone'], rows: [] }).map((c, i) =>
      i === 1 ? { ...c, header: 'Contact e-mail' } : c,
    );
    // renamed header, same variable
    expect(matchColumns(existing, ['id', 'email', 'phone']).map((c) => c.id)).toEqual(existing.map((c) => c.id));
    // nothing matches but the shape is the same → positional
    expect(matchColumns(existing, ['a', 'b', 'c']).map((c) => c.id)).toEqual(existing.map((c) => c.id));
    // a different shape → new columns for unknown headers
    const mixed = matchColumns(existing, ['id', 'note']);
    expect(mixed[0]?.id).toBe(existing[0]?.id);
    expect(existing.some((c) => c.id === mixed[1]?.id)).toBe(false);
    // merge never drops an existing column
    expect(mergeColumns(existing, mixed).map((c) => c.header)).toEqual(['id', 'Contact e-mail', 'phone', 'note']);
  });
  it('keeps a real header row', () => {
    const { table, synthesized } = ensureHeaders({
      headers: ['site', 'name', 'topic'],
      rows: [['a.com', 'Anna', 'crypto']],
    });
    expect(synthesized).toBe(false);
    expect(table.headers).toEqual(['site', 'name', 'topic']);
  });
  it('synthesizeHeader: sites, languages, long texts', () => {
    expect(synthesizeHeader(['a.com', 'https://b.io/x', 'c.org'], 0)).toBe('site');
    expect(synthesizeHeader(['en', 'ru', 'de'], 3)).toBe('lang');
    expect(synthesizeHeader(['a long free-text note about the contact', 'another long note here'], 2)).toBe('text_3');
  });
});
