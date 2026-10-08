// Browser check of the compact shop part rows: collapsed by default, one open at a time, keyboard, purchase, filter.
// Usage: node scripts/shop-parts-check.mjs <dev-server-url>. Screenshots go to .playtest/.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/shop-parts-check.mjs <dev-server-url>');
const browser = await chromium.launch();
await mkdir('.playtest', { recursive: true });

const visibleRows = (page) => page.evaluate(() => {
  const box = document.querySelector('.town-shop').getBoundingClientRect();
  return [...document.querySelectorAll('.town-shop .part-sum')].filter((n) => {
    const b = n.getBoundingClientRect();
    return b.top >= box.top && b.bottom <= box.bottom;
  }).length;
});
const rows = (page) => page.locator('.town-shop .part-row');
const money = (page) => page.evaluate(() => window.__ROAM__.state.player.money);

async function setup(page) {
  await page.evaluate(async () => {
    const g = window.__ROAM__;
    const c = await import('/src/sim/cheats.ts');
    const f = await import('/src/sim/factory.ts');
    const { PARTS } = await import('/src/data/parts.ts');
    let w = c.teleport(g.state, c.placeSpot(g.state, 'nose'));
    w = structuredClone(w);
    const defs = Object.values(PARTS).filter((d) => d.kind !== 'core');
    const stock = [];
    for (let i = 0; i < 16; i++) stock.push(f.makePart(w, defs[i % defs.length].id, i % 3));
    stock[3].hp = 0;
    w.shops.nose.stock = stock;
    w = c.setMoney(w, 400);
    g.apply(w);
    g.town.open();
  });
  await page.waitForSelector('.town-shop .tabs button', { timeout: 90000 });
  await page.locator('.town-screen .tabs button', { hasText: 'Buy Parts' }).click();
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 730 } });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state, null, { timeout: 120000 });
  await setup(page);

  assert.equal(await page.locator('.part-detail').count(), 0, 'rows start collapsed');
  assert.equal(await rows(page).count(), 16);
  const seen = await visibleRows(page);
  console.log('visible rows at 1280x730:', seen);
  await writeFile('.playtest/shop-parts-after.json', JSON.stringify({ visible: seen }));
  assert((await page.locator('.part-sum .price').count()) === 16);
  await page.screenshot({ path: '.playtest/shop-parts-after-1280.png' });
  assert(seen >= 6, `the compact list must show many parts, shows ${seen}`);

  await rows(page).nth(4).locator('.part-sum').click();
  assert.equal(await page.locator('.part-detail').count(), 1);
  assert(await rows(page).nth(4).locator('.part-detail .stat-grid').count());
  assert(await rows(page).nth(4).locator('.part-detail .meter').count());
  assert(await rows(page).nth(4).locator('.part-detail button').count());
  await page.screenshot({ path: '.playtest/shop-parts-open-1280.png' });
  const top = () => rows(page).nth(8).locator('.part-sum').evaluate((n) => n.getBoundingClientRect().top);
  await rows(page).nth(8).locator('.part-sum').evaluate((n) => n.scrollIntoView({ block: 'start' }));
  const before = await top();
  await rows(page).nth(8).locator('.part-sum').click();
  assert.equal(await page.locator('.part-detail').count(), 1);
  assert.equal(await rows(page).nth(8).locator('.part-sum').getAttribute('aria-expanded'), 'true');
  assert.equal(await rows(page).nth(4).locator('.part-sum').getAttribute('aria-expanded'), 'false');
  assert(Math.abs((await top()) - before) <= 2, 'the clicked head must not move');
  await rows(page).nth(8).locator('.part-sum').click();
  assert.equal(await page.locator('.part-detail').count(), 0, 'a second click closes');

  await rows(page).nth(1).locator('.part-sum').focus();
  await page.keyboard.press('Enter');
  assert.equal(await rows(page).nth(1).locator('.part-sum').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
  await rows(page).nth(1).locator('.part-sum').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.part-detail').count(), 0, 'Space closes');

  const afford = await page.evaluate(() => {
    const m = window.__ROAM__.state.player.money;
    return [...document.querySelectorAll('.town-shop .part-row')].findIndex((r) => Number(r.querySelector('.price').textContent) <= m && !r.querySelector('.price.bad'));
  });
  assert(afford >= 0, 'some part is affordable');
  const row = rows(page).nth(afford);
  const price = Number((await row.locator('.price').innerText()).trim());
  const m0 = await money(page);
  await row.locator('.part-sum').click();
  await row.locator('.part-detail button').click();
  assert.equal(await money(page), m0 - price, 'money drops by the price');
  assert.equal(await rows(page).count(), 15);
  assert.equal(await page.locator('.part-detail').count(), 0, 'no row open after a trade');
  assert(await page.evaluate(() => !!document.activeElement?.closest('[data-part-row]')), 'focus stays on a row');
  await page.screenshot({ path: '.playtest/shop-parts-bought-1280.png' });

  await page.evaluate(async () => {
    const c = await import('/src/sim/cheats.ts');
    window.__ROAM__.apply(c.setMoney(window.__ROAM__.state, 0));
  });
  await rows(page).nth(0).locator('.part-sum').click();
  const buy = rows(page).nth(0).locator('.part-detail button');
  assert(await buy.isDisabled());
  assert.equal(await buy.getAttribute('title'), 'Not enough money');
  assert(await rows(page).nth(0).locator('.price.bad').count());

  await page.locator('.tabs.sub button').nth(1).click();
  assert.equal(await page.locator('.part-detail').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('.town-shop').scrollTop), 0);
  await page.locator('.tabs.sub button').nth(0).click();

  await page.locator('.town-screen .tabs button', { hasText: 'Sell Parts' }).click();
  await page.screenshot({ path: '.playtest/shop-sell-1280.png' });

  await page.locator('.town-screen .tabs button', { hasText: 'Buy Parts' }).click();
  for (const [width, height] of [[800, 730], [600, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    await rows(page).nth(2).locator('.part-sum').click();
    const over = await page.evaluate(() => {
      const box = document.querySelector('.town-shop').getBoundingClientRect();
      return [...document.querySelectorAll('.part-row')].filter((n) => n.getBoundingClientRect().right > box.right + 1).length;
    });
    assert.equal(over, 0, `${width}: no row overflows the shop column`);
    await page.screenshot({ path: `.playtest/shop-parts-${width}.png` });
  }
  assert.deepEqual(errors, [], 'No uncaught page errors');
  console.log('PASS: shop part rows collapse, open one at a time, trade and keep place');
} finally {
  await browser.close();
}
