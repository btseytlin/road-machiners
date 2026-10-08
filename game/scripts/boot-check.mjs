// Checks the boot screen in a real browser at 1280x800 and 390x844: first load with a fresh game, a saved game,
// the save rescue screen, a failed map and a failed game module. Screenshots go to .playtest/boot-*.png.
// Needs the dev server. Same GPU flags as the playtest; with --cpu, Chromium draws in software.
// Usage: npm run boot:check -- [--url http://localhost:5173] [--cpu]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5173');
// --only names one case, like failedMap, for a quick rerun.
const only = arg('only', '');
const cpu = process.argv.includes('--cpu');
const timeoutsOff = process.env.TEST_TIMEOUTS === 'off';
const BOOT_LIMIT_MS = timeoutsOff ? 0 : 60000;
const SLOW_MS = 1500;
const VIEWPORTS = [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 390, height: 844 },
];
const FAILED_CODE_TEXT = 'The game failed to load. Check your connection and reload the page.';

const GPU_ARGS = {
  darwin: ['--use-angle=metal'],
  linux: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'],
};
function launchArgs() {
  if (cpu) return [];
  const angle = GPU_ARGS[process.platform];
  if (!angle) throw new Error(`No GPU flags for ${process.platform}. Run with --cpu.`);
  return [...angle, '--enable-gpu', '--ignore-gpu-blocklist'];
}

const problems = [];
const expect = (ok, message) => {
  if (!ok) problems.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
};

// Records every change of #boot: the bar value, the stage text, hidden and the segment classes.
const WATCH = () => {
  window.__bootLog = [];
  const read = () => {
    const boot = document.getElementById('boot');
    if (!boot) return null;
    const bar = boot.querySelector('[role=progressbar]');
    return {
      now: bar.getAttribute('aria-valuenow'),
      max: bar.getAttribute('aria-valuemax'),
      stage: boot.querySelector('.boot-stage').textContent,
      hidden: boot.hidden,
      segments: [...boot.querySelectorAll('.boot-seg')].map((s) => s.className.replace('boot-seg ', '')),
    };
  };
  let last = '';
  const note = () => {
    const state = read();
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    window.__bootLog.push(state);
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener('DOMContentLoaded', note);
};

async function slow(page) {
  const delay = async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    await route.continue().catch(() => {});
  };
  await page.route('**/sfx/**', delay);
  await page.route('**/maps/**', delay);
}

async function open(browser, viewport, errors) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  if (timeoutsOff) page.setDefaultTimeout(0);
  await page.addInitScript(WATCH);
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  return page;
}

// A page under load, or one that just crashed, sometimes refuses a capture. A second try settles it.
async function shot(page, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot({ path });
    } catch (err) {
      if (attempt === 3) throw err;
      await page.waitForTimeout(1000);
    }
  }
}

const bootLog = (page) => page.evaluate(() => window.__bootLog.filter(Boolean));
const stages = (log) => log.map((s) => s.stage).join(' | ');

async function cleared(page) {
  await page.waitForFunction(() => window.__ROAM__, null, { timeout: BOOT_LIMIT_MS });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: BOOT_LIMIT_MS });
  expect(await page.evaluate(() => document.querySelectorAll('canvas').length > 0), 'a canvas is on the page after boot');
}

async function freshGame(browser, viewport) {
  const errors = [];
  const page = await open(browser, viewport, errors);
  await slow(page);
  await page.goto(url);
  await page.waitForSelector('#boot [role=progressbar]');
  await page.waitForFunction(() => document.querySelector('#boot .boot-seg.running') && document.querySelector('[role=progressbar]').getAttribute('aria-valuenow') !== null);
  await shot(page, `.playtest/boot-${viewport.name}-loading.png`);
  const mid = await page.evaluate(() => {
    const bar = document.querySelector('#boot [role=progressbar]');
    return { now: Number(bar.getAttribute('aria-valuenow')), max: Number(bar.getAttribute('aria-valuemax')), running: document.querySelectorAll('#boot .boot-seg.running').length };
  });
  expect(mid.now < mid.max, `${viewport.name}: the bar is not full mid-boot (${mid.now} of ${mid.max})`);
  expect(mid.running > 0, `${viewport.name}: a running segment shows mid-boot`);
  await cleared(page);
  const log = await bootLog(page);
  const values = log.map((s) => Number(s.now)).filter((n) => !Number.isNaN(n));
  expect(values.every((v, i) => i === 0 || (v >= values[i - 1] && v - values[i - 1] <= 3)), `${viewport.name}: the bar never falls and rises by whole steps (${[...new Set(values)].join(",")})`);
  expect(stages(log).includes('Starting a new game'), `${viewport.name}: the fresh game reads "Starting a new game"`);
  expect(stages(log).includes('Reading the map'), `${viewport.name}: the map step shows its name`);
  expect(/Loading sounds \d+ of \d+/.test(stages(log)), `${viewport.name}: sounds show a real file count`);
  expect(await page.evaluate(() => !document.body.innerText.includes('The game crashed')), `${viewport.name}: no crash screen`);
  await shot(page, `.playtest/boot-${viewport.name}-playing.png`);
  expect(errors.length === 0, `${viewport.name}: no page errors ${errors.join('; ')}`);
  return page;
}

async function savedGame(page, viewport) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.evaluate(() => (window.__bootLog = []));
  await page.reload();
  await cleared(page);
  const log = await bootLog(page);
  expect(stages(log).includes('Loading your save'), `${viewport.name}: a saved game reads "Loading your save"`);
  expect(errors.length === 0, `${viewport.name}: reload has no page errors`);
}

async function rescue(browser, viewport) {
  const errors = [];
  const page = await open(browser, viewport, errors);
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await cleared(page);
  await page.evaluate(async () => {
    const [{ name }] = (await indexedDB.databases()).filter((d) => d.name?.startsWith('roam'));
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put({ format: { major: 9999, minor: 0 }, savedAt: Date.now(), world: {} }, 'auto');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.waitForSelector('#ui .save-screen', { state: 'visible', timeout: BOOT_LIMIT_MS });
  expect(await page.evaluate(() => document.getElementById('boot').hidden), `${viewport.name}: #boot is hidden while the rescue panel waits`);
  await shot(page, `.playtest/boot-${viewport.name}-rescue.png`);
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await cleared(page);
  const log = await bootLog(page);
  expect(stages(log).includes('Starting a new game'), `${viewport.name}: #boot returns after the choice and reads "Starting a new game"`);
  expect(errors.length === 0, `${viewport.name}: rescue has no page errors ${errors.join('; ')}`);
  await page.context().close();
}

async function failedMap(browser, viewport) {
  const page = await open(browser, viewport, []);
  await page.route('**/maps/**', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto(url);
  await page.waitForFunction(() => document.body.innerText.includes('Map file'), null, { timeout: BOOT_LIMIT_MS });
  await shot(page, `.playtest/boot-${viewport.name}-map-failed.png`);
  const state = await page.evaluate(() => ({
    mapSegment: document.querySelectorAll('#boot .boot-seg')[1]?.className,
    failed: document.getElementById('boot').classList.contains('failed'),
    running: document.querySelectorAll('#boot .boot-seg.running').length,
    animated: [...document.querySelectorAll('#boot .boot-seg.running')].some((s) => getComputedStyle(s).animationName !== 'none'),
  }));
  expect(state.mapSegment?.includes('failed'), `${viewport.name}: the map segment is failed`);
  expect(state.failed && !state.animated, `${viewport.name}: nothing animates after the map failed`);
  await page.context().close();
}

async function failedCode(browser, viewport) {
  const page = await open(browser, viewport, []);
  await page.route('**/src/three/main.ts*', (route) => route.abort());
  await page.goto(url);
  await page.waitForSelector('#boot.failed', { timeout: BOOT_LIMIT_MS });
  await shot(page, `.playtest/boot-${viewport.name}-code-failed.png`);
  const stage = await page.textContent('#boot .boot-stage');
  const valuetext = await page.getAttribute('#boot [role=progressbar]', 'aria-valuetext');
  expect(stage === FAILED_CODE_TEXT && valuetext === FAILED_CODE_TEXT, `${viewport.name}: a failed game module shows the failure text`);
  await page.context().close();
}

mkdirSync('.playtest', { recursive: true });
// Each case gets its own browser, since a heavy game page leaves a shared one too slow to capture the next case.
async function inBrowser(run) {
  const browser = await chromium.launch({ args: launchArgs() });
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

for (const viewport of VIEWPORTS) {
  if (!only) {
    await inBrowser(async (browser) => {
      const page = await freshGame(browser, viewport);
      await savedGame(page, viewport);
    });
    await inBrowser((browser) => rescue(browser, viewport));
  }
  if (!only || only === 'failedMap') await inBrowser((browser) => failedMap(browser, viewport));
  if (!only || only === 'failedCode') await inBrowser((browser) => failedCode(browser, viewport));
}
if (problems.length) {
  console.error(`FAIL\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('PASS');
