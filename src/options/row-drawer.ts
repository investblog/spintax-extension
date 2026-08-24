/**
 * Row drawer — opened from the List screen: see and fix one row without leaving the list.
 * Values / target / note are patched directly (non-projected fields, updateRow); a changed
 * target or language re-derives the row key (ADR 0006) and is refused on a key clash; outcomes
 * go through the journal (appendEvent re-projects the row); the journal itself is listed.
 */

import { armedButton } from '@/options/armed';
import { clear, flash, h } from '@/shared/dom';
import { closeDrawer, openDrawer } from '@/shared/drawer';
import { ENGINE_VERSION } from '@/shared/engine';
import { t } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import { describeEvent } from '@/shared/journal-text';
import { deriveSeedKey, detectTargetKind } from '@/shared/keys';
import type { Campaign, Row, RowId } from '@/shared/model';
import { deferUntil, stepFor } from '@/shared/queue-order';
import {
  appendEvent,
  deleteRow,
  effectiveEvents,
  findRowsBySeedKey,
  getRow,
  listAssets,
  listEvents,
  updateRow,
} from '@/shared/repo';
import { field } from './quick-actions';
import { notify } from './state';
import { statusBadge } from './views/list';
import { REVIEW_STATE_LABEL } from './views/review';

const TERMINAL = new Set<Row['deliveryStatus']>(['replied', 'declined', 'not_applicable']);

export async function openRowDrawer(campaign: Campaign, rowId: RowId): Promise<void> {
  let row = await getRow(rowId);
  if (!row) return;
  const body = h('div', { class: 'stack stack--md' });
  const status = h('p', { class: 'field-hint', role: 'status' });
  const assetNames = (await listAssets()).map((a) => a.name);

  const refresh = async (): Promise<boolean> => {
    row = await getRow(rowId);
    if (!row) {
      status.textContent = t('rowGone');
      closeDrawer();
      return false;
    }
    return true;
  };

  const redraw = (): void => {
    const r = row;
    if (!r) return;
    clear(body);
    let dirty = false;
    const edited: Record<string, string> = {};
    const target = h('input', { class: 'input', value: r.target, 'aria-label': t('rowTarget') }) as HTMLInputElement;
    const lang = h('input', {
      class: 'input input--sm',
      value: r.lang ?? '',
      placeholder: 'en', // a language TAG, not a word — the same in every UI language
      'aria-label': t('rowLanguage'),
    }) as HTMLInputElement;
    const note = h('textarea', { class: 'textarea', rows: 2, 'aria-label': t('rowNote') }) as HTMLTextAreaElement;
    note.value = r.note ?? '';
    for (const el of [target, lang, note])
      el.addEventListener('input', () => {
        dirty = true;
      });
    const columnInputs = campaign.columns
      .filter((c) => !c.hidden && (c.role === 'none' || c.role === 'key'))
      .map((c) => {
        const input = h('input', {
          class: 'input',
          value: r.values[c.id] ?? '',
          'aria-label': c.header,
          list: c.type === 'file' ? 'row-drawer-assets' : undefined,
        }) as HTMLInputElement;
        input.addEventListener('input', () => {
          edited[c.id] = input.value;
          dirty = true;
        });
        return field(`${c.header} — %${c.variable}%`, input, c.type === 'file' ? t('rowAssetHint') : undefined);
      });
    const datalist = h('datalist', { id: 'row-drawer-assets' }, ...assetNames.map((n) => h('option', { value: n })));

    /** Save the editable fields; a changed target/lang re-derives the key. Returns false when refused. */
    const saveRow = async (): Promise<boolean> => {
      try {
        const newTarget = target.value.trim();
        const newLang = lang.value.trim().toLowerCase() || undefined;
        const values = { ...r.values, ...edited };
        const targetCol = campaign.columns.find((c) => c.role === 'target');
        if (targetCol && newTarget !== r.target) values[targetCol.id] = newTarget;
        const langCol = campaign.columns.find((c) => c.role === 'lang');
        if (langCol && newLang !== r.lang) values[langCol.id] = newLang ?? '';
        let seedKey = r.seedKey;
        const keyOverride = campaign.columns.find((c) => c.role === 'key');
        if (!keyOverride && (newTarget !== r.target || newLang !== r.lang)) {
          const derived = deriveSeedKey(newTarget, { scenario: campaign.scenario, lang: newLang });
          if (!derived) {
            status.textContent = t('rowTargetInvalid');
            return false;
          }
          if (derived !== r.seedKey) {
            const clash = (await findRowsBySeedKey(campaign.id, derived)).filter((x) => x.rowId !== rowId);
            if (clash.length > 0) {
              status.textContent = t('rowKeyClash', derived);
              return false;
            }
            seedKey = derived;
          }
        }
        await updateRow(rowId, {
          target: newTarget,
          targetKind: detectTargetKind(newTarget),
          lang: newLang,
          values,
          note: note.value.trim() || undefined,
          seedKey,
        });
        dirty = false;
        return true;
      } catch (err) {
        status.textContent = t('rowSaveFailed', (err as Error).message);
        return false;
      }
    };
    const save = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        onclick: async () => {
          if (!(await saveRow())) return;
          if (!(await refresh())) return;
          flash(status, t('rowSaved'));
          notify();
          redraw();
        },
      },
      svgIcon('check'),
      ' ',
      t('rowSave'),
    );

    const step = stepFor(r);
    /** Outcomes save pending edits first — what the user sees is what gets recorded. */
    const event = async (input: Parameters<typeof appendEvent>[0]): Promise<void> => {
      try {
        if (dirty && !(await saveRow())) return;
        await appendEvent(input);
        if (!(await refresh())) return;
        notify();
        redraw();
      } catch (err) {
        status.textContent = t('rowRecordFailed', (err as Error).message);
      }
    };
    const days = h('input', {
      type: 'number',
      class: 'input input--sm',
      min: '1',
      max: '365',
      value: '3',
      'aria-label': t('rowDaysAria'),
    }) as HTMLInputElement;
    const outcomes = TERMINAL.has(r.deliveryStatus)
      ? [h('p', { class: 'muted' }, t('rowClosed'))]
      : [
          h(
            'div',
            { class: 'cluster' },
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost btn--sm',
                onclick: () =>
                  void event({
                    rowId,
                    step,
                    engineVersion: ENGINE_VERSION,
                    event: 'deferred',
                    until: deferUntil(Number(days.value) || 3),
                  }),
              },
              t('rowDefer'),
            ),
            // A number wedged between two text nodes cannot be pluralised and cannot be reordered:
            // German and Russian want the unit elsewhere, and "Defer 1 days" was wrong in English
            // too. The field carries its own label instead (Codex #2).
            h('label', { class: 'cluster cluster--xs' }, h('span', { class: 'muted' }, t('rowDeferDays')), days),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost btn--sm',
              onclick: () => void event({ rowId, step, engineVersion: ENGINE_VERSION, event: 'excluded' }),
            },
            t('rowNotApplicable'),
          ),
        ];
    const del = armedButton(
      t('rowDelete'),
      t('rowDeleteConfirm'),
      async () => {
        await deleteRow(rowId);
        closeDrawer();
        notify();
      },
      { small: true, icon: 'trash' },
    );

    const override = r.overrides?.body ?? r.overrides?.subject;
    const message = override
      ? h(
          'div',
          { class: 'stack stack--xs' },
          h(
            'p',
            { class: 'muted' },
            t(override.source === 'translate' ? 'rowEditedTranslated' : 'rowEdited', String(override.step)),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost btn--sm',
              onclick: async () => {
                await updateRow(rowId, { overrides: { ...r.overrides, body: undefined, subject: undefined } });
                if (!(await refresh())) return;
                flash(status, t('rowResetDone'));
                notify();
                redraw();
              },
            },
            t('rowResetTemplate'),
          ),
        )
      : null;

    const journal = h(
      'ul',
      { class: 'stack-list stack-list--xs row-drawer__journal' },
      h('li', { class: 'muted' }, t('rowJournalLoading')),
    );
    void listEvents(rowId).then((events) => {
      clear(journal);
      const eff = effectiveEvents(events).reverse();
      if (eff.length === 0) journal.append(h('li', { class: 'muted' }, t('rowJournalEmpty')));
      for (const e of eff) journal.append(h('li', {}, describeEvent(e)));
    });

    for (const el of [
      h(
        'div',
        { class: 'cluster' },
        statusBadge(r),
        h('span', { class: 'muted' }, t('rowStepState', String(step), t(REVIEW_STATE_LABEL[r.reviewState]))),
      ),
      h(
        'fieldset',
        { class: 'fieldset-group stack stack--sm' },
        h('legend', {}, t('rowLegendRow')),
        field(t('rowTarget'), target, t('rowTargetHint')),
        field(t('rowLanguage'), lang),
        ...columnInputs,
        datalist,
        field(t('rowNote'), note),
        h('div', { class: 'card__actions' }, save),
      ),
      message
        ? h('fieldset', { class: 'fieldset-group stack stack--sm' }, h('legend', {}, t('rowLegendMessage')), message)
        : null,
      h(
        'fieldset',
        { class: 'fieldset-group stack stack--sm' },
        h('legend', {}, t('rowLegendOutcome')),
        ...outcomes,
        del,
      ),
      h('fieldset', { class: 'fieldset-group stack stack--sm' }, h('legend', {}, t('rowLegendJournal')), journal),
      status,
    ])
      if (el) body.append(el);
  };

  redraw();
  openDrawer({
    title: row.seedKey,
    subtitle: row.target === row.seedKey ? undefined : row.target,
    body,
    footer: [
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => closeDrawer() }, t('drwFooterClose')),
    ],
  });
}
