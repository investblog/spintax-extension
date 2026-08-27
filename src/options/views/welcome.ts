/**
 * Welcome & help — the first screen after install and the base of the user docs (pattern from
 * redirect-inspector): what the helper does, three steps, two ways to start (demo / own list),
 * quick actions, keys, privacy. Rendered both as the standalone welcome.html and as an options view.
 */
import { browser } from 'wxt/browser';
import { demoCampaign, removeDemo, seedDemo } from '@/shared/demo';
import { clear, h } from '@/shared/dom';
import { newsBellButton } from '@/shared/header-controls';
import { t } from '@/shared/i18n';
import { svgIcon } from '@/shared/icons';
import { openSidePanel } from '@/shared/open-panel';
import { playgroundHome, privacyUrl, siteUrl } from '@/shared/studio';
import { openAssetsDrawer, openProfileDrawer, openRowsDrawer } from '../quick-actions';
import { currentCampaign, ensureCampaign, notify, selectCampaign } from '../state';

export interface WelcomeOptions {
  /** welcome.html (true) navigates to the options page; the options view routes in place. */
  standalone: boolean;
}

function optionsUrl(hash: string): string {
  return browser.runtime.getURL(`/options.html#${hash}`);
}

export async function renderWelcome(root: HTMLElement, opts: WelcomeOptions): Promise<void> {
  clear(root);
  const go = (hash: string): void => {
    if (opts.standalone) location.href = optionsUrl(hash);
    else location.hash = `#${hash}`;
  };
  const demo = await demoCampaign();
  const status = h('p', { class: 'field-hint', role: 'status' });

  const tryDemo = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--primary',
      onclick: async () => {
        tryDemo.disabled = true;
        const c = await seedDemo();
        await selectCampaign(c.id);
        notify();
        go('list');
      },
    },
    svgIcon('play'),
    // The gap after the icon stays in code — a leading space inside a message does not survive translation.
    ' ',
    demo ? t('welOpenDemo') : t('welTryDemo'),
  );
  // The demo lands on the list; without this the panel — the product itself — has no route here.
  const openPanel = h(
    'button',
    { type: 'button', class: 'btn btn--ghost', onclick: () => void openSidePanel() },
    svgIcon('dock-right'),
    ' ',
    t('panelOpenSidePanel'),
  );
  const startOwn = h(
    'button',
    { type: 'button', class: 'btn btn--ghost', onclick: () => go('wizard') },
    svgIcon('upload'),
    ' ',
    t('welStartOwn'),
  );
  const current = await currentCampaign();
  const hasColumns = !!current && current.columns.length > 0;
  const quick = (
    label: string,
    icon: Parameters<typeof svgIcon>[0],
    open: string,
    act: () => void,
    enabled = true,
    why = '',
  ): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn-chip',
        disabled: !enabled,
        title: enabled ? undefined : why,
        onclick: () => {
          if (opts.standalone) location.href = optionsUrl(`list?open=${open}`);
          else act();
        },
      },
      svgIcon(icon),
      ` ${label}`,
    );

  const steps: [string, string][] = [
    [t('welStep1Title'), t('welStep1Text')],
    [t('welStep2Title'), t('welStep2Text')],
    [t('welStep3Title'), t('welStep3Text')],
  ];

  root.append(
    h(
      'section',
      { class: 'card welcome__hero' },
      h(
        'div',
        { class: 'card__body' },
        h('h2', { class: 'card__title' }, t('welHeroTitle')),
        h('p', { class: 'muted' }, t('welHeroText')),
        h('div', { class: 'card__actions' }, tryDemo, startOwn, openPanel),
        demo
          ? h(
              'p',
              { class: 'field-hint' },
              t('welDemoInstalled', demo.name),
              // The gap before the button stays in code — a trailing space in a message does not survive translation.
              ' ',
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost btn--sm',
                  onclick: async () => {
                    await removeDemo();
                    notify();
                    status.textContent = t('welDemoRemoved');
                    await renderWelcome(root, opts);
                  },
                },
                t('welRemoveDemo'),
              ),
            )
          : null,
        status,
      ),
    ),
    h(
      'section',
      { class: 'welcome__steps' },
      ...steps.map(([title, text], i) =>
        h(
          'div',
          { class: 'card welcome__step' },
          h(
            'div',
            { class: 'card__body' },
            h('span', { class: 'welcome__num' }, String(i + 1)),
            h('h3', { class: 'card__title' }, title),
            h('p', { class: 'muted' }, text),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h('h3', { class: 'card__title' }, t('welQuickTitle')),
        h('p', { class: 'muted' }, t('welQuickText')),
        h(
          'div',
          { class: 'chips' },
          quick(t('welQuickProfile'), 'user', 'profile', () => void ensureCampaign().then((c) => openProfileDrawer(c))),
          quick(
            t('welQuickRows'),
            'plus',
            'rows',
            () => {
              if (current) openRowsDrawer(current);
            },
            hasColumns,
            t('welQuickRowsBlocked'),
          ),
          quick(t('welQuickFiles'), 'upload', 'files', () => openAssetsDrawer()),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h('h3', { class: 'card__title' }, t('welPanelTitle')),
        // Each bold lead-in QUOTES a side panel button, so it reuses the panel's own key — the help
        // text and the button it names must never drift apart. The " — " separator stays in code:
        // a message that starts with a space and a dash does not survive translation.
        h(
          'ul',
          { class: 'welcome__list' },
          h('li', {}, h('strong', {}, t('panelOpenTarget')), ' — ', t('welPanelOpenTarget')),
          h('li', {}, h('strong', {}, t('panelFillOn', 'site.com')), ' — ', t('welPanelFill')),
          h('li', {}, h('strong', {}, t('panelSentNext', 'S')), ' — ', t('welPanelSent')),
          h('li', {}, h('strong', {}, t('welPanelKeysLabel')), ' — ', t('welPanelKeys')),
          h('li', {}, h('strong', {}, t('welPanelMappingLabel')), ' — ', t('welPanelMapping')),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card__body' },
        h('h3', { class: 'card__title' }, t('welPrivacyTitle')),
        h('p', { class: 'muted' }, t('welPrivacyText')),
        h('p', { class: 'muted welcome__news' }, newsBellButton(), ' ', t('welNews')),
        h(
          'div',
          { class: 'chips' },
          h(
            'a',
            { class: 'btn-chip', href: privacyUrl(), target: '_blank', rel: 'noopener' },
            svgIcon('open-in-new'),
            ' ',
            t('welPrivacyPolicy'),
          ),
          h(
            'a',
            { class: 'btn-chip', href: siteUrl('ai-spintax-templates/'), target: '_blank', rel: 'noopener' },
            svgIcon('open-in-new'),
            ' ',
            t('welSpintaxWithAi'),
          ),
          h(
            'a',
            { class: 'btn-chip', href: playgroundHome(), target: '_blank', rel: 'noopener' },
            svgIcon('open-in-new'),
            ' ',
            t('welPlayground'),
          ),
        ),
      ),
    ),
  );
}
