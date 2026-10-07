// Boots the game in headless Chromium on the Metal GPU, plays turns, and fails on page errors, the crash screen,
// a blank canvas or a low frame rate. Screenshots go to .playtest/.
// With --cpu, Chromium draws in software and the frame rate is printed but not checked.
// With --no-fps-gate, the GPU run prints the frame rate but does not check it, for hosts shared with other jobs.
// Usage: npm run playtest -- [--url http://localhost:5173] [--turns 12, or 4 with --cpu] [--cpu] [--no-fps-gate]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5173');
const cpu = process.argv.includes('--cpu');
// --cpu checks that the game boots and plays, not its speed. Software drawing is slow, so it plays fewer turns.
const turns = Number(arg('turns', cpu ? '4' : '12'));
const fpsGate = !cpu && !process.argv.includes('--no-fps-gate');
const MIN_FPS = 50; // headless Chromium caps frames at 60 Hz
// A turn plays in about 1.3 s on the GPU, and the first, while the game warms up, in about 3.2 s.
// Software drawing on a 2 vCPU server runs near 1.5 fps, and turns there took over 10 s, so --cpu waits longer.
const TURN_LIMIT_MS = cpu ? 60000 : 10000;

mkdirSync('.playtest', { recursive: true });
const browser = await chromium.launch({ args: cpu ? [] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__ROAM__, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: '.playtest/start.png' });

for (let i = 0; i < turns; i++) {
  await page.evaluate((i) => {
    const g = window.__ROAM__;
    const w = g.state;
    const v = w.vehicles.find((x) => x.id === w.player.vehicleId);
    const a = v.heading + Math.sin(i * 0.9) * 0.9;
    const clamp = (x) => Math.max(1, Math.min(w.size - 1, x));
    g.apply({ ...w, vehicles: w.vehicles.map((x) => (x.id === v.id ? { ...x, order: { kind: 'through', dest: { x: clamp(v.pos.x + Math.cos(a) * 9.5), y: clamp(v.pos.y + Math.sin(a) * 9.5) } } } : x)) });
    g.endTurn();
  }, i);
  // The turn counts once it is committed and has played back, since endTurn() ignores requests during playback.
  // travel and anim are private in TypeScript, and endTurn() checks the same call.
  await page.waitForFunction((turn) => {
    const g = window.__ROAM__;
    return g.state.turn === turn && !g.travel.isPlaying(g.anim);
  }, i + 2, { timeout: TURN_LIMIT_MS, polling: 50 }).catch(() => { throw new Error(`Turn ${i + 1} did not finish playing within ${TURN_LIMIT_MS} ms`); });
}
await page.screenshot({ path: '.playtest/end.png' });

const fps = await page.evaluate(() => new Promise((done) => {
  let n = 0;
  const t0 = performance.now();
  const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : done(n / 2));
  requestAnimationFrame(f);
}));
const state = await page.evaluate(() => ({ turn: window.__ROAM__.state.turn, crashed: document.body.innerText.includes('The game crashed') }));
const blank = await page.evaluate(() => {
  const c = document.querySelector('#game canvas');
  return !c || c.width === 0;
});
await browser.close();

const problems = [...errors];
if (state.crashed) problems.push('crash screen shown');
if (state.turn !== turns + 1) problems.push(`expected turn ${turns + 1}, got ${state.turn}`);
if (blank) problems.push('no WebGL canvas');
if (fpsGate && fps < MIN_FPS) problems.push(`fps ${fps} under ${MIN_FPS}`);
console.log(`turns ${state.turn - 1}, fps ${fps}`);
if (problems.length > 0) {
  console.error(`FAIL\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('PASS');
