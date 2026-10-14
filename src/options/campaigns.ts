/**
 * Campaigns drawer (#4): switch, rename, add and delete campaigns, and pick the scenario. Before it,
 * the options page had one campaign ("My campaign") and a second one only came from a backup.
 *
 * The scenario decides how row keys (and so seeds) are derived (ADR 0006, ADR 0010 E1), so it can be
 * changed only while the campaign has no rows; after the first import it is fixed (the repository
 * enforces it — `setCampaignScenario`).
 */
import { clear, h } from '@/shared/dom';
import { openDrawer } from '@/shared/drawer';
import { dropdown } from '@/shared/dropdown';
import { t, tn } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import type { Scenario } from '@/shared/model';
import { createCampaign, listCampaigns, listRows, setCampaignScenario, updateCampaign } from '@/shared/repo';
import { armedButton } from './armed';
import { field } from './quick-actions';
import { currentCampaign, notify, removeCampaign, selectCampaign } from './state';

const scenarioLabel = (s: Scenario): string =>
  s === 'submit' ? t('drwCampScenarioSubmit') : t('drwCampScenarioOutreach');

let hintSeq = 0;

/** Scenario dropdown inside a field; the trigger's accessible name carries the current value. */
function scenarioField(value: Scenario, hint: string, onChange: (v: Scenario) => void, locked = false): HTMLElement {
  const picker = dropdown<Scenario>({
    label: t('drwCampScenario'),
    value,
    width: 'auto',
    options: [
      { value: 'outreach', label: t('drwCampScenarioOutreach'), hint: t('drwCampScenarioOutreachHint') },
      { value: 'submit', label: t('drwCampScenarioSubmit'), hint: t('drwCampScenarioSubmitHint') },
    ],
    onChange: (v) => {
      name(v);
      onChange(v);
    },
  });
  const trigger = picker.querySelector('button');
  const name = (v: Scenario): void =>
    trigger?.setAttribute('aria-label', `${t('drwCampScenario')}: ${scenarioLabel(v)}`);
  name(value);
  const wrap = field(t('drwCampScenario'), picker, hint);
  const hintEl = wrap.querySelector('.field-hint');
  if (hintEl && trigger) {
    hintEl.id = `camp-scenario-hint-${++hintSeq}`;
    trigger.setAttribute('aria-describedby', hintEl.id);
  }
  if (locked) trigger?.setAttribute('disabled', '');
  return wrap;
}

export function openCampaignsDrawer(): void {
  const body = h('div', { class: 'stack stack--md' });
  const handle = openDrawer({
    title: t('drwCampTitle'),
    subtitle: t('drwCampSubtitle'),
    body,
    footer: [
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => handle.close() }, t('drwFooterClose')),
    ],
  });

  // One action at a time, and only the newest paint lands (Codex review of #4: a quick A→B switch
  // used to render out of order, a double click on Create made two campaigns).
  let busy = false;
  let generation = 0;
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    busy = true;
    for (const b of body.querySelectorAll('button')) b.disabled = true;
    let repaint = true;
    try {
      repaint = (await fn()) !== false;
    } finally {
      busy = false;
      if (repaint) await paint();
      else for (const b of body.querySelectorAll<HTMLButtonElement>('button:not([data-locked])')) b.disabled = false;
    }
  };

  const paint = async (): Promise<void> => {
    const mine = ++generation;
    const current = await currentCampaign();
    const all = (await listCampaigns()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const counts = new Map<string, number>();
    for (const c of all) counts.set(c.id, (await listRows(c.id)).length);
    if (mine !== generation || !body.isConnected) return;
    clear(body);

    // ── The open campaign: name, scenario, delete ──
    if (current) {
      const rows = counts.get(current.id) ?? 0;
      const locked = rows > 0;
      const name = h('input', {
        class: 'input',
        value: current.name,
        'aria-label': t('drwCampName'),
      }) as HTMLInputElement;
      let scenario = current.scenario;
      const scenarioBox = scenarioField(
        scenario,
        locked ? t('drwCampScenarioLocked') : t('drwCampScenarioHint'),
        (v) => {
          scenario = v;
        },
        locked,
      );
      scenarioBox.querySelector('button')?.toggleAttribute('data-locked', locked);
      const status = h('p', { class: 'field-hint', role: 'status' });
      const save = h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          onclick: () =>
            act(async () => {
              const next = name.value.trim();
              if (!next) {
                status.textContent = t('drwCampNeedsName');
                return false;
              }
              await updateCampaign(current.id, { name: next });
              if (!locked && scenario !== current.scenario) {
                try {
                  await setCampaignScenario(current.id, scenario);
                } catch {
                  // rows arrived since this drawer was painted: the scenario stays
                }
              }
              notify();
            }),
        },
        svgIcon('check'),
        ' ',
        t('drwCampSave'),
      );
      const remove = armedButton(
        t('drwCampDelete'),
        t('drwCampDeleteConfirm'),
        () =>
          act(async () => {
            await removeCampaign(current.id);
            notify();
          }),
        { small: true, icon: 'trash' },
      );
      body.append(
        h(
          'section',
          { class: 'stack stack--sm' },
          h('h3', { class: 'h5' }, t('drwCampOpenNow')),
          field(t('drwCampName'), name),
          scenarioBox,
          h('p', { class: 'field-hint' }, tn(rows, 'listRows')),
          h('div', { class: 'cluster' }, save, remove),
          status,
        ),
      );
    }

    // ── Other campaigns: switch ──
    const others = all.filter((c) => c.id !== current?.id);
    if (others.length > 0) {
      body.append(
        h(
          'section',
          { class: 'stack stack--sm' },
          h('h3', { class: 'h5' }, t('drwCampOthers')),
          ...others.map((c) =>
            h(
              'div',
              { class: 'cluster cluster--between' },
              h(
                'span',
                {},
                h('strong', {}, c.name),
                ' ',
                h(
                  'span',
                  { class: 'muted' },
                  `${scenarioLabel(c.scenario)} · ${tn(counts.get(c.id) ?? 0, 'listRows')}`,
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost btn--sm',
                  'aria-label': `${t('drwCampSwitch')}: ${c.name}`,
                  onclick: () =>
                    act(async () => {
                      await selectCampaign(c.id);
                      notify();
                    }),
                },
                t('drwCampSwitch'),
              ),
            ),
          ),
        ),
      );
    }

    // ── New campaign ──
    const newName = h('input', { class: 'input', 'aria-label': t('drwCampName') }) as HTMLInputElement;
    let newScenario: Scenario = 'submit';
    const newStatus = h('p', { class: 'field-hint', role: 'status' });
    const create = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost',
        onclick: () =>
          act(async () => {
            const n = newName.value.trim();
            if (!n) {
              newStatus.textContent = t('drwCampNeedsName');
              return false;
            }
            const c = await createCampaign({ name: n, scenario: newScenario });
            await selectCampaign(c.id);
            handle.close();
            location.hash = '#wizard';
            notify();
            return false;
          }),
      },
      svgIcon('plus'),
      ' ',
      t('drwCampCreate'),
    );
    body.append(
      h(
        'section',
        { class: 'stack stack--sm' },
        h('h3', { class: 'h5' }, t('drwCampNew')),
        field(t('drwCampName'), newName),
        scenarioField(newScenario, t('drwCampScenarioHint'), (v) => {
          newScenario = v;
        }),
        h('div', { class: 'cluster' }, create),
        newStatus,
      ),
    );
  };
  void paint();
}
