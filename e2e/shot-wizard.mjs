// Screenshot of the wizard step 2 (roles & duplicates) with a header-less contact list —
// for checking the 301-ui controls in the table header. node e2e/shot-wizard.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'chrome-mv3');
const out = process.argv[2] ?? path.join(root, 'dist', 'shot-wizard-step2.png');
execSync('npx wxt build', { cwd: root, stdio: 'ignore' });
const userData = fs.mkdtempSync(path.join(root, 'dist', 'shot-profile-'));
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extId}/options.html#wizard`);
  const rows = [];
  for (let i = 0; i < 1200; i++)
    rows.push(`${265686 + i};user${i}@example.com;38099${String(1000000 + i).slice(1)};handle_${i};telegram;${['fb', 'FB', 'Fb'][i % 3]};${['CPA', 'RS'][i % 2]}`);
  await page.getByPlaceholder(/Paste rows/).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, rows.join('\n'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: out.replace('step2', 'step1'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.getByRole('button', { name: /Continue to roles/ }).click();
  await page.getByRole('button', { name: /Apply import/ }).waitFor();
  await page.locator('.dropdown__trigger').nth(1).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Apply import/ }).click();
  await page.getByRole('button', { name: /Add profile/ }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: out.replace('step2', 'step3'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.getByRole('button', { name: /Add profile/ }).click();
  await page.locator('.drawer').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out.replace('step2', 'step3-drawer'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.keyboard.press('Escape');
  await page.goto(`chrome-extension://${extId}/options.html#list`);
  await page.locator('tr.list__row').first().click();
  await page.locator('.drawer').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out.replace('step2', 'list-drawer'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.keyboard.press('Escape');
  await page.goto(`chrome-extension://${extId}/welcome.html`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out.replace('step2', 'welcome'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log('wrote', out);
} finally {
  await context.close();
  fs.rmSync(userData, { recursive: true, force: true });
}
