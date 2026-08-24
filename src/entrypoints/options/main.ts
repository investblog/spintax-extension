import {
  openAssetsDrawer,
  openBackupDrawer,
  openProfileDrawer,
  openRowsDrawer,
  quickActions,
} from '@/options/quick-actions';
import { currentCampaign, ensureCampaign, onChange } from '@/options/state';
import { renderAssets } from '@/options/views/assets';
import { renderList } from '@/options/views/list';
import { renderProfiles } from '@/options/views/profiles';
import { renderReview } from '@/options/views/review';
import { renderSettings } from '@/options/views/settings';
import { renderTemplateView } from '@/options/views/template';
import { renderWelcome } from '@/options/views/welcome';
import { renderWizard } from '@/options/views/wizard';
import { byId, clear, h } from '@/shared/dom';
import { newsBellButton, themeToggleButton } from '@/shared/header-controls';
import { applyDocumentLanguage, t } from '@/shared/i18n';
import { type IconName, injectIconSprite, svgIcon } from '@/shared/icons';
import { applySavedSidebarState, initSidebarToggle } from '@/shared/sidebar';
import { hideTooltip, initTooltips } from '@/shared/tooltip';

/**
 * Options page shell (spec §15.1, wireframe 1): 301-ui app-shell with a collapsible sidebar
 * and hash-routed views.
 */
applySavedSidebarState();
applyDocumentLanguage();
injectIconSprite();
// The <title> in index.html is the pre-JS fallback; the UI language wins once the module runs.
document.title = t('optPageTitle');

interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { id: 'welcome', label: t('optNavWelcome'), icon: 'home' },
  { id: 'wizard', label: t('optNavWizard'), icon: 'play' },
  { id: 'list', label: t('optNavList'), icon: 'layers' },
  { id: 'template', label: t('optNavTemplate'), icon: 'pencil-circle' },
  { id: 'review', label: t('optNavReview'), icon: 'check-circle' },
  { id: 'profiles', label: t('optNavProfiles'), icon: 'user' },
  { id: 'recipes', label: t('optNavRecipes'), icon: 'puzzle' },
  { id: 'assets', label: t('optNavAssets'), icon: 'upload' },
  { id: 'journal', label: t('optNavJournal'), icon: 'logs' },
  { id: 'settings', label: t('optNavSettings'), icon: 'cog' },
  { id: 'news', label: t('optNavNews'), icon: 'bell' },
];
const NAV_DEFAULT = NAV[0] as NavItem;

const app = byId('app');

const toggle = h('button', {
  type: 'button',
  class: 'btn-icon btn-icon--compact sidebar__toggle-desktop',
  'aria-label': t('optToggleSidebar'),
  'aria-expanded': 'true',
});

const nav = h('nav', { class: 'sidebar__nav', 'aria-label': t('optSections') });
const sidebar = h(
  'aside',
  { class: 'sidebar' },
  h(
    'div',
    { class: 'sidebar__head' },
    h(
      'strong',
      { class: 'sidebar__brand' },
      h('img', { src: '/icons/32.png', class: 'brand-mark', alt: '' }),
      'Spintax',
    ),
    toggle,
  ),
  nav,
);

const content = h('main', { class: 'dashboard-content', id: 'content' });
const title = h('h1', { class: 'options__title', id: 'view-title' }, t('optNavWizard'));
const subtitle = h('span', { class: 'options__subtitle muted' });
const qa = quickActions();
const header = h(
  'header',
  { class: 'options__header' },
  h('div', { class: 'options__heading' }, title, subtitle),
  h('div', { class: 'panel__tools' }, qa.el, themeToggleButton(), newsBellButton()),
);

app.append(sidebar, h('div', { class: 'options__main' }, header, content));
initSidebarToggle(toggle);

function renderNav(active: string): void {
  hideTooltip(); // removing a hovered node fires no mouseleave (Codex review #11)
  clear(nav);
  for (const item of NAV) {
    nav.appendChild(
      h(
        'a',
        {
          class: `navitem${item.id === active ? ' is-active' : ''}`,
          href: `#${item.id}`,
          // 301-ui idiom: the label becomes a JS tooltip once the rail is collapsed (src/shared/tooltip.ts)
          'data-tooltip': '',
          'data-tooltip-content': item.label,
          'data-tooltip-when': 'sidebar-collapsed',
          'aria-current': item.id === active ? 'page' : undefined,
        },
        h('span', { class: 'icon' }, svgIcon(item.icon)),
        h('span', { class: 'label' }, item.label),
      ),
    );
  }
  initTooltips(nav);
}

async function renderView(id: string, params: URLSearchParams = new URLSearchParams()): Promise<void> {
  const item = NAV.find((n) => n.id === id) ?? NAV_DEFAULT;
  title.textContent = item.label;
  // Each render gets its own container: a slower, older render (hashchange + onChange fire
  // together) then appends into a detached node instead of doubling the live view.
  const view = h('div', { class: 'view' });
  clear(content);
  content.append(view);
  // Screens that write campaign data create "My campaign" on first use — a profile or a template
  // must never be blocked by "start with the wizard" (the wizard is one way in, not a gate).
  const bound = ['wizard', 'list', 'template', 'profiles', 'review'].includes(item.id);
  const campaign = bound ? await ensureCampaign() : await currentCampaign();
  qa.update(campaign);
  if (!view.isConnected) return;
  // #list?open=rows — deep link straight into a quick-action drawer (welcome page buttons).
  const open = params.get('open');
  if (open) {
    params.delete('open');
    // Consume the link: notify() re-routes from location.hash and would re-open the drawer.
    history.replaceState(null, '', `#${item.id}`);
    if (open === 'rows' && campaign) openRowsDrawer(campaign);
    else if (open === 'profile') openProfileDrawer(campaign ?? (await ensureCampaign()));
    else if (open === 'files') openAssetsDrawer();
    else if (open === 'backup') openBackupDrawer(campaign);
  }
  subtitle.textContent = campaign ? campaign.name : '';
  if (item.id === 'wizard' && campaign) {
    renderWizard(view, campaign, route);
  } else if (item.id === 'list' && campaign) {
    await renderList(view, campaign);
  } else if (item.id === 'template' && campaign) {
    await renderTemplateView(view, campaign, {
      channel: params.get('channel') === 'subject' ? 'subject' : undefined,
      step: Number(params.get('step')) || undefined,
    });
  } else if (item.id === 'profiles' && campaign) {
    await renderProfiles(view, campaign);
  } else if (item.id === 'review' && campaign) {
    await renderReview(view, campaign);
  } else if (item.id === 'assets') {
    await renderAssets(view);
  } else if (item.id === 'settings') {
    await renderSettings(view, campaign);
  } else if (item.id === 'welcome') {
    await renderWelcome(view, { standalone: false });
  } else {
    view.append(
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'card__body' },
          h(
            'p',
            { class: 'muted' },
            {
              recipes: t('optRecipesStub'),
              journal: t('optJournalStub'),
              news: t('optNewsStub'),
            }[item.id] ?? t('optNotHereYet', item.label),
          ),
        ),
      ),
    );
  }
}

function route(): void {
  const raw = location.hash.replace(/^#/, '') || 'wizard';
  const [id = 'wizard', query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  renderNav(id);
  renderView(id, params).catch((err: unknown) => {
    clear(content);
    content.append(h('div', { class: 'panel panel--danger' }, t('optViewFailed', (err as Error).message)));
  });
}

window.addEventListener('hashchange', route);
onChange(route);
route();
