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
    for (let i = 0; i < 4; i++) for (const text of lines) game.hud.note(game.world, text, 'dim');
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
  // Expanding rewraps the lines at another width, so only the reading position, not the row, carries over.
  const scrolled = () => page.evaluate(() => document.querySelector('.log-lines').scrollTop > 0);
  await page.locator('.log-expand').click({ force: true });
  assert(await scrolled(), 'A scrolled-back log must stay scrolled back after expanding');
  await page.locator('.log-expand').click({ force: true });
  assert(await scrolled(), 'A scrolled-back log must stay scrolled back after shrinking');
}

async function shotLog(page, name) {
  await page.screenshot({ path: `.playtest/${name}.png`, clip: await page.locator('.log').boundingBox(), animations: 'allow' });
}

// The gap between the log's top and the dock above it: the contracts' pre-issue spot, 246px from the bottom on wide
// screens, and 8px above the narrow log.
const dockGap = page => (page.viewportSize().width <= 720 ? 8 : 12);

const near = (a, b) => Math.abs(a - b) <= 1;

// Gives the player one or more held contracts copied from the boards, or none, and waits for the contracts panel.
async function holdContracts(page, count) {
  await page.evaluate(count => {
    const g = window.__ROAM__;
    const w = structuredClone(g.state);
    w.player.contracts = Object.values(w.shops).flatMap(shop => shop.contracts).slice(0, count);
    if (w.player.contracts.length !== count) throw new Error(`The boards hold fewer than ${count} contracts`);
    g.apply(w);
  }, count);
  await page.waitForFunction(count => (getComputedStyle(document.querySelector('.contracts')).display !== 'none') === (count > 0), count);
}

// Hovers the player's truck, or ends the hover, and lets the layout settle for two frames.
async function hover(page, on) {
  await page.evaluate(on => {
    const g = window.__ROAM__;
    g.setHovered(on ? g.state.player.vehicleId : null);
  }, on);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

const boxes = page => page.evaluate(() => {
  const visibleRect = selector => {
    const node = document.querySelector(selector);
    return node && node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden' ? node.getBoundingClientRect().toJSON() : null;
  };
  return {
    radio: visibleRect('.radio'), log: visibleRect('.log'), contracts: visibleRect('.contracts'), info: visibleRect('.info'),
    instruments: visibleRect('.instruments'),
    knobs: document.querySelectorAll('.radio [role=slider]').length, oldSound: document.querySelectorAll('.top-right .sound').length,
  };
});

// The radio sits above the log, or above the contracts while the player holds some, clear of the other right-hand
// panels, with its knobs and a broadcast on screen.
async function checkRadio(page) {
  await page.waitForFunction(() => document.querySelector('.radio-text')?.textContent.trim(), null, { timeout: 30000 });
  const size = page.viewportSize();
  for (const count of [0]) {
    await holdContracts(page, count);
    const m = await boxes(page);
    assert(m.radio, 'Radio must be visible');
    assert.equal(m.knobs, 4, 'Radio must carry four volume knobs');
    assert.equal(m.oldSound, 0, 'The top-right Sound panel must be gone');
    assert(near(m.log.y - m.radio.bottom, dockGap(page)), `At ${size.width}x${size.height} the radio must sit ${dockGap(page)}px above the log, got ${m.log.y - m.radio.bottom}`);
    for (const other of [m.log, m.contracts, m.instruments].filter(Boolean)) assert(!doRectsOverlap(m.radio, other), 'Radio must not overlap the log, instruments or contracts');
  }
}

// The hover panel stops above the log. While it shows, the radio is away or clear of it, and it comes back once the
// hover ends. On a tall screen it stays during the hover. radioStays is null where the hover panel's content decides.
async function checkRightColumn(page, radioStays) {
  const size = page.viewportSize();
  const at = `At ${size.width}x${size.height}`;
  await holdContracts(page, 0);
  await hover(page, true);
  const m = await boxes(page);
  assert(m.info, `${at} the hover panel must show`);
  assert(!doRectsOverlap(m.log, m.info), `${at} the hover panel must stop above the log`);
  if (m.radio) assert(!doRectsOverlap(m.radio, m.info), `${at} the hover panel must not cover the radio`);
  if (radioStays !== null) assert.equal(Boolean(m.radio), radioStays, `${at} the radio must ${radioStays ? 'stay' : 'step away'} during the hover`);
  await hover(page, false);
  assert((await boxes(page)).radio, `${at} the radio must come back once the hover panel hides`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state);
  assert(await page.locator('.icon').evaluateAll(nodes => nodes.every(node => node.title)), 'Every icon needs a hover name');
  assert(await page.locator('#ui *').evaluateAll(nodes => nodes.filter(node => !node.closest('button.switch, .radio')).every(node => !getComputedStyle(node).backgroundImage.includes('gradient'))), 'UI must use flat surfaces, apart from the metal switches and the radio faceplate');
  await checkInstruments(page);
  await checkContractClicks(page);
  // ROAM_UI_SIZES=800x800,700x800 narrows the run on a slow machine.
  const only = process.env.ROAM_UI_SIZES?.split(',');
  for (const size of [[1280, 720], [1366, 650], [1024, 800], [800, 800], [700, 800]].filter(([w, h]) => !only || only.includes(`${w}x${h}`))) {
    await checkContractLayout(page, size);
    await checkLeftStack(page, `${size}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setViewportSize({ width: 1280, height: 720 });
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

  await checkRadio(page);
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
  await page.keyboard.press('Escape');
  for (const [width, height] of [[1280, 768], [700, 800]]) {
    await page.setViewportSize({ width, height });
    await checkRadio(page);
  }
  for (const [width, height, radioStays] of [[1280, 720, false], [1366, 768, false], [1280, 800, false], [1440, 860, null], [1440, 900, true], [700, 800, false], [700, 940, false], [700, 1060, true]]) {
    await page.setViewportSize({ width, height });
    await checkRightColumn(page, radioStays);
  }
  await mkdir('.playtest', { recursive: true });
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await page.screenshot({ path: '.playtest/ui-regression.png' });
  console.log('PASS: hover names, flat surfaces, persistent resources/log, the radio above the log and clear of the hover panel, the contracts on the left above the instruments, stable modal frames, movable-item inspection, and laptop/narrow layouts, clock strip, speedometer and action row');
} finally {
  await browser.close();
}
