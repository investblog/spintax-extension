/**
 * Campaign steps — the initial message plus follow-ups with a delay in days after the previous
 * step (spec §7: a follow-up is a step with its own template and seed `key:step`). Saving
 * replays the journal so rows already sent get their due dates (repo.reprojectCampaign).
 */
import { clear, h } from '@/shared/dom';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Campaign, StepDef } from '@/shared/model';
import { reprojectCampaign, updateCampaign } from '@/shared/repo';
import { notify } from '../state';

const DEFAULT_DELAY_DAYS = 3;

export function stepsEditor(campaign: Campaign, onSaved: (campaign: Campaign) => void): HTMLElement {
  const steps: StepDef[] = campaign.steps.map((s) => ({ ...s }));
  const list = h('div', { class: 'steps' });
  const status = h('span', { class: 'muted', role: 'status' });

  const render = (): void => {
    clear(list);
    for (const s of steps) {
      const label = h('strong', {}, t('stepLabel', String(s.step)));
      // " — " stays in code: a message that starts with a space and a dash does not survive
      // translation, and the delay input splits the follow-up line in two anyway.
      if (s.kind === 'initial') {
        list.append(h('div', { class: 'steps__row' }, label, ' — ', t('stepInitial')));
        continue;
      }
      const delay = h('input', {
        type: 'number',
        class: 'input input--sm steps__delay',
        min: '0',
        max: '365',
        value: String(s.delayDays ?? DEFAULT_DELAY_DAYS),
        'aria-label': t('stepDelayAria', String(s.step)),
      }) as HTMLInputElement;
      delay.addEventListener('input', () => {
        s.delayDays = Math.max(0, Number(delay.value) || 0);
      });
      list.append(
        h('div', { class: 'steps__row' }, label, ' — ', t('stepFollowup'), ' ', delay, ' ', t('stepFollowupDays')),
      );
    }
  };

  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      onclick: () => {
        steps.push({ step: steps.length + 1, kind: 'followup', delayDays: DEFAULT_DELAY_DAYS });
        render();
      },
    },
    svgIcon('plus'),
    ' ',
    t('stepAdd'),
  );
  const remove = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      onclick: () => {
        if (steps.length > 1) steps.pop();
        render();
      },
    },
    t('stepRemove'),
  );
  const save = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary btn--sm',
      onclick: async () => {
        const updated = await updateCampaign(campaign.id, { steps });
        const n = await reprojectCampaign(campaign.id);
        // "row(s)" is not a plural — Russian needs three forms, so the count picks the message.
        status.textContent = tn(n, 'stepSaved');
        notify();
        onSaved(updated);
      },
    },
    svgIcon('check'),
    ' ',
    t('stepSave'),
  );

  render();
  return h(
    'details',
    { class: 'card card--soft steps__card' },
    h('summary', { class: 'steps__summary' }, svgIcon('clock'), ' ', tn(steps.length, 'stepSummary')),
    h('div', { class: 'card__body' }, list, h('div', { class: 'card__actions' }, add, remove, save, status)),
  );
}
