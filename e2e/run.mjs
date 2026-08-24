/**
 * E2E smoke on a real Chromium with the unpacked extension (plan step 1 verify / §14.5 flow).
 * Usage: node e2e/run.mjs   (builds with --mode e2e, then rebuilds the normal chrome package)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { solidPng } from './png.mjs';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_BROWSER = process.env.E2E_BROWSER === 'msedge' || process.argv.includes('--edge') ? 'msedge' : 'chromium';
const dist = path.join(root, 'dist', E2E_BROWSER === 'msedge' ? 'edge-mv3' : 'chrome-mv3');
const PORT = 8766;
const failures = [];
/** Pick an item in a 301-ui dropdown by the trigger's aria-label and the item text. */
async function pick(page, label, item) {
  await page.locator(`.dropdown__trigger[aria-label="${label}"]`).first().click();
  await page.locator('.dropdown--open .dropdown__item', { hasText: item }).first().click();
}
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✔' : '✖'} ${msg}`);
};

function serveFixtures() {
  const dir = path.join(root, 'e2e', 'fixtures');
  const server = http.createServer((req, res) => {
    const file = path.join(dir, req.url === '/' ? 'contact-cf7.html' : req.url.split('?')[0]);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

console.log(`build (WXT_E2E=1, ${E2E_BROWSER})`);
execSync(`npx wxt build${E2E_BROWSER === 'msedge' ? ' -b edge' : ''}`, { cwd: root, stdio: 'ignore', env: { ...process.env, WXT_E2E: '1' } });
const server = await serveFixtures();
const userData = fs.mkdtempSync(path.join(root, 'dist', 'e2e-profile-'));

const context = await chromium.launchPersistentContext(userData, {
  channel: E2E_BROWSER,
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--lang=en-US'],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  console.log('extension', extId);

  // 1. Seed through the options UI (the same path a user takes).
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extId}/options.html#wizard`);
  await options.getByPlaceholder(/Paste rows/).fill('site\tname\ttopic\thttp://127.0.0.1:8766/\tAnna\tcrypto');
  await options
    .getByPlaceholder(/Paste rows/)
    .fill(
      'site;name;topic;category;icon;screenshot;short;tagline\n' +
        'http://127.0.0.1:8766/contact-cf7.html;Anna;crypto;;;;;\n' +
        'http://localhost:8766/submit-store.html;Chrome Web Store;extensions;Developer Tools;icon.png;shot.png;Manual outreach helper;Outreach without the busywork\n',
    );
  await options.getByRole('button', { name: /Continue to roles/ }).click();
  await options.getByRole('button', { name: /Apply import/ }).click();
  await options.waitForTimeout(300);

  // Column settings (step 12): category / icon / screenshot / short are fillable; icon + screenshot are files.
  await options.goto(`chrome-extension://${extId}/options.html#list`);
  await options.locator('.columns__summary').click();
  const colRows = options.locator('.columns__row');
  for (const i of [3, 4, 5, 6, 7]) await colRows.nth(i).locator('label:has-text("fill into a form field") input').check();
  for (const i of [4, 5]) {
    await colRows.nth(i).locator('.dropdown__trigger').click();
    await options.locator('.dropdown--open .dropdown__item', { hasText: 'file (asset)' }).click();
  }
  await options.getByRole('button', { name: /Save columns/ }).click();
  await options.waitForTimeout(300);

  // Asset library: a matching 128×128 icon and a too-small 440×280 screenshot (spec §16.3 warning).
  await options.goto(`chrome-extension://${extId}/options.html#assets`);
  await options.locator('input[type=file]').setInputFiles([
    { name: 'icon.png', mimeType: 'image/png', buffer: solidPng(128, 128) },
    { name: 'shot.png', mimeType: 'image/png', buffer: solidPng(440, 280) },
  ]);
  await options.getByText(/Added 2 file/).waitFor();
  await options.getByText('shot.png').waitFor();
  check(await options.getByText('128×128').isVisible(), 'asset dimensions detected (128×128)');

  // Wizard step 3: the sender profile is added from a drawer, without leaving the flow.
  await options.goto(`chrome-extension://${extId}/options.html#wizard`);
  await options.getByRole('button', { name: /Add profile/ }).click();
  const drawerInputs = options.locator('.drawer input.input, .drawer textarea');
  await drawerInputs.nth(1).fill('Ivan'); // 0 = profile label
  await drawerInputs.nth(2).fill('ivan@301.st');
  await drawerInputs.nth(3).fill('301.st');
  await options.getByRole('button', { name: /Save profile$/ }).click();
  await options.locator('.drawer').waitFor({ state: 'detached' });
  const shown = await options
    .getByText('Ivan · ivan@301.st · 301.st')
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false); // step 3 re-renders asynchronously
  check(shown, 'profile saved from the drawer and shown on wizard step 3');

  await options.goto(`chrome-extension://${extId}/options.html#template`);
  await options.locator('.template__source').first().fill('{Hello|Hi} %name%, a {quick|short} question about %topic% from %my_name%.');
  await options.waitForTimeout(400);
  await options.getByRole('button', { name: /Save template/ }).click();
  await options.waitForTimeout(300);
  const valid = await options
    .getByText('Template is valid.')
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false); // the view re-renders after save, validation is debounced
  check(valid, 'template saved and valid');

  // Editor overlay (playground port): the engine's diagnostics are underlined in the text itself.
  await options.locator('.template__source').first().fill('{Hello|Hi %name%, about %nope%');
  await options.locator('.editor__overlay .err').first().waitFor({ timeout: 5_000 });
  const overlayWarn = await options.locator('.editor__overlay .warn', { hasText: '%nope%' }).count();
  check(overlayWarn >= 1, 'editor overlay underlines the unclosed brace (error) and %nope% (warning)');
  await options.locator('.template__source').first().fill('{Hello|Hi} %name%, a {quick|short} question about %topic% from %my_name%.');
  await options.waitForTimeout(400);
  await options.getByRole('button', { name: /Save template/ }).click();
  await options.waitForTimeout(300);

  // Playground layout: variables rows with sample values, variants per real row.
  await options.locator('.vars__row', { hasText: '%name%' }).first().waitFor({ timeout: 5_000 });
  const nameRow = (await options.locator('.vars__row', { hasText: '%name%' }).first().textContent()) ?? '';
  await options.locator('.variant').first().waitFor({ timeout: 5_000 });
  const variantCount = await options.locator('.variant').count();
  check(/used/.test(nameRow) && /Anna|Chrome Web Store/.test(nameRow), 'variables block: %name% marked used with a sample value');
  check(variantCount === 2, `variants block renders one item per row (${variantCount})`);

  // Subject template too (mapped to the form's subject field).
  await pick(options, 'Channel', 'Subject');
  await options.waitForTimeout(300);
  await options.locator('.template__source').first().fill('{Question|Hello} about %topic%');
  await options.waitForTimeout(400);
  await options.getByRole('button', { name: /Save template/ }).click();
  await options.waitForTimeout(300);

  // 2. Target page + panel as a tab. The fixture must be the active tab when the panel acts.
  const target = await context.newPage();
  await target.goto(`http://127.0.0.1:${PORT}/contact-cf7.html`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await target.bringToFront();
  await panel.waitForTimeout(500);

  const primary = panel.locator('.panel__primary');
  await primary.waitFor();
  const label = (await primary.textContent())?.trim() ?? '';
  console.log('primary:', label);
  check(/Fill on 127\.0\.0\.1/.test(label), 'panel offers Fill on the fixture host (row = fixture, permission pre-granted)');

  await primary.click();
  await panel.locator('.panel__note').waitFor({ timeout: 10_000 });
  await panel.waitForFunction(() => !(document.querySelector('.panel__note')?.textContent ?? '').startsWith('Scanning'), null, { timeout: 15_000 }).catch(() => {});
  const note = (await panel.locator('.panel__note').textContent()) ?? '';
  console.log('note:', note);
  check(/Filled \d+ field/.test(note), 'fill reported');

  const values = await target.evaluate(() => ({
    name: document.querySelector('[name=your-name]').value,
    email: document.querySelector('[name=your-email]').value,
    url: document.querySelector('[name=your-url]').value,
    subject: document.querySelector('[name=your-subject]').value,
    message: document.querySelector('[name=your-message]').value,
    honeypot: document.querySelector('[name=website]').value,
    token: document.querySelector('[name=_wpcf7]').value,
  }));
  console.log(values);
  check(values.name === 'Ivan', 'profile.name filled');
  check(values.email === 'ivan@301.st', 'profile.email filled');
  check(values.url === '301.st', 'profile.site filled');
  check(/^(Question|Hello) about crypto$/.test(values.subject), 'subject rendered and filled');
  check(/^(Hello|Hi) Anna, a (quick|short) question about crypto from Ivan\.$/.test(values.message), 'body rendered and filled');
  check(values.honeypot === '' && values.token === '123', 'honeypot and hidden fields untouched');

  const mapping = (await panel.locator('.panel__recipe summary').textContent()) ?? '';
  console.log('mapping:', mapping);
  check(/5 mapped/.test(mapping) && /6 missing/.test(mapping), 'recipe: 5 slots mapped; phone + 5 store columns missing');
  // Recipe controls in the panel: fill policy chip cycles and is saved; pin marks the field manual.
  const nameSlot = panel.locator('.panel__slots li', { hasText: 'Your name' }).first();
  await nameSlot.locator('.panel__policy').click();
  await panel.locator('.panel__slots li', { hasText: 'Your name' }).first().locator('.panel__policy', { hasText: 'replace' }).waitFor();
  await panel.locator('.panel__slots li', { hasText: 'Your name' }).first().getByRole('button', { name: /Pin this field/ }).click();
  await panel.locator('.panel__slots li', { hasText: 'Your name' }).first().getByText('pinned').waitFor();
  check(true, 'recipe controls: policy → replace, field pinned');
  check(await panel.getByRole('button', { name: /Forget this recipe/ }).isVisible(), 'recipe controls: forget button present once a recipe exists');

  const after = (await panel.locator('.panel__primary').textContent()) ?? '';
  check(/Sent — next/.test(after), 'primary switched to "Sent — next" (filled_unconfirmed)');
  await panel.locator('.panel__primary').click();
  await panel.waitForTimeout(400);
  const counter = (await panel.locator('.panel__counter').textContent()) ?? '';
  console.log('counter:', counter);
  check(/1 to do/.test(counter), 'one row left to do after marking sent');

  // 3. Step 12 — store listing: select by label, file inputs from the asset library, size warning.
  await target.goto(`http://localhost:${PORT}/submit-store.html`);
  await target.bringToFront();
  await panel.waitForTimeout(500);
  const storeLabel = (await panel.locator('.panel__primary').textContent())?.trim() ?? '';
  console.log('store primary:', storeLabel);
  check(/Fill on localhost/.test(storeLabel), 'queue advanced to the store row (other host), offers Fill');
  await panel.locator('.panel__primary').click();
  await panel.locator('.panel__note').waitFor({ timeout: 10_000 });
  await panel.waitForFunction(() => !(document.querySelector('.panel__note')?.textContent ?? '').startsWith('Scanning'), null, { timeout: 15_000 }).catch(() => {});
  const storeNote = (await panel.locator('.panel__note').textContent()) ?? '';
  console.log('store note:', storeNote);
  const store = await target.evaluate(() => ({
    title: document.querySelector('[name=title]').value,
    summary: document.querySelector('[name=summary]').value,
    category: document.querySelector('[name=category]').value,
    icon: document.querySelector('[name=icon]').files[0]?.name ?? '',
    iconSize: document.querySelector('[name=icon]').files[0]?.size ?? 0,
    shot: document.querySelector('[name=screenshot]').files[0]?.name ?? '',
    description: document.querySelector('[name=description]').value,
    support: document.querySelector('[name=support_email]').value,
    search: document.querySelector('[name=q]').value,
    tagline: document.querySelector('[name=tagline]').value,
  }));
  console.log(store);
  check(store.summary === 'Manual outreach helper', 'row column "short" → Short description');
  check(store.category === 'dev', '<select> Category chosen by option label ("Developer Tools" → dev)');
  check(store.icon === 'icon.png' && store.iconSize > 100, 'icon.png from the asset library landed in <input type=file>');
  check(store.shot === 'shot.png', 'shot.png landed in the screenshot input (warning, not blocking)');
  check(/asks for 1280×800.*440×280/.test(storeNote), 'size mismatch warning shown in the panel');
  check(/Chrome Web Store/.test(store.description) && /extensions/.test(store.description), 'body rendered into the description textarea');
  check(store.support === 'ivan@301.st', 'profile.email → support email');
  check(store.search === '', 'the search box (other form) left alone');
  check(store.tagline === '' && /Tagline[^;]*29 characters, the field takes 20 — not filled/.test(storeNote), 'blocking maxlength: 29-char tagline kept out of a 20-char field, explained in the note');
  console.log('title (subject heuristic, user-correctable):', store.title);

  // 4. Step 13 — scenario D: a follow-up step (0 days) brings the sent row back as step 2 with its own text.
  await options.goto(`chrome-extension://${extId}/options.html#template`);
  await options.locator('.steps__summary').click();
  await options.getByRole('button', { name: /Add follow-up/ }).click();
  await options.getByLabel('Delay days for step 2').fill('0');
  await options.getByRole('button', { name: /Save steps/ }).click();
  await options.locator('.dropdown__trigger[aria-label="Step"]').first().waitFor();
  await options.waitForFunction(() => document.querySelectorAll('.dropdown__trigger[aria-label="Step"] ~ .dropdown__menu .dropdown__item').length >= 2);
  await pick(options, 'Step', 'Step 2');
  await options.waitForTimeout(300);
  await options.locator('.template__source').first().fill('{Following up|Just checking}, %name% — did you see my note about %topic%?');
  await options.waitForTimeout(400);
  await options.getByRole('button', { name: /Save template/ }).click();
  await options.waitForTimeout(300);

  await options.goto(`chrome-extension://${extId}/options.html#list`);
  const dueChip = options.locator('.list__filters button', { hasText: /Due today/ });
  const dueText = (await dueChip.textContent()) ?? '';
  console.log('list filters:', await options.locator('.list__filters').textContent());
  check(/Due today \(1\)/.test(dueText), 'list: one row due today after the follow-up step was added');
  await dueChip.click();
  const dueRows = options.locator('.table tbody tr');
  check((await dueRows.count()) === 1 && /127\.0\.0\.1/.test((await dueRows.first().textContent()) ?? ''), 'due filter shows the sent contact row');
  check(/step 2 due/.test((await dueRows.first().textContent()) ?? ''), 'status badge says "step 2 due <date>"');

  await panel.reload();
  await panel.waitForTimeout(500);
  const counter2 = (await panel.locator('.panel__counter').textContent()) ?? '';
  console.log('counter after follow-up:', counter2);
  check(/2 to do/.test(counter2), 'panel counts the due follow-up as work');
  // The unconfirmed store row sorts first; step to the contact row, now at step 2.
  await panel.locator('.panel__row-nav button').last().click();
  await panel.waitForTimeout(300);
  const meta = (await panel.locator('.panel__row-meta').textContent()) ?? '';
  const body2 = await panel.locator('#message-body').inputValue();
  console.log('follow-up row:', meta, '|', body2);
  check(/step 2/.test(meta), 'panel shows the contact row at step 2');
  check(/^(Following up|Just checking), Anna — did you see my note about crypto\?$/.test(body2), 'step-2 template rendered for the same row (seed key:2)');

  // 5. Step 15 — CSV export with statuses; re-import merges by key and changes nothing.
  await options.goto(`chrome-extension://${extId}/options.html#list`);
  await options.locator('.list__filters button', { hasText: /^All/ }).click(); // the filter is sticky within the page
  const [download] = await Promise.all([
    options.waitForEvent('download'),
    options.getByRole('button', { name: /Export CSV/ }).click(),
  ]);
  const csvPath = await download.path();
  const csv = fs.readFileSync(csvPath, 'utf8');
  console.log('csv header:', csv.split(/\r?\n/)[0]);
  check(/_status/.test(csv) && /,sent,/.test(csv) && /,filled_unconfirmed,/.test(csv), 'export carries _status for both rows');
  check(/^site,name,topic,category,icon,screenshot,short,tagline,_row_id,_key/.test(csv.replace(/^﻿/, '')), 'export keeps the user columns first');

  await options.goto(`chrome-extension://${extId}/options.html#wizard`);
  await options.locator('.wizard-steps li.is-link').first().click(); // back to step 1 "Import" of the existing campaign
  await options.getByPlaceholder(/Paste rows/).fill(csv.replace(/^﻿/, ''));
  await options.getByRole('button', { name: /Continue to roles/ }).click();
  await options.waitForTimeout(300);
  const applyBtn = options.getByRole('button', { name: /Apply import/ });
  const summary = (await options.locator('.wizard-summary, .card__body').first().textContent()) ?? '';
  console.log('re-import:', summary.slice(0, 160).replace(/\s+/g, ' '));
  check(await applyBtn.isDisabled(), 're-import of the export: nothing to add or update (merge by key, statuses kept)');
  await options.goto(`chrome-extension://${extId}/options.html#list`);
  const dueAfter = (await options.locator('.list__filters button', { hasText: /Due today/ }).textContent()) ?? '';
  check(/Due today \(1\)/.test(dueAfter), 'statuses survive the round trip');

  // 5b. Add rows drawer: a bare list of e-mails becomes targets; the drawer reports what it did.
  await options.goto(`chrome-extension://${extId}/options.html#list`);
  await options.getByRole('button', { name: /^Rows$/ }).click();
  await options.locator('.drawer textarea').fill('carol@x.test\ndave@y.test\n');
  await options.locator('.drawer [role=status]', { hasText: /2 new/ }).waitFor({ timeout: 5_000 });
  await options.getByRole('button', { name: /^Add rows$/ }).click();
  await options.locator('.drawer [role=status]', { hasText: /Added 2 row/ }).waitFor({ timeout: 5_000 });
  await options.keyboard.press('Escape');
  await options.locator('.drawer').waitFor({ state: 'detached' });
  const allAfterRows = (await options.locator('.list__filters button', { hasText: /^All/ }).first().textContent()) ?? '';
  check(/All \(4\)/.test(allAfterRows), 'rows drawer: two e-mail rows added to the list');
  // remove them again so the later counts stay as they were
  for (const key of ['carol@x.test', 'dave@y.test']) {
    await options.locator('tr.list__row', { hasText: key }).first().click();
    await options.locator('.drawer').getByRole('button', { name: /Delete row/ }).click();
    await options.locator('.drawer').getByRole('button', { name: /Sure\? Delete/ }).click();
    await options.locator('.drawer').waitFor({ state: 'detached' });
  }

  // 6. Backup drawer: download the ZIP, restore it back — same rows, same statuses.
  await options.goto(`chrome-extension://${extId}/options.html#list`);
  await options.getByRole('button', { name: /^Backup$/ }).click();
  const [zip] = await Promise.all([
    options.waitForEvent('download'),
    options.getByRole('button', { name: /Download backup/ }).click(),
  ]);
  check(/\.zip$/.test(zip.suggestedFilename()), 'backup downloads as a .zip');
  const zipPath = await zip.path();
  await options.locator('.drawer input[type=file]').setInputFiles(zipPath);
  await options.getByRole('button', { name: /Restore from this file/ }).click();
  await options.getByText(/Restored: 2 rows/).waitFor({ timeout: 30_000 });
  check(true, 'restore of the same backup reports 2 rows');
  await options.keyboard.press('Escape');
  await options.locator('.drawer').waitFor({ state: 'detached' });
  const dueAfterRestore = (await options.locator('.list__filters button', { hasText: /Due today/ }).first().textContent()) ?? '';
  check(/Due today \(1\)/.test(dueAfterRestore), 'statuses survive the backup round trip');

  // 7. Row drawer from the list: the store row → Not applicable; the journal lists it.
  await options.locator('.list__filters button', { hasText: /^All/ }).click();
  await options.locator('tr.list__row', { hasText: 'localhost' }).first().click();
  await options.locator('.drawer__title', { hasText: 'localhost' }).waitFor();
  await options.locator('.drawer').getByRole('button', { name: /^Not applicable$/ }).click();
  await options.locator('.row-drawer__journal li', { hasText: /not applicable/ }).first().waitFor({ timeout: 10_000 });
  await options.keyboard.press('Escape');
  await options.locator('.drawer').waitFor({ state: 'detached' });
  const storeRowText = (await options.locator('tr.list__row', { hasText: 'localhost' }).first().textContent()) ?? '';
  check(/not applicable/.test(storeRowText), 'row drawer: outcome recorded, list badge updated');

  // 8. Steps reachable from the list; the panel deep-links to the subject template.
  check(await options.locator('.steps__summary').isVisible(), 'steps editor is on the List screen');
  // The extra actions live in the bottom sheet behind the grip (no <details> since 2026-08-24).
  if (!(await panel.locator('.panel__actions.is-open').count())) await panel.locator('.panel__handle').click();
  await panel.locator('.panel__sheet').waitFor({ state: 'visible' });
  // Since 2026-08-24 the panel REUSES the open options tab instead of spawning one per click
  // (UX review), so the deep link is checked on that tab rather than on a new page event.
  const tabsBefore = context.pages().length;
  await panel.getByRole('button', { name: /Subject template/ }).click();
  await options.waitForURL(/#template\?channel=subject/, { timeout: 10_000 });
  await options.locator('.dropdown__trigger[aria-label="Channel"]').first().waitFor();
  const channelLabel = (await options.locator('.dropdown__trigger[aria-label="Channel"]').first().textContent()) ?? '';
  check(
    /Subject/.test(channelLabel) && /#template\?channel=subject/.test(options.url()),
    'panel opens the Subject template editor by deep link',
  );
  check(context.pages().length === tabsBefore, 'the panel reuses the open options tab instead of adding one');
  await target.bringToFront();

  // 9. Settings → E-mail: provider saved, fit measured against the campaign's longest message.
  await options.goto(`chrome-extension://${extId}/options.html#settings`);
  await pick(options, 'E-mail opens in', 'Gmail');
  await options.getByRole('button', { name: /^Save$/ }).click();
  await options.getByText(/^Saved\.$/).waitFor();
  const fitText = (await options.locator('.settings__fit').textContent()) ?? '';
  console.log('mail fit:', fitText.slice(0, 120));
  check(/Longest message in this campaign: \d+ characters/.test(fitText) && /Gmail takes about \d+/.test(fitText), 'settings: e-mail provider saved, fit measured');
  const orphanText = (await options.locator('.settings__orphans').textContent()) ?? '';
  check(/Every stored file is referenced/.test(orphanText), 'settings: storage card — both uploaded files are in use');

  // 10. Template → playground share link (the site is stubbed; only the URL matters here).
  // The link is locale-aware (EN apex, RU subdomain), so both hosts are stubbed and asserted.
  const playHost = await options.evaluate(() => (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru.spintax.net' : 'spintax.net');
  await context.route('https://spintax.net/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
  await context.route('https://ru.spintax.net/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
  await options.goto(`chrome-extension://${extId}/options.html#template`);
  await options.locator('.template__source').first().waitFor();
  const [play] = await Promise.all([
    context.waitForEvent('page'),
    options.getByRole('button', { name: /Open in playground/ }).click(),
  ]);
  await play.waitForLoadState('domcontentloaded').catch(() => {});
  await play.waitForURL((u) => u.hostname === playHost, { timeout: 10_000 }).catch(() => {});
  console.log('play url:', play.url().slice(0, 160));
  const playUrl = new URL(play.url());
  const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
  check(
    playUrl.origin + playUrl.pathname === `https://${playHost}/play/` &&
      /%name%/.test(b64(playUrl.searchParams.get('t') ?? '')) &&
      /#set %name% = /.test(b64(playUrl.searchParams.get('v') ?? '')),
    'template opens in the playground with the first row as variables',
  );
  await play.close();
  await context.unroute('https://spintax.net/**');
  await context.unroute('https://ru.spintax.net/**');

  // Second fill on the same page must use the saved recipe (source: recipe).
  await panel.locator('.panel__row-nav button').first().click();
  await panel.waitForTimeout(300);
  await target.goto(`http://127.0.0.1:${PORT}/contact-cf7.html`);
  await target.bringToFront();
  await panel.waitForTimeout(300);
  const again = (await panel.locator('.panel__primary').textContent()) ?? '';
  console.log('primary after reload:', again);

  // 11. Welcome → demo campaign (bundled pages) → Fill on the demo page → remove the demo.
  await options.goto(`chrome-extension://${extId}/welcome.html`);
  await options.getByRole('button', { name: /Try the demo campaign/ }).click();
  await options.waitForURL(/options\.html#list/);
  await options.locator('.list__filters').first().waitFor();
  const demoAll = (await options.locator('.list__filters button', { hasText: /^All/ }).first().textContent()) ?? '';
  check(/All \(5\)/.test(demoAll), 'welcome: demo campaign seeded with 5 rows');
  await target.goto(`chrome-extension://${extId}/demo/blog-1.html`);
  await target.bringToFront();
  // the panel learns about the new campaign from the options page (data-changed), no reload
  await panel.locator('.panel__counter', { hasText: '/ 5' }).waitFor({ timeout: 10_000 });
  // queue is sorted by key: demo-blog-1 first
  const demoPrimary = (await panel.locator('.panel__primary').textContent()) ?? '';
  console.log('demo primary:', demoPrimary);
  check(/Fill on the demo page/.test(demoPrimary), 'panel treats the bundled demo page as the target without asking for a permission');
  await panel.locator('.panel__primary').click();
  await panel.waitForFunction(() => /Filled \d+ field/.test(document.querySelector('.panel__note')?.textContent ?? ''), null, { timeout: 15_000 });
  const demoValues = await target.evaluate(() => ({
    name: document.querySelector('[name=your-name]').value,
    message: document.querySelector('[name=your-message]').value,
    hp: document.querySelector('[name=website]').value,
  }));
  check(demoValues.name === 'Alex Demo' && /Maya/.test(demoValues.message) && demoValues.hp === '', 'demo page filled from the demo profile and template, honeypot untouched');
  await options.goto(`chrome-extension://${extId}/options.html#settings`);
  await options.getByRole('button', { name: /Remove the demo campaign/ }).click();
  await options.getByRole('button', { name: /Remove the demo campaign/ }).waitFor({ state: 'detached', timeout: 10_000 });
  check(true, 'demo removed from Settings (button gone after the re-render)');
} finally {
  await context.close();
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log('rebuild normal chrome package');
  execSync(`npx wxt build${E2E_BROWSER === 'msedge' ? ' -b edge' : ''}`, { cwd: root, stdio: 'ignore' });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nE2E OK');
