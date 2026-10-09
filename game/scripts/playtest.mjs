// Boots the game in headless Chromium on the Metal GPU, plays turns, and fails on page errors, the crash screen,
// a blank canvas or a low frame rate. Screenshots go to .playtest/.
// It also fails on HUD panels whose single control does not fill the panel, so a click in the box's edge or corner is dead.
// It plays in Russian, picked by keyboard alone through Menu → Options → Language: the menu and a HUD readout must turn
// Cyrillic, game keys must stay with the open panel, the log must hold no English, and the choice must outlive a reload,
// until English is picked again by mouse. A language control anywhere outside the Options panel fails it.
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
if (await page.$('#boot')) {
  await browser.close();
  console.error('FAIL\nThe boot screen is still on the page after the game started.');
  process.exit(1);
}
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
if (hit.found < 3) hitProblems.push(`found ${hit.found} one-control panels, expected at least 3`);
const menuBox = await page.locator('#ui .game-menu').boundingBox();
await page.mouse.click(menuBox.x + 2, menuBox.y + 2);
if (!(await page.locator('.game-menu [role=menu]').isVisible())) hitProblems.push('menu did not open from a click in its corner');
await page.keyboard.press('Escape');
if (await page.locator('.game-menu [role=menu]').isVisible()) hitProblems.push('menu did not close on Escape');
await page.locator('.game-menu .menu-button').click();
await page.locator('.game-menu [data-entry=help]').click();
if (!(await page.locator('#ui .help').isVisible())) hitProblems.push('help did not open from the menu');
await page.keyboard.press('Escape');
if (await page.locator('#ui .help').count()) hitProblems.push('help did not close on Escape');

// Menu → Options → Language is the one place to pick a language, and the switch is live, with no reload.
const CYRILLIC = /[А-яЁё]/;
const languageProblems = [];
const LANGUAGE_CONTROLS = '.language-switch, .language-option, [data-lang]';
const strayLanguageControls = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((n) => !n.closest('.options')).length, LANGUAGE_CONTROLS);
const checkNoStrayControl = async (when) => {
  if (await page.locator('#ui .options').count()) languageProblems.push(`Options still open ${when}`);
  const stray = await strayLanguageControls();
  if (stray > 0) languageProblems.push(`language control outside Options ${when}: ${stray}`);
};
const languageReadout = () => page.evaluate(() => ({
  lang: document.documentElement.lang,
  menu: document.querySelector('#ui .game-menu .menu-button')?.textContent ?? '',
  money: document.querySelector('#ui [data-resource="money"] small')?.textContent ?? '',
}));
const openOptionsByMouse = async () => {
  if (!(await page.locator('.game-menu [role=menu]').isVisible())) await page.locator('.game-menu .menu-button').click();
  const item = page.locator('.game-menu [data-entry=options]');
  if (!(await item.count())) {
    languageProblems.push('Options not reachable: the menu has no Options item');
    return false;
  }
  await item.click();
  if (!(await page.locator('#ui .options .language-switch').isVisible())) {
    languageProblems.push('Options not reachable: the panel did not open with the language row');
    return false;
  }
  return true;
};
// Keyboard alone: Enter on Menu, arrows to Options, Enter, then Tab to the language and Enter.
const pickLanguageByKeyboard = async (lang) => {
  await page.locator('.game-menu .menu-button').focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => document.activeElement?.dataset.entry === 'options')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  if (!(await page.locator('#ui .options .language-switch').isVisible())) {
    languageProblems.push('Options not reachable by keyboard');
    return;
  }
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate((lang) => document.activeElement?.dataset.lang === lang, lang)) break;
    await page.keyboard.press('Tab');
  }
  // Game keys stay with the panel: Enter picks the language and Space does nothing behind it.
  const turnBefore = await page.evaluate(() => window.__ROAM__.state.turn);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.__ROAM__.state.turn)) !== turnBefore) languageProblems.push('a game key ended the turn behind Options');
  await page.keyboard.press('Escape');
  if (await page.locator('#ui .options').count()) languageProblems.push('Options did not close on Escape');
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('menu-button')))) languageProblems.push('focus did not return to the Menu button after Options');
};
const pickLanguageByMouse = async (lang) => {
  if (!(await openOptionsByMouse())) return;
  await page.locator(`#ui .options [data-lang="${lang}"]`).click();
  await page.locator('#ui .options .close').click();
};
// The pressed language in Options, read with the panel open, then closed again.
const pressedLanguage = async () => {
  if (!(await openOptionsByMouse())) return '';
  const pressed = await page.locator('#ui .options .language-option[aria-pressed="true"]').getAttribute('data-lang');
  await page.keyboard.press('Escape');
  return pressed;
};
await checkNoStrayControl('in English');
await pickLanguageByKeyboard('ru');
const russian = await languageReadout();
if (russian.lang !== 'ru' || !CYRILLIC.test(russian.menu) || !CYRILLIC.test(russian.money)) languageProblems.push(`Русский did not switch the menu and HUD: ${JSON.stringify(russian)}`);
await checkNoStrayControl('in Russian');

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

// In Russian the log holds no English, apart from the drivers' names.
const logLeaks = await page.evaluate(() => {
  const g = window.__ROAM__;
  const names = [...g.state.vehicles, ...g.state.removed].flatMap((v) => (v.brain ? v.brain.driver.split(' ') : []));
  return [...document.querySelectorAll('#ui .log-lines > div')].map((row) => row.textContent ?? '')
    .filter((text) => names.reduce((left, name) => left.split(name).join(' '), text).match(/[A-Za-z]{2,}/));
});
languageProblems.push(...logLeaks.map((line) => `English in the Russian log: ${line}`));

const fps = await page.evaluate(() => new Promise((done) => {
  let n = 0;
  const t0 = performance.now();
  const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : done(n / 2));
  requestAnimationFrame(f);
}));
const state = await page.evaluate(() => ({ turn: window.__ROAM__.state.turn, crashed: document.querySelector('.crash-screen') !== null }));
const blank = await page.evaluate(() => {
  const c = document.querySelector('#game canvas');
  return !c || c.width === 0;
});

// The choice outlives a reload, and English comes back the same way.
const reload = async () => {
  await page.reload();
  await page.waitForFunction(() => window.__ROAM__, null, { timeout: BOOT_LIMIT_MS });
  return languageReadout();
};
if ((await reload()).lang !== 'ru' || (await pressedLanguage()) !== 'ru') languageProblems.push('Russian did not survive a reload');
await pickLanguageByMouse('en');
const english = await reload();
if (english.lang !== 'en' || CYRILLIC.test(english.menu) || CYRILLIC.test(english.money) || (await pressedLanguage()) !== 'en') languageProblems.push(`English did not stay after a reload: ${JSON.stringify(english)}`);
await checkNoStrayControl('after the reload');
await browser.close();

const problems = [...errors, ...hitProblems, ...languageProblems];
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
