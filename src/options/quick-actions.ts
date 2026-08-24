/**
 * Quick actions in drawers — things a user needs mid-flow without leaving the screen they are
 * on (spec §14, "convenient for the user"): add a sender profile, paste a few more rows, upload
 * files for file columns. Each saves on its own and refreshes the current view via notify().
 */
import { exportCampaignZip, importCampaignZip } from '@/shared/backup';
import { clear, h } from '@/shared/dom';
import { openDrawer } from '@/shared/drawer';
import { csvFileName, stripMetaColumns } from '@/shared/export-csv';
import { fmtSize } from '@/shared/format';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import { parseCsv } from '@/shared/import/csv';
import {
  decisionsFor,
  ensureHeaders,
  type ImportPlan,
  matchColumns,
  mergeColumns,
  normalizeTable,
  planImport,
  resolveConflict,
  summarize,
} from '@/shared/import/table';
import { detectTargetKind } from '@/shared/keys';
import type { Campaign, ColumnDef, Profile, Row } from '@/shared/model';
import { listRows, putAsset, putRows, updateCampaign, uuid } from '@/shared/repo';
import { downloadBlob } from './download';
import { ensureCampaign, notify, selectCampaign } from './state';
import { imageDims } from './views/assets';
import { PROFILE_FIELDS } from './views/profiles';

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label' }, label),
    control,
    hint ? h('p', { class: 'field-hint' }, hint) : null,
  );
}

// ── Add a sender profile ───────────────────────────────────────────────────────

export function openProfileDrawer(campaign: Campaign, onSaved?: (c: Campaign) => void): void {
  const first = campaign.profiles.length === 0;
  const profile: Profile = {
    id: uuid(),
    name: first ? 'Default' : `Profile ${campaign.profiles.length + 1}`,
    values: { name: '', email: '' },
    activation: first ? { kind: 'always' } : { kind: 'urlPattern', pattern: '' },
  };
  const label = h('input', {
    class: 'input',
    value: profile.name,
    'aria-label': t('drwProfileLabel'),
  }) as HTMLInputElement;
  const inputs = PROFILE_FIELDS.map((f) => {
    const el = (
      f.multiline
        ? h('textarea', { class: 'textarea', rows: 2 })
        : h('input', { class: 'input', type: f.key === 'email' ? 'email' : 'text' })
    ) as HTMLInputElement | HTMLTextAreaElement;
    el.addEventListener('input', () => {
      profile.values[f.key] = el.value;
    });
    return field(`${f.label} — %${f.variable}%`, el);
  });
  const pattern = h('input', {
    class: 'input',
    placeholder: t('drwProfilePatternPlaceholder'),
    'aria-label': t('drwProfilePatternAria'),
  }) as HTMLInputElement;
  const status = h('p', { class: 'field-hint', role: 'status' });
  const save = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onclick: async () => {
        profile.name = label.value.trim() || profile.name;
        if (!profile.values.name.trim() && !profile.values.email.trim()) {
          status.textContent = t('drwProfileNeedsContact');
          return;
        }
        if (!first) profile.activation = { kind: 'urlPattern', pattern: pattern.value.trim() };
        const updated = await updateCampaign(campaign.id, { profiles: [...campaign.profiles, profile] });
        handle.close();
        notify();
        onSaved?.(updated);
      },
    },
    svgIcon('check'),
    ' ',
    t('drwProfileSave'),
  );
  const handle = openDrawer({
    title: first ? t('drwProfileTitle') : t('drwProfileTitleMore'),
    subtitle: first ? t('drwProfileSubtitle') : t('drwProfileSubtitleMore'),
    body: h(
      'div',
      { class: 'stack stack--md' },
      field(t('drwProfileLabel'), label, t('drwProfileLabelHint')),
      ...inputs,
      first ? null : field(t('drwProfilePattern'), pattern, t('drwProfilePatternHint')),
      status,
    ),
    footer: [
      save,
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => handle.close() }, t('drwProfileCancel')),
    ],
  });
}

// ── Add rows (paste) ───────────────────────────────────────────────────────────

export function openRowsDrawer(initial: Campaign, onSaved?: () => void): void {
  // The drawer stays open across adds: the campaign it works on must be the LIVE one, otherwise
  // a second paste cannot see the columns the first one created and would orphan their cells.
  let campaign = initial;
  // Say what THIS campaign expects: its target kind and its columns, so a paste is never a guess.
  const targetHeader = () => campaign.columns.find((c) => c.role === 'target')?.header ?? 'target';
  // The scenario picks a whole sentence, not a noun: "site" and "site or e-mail" decline.
  const submitOnly = () => campaign.scenario === 'submit';
  const columnNames = () =>
    campaign.columns
      .filter((c) => !c.hidden)
      .map((c) => c.header)
      .join(' · ');
  const paste = h('textarea', {
    class: 'textarea',
    rows: 8,
    // A campaign with no columns has no list to name: the sentence would read "with the columns ;".
    placeholder: columnNames()
      ? t(submitOnly() ? 'drwRowsPasteSubmit' : 'drwRowsPasteMail', columnNames())
      : t('drwRowsPasteNoColumns'),
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const summary = h('p', { class: 'field-hint', role: 'status' });
  let plan: ImportPlan | null = null;
  let columns: ColumnDef[] = [];
  let analysed = 0; // token: only the newest analysis may publish a plan

  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      disabled: true,
      onclick: async () => {
        if (!plan) return;
        const targetId = columns.find((c) => c.role === 'target')?.id;
        const resolved: Row[] = plan.conflicts.map((c) => resolveConflict(c, decisionsFor(c, new Map()), targetId));
        await putRows([...plan.add, ...resolved]);
        const known = new Set(campaign.columns.map((c) => c.id));
        const fresh = columns.filter((c) => !known.has(c.id));
        if (fresh.length > 0)
          campaign = await updateCampaign(campaign.id, { columns: mergeColumns(campaign.columns, columns) });
        // Stay open with the result in view — the list behind re-renders, the drawer says what happened.
        const added = plan.add.length;
        const updated = resolved.length;
        plan = null;
        paste.value = '';
        add.disabled = true;
        summary.textContent = [
          tn(added, 'drwRowsAdded'),
          updated ? tn(updated, 'drwRowsUpdated') : '',
          fresh.length ? tn(fresh.length, 'drwRowsNewColumns', fresh.map((c) => c.header).join(', ')) : '',
          t('drwRowsPasteMore'),
        ]
          .filter(Boolean)
          .join(' ');
        summary.classList.add('is-flash');
        notify();
        onSaved?.();
      },
    },
    svgIcon('plus'),
    ' ',
    t('drwRowsAdd'),
  ) as HTMLButtonElement;

  const analyse = async (): Promise<void> => {
    const token = ++analysed;
    const text = paste.value;
    if (!text.trim()) {
      summary.textContent = '';
      return;
    }
    const table = ensureHeaders(normalizeTable(stripMetaColumns(parseCsv(text)))).table;
    let cols = campaign.columns.length > 0 ? matchColumns(campaign.columns, table.headers) : [];
    // A bare list of sites / e-mails (one column, no header) is the commonest paste: it is the target.
    const targetCol = campaign.columns.find((c) => c.role === 'target');
    if (targetCol && table.headers.length === 1 && !cols.some((c) => c.role === 'target')) {
      const values = table.rows.map((r) => r[0] ?? '').filter((v) => v.trim());
      const hits = values.filter((v) => detectTargetKind(v) !== 'unknown').length;
      if (values.length > 0 && hits / values.length >= 0.6) cols = [targetCol];
    }
    if (cols.length === 0 || !cols.some((c) => c.role === 'target')) {
      // Same reason: without columns the hint would end in an empty pair of brackets, and the
      // honest answer is that the wizard, not this drawer, sets a new campaign up.
      summary.textContent = columnNames()
        ? `${t(submitOnly() ? 'drwRowsNoTargetSubmit' : 'drwRowsNoTargetMail')} ${t('drwRowsNoTargetHint', targetHeader(), columnNames())}`
        : t('drwRowsNoColumnsHint');
      return;
    }
    const existing = await listRows(campaign.id);
    if (token !== analysed) return; // the text changed meanwhile
    const p = planImport({ ...campaign, columns: cols }, existing, table, cols);
    const s = summarize(p);
    const conflicting = p.conflicts.filter((c) => c.diffs.length > 0).length;
    const fills = p.conflicts.filter((c) => c.fillable.length > 0).length;
    const planText = tn(
      table.rows.length,
      'drwRowsPlan',
      String(s.add),
      String(fills),
      String(p.exactDuplicates.length),
      String(p.excluded.length),
    );
    summary.textContent = conflicting > 0 ? `${planText} ${tn(conflicting, 'drwRowsPlanConflict')}` : planText;
    plan = p;
    columns = cols;
    add.disabled = s.add + s.update === 0;
  };
  let timer: number | undefined;
  paste.addEventListener('input', () => {
    plan = null; // the visible text is not the planned text until analysed again
    add.disabled = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void analyse(), 250);
  });

  const handle = openDrawer({
    title: t('drwRowsTitle'),
    subtitle: t('drwRowsSubtitle'),
    body: h('div', { class: 'stack stack--md' }, field(t('drwRowsLabel'), paste), summary),
    footer: [
      add,
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => handle.close() }, t('drwFooterClose')),
    ],
  });
}

// ── Add files to the asset library ─────────────────────────────────────────────

export function openAssetsDrawer(onSaved?: () => void): void {
  const input = h('input', {
    type: 'file',
    class: 'input',
    multiple: true,
    'aria-label': t('drwAssetsFiles'),
  }) as HTMLInputElement;
  const added = h('ul', { class: 'stack-list stack-list--xs' });
  const status = h('p', { class: 'field-hint', role: 'status' });
  input.addEventListener('change', async () => {
    clear(added);
    let n = 0;
    for (const f of Array.from(input.files ?? [])) {
      const asset = await putAsset(f, f.name, await imageDims(f));
      added.append(
        h(
          'li',
          {},
          h('code', {}, asset.name),
          ' ',
          h('span', { class: 'muted' }, asset.width && asset.height ? `${asset.width}×${asset.height}` : asset.mime),
        ),
      );
      n++;
    }
    status.textContent = `${tn(n, 'drwAssetsAdded')} ${t('drwAssetsAddedHint')}`;
    input.value = '';
    notify();
    onSaved?.();
  });
  const handle = openDrawer({
    title: t('drwAssetsTitle'),
    subtitle: t('drwAssetsSubtitle'),
    body: h('div', { class: 'stack stack--md' }, field(t('drwAssetsFiles'), input), added, status),
    footer: [
      h('button', { type: 'button', class: 'btn btn--primary', onclick: () => handle.close() }, t('drwAssetsDone')),
    ],
  });
}

// ── Backup: export / restore a ZIP ─────────────────────────────────────────────

export function openBackupDrawer(campaign: Campaign | null): void {
  const exportStatus = h('p', { class: 'field-hint', role: 'status' });
  const download = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      disabled: !campaign,
      title: campaign ? undefined : t('drwBackupNoCampaign'),
      onclick: async () => {
        if (!campaign) return;
        exportStatus.textContent = t('drwBackupPacking');
        try {
          const blob = await exportCampaignZip(campaign.id);
          downloadBlob(csvFileName(campaign).replace(/\.csv$/, '.zip'), blob);
          exportStatus.textContent = t('drwBackupReady', fmtSize(blob.size));
        } catch (err) {
          exportStatus.textContent = t('drwBackupExportFailed', (err as Error).message);
        }
      },
    },
    svgIcon('download'),
    ' ',
    t('drwBackupDownload'),
  );

  const file = h('input', {
    type: 'file',
    class: 'input',
    accept: '.zip,application/zip',
    'aria-label': t('drwBackupFileAria'),
  }) as HTMLInputElement;
  const restoreStatus = h('p', { class: 'field-hint', role: 'status' });
  const restore = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost',
      disabled: true,
      onclick: async () => {
        const f = file.files?.[0];
        if (!f) return;
        restoreStatus.textContent = t('drwBackupRestoring');
        restore.disabled = true;
        // fflate is synchronous: let the status paint before the main thread is busy.
        await new Promise((r) => setTimeout(r, 30));
        try {
          const result = await importCampaignZip(f);
          const done = t(
            'drwBackupRestored',
            String(result.rows),
            String(result.templates),
            String(result.journal),
            String(result.recipes),
            String(result.assets),
          );
          const missing = result.missingAssets.length;
          restoreStatus.textContent = missing ? `${done} ${tn(missing, 'drwBackupMissing')}` : done;
          await selectCampaign(result.campaignId);
          notify();
        } catch (err) {
          restoreStatus.textContent = t('drwBackupRestoreFailed', (err as Error).message);
          restore.disabled = false;
        }
      },
    },
    svgIcon('upload'),
    ' ',
    t('drwBackupRestore'),
  ) as HTMLButtonElement;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    restore.disabled = !f;
    restoreStatus.textContent = f ? t('drwBackupPicked', f.name, fmtSize(f.size)) : '';
  });

  const handle = openDrawer({
    title: t('drwBackupTitle'),
    subtitle: t('drwBackupSubtitle'),
    body: h(
      'div',
      { class: 'stack stack--md' },
      field(t('drwBackupDownloadLabel'), download, t('drwBackupDownloadHint')),
      exportStatus,
      field(t('drwBackupRestoreLabel'), file),
      restore,
      restoreStatus,
    ),
    footer: [
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => handle.close() }, t('drwFooterClose')),
    ],
  });
}

// ── Header bar ─────────────────────────────────────────────────────────────────

export interface QuickActions {
  el: HTMLElement;
  /** Re-evaluate which actions work for this campaign (called on every route). */
  update: (campaign: Campaign | null) => void;
}

/**
 * The quick actions, on every options screen. Each is enabled only where it works: a profile can
 * always be added (it creates the campaign if there is none), rows need columns to map onto,
 * files and backup are global (export needs a campaign — the drawer says so).
 */
export function quickActions(): QuickActions {
  let current: Campaign | null = null;
  const profile = h(
    'button',
    {
      type: 'button',
      class: 'btn-chip btn-chip--sm',
      title: t('drwChipProfileTitle'),
      onclick: async () => openProfileDrawer(current ?? (await ensureCampaign())),
    },
    svgIcon('user'),
    ' ',
    t('drwChipProfile'),
  ) as HTMLButtonElement;
  const rows = h(
    'button',
    {
      type: 'button',
      class: 'btn-chip btn-chip--sm',
      onclick: () => {
        if (current) openRowsDrawer(current);
      },
    },
    svgIcon('plus'),
    ' ',
    t('drwChipRows'),
  ) as HTMLButtonElement;
  const files = h(
    'button',
    {
      type: 'button',
      class: 'btn-chip btn-chip--sm',
      title: t('drwChipFilesTitle'),
      onclick: () => openAssetsDrawer(),
    },
    svgIcon('upload'),
    ' ',
    t('drwChipFiles'),
  );
  const backup = h(
    'button',
    {
      type: 'button',
      class: 'btn-chip btn-chip--sm',
      title: t('drwChipBackupTitle'),
      onclick: () => openBackupDrawer(current),
    },
    svgIcon('layers'),
    ' ',
    t('drwChipBackup'),
  );
  const el = h(
    'div',
    { class: 'quick-actions', role: 'group', 'aria-label': t('drwQuickActions') },
    profile,
    rows,
    files,
    backup,
  );
  const update = (campaign: Campaign | null): void => {
    current = campaign;
    const hasColumns = !!campaign && campaign.columns.length > 0;
    rows.disabled = !hasColumns;
    rows.title = hasColumns ? t('drwChipRowsTitle') : t('drwChipRowsBlocked');
  };
  update(null);
  return { el, update };
}
