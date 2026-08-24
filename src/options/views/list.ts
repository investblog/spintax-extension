/** List view — rows of the current campaign with status badges (wireframe 1, right pane). */
import { clear, h } from '@/shared/dom';
import { csvFileName, rowsToCsv } from '@/shared/export-csv';
import { extUrl } from '@/shared/ext-url';
import { originOf } from '@/shared/fields';
import { formatDay, type MessageKey, t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Campaign, DeliveryStatus, FailureReason, Row } from '@/shared/model';
import { filterCounts, followupDue, matchesFilter, QUEUE_FILTERS, type QueueFilter } from '@/shared/queue-order';
import { listRows } from '@/shared/repo';
import { targetLabel } from '@/shared/target-label';
import { downloadBlob } from '../download';
import { openRowDrawer } from '../row-drawer';
import { columnsEditor } from './columns';
import { stepsEditor } from './steps';

const STATUS_BADGE: Record<DeliveryStatus, { key: MessageKey; cls: string }> = {
  not_started: { key: 'statusNotStarted', cls: 'badge--neutral' },
  filled_unconfirmed: { key: 'statusFilledUnconfirmed', cls: 'badge--warning' },
  sent: { key: 'statusSent', cls: 'badge--success' },
  deferred: { key: 'statusDeferred', cls: 'badge--warning' },
  not_sent: { key: 'statusNotSent', cls: 'badge--danger' },
  not_applicable: { key: 'statusNotApplicable', cls: 'badge--neutral' },
  replied: { key: 'statusReplied', cls: 'badge--primary' },
  declined: { key: 'statusDeclined', cls: 'badge--danger' },
};

/** The enum is the storage value; the caption is a table, never `replace('_', ' ')` on the code. */
const FAILURE_LABEL: Record<FailureReason, MessageKey> = {
  no_form: 'failNoForm',
  captcha: 'failCaptcha',
  no_contact: 'failNoContact',
  technical: 'failTechnical',
};

/**
 * Each qualifier wraps the badge text as a whole sentence (`$STATUS$ until $DATE$`) instead of
 * appending a tail: German and Russian put the date and the step in another order.
 */
export function statusBadge(row: Row, now = new Date()): HTMLElement {
  const s = STATUS_BADGE[row.deliveryStatus];
  let text = t(s.key);
  if (row.deliveryStatus === 'not_sent' && row.failureReason)
    text = t('listBadgeReason', text, t(FAILURE_LABEL[row.failureReason]));
  let cls = s.cls;
  if (row.deliveryStatus === 'deferred' && row.deferredUntil)
    text = t('listBadgeUntil', text, formatDay(row.deferredUntil));
  if (row.followupState === 'due' && row.followupDueAt) {
    const due = followupDue(row, now);
    text = t(due ? 'listBadgeStepDue' : 'listBadgeStepOn', text, String(row.currentStep), formatDay(row.followupDueAt));
    if (due) cls = 'badge--warning';
  }
  return h('span', { class: `badge badge--sm ${cls}` }, text);
}

let currentFilter: QueueFilter = 'all';
/** Page survives the re-render after a drawer write (notify()), like the filter does. */
let page = 0;
/** Rows per page — measured 2026-08-23: a 5 000-row table costs ~2 s to paint, 50 rows is instant. */
const PAGE_SIZE = 50;

export async function renderList(root: HTMLElement, campaign: Campaign): Promise<void> {
  clear(root);
  const now = new Date();
  const ownOrigin = originOf(extUrl('/'));
  const rows = (await listRows(campaign.id)).sort((a, b) => a.seedKey.localeCompare(b.seedKey));
  performance.mark('list:rows');
  const visible = campaign.columns.filter((c) => !c.hidden && c.role !== 'target' && c.role !== 'lang');
  const counts = filterCounts(rows, now);
  const table = h('div', { class: 'table-scroll' });
  const filters = h('div', { class: 'list__filters', role: 'group', 'aria-label': t('listFilterRows') });
  const pager = h('div', { class: 'pagination' });

  const drawTable = (): void => {
    clear(table);
    clear(pager);
    const all = rows.filter((r) => matchesFilter(r, currentFilter, now));
    if (all.length === 0) {
      table.append(h('p', { class: 'muted' }, t('listEmpty')));
      return;
    }
    const pages = Math.ceil(all.length / PAGE_SIZE);
    page = Math.min(page, pages - 1);
    const shown = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (pages > 1) {
      const go = (delta: number): void => {
        page = Math.max(0, Math.min(pages - 1, page + delta));
        drawTable();
      };
      pager.append(
        h(
          'span',
          { class: 'pagination__info' },
          // One sentence, not "Showing " + range + " of " + total: the parts move in translation.
          tn(all.length, 'listShowing', `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + shown.length}`),
        ),
        h(
          'div',
          { class: 'pagination__controls' },
          h(
            'button',
            { type: 'button', class: 'btn btn--sm btn--ghost', disabled: page === 0, onclick: () => go(-1) },
            t('listPrevious'),
          ),
          h(
            'button',
            { type: 'button', class: 'btn btn--sm btn--ghost', disabled: page >= pages - 1, onclick: () => go(1) },
            t('listNext'),
          ),
        ),
      );
    }
    table.append(
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, t('listColKey')),
            h('th', {}, t('listColTarget')),
            h('th', {}, t('listColStatus')),
            h('th', {}, t('listColLang')),
            ...visible.map((c) => h('th', {}, c.header)),
          ),
        ),
        h(
          'tbody',
          {},
          ...shown.map((r) =>
            h(
              'tr',
              {
                class: 'list__row',
                tabindex: '0',
                title: t('listOpenRow'),
                onclick: () => void openRowDrawer(campaign, r.rowId),
                onkeydown: (e: Event) => {
                  if ((e as KeyboardEvent).key === 'Enter') void openRowDrawer(campaign, r.rowId);
                },
              },
              h('td', { class: 'cell-key' }, r.seedKey),
              h(
                'td',
                { class: 'cell-target', title: r.target },
                targetLabel(
                  r.target,
                  r.targetKind === 'url'
                    ? /^[a-z][a-z0-9+.-]*:\/\//i.test(r.target)
                      ? r.target
                      : `https://${r.target}`
                    : null,
                  ownOrigin,
                ),
              ),
              h('td', {}, statusBadge(r, now)),
              h('td', {}, r.lang ?? ''),
              ...visible.map((c) => h('td', {}, r.values[c.id] ?? '')),
            ),
          ),
        ),
      ),
    );
  };
  const drawFilters = (): void => {
    clear(filters);
    for (const f of QUEUE_FILTERS)
      filters.append(
        h(
          'button',
          {
            type: 'button',
            class: `btn-chip btn-chip--sm${currentFilter === f.id ? ' chip--ok' : ''}`,
            'aria-pressed': String(currentFilter === f.id),
            onclick: () => {
              currentFilter = f.id;
              page = 0;
              drawFilters();
              drawTable();
            },
          },
          `${f.label} (${counts[f.id]})`,
        ),
      );
  };
  drawFilters();
  drawTable();
  performance.mark('list:table');

  const exportBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      title: t('listExportCsvTitle'),
      onclick: () => {
        const shown = rows.filter((r) => matchesFilter(r, currentFilter, now));
        downloadBlob(
          csvFileName(campaign, now),
          new Blob([rowsToCsv(campaign, shown)], { type: 'text/csv;charset=utf-8' }),
        );
      },
    },
    svgIcon('download'),
    // The gap after the icon stays in code — a leading space inside a message does not survive translation.
    ' ',
    t('listExportCsv'),
  );

  root.append(
    columnsEditor(campaign),
    stepsEditor(campaign, () => undefined),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h(
          'p',
          { class: 'muted' },
          t('listRowsColumns', tn(rows.length, 'listRows'), tn(campaign.columns.length, 'listColumns')),
        ),
        rows.length === 0 ? h('p', {}, t('listNoRows')) : filters,
        rows.length === 0 ? null : table,
        rows.length === 0 ? null : pager,
        rows.length === 0 ? null : h('div', { class: 'card__actions' }, exportBtn),
      ),
    ),
  );
}
