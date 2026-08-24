// Rasterises the brand mark (src/public/icons/spintax.svg — a copy of spintax.net
// icons-src/brand/spintax.svg, the site favicon) into the PNG sizes the manifests and stores
// need. Playwright's Chromium does the rendering (already a dev dependency for E2E; no sharp).
//   node scripts/make-icons.mjs
// Output: src/public/icons/{16,32,48,128}.png (manifest; transparent) and
//         docs/store/assets/logo-300.png (Edge logo; transparent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outIcons = path.join(root, 'src', 'public', 'icons');
const outStore = path.join(root, 'docs', 'store', 'assets');
fs.mkdirSync(outStore, { recursive: true });

const svg = fs.readFileSync(path.join(outIcons, 'spintax.svg'), 'utf8');
// The mark sits inside a 250-unit box with ~20 units of air; crop to it so 16 px is not wasted.
const page = (size) =>
  `<!doctype html><html><body style="margin:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden">
${svg.replace('<svg ', `<svg style="display:block" `).replace(/width="250" height="250" viewBox="0 0 250 250"/, `width="${size}" height="${size}" viewBox="18 2 214 246" preserveAspectRatio="xMidYMid meet"`)}
</body></html>`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const tab = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (size, file) => {
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(page(size));
    await tab.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', path.relative(root, file));
  };
  for (const size of [16, 32, 48, 128]) await render(size, path.join(outIcons, `${size}.png`));
  await render(300, path.join(outStore, 'logo-300.png'));
} finally {
  await browser.close();
}
