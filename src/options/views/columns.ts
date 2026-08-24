/**
 * Column editor — spec §14.1 chips with settings: type (text / file), fillable slot, default,
 * required, prompt hint, hidden. Lives on the List screen. File columns hold asset sha256 values.
 */
import { clear, flash, h } from '@/shared/dom';
import { dropdown } from '@/shared/dropdown';
import { type MessageKey, t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Campaign, ColumnDef } from '@/shared/model';
import { updateCampaign } from '@/shared/repo';

/** The enum is the storage value; the caption is a table, never the code with a word in it. */
const TYPE_LABEL: Record<ColumnDef['type'], MessageKey> = {
  text: 'colTypeText',
  file: 'colTypeFile',
};

export function columnsEditor(campaign: Campaign): HTMLElement {
  const columns: ColumnDef[] = campaign.columns.map((c) => ({ ...c }));
  const status = h('span', { class: 'muted', role: 'status' });
  const body = h('div', { class: 'columns' });

  const render = (): void => {
    clear(body);
    for (const c of columns) {
      const type = dropdown<ColumnDef['type']>({
        label: t('colTypeOf', c.header),
        value: c.type,
        size: 'sm',
        options: (Object.keys(TYPE_LABEL) as ColumnDef['type'][]).map((value) => ({
          value,
          label: t(TYPE_LABEL[value]),
        })),
        onChange: (v) => {
          c.type = v;
        },
      });
      const fillable = h('input', { type: 'checkbox', checked: c.fillable }) as HTMLInputElement;
      fillable.addEventListener('change', () => {
        c.fillable = fillable.checked;
      });
      const required = h('input', { type: 'checkbox', checked: !!c.required }) as HTMLInputElement;
      required.addEventListener('change', () => {
        c.required = required.checked || undefined;
      });
      const hidden = h('input', { type: 'checkbox', checked: !!c.hidden }) as HTMLInputElement;
      hidden.addEventListener('change', () => {
        c.hidden = hidden.checked || undefined;
      });
      const def = h('input', {
        class: 'input',
        value: c.defaultValue ?? '',
        placeholder: t('colDefaultPlaceholder'),
      }) as HTMLInputElement;
      def.addEventListener('input', () => {
        c.defaultValue = def.value || undefined;
      });
      const note = h('input', {
        class: 'input',
        value: c.promptNote ?? '',
        placeholder: t('colNotePlaceholder'),
      }) as HTMLInputElement;
      note.addEventListener('input', () => {
        c.promptNote = note.value || undefined;
      });
      body.append(
        h(
          'div',
          { class: 'columns__row' },
          h(
            'div',
            { class: 'columns__name' },
            h('strong', {}, c.header),
            ' ',
            h('code', { class: 'muted' }, `%${c.variable}%`),
            ' ',
            c.role !== 'none' ? h('span', { class: 'badge badge--sm badge--primary' }, c.role) : null,
          ),
          h(
            'div',
            { class: 'columns__controls' },
            type,
            // The gap after the checkbox stays in code — a leading space inside a message does not
            // survive translation.
            h('label', { class: 'columns__check', title: t('colFillableTitle') }, fillable, ' ', t('colFillable')),
            h('label', { class: 'columns__check' }, required, ' ', t('colRequired')),
            h('label', { class: 'columns__check' }, hidden, ' ', t('colHidden')),
          ),
          h('div', { class: 'columns__inputs' }, def, note),
        ),
      );
    }
  };

  const save = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary btn--sm',
      onclick: async () => {
        await updateCampaign(campaign.id, { columns });
        campaign.columns = columns.map((c) => ({ ...c }));
        flash(status, t('colSaved'));
      },
    },
    svgIcon('check'),
    ' ',
    t('colSave'),
  );

  render();
  return h(
    'details',
    { class: 'card card--soft columns__card' },
    h('summary', { class: 'columns__summary' }, svgIcon('cog'), ' ', tn(columns.length, 'colSummary')),
    h('div', { class: 'card__body' }, body, h('div', { class: 'card__actions' }, save, status)),
  );
}
