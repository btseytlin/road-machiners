import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/ui-playtest.mjs <dev-server-url>');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

function doRectsOverlap(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

async function checkVisibleReadouts(page) {
  for (const label of ['Money', 'Fuel', 'Supplies', 'Driver']) {
    assert(await page.locator(`[data-resource="${label}"]`).isVisible(), `${label} must remain visible`);
  }
  assert(await page.locator('.log').isVisible(), 'Event log must remain visible');
  const boxes = await page.locator('.modal:visible,.instruments,.log').evaluateAll(nodes => nodes.map(node => ({
    name: node.className, rect: node.getBoundingClientRect().toJSON(),
  })));
  const modal = boxes.find(box => box.name.includes('modal'));
  for (const box of boxes.filter(box => box !== modal)) {
    assert(!doRectsOverlap(modal.rect, box.rect), `${box.name} must not cover the modal`);
  }
}

async function checkInstruments(page) {
  const clock = page.locator('.instrument-clock');
  assert(await clock.isVisible(), 'Clock strip must be visible');
  const m = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const visibleRect = selector => {
      const node = document.querySelector(selector);
      return node && node.offsetParent !== null ? node.getBoundingClientRect().toJSON() : null;
    };
    return {
      panel: rect('.instruments'), clock: rect('.instrument-clock'), dial: rect('.truck-instrument'), readouts: rect('.readouts'),
      log: visibleRect('.log'), weapons: visibleRect('.weapons'),
      clockText: document.querySelector('.instrument-clock').innerText,
      panelText: document.querySelector('.instruments').innerText,
      actionsText: document.querySelector('.instrument-actions').innerText,
      speedoText: document.querySelector('.speedometer').innerText,
      heights: [...document.querySelectorAll('.instrument-actions > button')].map(node => node.getBoundingClientRect().height),
    };
  });
  const { panel } = m;
  assert(m.clock.x >= panel.x && m.clock.right <= panel.right && m.clock.y >= panel.y && m.clock.bottom <= panel.bottom, 'Clock must lie inside the instruments');
  assert(m.clock.bottom <= m.dial.y && m.clock.bottom <= m.readouts.y, 'Clock must sit above the dial and readouts');
  assert(/Day \d+\s+\d+:\d\d/.test(m.clockText), `Clock must show day and time, got ${m.clockText}`);
  assert.equal(m.panelText.match(/Day \d+\s+\d+:\d\d/g).length, 1, 'Time must show once');
  assert(!m.actionsText.includes('broken'), 'No broken badge in the action row');
  assert(!/km\/h|·/.test(m.speedoText), 'No unit text under the dial');
  assert(m.heights.every(h => Math.abs(h - m.heights[0]) <= 1), `Action buttons must share one height: ${m.heights}`);
  for (const other of [m.log, m.weapons].filter(Boolean)) {
    assert(!doRectsOverlap(panel, other), 'Instruments must not overlap the log or weapons');
  }
}

async function fillLog(page) {
  await page.evaluate(() => {
    const game = window.__ROAM__;
    const lines = [
      'Repair Scrap panels started: stay parked about three hours while the crew works',
      'Dust storm started and will sweep the whole valley until late in the evening',
      'Overcast started', 'Raider Bo Crane: Wheel disabled', 'Repair Wheel done',
      'W'.repeat(80), 'Discovered Old Orchard', 'Trader Mira Dawes honks back.',
      'Raider Cass Dust regains consciousness', 'Repair Wheel started: stay parked about two hours',
      'Day turns to night over the long road east of the old bridge', 'Discovered Bowl',
    ];
    for (const text of lines) game.hud.note(game.world, text, 'dim');
  });
}

async function checkLog(page, label) {
  const m = await page.evaluate(() => {
    const box = document.querySelector('.log-lines');
    const clip = box.getBoundingClientRect();
    const button = document.querySelector('.log-expand');
    const b = button.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return {
      panel: document.querySelector('.log').getBoundingClientRect().toJSON(), box: clip.toJSON(), button: b.toJSON(),
      hitsButton: hit === button || button.contains(hit),
      scrollWidth: box.scrollWidth, clientWidth: box.clientWidth,
      rows: [...box.children].map(row => {
        const r = row.getBoundingClientRect();
        const top = Math.max(r.top, clip.top), bottom = Math.min(r.bottom, clip.bottom);
        return { text: row.innerText, left: r.left, right: r.right, top, bottom, visible: bottom > top };
      }),
    };
  });
  const { panel } = m, tol = 1;
  const inside = r => r.x >= panel.x - tol && r.right <= panel.right + tol && r.y >= panel.y - tol && r.bottom <= panel.bottom + tol;
  assert(inside(m.box), `${label}: log lines box must lie inside the log panel: ${JSON.stringify({ box: m.box, panel })}`);
  for (const row of m.rows.filter(row => row.visible)) {
    assert(row.left >= panel.x - tol && row.right <= panel.right + tol && row.top >= panel.y - tol && row.bottom <= panel.bottom + tol,
      `${label}: log row "${row.text}" must lie inside the log panel: ${JSON.stringify({ row, panel })}`);
  }
  assert(m.scrollWidth <= m.clientWidth, `${label}: log lines must not scroll sideways (${m.scrollWidth} > ${m.clientWidth})`);
  assert(inside(m.button), `${label}: expand button must lie inside the log panel: ${JSON.stringify({ button: m.button, panel })}`);
  assert(m.hitsButton, `${label}: expand button must be the hit target at its center`);
}

async function checkLogScroll(page) {
  const topRow = () => page.evaluate(() => {
    const box = document.querySelector('.log-lines');
    const clip = box.getBoundingClientRect();
    const row = [...box.children].find(r => r.getBoundingClientRect().bottom > clip.top + 1);
    return row.innerText;
  });
  await page.evaluate(() => {
    const box = document.querySelector('.log-lines');
    box.scrollTop = Math.floor((box.scrollHeight - box.clientHeight) / 2);
  });
  assert(await page.evaluate(() => document.querySelector('.log-lines').scrollTop) > 0, 'Log must have history to scroll back through');
  const before = await topRow();
  await page.evaluate(() => { const g = window.__ROAM__; g.hud.note(g.world, 'A new line arrives', 'dim'); });
  assert.equal(await topRow(), before, 'A scrolled-back log must keep its top row when a line arrives');
  await page.locator('.log-expand').click({ force: true });
  assert.equal(await topRow(), before, 'A scrolled-back log must keep its top row after expanding');
  await page.locator('.log-expand').click({ force: true });
  assert.equal(await topRow(), before, 'A scrolled-back log must keep its top row after shrinking');
}

async function shotLog(page, name) {
  await page.screenshot({ path: `.playtest/${name}.png`, clip: await page.locator('.log').boundingBox(), animations: 'allow' });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state);
  assert(await page.locator('.icon').evaluateAll(nodes => nodes.every(node => node.title)), 'Every icon needs a hover name');
  assert(await page.locator('#ui *').evaluateAll(nodes => nodes.filter(node => !node.closest('button.switch')).every(node => !getComputedStyle(node).backgroundImage.includes('gradient'))), 'UI must use flat surfaces, apart from the metal switches');
  await checkInstruments(page);
  await mkdir('.playtest', { recursive: true });
  await fillLog(page);
  await shotLog(page, 'log-compact');
  await checkLog(page, 'compact');
  await page.locator('.log-expand').click({ force: true });
  assert(await page.locator('.log.expanded').count(), 'Expand button must expand the log');
  await shotLog(page, 'log-expanded');
  await checkLog(page, 'expanded');
  await checkLogScroll(page);
  await page.locator('.log-expand').click({ force: true });
  await checkLog(page, 'compact again');
  await page.keyboard.press('i');
  await checkVisibleReadouts(page);
  await checkLog(page, 'modal');
  await page.keyboard.press('Escape');
  await page.keyboard.press('i');
  const movable = page.locator('.inv-item:not(.fixed)').first();
  const name = (await movable.getAttribute('title')).split('\n')[0].split(' (')[0];
  await movable.click({ force: true });
  assert((await page.locator('.inv-inspection').innerText()).includes(name), 'Clicking a movable item must inspect it before drag/drop replaces its node');
  const inventoryFrame = await page.locator('.modal:visible').boundingBox();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await checkVisibleReadouts(page);
  assert.deepEqual(await page.locator('.modal:visible').boundingBox(), inventoryFrame, 'Character and inventory must share one frame');
  await page.keyboard.press('Escape');
  // The truck starts in the wasteland now, so the town frame is checked only when E opens a modal.
  await page.keyboard.press('e');
  if (await page.locator('.modal:visible').count()) {
    await checkVisibleReadouts(page);
    assert.deepEqual(await page.locator('.modal:visible').boundingBox(), inventoryFrame, 'Town and inventory must share one frame');
  } else {
    await page.keyboard.press('i');
    await checkVisibleReadouts(page);
  }
  for (const width of [1024, 800, 700]) {
    await page.setViewportSize({ width, height: 800 });
    await checkVisibleReadouts(page);
    await checkInstruments(page);
    await checkLog(page, `compact ${width}`);
    if (width === 700) await shotLog(page, 'log-narrow');
    await page.locator('.log-expand').click({ force: true });
    await checkLog(page, `expanded ${width}`);
    await page.locator('.log-expand').click({ force: true });
  }
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await mkdir('.playtest', { recursive: true });
  await page.screenshot({ path: '.playtest/ui-regression.png' });
  console.log('PASS: hover names, flat surfaces, persistent resources/log, stable modal frames, movable-item inspection, and laptop/narrow layouts, clock strip, speedometer and action row');
} finally {
  await browser.close();
}
