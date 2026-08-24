/** Theme toggle + news bell, used by the side panel header, the options header and the welcome page. */
import { browser } from 'wxt/browser';
import { h } from './dom';
import { t } from './i18n';
import { setIcon, svgIcon } from './icons';
import { getNewsEnabled, NEWS_ENABLED_KEY, toggleNews } from './news';
import { getTheme, getThemeIcon, initTheme, toggleTheme } from './theme';

/**
 * Each control may exist in several places at once (the options header AND the welcome page), so a
 * single shared node is wrong: appending it to the second place MOVES it out of the first, and the
 * header silently loses its bell. Every call therefore builds its own element, while the listeners
 * that keep them in sync are installed once per document and repaint every element still on screen
 * — which is also what the earlier fix was after: no listener pile-up per render.
 */
type Painter = (el: HTMLElement) => void;

function registry(paint: Painter): { add: (el: HTMLElement) => void; repaint: () => void } {
  const live = new Set<HTMLElement>();
  return {
    add(el) {
      live.add(el);
      paint(el);
    },
    repaint() {
      for (const el of live) {
        if (el.isConnected) paint(el);
        else live.delete(el); // a render replaced it; nothing to keep alive
      }
    },
  };
}

let themeListenerInstalled = false;
const themeControls = registry((el) => {
  const icon = el.querySelector('svg');
  if (icon) setIcon(icon as unknown as SVGSVGElement, getThemeIcon(getTheme()));
});

export function themeToggleButton(): HTMLButtonElement {
  initTheme();
  const button = h(
    'button',
    { type: 'button', class: 'btn-icon btn-icon--compact', 'aria-label': t('hdrTheme'), title: t('hdrTheme') },
    svgIcon(getThemeIcon(getTheme())),
  );
  button.addEventListener('click', () => toggleTheme());
  if (!themeListenerInstalled) {
    themeListenerInstalled = true;
    document.addEventListener('themechange', () => themeControls.repaint());
  }
  themeControls.add(button);
  return button;
}

let newsEnabled = false;
let newsListenerInstalled = false;
const newsControls = registry((el) => {
  const icon = el.querySelector('svg');
  if (icon) setIcon(icon as unknown as SVGSVGElement, newsEnabled ? 'bell' : 'bell-off');
  el.setAttribute('aria-pressed', String(newsEnabled));
  el.setAttribute('aria-label', newsEnabled ? t('hdrNewsAriaOn') : t('hdrNewsAriaOff'));
  el.title = newsEnabled ? t('hdrNewsTitleOn') : t('hdrNewsTitleOff');
});

/**
 * 301.sh news bell (spec §15.6): off by default; a click asks for the optional permissions and turns
 * the feed on, a second click turns it off. Every bell on screen follows the stored state.
 */
export function newsBellButton(): HTMLButtonElement {
  const button = h(
    'button',
    {
      type: 'button',
      class: 'btn-icon btn-icon--compact',
      'aria-label': t('hdrNewsAriaOff'),
      'aria-pressed': 'false',
      title: t('hdrNewsTitleOff'),
    },
    svgIcon('bell-off'),
  );
  button.addEventListener('click', () => {
    // toggleNews() must be the first call in the handler (Firefox gesture rule, see news.ts).
    const result = toggleNews(newsEnabled);
    button.disabled = true;
    void result
      .then((on) => {
        newsEnabled = on;
        newsControls.repaint();
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  newsControls.add(button);
  if (!newsListenerInstalled) {
    newsListenerInstalled = true;
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(NEWS_ENABLED_KEY in changes)) return;
      newsEnabled = Boolean(changes[NEWS_ENABLED_KEY]?.newValue);
      newsControls.repaint();
    });
    void getNewsEnabled().then((on) => {
      newsEnabled = on;
      newsControls.repaint();
    });
  }
  return button;
}
