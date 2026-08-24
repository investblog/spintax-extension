import { installFillHandler } from '@/content/handler';
import { t } from '@/shared/i18n';

/**
 * Demo pages (src/public/demo/*.html) load this script themselves: the same fill helper as the
 * content script, plus a harmless "submit": nothing leaves the page, a banner confirms it.
 * Extension-page CSP forbids inline scripts, so the page behaviour lives here.
 *
 * The demo pages and the demo campaign stay English (ADR 0013) — the banner is the helper talking
 * to the user, not demo content, so it follows the UI language.
 */
export default defineUnlistedScript(() => {
  installFillHandler();
  for (const form of Array.from(document.querySelectorAll('form[data-demo]'))) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const banner = document.querySelector<HTMLElement>('[data-demo-banner]');
      if (banner) {
        banner.hidden = false;
        banner.textContent = t('demoBannerSent');
      }
    });
  }
});
