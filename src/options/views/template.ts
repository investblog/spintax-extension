/**
 * Template screen — spec §14.2 / §14.3 (paste, validate with knownVariables, three chip groups,
 * includes via "add file", preview with highlights). Prompt handoff buttons arrive with plan step 6.
 */
import { clear, flash, h } from '@/shared/dom';
import { dropdown } from '@/shared/dropdown';
import { hasLeftovers, leftoverHtml, mountEditor } from '@/shared/editor';
import {
  analyzeTemplate,
  buildContext,
  DERIVED_VARIABLES,
  ENGINE_VERSION,
  nearestVariable,
  PROFILE_VARIABLES,
  pickProfile,
  type RenderedText,
  type RenderWarning,
  renderRow,
  type TemplateAnalysis,
} from '@/shared/engine';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Campaign, Template, TemplateChannel } from '@/shared/model';
import { cleanPasted } from '@/shared/prompts';
import { findTemplate, listRows, updateCampaign, upsertTemplate } from '@/shared/repo';
import { playgroundUrl, spintaxFileName, studioUrl, varsPreset } from '@/shared/studio';
import { downloadBlob } from '../download';
import { notify } from '../state';
import { aiHandoffSection } from './ai-handoff';
import { stepsEditor } from './steps';

interface Draft {
  channel: TemplateChannel;
  step: number;
  locale: string;
  source: string;
  includes: Record<string, string>;
}

/** Group and severity codes stay codes (E2E, bug reports); only their labels are translated. */
const GROUP_KEYS = {
  target: 'varsGroupTarget',
  lang: 'varsGroupLang',
  column: 'varsGroupColumn',
  profile: 'varsGroupProfile',
  derived: 'varsGroupDerived',
  missing: 'varsGroupMissing',
} as const;
type VarGroup = keyof typeof GROUP_KEYS;
const SEVERITY_KEYS = { error: 'tplSeverityError', warning: 'tplSeverityWarning' } as const;

/** Unsaved editor text survives a view re-render (quick-action drawers call notify()). */
const unsaved = new Map<string, string>();
const draftKey = (campaignId: string, channel: string, step: number, locale: string): string =>
  `${campaignId}|${channel}|${step}|${locale}`;

export async function renderTemplateView(
  root: HTMLElement,
  campaign: Campaign,
  initial: { channel?: TemplateChannel; step?: number } = {},
): Promise<void> {
  clear(root);
  const draft: Draft = {
    channel: initial.channel ?? 'body',
    step: campaign.steps.some((s) => s.step === initial.step) ? (initial.step as number) : 1,
    locale: campaign.defaultLocale,
    source: '',
    includes: {},
  };

  const stepSel = dropdown({
    label: t('tplStep'),
    value: String(draft.step),
    options: campaign.steps.map((s) => ({
      value: String(s.step),
      label: s.kind === 'initial' ? t('tplStepInitial', String(s.step)) : t('tplStepFollowUp', String(s.step)),
    })),
    onChange: (v) => {
      draft.step = Number(v);
      void loadExisting();
    },
  });
  const channelSel = dropdown<TemplateChannel>({
    label: t('tplChannel'),
    value: draft.channel,
    options: [
      { value: 'body', label: t('tplChannelBody') },
      { value: 'subject', label: t('tplChannelSubject') },
    ],
    onChange: (v) => {
      draft.channel = v;
      void loadExisting();
    },
  });
  const localeInput = h('input', {
    class: 'input',
    value: draft.locale,
    'aria-label': t('tplLocaleAria'),
    placeholder: 'en',
  }) as HTMLInputElement;
  const source = h('textarea', {
    class: 'textarea template__source',
    rows: 12,
    spellcheck: 'false',
    placeholder: t('tplSourcePlaceholder'),
  }) as HTMLTextAreaElement;
  const editor = mountEditor(source);
  const fileInput = h('input', { type: 'file', class: 'input', accept: '.spintax,.txt' }) as HTMLInputElement;
  const includeInput = h('input', {
    type: 'file',
    class: 'input',
    accept: '.spintax,.txt',
    multiple: true,
  }) as HTMLInputElement;
  const includesList = h('div', { class: 'chips' });
  const diagnostics = h('div', { class: 'template__diagnostics' });
  const chips = h('div', { class: 'vars vars__rows' }); // structured variables (read-only rows)
  const varsRaw = h('textarea', {
    class: 'vars__raw hidden',
    rows: 6,
    readonly: true,
    'aria-label': t('tplVarsRawAria'),
  }) as HTMLTextAreaElement;
  const varsHint = h('p', { class: 'play__hint' });
  const preview = h('ol', { class: 'variants' }); // rendered rows, playground style
  const countInput = h('input', {
    type: 'number',
    class: 'input input--sm play__count',
    min: '1',
    max: '20',
    value: '3',
    'aria-label': t('tplRowsAria'),
  }) as HTMLInputElement;
  let previewSalt = 0;
  const errorBanner = h('div', { class: 'error-banner hidden', role: 'alert' });
  const tab = (label: string, mode: 'structured' | 'raw', active: boolean): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: `play__tab${active ? ' is-active' : ''}`,
        'aria-selected': String(active),
        'data-mode': mode,
      },
      label,
    ) as HTMLButtonElement;
  const tabStructured = tab(t('tplTabList'), 'structured', true);
  const tabRaw = tab(t('tplTabRaw'), 'raw', false);
  const setVarsMode = (mode: 'structured' | 'raw'): void => {
    const raw = mode === 'raw';
    chips.classList.toggle('hidden', raw);
    varsRaw.classList.toggle('hidden', !raw);
    tabStructured.classList.toggle('is-active', !raw);
    tabRaw.classList.toggle('is-active', raw);
    tabStructured.setAttribute('aria-selected', String(!raw));
    tabRaw.setAttribute('aria-selected', String(raw));
  };
  tabStructured.addEventListener('click', () => setVarsMode('structured'));
  tabRaw.addEventListener('click', () => setVarsMode('raw'));
  const copyRaw = h(
    'button',
    {
      type: 'button',
      class: 'btn-chip btn-chip--sm',
      title: t('tplCopyRawTitle'),
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(varsRaw.value);
          flash(status, t('tplVarsCopied'));
        } catch {
          status.textContent = t('tplClipboardBlocked');
        }
      },
    },
    svgIcon('copy'),
    ' ',
    t('tplCopy'),
  );
  const status = h('span', { class: 'muted', role: 'status' });
  const save = h(
    'button',
    { type: 'button', class: 'btn btn--primary', disabled: true },
    svgIcon('check'),
    ' ',
    t('tplSave'),
  ) as HTMLButtonElement;

  let analysis: TemplateAnalysis | null = null;
  let timer: number | undefined;
  let cachedRows: Awaited<ReturnType<typeof listRows>> = [];
  let promptOrigin: { promptId: string; version: string } | undefined;

  const handoff = aiHandoffSection({
    campaign,
    rows: () => cachedRows,
    locale: () => draft.locale,
    current: () => (analysis ? { source: draft.source, diagnostics: analysis.diagnostics } : null),
    onPromptUsed: (meta) => {
      promptOrigin = meta;
    },
  });

  const loadExisting = async (): Promise<void> => {
    const stored = await findTemplate(campaign.id, draft.channel, draft.step, draft.locale);
    const kept = unsaved.get(draftKey(campaign.id, draft.channel, draft.step, draft.locale));
    draft.source = kept ?? stored?.source ?? '';
    draft.includes = stored?.includes ?? {};
    source.value = draft.source;
    if (kept !== undefined && kept !== (stored?.source ?? '')) status.textContent = t('tplUnsavedRestored');
    editor.refresh([]);
    renderIncludes();
    schedule();
  };

  const renderIncludes = (): void => {
    clear(includesList);
    for (const name of Object.keys(draft.includes)) {
      includesList.append(
        h(
          'span',
          { class: 'btn-chip btn-chip--sm' },
          `#include ${name}`,
          h(
            'button',
            {
              type: 'button',
              class: 'btn-icon btn-icon--compact',
              'aria-label': t('tplRemoveInclude', name),
              onclick: () => {
                delete draft.includes[name];
                renderIncludes();
                schedule();
              },
            },
            svgIcon('close'),
          ),
        ),
      );
    }
    if (Object.keys(draft.includes).length === 0)
      includesList.append(h('span', { class: 'muted' }, t('tplNoIncludes')));
  };

  const schedule = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void analyzeNow(), 250);
  };

  const analyzeNow = async (): Promise<void> => {
    draft.source = source.value;
    draft.locale = localeInput.value.trim() || campaign.defaultLocale;
    if (draft.source.trim() === '') {
      analysis = null;
      editor.refresh([]);
      clear(diagnostics);
      clear(chips);
      clear(preview);
      status.textContent = '';
      save.disabled = true;
      return;
    }
    analysis = analyzeTemplate(draft.source, campaign, draft.locale, draft.includes);
    handoff.setDiagnostics(analysis.diagnostics);
    editor.refresh(analysis.diagnostics);
    renderDiagnostics(analysis);
    // rows first: the variables block shows sample values from the first row
    await renderPreview();
    renderChips(analysis);
    status.textContent =
      analysis.errors || analysis.warnings
        ? `${tn(analysis.errors, 'tplErrors')} · ${tn(analysis.warnings, 'tplWarnings')}`
        : '';
    status.title = t('tplEngineTitle', ENGINE_VERSION);
    save.disabled = analysis.errors > 0;
  };

  /** Engine codes in user words; the code itself stays in a title for bug reports. */
  const humanDiag = (d: TemplateAnalysis['diagnostics'][number]): string => {
    const name = typeof d.data?.name === 'string' ? d.data.name : null;
    if (d.code === 'variable.undefined')
      return name === null ? t('diagVariableUndefinedAnon') : t('diagVariableUndefined', name);
    if (/unclosed|unbalanced/.test(d.code)) return t('diagUnclosed', String(d.line));
    if (/empty/.test(d.code)) return t('diagEmptyAlternative', String(d.line));
    return d.message;
  };
  const renderDiagnostics = (a: TemplateAnalysis): void => {
    clear(diagnostics);
    if (a.diagnostics.length === 0) {
      diagnostics.append(
        h('div', { class: 'panel panel--success panel--compact' }, svgIcon('check-circle'), ' ', t('tplValid')),
      );
      return;
    }
    for (const d of a.diagnostics) {
      diagnostics.append(
        h(
          'div',
          {
            class: `panel panel--compact ${d.severity === 'error' ? 'panel--danger' : 'panel--warning'} template__diag`,
          },
          h(
            'span',
            { class: `badge badge--sm ${d.severity === 'error' ? 'badge--danger' : 'badge--warning'}` },
            t(SEVERITY_KEYS[d.severity]),
          ),
          h('code', { class: 'template__pos' }, `${d.line}:${d.column}`),
          h('span', { title: `${d.code}: ${d.message}` }, ` ${humanDiag(d)} `),
        ),
      );
    }
  };

  /** Variables block (playground layout, campaign data): name · sample value · state. */
  const renderChips = (a: TemplateAnalysis): void => {
    clear(chips);
    const used = new Set(a.resolved.map((v) => v.toLowerCase()));
    const sampleRow = cachedRows[0];
    const ctx = sampleRow ? buildContext(campaign, sampleRow, pickProfile(campaign, sampleRow)) : {};
    const known = campaign.columns.filter((c) => c.type === 'text').map((c) => c.variable);
    const row = (
      name: string,
      group: VarGroup,
      value: string,
      state: 'used' | 'unused' | 'missing',
      extra?: HTMLElement,
    ): HTMLElement => {
      const groupLabel = t(GROUP_KEYS[group]);
      return h(
        'div',
        { class: `vars__row vars__row--${state}` },
        h('span', { class: 'vars__group', title: groupLabel }, groupLabel),
        h('code', { class: 'vars__name' }, `%${name}%`),
        h(
          'span',
          { class: 'vars__value', title: value },
          value || (state === 'missing' ? t('tplVarNotInCampaign') : '—'),
        ),
        extra ??
          h(
            'span',
            { class: `flag ${state === 'used' ? 'flag--ok' : 'flag--muted'}` },
            state === 'used' ? t('tplVarUsed') : t('tplVarUnused'),
          ),
      );
    };
    const state = (name: string): 'used' | 'unused' => (used.has(name.toLowerCase()) ? 'used' : 'unused');
    for (const c of campaign.columns.filter((col) => !col.hidden && col.type === 'text'))
      chips.append(
        row(
          c.variable,
          c.role === 'target' ? 'target' : c.role === 'lang' ? 'lang' : 'column',
          ctx[c.variable] ?? '',
          state(c.variable),
        ),
      );
    for (const v of PROFILE_VARIABLES)
      if (ctx[v] || used.has(v)) chips.append(row(v, 'profile', ctx[v] ?? '', state(v)));
    for (const v of DERIVED_VARIABLES) chips.append(row(v, 'derived', ctx[v] ?? '', state(v)));
    for (const v of a.missing) {
      const near = nearestVariable(v, known);
      chips.append(
        row(
          v,
          'missing',
          '',
          'missing',
          near
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost btn--sm',
                  onclick: () => {
                    source.value = source.value.replace(
                      new RegExp(`%${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}%`, 'gi'),
                      `%${near}%`,
                    );
                    editor.refresh([]);
                    schedule();
                  },
                },
                t('tplRenameTo', near),
              )
            : h('span', { class: 'flag flag--warn', title: t('tplAddColumnTitle') }, t('tplVarAdd')),
        ),
      );
    }
    varsRaw.value = varsPreset(ctx);
    const constructs = Object.entries(a.constructs)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');
    const hint = [sampleRow ? t('tplVarsFromRow', sampleRow.seedKey) : t('tplVarsNoRows')];
    if (constructs) hint.push(t('tplVarsConstructs', constructs));
    varsHint.textContent = hint.join(' ');
  };

  /** Underline anything the engine left behind (a surviving %var%, a fullwidth brace). */
  const withLeftovers = (el: HTMLElement): HTMLElement => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      if (hasLeftovers(n.textContent ?? '')) nodes.push(n as Text);
    for (const n of nodes) {
      const span = h('span');
      span.innerHTML = leftoverHtml(n.textContent ?? '');
      n.replaceWith(...Array.from(span.childNodes));
    }
    return el;
  };

  const renderPreview = async (): Promise<void> => {
    clear(preview);
    errorBanner.classList.toggle('hidden', !(analysis && analysis.errors > 0));
    if (analysis && analysis.errors > 0) {
      const first = analysis.diagnostics.find((d) => d.severity === 'error');
      clear(errorBanner);
      errorBanner.append(
        h(
          'div',
          { class: 'error-banner__body' },
          h('span', { class: 'error-banner__title' }, t('tplErrorBannerTitle')),
          h('span', { class: 'error-banner__message' }, first?.message ?? ''),
        ),
      );
    }
    if (!analysis || analysis.errors > 0) return;
    cachedRows = (await listRows(campaign.id)).sort((x, y) => x.seedKey.localeCompare(y.seedKey)); // same order as List
    const count = Math.max(1, Math.min(20, Number(countInput.value) || 3));
    const rows = cachedRows.slice(0, count);
    if (rows.length === 0) {
      preview.append(h('li', { class: 'variants__empty' }, t('tplNoRows')));
      return;
    }
    const template: Template = {
      id: 'draft',
      campaignId: campaign.id,
      channel: draft.channel,
      step: draft.step,
      locale: draft.locale,
      source: draft.source,
      includes: draft.includes,
      engineVersion: ENGINE_VERSION,
    };
    for (const row of rows) {
      const spun = previewSalt ? { ...row, salt: row.salt + previewSalt } : row;
      const r = renderRow(campaign, spun, draft.step, { body: template });
      preview.append(
        h(
          'li',
          { class: 'variant' },
          h(
            'div',
            { class: 'variant__head' },
            row.seedKey,
            ' · ',
            h('span', { class: 'variant__seed' }, t('tplSeed', r.seed)),
            h(
              'button',
              {
                type: 'button',
                class: 'btn-icon btn-icon--compact variant__copy',
                'aria-label': t('tplCopyVariant'),
                title: t('tplCopyVariant'),
                onclick: async () => {
                  try {
                    await navigator.clipboard.writeText(r.body.text);
                    flash(status, t('tplVariantCopied'));
                  } catch {
                    status.textContent = t('tplClipboardBlocked');
                  }
                },
              },
              svgIcon('copy'),
            ),
          ),
          h('div', { class: 'variant__body' }, withLeftovers(highlighted(r.body)), warningsList(r.warnings)),
        ),
      );
    }
  };
  countInput.addEventListener('change', () => void renderPreview());
  const respin = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      title: t('tplRespinTitle'),
      onclick: () => {
        previewSalt++;
        void renderPreview();
      },
    },
    svgIcon('refresh'),
    ' ',
    t('tplRespin'),
  );

  localeInput.addEventListener('input', schedule);
  // A different locale is a different stored template: load it (typing alone only re-validates).
  localeInput.addEventListener('change', () => {
    draft.locale = localeInput.value.trim() || campaign.defaultLocale;
    void loadExisting();
  });
  source.addEventListener('input', () => {
    unsaved.set(draftKey(campaign.id, draft.channel, draft.step, draft.locale), source.value);
    schedule();
  });
  source.addEventListener('paste', () => {
    // Scrub what chats wrap answers in (fences, labels, emphasis) — after the paste lands.
    window.setTimeout(() => {
      const cleaned = cleanPasted(source.value);
      if (cleaned !== source.value) source.value = cleaned;
      schedule();
    }, 0);
  });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    source.value = await f.text();
    schedule();
  });
  includeInput.addEventListener('change', async () => {
    for (const f of Array.from(includeInput.files ?? [])) {
      const name = f.name.replace(/\.(spintax|txt)$/i, '');
      draft.includes[name] = await f.text();
    }
    renderIncludes();
    schedule();
  });
  save.addEventListener('click', async () => {
    if (!analysis || analysis.errors > 0) return;
    await upsertTemplate({
      campaignId: campaign.id,
      channel: draft.channel,
      step: draft.step,
      locale: draft.locale,
      source: draft.source,
      includes: draft.includes,
      engineVersion: ENGINE_VERSION,
      validatedAt: new Date().toISOString(),
      constructs: analysis.constructs,
      origin: promptOrigin,
      promptVersion: promptOrigin?.version,
    });
    unsaved.delete(draftKey(campaign.id, draft.channel, draft.step, draft.locale));
    if (campaign.wizardStep === 3) await updateCampaign(campaign.id, { wizardStep: 4 });
    status.textContent = t('tplSaved');
    notify();
  });

  const actions = h(
    'div',
    { class: 'card__actions' },
    save,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        title: t('tplPlaygroundTitle'),
        onclick: async () => {
          if (cachedRows.length === 0) cachedRows = await listRows(campaign.id);
          const row = cachedRows[0];
          const ctx = row ? buildContext(campaign, row, pickProfile(campaign, row)) : {};
          const url = playgroundUrl(draft.source, ctx, row ? `${row.seedKey}:${draft.step}` : undefined);
          if (!url) {
            status.textContent = t('tplTooLongForLink');
            return;
          }
          window.open(url, '_blank', 'noopener');
        },
      },
      svgIcon('open-in-new'),
      ' ',
      t('tplPlayground'),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        title: t('tplSaveFileTitle'),
        onclick: () =>
          downloadBlob(
            spintaxFileName(campaign.name, draft.channel, draft.step, draft.locale),
            new Blob([draft.source], { type: 'text/plain;charset=utf-8' }),
          ),
      },
      svgIcon('download'),
      ' ',
      t('tplSaveFile'),
    ),
    h(
      'a',
      {
        class: 'btn btn--ghost btn--sm',
        href: studioUrl(),
        target: '_blank',
        rel: 'noopener',
        title: t('tplStudioTitle'),
      },
      svgIcon('open-in-new'),
      ' ',
      t('tplStudioLink'),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        title: t('tplClearTitle'),
        onclick: () => {
          source.value = '';
          editor.refresh([]);
          schedule();
        },
      },
      t('tplClear'),
    ),
    status,
  );

  root.append(
    stepsEditor(campaign, (updated) => void renderTemplateView(root, updated)),
    h(
      'section',
      { class: 'card play' },
      h(
        'div',
        { class: 'card__body' },
        h(
          'div',
          { class: 'template__toolbar' },
          stepSel,
          channelSel,
          h('label', { class: 'template__locale' }, t('tplLocaleLabel'), ' ', localeInput),
        ),
        h(
          'div',
          { class: 'play__grid' },
          h(
            'section',
            { class: 'play__input', 'aria-label': t('tplTemplate') },
            h(
              'div',
              { class: 'play__block' },
              h('span', { class: 'play__block-label' }, t('tplTemplate')),
              editor.root,
              diagnostics,
              h(
                'div',
                { class: 'template__files' },
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('tplLoadFile')), fileInput),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('tplAddIncludes')), includeInput),
              ),
              includesList,
            ),
            h(
              'div',
              { class: 'play__block' },
              h(
                'div',
                { class: 'play__block-head' },
                h('span', { class: 'play__block-label' }, t('tplVariables')),
                h(
                  'div',
                  { class: 'play__controls' },
                  h(
                    'div',
                    { class: 'play__tabs', role: 'tablist', 'aria-label': t('tplVariables') },
                    tabStructured,
                    tabRaw,
                  ),
                  copyRaw,
                ),
              ),
              chips,
              varsRaw,
              varsHint,
            ),
          ),
          h(
            'section',
            { class: 'play__output', 'aria-label': t('tplVariants'), 'aria-live': 'polite' },
            h(
              'div',
              { class: 'play__block' },
              h(
                'div',
                { class: 'play__block-head' },
                h('span', { class: 'play__block-label' }, t('tplVariantsHead')),
                h(
                  'div',
                  { class: 'play__controls' },
                  h('label', { class: 'play__field' }, h('span', {}, t('tplRowsLabel')), countInput),
                  respin,
                ),
              ),
              errorBanner,
              preview,
            ),
          ),
        ),
        actions,
      ),
    ),
    handoff,
  );
  await loadExisting();
}

/** Render text with <mark> spans for substituted variables (spec §14.4). */
export function highlighted(r: RenderedText): HTMLElement {
  const out = h('p', { class: 'template__text' });
  let pos = 0;
  for (const hl of r.highlights) {
    if (hl.start > pos) out.append(r.text.slice(pos, hl.start));
    out.append(h('mark', { class: 'var-mark', title: `%${hl.variable}%` }, r.text.slice(hl.start, hl.end)));
    pos = hl.end;
  }
  if (pos < r.text.length) out.append(r.text.slice(pos));
  return out;
}

export function warningsList(warnings: RenderWarning[]): HTMLElement | null {
  if (warnings.length === 0) return null;
  return h(
    'ul',
    { class: 'template__warnings' },
    ...warnings.map((w) => {
      if (w.kind === 'emptyVariable') return h('li', { class: 'text-warning' }, t('tplWarnEmptyVariable', w.variable));
      if (w.kind === 'leakedMarkup') return h('li', { class: 'text-danger' }, t('tplWarnLeakedMarkup', w.sample));
      if (w.kind === 'renderError') return h('li', { class: 'text-danger' }, t('tplWarnRenderError', w.message));
      return h(
        'li',
        { class: w.level === 'blocking' ? 'text-danger' : 'text-warning' },
        `${w.constraint.kind}: ${w.actual}`,
      );
    }),
  );
}
