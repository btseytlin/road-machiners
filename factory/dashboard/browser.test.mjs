import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node browser.test.mjs <playwright-module> <evidence-directory>');
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const evidence = resolve(process.argv[3]);
const root = new URL('./', import.meta.url);
const now = new Date().toISOString();
function createSource(value) { return { status: 'ok', at: now, value }; }
const jobs = Array.from({ length: 45 }, (_, i) => ({ key: `job-${i}`, issue: i + 1, stage: ['design', 'implement', 'verify'][i % 3], startedAt: new Date(Date.now() - 900000).toISOString() }));
const cardColumns = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval', 'Done'];
function createSummary(days) {
  const tokens = { input: 1000000, output: 300000, cacheRead: 200000, cacheWrite: 100000 };
  const yesterday = new Date(Date.parse(now) - 86400000).toISOString().slice(0, 10);
  return { days, since: `${yesterday}T00:00:00Z`, workerMs: 7200000, cost: days > 1 ? 16.5 : 14.5, tokens, waitingMs: 3600000, waitingGaps: 1, missingUsage: 2,
    stages: [{ stage: 'design', workerMs: 7200000 }], waitingStages: [{ stage: 'design', workerMs: 3600000 }],
    buckets: [...(days > 1 ? [{ start: yesterday, cost: 2, tokens: null, stages: { design: { cost: 2, tokens: 0 } }, models: { unattributed: { cost: 2, tokens: 0 } } }] : []),
      { start: now.slice(0, days > 1 ? 10 : 13), cost: 14.5, tokens, stages: { design: { cost: 9.5, tokens: 1000000 }, verify: { cost: 5, tokens: 600000 } }, models: { 'claude-opus-5-5': { cost: 7.25, tokens: 850000 }, 'claude-sonnet-5-5': { cost: 7.25, tokens: 750000 } } }], retries: [{ outcome: 'timeout', runs: 3, cost: 2, workerMs: 600000 }],
    models: [{ model: 'claude-opus-5-5', input: 500000, output: 200000, cacheRead: 100000, cacheWrite: 50000, cost: 7.25 },
      { model: 'claude-sonnet-5-5', input: 500000, output: 100000, cacheRead: 100000, cacheWrite: 50000, cost: 7.25 }],
    stageModels: [
      { stage: 'design', model: 'claude-opus-5-5', input: 400000, output: 100000, cacheRead: 80000, cacheWrite: 40000, cost: 5 },
      { stage: 'verify', model: 'claude-opus-5-5', input: 100000, output: 100000, cacheRead: 20000, cacheWrite: 10000, cost: 2.25 },
      { stage: 'verify', model: 'claude-sonnet-5-5', input: 300000, output: 80000, cacheRead: 50000, cacheWrite: 30000, cost: 5 },
      { stage: 'implement', model: 'claude-sonnet-5-5', input: 200000, output: 20000, cacheRead: 50000, cacheWrite: 20000, cost: 2.25 },
    ],
    activity: jobs.map((job) => ({ stage: job.stage, issue: job.issue, outcome: 'done', at: now })) };
}
const fixture = {
  generatedAt: now, repoUrl: 'https://github.com/example/factory', playUrl: 'https://example.com/',
  operations: createSource({ jobs, queues: Object.fromEntries(['branch', 'triage', 'design', 'implement', 'verify', 'test'].map((queue) => [queue, { total: 20, busy: 15 }])), releaseKey: 'release', release: { issue: 99 }, candidateUrl: null }),
  github: createSource({ releaseKey: 'release', features: Array.from({ length: 34 }, (_, index) => ({ issue: index + 1, title: `Feature ${index + 1} ${'long'.repeat(60)}` })), cards: jobs.map((job, index) => ({ issue: job.issue, column: cardColumns[index % cardColumns.length], title: `Task ${job.issue} ${'unbroken'.repeat(60)}` })) }),
  live: createSource({ workers: jobs.map((job) => ({ key: job.key, activity: 'tests', phase: 'running', status: 'ok', source: 'runner', progressAt: now })), manager: { activity: 'command', intent: 'investigate', phase: 'running', status: 'ok', at: now, since: now }, scheduler: { status: 'ready', freshness: 'ok', at: now, counts: { Triage: 12345678, Design: 200, Implementation: 31, Testing: 20, Approval: 10, Done: 99 }, decisions: [{ stage: 'design', queue: 'design', issue: 42, reasons: ['needs-info'] }], release: { reason: 'release-tasks', issues: [42] } } }),
  host: createSource({ cpu: createSource(85), ram: createSource({ used: 10000000000, total: 16000000000 }), gpu: createSource([{ utilization: 90 }]), ssd: createSource({ free: 20000000000 }), containers: createSource(jobs.map((job) => ({ jobId: job.key, service: 'worker', cpu: 2, memory: 1000000000 }))) }),
  analytics: createSource({ ranges: [1, 7, 30].map(createSummary) }),
};
function readContentType(path) {
  const extension = path.split('.').at(-1);
  return { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', html: 'text/html' }[extension] ?? 'application/octet-stream';
}
const server = createServer(async (request, response) => {
  try {
    const path = request.url === '/factory/' ? 'index.html' : request.url.replace('/factory/', '');
    if (path.includes('..')) throw new Error('Invalid path');
    const bytes = await readFile(path === 'chart.js' ? new URL('../node_modules/chart.js/dist/chart.umd.min.js', root) : new URL(path, root));
    response.setHeader('Content-Type', readContentType(path));
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
async function waitForRender(page) { await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function sendSnapshot(page, value) {
  await page.evaluate((data) => window.fixtureStream.listeners.snapshot({ data: JSON.stringify(data) }), value);
  await waitForRender(page);
}
async function checkLayout(page, size) {
  for (const tab of ['overview', 'analytics']) {
    await page.locator(`#${tab}-tab`).click();
    await waitForRender(page);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      panels: [...document.querySelectorAll('.panel')].filter((node) => node.getClientRects().length && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)).map((node) => node.className),
    }));
    await page.screenshot({ path: `${evidence}/${tab}-${size.width}.png` });
    assert.equal(overflow.document, false);
    assert.deepEqual(overflow.panels, []);
    console.log(size, tab, 'fits without scrolling');
  }
}
async function checkReleaseAndManager(page) {
  await page.locator('#overview-tab').click();
  assert.equal(await page.locator('#release-count').textContent(), '34 changes');
  assert.equal(await page.locator('#release-items li').count(), 3);
  assert.equal(await page.locator('#release-items a').first().getAttribute('href'), 'https://github.com/example/factory/issues/1');
  await page.getByRole('button', { name: 'Next release', exact: true }).click();
  await waitForRender(page);
  assert.equal(await page.locator('#release-items a').first().getAttribute('href'), 'https://github.com/example/factory/issues/4');
  await sendSnapshot(page, fixture);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'release-Next');
  const idle = structuredClone(fixture);
  idle.live.value.manager = { activity: 'finished', phase: 'completed', status: 'ok', at: now, since: new Date(Date.now() - 12 * 3600000).toISOString() };
  await sendSnapshot(page, idle);
  assert.match(await page.locator('#manager-action').textContent(), /Idle for 12h/);
  assert.equal(await page.locator('#connection').textContent(), 'Live');
  const waiting = structuredClone(fixture);
  waiting.live.value.manager = { activity: 'model', phase: 'running', status: 'ok', at: now, since: new Date(Date.now() - 16 * 60000).toISOString() };
  waiting.live.value.workers[0].milestone = 'validating';
  await sendSnapshot(page, waiting);
  assert.match(await page.locator('#manager-action').textContent(), /Waiting for model, 16m in phase/);
  assert.match(await page.locator('#worker-rows tr').first().locator('td').nth(2).textContent(), /Checking changes/);
  waiting.live.value.workers[0].status = 'stale';
  await sendSnapshot(page, waiting);
  assert.equal(await page.locator('#worker-rows tr').first().locator('td').nth(2).textContent(), 'Activity stale');
  await sendSnapshot(page, fixture);
}
async function checkExpandedViews(page) {
  await page.locator('#overview-tab').click();
  const releaseButton = page.getByRole('button', { name: 'Expand next release' });
  await releaseButton.click();
  const release = page.getByRole('dialog', { name: 'Next release' });
  assert.equal(await release.isVisible(), true);
  assert.match(await release.textContent(), /34 changes/);
  assert.ok((await release.locator('a').count()) < 34);
  assert.equal(await release.locator('#release-dialog-rows').evaluate((node) => node.scrollWidth > node.clientWidth), false);
  await page.screenshot({ path: `${evidence}/release-dialog-${page.viewportSize().width}.png` });
  await release.getByRole('button', { name: 'Next release dialog' }).click();
  await sendSnapshot(page, fixture);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'release-dialog-Next');
  await page.keyboard.press('Escape');
  assert.equal(await release.isVisible(), false);
  assert.equal(await releaseButton.evaluate((node) => node === document.activeElement), true);
  const eventsButton = page.getByRole('button', { name: 'Expand event log' });
  await eventsButton.click();
  const events = page.getByRole('dialog', { name: 'Event log' });
  assert.equal(await events.isVisible(), true);
  assert.match(await events.locator('time').first().textContent(), /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.ok((await events.locator('.event-row').count()) < 45);
  await page.screenshot({ path: `${evidence}/event-dialog-${page.viewportSize().width}.png` });
  await events.getByRole('button', { name: 'Next event dialog' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await events.isVisible(), false);
  assert.equal(await eventsButton.evaluate((node) => node === document.activeElement), true);
}
async function checkCapacityAndCpu(page) {
  await page.locator('#overview-tab').click();
  assert.match(await page.locator('#free-slots').textContent(), /Branch.*5/);
  assert.match(await page.locator('#capacity-rows').textContent(), /#42.*Needs author reply/);
  const usage = structuredClone(fixture);
  usage.host.value.containers.value[0].cpu = 1;
  usage.host.value.containers.value[1].cpu = 8;
  usage.host.value.containers.value[2].cpu = 3;
  await sendSnapshot(page, usage);
  assert.equal(await page.locator('#server-rows tr').first().locator('td').first().textContent(), '#2');
  const stale = structuredClone(usage);
  stale.live.value.scheduler.freshness = 'stale';
  await sendSnapshot(page, stale);
  assert.match(await page.locator('#capacity-status').textContent(), /Scheduler stale/);
  assert.match(await page.locator('#capacity-rows').textContent(), /Reasons unavailable/);
  await sendSnapshot(page, fixture);
}
async function checkCounters(page) {
  await page.locator('#analytics-tab').click();
  await waitForRender(page);
  await page.locator('#usage-tokens').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#full-text').textContent(), '1600000');
  assert.equal(await page.locator('#full-text').evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#full-text').isVisible(), false);
  assert.equal(await page.locator('#usage-tokens').evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator('.token-counter.panel').count(), 1);
  assert.equal(await page.locator('.token-counter .panel').count(), 0);
  assert.deepEqual(await page.locator('.token-counter .counter span').allTextContents(), ['Total tokens', 'Input incl. cache', 'Output']);
  assert.equal(await page.locator('#usage-input').textContent(), '1.3M');
  assert.equal(await page.locator('#usage-input').getAttribute('data-exact'), '1300000');
  assert.equal(await page.locator('#usage-output').textContent(), '300K');
  assert.equal(await page.locator('#usage-output').getAttribute('data-exact'), '300000');
  assert.deepEqual(await page.locator('#stage-model-header th').allTextContents(), ['Stage', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(await page.locator('#stage-model-measures th').allTextContents(), ['Input + cache', 'Output', 'Input + cache', 'Output']);
  assert.ok(!(await page.locator('#analytics').textContent()).includes('Input incl. cache / output, measured runs'));
  const verify = page.locator('#stage-model-rows tr').filter({ has: page.locator('td:first-child', { hasText: 'Verify' }) });
  assert.deepEqual(await verify.locator('td').allTextContents(), ['Verify + review', '130K', '100K', '380K', '80K']);
  const extra = structuredClone(fixture);
  for (const range of extra.analytics.value.ranges) {
    range.models.push({ model: 'extra-model', input: 3, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0.01 });
    range.stageModels.push({ stage: 'verify', model: 'extra-model', input: 3, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0.01 });
  }
  await sendSnapshot(page, extra);
  await page.getByRole('button', { name: 'Next model column', exact: true }).click();
  await waitForRender(page);
  assert.ok((await page.locator('#stage-model-header').textContent()).includes('extra-model'));
  await sendSnapshot(page, fixture);
  assert.match(await page.locator('#coverage').textContent(), /History from .*UTC.*2 runs lack token counts/);
  assert.equal(await page.getByRole('button', { name: 'Cost', exact: true }).getAttribute('aria-pressed'), 'true');
  const readChart = () => page.evaluate(() => { const chart = window.Chart.getChart('usage-chart'); return { labels: chart.data.labels, datasets: chart.data.datasets.map((set) => ({ label: set.label, data: set.data })) }; });
  let chart = await readChart();
  assert.equal(chart.labels.length, 8);
  assert.deepEqual(chart.datasets.map((set) => set.label), ['Design', 'Verify']);
  assert.deepEqual(chart.datasets[0].data.slice(-2), [2, 9.5]);
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await waitForRender(page);
  assert.deepEqual((await readChart()).datasets.map((set) => set.label), ['opus-5-5', 'sonnet-5-5', 'No model data']);
  await page.getByRole('button', { name: 'Tokens', exact: true }).click();
  await waitForRender(page);
  chart = await readChart();
  assert.equal(chart.datasets[0].data.at(-2), null);
  assert.deepEqual(chart.datasets.map((set) => set.label), ['opus-5-5', 'sonnet-5-5']);
  await page.getByRole('button', { name: '24 hours', exact: true }).click();
  await waitForRender(page);
  chart = await readChart();
  assert.equal(chart.labels.length, 25);
  assert.equal(chart.labels.at(-1), `${now.slice(11, 13)}:00`);
  await page.screenshot({ path: `${evidence}/analytics-hourly-${page.viewportSize().width}.png` });
  for (const name of ['Stage', 'Cost', '7 days']) await page.getByRole('button', { name, exact: true }).click();
}
async function checkPagination(page) {
  await page.locator('#overview-tab').click();
  await page.getByRole('button', { name: 'Next worker', exact: true }).click();
  await waitForRender(page);
  assert.ok(!(await page.locator('#worker-rows').textContent()).includes('Task 1 '));
  await sendSnapshot(page, fixture);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'worker-Next');
  const full = structuredClone(fixture);
  for (const queue of Object.values(full.operations.value.queues)) queue.busy = queue.total;
  await sendSnapshot(page, full);
  assert.ok((await page.locator('#capacity-rows').textContent()).includes('#42'));
  const fewer = structuredClone(fixture);
  fewer.operations.value.jobs = jobs.slice(0, 1);
  await sendSnapshot(page, fewer);
  assert.equal(await page.locator('#worker-rows tr').count(), 1);
  assert.ok((await page.locator('#worker-rows').textContent()).includes('Task 1 '));
}
async function checkPause(page) {
  const paused = structuredClone(fixture);
  paused.operations.value.status = 'paused';
  paused.operations.value.pauseReason = 'agent-usage-limit';
  paused.live.value.scheduler.status = 'paused';
  paused.live.value.scheduler.counts = {};
  await sendSnapshot(page, paused);
  assert.deepEqual(await page.locator('#funnel strong').allTextContents(), ['8', '8', '8', '7', '7', '7']);
  assert.match(await page.locator('#source-status').textContent(), /Paused.*Claude weekly usage limit/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
  await page.screenshot({ path: `${evidence}/paused-${page.viewportSize().width}.png` });
  assert.ok(!(await page.locator('#capacity-rows').textContent()).includes('No eligible work'));
  await page.locator('#analytics-tab').click();
  await waitForRender(page);
  assert.match(await page.locator('#source-status').textContent(), /Paused/);
  await sendSnapshot(page, fixture);
  assert.ok(!(await page.locator('#source-status').textContent()).includes('Paused'));
  await page.locator('#overview-tab').click();
}
async function checkNarrow(page) {
  await sendSnapshot(page, fixture);
  await page.setViewportSize({ width: 683, height: 768 });
  await page.locator('#overview-tab').click();
  await waitForRender(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('#release-items a').count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Next release', exact: true }).isVisible(), true);
  assert.equal(await page.locator('#server-rows tr').count() > 0, true);
  await page.screenshot({ path: `${evidence}/overview-narrow.png`, fullPage: true });
  await page.getByRole('button', { name: 'Expand event log' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Event log' }).evaluate((node) => node.getBoundingClientRect().right > innerWidth), false);
  await page.keyboard.press('Escape');
  await page.locator('#analytics-tab').click();
  await waitForRender(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('#stage-model-header th').count(), 3);
  assert.equal(await page.locator('#stage-model-measures th').count(), 4);
  await page.screenshot({ path: `${evidence}/analytics-narrow.png`, fullPage: true });
}
async function checkUntrustedAndMissingData(page) {
  const malicious = structuredClone(fixture);
  malicious.github.value.cards[0].title = '<img src=x onerror="window.injected=true">';
  malicious.operations.value.privateChat = 'PRIVATE CHAT MUST NOT RENDER';
  await sendSnapshot(page, malicious);
  assert.equal(await page.locator('#worker-rows img').count(), 0);
  assert.ok((await page.locator('#worker-rows').textContent()).includes('<img'));
  assert.ok(!(await page.locator('body').textContent()).includes('PRIVATE CHAT MUST NOT RENDER'));
  malicious.github.value.features[0].title = '<img src=x onerror="window.injected=true">';
  await sendSnapshot(page, malicious);
  await page.getByRole('button', { name: 'Expand next release' }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Next release' }).locator('img').count(), 0);
  await page.keyboard.press('Escape');
  const missing = structuredClone(fixture);
  for (const name of ['operations', 'github', 'live', 'host', 'analytics']) missing[name] = { status: 'unavailable', value: null, at: null };
  await sendSnapshot(page, missing);
  assert.ok((await page.locator('#worker-rows').textContent()).includes('unavailable'));
  assert.match(await page.locator('#event-log').textContent(), /Events unavailable/);
  await page.locator('#analytics-tab').click();
  await waitForRender(page);
  assert.equal(await page.locator('#usage-cost').textContent(), '—');
  assert.equal(await page.locator('#usage-wait').textContent(), '—');
  assert.equal(await page.locator('#usage-input').textContent(), '—');
  assert.equal(await page.locator('#usage-output').textContent(), '—');
  assert.equal(await page.locator('#stage-model-rows').textContent(), 'Unavailable');
  await page.locator('#overview-tab').click();
  await waitForRender(page);
  assert.deepEqual(await page.locator('#funnel strong').allTextContents(), ['—', '—', '—', '—', '—', '—']);
  const empty = structuredClone(fixture);
  empty.github.value.cards = [];
  await sendSnapshot(page, empty);
  assert.deepEqual(await page.locator('#funnel strong').allTextContents(), ['0', '0', '0', '0', '0', '0']);
  const stale = structuredClone(fixture);
  stale.github.status = 'stale';
  await sendSnapshot(page, stale);
  assert.deepEqual(await page.locator('#funnel strong').allTextContents(), ['—', '—', '—', '—', '—', '—']);
}
await new Promise((done) => server.listen(0, '127.0.0.1', done));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
    const page = await browser.newPage({ viewport: size });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('Content Security Policy')) errors.push(message.text()); });
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor() { this.listeners = {}; window.fixtureStream = this; }
        addEventListener(name, callback) { this.listeners[name] = callback; }
        close() {}
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/factory/`);
    await page.evaluate(() => document.fonts.ready);
    await sendSnapshot(page, fixture);
    await checkLayout(page, size);
    await checkReleaseAndManager(page);
    await checkExpandedViews(page);
    await checkCapacityAndCpu(page);
    await checkCounters(page);
    await checkPagination(page);
    await checkPause(page);
    await checkUntrustedAndMissingData(page);
    await checkNarrow(page);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Browser layout, keyboard, pagination, missing-data and escaping checks passed');
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
