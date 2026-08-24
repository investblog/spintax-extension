/**
 * Sender profiles — spec §3: constants of the campaign (%my_name%, %my_email%, …), several
 * profiles with activation rules (always / URL pattern / column value). Wizard step 3 part 1.
 */
import { clear, flash, h } from '@/shared/dom';
import { dropdown } from '@/shared/dropdown';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Campaign, Profile, ProfileActivation } from '@/shared/model';
import { updateCampaign, uuid } from '@/shared/repo';

/** The label resolves on read (the QUEUE_FILTERS pattern): the table is imported by the profile
 *  drawer too, so `label` stays a plain string and nobody has to change how they read it. */
export const PROFILE_FIELDS: { key: keyof Profile['values']; label: string; variable: string; multiline?: boolean }[] =
  [
    {
      key: 'name',
      get label() {
        return t('profFieldName');
      },
      variable: 'my_name',
    },
    {
      key: 'email',
      get label() {
        return t('profFieldEmail');
      },
      variable: 'my_email',
    },
    {
      key: 'site',
      get label() {
        return t('profFieldSite');
      },
      variable: 'my_site',
    },
    {
      key: 'phone',
      get label() {
        return t('profFieldPhone');
      },
      variable: 'my_phone',
    },
    {
      key: 'intro',
      get label() {
        return t('profFieldIntro');
      },
      variable: 'my_intro',
      multiline: true,
    },
    {
      key: 'signature',
      get label() {
        return t('profFieldSignature');
      },
      variable: 'my_signature',
      multiline: true,
    },
  ];

export async function renderProfiles(root: HTMLElement, campaign: Campaign): Promise<void> {
  clear(root);
  const profiles: Profile[] = campaign.profiles.map((p) => ({ ...p, values: { ...p.values } }));
  const list = h('div', { class: 'profiles' });
  const status = h('span', { class: 'muted', role: 'status' });

  const save = async (): Promise<void> => {
    await updateCampaign(campaign.id, { profiles });
    campaign.profiles = profiles.map((p) => ({ ...p, values: { ...p.values } }));
    flash(status, tn(profiles.length, 'profSaved'));
  };

  const render = (): void => {
    clear(list);
    if (profiles.length === 0) list.append(h('p', { class: 'muted' }, t('profEmpty')));
    profiles.forEach((p, index) => {
      list.append(profileCard(p, index));
    });
  };

  const profileCard = (p: Profile, index: number): HTMLElement => {
    const nameInput = h('input', {
      class: 'input',
      value: p.name,
      placeholder: t('profNamePlaceholder'),
    }) as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      p.name = nameInput.value;
    });
    const fields = PROFILE_FIELDS.map((f) => {
      const el = (
        f.multiline
          ? h('textarea', { class: 'textarea', rows: 2 })
          : h('input', { class: 'input', type: f.key === 'email' ? 'email' : 'text' })
      ) as HTMLInputElement | HTMLTextAreaElement;
      el.value = p.values[f.key] ?? '';
      el.addEventListener('input', () => {
        p.values[f.key] = el.value;
      });
      return h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, `${f.label} `, h('code', { class: 'muted' }, `%${f.variable}%`)),
        el,
      );
    });

    const kind = dropdown<ProfileActivation['kind']>({
      label: t('profActivation'),
      value: p.activation.kind,
      width: 'auto',
      options: [
        { value: 'always', label: t('profActivationAlways') },
        { value: 'urlPattern', label: t('profActivationUrlPattern') },
        { value: 'column', label: t('profActivationColumn') },
      ],
      onChange: () => syncActivation(),
    });
    const pattern = h('input', {
      class: 'input',
      placeholder: t('profPatternPlaceholder'),
      value: p.activation.kind === 'urlPattern' ? p.activation.pattern : '',
    }) as HTMLInputElement;
    const textColumns = campaign.columns.filter((c) => c.type === 'text');
    const column = dropdown({
      label: t('profColumn'),
      value: (p.activation.kind === 'column' ? p.activation.columnId : textColumns[0]?.id) ?? '',
      width: 'auto',
      options: textColumns.map((c) => ({ value: c.id, label: c.header })),
      onChange: () => syncActivation(),
    });
    const equals = h('input', {
      class: 'input',
      placeholder: t('profEqualsPlaceholder'),
      value: p.activation.kind === 'column' ? p.activation.equals : '',
    }) as HTMLInputElement;
    const activationRow = h('div', { class: 'template__toolbar' }, kind, pattern, column, equals);
    const syncActivation = (): void => {
      const k = kind.value as ProfileActivation['kind'];
      pattern.hidden = k !== 'urlPattern';
      column.hidden = k !== 'column';
      equals.hidden = k !== 'column';
      if (k === 'always') p.activation = { kind: 'always' };
      else if (k === 'urlPattern') p.activation = { kind: 'urlPattern', pattern: pattern.value };
      else p.activation = { kind: 'column', columnId: column.value, equals: equals.value };
    };
    for (const el of [kind, pattern, column, equals]) el.addEventListener('input', syncActivation);
    syncActivation();

    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h(
          'div',
          { class: 'profiles__head' },
          h('span', { class: 'badge badge--sm badge--neutral' }, `#${index + 1}`),
          nameInput,
          h(
            'button',
            {
              type: 'button',
              class: 'btn-icon btn-icon--compact btn-icon--danger-hover',
              'aria-label': t('profRemove'),
              onclick: () => {
                profiles.splice(index, 1);
                render();
              },
            },
            svgIcon('trash'),
          ),
        ),
        h('div', { class: 'profiles__grid' }, ...fields),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('profActivation')), activationRow),
      ),
    );
  };

  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost',
      onclick: () => {
        profiles.push({
          id: uuid(),
          // A profile NAME, not UI chrome: it is written to storage and to backup ZIPs, so it
          // stays English (the profile drawer names the first profile the same way).
          name: profiles.length === 0 ? 'Default' : `Profile ${profiles.length + 1}`,
          values: { name: '', email: '' },
          activation: profiles.length === 0 ? { kind: 'always' } : { kind: 'urlPattern', pattern: '' },
        });
        render();
      },
    },
    svgIcon('plus'),
    ' ',
    t('profAdd'),
  );
  const saveBtn = h(
    'button',
    { type: 'button', class: 'btn btn--primary', onclick: () => void save() },
    svgIcon('check'),
    ' ',
    t('profSave'),
  );

  render();
  root.append(
    h('p', { class: 'muted' }, t('profIntro')),
    list,
    h('div', { class: 'card__actions' }, add, saveBtn, status),
  );
}
