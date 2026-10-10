import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { gpuArgs } from './gpu.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ids = process.argv[2]?.split(',');
if (!ids || ids[0].startsWith('--')) throw new Error('Usage: npm run site:shot -- <site-id>[,<site-id>] [--hour 23] [--zoom 1] [--out .playtest/sites] [--url http://localhost:5173]');
const url = arg('url', 'http://localhost:5173');
const hours = arg('hour', '23').split(',').map(Number);
const zoom = Number(arg('zoom', '1'));
const out = arg('out', '.playtest/sites');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: gpuArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto(url);
await page.waitForFunction(() => window.__ROAM__ && window.__ROAM_PERF__, null, { timeout: 60000 });
await page.waitForTimeout(1000);
for (const id of ids) {
  for (const hour of hours) {
    await page.evaluate(async ({ id, hour, zoom }) => {
      const g = window.__ROAM__;
      const { REGION } = await import('/src/data/region.ts');
      const { sitePads } = await import('/src/sim/sites.ts');
      const cheats = await import('/src/sim/cheats.ts');
      const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
      if (!site) throw new Error(`No site ${id}`);
      g.apply(cheats.skipToHour(cheats.teleport(g.state, sitePads(site)[0]), hour));
      g.debugView(site.pos.x, site.pos.y, zoom);
    }, { id, hour, zoom });
    await page.waitForTimeout(4000);
    const path = `${out}/${id}-${hour}.png`;
    await page.screenshot({ path });
    console.log(path);
  }
}
await browser.close();
if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
