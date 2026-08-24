/**
 * Two-click destructive button in the 301-ui idiom: at rest `.btn--danger.btn--outline` (red text
 * + border, no fill — Save stays the only filled button), after the first click it turns solid
 * `.btn--danger` with the confirm label, and resets after 6 s if the second click never comes.
 */
import { h } from '@/shared/dom';
import { svgIcon } from '@/shared/icons';

export function armedButton(
  label: string,
  confirmLabel: string,
  action: () => Promise<void>,
  opts: { small?: boolean; icon?: 'trash' } = {},
): HTMLButtonElement {
  const size = opts.small ? ' btn--sm' : '';
  const rest = `btn btn--danger btn--outline${size}`;
  const armed = `btn btn--danger${size}`;
  let isArmed = false;
  let timer = 0;
  const paint = (): void => {
    btn.className = isArmed ? armed : rest;
    btn.replaceChildren(...(opts.icon && !isArmed ? [svgIcon(opts.icon), ' '] : []), isArmed ? confirmLabel : label);
  };
  const btn = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        if (!isArmed) {
          isArmed = true;
          paint();
          timer = window.setTimeout(() => {
            isArmed = false;
            paint();
          }, 6000);
          return;
        }
        // Disarm and lock BEFORE the await: a double-click on the confirm state used to run the
        // destructive action twice (Codex review #9).
        window.clearTimeout(timer);
        isArmed = false;
        btn.disabled = true;
        try {
          await action();
        } finally {
          btn.disabled = false;
          paint();
        }
      },
    },
    label,
  ) as HTMLButtonElement;
  paint();
  return btn;
}
