/**
 * Queue ordering and "is this row work today" — pure, shared by the side panel and the list
 * filters (spec §7: due follow-ups and due deferrals return to the SAME queue as work).
 */
import { t } from './i18n';
import type { Row } from './model';

const ORDER: Record<Row['deliveryStatus'], number> = {
  filled_unconfirmed: 0,
  not_started: 1,
  deferred: 2,
  sent: 3,
  not_sent: 4,
  replied: 5,
  declined: 6,
  not_applicable: 7,
};

/** A follow-up step whose date has come. */
export function followupDue(r: Row, now = new Date()): boolean {
  return r.followupState === 'due' && !!r.followupDueAt && new Date(r.followupDueAt) <= now;
}

/** A deferred row whose date has come. */
export function deferralDue(r: Row, now = new Date()): boolean {
  return r.deliveryStatus === 'deferred' && !!r.deferredUntil && new Date(r.deferredUntil) <= now;
}

/** "Due today": a follow-up or a deferral that has come back into the queue. */
export function isDue(r: Row, now = new Date()): boolean {
  return followupDue(r, now) || deferralDue(r, now);
}

/** Work first, done last; due follow-ups count as work. */
export function sortQueue(rows: Row[], now = new Date()): Row[] {
  const rank = (r: Row): number => (isDue(r, now) ? 1 : ORDER[r.deliveryStatus]);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.seedKey.localeCompare(b.seedKey));
}

export function isWork(r: Row, now = new Date()): boolean {
  if (r.deliveryStatus === 'not_started' || r.deliveryStatus === 'filled_unconfirmed') return true;
  return isDue(r, now);
}

/** The step to act on: current follow-up step when due, else the row's current step. */
export function stepFor(row: Row): number {
  return Math.max(1, row.currentStep);
}

/** ISO date N days from `from` — the "defer" outcome. */
export function deferUntil(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export type QueueFilter = 'all' | 'todo' | 'due' | 'done' | 'problems';

/** The label resolves on read: counting uses the ids only, so nothing asks browser.i18n for a caption
 *  that is never drawn (this module is pure logic shared with the queue). */
export const QUEUE_FILTERS: { id: QueueFilter; label: string }[] = [
  {
    id: 'all',
    get label() {
      return t('filterAll');
    },
  },
  {
    id: 'todo',
    get label() {
      return t('filterTodo');
    },
  },
  {
    id: 'due',
    get label() {
      return t('filterDue');
    },
  },
  {
    id: 'done',
    get label() {
      return t('filterDone');
    },
  },
  {
    id: 'problems',
    get label() {
      return t('filterProblems');
    },
  },
];

export function matchesFilter(r: Row, filter: QueueFilter, now = new Date()): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'todo':
      return isWork(r, now);
    case 'due':
      return isDue(r, now);
    case 'done':
      return !isWork(r, now) && r.deliveryStatus !== 'not_sent';
    case 'problems':
      return r.deliveryStatus === 'not_sent';
  }
}

export function filterCounts(rows: Row[], now = new Date()): Record<QueueFilter, number> {
  const counts = { all: 0, todo: 0, due: 0, done: 0, problems: 0 };
  for (const r of rows) for (const f of QUEUE_FILTERS) if (matchesFilter(r, f.id, now)) counts[f.id]++;
  return counts;
}
