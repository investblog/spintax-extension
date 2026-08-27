/**
 * Campaign wizard — steps 1 (import) and 2 (roles & duplicates) of spec §14.6 / wireframes 1–2.
 * Steps 3–5 arrive with plan steps 5–8.
 */

import { clear, h } from '@/shared/dom';
import { dropdown } from '@/shared/dropdown';
import { mountEditor } from '@/shared/editor';
import { analyzeTemplate, ENGINE_VERSION, renderRow } from '@/shared/engine';
import { stripMetaColumns } from '@/shared/export-csv';
import { type MessageKey, t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import { decodeBytes, parseCsv } from '@/shared/import/csv';
import {
  buildColumns,
  type ConflictDecision,
  decisionsFor,
  ensureHeaders,
  type ImportedTable,
  matchColumns,
  mergeColumns,
  normalizeTable,
  planImport,
  type RowConflict,
  resolveConflict,
  summarize,
} from '@/shared/import/table';
import { parseXlsx } from '@/shared/import/xlsx';
import { variableNameFromHeader } from '@/shared/keys';
import type { Campaign, ColumnDef, Row } from '@/shared/model';
import { openSidePanel } from '@/shared/open-panel';
import { cleanPasted, columnNamingPrompt, parseColumnNames } from '@/shared/prompts';
import { findTemplate, listRows, putRows, updateCampaign, upsertTemplate } from '@/shared/repo';
import { openProfileDrawer } from '../quick-actions';
import { notify } from '../state';
import { severityOf } from './review';

/** The chips share one row at 1280 px: each caption has a 20-code-point budget (i18n-check). */
const STEPS: MessageKey[] = ['wizStepImport', 'wizStepRoles', 'wizStepProfile', 'wizStepProblems', 'wizStepQueue'];

/** The enum is the stored decision; the caption is a table, never derived from the code. */
const CHOICE_LABEL: Record<ConflictDecision, MessageKey> = {
  fillEmpty: 'wizChoiceFillEmpty',
  keep: 'wizChoiceKeep',
  take: 'wizChoiceTake',
};

/** Batch sizes for big lists (plan: measured on Chromium 2026-08-23, e2e/bench.mjs). */
const BATCH_DEFAULT = 1000;
const BATCH_MAX = 5000;

/** Imported table lives in memory between step 1 and 2 (re-import after a reload is cheap). */
let pending: { table: ImportedTable; columns: ColumnDef[]; sourceName: string } | null = null;

export function renderWizard(root: HTMLElement, campaign: Campaign, reload: () => void): void {
  clear(root);
  const current = campaign.wizardStep === 'done' ? 5 : campaign.wizardStep;
  const stepToShow = pending && current === 1 ? 2 : current;
  root.append(stepsBar(stepToShow, campaign));
  if (stepToShow === 1) root.append(importStep(campaign, reload));
  else if (stepToShow === 2) root.append(rolesStep(campaign, reload));
  else {
    const host = h('div', { class: 'view' });
    root.append(host);
    const step =
      stepToShow === 3
        ? stepProfileTemplate(campaign, reload)
        : stepToShow === 4
          ? stepProblems(campaign, reload)
          : Promise.resolve(stepQueue(campaign));
    void step.then((el) => host.append(el));
  }
}

function stepsBar(current: number, campaign: Campaign): HTMLElement {
  return h(
    'ol',
    { class: 'wizard-steps' },
    ...STEPS.map((key, i) => {
      const n = i + 1;
      const cls = n === current ? ' is-current' : n < current ? ' is-done' : '';
      const item = h('li', { class: `wizard-step${cls}` }, h('span', { class: 'wizard-step__num' }, String(n)), t(key));
      if (n < current || (n === 1 && campaign.columns.length > 0)) {
        item.classList.add('is-link');
        item.addEventListener('click', () => {
          if (n === 1) pending = null;
          updateCampaign(campaign.id, { wizardStep: n as 1 | 2 | 3 | 4 | 5 }).then(notify);
        });
      }
      return item;
    }),
  );
}

// ── Step 1: import ─────────────────────────────────────────────────────────────

function importStep(campaign: Campaign, reload: () => void): HTMLElement {
  const status = h('p', { class: 'field-hint', role: 'status' }, t('wizImportHint'));
  const preview = h('div', { class: 'import-preview' });
  const fileInput = h('input', { type: 'file', class: 'input', accept: '.csv,.tsv,.txt,.xlsx' }) as HTMLInputElement;
  const paste = h('textarea', {
    class: 'textarea',
    rows: 5,
    placeholder: t('wizPastePlaceholder'),
  }) as HTMLTextAreaElement;
  const sheetPick = h('div', { class: 'wizard__sheet', hidden: true });
  let sheets: { name: string; headers: string[]; rows: string[][] }[] = [];

  const showTable = (table: ImportedTable, sourceName: string): void => {
    // Our own CSV export carries _status/_key… columns: drop them, rows merge by key (step 15).
    table = normalizeTable(stripMetaColumns(table));
    // CRM exports often have no header row: the first contact would become the headers.
    const ensured = ensureHeaders(table);
    table = ensured.table;
    if (table.headers.length === 0 || table.rows.length === 0) {
      status.textContent = t('wizNoRowsFound');
      clear(preview);
      return;
    }
    const columns = campaign.columns.length > 0 ? matchColumns(campaign.columns, table.headers) : buildColumns(table);
    const full = table;
    // Whole sentences, joined by a space in code: a leading space inside a message does not survive
    // translation, and the parts move in German and Russian.
    const note = ensured.synthesized
      ? t('wizNoHeaderRow')
      : ensured.skipped > 0
        ? tn(ensured.skipped, 'wizSkippedTitleRows')
        : '';
    // A queue is walked by hand: a 40 000-row file is imported in batches (measured 2026-08-23:
    // the screens stay instant up to BATCH_MAX rows). The rest stays in the file; the next batch
    // merges by key when the file is loaded again.
    let start = 0;
    let size = Math.min(full.rows.length, BATCH_DEFAULT);
    const applyBatch = (): void => {
      size = Math.max(1, Math.min(size, BATCH_MAX));
      start = Math.max(0, Math.min(start, full.rows.length - 1));
      const slice = { headers: full.headers, rows: full.rows.slice(start, start + size) };
      pending = { table: slice, columns, sourceName };
      clear(preview);
      if (full.rows.length > BATCH_DEFAULT) {
        const startInput = h('input', {
          class: 'input input--sm',
          type: 'number',
          min: '1',
          max: String(full.rows.length),
          value: String(start + 1),
          'aria-label': t('wizBatchFirstAria'),
        }) as HTMLInputElement;
        const sizeInput = h('input', {
          class: 'input input--sm',
          type: 'number',
          min: '1',
          max: String(BATCH_MAX),
          value: String(size),
          'aria-label': t('wizBatchSizeAria'),
        }) as HTMLInputElement;
        const reapply = (): void => {
          start = Number(startInput.value) - 1 || 0;
          size = Number(sizeInput.value) || BATCH_DEFAULT;
          applyBatch();
        };
        startInput.addEventListener('change', reapply);
        sizeInput.addEventListener('change', reapply);
        preview.append(
          h(
            'div',
            { class: 'panel panel--info batch' },
            h(
              'p',
              {},
              // The count is grouped for the locale, so it travels as text; `tn` only picks the form.
              h('strong', {}, tn(full.rows.length, 'wizFileRows', full.rows.length.toLocaleString())),
              ' ',
              t('wizBatchIntro'),
            ),
            h(
              'div',
              { class: 'batch__row' },
              t('wizBatchRowsLabel'),
              ' ',
              startInput,
              ' ',
              t('wizBatchTo'),
              ' ',
              h('strong', {}, String(Math.min(start + size, full.rows.length))),
              ' · ',
              t('wizBatchSizeLabel'),
              ' ',
              sizeInput,
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn-chip btn-chip--sm',
                  onclick: () => {
                    start = 0;
                    applyBatch();
                  },
                },
                t('wizBatchFirst', String(BATCH_DEFAULT)),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn-chip btn-chip--sm',
                  disabled: start + size >= full.rows.length,
                  onclick: () => {
                    start = Math.min(start + size, full.rows.length - 1);
                    applyBatch();
                  },
                },
                t('wizBatchNext', String(size)),
              ),
              h('span', { class: 'muted' }, t('wizBatchMax', BATCH_MAX.toLocaleString())),
            ),
          ),
        );
      }
      const sentences = [
        t('wizImportedCounts', sourceName, tn(full.rows.length, 'wizRows'), tn(full.headers.length, 'wizColumns')),
        note,
      ];
      if (full.rows.length > BATCH_DEFAULT)
        sentences.push(t('wizBatchRange', String(start + 1), String(Math.min(start + size, full.rows.length))));
      status.textContent = sentences.filter(Boolean).join(' ');
      preview.append(previewTable(slice, 5));
      const next = h(
        'div',
        { class: 'card__actions' },
        h(
          'button',
          { type: 'button', class: 'btn btn--primary', onclick: () => reload() },
          tn(slice.rows.length, 'wizContinueRoles'),
          ' ',
          svgIcon('arrow-right'),
        ),
      );
      preview.append(next);
    };
    applyBatch();
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      if (/\.xlsx$/i.test(file.name)) {
        sheets = parseXlsx(bytes);
        if (sheets.length > 1) {
          clear(sheetPick);
          sheetPick.append(
            h('span', { class: 'field-label' }, t('wizSheetLabel')),
            dropdown({
              label: t('wizSheetLabel'),
              value: '0',
              width: 'auto',
              options: sheets.map((s, i) => ({
                value: String(i),
                label: tn(s.rows.length, 'wizSheetOption', s.name),
              })),
              onChange: (v) => {
                const s = sheets[Number(v)];
                if (s) showTable(s, `${file.name} › ${s.name}`);
              },
            }),
          );
          sheetPick.hidden = false;
        } else sheetPick.hidden = true;
        const first = sheets[0];
        if (first) showTable(first, `${file.name} › ${first.name}`);
      } else {
        showTable(parseCsv(decodeBytes(bytes)), file.name);
      }
    } catch (err) {
      status.textContent = t('wizFileError', (err as Error).message);
    }
  });
  paste.addEventListener('input', () => {
    const text = paste.value;
    if (text.trim().length === 0) return;
    showTable(parseCsv(text), t('wizPastedTable'));
  });

  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card__body' },
      h('h2', { class: 'card__title' }, t('wizStep1Title')),
      status,
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('wizFileLabel')), fileInput, sheetPick),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, t('wizOrPasteLabel')), paste),
      preview,
    ),
  );
}

function previewTable(table: ImportedTable, limit: number): HTMLElement {
  return h(
    'div',
    { class: 'table-scroll' },
    h(
      'table',
      { class: 'table' },
      h('thead', {}, h('tr', {}, ...table.headers.map((hd) => h('th', {}, hd)))),
      h('tbody', {}, ...table.rows.slice(0, limit).map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c))))),
    ),
  );
}

// ── Step 2: roles & duplicates ─────────────────────────────────────────────────

function rolesStep(campaign: Campaign, reload: () => void): HTMLElement {
  if (!pending) {
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'card__body' }, h('p', { class: 'muted' }, t('wizNothingImported'))),
    );
  }
  const { table } = pending;
  const columns = pending.columns;
  const body = h('div', { class: 'card__body' });
  const card = h('section', { class: 'card' }, body);
  const decisions = new Map<string, ConflictDecision>();

  const render = async (): Promise<void> => {
    clear(body);
    body.append(h('h2', { class: 'card__title' }, t('wizStep2Title')));
    body.append(rolesTable(table, columns, () => void render()));
    body.append(namingHelper(table, columns, () => void render()));
    body.append(chips(table, columns));

    const existing = await listRows(campaign.id);
    const scenarioCampaign = { ...campaign, columns };
    const plan = planImport(scenarioCampaign, existing, table, columns);
    const sum = summarize(plan);
    body.append(
      h(
        'p',
        { class: 'import-summary' },
        // One line of six labelled counters, read left to right — one key, six named placeholders.
        tn(
          sum.total,
          'wizImportSummary',
          String(sum.add),
          String(sum.update),
          String(sum.mergedInFile),
          String(sum.exact),
          String(sum.excluded),
        ),
      ),
    );
    if (!columns.some((c) => c.role === 'target')) {
      body.append(h('div', { class: 'panel panel--danger panel--compact' }, t('wizNoTargetColumn')));
    }
    if (plan.conflicts.length > 0) body.append(conflictsList(plan.conflicts, columns, decisions));

    const apply = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        disabled: !columns.some((c) => c.role === 'target') || sum.add + sum.update === 0,
        onclick: async () => {
          const targetId = columns.find((c) => c.role === 'target')?.id;
          const resolved: Row[] = plan.conflicts.map((c) => resolveConflict(c, decisionsFor(c, decisions), targetId));
          await putRows([...plan.add, ...resolved]);
          // Existing columns are never dropped: stored rows refer to their ids (review 2026-08-23 #1).
          await updateCampaign(campaign.id, { columns: mergeColumns(campaign.columns, columns), wizardStep: 3 });
          pending = null;
          notify();
          reload();
        },
      },
      svgIcon('check'),
      ' ',
      t('wizApplyImport', String(sum.add + sum.update)),
    );
    body.append(h('div', { class: 'card__actions' }, apply));
  };
  void render();
  return card;
}

/** Rename a column: header + variable name (unique among the others). */
function renameColumn(columns: ColumnDef[], col: ColumnDef, header: string): void {
  const name = header.trim();
  if (!name || name === col.header) return;
  col.header = name;
  col.variable = variableNameFromHeader(name, new Set(columns.filter((c) => c !== col).map((c) => c.variable)));
}

/** Copy a "name these columns" prompt for an AI chat and paste the one-line answer back. */
function namingHelper(table: ImportedTable, columns: ColumnDef[], onChange: () => void): HTMLElement {
  const status = h('span', { class: 'muted', role: 'status' });
  const paste = h('input', {
    class: 'input',
    placeholder: t('wizNamingPastePlaceholder'),
    'aria-label': t('wizNamingPasteAria'),
  }) as HTMLInputElement;
  const apply = (): void => {
    const names = parseColumnNames(paste.value, columns.length);
    if (!names) {
      status.textContent = tn(columns.length, 'wizNamingExpected');
      return;
    }
    names.forEach((n, i) => {
      const col = columns[i];
      if (col) renameColumn(columns, col, n);
    });
    paste.value = '';
    onChange();
  };
  paste.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });
  return h(
    'div',
    { class: 'naming-helper' },
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onclick: async () => {
          // The prompt itself is sent to a model — engine vocabulary, English (spec: exports stay English).
          const prompt = columnNamingPrompt(
            columns.map((c) => c.header),
            table.rows,
          );
          try {
            await navigator.clipboard.writeText(prompt);
            status.textContent = t('wizPromptCopied');
          } catch {
            status.textContent = t('wizClipboardBlocked');
          }
        },
      },
      svgIcon('copy'),
      ' ',
      t('wizCopyNamingPrompt'),
    ),
    paste,
    h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: apply }, t('wizApplyNames')),
    status,
  );
}

function rolesTable(table: ImportedTable, columns: ColumnDef[], onChange: () => void): HTMLElement {
  const headerInput = (col: ColumnDef): HTMLInputElement => {
    const input = h('input', {
      class: 'input input--sm th-name',
      value: col.header,
      'aria-label': t('wizColumnNameAria'),
      title: t('wizVariableTitle', col.variable),
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      renameColumn(columns, col, input.value);
      onChange();
    });
    return input;
  };
  const roleSelect = (col: ColumnDef): HTMLElement =>
    dropdown<ColumnDef['role']>({
      label: t('wizRoleFor', col.header),
      value: col.role,
      size: 'sm',
      width: 'auto',
      options: [
        { value: 'none', label: t('wizRoleNone'), hint: t('wizRoleNoneHint') },
        { value: 'target', label: t('wizRoleTarget'), hint: t('wizRoleTargetHint') },
        { value: 'lang', label: t('wizRoleLang'), hint: t('wizRoleLangHint') },
        { value: 'key', label: t('wizRoleKey'), hint: t('wizRoleKeyHint') },
      ],
      onChange: (role) => {
        if (role !== 'none') for (const other of columns) if (other !== col && other.role === role) other.role = 'none';
        col.role = role;
        onChange();
      },
    });
  return h(
    'div',
    { class: 'table-scroll roles-scroll' },
    h(
      'table',
      { class: 'table' },
      h(
        'thead',
        {},
        h('tr', {}, ...columns.map((c) => h('th', {}, h('div', { class: 'th-stack' }, headerInput(c), roleSelect(c))))),
      ),
      h('tbody', {}, ...table.rows.slice(0, 3).map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c))))),
    ),
  );
}

function chips(table: ImportedTable, columns: ColumnDef[]): HTMLElement {
  return h(
    'div',
    { class: 'chips' },
    ...columns.map((c, i) => {
      const values = table.rows.map((r) => r[i] ?? '');
      const empty = values.filter((v) => v.trim() === '').length;
      const pct = values.length ? Math.round((empty / values.length) * 100) : 0;
      const sample = values.find((v) => v.trim() !== '') ?? '';
      return h(
        'span',
        {
          class: `btn-chip btn-chip--sm${pct > 0 ? ' chip--warn' : ''}`,
          title: sample ? t('wizSampleValue', sample) : t('wizNoValues'),
        },
        // `%name%` is engine vocabulary, not a caption — it stays as it is in every language.
        `%${c.variable}%`,
        pct > 0 ? h('span', { class: 'badge badge--warning badge--sm' }, t('wizEmptyPct', String(pct))) : null,
      );
    }),
  );
}

function conflictsList(
  conflicts: RowConflict[],
  columns: ColumnDef[],
  decisions: Map<string, ConflictDecision>,
): HTMLElement {
  const byId = new Map(columns.map((c) => [c.id, c]));
  return h(
    'div',
    { class: 'conflicts' },
    h('h3', { class: 'conflicts__title' }, tn(conflicts.length, 'wizConflicts')),
    ...conflicts.map((c) =>
      h(
        'div',
        { class: 'panel panel--warning panel--compact conflict' },
        h(
          'div',
          { class: 'conflict__key' },
          c.existing.seedKey,
          ' · ',
          t(c.inFile ? 'wizConflictTwiceInFile' : 'wizConflictAlreadyInCampaign'),
        ),
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, t('wizConflictColField')),
              h('th', {}, t('wizConflictColCampaign')),
              h('th', {}, t('wizConflictColFile')),
              h('th', {}, t('wizConflictColAction')),
            ),
          ),
          h(
            'tbody',
            {},
            ...[...c.diffs, ...c.fillable].map((id) => {
              const key = `${c.existing.rowId}:${id}`;
              const isFill = c.fillable.includes(id);
              const pick = (d: ConflictDecision): HTMLElement =>
                h(
                  'label',
                  { class: 'conflict__choice' },
                  h('input', {
                    type: 'radio',
                    name: key,
                    value: d,
                    checked: (decisions.get(key) ?? (isFill ? 'fillEmpty' : 'keep')) === d,
                    onchange: () => decisions.set(key, d),
                  }),
                  ' ',
                  t(CHOICE_LABEL[d]),
                );
              return h(
                'tr',
                {},
                h('td', {}, byId.get(id)?.header ?? id),
                h('td', {}, c.existing.values[id] ?? ''),
                h('td', {}, c.incoming.values[id] ?? ''),
                h('td', {}, isFill ? pick('fillEmpty') : pick('keep'), isFill ? null : pick('take')),
              );
            }),
          ),
        ),
      ),
    ),
  );
}

async function stepProfileTemplate(campaign: Campaign, reload: () => void): Promise<HTMLElement> {
  const profiles = h('div', { class: 'stack stack--sm' });
  if (campaign.profiles.length === 0) profiles.append(h('p', { class: 'muted' }, t('wizNoProfile')));
  else
    profiles.append(
      ...campaign.profiles.map((p) =>
        h(
          'div',
          { class: 'chips' },
          h('span', { class: 'btn-chip btn-chip--sm' }, p.name),
          h('span', { class: 'muted' }, [p.values.name, p.values.email, p.values.site].filter(Boolean).join(' · ')),
        ),
      ),
    );
  const profileCard = h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card__body' },
      h('h2', { class: 'card__title' }, t('wizWhoWrites')),
      profiles,
      h(
        'div',
        { class: 'card__actions' },
        h(
          'button',
          {
            type: 'button',
            class: campaign.profiles.length === 0 ? 'btn btn--primary' : 'btn btn--ghost',
            onclick: () => openProfileDrawer(campaign, () => reload()),
          },
          svgIcon('user'),
          ' ',
          t(campaign.profiles.length === 0 ? 'wizAddProfile' : 'wizAddAnotherProfile'),
        ),
        h('a', { class: 'btn btn--ghost', href: '#profiles' }, t('wizManageProfiles')),
      ),
    ),
  );

  const existing = await findTemplate(campaign.id, 'body', 1, campaign.defaultLocale);
  const status = h('p', { class: 'field-hint', role: 'status' });
  const continueBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onclick: async () => {
        await updateCampaign(campaign.id, { wizardStep: 4 });
        reload();
      },
    },
    t('wizContinueProblems'),
    ' ',
    svgIcon('arrow-right'),
  );
  let templateBody: HTMLElement;
  if (existing) {
    templateBody = h(
      'div',
      { class: 'stack stack--sm' },
      h(
        'pre',
        { class: 'wizard__template' },
        existing.source.slice(0, 600) + (existing.source.length > 600 ? '…' : ''),
      ),
      h(
        'div',
        { class: 'card__actions' },
        continueBtn,
        h('a', { class: 'btn btn--ghost', href: '#template' }, svgIcon('pencil-circle'), ' ', t('wizEditFullEditor')),
      ),
    );
  } else {
    const source = h('textarea', {
      class: 'textarea template__source',
      rows: 7,
      spellcheck: 'false',
      placeholder: (() => {
        const vars = campaign.columns
          .filter((c) => c.role === 'none' && !c.hidden && c.type === 'text')
          .map((c) => c.variable);
        const [v1 = 'name', v2 = 'topic'] = vars;
        return t('wizTemplatePlaceholder', v1, v2);
      })(),
    }) as HTMLTextAreaElement;
    const save = h(
      'button',
      { type: 'button', class: 'btn btn--primary', disabled: true },
      svgIcon('check'),
      ' ',
      t('wizSaveTemplate'),
    ) as HTMLButtonElement;
    const editor = mountEditor(source);
    let analysis: ReturnType<typeof analyzeTemplate> | null = null;
    const check = (): void => {
      const text = cleanPasted(source.value);
      if (!text.trim()) {
        analysis = null;
        editor.refresh([]);
        save.disabled = true;
        status.textContent = '';
        return;
      }
      analysis = analyzeTemplate(text, campaign, campaign.defaultLocale);
      editor.refresh(analysis.diagnostics);
      save.disabled = analysis.errors > 0;
      status.textContent =
        analysis.errors > 0
          ? tn(
              analysis.errors,
              'wizErrors',
              analysis.diagnostics
                .filter((d) => d.severity === 'error')
                .map((d) => d.message)
                .slice(0, 2)
                .join('; '),
            )
          : analysis.missing.length > 0
            ? t('wizUnknownVars', analysis.missing.map((m) => `%${m}%`).join(', '))
            : t('wizTemplateValid', analysis.resolved.map((m) => `%${m}%`).join(', ') || t('wizVarsNone'));
    };
    source.addEventListener('input', check);
    save.addEventListener('click', async () => {
      if (!analysis || analysis.errors > 0) return;
      await upsertTemplate({
        campaignId: campaign.id,
        channel: 'body',
        step: 1,
        locale: campaign.defaultLocale,
        source: cleanPasted(source.value),
        includes: {},
        engineVersion: ENGINE_VERSION,
        validatedAt: new Date().toISOString(),
        constructs: analysis.constructs,
      });
      await updateCampaign(campaign.id, { wizardStep: 4 });
      reload();
    });
    templateBody = h(
      'div',
      { class: 'stack stack--sm' },
      h(
        'p',
        { class: 'muted' },
        // The `%name%` list is engine vocabulary; only the sentence around it is translated.
        t(
          'wizSpintaxVars',
          campaign.columns
            .filter((c) => c.role === 'none' && !c.hidden)
            .slice(0, 6)
            .map((c) => `%${c.variable}%`)
            .join(' ') + (campaign.profiles.length ? ' %my_name% %my_email%' : ''),
        ),
      ),
      editor.root,
      status,
      h(
        'div',
        { class: 'card__actions' },
        save,
        h('a', { class: 'btn btn--ghost', href: '#template' }, svgIcon('pencil-circle'), ' ', t('wizFullEditorLink')),
      ),
    );
  }
  const templateCard = h(
    'section',
    { class: 'card' },
    h('div', { class: 'card__body' }, h('h2', { class: 'card__title' }, t('wizWhatIsWritten')), templateBody),
  );
  return h('div', { class: 'stack stack--md' }, profileCard, templateCard);
}

async function stepProblems(campaign: Campaign, reload: () => void): Promise<HTMLElement> {
  const rows = await listRows(campaign.id);
  const template = await findTemplate(campaign.id, 'body', 1, campaign.defaultLocale);
  let blockers = 0;
  let warnings = 0;
  const CHECK_LIMIT = 5000;
  const checked = rows.slice(0, CHECK_LIMIT);
  if (template)
    for (const row of checked) {
      const r = renderRow(campaign, row, 1, { body: template });
      const sev = severityOf(r.warnings, row, campaign);
      if (sev === 'blocker') blockers++;
      else if (sev === 'warning') warnings++;
    }
  const clean = checked.length - blockers - warnings;
  const unchecked = rows.length - checked.length;
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card__body' },
      h('h2', { class: 'card__title' }, t('wizStep4Title')),
      template
        ? h(
            'div',
            { class: 'chips' },
            h(
              'span',
              { class: `btn-chip btn-chip--sm${blockers ? ' chip--danger' : ''}` },
              t('wizChipBlocking', String(blockers)),
            ),
            h(
              'span',
              { class: `btn-chip btn-chip--sm${warnings ? ' chip--warn' : ''}` },
              t('wizChipWarnings', String(warnings)),
            ),
            h('span', { class: 'btn-chip btn-chip--sm chip--ok' }, t('wizChipClean', String(clean))),
            unchecked > 0
              ? h('span', { class: 'btn-chip btn-chip--sm chip--warn' }, t('wizChipUnchecked', String(unchecked)))
              : null,
          )
        : h('p', { class: 'muted' }, t('wizNoTemplate')),
      h('p', { class: 'muted' }, t('wizBlockingExplain')),
      h(
        'div',
        { class: 'card__actions' },
        h(
          'a',
          { class: blockers ? 'btn btn--primary' : 'btn btn--ghost', href: '#review' },
          svgIcon('check-circle'),
          ' ',
          blockers + warnings ? tn(blockers + warnings, 'wizReviewCount') : t('wizReviewAll'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: blockers ? 'btn btn--ghost' : 'btn btn--primary',
            onclick: async () => {
              await updateCampaign(campaign.id, { wizardStep: 5 });
              reload();
            },
          },
          t('wizContinueQueue'),
          ' ',
          svgIcon('arrow-right'),
        ),
      ),
    ),
  );
}

function stepQueue(campaign: Campaign): HTMLElement {
  const open = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onclick: async () => {
        await openSidePanel();
        await updateCampaign(campaign.id, { wizardStep: 'done' });
      },
    },
    svgIcon('dock-right'),
    ' ',
    t('wizOpenSidePanel'),
  );
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card__body' },
      h('h2', { class: 'card__title' }, t('wizStep5Title')),
      h(
        'ol',
        { class: 'wizard__howto' },
        h('li', {}, t('wizHowto1')),
        // The bold parts quote the side panel's own buttons; each sentence around them is one key.
        h(
          'li',
          {},
          h('strong', {}, t('wizHowtoOpenTarget')),
          ' ',
          t('wizHowtoOpens'),
          ' ',
          h('strong', {}, t('wizHowtoFillOnSite')),
          ' ',
          t('wizHowtoFilled'),
        ),
        h('li', {}, h('strong', {}, t('wizHowtoSentNext')), ' ', t('wizHowtoRecords')),
        h('li', {}, t('wizHowtoShortcuts')),
      ),
      h('div', { class: 'card__actions' }, open, h('a', { class: 'btn btn--ghost', href: '#list' }, t('wizSeeList'))),
    ),
  );
}
