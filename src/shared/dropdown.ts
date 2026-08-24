/**
 * 301-ui dropdown (tables.css "Dropdown" section): `.dropdown` > `.btn-chip--dropdown.dropdown__trigger`
 * + `.dropdown__menu` with `.dropdown__item`s. The style guide forbids native <select>; this
 * is the select replacement for the options pages. One document-level handler toggles
 * `.dropdown--open`, closes on outside click / Escape, flips up near the bottom edge.
 */
import { h } from './dom';
import { svgIcon } from './icons';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  icon?: Parameters<typeof svgIcon>[0];
}

export interface DropdownOptions<T extends string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the trigger (what the control chooses). */
  label: string;
  /** Shown when the current value has no option (e.g. '' = "Choose…"). */
  placeholder?: string;
  /** `fit` (menu as wide as the trigger, default) or `auto` (as wide as the widest item). */
  width?: 'fit' | 'auto';
  size?: 'sm';
}

let installed = false;

function close(dd: Element): void {
  dd.classList.remove('dropdown--open');
  dd.querySelector('.dropdown__trigger')?.setAttribute('aria-expanded', 'false');
  const menu = dd.querySelector<HTMLElement>('.dropdown__menu');
  if (menu) {
    menu.classList.remove('dropdown__menu--up', 'dropdown__menu--right');
    menu.style.cssText = '';
  }
}

/** Inside a scroll container (table-scroll) an absolute menu is clipped — escape it with `fixed`. */
function clippedBy(el: Element): boolean {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(`${o.overflow}${o.overflowX}${o.overflowY}`)) return true;
  }
  return false;
}

function closeAll(except?: Element): void {
  for (const dd of Array.from(document.querySelectorAll('.dropdown--open'))) if (dd !== except) close(dd);
}

/** Flip upward / right-align when the menu would leave the viewport (mirrors 301-ui adjustDropdownPosition). */
function place(dd: Element): void {
  const menu = dd.querySelector<HTMLElement>('.dropdown__menu');
  if (!menu) return;
  menu.classList.remove('dropdown__menu--up', 'dropdown__menu--right');
  const trigger = dd.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  const below = window.innerHeight - trigger.bottom;
  const above = trigger.top;
  const up = trigger.top > window.innerHeight * 0.3 && above >= 150 && above > below;
  if (up) menu.classList.add('dropdown__menu--up');
  if (window.innerWidth - rect.right < 16 && trigger.left > 16) menu.classList.add('dropdown__menu--right');
  if (clippedBy(dd)) {
    menu.style.position = 'fixed';
    // percentages would now resolve against the viewport: size from the chip instead
    menu.style.minWidth = `${Math.round(trigger.width)}px`;
    menu.style.width = 'max-content';
    menu.style.maxWidth = 'min(26rem, calc(100vw - 16px))';
    menu.style.left = `${Math.max(8, Math.min(trigger.left, window.innerWidth - rect.width - 8))}px`;
    menu.style.right = 'auto';
    if (up) {
      menu.style.top = 'auto';
      menu.style.bottom = `${window.innerHeight - trigger.top + 8}px`;
    } else {
      menu.style.top = `${trigger.bottom + 8}px`;
      menu.style.bottom = 'auto';
    }
  }
}

export function installDropdownHandler(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const trigger = target.closest('.dropdown__trigger');
    if (trigger) {
      const dd = trigger.closest('.dropdown');
      if (!dd) return;
      e.stopPropagation();
      const open = dd.classList.contains('dropdown--open');
      closeAll(dd);
      if (open) close(dd);
      else {
        dd.classList.add('dropdown--open');
        trigger.setAttribute('aria-expanded', 'true');
        place(dd);
      }
      return;
    }
    if (target.closest('.dropdown__item')) {
      const dd = target.closest('.dropdown');
      if (dd) close(dd);
      return;
    }
    if (!target.closest('.dropdown')) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  // A fixed-positioned menu would drift from its chip on scroll: close instead.
  document.addEventListener('scroll', () => closeAll(), true);
}

/** Build a select-like dropdown. Returns the `.dropdown` element; `.value` reflects the choice. */
export function dropdown<T extends string>(opts: DropdownOptions<T>): HTMLElement & { value: T } {
  installDropdownHandler();
  let current = opts.value;
  const labelSpan = h('span', { class: 'dropdown__label' });
  const menu = h('div', { class: `dropdown__menu dropdown__menu--${opts.width ?? 'fit'}-trigger`, role: 'menu' });
  if (opts.width === 'auto') menu.className = 'dropdown__menu dropdown__menu--auto';
  const trigger = h(
    'button',
    {
      type: 'button',
      class: `btn-chip btn-chip--dropdown dropdown__trigger${opts.size === 'sm' ? ' btn-chip--sm' : ''}`,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': opts.label,
    },
    labelSpan,
    (() => {
      const chevron = svgIcon('chevron-down');
      chevron.classList.add('btn-chip__chevron');
      return chevron;
    })(),
  );
  const items = new Map<T, HTMLElement>();
  const paint = (): void => {
    const opt = opts.options.find((o) => o.value === current);
    labelSpan.textContent = opt?.label ?? opts.placeholder ?? '';
    for (const [v, el] of items) el.classList.toggle('dropdown__item--selected', v === current);
  };
  for (const o of opts.options) {
    const item = h(
      'button',
      {
        type: 'button',
        class: `dropdown__item${o.hint ? ' dropdown__item--rich' : ''}`,
        role: 'menuitem',
        onclick: () => {
          if (o.value === current) return;
          current = o.value;
          paint();
          opts.onChange(o.value);
        },
      },
      o.icon ? svgIcon(o.icon) : null,
      o.hint ? h('span', { class: 'dropdown__item-label' }, o.label) : o.label,
      o.hint ? h('span', { class: 'dropdown__item-hint' }, o.hint) : null,
    );
    items.set(o.value, item);
    menu.append(item);
  }
  paint();
  const root = h('div', { class: 'dropdown' }, trigger, menu) as unknown as HTMLElement & { value: T };
  Object.defineProperty(root, 'value', {
    get: () => current,
    set: (v: T) => {
      current = v;
      paint();
    },
  });
  return root;
}
