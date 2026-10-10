import { t, type Msg } from '../text/msg';
import type { BakedMap } from '../sim/terrain';
import { isBakedObstacle, isBreakable, mapObstacles } from '../sim/mapgen';
import { townAt } from '../sim/sites';
import { reachedOutpostAt } from '../sim/fury-road';
import { highwayMap } from '../sim/highway';
export { newMapFor } from '../sim/highway';
import type { BrokenProp, Obstacle, Player, Vehicle, World, WorldSetup } from '../sim/types';
import { refreshVision } from '../sim/vision';
import { parseSetup } from '../sim/settings';
import { clearTips } from '../ui/tips';
import type { NewGameActions } from '../ui/new-game';
import { settleAims } from '../sim/combat';
import { stockOldSpots } from '../sim/salvage';
import { clockOf } from '../sim/sun';
import { allSlots, listSaves, manualSlots, requestBoot, slotLabel, type BootRequest, type SlotId } from './save-slots';
import type { SaveSlots } from './save-db';
import { reportError } from './crash';
import { CONFIG, GAME_VERSION } from '../config';
import { download } from '../ui/dom';
import type { RunLog } from './run-log';
import { MIGRATIONS, SAVE_FORMAT, SAVE_MAJOR, type SavedJson } from './save-migrations';

declare const __SAVE_SCOPE__: string;

export function saveKey(scope: string): string {
  return scope === '' ? 'roam.save' : `roam.save.${scope}`;
}

export const SAVE_KEY = saveKey(__SAVE_SCOPE__);

// Why a stored save does not load. The boot screen shows it in words. format is the save's format for the codes that
// name it.
export type SaveErrorCode =
  | 'unreadable' | 'otherMap' | 'bakedProps' | 'brokenProp' | 'invalidWorld' | 'invalidSave' | 'badSetup'
  | 'incompatible' | 'newer' | 'notMigrated' | 'noFormat' | 'badExplored' | 'badOldSpots';

// A stored save the game cannot load. Boot offers to migrate it to a new world or to start over. The message carries
// the detail for the console. The player reads the code's words.
export class SaveError extends Error {
  constructor(readonly code: SaveErrorCode, readonly format: { major: number; minor: number } | null = null, detail = '') {
    super(`Save error ${code}${detail ? `: ${detail}` : ''}`);
  }
}

export type SaveEnvelope = { format: typeof SAVE_FORMAT; savedAt: number; runId: string; world: object };

export function clearSlot(slots: SaveSlots, slot: SlotId): void {
  slots.remove(slot);
}

export function clearGame(slots: SaveSlots, storage: Storage): void {
  clearSlot(slots, 'auto');
  clearSlot(slots, 'day');
  clearTips(storage);
}

export function hasSave(slots: SaveSlots, ids: readonly SlotId[]): boolean {
  return ids.some((slot) => slots.has(slot));
}

export function storedSave(slots: SaveSlots, slot: SlotId): unknown {
  return slots.get(slot) ?? undefined;
}

export function savedRunId(envelope: unknown): string | null {
  const save = envelope as { runId?: unknown; world?: { seed?: unknown } } | null;
  if (typeof save?.runId === 'string') return save.runId;
  if (typeof save?.world?.seed === 'number') return `legacy-${save.world.seed}`;
  return null;
}

type SavedBroken = { id: string; turn: number };

type SavedWorld = Omit<World, 'terrain' | 'events' | 'removed' | 'broken' | 'vehicles' | 'player'> & {
  broken: SavedBroken[];
  vehicles: Omit<Vehicle, 'trail'>[];
  player: Omit<Player, ViewField>;
};

type ViewField = 'visible' | 'contacts' | 'clouds';

export function mapFor(saved: Pick<World, 'mapHash' | 'seed' | 'setup' | 'furyRoad'>, icarus: BakedMap): BakedMap {
  const highway = saved.mapHash.startsWith('highway:');
  if (saved.setup.mode !== 'furyRoad') {
    if (highway) throw new SaveError('otherMap', null, `A ${saved.setup.mode} save names highway map ${saved.mapHash}`);
    return icarus;
  }
  if (!saved.furyRoad) throw new SaveError('otherMap', null, 'This Fury Road run was laid on Icarus roads, and the highway has replaced them');
  if (!highway) throw new SaveError('otherMap', null, `A Fury Road save names map ${saved.mapHash}, which is no highway`);
  const map = highwayMap(saved.seed, saved.furyRoad.window);
  if (map.hash !== saved.mapHash) throw new SaveError('otherMap', null, `map ${saved.mapHash}, not the current highway ${map.hash}`);
  return map;
}

export function loadWorld(slots: SaveSlots, slot: SlotId, icarus: BakedMap): World | null {
  const envelope = slots.get(slot);
  if (envelope === null) return null;
  const world = savedWorld(envelope);
  const map = mapFor(world, icarus);
  if (world.mapHash !== map.hash) throw new SaveError('otherMap', null, `map ${world.mapHash}, not ${map.hash}`);
  const explored = unpackExplored(world.player.explored, world.size * world.size);
  if (world.obstacles.some(isBakedObstacle)) throw new SaveError('bakedProps');
  const baked = mapObstacles(map);
  const broken = brokenProps(baked, world.broken);
  const gone = new Set(world.broken.map((b) => b.id));
  const loaded: World = {
    ...world,
    player: { ...world.player, explored, visible: [], contacts: [], clouds: [] },
    vehicles: world.vehicles.map((v) => ({ ...v, trail: [] })),
    obstacles: [...baked.filter((o) => !gone.has(o.id)), ...world.obstacles],
    broken,
    events: [],
    removed: [],
    terrain: map.terrain,
  };
  stockedOldSpots(loaded, map);
  refreshVision(loaded);
  settleAims(loaded);
  return loaded;
}

function stockedOldSpots(world: World, map: BakedMap): void {
  try {
    stockOldSpots(world, map);
  } catch (error) {
    throw new SaveError('badOldSpots', null, (error as Error).message);
  }
}

function brokenProps(baked: readonly Obstacle[], broken: readonly SavedBroken[]): BrokenProp[] {
  const byId = new Map(baked.map((o) => [o.id, o]));
  return broken.map(({ id, turn }) => {
    const obstacle = byId.get(id);
    if (!obstacle || !isBreakable(obstacle)) throw new SaveError('brokenProp', null, id);
    return { obstacle, turn };
  });
}

function savedWorld(save: unknown): SavedWorld {
  const world = migratedWorld(save);
  if (!isWorld(world)) throw new SaveError('invalidWorld');
  return { ...world, setup: savedSetup(world.setup) };
}

function savedSetup(setup: unknown): WorldSetup {
  try {
    return parseSetup(setup);
  } catch (err) {
    throw new SaveError('badSetup', null, err instanceof Error ? err.message : String(err));
  }
}

function migratedWorld(stored: unknown): unknown {
  const save = envelopeOf(stored);
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

function envelopeOf(stored: unknown): SavedJson {
  if (typeof stored === 'string') throw new SaveError('unreadable');
  if (!isJsonObject(stored)) throw new SaveError('invalidSave');
  return stored;
}

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

const WORLD_LISTS = ['vehicles', 'obstacles', 'broken', 'salvage', 'weather', 'dustClouds', 'states', 'craters'] as const;

function isWorld(value: unknown): value is SavedWorld {
  if (!value || typeof value !== 'object') return false;
  const world = value as Partial<SavedWorld>;
  if ('terrain' in world) return false;
  return Number.isInteger(world.turn) && world.turn! > 0 && Number.isInteger(world.seed)
    && Number.isInteger(world.rngState) && Number.isInteger(world.nextId) && world.nextId! >= 0
    && Number.isInteger(world.size) && world.size! > 0
    && !!world.spawnTimer && typeof world.spawnTimer === 'object' && !Array.isArray(world.spawnTimer)
    && WORLD_LISTS.every((key) => Array.isArray(world[key]))
    && !!world.player && typeof world.player === 'object'
    && typeof world.player.vehicleId === 'string';
}

export function isDayStart(turn: number): boolean {
  return clockOf(turn).day !== clockOf(turn - 1).day;
}

export function saveWorld(slots: SaveSlots, world: World, runId: string, interval: number, savedAt: number): void {
  if (!Number.isInteger(interval) || interval <= 0) throw new Error('Invalid save interval');
  if (world.player.state === 'dead') return;
  if ((world.turn - 1) % interval === 0) writeSave(slots, 'auto', world, runId, savedAt);
  if (isDayStart(world.turn)) writeSave(slots, 'day', world, runId, savedAt);
}

export function saveInTown(slots: SaveSlots, world: World, runId: string, savedAt: number): void {
  if (world.player.state === 'active' && (townAt(world) || reachedOutpostAt(world))) writeSave(slots, 'auto', world, runId, savedAt);
}

export function saveOnArrival(slots: SaveSlots, world: World, runId: string, savedAt: number): void {
  if (world.player.state === 'active' && world.events.some((e) => e.t === 'outpostReached')) writeSave(slots, 'auto', world, runId, savedAt);
}

export function writeSave(slots: SaveSlots, slot: SlotId, world: World, runId: string, savedAt: number): void {
  if (world.player.state === 'dead') throw new Error('Cannot save a world whose player is dead');
  const envelope: SaveEnvelope = { ...saveOf(world), savedAt, runId };
  slots.put(slot, envelope);
}

export function saveOf(world: World): { format: typeof SAVE_FORMAT; world: object } {
  const { terrain: _terrain, events: _events, removed: _removed, ...saved } = world;
  const { visible: _visible, contacts: _contacts, clouds: _clouds, ...player } = saved.player;
  const vehicles = saved.vehicles.map(({ trail: _trail, ...vehicle }) => vehicle);
  const obstacles = saved.obstacles.filter((o) => !isBakedObstacle(o));
  const broken = saved.broken.map(({ obstacle, turn }) => ({ id: obstacle.id, turn }));
  return { format: SAVE_FORMAT, world: { ...saved, player: { ...player, explored: packExplored(player.explored) }, vehicles, obstacles, broken } };
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

export function saveStore(slots: SaveSlots, log: RunLog, session: Storage, world: () => World, runId: string, slotCount: number) {
  return {
    list: () => listSaves(slots, slotCount),
    manualSlots: () => manualSlots(slotCount),
    hasSave: () => hasSave(slots, allSlots(slotCount)),
    save: (slot: SlotId) => writeSave(slots, slot, world(), runId, Date.now()),
    reboot: (request: BootRequest) => {
      requestBoot(session, SAVE_KEY, request);
      Promise.all([slots.flush(), log.flush()]).then(() => window.location.reload(), reportError);
    },
    newGame: {
      requestBoot: (request: BootRequest) => requestBoot(session, SAVE_KEY, request),
      reload: () => void Promise.all([slots.flush(), log.flush()]).then(() => window.location.reload(), reportError),
      confirm: (text: string) => window.confirm(text),
    } satisfies NewGameActions,
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

export const SAVE_HELD_NOTE = t('save.held');

export const SAVE_FAILED_NOTE = t('save.failed');
export const TURN_FAILED_NOTE = t('save.turnFailed');

export type Run = { slots: SaveSlots; runId: string; log: RunLog; mapHash: string };

export function changeMapIfMoved(run: Run, world: World, hold: SaveHold, session: Storage, reload: () => void): boolean {
  if (world.mapHash === run.mapHash) return false;
  if (hold.held) throw new Error(`The map moved to ${world.mapHash} while saves are held, so a reboot would lose the turn`);
  const arrival = world.events.find((e) => e.t === 'outpostReached');
  if (!arrival) throw new Error(`The map moved to ${world.mapHash} with no outpost arrival`);
  writeSave(run.slots, 'auto', world, run.runId, Date.now());
  run.mapHash = world.mapHash;
  requestBoot(session, SAVE_KEY, { slot: 'auto', reason: 'road', arrival: { milestone: arrival.milestone, pay: arrival.pay, wrecks: arrival.wrecks } });
  Promise.all([run.slots.flush(), run.log.flush()]).then(reload, reportError);
  return true;
}

export class GameSaves {
  private readonly hold = new SaveHold();
  private moving = false;

  constructor(private readonly run: Run, private readonly note: (text: Msg) => void, private readonly record: (text: Msg) => void) {
    run.slots.onError = (err) => this.failed(err);
  }

  menuActions(world: () => World) {
    const saves = saveStore(this.run.slots, this.run.log, window.sessionStorage, world, this.run.runId, CONFIG.saveSlots);
    return {
      ...saves,
      save: (slot: SlotId) => this.saveManual(slot, saves.save),
      exportSave: () => this.exportSave(world()),
      exportLog: () => this.exportLog(world()).catch((err) => this.failed(err)),
    };
  }

  private saveManual(slot: SlotId, save: (slot: SlotId) => void): void {
    if (this.hold.held) return this.note(SAVE_HELD_NOTE);
    save(slot);
    this.record(t('save.savedTo', { slot: slotLabel(slot) }));
  }

  logWorld(world: World): void {
    this.run.log.note(world);
  }

  private exportSave(world: World): void {
    const envelope: SaveEnvelope = { ...saveOf(world), savedAt: Date.now(), runId: this.run.runId };
    download(`roam-save-turn-${world.turn}.json`, JSON.stringify(envelope), 'application/json');
  }

  private async exportLog(world: World): Promise<void> {
    const header = { kind: 'header', runId: this.run.runId, version: GAME_VERSION, seed: world.seed, mapHash: world.mapHash, exportedAt: Date.now() };
    download(`roam-run-${this.run.runId}.jsonl`, await this.run.log.lines(header), 'application/x-ndjson');
  }

  noteError(): void {
    this.hold.noteError();
  }

  beginTurn(): void {
    this.hold.beginTurn();
  }

  afterTurn(world: World): void {
    this.hold.finishTurn();
    if (this.hold.held) return;
    saveWorld(this.run.slots, world, this.run.runId, CONFIG.saveTurns, Date.now());
    saveOnArrival(this.run.slots, world, this.run.runId, Date.now());
  }

  changeMapIfMoved(world: World): boolean {
    this.moving ||= changeMapIfMoved(this.run, world, this.hold, window.sessionStorage, () => window.location.reload());
    return this.moving;
  }

  afterCommand(world: World): void {
    if (!this.hold.held) saveInTown(this.run.slots, world, this.run.runId, Date.now());
  }

  private failed(err: unknown): void {
    this.note(SAVE_FAILED_NOTE);
    reportError(err);
  }
}
