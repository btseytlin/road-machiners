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
  assert(!m.actionsText.includes('broken'), 'No broken badge in the action row, and the four radio knobs turned by a real mouse drag, wheel and keys');
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
  for (const count of [0, 1]) {
    await holdContracts(page, count);
    const m = await boxes(page);
    assert(m.radio, 'Radio must be visible');
    assert.equal(m.knobs, 4, 'Radio must carry four volume knobs');
    assert.equal(m.oldSound, 0, 'The top-right Sound panel must be gone');
    const below = count ? m.contracts : m.log;
    const gap = count ? 8 : dockGap(page);
    assert(near(below.y - m.radio.bottom, gap), `At ${size.width}x${size.height} with ${count} contracts the radio must sit ${gap}px above the ${count ? 'contracts' : 'log'}, got ${below.y - m.radio.bottom}`);
    for (const other of [m.log, m.contracts, m.instruments].filter(Boolean)) assert(!doRectsOverlap(m.radio, other), 'Radio must not overlap the log, instruments or contracts');
  }
}

// The contracts keep their pre-issue spot and the hover panel stops above the log. While the hover panel shows, the
// radio is away or clear of it, and it comes back once the hover ends. On a tall screen it stays during the hover.
// radioStays is null where the hover panel's content decides.
async function checkRightColumn(page, radioStays) {
  const size = page.viewportSize();
  const at = `At ${size.width}x${size.height}`;
  await holdContracts(page, 1);
  await hover(page, true);
  const m = await boxes(page);
  assert(m.info, `${at} the hover panel must show`);
  assert(m.contracts, `${at} the contracts must show`);
  assert(near(m.log.y - m.contracts.bottom, dockGap(page)), `${at} the contracts must sit ${dockGap(page)}px above the log, got ${m.log.y - m.contracts.bottom}`);
  assert(!doRectsOverlap(m.log, m.info), `${at} the hover panel must stop above the log`);
  // Where the contracts at their old spot were clear of the hover panel, they still are.
  const old = { ...m.contracts, y: m.log.y - dockGap(page) - m.contracts.height, bottom: m.log.y - dockGap(page) };
  if (!doRectsOverlap(old, m.info)) assert(!doRectsOverlap(m.contracts, m.info), `${at} the hover panel must not cover the contracts`);
  if (m.radio) assert(!doRectsOverlap(m.radio, m.info), `${at} the hover panel must not cover the radio`);
  if (radioStays !== null) assert.equal(Boolean(m.radio), radioStays, `${at} the radio must ${radioStays ? 'stay' : 'step away'} during the hover`);
  await hover(page, false);
  assert((await boxes(page)).radio, `${at} the radio must come back once the hover panel hides`);
}

const KNOB_BUSES = ['Music', 'Effects', 'Wind', 'Interface'];

// Turns every radio knob with the real mouse from a point in its column outside the dial, at the given viewport.
async function checkKnobs(url, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__ROAM__?.state, null, { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.radio-text')?.textContent.trim(), null, { timeout: 90000 });
    const at = `At ${viewport.width}x${viewport.height}`;
    const values = () => page.evaluate(() => [...document.querySelectorAll('.radio .knob')].map(k => k.getAttribute('aria-valuenow')));
    const muted = () => page.evaluate(() => document.querySelector('.radio-mute button').getAttribute('aria-pressed') ?? document.querySelector('.radio-mute').innerHTML);
    const game = () => page.evaluate(() => {
      const g = window.__ROAM__;
      return JSON.stringify([g.state === window.__knobState, g.rig.camera.position.toArray()]);
    });
    await page.evaluate(() => { window.__knobState = window.__ROAM__.state; });
    const box = selector => page.evaluate(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, selector);
    const cells = page.locator('.radio .knob-cell');
    const rects = await cells.evaluateAll(nodes => nodes.map(n => ({ cell: n.getBoundingClientRect().toJSON(), knob: n.querySelector('.knob').getBoundingClientRect().toJSON() })));
    const mute = await box('.radio-mute');
    assert.equal(rects.length, 4, `${at} the radio must carry four knob columns`);
    rects.forEach((r, i) => {
      assert(r.cell.width >= 24 && r.cell.height >= 40, `${at} ${KNOB_BUSES[i]} column must be at least 24x40, got ${r.cell.width}x${r.cell.height}`);
      assert(!doRectsOverlap(r.cell, { x: mute.x, y: mute.y, right: mute.x + mute.width, bottom: mute.y + mute.height }), `${at} the columns must clear the mute switch`);
      if (i) assert(!doRectsOverlap(rects[i - 1].cell, r.cell), `${at} the columns must not overlap`);
    });
    for (let i = 0; i < 4; i++) {
      const { cell, knob } = rects[i];
      const x = cell.x + 2, y = cell.bottom - 2;
      assert(x < knob.x || x > knob.right || y > knob.bottom, `${at} the grab point must lie outside the ${KNOB_BUSES[i]} dial`);
      const before = await values();
      const focusBefore = await page.evaluate(() => document.activeElement?.className);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 200, { steps: 10 });
      await page.mouse.up();
      assert.equal((await values())[i], '0', `${at} a drag down must silence ${KNOB_BUSES[i]}`);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 80, { steps: 10 });
      const mid = await page.evaluate(i => {
        const cell = document.querySelectorAll('.radio .knob-cell')[i];
        const readout = cell.querySelector('.knob-readout');
        const hidden = [...document.querySelectorAll('.radio .knob-readout')].filter(r => getComputedStyle(r).visibility !== 'hidden');
        return { now: Number(cell.querySelector('.knob').getAttribute('aria-valuenow')), turning: cell.classList.contains('turning'), text: readout.textContent, valuetext: cell.querySelector('.knob').getAttribute('aria-valuetext'), shown: hidden.length === 1 && hidden[0] === readout };
      }, i);
      assert(Math.abs(mid.now - 50) <= 1, `${at} 80px up must give about 50, got ${mid.now}`);
      assert(mid.turning && mid.shown, `${at} only the turned column must show its level`);
      assert.equal(mid.text, mid.valuetext, `${at} the readout must match aria-valuetext`);
      assert.equal(mid.text, `${mid.now}%`);
      if (i === 0) await page.screenshot({ path: `.playtest/knobs-${viewport.width}.png`, clip: await box('.radio'), timeout: 120000 });
      await page.mouse.move(x, y - 200, { steps: 10 });
      await page.mouse.up();
      const after = await values();
      assert.equal(after[i], '100', `${at} a drag up must open ${KNOB_BUSES[i]} fully`);
      assert.deepEqual(after.filter((_, j) => j !== i), before.filter((_, j) => j !== i), `${at} no other knob may change`);
      assert.equal(await page.evaluate(() => document.activeElement?.className), focusBefore, `${at} a drag must not move focus`);
      await page.keyboard.press('ArrowLeft');
      assert.deepEqual(await values(), after, `${at} ArrowLeft after a drag must not turn a knob`);
      await page.mouse.move(x + 100, y - 100, { steps: 5 });
      assert.deepEqual(await values(), after, `${at} moving after release must not turn a knob`);
      assert.equal(await game(), JSON.stringify([true, JSON.parse(await game())[1]]), `${at} a drag must leave the game state alone`);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 200, { steps: 5 });
      await page.mouse.up();
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -100);
      await page.waitForFunction(i => document.querySelectorAll('.radio .knob')[i].getAttribute('aria-valuenow') === '5', i, { timeout: 60000 });
    }
    const cameraBefore = await game();
    const knobs = page.locator('.radio .knob');
    await knobs.first().focus();
    const base = Number((await values())[0]);
    await page.keyboard.press('ArrowUp');
    assert.equal(Number((await values())[0]), base + 5, `${at} ArrowUp on a focused knob must raise it 5`);
    assert(await page.locator('.radio .knob-readout').first().isVisible(), `${at} a focused knob must show its level`);
    await knobs.first().blur();
    await page.keyboard.press('ArrowUp');
    assert.equal(Number((await values())[0]), base + 5, `${at} ArrowUp must not turn a blurred knob`);
    const held = await values();
    const muteBefore = await muted();
    await page.keyboard.press('m');
    assert.notEqual(await muted(), muteBefore, `${at} M must flip the mute switch`);
    assert.deepEqual(await values(), held, `${at} M must not change a level`);
    assert.equal(await game(), cameraBefore, `${at} the knob checks must leave the camera alone`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('roam-sound')).volume);
    assert.deepEqual(['music', 'sfx', 'ambient', 'ui'].map(b => String(Math.round(stored[b] * 100))), held, `${at} the stored levels must match the knobs`);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `.playtest/knobs-rest-${viewport.width}.png`, clip: await box('.radio'), timeout: 120000 });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.radio .knob').length === 4);
    assert.deepEqual(await values(), held, `${at} the levels must survive a reload`);
    assert.equal(await page.locator('.speedometer [role=slider], .speedometer [tabindex]').count(), 0, `${at} the speedometer must hold no knob`);
    assert.deepEqual(errors, [], `${at} no uncaught page errors`);
  } finally {
    await page.close();
  }
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
  for (const viewport of [{ width: 1280, height: 720 }, { width: 700, height: 800 }]) await checkKnobs(url, viewport);
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await page.screenshot({ path: '.playtest/ui-regression.png' });
  console.log('PASS: hover names, flat surfaces, persistent resources/log, the radio above the log and contracts and clear of the hover panel, the contracts in their old spot, stable modal frames, movable-item inspection, and laptop/narrow layouts, clock strip, speedometer and action row, and the four radio knobs turned by a real mouse drag, wheel and keys');
} finally {
  await browser.close();
}
