import { defineConfig } from 'wxt';

// Manifest is a function of the target browser: one codebase, three packages
// (ADR 0005 / 0007). Every user-visible manifest string is a `__MSG_*__` reference the browser
// resolves from src/public/_locales/<locale>/messages.json — the same message files the UI reads
// through src/shared/i18n.ts. Keys live in scripts/i18n/fragments/, merged by scripts/i18n-merge.mjs.
export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',

  // The sources ZIP goes to AMO reviewers, and WXT does NOT read .gitignore: without this it packed
  // AGENTS.md, CLAUDE.md, the spec, every ADR and the whole store-listing pack (61 files). Hidden
  // directories (.agents/, .claude/) are already out because `dotSources` is false by default.
  // Keep this list in step with the matching block in .gitignore — same intent, two mechanisms.
  // Both ignore whole directories rather than named files, so a new internal document cannot leak.
  zip: {
    excludeSources: [
      'AGENTS.md',
      'CLAUDE.md',
      'context/**',
      'docs/**',
      'scripts/store-check.mjs',
      'scripts/make-dogfood-csv.mjs',
      'scripts/make-shots.mjs',
      'scripts/make-promo.mjs',
      'scripts/i18n-translate-brief.md',
    ],
  },
  publicDir: 'src/public',

  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '0.2.0',
    default_locale: 'en',
    author: '301.st — Smart Traffic <support@301.st>',
    homepage_url: 'https://spintax.net',

    ...(browser === 'chrome' && { minimum_chrome_version: '116' }),

    // Store icons (scripts/make-icons.mjs renders them from the inline SVG).
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },

    // Toolbar button: Chromium opens the side panel (setPanelBehavior in background.ts); Firefox
    // opens the sidebar from the click handler (sidebarAction.open needs a user gesture).
    ...(browser === 'firefox'
      ? {
          browser_action: {
            default_title: '__MSG_cmdActionTitle__',
            default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
          },
          // sidebar_action is NOT declared here: WXT assigns that key wholesale from the sidepanel
          // entrypoint's own options, so anything written here is dropped. It lives in
          // src/entrypoints/sidepanel/index.html as manifest.* meta tags.
        }
      : {
          action: { default_title: '__MSG_cmdActionTitle__', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
        }),

    // R0 permission set (ADR 0005). Nothing optional is requested at install.
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting', 'clipboardWrite', 'alarms'],

    // Opt-in 301.sh news (spec §15.6): requested at runtime from a user gesture, never at install.
    // `clipboardRead` was dropped before the first submission: ADR 0011 planned a "Paste from
    // clipboard" button, R0 ships a plain textarea instead, and a permission with no feature behind
    // it is a question we cannot answer honestly on three review desks.
    // activeTab is lost on origin change and is not granted by a click inside the side panel:
    // the "Fill" button requests the current origin in-gesture (ADR 0011 p.4). Firefox MV2 has no
    // optional_host_permissions key — origins live in optional_permissions there.
    ...(browser === 'firefox'
      ? { optional_permissions: ['notifications', '*://*/*', 'https://301.sh/*'] }
      : {
          optional_permissions: ['notifications'],
          optional_host_permissions: ['*://*/*', 'https://301.sh/*'],
        }),

    // E2E only (WXT_E2E=1, see e2e/run.mjs): the Playwright fixture server is pre-granted so the
    // test never hits the native permission prompt. Never set in a store build.
    ...(process.env.WXT_E2E === '1' && { host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'] }),

    // Queue keyboard shortcuts (spec §14.5, ADR 0011 p.10): no suggested keys — Alt+Shift is the
    // RU/EN layout switch and Ctrl+Shift+N/C are taken by the browser; the user assigns them.
    commands: {
      'fill-form': {
        description: '__MSG_cmdFill__',
      },
      'copy-and-open': {
        description: '__MSG_cmdCopyOpen__',
      },
      'mark-sent-next': {
        description: '__MSG_cmdMarkSentNext__',
      },
      'next-row': {
        description: '__MSG_cmdNextRow__',
      },
      // Firefox: a bindable "toggle the sidebar" command (the toolbar button does the same).
      ...(browser === 'firefox' && { _execute_sidebar_action: { description: '__MSG_cmdSidebar__' } }),
    },

    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'spintax-outreach@301.st',
          // data_collection_permissions is understood since FF 140.
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
        // Android understands data_collection_permissions since 142 (web-ext lint).
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),

  browser: 'chrome',
});
