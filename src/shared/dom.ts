/** Tiny DOM builder. UI text goes through text nodes; the only innerHTML sinks are the editor
 * overlay and variant leftovers (src/shared/editor.ts), which escape everything first. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'dataset' || key === 'style') {
      // not supported on purpose — use data-* attributes and classes
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

/** Show a short confirmation ("Saved.") that clears itself — the view is not re-rendered. */
export function flash(el: HTMLElement, text: string, ms = 2500): void {
  el.textContent = text;
  el.classList.add('is-flash');
  window.setTimeout(() => {
    if (el.textContent === text) {
      el.textContent = '';
      el.classList.remove('is-flash');
    }
  }, ms);
}
