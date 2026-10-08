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

export function saveKey(scope: string): string {
  return scope === '' ? 'roam.save' : `roam.save.${scope}`;
}

export const SAVE_KEY = saveKey(__SAVE_SCOPE__);

export class SaveError extends Error {}

export function clearSlot(storage: Storage, slot: SlotId): void {
  storage.removeItem(slotKey(SAVE_KEY, slot));
}

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
    throw new SaveError('Game save is unreadable');
  }
}

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

export function loadWorld(storage: Storage, slot: SlotId, map: BakedMap): World | null {
  const raw = storage.getItem(slotKey(SAVE_KEY, slot));
  if (raw === null) return null;
  const world = savedWorld(parsedSave(raw));
  if (world.mapHash !== map.hash) throw new SaveError(`Game save was made on map ${world.mapHash}, not on the current map ${map.hash}`);
  const explored = unpackExplored(world.player.explored, world.size * world.size);
  if (world.obstacles.some(isBakedObstacle)) throw new SaveError('Game save holds baked map props, which come from the map file');
  const player = { ...world.player, explored };
  const loaded = { ...world, player, obstacles: [...standingBaked(map, world.broken), ...world.obstacles], terrain: map.terrain };
  settleAims(loaded);
  return loaded;
}

function standingBaked(map: BakedMap, broken: readonly BrokenProp[]): Obstacle[] {
  const baked = mapObstacles(map);
  const ids = new Set(baked.map((o) => o.id));
  const bad = broken.find(({ obstacle }) => !isBreakable(obstacle) || !ids.has(obstacle.id));
  if (bad) throw new SaveError(`Game save holds broken prop ${bad.obstacle.id}, which is no breakable prop of the map`);
  const gone = new Set(broken.map(({ obstacle }) => obstacle.id));
  return baked.filter((o) => !gone.has(o.id));
}

function savedWorld(save: unknown): Omit<World, 'terrain'> {
  const world = migratedWorld(save);
  if (!isWorld(world)) throw new SaveError('Invalid saved world');
  return world;
}

function migratedWorld(save: unknown): unknown {
  if (!isJsonObject(save)) throw new SaveError('Invalid game save');
  const { major, minor } = formatOf(save);
  if (major !== SAVE_MAJOR) throw new SaveError(`Game save format ${major}.${minor} is from an incompatible game version. Start a new game.`);
  if (minor > MIGRATIONS.length) throw new SaveError(`Game save format ${major}.${minor} is from a newer game version`);
  if (!isJsonObject(save.world)) throw new SaveError('Invalid saved world');
  try {
    return MIGRATIONS.slice(minor).reduce((world, step) => step(world), save.world);
  } catch {
    throw new SaveError(`Game save format ${major}.${minor} could not be migrated`);
  }
}

function formatOf(save: SavedJson): { major: number; minor: number } {
  if (save.version === '1.0.0') return { major: 1, minor: 0 };
  const format = save.format;
  if (!isJsonObject(format) || !isCount(format.major) || !isCount(format.minor)) throw new SaveError('Game save has no valid format version');
  return { major: format.major, minor: format.minor };
}

function isJsonObject(value: unknown): value is SavedJson {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const WORLD_LISTS = ['vehicles', 'obstacles', 'broken', 'salvage', 'events', 'removed', 'weather', 'dustClouds', 'states'] as const;

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

export function isDayStart(turn: number): boolean {
  return clockOf(turn).day !== clockOf(turn - 1).day;
}

export function saveWorld(storage: Storage, world: World, interval: number, savedAt: number): void {
  if (!Number.isInteger(interval) || interval <= 0) throw new Error('Invalid save interval');
  if (world.player.state === 'dead') return;
  if ((world.turn - 1) % interval === 0) writeSave(storage, 'auto', world, savedAt);
  if (isDayStart(world.turn)) writeSave(storage, 'day', world, savedAt);
}

export function saveInTown(storage: Storage, world: World, savedAt: number): void {
  if (world.player.state === 'active' && townAt(world)) writeSave(storage, 'auto', world, savedAt);
}

export function writeSave(storage: Storage, slot: SlotId, world: World, savedAt: number): void {
  if (world.player.state === 'dead') throw new Error('Cannot save a world whose player is dead');
  storage.setItem(slotKey(SAVE_KEY, slot), JSON.stringify({ ...saveOf(world), savedAt }));
}

export function saveOf(world: World): { format: typeof SAVE_FORMAT; world: object } {
  const { terrain: _terrain, ...saved } = world;
  const player = { ...saved.player, explored: packExplored(saved.player.explored) };
  const obstacles = saved.obstacles.filter((o) => !isBakedObstacle(o));
  return { format: SAVE_FORMAT, world: { ...saved, player, obstacles } };
}

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
  if (typeof packed !== 'string') throw new SaveError('Invalid saved explored tiles');
  let binary: string;
  try {
    binary = atob(packed);
  } catch {
    throw new SaveError('Invalid saved explored tiles');
  }
  if (binary.length !== Math.ceil(tiles / 8)) throw new SaveError('Invalid saved explored tiles');
  const explored = new Uint8Array(tiles);
  for (let i = 0; i < tiles; i++) explored[i] = (binary.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return explored;
}

export function saveStore(storage: Storage, session: Storage, world: () => World, slotCount: number) {
  return {
    list: () => listSaves(storage, SAVE_KEY, slotCount),
    manualSlots: () => manualSlots(slotCount),
    hasSave: () => hasSave(storage, allSlots(slotCount)),
    save: (slot: SlotId) => writeSave(storage, slot, world(), Date.now()),
    requestBoot: (request: BootRequest) => requestBoot(session, SAVE_KEY, request),
  };
}

export type SaveStore = ReturnType<typeof saveStore>;

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

export const SAVE_HELD_NOTE = 'Not saved: an error happened since the last good turn.';

export function turnFailedNote(err: unknown): string {
  return `The turn failed and did not play: ${err instanceof Error ? err.message : String(err)}. The game was not saved.`;
}
