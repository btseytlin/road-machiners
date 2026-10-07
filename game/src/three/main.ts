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
import { loadLanguage, relocalize } from '../text/language';
import { chooseSaveFate, saveErrorText, showCarryReport } from '../ui/save-screen';
import { mountPerfPanel } from '../ui/perf-panel';
import { SoundSettings } from '../ui/sound';
import { RadioPanel, RadioStation } from '../ui/radio';
import { installCrashScreen, keepRunningOnErrors, onEveryError } from './crash';
import { Game } from './game';
import { clearGame, loadWorld, SAVE_KEY, SaveError, storedSave, tryWriteSave } from './save';
import { newestSlot, takeBootRequest, type SlotId } from './save-slots';
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

// The world the boot request names, else the newest save, else a new one. A save that cannot load goes to the player:
// migrate it or start over.
async function bootWorld(): Promise<World> {
  const request = takeBootRequest(window.sessionStorage, SAVE_KEY);
  if (request === 'new') return freshRun();
  const slot = request ?? newestSlot(window.localStorage, SAVE_KEY, CONFIG.saveSlots);
  return slot === null ? newGameSaved() : bootSlot(slot);
}

async function bootSlot(slot: SlotId): Promise<World> {
  try {
    return loadWorld(window.localStorage, slot, map) ?? newGameSaved();
  } catch (err) {
    if (!(err instanceof SaveError)) throw err;
    return rescuedOrNew(err, slot);
  }
}

// A new run clears the old one's autosaves and tips. Its first save comes at once, so a reload before the next
// autosave does not load an older run's save.
function freshRun(): World {
  clearGame(window.localStorage);
  return newGameSaved();
}

function newGameSaved(): World {
  const world = newGame();
  // Full storage does not stop the new game. The first autosave that fails tells the player.
  tryWriteSave(window.localStorage, 'auto', world, Date.now());
  return world;
}

async function rescuedOrNew(error: SaveError, slot: SlotId): Promise<World> {
  const stored = storedSave(window.localStorage, slot);
  const canMigrate = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
  if ((await chooseSaveFate(saveErrorText(error), canMigrate)) === 'new') return freshRun();
  const rescued = rescueSave(window.localStorage, slot, map, startKit(CONFIG.startKit), freshSeed, Date.now());
  if (!rescued) throw new Error('The save became unreadable while migrating');
  await showCarryReport(rescued.report);
  return rescued.world;
}

function newGame(): World {
  return newWorld(CONFIG.seed ?? freshSeed(), startKit(CONFIG.startKit), map);
}

installCrashScreen();
// The language comes first, so the boot screens already speak it. A switch rewrites bound text in place, then the game
// redraws what it draws with resolved words.
const language = loadLanguage(window.localStorage, window.location.search, import.meta.env.DEV, document.documentElement);
let relocalizeGame: (() => void) | null = null;
language.subscribe(() => {
  relocalize(uiRoot());
  relocalize(element('overlay'));
  relocalizeGame?.();
});
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const loading = Promise.all([initPhysics(), loadModels(), loadBank(mixer.ctx, SOUNDS)]);
const map = await fetchMap();
// The world and its ground build while physics, models and sounds load, since those wait mostly on the network and decoders.
const world = await bootWorld();
groundTexture(world);
const [, , bank] = await loading;
// UI code may use Math.random(), and the radio changes no rule.
const radio = new RadioPanel(new RadioStation(Math.random));
const soundSettings = new SoundSettings(mixer, window.localStorage, radio.faceplate, radio.keys, () => game.loops.nextTrack());
radio.hear(world);
const overlay = element('overlay');
const game = new Game(world, element('game'), overlay, new SoundPlayer(mixer, bank, SOUNDS), () => soundSettings.toggleMute(), radio);
relocalizeGame = () => {
  radio.relocalize();
  game.uiStale = true;
};
const view = { focus: () => game.rig.focus(), setSpeed: (factor: number) => game.follow.keyPan.setSpeed(factor) };
const debugConsole = new DebugConsole(uiRoot(), game, mountPerfPanel(overlay), new Noclip(game, view, PHYSICS.metersPerTile));
keepRunningOnErrors((text) => debugConsole.error(text));
onEveryError(() => game.holdSaves());
performance.mark('roam:ready');
setTimeout(() => warmAfterBoot(routeRadii(game.state)));
if (import.meta.env.DEV) {
  // The layout check and the playtest switch the language through it.
  (window as any).__ROAM__ = Object.assign(game, { language });
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

function routeRadii(world: World): number[] {
  const player = vehicleStats(world, playerVehicle(world)).radius;
  return [...new Set([player, ...Object.values(CHASSIS).map((c) => c.radius)])];
}
