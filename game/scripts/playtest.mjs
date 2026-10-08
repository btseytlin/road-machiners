// Boots the game in headless Chromium on the Metal GPU, plays turns, and fails on page errors, the crash screen,
// a blank canvas or a low frame rate. Screenshots go to .playtest/.
// It also fails on HUD panels whose single control does not fill the panel, so a click in the box's edge or corner is dead.
// With --cpu, Chromium draws in software and the frame rate is printed but not checked.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { gpuArgs, isSoftware, rendererOf } from './gpu.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:5173');
const cpu = process.argv.includes('--cpu');
const fpsGate = !cpu && !process.argv.includes('--no-fps-gate');
const turns = Number(arg('turns', cpu ? '4' : '12'));
const MIN_FPS = 50;
const timeoutsOff = process.env.TEST_TIMEOUTS === 'off';
const TURN_LIMIT_MS = timeoutsOff ? 0 : cpu ? 60000 : 10000;
const BOOT_LIMIT_MS = timeoutsOff ? 0 : 30000;

mkdirSync('.playtest', { recursive: true });
const browser = await chromium.launch({ args: cpu ? [] : gpuArgs() });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (timeoutsOff) page.setDefaultTimeout(0);
const renderer = await rendererOf(page);
console.log(`renderer ${renderer}`);
if (!cpu && isSoftware(renderer)) {
  await browser.close();
  console.error(`FAIL\nThe GPU playtest got the software renderer ${renderer}. Run with --cpu on a machine without a GPU.`);
  process.exit(1);
}
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__ROAM__, null, { timeout: BOOT_LIMIT_MS });
await page.waitForTimeout(1000);
await page.screenshot({ path: '.playtest/start.png' });

const hitProblems = [];
const findDeadCorners = () => {
  const isOneControl = (panel, controls) => controls.length === 1 && controls[0].innerText.trim() === panel.innerText.trim();
  const isShown = (panel, r) => r.width > 0 && r.height > 0 && panel.checkVisibility();
  const cornerFailures = (panel, control) => {
    const r = panel.getBoundingClientRect();
    const corners = [[r.left + 1, r.top + 1], [r.right - 2, r.top + 1], [r.left + 1, r.bottom - 2], [r.right - 2, r.bottom - 2]];
    return corners.flatMap(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el && control.contains(el)) return [];
      return [`${panel.className} corner (${x},${y}) hits ${el ? `${el.tagName.toLowerCase()}.${el.className}` : 'nothing'}`];
    });
  };
  const panels = [...document.querySelectorAll('#ui .panel')].filter((p) => isShown(p, p.getBoundingClientRect()));
  const single = panels.map((p) => [p, [...p.querySelectorAll('button, summary, a[href], input, select')].filter((c) => c.checkVisibility())]).filter(([p, c]) => isOneControl(p, c));
  return { failures: single.flatMap(([p, c]) => cornerFailures(p, c[0])), found: single.length };
};
const hit = await page.evaluate(findDeadCorners);
hitProblems.push(...hit.failures);
if (hit.found < 4) hitProblems.push(`found ${hit.found} one-control panels, expected at least 4`);
const menuBox = await page.locator('#ui .game-menu').boundingBox();
await page.mouse.click(menuBox.x + 2, menuBox.y + 2);
if (!(await page.locator('.game-menu [role=menu]').isVisible())) hitProblems.push('menu did not open from a click in its corner');
await page.keyboard.press('Escape');
if (await page.locator('.game-menu [role=menu]').isVisible()) hitProblems.push('menu did not close on Escape');
await page.locator('.game-menu .menu-button').click();
await page.locator('.game-menu [role=menuitem]', { hasText: 'Help' }).click();
if (!(await page.locator('#ui .help').isVisible())) hitProblems.push('help did not open from the menu');
await page.keyboard.press('Escape');
if (await page.locator('#ui .help').count()) hitProblems.push('help did not close on Escape');

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

const problems = [...errors, ...hitProblems];
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
