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
  // Sign-up demo (ADR 0014): a multi-step form shows its next step, and "creating the account"
  // only checks that the human did their part — a password and both boxes.
  for (const next of Array.from(document.querySelectorAll<HTMLElement>('[data-demo-next-step]'))) {
    next.addEventListener('click', () => {
      const step = next.closest<HTMLElement>('[data-demo-step]');
      const following = step?.nextElementSibling as HTMLElement | null;
      if (!step || !following?.hasAttribute('data-demo-step')) return;
      step.hidden = true;
      following.hidden = false;
      following.querySelector<HTMLElement>('input')?.focus();
    });
  }
  for (const form of Array.from(document.querySelectorAll<HTMLFormElement>('form[data-demo-signup]'))) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const banner = form.querySelector<HTMLElement>('[data-demo-banner]');
      if (!banner) return;
      const password = form.querySelector<HTMLInputElement>('input[type=password]')?.value ?? '';
      const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
      const done = password !== '' && boxes.every((b) => b.checked);
      banner.hidden = false;
      banner.classList.toggle('banner--warn', !done);
      banner.textContent = done
        ? t('demoBannerSignedUp', form.querySelector<HTMLInputElement>('input[type=email]')?.value || '—')
        : t('demoBannerSignupYours');
      const link = form.querySelector<HTMLElement>('[data-demo-next]');
      if (link) link.hidden = !done;
    });
  }
});
