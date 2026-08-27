/**
 * Theme management — dark | light | auto (system). Same mechanism as 301-ui / redirect-inspector
 * (ADR 0008): `data-theme` on <html>. `auto` stamps the *system* theme into the attribute (and
 * follows OS changes) — theme.css defines the colour tokens only under `[data-theme=…]`, so a bare
 * <html> in a dark OS would have no `--bg` / `--panel` at all (transparent cards, sidebar).
 */

const THEME_STORAGE_KEY = 'spintax_outreach_theme';

export type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'auto';

const systemTheme = (): Theme => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

export function getTheme(): Theme {
  const explicit = document.documentElement.dataset.theme as Theme | undefined;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return systemTheme();
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored;
  } catch {
    // localStorage may be blocked
  }
  return 'auto';
}

export function setTheme(theme: Theme | null): void {
  document.documentElement.dataset.theme = theme ?? systemTheme();
  document.dispatchEvent(new CustomEvent('themechange', { detail: getTheme() }));
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // localStorage may be blocked
  }
  setTheme(preference === 'auto' ? null : preference);
}

export function toggleTheme(): void {
  setThemePreference(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme(): void {
  const apply = (): void => {
    const preference = getThemePreference();
    setTheme(preference === 'auto' ? null : preference);
  };
  apply();
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (getThemePreference() === 'auto') setTheme(null);
    });
  } catch {
    // matchMedia may not be available
  }
  // All extension pages share one origin, so a toggle in the panel must reach the welcome /
  // options documents that are already open. The storage event fires only in the OTHER documents.
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) apply();
  });
}

/** Icon for the toggle: shows what you will switch TO. */
export function getThemeIcon(theme: Theme): 'sun' | 'theme-light-dark' {
  return theme === 'dark' ? 'sun' : 'theme-light-dark';
}
