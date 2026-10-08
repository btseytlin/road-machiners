// Boots the 3D game.

import { loadBank } from '../audio/bank';
import { Mixer } from '../audio/mixer';
import { SoundPlayer } from '../audio/player';
import { CONFIG, ERROR_REPORT_BUILD, ERROR_REPORT_URL, GAME_VERSION } from '../config';
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
import type { World, WorldSetup } from '../sim/types';
import { newWorld } from '../sim/world';
import { DebugConsole, Noclip } from '../ui/console';
import { uiRoot } from '../ui/dom';
import type { NewGameActions } from '../ui/new-game';
import { chooseSaveFate, showCarryReport } from '../ui/save-screen';
import { mountPerfPanel } from '../ui/perf-panel';
import { SoundSettings } from '../ui/sound';
import { RadioPanel, RadioStation } from '../ui/radio';
import { installCrashScreen, keepRunningOnErrors, onEveryError, onReport, reportError } from './crash';
import { ErrorReporter } from './error-report';
import { Game } from './game';
import { clearGame, loadWorld, SAVE_KEY, SaveError, savedRunId, storedSave, writeSave } from './save';
import { idbBackend, SaveSlots } from './save-db';
import { RunLog } from './run-log';
import { allSlots, newestSlot, requestBoot, takeBootRequest, type SlotId } from './save-slots';
import { rescueSave } from './save-rescue';
import { loadModels } from './render/models';
import { groundTexture } from './render/terrain';
import { defaultSetup } from '../sim/settings';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} element missing from the page`);
  return el;
}

async function fetchMap(): Promise<BakedMap> {
  const response = await fetch(MAPGEN.file);
  if (!response.ok) throw new Error(`Map file ${MAPGEN.file} failed to load: ${response.status} ${response.statusText}`);
  return decodeMap(new Uint8Array(await response.arrayBuffer()));
}

type Booted = { world: World; runId: string; loadedFrom: SlotId | null; fresh: boolean };

async function bootWorld(): Promise<Booted> {
  const request = takeBootRequest(window.sessionStorage, SAVE_KEY);
  if (typeof request === 'object' && request !== null) return freshRun(request.new);
  const slot = request ?? newestSlot(slots, CONFIG.saveSlots);
  return slot === null ? newGameSaved(defaultSetup('roaming')) : bootSlot(slot);
}

async function bootSlot(slot: SlotId): Promise<Booted> {
  try {
    const world = loadWorld(slots, slot, map);
    if (!world) return newGameSaved(defaultSetup('roaming'));
    const runId = savedRunId(storedSave(slots, slot));
    if (runId === null) throw new Error(`The save in ${slot} loaded but names no run`);
    return { world, runId, loadedFrom: slot, fresh: false };
  } catch (err) {
    if (!(err instanceof SaveError)) throw err;
    return rescuedOrNew(err, slot);
  }
}

function freshRun(setup: WorldSetup): Booted {
  clearGame(slots, window.localStorage);
  return newGameSaved(setup);
}

function newGameSaved(setup: WorldSetup): Booted {
  const world = newGame(setup);
  const runId = freshRunId();
  writeSave(slots, 'auto', world, runId, Date.now());
  return { world, runId, loadedFrom: null, fresh: true };
}

async function rescuedOrNew(error: SaveError, slot: SlotId): Promise<Booted> {
  const stored = storedSave(slots, slot);
  const canMigrate = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
  await chooseSaveFate(error.message, canMigrate, stored, newGameActions);
  const rescued = rescueSave(slots, slot, map, startKit(CONFIG.startKit), freshSeed, freshRunId, Date.now());
  if (!rescued) throw new Error('The save became unreadable while migrating');
  await showCarryReport(rescued.report);
  return { world: rescued.world, runId: rescued.runId, loadedFrom: null, fresh: false };
}

async function persistSaves(): Promise<void> {
  if (!navigator.storage) return console.warn('The page is not secure, so it cannot ask the browser to keep saves under disk pressure');
  if (!(await navigator.storage.persist())) console.warn('The browser did not grant persistent storage, so it may evict saves under disk pressure');
}

function newGame(setup: WorldSetup): World {
  return newWorld(CONFIG.seed ?? freshSeed(), startKit(CONFIG.startKit), map, setup);
}

installCrashScreen();
const reporter = ERROR_REPORT_URL ? new ErrorReporter(ERROR_REPORT_URL, ERROR_REPORT_BUILD, GAME_VERSION) : null;
if (reporter) onReport((err) => void reporter.report(err));
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const loading = Promise.all([initPhysics(), loadModels(), loadBank(mixer.ctx, SOUNDS)]);
const map = await fetchMap();
const slots = await SaveSlots.open(await idbBackend(SAVE_KEY), window.localStorage, SAVE_KEY, allSlots(CONFIG.saveSlots));
persistSaves().catch(reportError);
const newGameActions: NewGameActions = {
  requestBoot: (request) => requestBoot(window.sessionStorage, SAVE_KEY, request),
  reload: () => void slots.flush().then(() => window.location.reload(), reportError),
  confirm: (text) => window.confirm(text),
};
const { world, runId, loadedFrom, fresh } = await bootWorld();
const log = new RunLog(slots.backend, runId, (err) => slots.onError(err));
log.begin(world, loadedFrom);
groundTexture(world);
const [, , bank] = await loading;
const radio = new RadioPanel(new RadioStation(Math.random));
const soundSettings = new SoundSettings(mixer, window.localStorage, radio.faceplate, radio.keys, () => game.loops.nextTrack());
radio.hear(world);
const overlay = element('overlay');
const game = new Game(world, { slots, runId, log }, element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute(), radio);
const view = { focus: () => game.rig.focus(), setSpeed: (factor: number) => game.follow.keyPan.setSpeed(factor) };
const opening = startKit(CONFIG.startKit).opening;
if (fresh && opening) game.hud.note(world, opening.log, "");
const debugConsole = new DebugConsole(uiRoot(), game, mountPerfPanel(overlay), new Noclip(game, view, PHYSICS.metersPerTile));
keepRunningOnErrors((text) => debugConsole.error(text));
onEveryError(() => game.holdSaves());
reporter?.watch({ world: () => game.state, log: () => game.logTexts(), slots });
performance.mark('roam:ready');
setTimeout(() => warmAfterBoot(routeRadii(game.state)));
if (import.meta.env.DEV) {
  (window as any).__ROAM__ = game;
  (window as any).__ROAM_PERF__ = { snapshot: perfSnapshot, reset: resetPerf };
}

function warmAfterBoot(radii: number[]): void {
  const radius = radii.shift();
  if (radius === undefined) return;
  warmRoutes(game.state, [radius]);
  setTimeout(() => warmAfterBoot(radii));
}

function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) | 0;
}

function freshRunId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function routeRadii(world: World): number[] {
  const player = vehicleStats(world, playerVehicle(world)).radius;
  return [...new Set([player, ...Object.values(CHASSIS).map((c) => c.radius)])];
}
