// Measures boot, turn, move preview and frame time in Chromium on the real GPU, and fails on any
// budget miss from scripts/perf-budgets.json, a page error or the crash screen.
// Usage: npm run perf -- --url http://localhost:5173
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing --${name}`);
  return process.argv[i + 1];
};
const url = arg('url');
const budgets = JSON.parse(readFileSync(new URL('./perf-budgets.json', import.meta.url), 'utf8'));

const TURNS = 5;
const TRAVEL_TURNS = 6;
const TURN_WAIT_MS = 2600;
const ORDER_OFFSETS = [[12, 4], [40, 25], [-30, 60], [150, 150]];
const VIEW_ZOOM = 0.35;
const SETTLE_MS = 800;
const SAMPLE_MS = 2000;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url);
await page.waitForFunction(() => window.__ROAM__ && window.__ROAM_PERF__, null, { timeout: 60000 });
await page.waitForTimeout(1000);
const results = {};

results.bootMs = await page.evaluate(() => {
  const mark = performance.getEntriesByName('roam:ready')[0];
  if (!mark) throw new Error('No roam:ready performance mark');
  return mark.startTime;
});

await page.evaluate(() => window.__ROAM_PERF__.reset());
const turnMs = [];
for (let i = 0; i < TURNS; i++) {
  const before = await page.evaluate(() => {
    const g = window.__ROAM__;
    const turn = g.state.turn;
    g.endTurn();
    return turn;
  });
  await page.waitForFunction((turn) => window.__ROAM__.state.turn === turn + 1, before, { timeout: 30000 });
  turnMs.push(await page.evaluate(() => {
    const s = window.__ROAM_PERF__.snapshot().turn;
    if (!s) throw new Error('No turn timer recorded');
    return s.last;
  }));
  await page.waitForTimeout(TURN_WAIT_MS);
}
results.turnMs = Math.max(...turnMs);

const previewMs = [];
for (const offset of ORDER_OFFSETS) {
  previewMs.push(await page.evaluate(async ([dx, dy]) => {
    const g = window.__ROAM__;
    const w = { ...g.state, vehicles: g.state.vehicles.map((v) => ({ ...v })) };
    const me = w.vehicles.find((v) => v.id === w.player.vehicleId);
    if (!me) throw new Error(`Player vehicle ${w.player.vehicleId} missing`);
    const clamp = (x) => Math.max(1, Math.min(w.size - 1, x));
    me.order = { kind: 'stopAt', dest: { x: clamp(me.pos.x + dx), y: clamp(me.pos.y + dy) } };
    window.__ROAM_PERF__.reset();
    g.apply(w);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const s = window.__ROAM_PERF__.snapshot().preview;
    if (!s) throw new Error('No preview timer recorded after a move order');
    return s.last;
  }, offset));
}
results.previewMs = Math.max(...previewMs);

const travel = await page.evaluate(async () => {
  const g = window.__ROAM__;
  const w = { ...g.state, vehicles: g.state.vehicles.map((v) => ({ ...v })) };
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId);
  if (!me) throw new Error(`Player vehicle ${w.player.vehicleId} missing`);
  const clamp = (x) => Math.max(1, Math.min(w.size - 1, x));
  me.order = { kind: 'through', dest: { x: clamp(me.pos.x + 150), y: clamp(me.pos.y) } };
  g.apply(w);
  return { turn: g.state.turn };
});
await page.evaluate(() => window.__ROAM_PERF__.reset());
await page.keyboard.down('Space');
await page.keyboard.up('Space');
const gaps = await page.evaluate(async ({ turn, turns }) => {
  const out = [];
  const deadline = performance.now() + 30000;
  await new Promise((done, fail) => {
    const f = (t) => {
      out.push(t);
      if (window.__ROAM__.state.turn >= turn + turns) done();
      else if (performance.now() > deadline) fail(new Error('Automatic travel did not play the turns in 30 s'));
      else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  return out.slice(1).map((t, i) => t - out[i]);
}, { turn: travel.turn, turns: TRAVEL_TURNS });
const turnFrame = await page.evaluate(() => window.__ROAM_PERF__.snapshot()['turn-frame']);
if (!turnFrame) throw new Error('No turn-frame timer recorded during travel');
results.travelFrameMs = turnFrame.max;
const sortedGaps = [...gaps].sort((a, b) => a - b);

const towns = await page.evaluate(async () => {
  if (typeof window.__ROAM__.debugView !== 'function') throw new Error('Game.debugView is missing, so frame time cannot be measured over the towns');
  const { REGION } = await import('/src/data/region.ts');
  const { sitePads } = await import('/src/sim/sites.ts');
  return REGION.towns.map((t) => ({ name: t.name, x: t.pos.x, y: t.pos.y, pad: sitePads(t)[0] }));
});
const frameP95 = [];
for (const t of towns) {
  frameP95.push(await page.evaluate(async ({ x, y, pad, zoom, settle, sample }) => {
    const g = window.__ROAM__;
    const w = { ...g.state, vehicles: g.state.vehicles.map((v) => (v.id === g.state.player.vehicleId ? { ...v, pos: pad, order: null } : v)) };
    g.apply(w);
    g.debugView(x, y, zoom);
    await new Promise((r) => setTimeout(r, settle));
    const ts = await new Promise((done) => {
      const out = [];
      const f = (t) => {
        out.push(t);
        if (t - out[0] < sample) requestAnimationFrame(f);
        else done(out);
      };
      requestAnimationFrame(f);
    });
    const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    return d[Math.floor(d.length * 0.95)];
  }, { x: t.x, y: t.y, pad: t.pad, zoom: VIEW_ZOOM, settle: SETTLE_MS, sample: SAMPLE_MS }));
}
results.frameP95Ms = Math.max(...frameP95);

const crashed = await page.evaluate(() => document.body.innerText.includes('The game crashed'));
await browser.close();

console.log(`turn ms per call: ${turnMs.map((x) => x.toFixed(1)).join(', ')}`);
console.log(`preview ms per order: ${previewMs.map((x) => x.toFixed(1)).join(', ')}`);
console.log(`frame p95 ms per town: ${towns.map((t, i) => `${t.name} ${frameP95[i].toFixed(1)}`).join(', ')}`);
console.log(`travel frame gap ms: longest ${sortedGaps[sortedGaps.length - 1].toFixed(1)}, p99 ${sortedGaps[Math.floor(sortedGaps.length * 0.99)].toFixed(1)}`);
console.log('');
console.log(`${'metric'.padEnd(12)}${'value'.padStart(10)}${'budget'.padStart(10)}  ok`);
const problems = [...errors];
for (const [key, budget] of Object.entries(budgets)) {
  if (!(key in results)) throw new Error(`Budget ${key} has no measurement`);
  const ok = results[key] <= budget;
  if (!ok) problems.push(`${key} ${results[key].toFixed(1)} over budget ${budget}`);
  console.log(`${key.padEnd(12)}${results[key].toFixed(1).padStart(10)}${String(budget).padStart(10)}  ${ok ? 'yes' : 'no'}`);
}
if (crashed) problems.push('crash screen shown');
if (problems.length > 0) {
  console.error(`\nFAIL\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('\nPASS');
