// The layout check: every surveyed screen in English, Russian and pseudo-long text, at the normal and the narrow
// window size. It measures the real DOM with the checker in src/ui/dom.ts and fails on text a player cannot read or a
// control a player cannot use. First it plants a button too narrow for its label, and fails unless the checker
// reports it. Needs the dev server. See docs/architecture/text.md and docs/tools.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { gpuArgs, isSoftware, rendererOf } from './gpu.mjs';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5173';
const cpu = process.argv.includes('--cpu');
const BOOT_LIMIT_MS = process.env.TEST_TIMEOUTS === 'off' ? 0 : cpu ? 240000 : 30000;
const SEED = 4242;
// LAYOUT_LOCALES=ru and LAYOUT_STATES=shop,trade narrow a run while fixing one screen.
const LOCALES = process.env.LAYOUT_LOCALES?.split(',') ?? ['en', 'ru', 'pseudo'];
const VIEWPORTS = [[1280, 720], [700, 800]];
const TALL = [1440, 900];
// Keyboard caps keep their Latin labels in Russian, like the WASD keys.
const KEY_CAPS = ['WASD', 'Shift', 'Esc'];
const OUT = 'tmp/layout';
// Barlow has no Cyrillic, so Russian needs this face loaded.
const GLYPHS = { font: 'Fira Sans Condensed', letter: 'Ж' };

const key = (page, code) => page.evaluate((c) => window.__ROAM__.runKey(c), code);
const escape = (page) => page.keyboard.press('Escape');
const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// Forty long lines from the real catalog: jobs, shots, tows and contracts with the longest names.
function fillLog(page) {
  return page.evaluate(async () => {
    const g = window.__ROAM__;
    const { t } = await import('/src/text/msg.ts');
    const n = await import('/src/text/names.ts');
    const { moneyMsg } = await import('/src/ui/units.ts');
    const lines = [
      t('log.jobCancelled', { what: t('job.remove', { part: n.partName('tankHeavy'), truck: t('vehicle.npc', { profession: n.professionName('convoyGuard'), driver: n.fullName('Dmitri Tulloch') }) }) }),
      t('log.jobStarted', { what: t('job.repair', { part: n.partName('enclosedFrame') }), n: 12 }),
      t('log.escortHired', { client: t('vehicle.npc', { profession: n.professionName('convoy'), driver: n.fullName('Lorna Morozov') }), who: t('vehicle.npc', { profession: n.professionName('merc'), driver: n.fullName('Elias Drummond') }), site: n.siteName('canyon-bridge'), fee: moneyMsg(12345) }),
      t('log.contract.accepted', { what: t('contract.fetch', { part: n.partName('reinforcedCage'), site: n.siteName('salvage-yard'), n: 2 }), reward: moneyMsg(4200) }),
      t('note.hazard'),
      t('log.towDroppedYou.blocked', { who: t('vehicle.npc', { profession: n.professionName('bowlFarmer'), driver: n.fullName('Hester Kessler') }) }),
      t('log.scrapPatchFuel', { liters: 40 }),
      t('log.rankBoughtPerk', { skill: n.skillName('perception'), rank: 2 }),
    ];
    for (let i = 0; i < 5; i++) for (const line of lines) g.hud.note(g.state, line, 'dim');
  });
}

async function openInventory(page) {
  await key(page, 'KeyI');
  await page.evaluate(() => document.querySelector('.inv-item:not(.fixed)').click());
}

// Parks the truck at Bowl, opens the shop and its tab.
async function openTown(page, tab) {
  await page.evaluate(async () => {
    const g = window.__ROAM__;
    if (g.screens.town.isOpen()) return;
    const c = await import('/src/sim/cheats.ts');
    g.apply(c.teleport(g.state, c.placeSpot(g.state, 'bowl')));
    g.screens.town.open();
  });
  // A click from the page, so a covered tab still opens and the checker reports what covers it.
  await page.evaluate((tab) => document.querySelector(`.town-screen [data-tab="${tab}"]`).click(), tab);
}

const closeTown = (page) => page.evaluate(() => window.__ROAM__.screens.town.close());

// A radio call on the hub of topics, or on a patch deal, with the nearest driver the console can spawn.
async function openCall(page, node) {
  await page.evaluate(async (node) => {
    const g = window.__ROAM__;
    const { runCommand } = await import('/src/ui/console.ts');
    let w = g.state;
    let npc = w.vehicles.find((v) => v.brain && v.brain.templateId === 'trader');
    if (!npc) {
      w = runCommand(w, 'spawn trader').world;
      npc = w.vehicles.find((v) => v.brain && v.brain.templateId === 'trader');
    }
    const next = structuredClone(w);
    const deal = { deal: { kind: 'deal', deal: 'ownParts', patcher: 'player', price: 1250, parts: 3, turns: 4 } };
    next.player.call = node === 'hub'
      ? { with: npc.id, topic: null, node: 'hub', vars: {}, line: { line: 'whatDoYouWant', vars: {} } }
      : { with: npc.id, topic: 'patchRequest', node: 'terms', vars: deal, line: { line: 'dealTerms', vars: deal } };
    g.apply(next);
  }, node);
}

const hangUp = (page) => page.evaluate(() => {
  const g = window.__ROAM__;
  const next = structuredClone(g.state);
  next.player.call = null;
  g.apply(next);
});

const chooseMenuItem = (page, entry) => page.evaluate((entry) => {
  document.querySelector('#ui .game-menu .menu-button').click();
  document.querySelector(`#ui .game-menu [data-entry=${entry}]`).click();
}, entry);

const openHelp = (page) => chooseMenuItem(page, 'help');
const closeHelp = (page) => page.evaluate(() => document.querySelector('#ui .help .close').click());

const openSaves = (page) => chooseMenuItem(page, 'save');
const openOptions = (page) => chooseMenuItem(page, 'options');

function faultsIn(page, locale) {
  return page.evaluate(async ({ locale, names, glyphs }) => {
    const { findLayoutFaults } = await import('/src/ui/dom.ts');
    const allow = [...names, 'WOT RADIO', 'FM', 'English'];
    return findLayoutFaults(document.getElementById('ui'), { locale, allow, glyphs });
  }, { locale, names: KEY_CAPS, glyphs: GLYPHS });
}

// A button too narrow for its label must be reported, or the checker has gone blind.
async function probe(page, locale) {
  const found = await page.evaluate(async ({ locale, glyphs }) => {
    const { findLayoutFaults } = await import('/src/ui/dom.ts');
    const button = Object.assign(document.createElement('button'), { textContent: 'An overflowing probe label' });
    button.style.cssText = 'position:fixed;left:8px;top:300px;width:40px;white-space:nowrap;overflow:hidden;z-index:99999';
    const holder = document.createElement('div');
    holder.append(button);
    document.getElementById('ui').append(holder);
    const faults = findLayoutFaults(holder, { locale, allow: [], glyphs });
    holder.remove();
    return faults.some((f) => f.kind === 'clipped-text' && f.text === 'An overflowing probe label');
  }, { locale, glyphs: GLYPHS });
  if (!found) throw new Error(`The layout checker did not report the planted overflowing button (${locale})`);
}

async function boot() {
  const browser = await chromium.launch({ args: cpu ? [] : gpuArgs() });
  const context = await browser.newContext({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } });
  const page = await context.newPage();
  page.setDefaultTimeout(BOOT_LIMIT_MS);
  const renderer = await rendererOf(page);
  if (!cpu && isSoftware(renderer)) throw new Error(`The layout check got the software renderer ${renderer}. Run with --cpu on a machine without a GPU.`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?seed=${SEED}`);
  await page.waitForFunction(() => window.__ROAM__?.state, null, { timeout: BOOT_LIMIT_MS });
  await page.addStyleTag({ content: '#game { display: none !important }' });
  return { browser, page, errors };
}

async function inspectNpc(page, armed) {
  await page.evaluate(async (armed) => {
    const g = window.__ROAM__;
    const { runCommand } = await import('/src/ui/console.ts');
    const { partDef } = await import('/src/data/parts.ts');
    const world = structuredClone(runCommand(g.state, 'spawn gunwagon hostile').world);
    const npc = world.vehicles.filter((v) => v.brain).at(-1);
    if (!armed) npc.items = npc.items.filter((it) => !(it.kind === 'part' && partDef(it.part.defId).kind === 'weapon'));
    g.apply(world);
    g.hovered = npc.id;
    g.refreshInfo();
    g.hitCard.show();
  }, armed);
}

const clearInspect = (page) => page.evaluate(() => {
  const g = window.__ROAM__;
  g.hovered = null;
  g.refreshInfo();
});

const INSPECT_VIEWPORTS = [...VIEWPORTS, TALL];

// Each state builds one screen through window.__ROAM__ and leaves it with its teardown.
const STATES = {
  menu: { setup: () => undefined },
  log: { setup: fillLog },
  inventory: { setup: openInventory, teardown: escape },
  shop: { setup: (page) => openTown(page, 'buyParts'), teardown: closeTown },
  trade: { setup: (page) => openTown(page, 'market'), teardown: closeTown },
  garage: { setup: (page) => openTown(page, 'trucks'), teardown: closeTown },
  'call-hub': { setup: (page) => openCall(page, 'hub'), teardown: hangUp },
  'call-deal': { setup: (page) => openCall(page, 'deal'), teardown: hangUp },
  help: { setup: openHelp, teardown: closeHelp },
  character: { setup: (page) => key(page, 'KeyC'), teardown: escape },
  saves: { setup: openSaves, teardown: escape },
  options: { setup: openOptions, teardown: escape },
  inspect: { setup: (page) => inspectNpc(page, true), teardown: clearInspect, viewports: INSPECT_VIEWPORTS },
  'inspect-unarmed': { setup: (page) => inspectNpc(page, false), teardown: clearInspect, viewports: INSPECT_VIEWPORTS },
};

// The log state always runs, since its long lines stay for every later screen.
const ONLY = process.env.LAYOUT_STATES?.split(',');
const PICKED = Object.entries(STATES).filter(([name]) => !ONLY || name === 'log' || ONLY.includes(name));

const WINDOWS = [...new Set(PICKED.flatMap(([, state]) => state.viewports ?? VIEWPORTS))];

const started = Date.now();
const seconds = () => Math.round((Date.now() - started) / 1000);
const report = [];
let captures = 0;

// Opens, captures and checks one screen, then leaves it.
async function capture(page, locale, [width, height], [name, state]) {
  await state.setup(page);
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
  await page.screenshot({ path: `${OUT}/${name}-${locale}-${width}x${height}.png` });
  for (const f of await faultsIn(page, locale)) report.push({ state: name, locale, viewport: `${width}x${height}`, ...f });
  captures++;
  console.log(`${name} ${locale} ${width}x${height} at ${seconds()} s`);
  if (state.teardown) await state.teardown(page);
  await frames(page);
}

async function checkLocale(page, locale) {
  await page.evaluate((l) => window.__ROAM__.language.set(l), locale);
  await probe(page, locale);
  for (const viewport of WINDOWS) {
    await page.setViewportSize({ width: viewport[0], height: viewport[1] });
    for (const entry of PICKED.filter(([, state]) => (state.viewports ?? VIEWPORTS).includes(viewport))) await capture(page, locale, viewport, entry);
  }
}

await mkdir(OUT, { recursive: true });
const { browser, page, errors } = await boot();
console.log(`booted at ${seconds()} s`);
try {
  for (const locale of LOCALES) await checkLocale(page, locale);
} finally {
  await browser.close();
}
for (const e of errors) report.push({ state: '-', locale: '-', viewport: '-', kind: 'page-error', path: '', text: e, sizes: '' });
await writeFile(`${OUT}/faults.json`, JSON.stringify(report, null, 1));
for (const f of report) console.log(`${f.state} ${f.locale} ${f.viewport} ${f.kind} ${f.path}: ${JSON.stringify(f.text)} ${f.sizes}`);
console.log(`${captures} captures, ${report.length} faults, ${seconds()} s. Screens in ${OUT}/.`);
process.exit(report.length > 0 ? 1 : 0);
