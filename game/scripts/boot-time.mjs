// Times the boot in Chromium on the real GPU: time to roam:ready, time to the boot screen clearing, each boot step and the
// code, map, model and sound fetches. A cold fresh game, then a reload of the same context for a warm saved world.
// It only measures, since absolute times depend on the host. Compare runs on the same host and build.
// Usage: npm run boot:time -- [--url http://localhost:4173/] [--runs 5] [--viewport wide|narrow] [--net none|4g]
import { chromium } from 'playwright';
import { gpuArgs, isSoftware, rendererOf } from './gpu.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
};
const url = arg('url', 'http://localhost:4173/');
const runs = Number(arg('runs', '5'));
const VIEWPORTS = { wide: { width: 1280, height: 800 }, narrow: { width: 390, height: 844 } };
const viewport = VIEWPORTS[arg('viewport', 'wide')];
const net = arg('net', 'none');
if (!viewport) throw new Error('--viewport is wide or narrow');
if (!['none', '4g'].includes(net)) throw new Error('--net is none or 4g');
if (!(runs >= 1)) throw new Error('--runs must be at least 1');
const FETCHES = { code: 'assets/index-', map: 'maps/', models: 'models/', sounds: 'sfx/' };
const FAST_4G = { offline: false, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8, latency: 40 };

// Runs before the page scripts. Records when each step first runs, ends, and when #boot goes away.
function watchBoot() {
  performance.setResourceTimingBufferSize(5000);
  const log = { steps: {}, cleared: null };
  window.__BOOT_TIME__ = log;
  let adopted = false;
  new MutationObserver(() => {
    const boot = document.getElementById('boot');
    if (boot?.dataset.adopted === 'true') adopted = true;
    if (adopted && !boot && log.cleared === null) log.cleared = performance.now();
    for (const seg of document.querySelectorAll('[data-step]')) {
      const state = ['running', 'done', 'failed'].find((s) => seg.classList.contains(s));
      const entry = (log.steps[seg.dataset.step] ??= {});
      if (state && entry[state] === undefined) entry[state] = performance.now();
    }
  }).observe(document, { subtree: true, childList: true, attributes: true });
}

async function readRun(page) {
  await page.waitForFunction(() => performance.getEntriesByName('roam:ready').length > 0 && window.__BOOT_TIME__.cleared !== null, null, { timeout: 300000 });
  return page.evaluate((fetches) => {
    const log = window.__BOOT_TIME__;
    const spans = {};
    for (const [name, part] of Object.entries(fetches)) {
      const hits = performance.getEntriesByType('resource').filter((e) => e.name.includes(part));
      spans[name] = hits.length ? Math.max(...hits.map((e) => e.responseEnd)) - Math.min(...hits.map((e) => e.startTime)) : null;
    }
    const steps = {};
    for (const [step, t] of Object.entries(log.steps)) steps[step] = t.running !== undefined && (t.done ?? t.failed) !== undefined ? (t.done ?? t.failed) - t.running : null;
    return { ready: performance.getEntriesByName('roam:ready')[0].startTime, cleared: log.cleared, steps, spans, crashed: document.body.innerText.includes('The game crashed') };
  }, FETCHES);
}

const browser = await chromium.launch({ args: gpuArgs() });
const results = { cold: [], warm: [] };
const errors = [];
let crashed = false;
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.addInitScript(watchBoot);
  if (i === 0) {
    const renderer = await rendererOf(page);
    console.log(`renderer ${renderer}, viewport ${viewport.width}x${viewport.height}, net ${net}, runs ${runs}`);
    if (isSoftware(renderer)) {
      await browser.close();
      console.error(`FAIL\nGot the software renderer ${renderer}. It needs a GPU.`);
      process.exit(1);
    }
  }
  if (net === '4g') await (await context.newCDPSession(page)).send('Network.emulateNetworkConditions', FAST_4G);
  await page.goto(url);
  results.cold.push(await readRun(page));
  await page.waitForTimeout(1500);
  await page.reload();
  results.warm.push(await readRun(page));
  await context.close();
}
await browser.close();

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
const sec = (ms) => (ms / 1000).toFixed(1).padStart(6);
function row(label, values) {
  const xs = values.filter((v) => v !== null && v !== undefined);
  console.log(`  ${label.padEnd(10)} median ${xs.length ? sec(median(xs)) : '     -'} s  max ${xs.length ? sec(Math.max(...xs)) : '     -'} s`);
}
for (const [path, label] of [['cold', 'Fresh game, cold cache'], ['warm', 'Saved world, warm cache']]) {
  const list = results[path];
  console.log(`\n${label}`);
  row('ready', list.map((r) => r.ready));
  row('cleared', list.map((r) => r.cleared));
  console.log(' steps');
  for (const step of Object.keys(list[0].steps)) row(step, list.map((r) => r.steps[step]));
  console.log(' fetches');
  for (const name of Object.keys(FETCHES)) row(name, list.map((r) => r.spans[name]));
  if (list.some((r) => r.crashed)) crashed = true;
}
console.log(`\n${errors.length} page errors`);
for (const e of errors) console.log(e);
if (errors.length || crashed) {
  console.error(`FAIL\n${crashed ? 'A crash screen showed. ' : ''}${errors.length} page errors.`);
  process.exit(1);
}
