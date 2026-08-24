/**
 * Import-size benchmark on a real Chromium with the unpacked extension: how long the wizard
 * (paste → roles → apply), the list screen and the panel take for N rows. Usage:
 *   node e2e/bench.mjs [sizes]   e.g. node e2e/bench.mjs 1000,5000,10000,20000
 * Prints a table; used to pick the honest slice size for big lists (spec §14.1).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'chrome-mv3');
const sizes = (process.argv[2] ?? '1000,5000,10000,20000').split(',').map(Number);

console.log('build (WXT_E2E=1)');
execSync('npx wxt build', { cwd: root, stdio: 'ignore', env: { ...process.env, WXT_E2E: '1' } });

/** Realistic rows: a domain target, a name, a topic, a phone, a category, a long-ish note. */
function csv(n) {
  const lines = ['site;name;topic;phone;channel;note'];
  for (let i = 0; i < n; i++) {
    lines.push(
      `site-${i}.example.com;Name ${i};topic ${i % 17};+380 99 ${String(1000000 + i).slice(1)};${['telegram', 'email', 'form'][i % 3]};Note about site ${i} with a few words of context`,
    );
  }
  return lines.join('\n');
}

const results = [];
for (const n of sizes) {
  const userData = fs.mkdtempSync(path.join(root, 'dist', 'bench-profile-'));
  const context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--lang=en-US'],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    const page = await context.newPage();
    const t = {};
    const time = async (key, fn) => {
      const t0 = Date.now();
      await fn();
      t[key] = Date.now() - t0;
    };

    await page.goto(`chrome-extension://${extId}/options.html#wizard`);
    const text = csv(n);
    // Paste: set the textarea value in one go (like a real Ctrl+V), then dispatch input.
    await time('paste→preview', async () => {
      await page.getByPlaceholder(/Paste rows/).evaluate((el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);
      await page.getByRole('button', { name: /Continue to roles/ }).waitFor();
      // Big lists import in batches: ask for the whole list (capped at the wizard's maximum).
      const batch = page.getByLabel('Rows in the batch');
      if ((await batch.count()) > 0) {
        await batch.fill(String(Math.min(n, 5000)));
        await batch.dispatchEvent('change');
        await page.waitForTimeout(100);
      }
    });
    await time('roles (plan)', async () => {
      await page.getByRole('button', { name: /Continue to roles/ }).click();
      await page.getByRole('button', { name: /Apply import/ }).waitFor();
    });
    await time('apply (IndexedDB)', async () => {
      await page.getByRole('button', { name: /Apply import/ }).click();
      await page.getByRole('button', { name: /Apply import/ }).waitFor({ state: 'detached', timeout: 120_000 });
    });
    await time('list screen', async () => {
      await page.goto(`chrome-extension://${extId}/options.html#list`);
      await page.locator('.list__filters').first().waitFor({ timeout: 120_000 });

    });
    await time('review screen', async () => {
      await page.goto(`chrome-extension://${extId}/options.html#review`);
      await page.waitForTimeout(100);
      await page.waitForFunction(() => document.querySelector('#content, .card')?.textContent?.length > 50, null, { timeout: 120_000 }).catch(() => {});
    });
    const panel = await context.newPage();
    await time('panel load', async () => {
      await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
      await panel.locator('.panel__counter').waitFor({ timeout: 120_000 });
    });
    const marks = async (p) => Object.fromEntries((await p.evaluate(() => performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)]))));
    t.listMarks = await (async () => { await page.goto(`chrome-extension://${extId}/options.html#list`); await page.locator('.list__filters').first().waitFor({ timeout: 120_000 }); return JSON.stringify(await marks(page)); })();
    t.panelMarks = JSON.stringify(await marks(panel));
    const counter = (await panel.locator('.panel__counter').textContent()) ?? '';
    results.push({ rows: n, ...t, counter: counter.trim() });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    await context.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}
console.table(results);
execSync('npx wxt build', { cwd: root, stdio: 'ignore' });
