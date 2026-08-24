import { describe, expect, it } from 'vitest';
import { describeEvent } from './journal-text';
import type { JournalEvent } from './model';

const base = (patch: Partial<JournalEvent>): JournalEvent =>
  ({
    id: 'e',
    seq: 1,
    rowId: 'r',
    campaignId: 'c',
    step: 1,
    event: 'sent',
    engineVersion: '0.6.1',
    salt: 0,
    at: '2026-08-23T10:00:00.000Z',
    ...patch,
  }) as JournalEvent;

describe('describeEvent', () => {
  it('reads like a sentence for each kind', () => {
    expect(describeEvent(base({}))).toBe('08/23/2026 · sent · step 1');
    expect(describeEvent(base({ event: 'deferred', until: '2026-08-26T00:00:00.000Z' }))).toBe(
      '08/23/2026 · deferred · until 08/26/2026 · step 1',
    );
    expect(describeEvent(base({ event: 'failed', reason: 'no_form' }))).toBe(
      '08/23/2026 · not sent · no form · step 1',
    );
    expect(describeEvent(base({ event: 'reviewed', reviewState: 'approved' }))).toBe(
      '08/23/2026 · reviewed · approved · step 1',
    );
    expect(describeEvent(base({ event: 'translated', step: 2, ai: { api: 'Translator' } }))).toBe(
      '08/23/2026 · translated · step 2 · AI: Translator',
    );
  });
});
