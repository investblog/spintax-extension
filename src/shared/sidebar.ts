/**
 * Collapsible sidebar (301-ui pattern, ADR 0008): body.sidebar-collapsed persisted in
 * localStorage['ui.sidebar.collapsed']; desktop only (>= 1024 px). Mobile drawer is not
 * needed on an extension options page, so that half of 301-ui's sidebar-toggle.ts is omitted.
 */
import { type IconName, setIcon, svgIcon } from './icons';

const STORAGE_KEY = 'ui.sidebar.collapsed';
const DESKTOP = '(min-width: 1024px)';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Apply the saved state before first paint — call at the top of the page module. */
export function applySavedSidebarState(): void {
  if (readCollapsed() && window.matchMedia(DESKTOP).matches) {
    document.body.classList.add('sidebar-collapsed');
  }
}

export function initSidebarToggle(button: HTMLButtonElement): void {
  const icon = button.querySelector('svg') ?? button.appendChild(svgIcon('menu-close'));

  const sync = (): void => {
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    button.setAttribute('aria-expanded', String(!collapsed));
    setIcon(icon, (collapsed ? 'menu-open' : 'menu-close') as IconName);
  };

  button.addEventListener('click', () => {
    const willCollapse = !document.body.classList.contains('sidebar-collapsed');
    document.body.classList.toggle('sidebar-collapsed', willCollapse);
    try {
      localStorage.setItem(STORAGE_KEY, String(willCollapse));
    } catch {
      // localStorage may be blocked
    }
    sync();
  });

  const mql = window.matchMedia(DESKTOP);
  const onBreakpoint = (e: MediaQueryList | MediaQueryListEvent): void => {
    document.body.classList.toggle('sidebar-collapsed', e.matches && readCollapsed());
    sync();
  };
  mql.addEventListener('change', onBreakpoint);
  onBreakpoint(mql);
}
