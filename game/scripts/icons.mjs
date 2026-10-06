// Renders every item and chassis icon from the game's models in headless Chromium, through icons.html.
// Writes the sprite sheets public/icons/items.svg and public/icons/chassis.png, the manifest src/data/item-icons.json,
// and under public/icons/atlas/ the labeled atlases atlas-top.png, atlas-diagonal.png and atlas-game.png (each entry in
// the view the game shows) and report.txt. The build serves the atlases for review, and the game never loads them.
// Fails when a weapon's barrel does not read from lower left to upper right in the diagonal view.
// Rerun after a model, a weapon pick or the icon style changes. src/data/item-icons.test.ts fails while the manifest is stale.
// Usage: npm run icons -- [--cpu]. With --cpu, Chromium draws in software, as on a machine without a GPU.

import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const BUILD_LIMIT_MS = 600000; // software drawing renders about 150 icons, each in four passes
const cpu = process.argv.includes('--cpu');
const plansOnly = process.argv.includes('--plans');

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

const server = await createServer({ server: { port: 5191, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: cpu ? [] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${server.resolvedUrls.local[0]}icons.html`);
  await page.waitForFunction(() => window.__ICONS__, null, { timeout: 60000 });
  page.setDefaultTimeout(BUILD_LIMIT_MS);
  for (const [path, url] of Object.entries(await page.evaluate(() => window.__ICONS__.plans()))) {
    writeAtomic(path, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`${path}: ${(statSync(path).size / 1024).toFixed(0)} KB`);
  }
  if (plansOnly) process.exit(errors.length ? 1 : 0);
  const result = await page.evaluate(() => window.__ICONS__.build());
  if (errors.length) throw new Error(`The icons page logged errors:\n${errors.join('\n')}`);

  const turned = result.orientation.filter((o) => !o.ok);
  for (const o of turned) console.error(`${o.id}: barrel does not read lower left to upper right: ${JSON.stringify(o.read)}`);
  if (turned.length) throw new Error(`${turned.length} weapon icons face the wrong way in the diagonal view`);

  for (const [path, url] of Object.entries(result.files)) {
    writeAtomic(path, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`${path}: ${(statSync(path).size / 1024).toFixed(0)} KB`);
  }
  writeAtomic('public/icons/atlas/report.txt', result.report);
  writeAtomic('src/data/item-icons.json', `${JSON.stringify(result.manifest, null, 2)}\n`);
  const counts = `${Object.keys(result.manifest.items).length} items, ${Object.keys(result.manifest.chassis).length} chassis`;
  console.log(`src/data/item-icons.json: ${counts}, views ${JSON.stringify(result.manifest.views)}`);
  console.log(`${result.orientation.length} weapon barrels read lower left to upper right`);
} finally {
  await browser.close();
  await server.close();
}
