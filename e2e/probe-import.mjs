// Probe: import a real xlsx through the wizard (file input → roles → apply) and report console
// errors and timings. node e2e/probe-import.mjs "C:/path/file.xlsx"
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'chrome-mv3');
const file = process.argv[2];
if (!file) throw new Error('file path required');
execSync('npx wxt build', { cwd: root, stdio: 'ignore' });
const userData = fs.mkdtempSync(path.join(root, 'dist', 'probe-profile-'));
const context = await chromium.launchPersistentContext(userData, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--lang=en-US'],
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log('console', m.type(), m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => log('pageerror', e.message.slice(0, 300)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extId}/options.html#wizard`);
  let t0 = Date.now();
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.getByRole('button', { name: /Continue to roles/ }).waitFor({ timeout: 180_000 });
  log('parsed in', Date.now() - t0, 'ms;', (await page.locator('.field-hint').first().textContent())?.slice(0, 300));
  await page.screenshot({ path: path.join(root, 'dist', 'probe-step1.png') });
  t0 = Date.now();
  await page.getByRole('button', { name: /Continue to roles/ }).click();
  await page.getByRole('button', { name: /Apply import/ }).waitFor({ timeout: 180_000 });
  log('plan in', Date.now() - t0, 'ms');
  log('roles:', await page.locator('.th-stack .dropdown__trigger').allTextContents());
  log('summary:', (await page.locator('text=/Import: /').first().textContent())?.slice(0, 200));
  await page.screenshot({ path: path.join(root, 'dist', 'probe-step2.png') });
  t0 = Date.now();
  await page.getByRole('button', { name: /Apply import/ }).click();
  await page.waitForFunction(() => !document.querySelector('.wizard-step.is-current .wizard-step__num')?.textContent?.startsWith('2'), null, { timeout: 180_000 }).catch(() => log('step did not advance'));
  log('applied in', Date.now() - t0, 'ms; current step:', await page.locator('.wizard-step.is-current').textContent());
  await page.screenshot({ path: path.join(root, 'dist', 'probe-step3.png') });
  await page.goto(`chrome-extension://${extId}/options.html#list`);
  await page.locator('.list__filters').first().waitFor({ timeout: 60_000 });
  log('list:', await page.locator('.list__filters').first().textContent());
} finally {
  await context.close();
  fs.rmSync(userData, { recursive: true, force: true });
}
