// Boots the game in headless Chromium on the GPU, plays turns, and fails on page errors, the crash screen,
// a blank canvas or a low frame rate. Screenshots go to .playtest/.
// It also fails on HUD panels whose single control does not fill the panel, so a click in the box's edge or corner is dead.
// The GPU is Metal on a Mac and Vulkan on Linux, like the factory's NVIDIA host. A run that falls back to software drawing fails.
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
// The factory sets TEST_TIMEOUTS=off on its shared server, where a time limit measures the load, not a hang. There no step has a limit,
// since Playwright reads 0 as none, and the factory's job time limit stops a hung run. src/test/timeouts.ts does the same for the tests.
const timeoutsOff = process.env.TEST_TIMEOUTS === 'off';
const TURN_LIMIT_MS = timeoutsOff ? 0 : cpu ? 60000 : 10000;
const BOOT_LIMIT_MS = timeoutsOff ? 0 : 30000;

const GPU_ARGS = {
  darwin: ['--use-angle=metal'],
  linux: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'],
};
const SOFTWARE_RENDERERS = /SwiftShader|llvmpipe/;

function launchArgs() {
  if (cpu) return [];
  const angle = GPU_ARGS[process.platform];
  if (!angle) throw new Error(`No GPU flags for ${process.platform}. Run with --cpu.`);
  return [...angle, '--enable-gpu', '--ignore-gpu-blocklist'];
}

mkdirSync('.playtest', { recursive: true });
const browser = await chromium.launch({ args: launchArgs() });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (timeoutsOff) page.setDefaultTimeout(0);
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  return gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) : 'no WebGL2';
});
console.log(`renderer ${renderer}`);
if (!cpu && SOFTWARE_RENDERERS.test(renderer)) {
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
if (await page.$('#boot')) {
  await browser.close();
  console.error('FAIL\nThe boot screen is still on the page after the game started.');
  process.exit(1);
}
await page.screenshot({ path: '.playtest/start.png' });

// A HUD panel that is just one control must give it clicks across the whole box, corners included.
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
const helpOpen = () => page.locator('.help details[open]').count();
const helpBox = await page.locator('#ui .help').boundingBox();
await page.mouse.click(helpBox.x + 2, helpBox.y + 2);
if (!(await helpOpen())) hitProblems.push('help did not open from a click in its corner');
await page.keyboard.press('Escape');
if (await helpOpen()) hitProblems.push('help did not close on Escape');

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
