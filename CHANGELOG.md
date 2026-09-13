# Changelog

All notable changes to Spintax — Manual Outreach Helper are documented here.

## [0.2.3] — 2026-09-13

### Changed

- **The engine is `@spintax/core` 0.8.0**, which reads a template the way the PHP engines do in three
  more places. Russian abbreviations such as `и т.д.` no longer turn into `и т. Д.`, a Cyrillic domain
  or email stays whole, and a no-break space spaces and capitalizes like an ordinary one. A `%variable%`
  in a permutation's `<config>` and a `{?…}` inside `{…}` or `[…]` count before the construct is
  split, and an element that renders empty is dropped instead of leaving `a, , b`. Templates of these
  shapes render differently, and every render recorded from here on carries `0.8.0` as its engine
  version.

## [0.2.2] — 2026-09-12

### Changed

- **The engine is `@spintax/core` 0.7.0** — a `%variable%` written directly inside `{…}` or `[…]`
  is now spliced as text before the construct is split, so a value holding `a|b|c` renders as three
  options or elements instead of one literal run. That is what the PHP engines have always done;
  this one was the odd family member out. A template that relied on the old behaviour renders
  differently, and every render recorded from here on carries `0.7.0` as its engine version.

## [0.2.1] — 2026-08-28

### Added

- **"Rate us" in the panel footer links all three stores** — Chrome Web Store, Edge Add-ons and
  Firefox Add-ons are all live, so the link now shows in every build
- **A welcome hint for Chrome users** — once the side panel is open, the pin in its header keeps
  the Spintax icon on the toolbar; the hint renders only where that control exists

### Fixed

- **A theme toggled in the panel now reaches the pages already open** — the welcome and options
  pages used to keep the old theme until a reload
- **Icons say what the button does** — "Open the side panel" carries the side-panel glyph (the one
  Chrome draws on its own toolbar button) and Fill carries the autofill wand; the play triangle no
  longer stands for three different verbs

## [0.2.0] — 2026-08-24

### Added

- **The whole interface in seven languages** — English, Russian, German, Spanish, French, Brazilian
  Portuguese, Turkish. 834 message keys, plural forms through `Intl.PluralRules`, and a two-level
  length guard: `npm run i18n:check` measures every budget on substituted text, `npm run
  i18n:overflow` measures the real UI in all seven locales across nine screens
- **Open the target in the current tab or a new one** — a setting, with Ctrl / ⌘ / Shift / middle
  click overriding it per click
- **Straight to the campaign from the panel** — the campaign name in the header opens the options
  page, and the message editor is reachable from the queue
- **A bottom sheet in the panel footer** — a draggable grip, outcomes and the rest behind it, so the
  three footer links stop eating 40 px of a 320 px panel
- **Store submission pack** — listings for all seven languages, the privacy policy in seven,
  per-permission justifications, reviewer notes with AMO build steps, a submission playbook and a
  pre-flight checklist, all under `docs/store/`
- **Two new guards** — `npm run store:check` (per-store limits, banned vocabulary, keyword stuffing,
  plain-text vs Markdown, assets and their dimensions) and `scripts/make-shots.mjs`, which
  regenerates all five store screenshots from the built package

### Fixed

- **Ctrl+A no longer approves a row** on the Review screen, and Ctrl+S no longer marks one sent —
  the physical-key matching added for the RU/TR/DE layouts had widened one-letter shortcuts into
  chords the user presses by reflex
- **The Firefox sidebar no longer opens by itself on install** — `sidebar_action` is built from the
  entrypoint's options, so `open_at_install: false` and the icon had to move into the sidepanel HTML
- **"Save edit" on the Review screen** is hidden until Edit opens the editor; it used to sit beside
  Approve as a second primary button and wrote an "edited" journal event for unchanged text
- **The panel's empty state** no longer stretches to 760 px — the panel root and a status callout
  shared a `.panel` class
- **Settings reach an open side panel** — changing where a target opens used to look broken until
  the panel was reopened
- **The cog reuses an open options tab** instead of leaving a trail of them, and raises that tab's
  window
- **Editor links** point at `spintax.net/spintax-editor/#studio` and follow the site's locale
  routing (RU on its own subdomain) instead of landing on the homepage
- **Auto theme** stamps the system theme, so a dark OS no longer renders cards transparent

### Changed

- The privacy policy moved to one page for the whole Spintax line,
  <https://spintax.net/privacy/#extension>; the extension links to the EN page in every UI language
  except Russian, because no other locale is published
- `clipboardRead` removed from the manifest — the "paste from clipboard" button it was reserved for
  does not exist, and an unused permission is a question at review

## [0.1.0] — 2026-08-23

First release. CSV/XLSX import with role detection and deduplication, spintax templates with
variables and includes, AI prompt handoff, review screen, field mapping with per-site recipes, the
side-panel queue, follow-up steps, an asset library for file uploads, a local journal and ZIP
backup. Chrome MV3, Edge MV3 and Firefox MV2 builds. No telemetry.
