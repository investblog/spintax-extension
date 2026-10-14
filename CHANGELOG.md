# Changelog

All notable changes to Spintax — Manual Outreach Helper are documented here.

## [0.2.4] — 2026-10-15

### Added

- **More than one campaign.** Create, rename, switch and delete campaigns from the campaign menu in
  the options header; the side panel follows the campaign you pick. Each campaign picks its scenario when it is created:
  letters and contact forms, or submissions — profiles, listings and posts on sites
- **A sign-up step for submission sites.** Most sites want an account before they take a profile or
  a post, so a submissions campaign shows two tabs in the panel, *Sign-up* and *Submission*. *Fill*
  on a sign-up form puts in the name, e-mail, phone and website from your profile and does not count a
  missing message box as a failure. The password, the boxes, the captcha and the button stay yours.
  The panel keeps a local note per site and profile: the sign-up page you marked, "registered —
  waiting for e-mail", "e-mail confirmed", "no sign-up needed". It never stores a password. Notes go
  into the backup
- **A subject (or title) next to the body** on step 3 of the wizard. Both fields are labelled, and
  the subject is optional; a submissions campaign calls it *Title*
- **A copy button next to each text value in the panel** — subject, message, each mapped text field
  and every sign-up value. When a field does not take the text (a rich editor, a field in a frame), copy it and
  paste it yourself; copying never changes the row's status
- **A second demo campaign, "Demo — profiles and submissions"**, with two sites that ask for an
  account first: a one-page sign-up form, and a sign-up in two steps. It walks the whole path —
  sign-up, the e-mail wait, then the profile or the submission form — without a network request.
  Removing the demo removes both campaigns and their site notes

### Changed

- **List values are data, not spintax.** A cell such as `Acme [Beta]` or `save {50|60}%` is pasted
  into the template as written; it used to render as `Acme Beta` or a random number
- **The panel is laid out like the rest of the 301 family**: each block is a titled group, the field
  mapping and the row editor fold away, and a page without form fields says so in one line instead
  of listing every slot as not found. Slots with no value are no longer reported as missing
- **The wizard's import table clips long cells** to one line (the full text is in the tooltip), so a
  wide list no longer runs off the page. The template preview shows one variant at a time, picked by
  its row key, instead of one long ribbon. In the panel a long URL wraps instead of scrolling the
  message sideways, and the row's columns open into a list with every value in full

- **The engine is `@spintax/core` 0.12.0.** Two sentences glued without a space (`compact.Game`,
  `конец.Начало`) now get the space and the capital, while `example.com` and `ASP.NET` stay whole — at
  the cost of a Title-case pair such as `Yandex.Money`, which now renders `Yandex. Money`. No space is
  left between a punctuation mark and the quote or bracket that closes it (`"yes, " and` → `"yes," and`).
  Permutation separators join bare in Chinese, Japanese, Thai and Lao, Arabic و and Hebrew ו attach to
  the next word, and Arabic plurals take their six CLDR forms (a two-form `ar` block is now an error).
  Templates of these shapes render differently, and every render recorded from here on carries `0.12.0`
  as its engine version.

### Fixed

- **Preview highlights no longer light up pieces of words.** With `lang=en`, the "en" inside ordinary
  words was highlighted, and so were variables the template does not use: the highlight markers
  collided with characters the engine reserves for itself
- **The second step of a multi-step form is a new form, not a changed one.** A sign-up that asks for
  the e-mail first and the rest on the same address made the panel ask you to check the field
  mapping and press *Fill* again on every step

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
