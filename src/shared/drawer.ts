/**
 * 301-ui drawer (drawers.css): a side panel from the right for a quick action that must not
 * interrupt the flow the user is in — add a profile, paste rows, upload files. One drawer at a
 * time; Escape, the overlay and × close it.
 */
import { h } from './dom';
import { t } from './i18n';
import { svgIcon } from './icons';

export interface DrawerHandle {
  el: HTMLElement;
  close: () => void;
}

let current: DrawerHandle | null = null;

export function closeDrawer(): void {
  current?.close();
}

export function openDrawer(opts: {
  title: string;
  subtitle?: string;
  body: HTMLElement;
  footer?: (HTMLElement | null)[];
  onClose?: () => void;
}): DrawerHandle {
  closeDrawer();
  const overlay = h('div', { class: 'drawer__overlay' });
  const closeBtn = h(
    'button',
    { type: 'button', class: 'btn-icon btn-icon--compact drawer__close', 'aria-label': t('drwClose') },
    svgIcon('close'),
  );
  const el = h(
    'aside',
    { class: 'drawer drawer--open', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    overlay,
    h(
      'div',
      { class: 'drawer__panel' },
      h(
        'header',
        { class: 'drawer__header' },
        h(
          'div',
          { class: 'drawer__header-content' },
          h('h2', { class: 'drawer__title' }, opts.title),
          opts.subtitle ? h('p', { class: 'text-muted' }, opts.subtitle) : null,
        ),
        closeBtn,
      ),
      h('div', { class: 'drawer__body' }, opts.body),
      opts.footer ? h('footer', { class: 'drawer__footer' }, ...opts.footer) : null,
    ),
  );
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const close = (): void => {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener('keydown', onKey);
    if (current?.el === el) current = null;
    opts.onClose?.();
  };
  overlay.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  el.querySelector<HTMLElement>('input:not([type=hidden]), textarea, .btn--primary')?.focus();
  current = { el, close };
  return current;
}
