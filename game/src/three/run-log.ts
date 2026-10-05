// The run log: what happened to the player over a run, for analysis after the fact. It records outcomes, not a
// replay, and never feeds the sim. Each entry reads on its own, with names and kinds where the world has only ids.

import { playerVehicle } from '../sim/damage';
import { mountedItems } from '../sim/grid';
import { clockOf } from '../sim/sun';
import type { GameEvent, GridItem, Vehicle, World } from '../sim/types';
import { partValue } from '../sim/wear';
import type { LogEntry, SaveBackend } from './save-db';
import type { SlotId } from './save-slots';

// An entry before it gets its turn and day.
type Body = { kind: string } & Record<string, unknown>;

// Event kinds the log keeps. Shots, spawns, NPC moves, talk and weather stay out, since they say little about the
// player's run and would bury what does. XP shows in the day snapshot, so practice stays out too.
const KEPT = new Set<GameEvent['t']>([
  'death', 'knockout', 'wake', 'money', 'contract', 'discover', 'skillUp', 'scrapPatch', 'townPatch', 'searched', 'supply',
  'destroyed', 'npcKnockout', 'partDisabled', 'hostile', 'arrived', 'towDone', 'escortPaid', 'escortHired', 'aid',
  'breakdown', 'job', 'plea',
]);

// Event fields that hold a vehicle id.
const VEHICLE_FIELDS = ['vehicle', 'by', 'against', 'client', 'giver', 'receiver', 'from', 'to'] as const;

// Kinds that name the player's truck in no field. They happen to the player by nature.
const PLAYER_KINDS = new Set<GameEvent['t']>(['death', 'knockout', 'wake', 'money', 'contract', 'discover', 'skillUp', 'scrapPatch', 'townPatch', 'searched', 'supply']);

// The entries a new world adds to the log: the kept events of the player, what the player gained and lost since the
// last world, and a snapshot on the first world of each game day. prev is null for the first world of a session.
// withEvents is false when the log has seen next's events already, in an earlier world that shared them.
export function logEntries(prev: World | null, next: World, withEvents: boolean): LogEntry[] {
  const at = { turn: next.turn, day: clockOf(next.turn).day };
  const events = withEvents ? next.events.filter((e) => keeps(next, e)).map((e) => eventEntry(prev, next, e)) : [];
  const bodies = [...events, changeEntry(prev, next), dayEntry(prev, next)];
  return bodies.flatMap((body) => body ? [{ ...at, ...body }] : []);
}

function dayEntry(prev: World | null, next: World): Body | null {
  return !prev || clockOf(prev.turn).day !== clockOf(next.turn).day ? snapshot(next) : null;
}

function keeps(world: World, e: GameEvent): boolean {
  if (!KEPT.has(e.t)) return false;
  return PLAYER_KINDS.has(e.t) || vehicleIds(e).includes(world.player.vehicleId);
}

function vehicleIds(e: GameEvent): string[] {
  const fields = e as unknown as Record<string, unknown>;
  return VEHICLE_FIELDS.flatMap((f) => typeof fields[f] === 'string' ? [fields[f] as string] : []);
}

// The event with the name, faction and chassis of every truck it names. A truck gone from both worlds is unknown.
function eventEntry(prev: World | null, next: World, e: GameEvent): Body {
  const known = [...next.vehicles, ...next.removed, ...(prev?.vehicles ?? [])];
  const trucks = Object.fromEntries(vehicleIds(e).map((id) => [id, truckOf(known.find((v) => v.id === id))]));
  const { t, ...rest } = e;
  return { kind: 'event', event: t, ...rest, trucks };
}

function truckOf(v: Vehicle | undefined): { name: string; faction: string; chassis: string } | null {
  return v ? { name: v.name, faction: v.faction, chassis: v.chassisId } : null;
}

// Money and the things the player holds, as they changed between two worlds. Buys, sales, loot and refits have no
// event, so this is where they show. Null when nothing changed.
function changeEntry(prev: World | null, next: World): Body | null {
  if (!prev) return null;
  const before = holdings(prev);
  const after = holdings(next);
  const money = next.player.money - prev.player.money;
  const gained = difference(after, before);
  const lost = difference(before, after);
  if (money === 0 && gained.length === 0 && lost.length === 0) return null;
  return { kind: 'change', money, gained, lost };
}

// Every part and good the player has, on the truck or in town storage, by id.
function holdings(world: World): string[] {
  const items = playerVehicle(world).items.map(itemId);
  return [...items, ...world.player.storage.map((p) => p.defId)].sort();
}

function itemId(item: GridItem): string {
  return item.kind === 'part' ? item.part.defId : item.good;
}

// What a holds beyond b, counting repeats.
function difference(a: readonly string[], b: readonly string[]): string[] {
  const left = [...b];
  return a.filter((id) => {
    const i = left.indexOf(id);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

function snapshot(world: World): Body {
  const p = world.player;
  const truck = playerVehicle(world);
  const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0));
  return {
    kind: 'day',
    money: p.money,
    xp: p.xp,
    ranks: p.ranks,
    xpBySource: p.xpBySource,
    perks: p.perks,
    chassis: truck.chassisId,
    mountedValue: sum(mountedItems(truck).map((it) => partValue(it.part))),
    storageValue: sum(p.storage.map(partValue)),
    health: p.health,
    fuel: p.fuel,
    supplies: p.supplies,
    knockouts: p.knockouts,
  };
}

// The log of one run in one session. It writes entries in the background, and the backend numbers them. One turn can
// reach the game in more than one world, and a world built by spreading another shares its events array, so the log
// writes a world once and an events array once. It still compares every new world with the last one.
export class RunLog {
  private seenWorlds = new WeakSet<World>();
  private seenEvents = new WeakSet<GameEvent[]>();
  private last: World | null = null;
  private pending = new Set<Promise<void>>();

  constructor(private backend: SaveBackend, readonly runId: string, private onError: (err: unknown) => void) {}

  // The first world of the session. A load notes the slot and turn, so analysis can cut the abandoned future.
  begin(world: World, loadedFrom: SlotId | null): void {
    const at = { turn: world.turn, day: clockOf(world.turn).day };
    const start: LogEntry = loadedFrom ? { ...at, kind: 'loaded', slot: loadedFrom } : { ...at, kind: 'start', seed: world.seed };
    this.write([start, ...this.entriesOf(world)]);
  }

  note(world: World): void {
    if (!this.seenWorlds.has(world)) this.write(this.entriesOf(world));
  }

  // Resolves once every write made so far has landed or failed.
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  private entriesOf(world: World): LogEntry[] {
    const withEvents = !this.seenEvents.has(world.events);
    this.seenWorlds.add(world);
    this.seenEvents.add(world.events);
    const entries = logEntries(this.last, world, withEvents);
    this.last = world;
    return entries;
  }

  // The run as JSON Lines: the header, then one record per line.
  async lines(header: Record<string, unknown>): Promise<string> {
    const records = await this.backend.readLog(this.runId);
    return [header, ...records].map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  private write(entries: LogEntry[]): void {
    if (entries.length === 0) return;
    const done = this.backend.appendLog(this.runId, entries).catch(this.onError).finally(() => this.pending.delete(done));
    this.pending.add(done);
  }
}
