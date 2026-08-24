/**
 * Tooltips for the collapsed sidebar — a port of 301-ui `src/ui/tooltip.ts` (text only).
 *
 * Why JS and not `::after`: the collapsed sidebar clips its overflow (to hide the scrollbar), so a
 * pseudo-element drawn past the rail's right edge is cut off; a fixed-position element on <body>
 * escapes the clip. `data-tooltip-content` is read at hover time; `data-tooltip-when` names a body
 * class that has to be present (the sidebar labels are on screen while expanded).
 */
let el: HTMLElement | null = null;

function tooltipEl(): HTMLElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'tooltip';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

function show(target: HTMLElement, text: string): void {
  const t = tooltipEl();
  t.textContent = text;
  t.style.left = '-9999px';
  t.style.top = '-9999px';
  t.hidden = false;
  const r = target.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  const GAP = 8;
  const BUFFER = 8;
  // Sidebar items: to the right of the rail, vertically centred; fall back below when no room.
  let left = r.right + GAP;
  let top = r.top + r.height / 2 - tr.height / 2;
  if (left + tr.width > window.innerWidth - BUFFER) {
    left = Math.max(BUFFER, r.left + r.width / 2 - tr.width / 2);
    top = r.bottom + GAP;
  }
  top = Math.min(Math.max(BUFFER, top), window.innerHeight - tr.height - BUFFER);
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

export function hideTooltip(): void {
  if (el) el.hidden = true;
}

/** Bind every `[data-tooltip]` under `root` once (safe to call after each re-render). */
export function initTooltips(root: ParentNode = document): void {
  for (const target of root.querySelectorAll<HTMLElement>('[data-tooltip]:not([data-tooltip-initialized])')) {
    target.setAttribute('data-tooltip-initialized', 'true');
    const enter = (): void => {
      const text = target.getAttribute('data-tooltip-content');
      const when = target.getAttribute('data-tooltip-when');
      if (!text || (when && !document.body.classList.contains(when))) return;
      show(target, text);
    };
    target.addEventListener('mouseenter', enter);
    target.addEventListener('focus', enter);
    target.addEventListener('mouseleave', hideTooltip);
    target.addEventListener('blur', hideTooltip);
  }
}
