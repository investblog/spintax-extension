![Spintax](.github/banner.png)

# Spintax — Manual Outreach Helper

Manual-outreach helper for Chrome, Edge and Firefox: one spintax template, a list of rows, a
side-panel queue. It renders a unique message per row and fills the contact form on the page you
are on — **you** read it and press Send. Local, no accounts, no telemetry.

[![CI](https://github.com/investblog/spintax-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/investblog/spintax-extension/actions/workflows/ci.yml)
[![Releases](https://img.shields.io/github/v/release/investblog/spintax-extension?sort=semver)](https://github.com/investblog/spintax-extension/releases)
[![License](https://img.shields.io/badge/License-GPL--3.0--or--later-green.svg)](LICENSE)
[![Engine](https://img.shields.io/badge/engine-%40spintax%2Fcore-1f6feb)](https://github.com/investblog/spintax-js)

Built on the [`@spintax/core`](https://github.com/investblog/spintax-js) engine — the same one
behind [Spintax Studio](https://spintax.net/spintax-editor/#studio) and
[spintax.net](https://spintax.net), so a template renders identically in all of them.

## Features

- **Import** CSV / XLSX / paste from a spreadsheet; columns become variables (`%name%`, `%site%`…),
  roles are detected from values, duplicates merged by target key (hostname, e-mail or @handle).
- **Templates** in spintax with includes; per-row rendering is deterministic — the seed is the row
  key, so the same contact always sees the same wording.
- **AI handoff** — a built-in prompt for authoring, repair and translation, opened in your own chat
  (ChatGPT in a tab, Claude Desktop by deep link) or copied to the clipboard. The extension sends
  nothing itself.
- **Review screen** with highlighted variables and warnings before the first message goes out
  (empty variable, leaked brace, field length).
- **Queue panel** next to the page: *Fill on site.com* → fields filled, a report per field, *Sent —
  next*. Outcomes (sent, deferred, no form, captcha, replied, declined) go to a local journal you
  can export.
- **Field mapping** by autocomplete, type and multilingual labels, saved as per-site recipes;
  *Point at field* for the rest; honeypots skipped; rich editors (Gmail, LinkedIn) via the clipboard.
- **Follow-ups** as steps, each with its own template and delay; due rows return to the same queue.
- **Asset library** for file inputs (logos, screenshots) with a size check before the upload.
- **7 languages** — English, Russian, German, Spanish, French, Brazilian Portuguese, Turkish: the
  whole interface, not just the store listing. Dark & light theme.
- **Backup** — ZIP export / import of everything.
- **Anti-scope, by design** — it never submits a form, never solves a captcha, never scrapes a page,
  never adds "human-like" delays. That boundary is a design rule, not a setting.

## Install

Not published yet. The first release will list Chrome Web Store · Edge Add-ons · Firefox Add-ons
here; until then, grab a ZIP from [Releases](https://github.com/investblog/spintax-extension/releases)
and load it unpacked (`chrome://extensions` → Developer mode → Load unpacked).

What changed between versions: [CHANGELOG.md](CHANGELOG.md).

## How it works

Import your list and write one template. Open the side panel on the page you want to write to: the
helper recognises the contact form, fills the fields it understands from that row's variables, and
tells you what went where and what it could not find. You read the message, press Send on the page
yourself, and mark the row done — the next one is already there.

A bundled demo campaign with four demo pages ships in the package, so the whole flow can be tried
without touching a real site and without a single network request.

## Build

```bash
npm ci                 # Node 22
npm run build          # dist/chrome-mv3
npm run build:firefox  # dist/firefox-mv2
npm run build:edge     # dist/edge-mv3
npm run zip:all        # store packages + a source ZIP for AMO
```

`npm run check` runs the whole gate — `typecheck` (tsc) · `lint` (Biome) · `test` (Vitest) ·
`i18n:check` (key parity, placeholder shape and length budgets across all seven locales).
Separately: `npm run e2e` (Playwright + Chromium with the unpacked extension; `npm run e2e:edge`
for Edge) · `npm run i18n:overflow` (the real UI measured in every locale) · `npm run lint:ext`
(web-ext lint on the Firefox build).

Translations live in `src/public/_locales/`, built from the fragments in `scripts/i18n/` by
`npm run i18n:merge`; `npm run i18n:check` refuses a locale that has drifted.

## Tech stack

- [WXT](https://wxt.dev) — extension framework, one source for MV3 (Chrome/Edge) and MV2 (Firefox)
- TypeScript strict mode, vanilla DOM + CSS custom properties, no UI framework
- [`@spintax/core`](https://github.com/investblog/spintax-js) for parsing and rendering,
  `@spintax/authoring-prompt` for the AI prompts, `fflate` for ZIP backups — the only runtime
  dependencies
- Vitest — 153 tests; Playwright end-to-end against the unpacked extension in Chromium and Edge

## Privacy

No server, no account, no analytics, and **no network requests by default**. Campaigns, contacts,
templates and the journal live in this browser's IndexedDB and leave it only when you export a
backup yourself.

Nothing is requested at install: no host permissions and no content scripts. Filling a form asks
for that one origin, from the Fill button, at the moment you press it.

The single optional network call is the publisher news feed — one GET to `https://301.sh/posts.json`
every six hours, only after you switch it on with the bell in the panel header, and the
`notifications` permission is removed again when you switch it off.

Full text: <https://spintax.net/privacy/#extension>.

## Related

- [Spintax Studio](https://spintax.net/spintax-editor/#studio) — native Windows editor for spintax
  templates, offline
- [spintax-js / `@spintax/core`](https://github.com/investblog/spintax-js) — the engine, zero
  dependencies, runs on Cloudflare Workers, Node and the browser
- [spintax.net](https://spintax.net) — the playground and the rest of the Spintax line
- [Redirect Inspector](https://github.com/investblog/redirect-inspector) — real-time redirect
  console for developers
- [Geo Tier Builder](https://github.com/investblog/geo-tier-builder) — country tiers, GEO lists and
  TDS regexes
- [301.st](https://301.st) — domain management with redirects and traffic distribution

## License

[GPL-3.0-or-later](LICENSE)

---

Built by [investblog](https://github.com/investblog) at [301.st](https://301.st) with
[Claude](https://claude.ai)

## Releasing

The version lives in `wxt.config.ts` (`manifest.version`) and must match `package.json` — CI
enforces it.

**`v*` tags are cut by CI, never locally.** Bump the version, push to `main`, then run the
**Cut release** workflow (Actions → *Cut release*, or `gh workflow run cut-release.yml`). It re-runs
the full gate and builds on a Linux runner, so no Windows working-copy artefact (CRLF, path
separators, locale-dependent tooling) can reach a release, then creates the tag and dispatches
`release.yml` (GitHub release with the built ZIPs) and, if asked, `submit.yml`.

The `submit` input defaults to `none`: the first listing in each store is created by hand, because
the name and short description come from the package rather than the dashboard form, and AMO burns
a version number the moment it is submitted.
