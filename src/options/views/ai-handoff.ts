/**
 * "Write with AI" section of the template screen — spec §14.3 / §17.1: prompt preview
 * (editable), copy / open-in-chat buttons with honest labels, paste-back, fix-it prompt.
 */
import { h } from '@/shared/dom';
import { dropdown } from '@/shared/dropdown';
import type { Diagnostic } from '@/shared/engine';
import { t } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Campaign, Row } from '@/shared/model';
import {
  allKnownVariables,
  buildHandoff,
  type Channel,
  chatGptUrl,
  claudeDesktopUrl,
  handoffText,
  PROMPT_VERSION,
  repairHandoff,
  type VariationLevel,
} from '@/shared/prompts';

export interface HandoffHost {
  campaign: Campaign;
  rows: () => Row[];
  locale: () => string;
  /** Current template source and its diagnostics — for the fix-it prompt. */
  current: () => { source: string; diagnostics: Diagnostic[] } | null;
  onPromptUsed: (meta: { promptId: string; version: string }) => void;
}

/** `done` is the whole confirmation sentence, not a label glued onto one — word order varies. */
async function copy(text: string, status: HTMLElement, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = done;
  } catch {
    status.textContent = t('aiClipboardBlocked');
  }
}

export type AiHandoffElement = HTMLElement & { setDiagnostics(diagnostics: Diagnostic[]): void };

export function aiHandoffSection(host: HandoffHost): AiHandoffElement {
  const brief = h('textarea', {
    class: 'textarea',
    rows: 3,
    placeholder: t('aiBriefPlaceholder'),
  }) as HTMLTextAreaElement;
  const channel = dropdown<Channel>({
    label: t('aiChannel'),
    value: 'generic',
    width: 'auto',
    options: [
      { value: 'generic', label: t('aiChannelGeneric') },
      { value: 'email', label: t('aiChannelEmail') },
      { value: 'sms', label: t('aiChannelSms') },
    ],
    onChange: () => rebuild(),
  });
  const variation = dropdown<VariationLevel>({
    label: t('aiVariation'),
    value: 'balanced',
    width: 'auto',
    options: [
      { value: 'balanced', label: t('aiVariationBalanced') },
      { value: 'conservative', label: t('aiVariationConservative') },
      { value: 'aggressive', label: t('aiVariationAggressive') },
    ],
    onChange: () => rebuild(),
  });
  const samples = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const preview = h('textarea', {
    class: 'textarea template__source',
    rows: 14,
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const status = h('p', { class: 'field-hint', role: 'status' });
  const openChatGpt = h(
    'a',
    { class: 'btn btn--ghost', target: '_blank', rel: 'noopener' },
    svgIcon('open-in-new'),
    ' ',
    t('aiOpenChatGpt'),
  ) as HTMLAnchorElement;
  const openClaude = h(
    'a',
    { class: 'btn btn--ghost' },
    svgIcon('open-in-new'),
    ' ',
    t('aiOpenClaude'),
  ) as HTMLAnchorElement;
  const fixIt = h(
    'button',
    { type: 'button', class: 'btn btn--ghost', hidden: true },
    svgIcon('refresh'),
    ' ',
    t('aiCopyFixIt'),
  ) as HTMLButtonElement;

  let built: ReturnType<typeof buildHandoff> | null = null;

  const rebuild = (): void => {
    const text = brief.value.trim();
    if (!text) {
      preview.value = '';
      openChatGpt.hidden = true;
      openClaude.hidden = true;
      return;
    }
    built = buildHandoff(host.campaign, host.rows(), {
      brief: text,
      locale: host.locale(),
      channel: channel.value,
      variationLevel: variation.value,
      samples: samples.checked,
    });
    preview.value = handoffText(built);
    syncLinks();
  };

  const syncLinks = (): void => {
    const text = preview.value;
    const gpt = chatGptUrl(text);
    const claude = claudeDesktopUrl(text);
    openChatGpt.hidden = !gpt;
    openClaude.hidden = !claude;
    if (gpt) openChatGpt.href = gpt;
    if (claude) openClaude.href = claude;
  };

  for (const el of [brief, channel, variation, samples]) el.addEventListener('input', rebuild);
  preview.addEventListener('input', syncLinks);
  for (const link of [openChatGpt, openClaude]) {
    link.addEventListener('click', () => {
      void copy(preview.value, status, t('aiPromptCopied'));
      if (built) host.onPromptUsed({ promptId: 'authoring', version: PROMPT_VERSION });
    });
  }

  const copyBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onclick: () => {
        if (!preview.value) {
          status.textContent = t('aiNoBrief');
          return;
        }
        void copy(preview.value, status, t('aiPromptCopied'));
        if (built) host.onPromptUsed({ promptId: 'authoring', version: PROMPT_VERSION });
      },
    },
    svgIcon('copy'),
    ' ',
    t('aiCopyPrompt'),
  );

  fixIt.addEventListener('click', () => {
    const cur = host.current();
    if (!cur) return;
    const repair = repairHandoff(cur.source, cur.diagnostics, host.locale(), allKnownVariables(host.campaign));
    void copy(handoffText(repair), status, t('aiFixItCopied'));
    host.onPromptUsed({ promptId: 'repair', version: repair.promptVersion });
  });

  const section = h(
    'details',
    { class: 'card card--soft ai-handoff' },
    h('summary', { class: 'ai-handoff__summary' }, svgIcon('zap'), ' ', t('aiSummary')),
    h(
      'div',
      { class: 'card__body' },
      h('p', { class: 'muted' }, t('aiIntroBuilt'), ' ', t('aiIntroPaste'), ' ', t('aiIntroOpenIn')),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('aiBriefLabel')), brief),
      h(
        'div',
        { class: 'template__toolbar' },
        channel,
        variation,
        h('label', { class: 'ai-handoff__check' }, samples, ' ', t('aiIncludeSamples')),
      ),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('aiPromptLabel')), preview),
      h('div', { class: 'card__actions ai-handoff__actions' }, copyBtn, openChatGpt, openClaude, fixIt),
      status,
    ),
  );

  return Object.assign(section, {
    /** Called by the template screen after each analysis. */
    setDiagnostics(diagnostics: Diagnostic[]): void {
      fixIt.hidden = !diagnostics.some((d) => d.severity === 'error');
    },
  });
}
