import { renderWelcome } from '@/options/views/welcome';
import { byId, h } from '@/shared/dom';
import { applyDocumentLanguage, t } from '@/shared/i18n';
import { injectIconSprite } from '@/shared/icons';
import { initTheme } from '@/shared/theme';

/** Standalone welcome page — opened once after install (background.ts), linked from options. */

initTheme(); // theme.css defines the colour tokens under [data-theme] only
applyDocumentLanguage();
injectIconSprite();
// The <title> in index.html is the pre-JS fallback; the UI language wins once the module runs.
document.title = t('welPageTitle');
const app = byId('app');
app.append(
  h(
    'header',
    { class: 'welcome__header' },
    h('img', { src: '/icons/48.png', alt: '', class: 'welcome__icon' }),
    h(
      'div',
      {},
      // "Spintax" is the product name, not a caption — it stays as it is in every language.
      h('h1', { class: 'options__title' }, 'Spintax'),
      h('p', { class: 'muted' }, t('welTagline')),
    ),
  ),
);
const main = h('main', { class: 'welcome__main' });
app.append(main);
void renderWelcome(main, { standalone: true });
