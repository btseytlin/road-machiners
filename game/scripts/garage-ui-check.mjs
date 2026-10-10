import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/garage-ui-check.mjs <dev-server-url>');
const browser = await chromium.launch();

const read = (page) => page.evaluate(() => ({
  selected: [...document.querySelectorAll('.inv-item.selected')].map(n => n.title.split('\n')[0]),
  inspect: document.querySelector('.inv-inspection')?.innerText.split('\n')[0] ?? '',
  cards: document.querySelectorAll('.town-shop .part-row').length,
  compares: [...document.querySelectorAll('.town-shop .card-compare')].map(n => n.innerText),
  deltas: document.querySelectorAll('.town-shop .part-row .delta').length,
  chips: [...document.querySelectorAll('.town-screen h3 .chip')].map(n => n.title || n.innerText),
  repair: document.querySelector('.town-repair')?.innerText ?? '',
}));

async function enter(page, spot) {
  await page.evaluate(async (id) => {
    const g = window.__ROAM__;
    const c = await import('/src/sim/cheats.ts');
    let w = c.teleport(g.state, c.placeSpot(g.state, id));
    if (id === 'nose' || id === 'bowl') {
      const guns = (x) => x.vehicles.find(v => v.id === x.player.vehicleId).items.filter(i => i.kind === 'part' && i.part.defId && /gun|cannon|rifle|turret|shotgun/i.test(i.part.defId)).length;
      for (let i = 0; i < 40 && !guns(w); i++) w = c.randomKit(w, 5);
    }
    g.apply(w);
    g.town.open();
  }, spot);
  await page.waitForSelector('.town-shop .tabs button', { timeout: 90000 });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 730 } });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state, null, { timeout: 120000 });
  for (const spot of ['nose', 'bowl']) {
    await enter(page, spot);
    await page.locator('.town-screen [data-tab="buyParts"]').click();
    const gun = () => page.locator('.inv-item.mounted', { hasText: /turret|rifle|cannon|shotgun|MG/i }).first();
    await gun().click();
    await page.waitForTimeout(500);
    let r = await read(page);
    assert.equal(r.selected.length, 1, `${spot}: a click must select the mounted weapon`);
    assert(r.inspect.includes(r.selected[0].split(' (')[0]), `${spot}: inspection must name the selection`);
    assert(r.cards > 0 && r.deltas > 0, `${spot}: compact rows must show deltas`);
    await page.locator('.town-shop .part-sum').first().click();
    r = await read(page);
    assert(r.compares.length === 1 && r.compares[0].includes(r.inspect), `${spot}: an opened row must compare with ${r.inspect}`);
    await page.locator('.town-shop .part-sum').first().click();
    await gun().click();
    await page.waitForTimeout(500);
    r = await read(page);
    assert.equal(r.compares.length, 0, `${spot}: clearing the selection must clear the comparison`);
    assert.equal(r.inspect, 'Equipment', `${spot}: clearing must reset the inspection`);
    await gun().focus();
    r = await read(page);
    assert.equal(r.inspect, 'Equipment', `${spot}: focus alone must not change the inspection`);
    assert.equal(r.compares.length, 0, `${spot}: focus alone must not compare`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    r = await read(page);
    assert(r.deltas > 0, `${spot}: Enter must select and compare`);
    assert(!r.chips.includes('Free cargo cells'), `${spot}: garage header must not show free cells`);
    for (const t of ["M's", 'Mass against rated load']) assert(r.chips.includes(t), `${spot}: header must keep the ${t} chip`);
    assert(!r.repair.includes('Nothing broken'), `${spot}: no idle Nothing broken label`);
    await page.evaluate(async () => {
      const g = window.__ROAM__;
      const w = structuredClone(g.state);
      const me = w.vehicles.find(v => v.id === w.player.vehicleId) ?? w.vehicles[0];
      const part = me.items.find(i => i.kind === 'part' && i.part.hp > 0 && i.part.defId !== undefined);
      part.part.hp = 0;
      g.apply(w);
    });
    await page.waitForTimeout(300);
    r = await read(page);
    assert(/\d+ broken/.test(r.repair), `${spot}: repair bar must show the broken count, got ${r.repair}`);
    await page.locator('.town-repair [data-key="repairAll"]').waitFor();
    await page.evaluate(() => window.__ROAM__.town.close());
  }
  await enter(page, 'salvage-yard');
  assert((await read(page)).chips.includes('Free cargo cells'), 'stall header must keep free cells');
  await page.evaluate(() => window.__ROAM__.town.close());
  await page.keyboard.press('i');
  assert((await read(page).then(() => page.locator('.modal:visible h3 .chip[title="Free cargo cells"]').count())) === 1, 'inventory header must keep free cells');
  await page.keyboard.press('Escape');
  await enter(page, 'nose');
  await page.locator('.town-screen [data-tab="buyParts"]').click();
  await mkdir('.playtest', { recursive: true });
  for (const width of [1280, 1024, 800]) {
    await page.setViewportSize({ width, height: 730 });
    await page.waitForTimeout(300);
    const out = await page.evaluate(() => {
      const box = document.querySelector('.town-screen').getBoundingClientRect();
      return [...document.querySelectorAll('.town-screen h3 .chip, .town-repair button')].filter(n => {
        const b = n.getBoundingClientRect();
        return b.x < box.x || b.right > box.right || b.bottom > box.bottom;
      }).length;
    });
    assert.equal(out, 0, `${width}: header chips and repair buttons must lie inside the town screen`);
    await page.screenshot({ path: `.playtest/garage-${width}.png` });
  }
  assert.deepEqual(errors, [], 'No uncaught page errors');
  console.log('PASS: garage comparison follows selection, labels removed at garages only, layout holds');
} finally {
  await browser.close();
}
