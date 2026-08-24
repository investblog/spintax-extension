/**
 * The dynamic half of the length guard: open the real UI in every manifest locale and measure.
 *
 * The static guard (scripts/i18n-check.mjs) counts code points against a budget — cheap, and blind
 * to what the font actually does. This one loads the extension with `--lang=<locale>`, seeds the
 * demo campaign, and asks the browser whether anything is clipped or pushed out of its slot.
 *
 * Two measurements, because half the fragile slots have no `overflow: hidden` and therefore report
 * `scrollWidth === clientWidth` even while their text spills:
 *   - CLIPPED  — `scrollWidth > clientWidth + 1` (the slot ellipsizes or hides the tail)
 *   - SPILLED  — the text's own rect (Range) reaches past the padding box of its container
 * Plus a whole-document check on the 320 px panel: a horizontal scrollbar means a nowrap label won.
 *
 *   node e2e/i18n-overflow.mjs                 all locales
 *   node e2e/i18n-overflow.mjs --locale de     one locale
 *   node e2e/i18n-overflow.mjs --shots         save a screenshot per failing screen
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist', 'chrome-mv3');
const shotsDir = path.join(root, 'dist', 'i18n-shots');
const SHOTS = process.argv.includes('--shots');
const only = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : null;
const LOCALES = only ? [only] : ['en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'tr'];

/** Slots that must never clip or spill. Keep in step with scripts/i18n/budgets.json. */
const SLOTS = [
  '.panel__primary',
  '.panel__secondary .btn',
  '.panel__group-row .btn',
  '.panel__group-label',
  '.slot__name',
  '.slot__field',
  '.flag',
  '.panel__counter',
  '.badge',
  '.sidebar .navitem .label',
  '.vars__group',
  '.review__item-key',
  '.dropdown__trigger',
  '.dropdown--open .dropdown__item',
  '.dropdown--open .dropdown__item-hint',
  '.wizard-step',
  '.drawer__footer',
  '.drawer__footer .btn',
  '.table th',
  '.btn-chip',
  '.list__filters .btn',
  '.field-label',
];

const failures = [];
const note = (msg) => {
  failures.push(msg);
  console.log(`✖ ${msg}`);
};

/** Runs in the page: report every element of `selectors` whose text does not fit its box. */
const measure = (selectors) => {
  const out = [];
  let seen = 0;
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      seen++;
      const clipped = el.scrollWidth > el.clientWidth + 1;
      // Text rect vs the element's own padding box: catches the slots without overflow:hidden.
      const range = document.createRange();
      range.selectNodeContents(el);
      const textBox = range.getBoundingClientRect();
      const padRight = box.right - Number.parseFloat(style.paddingRight || '0');
      const spilled = textBox.width > 0 && textBox.right > padRight + 1;
      if (clipped || spilled)
        out.push({
          selector,
          text: text.slice(0, 48),
          kind: clipped ? 'clipped' : 'spilled',
          over: Math.round(clipped ? el.scrollWidth - el.clientWidth : textBox.right - padRight),
        });
    }
  }
  return { seen, out };
};

async function screen(page, locale, name, url, viewport, prepare, required) {
  await page.setViewportSize(viewport);
  await page.goto(url);
  await page.waitForTimeout(700);
  if (prepare) await prepare(page);
  // A screen whose dropdown / sheet / drawer never opened measures the shell and looks green.
  if (required && (await page.locator(required).count()) === 0) {
    note(`${locale} · ${name} · "${required}" never appeared — the screen was not in the state we measure`);
    return 0;
  }
  const { seen, out: problems } = await page.evaluate(measure, SLOTS);
  // A guard that measured nothing must not read as a pass.
  if (seen === 0) note(`${locale} · ${name} · measured 0 elements — the screen did not render`);
  else console.log(`  ${name}: ${seen} slots measured${problems.length ? `, ${problems.length} over` : ''}`);
  for (const p of problems) note(`${locale} · ${name} · ${p.selector} ${p.kind} by ${p.over}px — "${p.text}"`);
  if (viewport.width <= 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (scrolls) note(`${locale} · ${name} · the 320px panel scrolls horizontally`);
  }
  if (SHOTS && problems.length > 0) {
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, `${locale}-${name}.png`), fullPage: true });
  }
  return problems.length;
}

console.log('building…');
execSync('npx wxt build', { cwd: root, stdio: 'ignore', env: { ...process.env, WXT_E2E: '1' } });

for (const locale of LOCALES) {
  const userData = fs.mkdtempSync(path.join(root, 'dist', `i18n-${locale}-`));
  const context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--lang=${locale}`],
    // `--lang` alone is enough on Windows but not on the Linux runner, where Chromium takes its UI
    // language from the environment and every locale came back as en-US — the guard below caught it
    // and failed the sweep rather than measuring English seven times. LANGUAGE is the variable
    // Chromium reads for the UI locale; LC_ALL is left alone so an uninstalled system locale cannot
    // break the process.
    env: { ...process.env, LANGUAGE: locale, LANG: `${locale.replace('-', '_')}.UTF-8` },
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const page = await context.newPage();

    // Seed the demo so every screen has content; the welcome page owns that button.
    await page.goto(`chrome-extension://${id}/welcome.html`);
    await page.waitForTimeout(500);
    // The first primary button on the welcome page is the demo CTA — selected by class, not by
    // its label, because the label is exactly what changes per locale.
    const demo = page.locator('button.btn--primary').first();
    if (await demo.count()) await demo.click();
    await page.waitForTimeout(1200);
    const uiLang = await page.evaluate(() => chrome.i18n.getUILanguage());
    console.log(`\n— ${locale} (browser reports ${uiLang})`);
    // Without this the sweep can measure English seven times and still print OK (Codex review #5).
    const asked = locale.toLowerCase();
    const got = uiLang.toLowerCase();
    if (got !== asked && !got.startsWith(`${asked}-`) && !asked.startsWith(`${got}-`)) {
      note(`${locale}: the browser loaded "${uiLang}" instead — nothing measured for this locale`);
      continue;
    }

    await screen(page, locale, 'panel', `chrome-extension://${id}/sidepanel.html`, { width: 320, height: 720 }, async (p) => {
      const grip = p.locator('.panel__handle');
      if (await grip.count()) await grip.click(); // open the sheet: its rows are the tightest
      await p.waitForTimeout(400);
    }, '.panel__actions.is-open .panel__group-row .btn');
    await screen(page, locale, 'list', `chrome-extension://${id}/options.html#list`, { width: 1280, height: 800 });
    await screen(page, locale, 'list-narrow', `chrome-extension://${id}/options.html#list`, { width: 900, height: 800 });
    await screen(
      page,
      locale,
      'wizard',
      `chrome-extension://${id}/options.html#wizard`,
      { width: 1280, height: 800 },
      async (p) => {
        // The role menu holds the longest hints in the app; a closed menu measures nothing.
        const trigger = p.locator('.dropdown__trigger').first();
        if (await trigger.count()) {
          await trigger.click();
          await p.waitForTimeout(300);
        }
      },
    );
    await screen(page, locale, 'template', `chrome-extension://${id}/options.html#template`, { width: 1280, height: 800 });
    await screen(page, locale, 'review', `chrome-extension://${id}/options.html#review`, { width: 1280, height: 800 });
    await screen(
      page,
      locale,
      'settings',
      `chrome-extension://${id}/options.html#settings`,
      { width: 1280, height: 800 },
      async (p) => {
        // Settings always has a dropdown (the mail provider): open it so its items are measured.
        const trigger = p.locator('.dropdown__trigger').first();
        if (await trigger.count()) {
          await trigger.click();
          await p.waitForTimeout(300);
        }
      },
      '.dropdown--open .dropdown__item',
    );
    await screen(page, locale, 'drawer-rows', `chrome-extension://${id}/options.html#list?open=rows`, {
      width: 1280,
      height: 800,
    });
    // #list?open=rows opens the PASTE drawer; the row drawer needs a click on a row — and that is
    // where Codex found two defects the old sweep never looked at (review #6).
    await screen(
      page,
      locale,
      'drawer-row',
      `chrome-extension://${id}/options.html#list`,
      { width: 1280, height: 800 },
      async (p) => {
        // The previous screen left the paste drawer open; it is a singleton on <body> and survives
        // a hash navigation, so it would swallow the click on the row.
        await p.keyboard.press('Escape');
        await p.waitForTimeout(300);
        const row = p.locator('tr.list__row').first();
        if (await row.count()) await row.click();
        await p.waitForTimeout(600);
      },
      '.drawer',
    );
  } finally {
    await context.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

console.log(`\n${failures.length === 0 ? 'i18n overflow OK' : `i18n overflow FAILED: ${failures.length} problem(s)`}`);
process.exit(failures.length === 0 ? 0 : 1);
