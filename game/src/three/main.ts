// Boots the 3D game.

import { loadBank } from '../audio/bank';
import { Mixer } from '../audio/mixer';
import { SoundPlayer } from '../audio/player';
import { CONFIG } from '../config';
import { CHASSIS } from '../data/chassis';
import { MIX, SOUNDS } from '../data/sounds';
import { startKit } from '../data/start';
import { MAPGEN } from '../data/terrain';
import { PHYSICS } from '../data/physics';
import { initPhysics } from '../phys/drive';
import { perfSnapshot, resetPerf } from '../perf';
import { playerVehicle } from '../sim/damage';
import { warmRoutes } from '../sim/path';
import { vehicleStats } from '../sim/stats';
import { decodeMap, type BakedMap } from '../sim/terrain';
import type { World } from '../sim/types';
import { newWorld } from '../sim/world';
import { DebugConsole, Noclip } from '../ui/console';
import { uiRoot } from '../ui/dom';
import { chooseSaveFate, showCarryReport } from '../ui/save-screen';
import { mountPerfPanel } from '../ui/perf-panel';
import { SoundSettings } from '../ui/sound';
import { installCrashScreen, keepRunningOnErrors, onEveryError, reportError } from './crash';
import { Game } from './game';
import { clearGame, loadWorld, SAVE_KEY, SaveError, savedRunId, storedSave, writeSave } from './save';
import { idbBackend, SaveSlots } from './save-db';
import { RunLog } from './run-log';
import { allSlots, newestSlot, takeBootRequest, type SlotId } from './save-slots';
import { rescueSave } from './save-rescue';
import { loadModels } from './render/models';
import { groundTexture } from './render/terrain';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

// The baked map, fetched relative to the page. A missing or broken file stops boot with the crash screen.
async function fetchMap(): Promise<BakedMap> {
  const response = await fetch(MAPGEN.file);
  if (!response.ok) throw new Error(`Map file ${MAPGEN.file} failed to load: ${response.status} ${response.statusText}`);
  return decodeMap(new Uint8Array(await response.arrayBuffer()));
}

// The world boot plays, the run it belongs to, and the slot it loaded from, null for a new or rescued world.
type Booted = { world: World; runId: string; loadedFrom: SlotId | null };

// The world the boot request names, else the newest save, else a new one. A save that cannot load goes to the player:
// migrate it or start over.
async function bootWorld(): Promise<Booted> {
  const request = takeBootRequest(window.sessionStorage, SAVE_KEY);
  if (request === 'new') return freshRun();
  const slot = request ?? newestSlot(slots, CONFIG.saveSlots);
  return slot === null ? newGameSaved() : bootSlot(slot);
}

async function bootSlot(slot: SlotId): Promise<Booted> {
  try {
    const world = loadWorld(slots, slot, map);
    if (!world) return newGameSaved();
    const runId = savedRunId(storedSave(slots, slot));
    if (runId === null) throw new Error(`The save in ${slot} loaded but names no run`);
    return { world, runId, loadedFrom: slot };
  } catch (err) {
    if (!(err instanceof SaveError)) throw err;
    return rescuedOrNew(err, slot);
  }
}

// A new run clears the old one's autosaves and tips. Its first save comes at once, so a reload before the next
// autosave does not load an older run's save.
function freshRun(): Booted {
  clearGame(slots, window.localStorage);
  return newGameSaved();
}

function newGameSaved(): Booted {
  const world = newGame();
  const runId = freshRunId();
  writeSave(slots, 'auto', world, runId, Date.now());
  return { world, runId, loadedFrom: null };
}

async function rescuedOrNew(error: SaveError, slot: SlotId): Promise<Booted> {
  const stored = storedSave(slots, slot);
  const canMigrate = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
  if ((await chooseSaveFate(error.message, canMigrate, stored)) === 'new') return freshRun();
  const rescued = rescueSave(slots, slot, map, startKit(CONFIG.startKit), freshSeed, freshRunId, Date.now());
  if (!rescued) throw new Error('The save became unreadable while migrating');
  await showCarryReport(rescued.report);
  return { world: rescued.world, runId: rescued.runId, loadedFrom: null };
}

// Asks the browser to keep saves under disk pressure. A refusal leaves them best-effort storage, as before.
async function persistSaves(): Promise<void> {
  // The storage manager exists only on https pages.
  if (!navigator.storage) return console.warn('The page is not secure, so it cannot ask the browser to keep saves under disk pressure');
  if (!(await navigator.storage.persist())) console.warn('The browser did not grant persistent storage, so it may evict saves under disk pressure');
}

function newGame(): World {
  return newWorld(CONFIG.seed ?? freshSeed(), startKit(CONFIG.startKit), map);
}

installCrashScreen();
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const loading = Promise.all([initPhysics(), loadModels(), loadBank(mixer.ctx, SOUNDS)]);
const map = await fetchMap();
const slots = await SaveSlots.open(await idbBackend(SAVE_KEY), window.localStorage, SAVE_KEY, allSlots(CONFIG.saveSlots));
persistSaves().catch(reportError);
// The world and its ground build while physics, models and sounds load, since those wait mostly on the network and decoders.
const { world, runId, loadedFrom } = await bootWorld();
const log = new RunLog(slots.backend, runId, (err) => slots.onError(err));
log.begin(world, loadedFrom);
groundTexture(world);
const [, , bank] = await loading;
const soundSettings = new SoundSettings(mixer, window.localStorage);
const overlay = element('overlay');
const game = new Game(world, { slots, runId, log }, element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute());
const view = { focus: () => game.rig.focus(), setSpeed: (factor: number) => game.follow.keyPan.setSpeed(factor) };
const debugConsole = new DebugConsole(uiRoot(), game, mountPerfPanel(overlay), new Noclip(game, view, PHYSICS.metersPerTile));
keepRunningOnErrors((text) => debugConsole.error(text));
onEveryError(() => game.holdSaves());
performance.mark('roam:ready');
setTimeout(() => warmAfterBoot(routeRadii(game.state)));
if (import.meta.env.DEV) {
  (window as any).__ROAM__ = game;
  (window as any).__ROAM_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
}

// Route grids build after boot, one per task, the player's first. Any route asked for earlier builds its own grid.
function warmAfterBoot(radii: number[]): void {
  const radius = radii.shift();
  if (radius === undefined) return;
  warmRoutes(game.state, [radius]);
  setTimeout(() => warmAfterBoot(radii));
}

// A random 32-bit integer. Boot is outside the sim, so it may use Math.random().
function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) | 0;
}

// 16 random bytes in hex. crypto.randomUUID() exists only on https pages, and the game also runs over plain http on a
// local network.
function freshRunId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function routeRadii(world: World): number[] {
  const player = vehicleStats(world, playerVehicle(world)).radius;
  return [...new Set([player, ...Object.values(CHASSIS).map((c) => c.radius)])];
}
