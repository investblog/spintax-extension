/**
 * Review screen — spec §14.4 / ADR 0011 p.3, 10: problems-only by default + a sample of clean
 * rows, "Approve N clean rows", list left / message right, ← → and A/E/S keys, per-row edits
 * (override + `edited` event), "another variant" (salt), duplicate check against the journal.
 */
import { append, clear, h } from '@/shared/dom';
import { ENGINE_VERSION, type RenderWarning, type RowRender, renderRow, renderWithHighlights } from '@/shared/engine';
import { type MessageKey, t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import { buildSeed } from '@/shared/keys';
import type { Campaign, ReviewState, Row, Template } from '@/shared/model';
import { appendEvent, findTemplate, listCampaignEvents, listRows, updateCampaign, updateRow } from '@/shared/repo';
import { notify } from '../state';
import { highlighted, warningsList } from './template';

type Severity = 'blocker' | 'warning' | 'clean';

/** The enum is the storage value; the caption is a table, never the raw code on screen. */
/** Shared with the row drawer: one table, so the same state reads the same on both screens. */
export const REVIEW_STATE_LABEL: Record<ReviewState, MessageKey> = {
  unreviewed: 'revStateUnreviewed',
  approved: 'revStateApproved',
  edited: 'revStateEdited',
  skipped: 'revStateSkipped',
};

/** The hint in the caption and the key the handler listens for are the same letter, by construction. */
/** Captions quote the letter; the handler matches the PHYSICAL key so a non-Latin layout still
 *  triggers it (Codex #3 — on a Russian layout A/E/S emit ф/у/ы). */
const KEY_APPROVE = 'a';
const KEY_EDIT = 'e';
const KEY_SKIP = 's';
const CODE_APPROVE = 'KeyA';
const CODE_EDIT = 'KeyE';
const CODE_SKIP = 'KeyS';

interface Item {
  row: Row;
  render: RowRender;
  warnings: RenderWarning[];
  severity: Severity;
  duplicateOf?: string;
}

export function severityOf(warnings: RenderWarning[], row: Row, campaign: Campaign): Severity {
  const required = new Set(campaign.columns.filter((c) => c.required).map((c) => c.variable.toLowerCase()));
  for (const w of warnings) {
    if (w.kind === 'leakedMarkup' || w.kind === 'renderError') return 'blocker';
    if (w.kind === 'constraint' && w.level === 'blocking') return 'blocker';
    if (w.kind === 'emptyVariable' && required.has(w.variable)) return 'blocker';
  }
  if (row.deliveryStatus !== 'not_started' && row.deliveryStatus !== 'deferred') return 'clean';
  return warnings.length > 0 ? 'warning' : 'clean';
}

export async function renderReview(root: HTMLElement, campaign: Campaign): Promise<void> {
  clear(root);
  const step = 1;
  const body = await findTemplate(campaign.id, 'body', step, campaign.defaultLocale);
  if (!body) {
    root.append(
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'card__body' },
          h('p', { class: 'muted' }, t('revNoBody')),
          h('a', { class: 'btn btn--primary', href: '#template' }, svgIcon('pencil-circle'), ' ', t('revTemplateLink')),
        ),
      ),
    );
    return;
  }
  const subject = await findTemplate(campaign.id, 'subject', step, campaign.defaultLocale);
  const templates: { body: Template; subject?: Template } = { body, subject };

  const rows = (await listRows(campaign.id)).sort((a, b) => a.seedKey.localeCompare(b.seedKey));
  const sentBodies = new Map<string, string>();
  for (const e of await listCampaignEvents(campaign.id))
    if (e.event === 'sent' && e.body) sentBodies.set(e.body.trim(), e.rowId);

  const items: Item[] = rows.map((row) => {
    const render = renderRow(campaign, row, step, templates);
    const warnings = [...render.warnings];
    const dup = sentBodies.get(render.body.text.trim());
    const duplicateOf = dup && dup !== row.rowId ? dup : undefined;
    return { row, render, warnings, severity: severityOf(warnings, row, campaign), duplicateOf };
  });

  let filter: 'problems' | 'sample' | 'all' = 'problems';
  let index = 0;

  const listEl = h('div', { class: 'review__list' });
  const detailEl = h('div', { class: 'review__detail' });
  const counters = h('div', { class: 'review__counters muted' });
  const filterBar = h('div', { class: 'review__filters' });

  const visible = (): Item[] => {
    if (filter === 'all') return items;
    if (filter === 'problems') return items.filter((i) => i.severity !== 'clean' || i.duplicateOf);
    const clean = items.filter((i) => i.severity === 'clean' && !i.duplicateOf);
    const stepN = Math.max(1, Math.floor(clean.length / 15));
    return clean.filter((_, k) => k % stepN === 0).slice(0, 15);
  };

  const renderCounters = (): void => {
    const blockers = items.filter((i) => i.severity === 'blocker').length;
    const warns = items.filter((i) => i.severity === 'warning').length;
    const dups = items.filter((i) => i.duplicateOf).length;
    const approved = items.filter((i) => i.row.reviewState === 'approved').length;
    const edited = items.filter((i) => i.row.reviewState === 'edited').length;
    // One joiner key with six parts, each counted by its own plural rule — not six glued fragments.
    counters.textContent = t(
      'revCounters',
      tn(items.length, 'revRows'),
      tn(blockers, 'revBlockers'),
      tn(warns, 'revWarnings'),
      tn(dups, 'revDuplicates'),
      t('revApproved', String(approved)),
      t('revEdited', String(edited)),
    );
  };

  const renderFilters = (): void => {
    clear(filterBar);
    const problems = items.filter((i) => i.severity !== 'clean' || i.duplicateOf).length;
    const clean = items.length - problems;
    const mk = (id: typeof filter, label: string): HTMLElement =>
      h(
        'button',
        {
          type: 'button',
          class: `btn-chip btn-chip--sm${filter === id ? ' btn-chip--primary' : ''}`,
          'aria-pressed': String(filter === id),
          onclick: () => {
            filter = id;
            index = 0;
            renderAll();
          },
        },
        label,
      );
    filterBar.append(
      mk('problems', t('revFilterProblems', String(problems))),
      mk('sample', t('revFilterSample', String(Math.min(15, clean)))),
      mk('all', t('revFilterAll', String(items.length))),
    );
    const unreviewedClean = items.filter(
      (i) => i.severity === 'clean' && !i.duplicateOf && i.row.reviewState === 'unreviewed',
    );
    if (unreviewedClean.length > 0) {
      filterBar.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--primary btn--sm',
            onclick: async () => {
              for (const i of unreviewedClean) {
                await appendEvent({
                  rowId: i.row.rowId,
                  step,
                  event: 'reviewed',
                  engineVersion: ENGINE_VERSION,
                  reviewState: 'approved',
                });
                i.row.reviewState = 'approved';
              }
              renderAll();
            },
          },
          svgIcon('check'),
          ' ',
          tn(unreviewedClean.length, 'revApproveClean'),
        ),
      );
    }
    const blockers = items.filter((i) => i.severity === 'blocker').length;
    if (blockers === 0 && campaign.wizardStep === 4) {
      filterBar.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onclick: async () => {
              await updateCampaign(campaign.id, { wizardStep: 5 });
              notify();
            },
          },
          svgIcon('play'),
          ' ',
          t('revStartQueue'),
        ),
      );
    }
  };

  const renderList = (): void => {
    clear(listEl);
    const list = visible();
    if (list.length === 0)
      // Appended straight to .review__list inside a bare .card, this had no padding and read as
      // clipped — and "Problems 0" is what a healthy campaign always opens on (UX review).
      listEl.append(
        h(
          'div',
          { class: 'card__body' },
          h('p', { class: 'muted' }, filter === 'problems' ? t('revNoProblems') : t('revNothingHere')),
        ),
      );
    list.forEach((item, k) => {
      const badge =
        item.severity === 'blocker'
          ? h('span', { class: 'badge badge--sm badge--danger' }, t('revBadgeBlocker'))
          : item.duplicateOf
            ? h('span', { class: 'badge badge--sm badge--warning' }, t('revBadgeDuplicate'))
            : item.severity === 'warning'
              ? h('span', { class: 'badge badge--sm badge--warning' }, t('revBadgeWarning'))
              : h('span', { class: 'badge badge--sm badge--neutral' }, t(REVIEW_STATE_LABEL[item.row.reviewState]));
      listEl.append(
        h(
          'button',
          {
            type: 'button',
            class: `review__item${k === index ? ' is-active' : ''}`,
            onclick: () => {
              index = k;
              renderList();
              renderDetail();
            },
          },
          h('span', { class: 'review__item-key' }, item.row.seedKey),
          badge,
        ),
      );
    });
  };

  const renderDetail = (): void => {
    clear(detailEl);
    const list = visible();
    const item = list[index];
    if (!item) return;
    const current: Item = item;
    const { row, render } = current;
    const edit = h('textarea', { class: 'textarea review__editor', rows: 8, hidden: true }) as HTMLTextAreaElement;
    edit.value = render.body.text;
    const textEl = highlighted(render.body);
    const extra: RenderWarning[] = [...item.warnings];
    const dupNote = item.duplicateOf ? h('p', { class: 'text-warning' }, t('revDuplicateNote')) : null;

    const nav = h(
      'div',
      { class: 'review__nav' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn-icon btn-icon--compact',
          'aria-label': t('revPrevious'),
          onclick: () => move(-1),
        },
        svgIcon('chevron-up'),
      ),
      h('span', { class: 'muted' }, t('revPosition', String(index + 1), String(list.length))),
      h(
        'button',
        { type: 'button', class: 'btn-icon btn-icon--compact', 'aria-label': t('revNext'), onclick: () => move(1) },
        svgIcon('chevron-down'),
      ),
    );

    const approve = h(
      'button',
      { type: 'button', class: 'btn btn--primary', onclick: () => void act('approve') },
      svgIcon('check'),
      ' ',
      t('revApprove', KEY_APPROVE.toUpperCase()),
    );
    const editBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost',
        onclick: () => {
          edit.hidden = !edit.hidden;
          textEl.hidden = !edit.hidden;
          saveEdit.hidden = edit.hidden;
          if (!edit.hidden) edit.focus();
        },
      },
      svgIcon('pencil-circle'),
      ' ',
      t('revEdit', KEY_EDIT.toUpperCase()),
    );
    // Hidden until Edit opens the editor: it was competing with Approve as a second primary
    // button, and pressing it without editing wrote an "edited" journal event for unchanged text.
    const saveEdit = h(
      'button',
      { type: 'button', hidden: true, class: 'btn btn--primary', onclick: () => void act('saveEdit', edit.value) },
      svgIcon('check'),
      ' ',
      t('revSaveEdit'),
    );
    const skip = h(
      'button',
      { type: 'button', class: 'btn btn--ghost', onclick: () => void act('skip') },
      svgIcon('close'),
      ' ',
      t('revSkip', KEY_SKIP.toUpperCase()),
    );
    const respin = h(
      'button',
      { type: 'button', class: 'btn btn--ghost', onclick: () => void act('respin') },
      svgIcon('refresh'),
      ' ',
      t('revRespin'),
    );
    const reset = row.overrides?.body
      ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void act('reset') }, ' ', t('revReset'))
      : null;

    append(detailEl, [
      h(
        'div',
        { class: 'review__head' },
        h('strong', {}, row.seedKey),
        h(
          'span',
          { class: 'muted' },
          // The separator stays in code (a leading space does not survive translation); the edited
          // form is its own key, not a tail glued onto the plain one.
          ' · ',
          row.overrides?.body
            ? t('revMetaEdited', String(step), render.seed, t(REVIEW_STATE_LABEL[row.reviewState]))
            : t('revMeta', String(step), render.seed, t(REVIEW_STATE_LABEL[row.reviewState])),
        ),
        nav,
      ),
      render.subject
        ? h(
            'p',
            { class: 'review__subject' },
            h('span', { class: 'muted' }, t('revSubject'), ' '),
            highlighted(render.subject),
          )
        : null,
      textEl,
      edit,
      dupNote,
      warningsList(extra),
      h('div', { class: 'card__actions review__actions' }, approve, editBtn, saveEdit, skip, respin, reset),
    ]);

    async function act(kind: 'approve' | 'skip' | 'saveEdit' | 'respin' | 'reset', text?: string): Promise<void> {
      if (kind === 'approve' || kind === 'skip') {
        await appendEvent({
          rowId: row.rowId,
          step,
          event: 'reviewed',
          engineVersion: ENGINE_VERSION,
          reviewState: kind === 'approve' ? 'approved' : 'skipped',
        });
        row.reviewState = kind === 'approve' ? 'approved' : 'skipped';
        move(1);
        return;
      }
      if (kind === 'saveEdit' && text !== undefined) {
        const updated = await updateRow(row.rowId, {
          overrides: { ...row.overrides, body: { step, text, source: 'edit' } },
        });
        await appendEvent({
          rowId: row.rowId,
          step,
          event: 'edited',
          engineVersion: ENGINE_VERSION,
          body: text,
          subject: render.subject?.text,
        });
        Object.assign(row, updated, { reviewState: 'edited' });
      }
      if (kind === 'respin') {
        const salt = row.salt + 1;
        const seed = buildSeed(row.seedKey, step, salt);
        const r = renderWithHighlights(templates.body.source, render.context, {
          seed,
          locale: row.lang ?? templates.body.locale,
          includes: templates.body.includes,
        });
        const updated = await updateRow(row.rowId, { overrides: { ...row.overrides, body: undefined } });
        await appendEvent({
          rowId: row.rowId,
          step,
          event: 'edited',
          engineVersion: ENGINE_VERSION,
          salt,
          body: r.text,
        });
        Object.assign(row, updated, { salt, reviewState: 'edited' });
      }
      if (kind === 'reset') {
        const updated = await updateRow(row.rowId, { overrides: { ...row.overrides, body: undefined } });
        Object.assign(row, updated);
      }
      current.render = renderRow(campaign, row, step, templates);
      current.warnings = [...current.render.warnings];
      current.severity = severityOf(current.warnings, row, campaign);
      renderAll();
    }
  };

  const move = (delta: number): void => {
    const n = visible().length;
    if (n === 0) return;
    index = (index + delta + n) % n;
    renderList();
    renderDetail();
  };

  const renderAll = (): void => {
    renderCounters();
    renderFilters();
    renderList();
    renderDetail();
  };

  const onKey = (e: KeyboardEvent): void => {
    // A chord is never one of ours: Ctrl+A must select text on a screen made for reading it, not
    // approve the row and write a journal event (pre-release review #5).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(-1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(1);
    else if (e.code === CODE_APPROVE || e.key.toLowerCase() === KEY_APPROVE)
      detailEl.querySelector<HTMLButtonElement>('.btn--primary')?.click();
    else if (e.code === CODE_EDIT || e.key.toLowerCase() === KEY_EDIT)
      (detailEl.querySelectorAll<HTMLButtonElement>('.btn--ghost')[0] ?? null)?.click();
    else if (e.code === CODE_SKIP || e.key.toLowerCase() === KEY_SKIP)
      (detailEl.querySelectorAll<HTMLButtonElement>('.btn--ghost')[1] ?? null)?.click();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  const observer = new MutationObserver(() => {
    if (!root.isConnected || !root.contains(listEl)) {
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  root.append(
    h('div', { class: 'review__top' }, filterBar, counters),
    h(
      'div',
      { class: 'review' },
      h('section', { class: 'card review__pane' }, listEl),
      h('section', { class: 'card review__pane' }, h('div', { class: 'card__body' }, detailEl)),
    ),
  );
  renderAll();
}
