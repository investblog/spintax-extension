import { describe, expect, it } from 'vitest';
import { csvEscape, rowsToCsv, stripMetaColumns } from './export-csv';
import { parseCsv } from './import/csv';
import { buildColumns, planImport } from './import/table';
import type { Row } from './model';
import { createCampaign, makeRow } from './repo';

describe('CSV export / import round-trip (step 15)', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a, b')).toBe('"a, b"');
    expect(csvEscape('say "hi"\nthere')).toBe('"say ""hi""\nthere"');
  });

  it('exports user columns + _meta, and importing the file back yields only exact duplicates', async () => {
    const campaign = await createCampaign({ name: 'Round trip' });
    const table = {
      headers: ['site', 'name'],
      rows: [
        ['a.com', 'Anna, PR'],
        ['b.io', 'Bob'],
      ],
    };
    campaign.columns = buildColumns(table);
    const [site, name] = campaign.columns.map((c) => c.id) as [string, string];
    const rows = table.rows
      .map((cells) =>
        makeRow(campaign, { target: cells[0] ?? '', values: { [site]: cells[0] ?? '', [name]: cells[1] ?? '' } }),
      )
      .filter((r): r is Row => r !== null);
    // Pretend the first row was sent and is waiting for step 2.
    const sent = rows[0];
    if (!sent) throw new Error('row');
    sent.deliveryStatus = 'sent';
    sent.followupState = 'due';
    sent.followupDueAt = '2026-08-30T00:00:00.000Z';
    sent.currentStep = 2;

    const csv = rowsToCsv(campaign, rows);
    expect(csv.startsWith('﻿')).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual([
      'site',
      'name',
      '_row_id',
      '_key',
      '_target',
      '_lang',
      '_status',
      '_reason',
      '_step',
      '_due',
      '_updated',
    ]);
    expect(parsed.rows[0]?.slice(0, 2)).toEqual(['a.com', 'Anna, PR']);
    expect(parsed.rows[0]?.[2]).toBe(sent.rowId);
    expect(parsed.rows[0]?.[6]).toBe('sent');
    expect(parsed.rows[0]?.[8]).toBe('2');
    expect(parsed.rows[0]?.[9]).toBe('2026-08-30T00:00:00.000Z');

    const stripped = stripMetaColumns(parsed);
    expect(stripped.headers).toEqual(['site', 'name']);
    // A user's own "_source" column is not ours and survives.
    expect(stripMetaColumns({ headers: ['site', '_source', '_key'], rows: [['a.com', 'x', 'k']] })).toEqual({
      headers: ['site', '_source'],
      rows: [['a.com', 'x']],
    });
    const plan = planImport(campaign, rows, stripped, campaign.columns);
    expect(plan.add).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.exactDuplicates).toHaveLength(2);
  });
});
