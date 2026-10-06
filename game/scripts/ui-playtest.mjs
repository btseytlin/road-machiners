import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/ui-playtest.mjs <dev-server-url>');
const browser = await chromium.launch();

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

const CONTRACTS = [
  { id: 'ui-1', shop: 'bowl', kind: 'haul', good: 'scrap', units: 2, to: 'nose', reward: 100, deadline: 400, window: 100, rush: false, tier: 1 },
  { id: 'ui-2', shop: 'bowl', kind: 'bounty', template: 'trader', targetName: 'Test Driver', reward: 300, deadline: 900, window: 900, tier: 2 },
  { id: 'ui-3', shop: 'bowl', kind: 'haul', good: 'scrap', units: 5, to: 'nose', reward: 100, deadline: 500, window: 100, rush: true, tier: 1 },
];

async function setPlayer(page, patch) {
  await page.evaluate(patch => {
    const game = window.__ROAM__;
    const next = structuredClone(game.state);
    Object.assign(next.player, patch);
    game.apply(next);
  }, patch);
}

async function leftRects(page) {
  return page.evaluate(() => {
    const out = {};
    for (const name of ['contracts', 'instruments', 'instrument-clock', 'truck-condition', 'stranded', 'weapons', 'log', 'top-left', 'turn-control']) {
      const node = document.querySelector(`#ui .${name}`);
      const visible = node && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden';
      out[name] = visible ? node.getBoundingClientRect().toJSON() : null;
    }
    out.lines = [...document.querySelectorAll('.contracts .contract-line')].map(node => node.textContent);
    return out;
  });
}

async function checkContracts(page, label) {
  const m = await leftRects(page);
  const c = m.contracts;
  assert(c, `${label}: contracts panel must show`);
  assert(c.x <= m['instrument-clock'].right, `${label}: contracts must start left of the clock's right edge`);
  assert(c.bottom <= m.instruments.y + 0.5, `${label}: contracts must sit above the instruments`);
  for (const other of ['instruments', 'truck-condition', 'stranded', 'weapons', 'log', 'top-left', 'turn-control']) {
    if (m[other]) assert(!doRectsOverlap(c, m[other]), `${label}: contracts overlap ${other}`);
  }
  return m;
}

async function checkLeftStack(page, label) {
  const m = await leftRects(page);
  const names = ['truck-condition', 'stranded', 'weapons', 'instruments'].filter(name => m[name]);
  for (const a of names) for (const b of names) {
    if (a < b) assert(!doRectsOverlap(m[a], m[b]), `${label}: ${a} overlaps ${b}`);
  }
}

async function checkContractsUnderModal(page) {
  // The game ignores keys while a turn plays.
  await page.waitForFunction(() => !document.querySelector('.turn-control').innerText.includes('Moving'), null, { timeout: 120000 });
  await page.keyboard.press('i');
  await page.locator('.modal:visible').waitFor().catch(async error => { await page.screenshot({ path: '.playtest/contracts-modal-fail.png' }); throw error; });
  const hidden = await page.evaluate(() => ['contracts', 'weapons'].every(name => { const n = document.querySelector(`#ui .${name}`); return !n || getComputedStyle(n).visibility === 'hidden' || getComputedStyle(n).display === 'none'; }));
  assert(hidden, `contracts and weapons must hide under a modal`);
  assert(await page.locator('.instruments').isVisible(), "instruments stay under a modal");
  await page.keyboard.press('Escape');
}

async function checkContractLayout(page, [width, height]) {
  const label = `${width}x${height}`;
  await page.setViewportSize({ width, height });
  await setPlayer(page, { contracts: CONTRACTS, beacon: false });
  const m = await checkContracts(page, label);
  assert.equal(m.lines.length, 3, `${label}: one line per contract`);
  assert(m.lines.every(line => / — by Day \d+ \d+:\d\d$/.test(line)), `${label}: lines must show a due time, got ${m.lines}`);
  await checkLeftStack(page, label);
  await page.screenshot({ path: `.playtest/contracts-${label}.png` });
  await setPlayer(page, { beacon: true });
  await checkContracts(page, `${label} stranded`);
  await checkLeftStack(page, `${label} stranded`);
  await setPlayer(page, { beacon: false });
  await page.evaluate(() => document.querySelector('.log-expand').click());
  await checkContracts(page, `${label} log expanded`);
  await page.screenshot({ path: `.playtest/contracts-${label}-log.png` });
  await page.evaluate(() => document.querySelector('.log-expand').click());
  if (width === 1280) await checkContractsUnderModal(page);
  await setPlayer(page, { contracts: [] });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#ui .contracts')).display === 'none').catch(() => assert.fail(`${label}: contracts hide when empty`));
}

// The page renders in software on slow machines, so this probes hit targets in the page instead of clicking.
async function checkContractClicks(page) {
  await setPlayer(page, { contracts: CONTRACTS });
  const result = await page.evaluate(() => {
    let reached = 0;
    const count = () => reached++;
    document.addEventListener('pointerdown', count);
    const press = selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
      return hit.closest(selector) !== null;
    };
    const onContracts = press('#ui .contracts');
    const onCondition = press('#ui .truck-condition');
    document.removeEventListener('pointerdown', count);
    const gap = document.elementFromPoint(20, 70);
    return { onContracts, onCondition, reached, gapIsUi: gap.closest('.panel') !== null };
  });
  assert(result.onContracts && result.onCondition, 'Contracts and condition must take the pointer');
  assert.equal(result.reached, 0, 'Presses on contracts and condition must not bubble to the page');
  assert(!result.gapIsUi, 'The empty column gap must pass the pointer to the game');
  await setPlayer(page, { contracts: [] });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state);
  assert(await page.locator('.icon').evaluateAll(nodes => nodes.every(node => node.title)), 'Every icon needs a hover name');
  assert(await page.locator('#ui *').evaluateAll(nodes => nodes.filter(node => !node.closest('button.switch')).every(node => !getComputedStyle(node).backgroundImage.includes('gradient'))), 'UI must use flat surfaces, apart from the metal switches');
  await checkInstruments(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await checkContractClicks(page);
  // ROAM_UI_SIZES=800x800,700x800 narrows the run on a slow machine.
  const only = process.env.ROAM_UI_SIZES?.split(',');
  for (const size of [[1280, 720], [1366, 650], [1024, 800], [800, 800], [700, 800]].filter(([w, h]) => !only || only.includes(`${w}x${h}`))) {
    await checkContractLayout(page, size);
    await checkLeftStack(page, `${size}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press('i');
  await checkVisibleReadouts(page);
  const movable = page.locator('.inv-item:not(.fixed)').first();
  const name = (await movable.getAttribute('title')).split('\n')[0].split(' (')[0];
  await movable.click();
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
  }
  await mkdir('.playtest', { recursive: true });
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await page.screenshot({ path: '.playtest/ui-regression.png' });
  console.log('PASS: hover names, flat surfaces, persistent resources/log, stable modal frames, movable-item inspection, and laptop/narrow layouts, clock strip, speedometer and action row');
} finally {
  await browser.close();
}
