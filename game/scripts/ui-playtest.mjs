import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/ui-playtest.mjs <dev-server-url>');
const browser = await chromium.launch({ args: process.env.CPU ? [] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

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

const DOCK_VIEWPORTS = [[1920, 1080], [1280, 720], [1280, 656], [1024, 656], [900, 656], [800, 656], [700, 800]];
const DOCK_PANELS = ['.instruments', '.weapons', '.truck-condition', '.log', '.turn-control', '.info'];

// Long weather, the Cool engine button, the most weapons a random truck mounts, and a hovered truck.
async function loadHeavyHud(page) {
  await page.evaluate(async () => {
    const { runCommand } = await import('/src/ui/console.ts');
    const game = window.__ROAM__;
    const run = line => { const r = runCommand(game.state, line); if (r.world) game.apply(r.world); };
    let best = 0;
    for (let i = 0; i < 40 && best < 6; i++) {
      run('randomkit 5');
      best = Math.max(best, document.querySelectorAll('.weapon-pick').length);
      if (document.querySelectorAll('.weapon-pick').length >= 6) break;
    }
    run('spawn buggy');
    run('weather storm');
    run('weather heatwave');
    const world = structuredClone(game.state);
    world.player.engineHeat = 0.5;
    world.player.supplies = Math.max(world.player.supplies, 10);
    game.apply(world);
    const other = game.state.vehicles.find(v => v.id !== game.state.player.vehicleId);
    game.hovered = other.id;
    game.refreshInfo();
    if (getComputedStyle(document.querySelector('.info')).display === 'none') {
      game.hovered = game.state.player.vehicleId;
      game.refreshInfo();
    }
    // Tips are transient, not panels.
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#ui .tip { display: none !important }' }));
    return { other: other.id, seen: getComputedStyle(document.querySelector('.info')).display, hov: game.hovered };
  }).then(r => console.log(JSON.stringify(r)));
}

function assertNoOverlaps(rects, width, height) {
  const names = Object.keys(rects).filter(name => width > 720 || name !== '.info');
  for (const a of names) {
    for (const b of names.filter(name => name > a)) {
      assert(!doRectsOverlap(rects[a], rects[b]), `${a} must not overlap ${b} at ${width}x${height}`);
    }
  }
}

async function checkDockLayout(page, [width, height]) {
  await page.setViewportSize({ width, height });
  const m = await page.evaluate(([selectors, narrow]) => {
    // Narrow screens let the inspection panel cover the dock's top by design.
    if (narrow) document.querySelector('.info').style.visibility = 'hidden';
    const shown = node => node && node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden';
    const rects = Object.fromEntries(selectors.map(selector => [selector, document.querySelector(selector)]).filter(([, node]) => shown(node)).map(([selector, node]) => [selector, node.getBoundingClientRect().toJSON()]));
    const controls = [...document.querySelectorAll('.weapons button, .weapons .switch, .weapons .weapon-pick')].map(node => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { name: node.innerText.replace(/\s+/g, ' ').slice(0, 24), hit: hit?.className, ok: node.contains(hit) };
    });
    return { rects, controls };
  }, [DOCK_PANELS, width <= 720]);
  console.log(`${width}x${height}`, Object.entries(m.rects).map(([n, r]) => `${n}=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`).join(' '));
  await page.screenshot({ path: `.playtest/dock-${width}x${height}.png`, timeout: 180000 });
  assert(m.rects['.weapons'], `Weapons panel must show at ${width}x${height}`);
  assertNoOverlaps(m.rects, width, height);
  for (const c of m.controls) assert(c.ok, `Weapon control "${c.name}" must take the click at its center at ${width}x${height}, hit ${c.hit}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(process.env.CPU ? 180000 : 30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ROAM__?.state);
  assert(await page.locator('.icon').evaluateAll(nodes => nodes.every(node => node.title)), 'Every icon needs a hover name');
  assert(await page.locator('#ui *').evaluateAll(nodes => nodes.filter(node => !node.closest('button.switch')).every(node => !getComputedStyle(node).backgroundImage.includes('gradient'))), 'UI must use flat surfaces, apart from the metal switches');
  await checkInstruments(page);
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
  await page.keyboard.press('Escape');
  await loadHeavyHud(page);
  await mkdir('.playtest', { recursive: true });
  for (const viewport of DOCK_VIEWPORTS) await checkDockLayout(page, viewport);
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await mkdir('.playtest', { recursive: true });
  await page.screenshot({ path: '.playtest/ui-regression.png' });
  console.log('PASS: hover names, flat surfaces, persistent resources/log, stable modal frames, movable-item inspection, and laptop/narrow layouts, clock strip, speedometer and action row');
} finally {
  await browser.close();
}
