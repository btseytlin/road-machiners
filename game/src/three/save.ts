import { t } from '../text/msg';
import type { BakedMap } from '../sim/terrain';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { townAt } from '../sim/sites';
import type { BrokenProp, Obstacle, World } from '../sim/types';
import { clearTips } from '../ui/tips';
import { settleAims } from '../sim/combat';
import { clockOf } from '../sim/sun';
import { allSlots, listSaves, manualSlots, requestBoot, slotKey, type BootRequest, type SlotId } from './save-slots';
import { MIGRATIONS, SAVE_FORMAT, SAVE_MAJOR, type SavedJson } from './save-migrations';

declare const __SAVE_SCOPE__: string;

// A build with a scope keeps its save apart from other builds served from the same site.
export function saveKey(scope: string): string {
  return scope === '' ? 'roam.save' : `roam.save.${scope}`;
}

// The Autosave's key, and the base of every other slot's key.
export const SAVE_KEY = saveKey(__SAVE_SCOPE__);

// Why a stored save does not load. The boot screen shows it in words. format is the save's format for the codes that
// name it.
export type SaveErrorCode =
  | 'unreadable' | 'otherMap' | 'bakedProps' | 'brokenProp' | 'invalidWorld' | 'invalidSave'
  | 'incompatible' | 'newer' | 'notMigrated' | 'noFormat' | 'badExplored';

// A stored save the game cannot load. Boot offers to migrate it to a new world or to start over. The message carries
// the detail for the console. The player reads the code's words.
export class SaveError extends Error {
  constructor(readonly code: SaveErrorCode, readonly format: { major: number; minor: number } | null = null, detail = '') {
    super(`Save error ${code}${detail ? `: ${detail}` : ''}`);
  }
}

// Local storage has no room for a save. The save in the slot stays as it was.
export class SaveQuotaError extends Error {}

export function clearSlot(storage: Storage, slot: SlotId): void {
  storage.removeItem(slotKey(SAVE_KEY, slot));
}

// Clears what the run keeps in storage: the autosaves and the seen tips. The manual slots stay, since the player chose
// to keep them, and so do the sound settings, which are the player's, not the run's.
export function clearGame(storage: Storage): void {
  clearSlot(storage, 'auto');
  clearSlot(storage, 'day');
  clearTips(storage);
}

export function hasSave(storage: Storage, slots: readonly SlotId[]): boolean {
  return slots.some((slot) => storage.getItem(slotKey(SAVE_KEY, slot)) !== null);
}

function parsedSave(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new SaveError('unreadable');
  }
}

// The stored save as parsed JSON, or undefined when there is none or it does not parse. For the rescue.
export function storedSave(storage: Storage, slot: SlotId): unknown {
  const raw = storage.getItem(slotKey(SAVE_KEY, slot));
  return raw === null ? undefined : parsedOrUndefined(raw);
}

function parsedOrUndefined(raw: string): unknown {
  try {
    return parsedSave(raw);
  } catch {
    return undefined;
  }
}

// Saves leave out the terrain and the baked props, which come from the map file the save names by hash. Broken props are saved whole. The 600-tile terrain alone is
// about 10 MB of JSON, past the browser's local storage quota. Old saves migrate to the current format on load.

// The saved world on the given map. A save made on another map fails, since its terrain is gone.
export function loadWorld(storage: Storage, slot: SlotId, map: BakedMap): World | null {
  const raw = storage.getItem(slotKey(SAVE_KEY, slot));
  if (raw === null) return null;
  const world = savedWorld(parsedSave(raw));
  if (world.mapHash !== map.hash) throw new SaveError('otherMap', null, `map ${world.mapHash}, not ${map.hash}`);
  const explored = unpackExplored(world.player.explored, world.size * world.size);
  if (world.obstacles.some(isBakedObstacle)) throw new SaveError('bakedProps');
  const player = { ...world.player, explored };
  const loaded = { ...world, player, obstacles: [...standingBaked(map, world.broken), ...world.obstacles], terrain: map.terrain };
  settleAims(loaded);
  return loaded;
}

// The map's baked props but the broken ones. Every broken prop must be a breakable prop of this map.
function standingBaked(map: BakedMap, broken: readonly BrokenProp[]): Obstacle[] {
  const baked = mapObstacles(map);
  const ids = new Set(baked.map((o) => o.id));
  const bad = broken.find(({ obstacle }) => !isBreakable(obstacle) || !ids.has(obstacle.id));
  if (bad) throw new SaveError('brokenProp', null, bad.obstacle.id);
  const gone = new Set(broken.map(({ obstacle }) => obstacle.id));
  return baked.filter((o) => !gone.has(o.id));
}

function savedWorld(save: unknown): Omit<World, 'terrain'> {
  const world = migratedWorld(save);
  if (!isWorld(world)) throw new SaveError('invalidWorld');
  return world;
}

// The saved world carried through every step from the save's minor format to the current one.
function migratedWorld(save: unknown): unknown {
  if (!isJsonObject(save)) throw new SaveError('invalidSave');
  const { major, minor } = formatOf(save);
  if (major !== SAVE_MAJOR) throw new SaveError('incompatible', { major, minor });
  if (minor > MIGRATIONS.length) throw new SaveError('newer', { major, minor });
  if (!isJsonObject(save.world)) throw new SaveError('invalidWorld');
  try {
    return MIGRATIONS.slice(minor).reduce((world, step) => step(world), save.world);
  } catch (err) {
    throw new SaveError('notMigrated', { major, minor }, String(err));
  }
}

// Saves from before save formats carry the game version 1.0.0 and hold format 1.0.
function formatOf(save: SavedJson): { major: number; minor: number } {
  if (save.version === '1.0.0') return { major: 1, minor: 0 };
  const format = save.format;
  if (!isJsonObject(format) || !isCount(format.major) || !isCount(format.minor)) throw new SaveError('noFormat');
  return { major: format.major, minor: format.minor };
}

function isJsonObject(value: unknown): value is SavedJson {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// World fields a save must hold as arrays.
const WORLD_LISTS = ['vehicles', 'obstacles', 'broken', 'salvage', 'events', 'removed', 'weather', 'dustClouds', 'states', 'craters'] as const;

function isWorld(value: unknown): value is Omit<World, 'terrain'> {
  if (!value || typeof value !== 'object') return false;
  const world = value as Partial<World>;
  if ('terrain' in world) return false;
  return Number.isInteger(world.turn) && world.turn! > 0 && Number.isInteger(world.seed)
    && Number.isInteger(world.rngState) && Number.isInteger(world.nextId) && world.nextId! >= 0
    && Number.isInteger(world.size) && world.size! > 0
    && !!world.spawnTimer && typeof world.spawnTimer === 'object' && !Array.isArray(world.spawnTimer)
    && WORLD_LISTS.every((key) => Array.isArray(world[key]))
    && !!world.player && typeof world.player === 'object'
    && typeof world.player.vehicleId === 'string' && Array.isArray(world.player.contacts) && Array.isArray(world.player.clouds);
}

// The first turn of a game day, which the Day start autosave keeps.
export function isDayStart(turn: number): boolean {
  return clockOf(turn).day !== clockOf(turn - 1).day;
}

// Writes a save for the automatic paths. Returns false when storage is full, so the caller can tell the player. The old
// save in the slot stays, and no other key is touched.
export function tryWriteSave(storage: Storage, slot: SlotId, world: World, savedAt: number): boolean {
  try {
    writeSave(storage, slot, world, savedAt);
    return true;
  } catch (err) {
    if (err instanceof SaveQuotaError) return false;
    throw err;
  }
}

function dueSlots(turn: number, interval: number): SlotId[] {
  const due: SlotId[] = [];
  if ((turn - 1) % interval === 0) due.push('auto');
  if (isDayStart(turn)) due.push('day');
  return due;
}

// Writes the autosaves due this turn. A full storage calls onFull instead of throwing.
export function saveWorld(storage: Storage, world: World, interval: number, savedAt: number, onFull: () => void): void {
  if (!Number.isInteger(interval) || interval <= 0) throw new Error('Invalid save interval');
  // A dead run keeps its last saves, so the player can load them.
  if (world.player.state === 'dead') return;
  if (dueSlots(world.turn, interval).map((slot) => tryWriteSave(storage, slot, world, savedAt)).includes(false)) onFull();
}

// A UI command in town, like a purchase, saves at once, so a reload does not undo it.
export function saveInTown(storage: Storage, world: World, savedAt: number, onFull: () => void): void {
  if (world.player.state === 'active' && townAt(world) && !tryWriteSave(storage, 'auto', world, savedAt)) onFull();
}

export function writeSave(storage: Storage, slot: SlotId, world: World, savedAt: number): void {
  if (world.player.state === 'dead') throw new Error('Cannot save a world whose player is dead');
  try {
    storage.setItem(slotKey(SAVE_KEY, slot), JSON.stringify({ ...saveOf(world), savedAt }));
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
      throw new SaveQuotaError('Local storage is full');
    }
    throw err;
  }
}

// The save of a world as it goes into JSON.
export function saveOf(world: World): { format: typeof SAVE_FORMAT; world: object } {
  const { terrain: _terrain, ...saved } = world;
  // JSON writes a typed array as an object keyed by index, so explored goes out as a base64 bitset.
  const player = { ...saved.player, explored: packExplored(saved.player.explored) };
  const obstacles = saved.obstacles.filter((o) => !isBakedObstacle(o));
  return { format: SAVE_FORMAT, world: { ...saved, player, obstacles } };
}

// Explored tiles go into a save as a base64 bitset, one bit per tile and the least significant bit first. A list of zeros
// and ones would take 2 characters per tile, past what five saves leave of the local storage quota.
export function packExplored(explored: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(explored.length / 8));
  explored.forEach((value, i) => {
    if (value !== 0 && value !== 1) throw new Error(`Explored tile ${i} is ${value}, not 0 or 1`);
    bytes[i >> 3] |= value << (i & 7);
  });
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function unpackExplored(packed: unknown, tiles: number): Uint8Array {
  if (typeof packed !== 'string') throw new SaveError('badExplored');
  let binary: string;
  try {
    binary = atob(packed);
  } catch {
    throw new SaveError('badExplored');
  }
  if (binary.length !== Math.ceil(tiles / 8)) throw new SaveError('badExplored');
  const explored = new Uint8Array(tiles);
  for (let i = 0; i < tiles; i++) explored[i] = (binary.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return explored;
}

// What the menus do with the saves: the game's world in, the slots of local storage out. Loading and starting a new
// game reload the page, so they leave a boot request in session storage.
export function saveStore(storage: Storage, session: Storage, world: () => World, slotCount: number, onFull: () => void) {
  return {
    list: () => listSaves(storage, SAVE_KEY, slotCount),
    manualSlots: () => manualSlots(slotCount),
    hasSave: () => hasSave(storage, allSlots(slotCount)),
    save: (slot: SlotId) => {
      if (!tryWriteSave(storage, slot, world(), Date.now())) onFull();
    },
    requestBoot: (request: BootRequest) => requestBoot(session, SAVE_KEY, request),
  };
}

export type SaveStore = ReturnType<typeof saveStore>;

// Whether saving is safe. An error after boot holds saves, since the world may be broken. The hold lifts only when a
// turn that began after the last error finishes playback with no error during it.
export class SaveHold {
  private errors = false;
  private tainted = false;

  get held(): boolean {
    return this.errors;
  }

  noteError(): void {
    this.errors = true;
    this.tainted = true;
  }

  beginTurn(): void {
    this.tainted = false;
  }

  finishTurn(): void {
    if (!this.tainted) this.errors = false;
  }
}

export const SAVE_FULL_NOTE = t('save.full');
export const SAVE_HELD_NOTE = t('save.held');
// The error itself goes to the console and the bug report. The player reads only that the turn failed.
export const TURN_FAILED_NOTE = t('save.turnFailed');
