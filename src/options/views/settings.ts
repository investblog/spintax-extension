/**
 * Settings — e-mail targets (spec §8): which mail app/web mail "Open target" uses, the Gmail
 * account index, BCC to self. Shows the MEASURED fit: the longest rendered message of the
 * campaign against the provider's link limit, so the user sees whether bodies travel in the
 * link or get pasted in the editor.
 */

import { armedButton } from '@/options/armed';
import { demoCampaign, removeDemo } from '@/shared/demo';
import { clear, flash, h } from '@/shared/dom';
import { dropdown } from '@/shared/dropdown';
import { renderRow } from '@/shared/engine';
import { fmtSize } from '@/shared/format';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import {
  bodyBudget,
  MAIL_DEFAULTS,
  MAIL_SETTINGS_KEY,
  type MailProvider,
  type MailSettings,
  OPEN_TARGET_DEFAULT,
  OPEN_TARGET_KEY,
  type OpenTargetIn,
  PROVIDERS,
  providerInfo,
} from '@/shared/mail';
import type { Campaign } from '@/shared/model';
import { deleteCampaign, findTemplate, getSetting, listRows, setSetting, storageEstimate } from '@/shared/repo';
import { deleteAllData, listOrphanAssets, purgeOrphanAssets } from '@/shared/storage';
import { notify, notifyPanel } from '../state';

/** Two-click destructive button: the first click arms it and changes the label. */

async function storageCard(campaign: Campaign | null): Promise<HTMLElement> {
  const est = await storageEstimate();
  const orphans = await listOrphanAssets();
  const demo = await demoCampaign();
  const orphanBytes = orphans.reduce((s, a) => s + a.size, 0);
  const status = h('p', { class: 'field-hint', role: 'status' });
  const body = h(
    'div',
    { class: 'card__body' },
    h('h2', { class: 'card__title' }, t('setStorageTitle')),
    h(
      'p',
      { class: 'muted' },
      est ? t('setStorageUsed', fmtSize(est.usage), fmtSize(est.quota)) : t('setStorageUnknown'),
    ),
    h(
      'p',
      { class: 'settings__orphans' },
      orphans.length ? tn(orphans.length, 'setOrphans', fmtSize(orphanBytes)) : t('setNoOrphans'),
    ),
    h(
      'div',
      { class: 'card__actions' },
      orphans.length
        ? armedButton(
            // Both labels come from the caller — the armed one is its own key, never label + a tail.
            tn(orphans.length, 'setDeleteUnused'),
            tn(orphans.length, 'setDeleteUnusedConfirm', fmtSize(orphanBytes)),
            async () => {
              const gone = await purgeOrphanAssets();
              status.textContent = tn(gone.count, 'setDeleted', fmtSize(gone.bytes));
              notify();
            },
          )
        : null,
      demo
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost',
              onclick: async () => {
                await removeDemo();
                status.textContent = t('setDemoRemoved');
                notify();
              },
            },
            svgIcon('trash'),
            // The gap after the icon stays in code — a leading space inside a message does not survive translation.
            ' ',
            t('setRemoveDemo'),
          )
        : null,
      campaign
        ? armedButton(t('setDeleteCampaign', campaign.name), t('setDeleteCampaignConfirm'), async () => {
            await deleteCampaign(campaign.id);
            notify();
          })
        : null,
      armedButton(t('setDeleteAll'), t('setDeleteAllConfirm'), async () => {
        await deleteAllData();
        location.reload();
      }),
      status,
    ),
  );
  return h('section', { class: 'card' }, body);
}

const MEASURE_LIMIT = 5000;

/** Longest rendered step-1 message of the campaign (first MEASURE_LIMIT rows). */
async function longestMessage(campaign: Campaign): Promise<{ chars: number; rows: number; sample: string } | null> {
  const template = await findTemplate(campaign.id, 'body', 1, campaign.defaultLocale);
  if (!template) return null;
  const subject = await findTemplate(campaign.id, 'subject', 1, campaign.defaultLocale);
  const rows = (await listRows(campaign.id)).slice(0, MEASURE_LIMIT);
  let chars = 0;
  let sample = '';
  for (const row of rows) {
    const r = renderRow(campaign, row, 1, { body: template, subject: subject ?? undefined });
    if (r.body.text.length > chars) {
      chars = r.body.text.length;
      sample = r.body.text;
    }
  }
  return { chars, rows: rows.length, sample };
}

/**
 * Where a site target opens. Reuse is the default (spec §14.5), but it replaces the page the user
 * was reading — so the choice is stated rather than implied, and a Ctrl / middle click overrides it
 * per click (UX review, ask 2).
 */
async function openTargetCard(): Promise<HTMLElement> {
  const current = await getSetting<OpenTargetIn>(OPEN_TARGET_KEY, OPEN_TARGET_DEFAULT);
  const status = h('p', { class: 'field-hint', role: 'status' });
  const choice = (value: OpenTargetIn, label: string): HTMLElement => {
    const input = h('input', {
      type: 'radio',
      name: 'open-target-in',
      value,
      checked: current === value,
      onchange: async () => {
        await setSetting<OpenTargetIn>(OPEN_TARGET_KEY, value);
        // An open side panel reads this once, in reload() — without notify() the setting looks
        // broken until the panel is reopened (pre-release review #4).
        notifyPanel();
        flash(status, t('setSaved'));
      },
    });
    return h('label', { class: 'columns__check' }, input, ' ', label);
  };
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card__body' },
      h('h2', { class: 'card__title' }, t('setOpenTitle')),
      h('p', { class: 'muted' }, t('setOpenIntro')),
      h('div', { class: 'stack stack--xs' }, choice('current', t('setOpenReuse')), choice('new', t('setOpenNewTab'))),
      h('p', { class: 'field-hint' }, t('setOpenHint')),
      status,
    ),
  );
}

export async function renderSettings(root: HTMLElement, campaign: Campaign | null): Promise<void> {
  clear(root);
  const saved = await getSetting<MailSettings>(MAIL_SETTINGS_KEY, MAIL_DEFAULTS);
  const mail: MailSettings = { ...MAIL_DEFAULTS, ...saved };
  const status = h('span', { class: 'muted', role: 'status' });
  const fit = h('p', { class: 'field-hint settings__fit', role: 'status' });
  const hint = h('p', { class: 'field-hint' }, providerInfo(mail.provider).hint);

  const gmailAccount = h('input', {
    type: 'number',
    class: 'input input--sm',
    min: '0',
    max: '9',
    value: String(mail.gmailAccount),
    'aria-label': t('setGmailAccountAria'),
  }) as HTMLInputElement;
  const bcc = h('input', {
    type: 'email',
    class: 'input',
    value: mail.bcc,
    placeholder: 'me@example.com', // a sample ADDRESS, not a sentence — the same in every UI language
    'aria-label': t('setBccAria'),
  }) as HTMLInputElement;
  const custom = h('input', {
    class: 'input',
    value: mail.customTemplate,
    placeholder: 'https://mail.example.com/compose?to=%to%&subject=%subject%&body=%body%', // literal URL syntax
    'aria-label': t('setCustomAria'),
  }) as HTMLInputElement;
  const gmailField = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label' }, t('setGmailAccount')),
    gmailAccount,
  );
  const customField = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label' }, t('setCustomLabel')),
    custom,
    h('p', { class: 'field-hint' }, t('setCustomHint')),
  );

  const measured = campaign ? await longestMessage(campaign) : null;
  const syncVisibility = (): void => {
    gmailField.hidden = mail.provider !== 'gmail';
    customField.hidden = mail.provider !== 'custom';
    hint.textContent = providerInfo(mail.provider).hint;
    if (!measured) {
      fit.textContent = campaign ? t('setFitNoTemplate') : '';
      return;
    }
    // A length probe, not UI text: these two only pad the URL so the overhead can be measured.
    const budget = bodyBudget(mail, { to: 'name@example.com', subject: 'Subject', body: measured.sample });
    const fits = measured.chars <= budget;
    // Two whole sentences joined in code — the measurement and the verdict. Neither is built from
    // pieces: German and Russian put the provider, the number and the clause in another order.
    const verdict = t(fits ? 'setFitYes' : 'setFitNo', providerInfo(mail.provider).label, String(budget));
    fit.textContent = `${tn(measured.chars, 'setFitMeasured', String(measured.rows))} ${verdict}`;
    fit.classList.toggle('text-warning', !fits);
  };

  const provider = dropdown<MailProvider>({
    label: t('setMailProvider'),
    value: mail.provider,
    width: 'auto',
    options: PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
    onChange: (v) => {
      mail.provider = v;
      syncVisibility();
    },
  });
  gmailAccount.addEventListener('input', () => {
    mail.gmailAccount = Math.max(0, Number(gmailAccount.value) || 0);
  });
  bcc.addEventListener('input', () => {
    mail.bcc = bcc.value.trim();
  });
  custom.addEventListener('input', () => {
    mail.customTemplate = custom.value.trim();
    syncVisibility();
  });
  syncVisibility();

  const save = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onclick: async () => {
        if (mail.provider === 'custom' && !/^https?:\/\/.+%to%/.test(mail.customTemplate)) {
          status.textContent = t('setCustomInvalid');
          return;
        }
        await setSetting(MAIL_SETTINGS_KEY, mail);
        notifyPanel();
        flash(status, t('setSaved'));
      },
    },
    svgIcon('check'),
    ' ',
    t('setSave'),
  );

  root.append(
    await openTargetCard(),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h('h2', { class: 'card__title' }, t('setMailTitle')),
        h('p', { class: 'muted' }, t('setMailIntro')),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('setMailProvider')), provider, hint),
        gmailField,
        customField,
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field-label' }, t('setBcc')),
          bcc,
          h('p', { class: 'field-hint' }, t('setBccHint')),
        ),
        fit,
        h('div', { class: 'card__actions' }, save, status),
      ),
    ),
    await storageCard(campaign),
  );
}
