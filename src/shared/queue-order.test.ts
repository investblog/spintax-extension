import { describe, expect, it } from 'vitest';
import type { Row } from './model';
import { deferUntil, filterCounts, isWork, matchesFilter, sortQueue } from './queue-order';

const base = (patch: Partial<Row>): Row =>
  ({
    rowId: 'r',
    campaignId: 'c',
    seedKey: 'a.com',
    target: 'a.com',
    targetKind: 'url',
    values: {},
    overrides: {},
    deliveryStatus: 'not_started',
    reviewState: 'unreviewed',
    followupState: 'none',
    currentStep: 1,
    salt: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...patch,
  }) as Row;

const NOW = new Date('2026-08-23T12:00:00Z');

describe('deferUntil', () => {
  it('adds whole days to the given moment', () => {
    expect(deferUntil(3, new Date('2026-08-23T12:00:00Z'))).toBe('2026-08-26T12:00:00.000Z');
    expect(deferUntil(0, new Date('2026-08-23T12:00:00Z'))).toBe('2026-08-23T12:00:00.000Z');
  });
});

describe('queue order + filters (spec §7)', () => {
  it('a due follow-up is work and "due today"; a future one is done for now', () => {
    const due = base({
      deliveryStatus: 'sent',
      followupState: 'due',
      followupDueAt: '2026-08-23T00:00:00Z',
      currentStep: 2,
    });
    const later = base({
      seedKey: 'b.com',
      deliveryStatus: 'sent',
      followupState: 'due',
      followupDueAt: '2026-08-30T00:00:00Z',
      currentStep: 2,
    });
    expect(isWork(due, NOW)).toBe(true);
    expect(isWork(later, NOW)).toBe(false);
    expect(matchesFilter(due, 'due', NOW)).toBe(true);
    expect(matchesFilter(later, 'done', NOW)).toBe(true);
  });
  it('counts every filter; problems are not_sent rows; deferred-until-today is due', () => {
    const rows = [
      base({ seedKey: 'a.com' }),
      base({ seedKey: 'b.com', deliveryStatus: 'not_sent', failureReason: 'captcha' }),
      base({ seedKey: 'c.com', deliveryStatus: 'deferred', deferredUntil: '2026-08-22T00:00:00Z' }),
      base({ seedKey: 'd.com', deliveryStatus: 'replied', followupState: 'stopped' }),
    ];
    expect(filterCounts(rows, NOW)).toEqual({ all: 4, todo: 2, due: 1, done: 1, problems: 1 });
  });
  it('sorts work first: unconfirmed, then not started and due rows, done last', () => {
    const rows = [
      base({ seedKey: 'z.com', deliveryStatus: 'sent', followupState: 'done' }),
      base({ seedKey: 'y.com', deliveryStatus: 'sent', followupState: 'due', followupDueAt: '2026-08-20T00:00:00Z' }),
      base({ seedKey: 'x.com' }),
      base({ seedKey: 'w.com', deliveryStatus: 'filled_unconfirmed' }),
    ];
    expect(sortQueue(rows, NOW).map((r) => r.seedKey)).toEqual(['w.com', 'x.com', 'y.com', 'z.com']);
  });
});
