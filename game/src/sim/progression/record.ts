// The progression recorder. It plays a bot in the player truck through the real turn pipeline, with every truck on
// far travel, so no physics runs and nothing crashes. Each practice event becomes a trace line. The player starts
// with no XP, so the trace holds every XP the run gives.

import { startKit } from '../../data/start';
import { TIME } from '../../data/time';
import { playerVehicle } from '../damage';
import { advanceFar } from '../far';
import { isTowed } from '../tow';
import type { GameEvent, World, XpSource } from '../types';
import { dist, type Vec } from '../vec';
import { endTurn, newWorld, update } from '../world';
import { botOrders, parkedOnPurpose, type Archetype } from './bot';
import { TEST_MAP } from '../../test/map';

// One practice event. turn is the world turn it happened on; a run of N turns ends on world turn N + 1.
export type TraceLine = { turn: number; source: XpSource; amount: number; difficulty: number | null; target: string };
// The last entry of a run the player did not survive. turn is the world turn the player died on.
export type RunEnd = { end: 'death'; turn: number };
// One game event and the world turn it happened on.
export type TurnEvent = { turn: number; event: GameEvent };
// death is set on the last step of a run the player did not survive. events holds every event of the turn, the bot's
// commands first.
export type RecordStep = { world: World; lines: TraceLine[]; events: TurnEvent[]; death: RunEnd | null };
export type Recording = { lines: TraceLine[]; death: RunEnd | null };

// A truck that moves less than this many tiles in a whole in-game day, while not parked on purpose, has stalled.
const STALL_TILES = 1;

export function record(seed: number, archetype: Archetype, turns: number): Recording {
  return recordFrom(startWorld(seed), `seed ${seed} ${archetype}`, archetype, turns);
}

// Records from a given world. label names the run in errors.
export function recordFrom(start: World, label: string, archetype: Archetype, turns: number): Recording {
  const recording: Recording = { lines: [], death: null };
  for (const step of stepsFrom(start, label, archetype, turns)) {
    recording.lines.push(...step.lines);
    recording.death = step.death;
  }
  return recording;
}

// Plays the turns one at a time and yields each turn's world and trace lines, so a caller can write as it goes.
export function recordTurns(seed: number, archetype: Archetype, turns: number): Generator<RecordStep> {
  return stepsFrom(startWorld(seed), `seed ${seed} ${archetype}`, archetype, turns);
}

// The player's death ends the run early, since no turn runs after it. A stall or any other error fails loud.
export function* stepsFrom(start: World, label: string, archetype: Archetype, turns: number): Generator<RecordStep> {
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`A recording needs a positive whole number of turns, got ${turns}`);
  let world = start;
  const watch = new StallWatch(label, world.turn, playerVehicle(world).pos);
  for (let i = 0; i < turns; i++) {
    const before = world;
    const { next, lines, events } = inContext(label, before, () => playTurn(before, archetype));
    world = next;
    if (world.player.state === 'dead') {
      yield { world, lines, events, death: { end: 'death', turn: world.turn } };
      return;
    }
    watch.note(world.turn, playerVehicle(world).pos, parkedOnPurpose(world));
    yield { world, lines, events, death: null };
  }
}

export function startWorld(seed: number): World {
  return update(newWorld(seed, startKit('standard'), TEST_MAP), (w) => {
    const p = w.player;
    for (const skill of Object.keys(p.skills) as (keyof typeof p.skills)[]) {
      p.skills[skill] = 0;
      p.xpToday[skill] = 0;
    }
    for (const source of Object.keys(p.xpBySource) as XpSource[]) p.xpBySource[source] = 0;
    p.xpDay = 1;
  });
}

function playTurn(world: World, archetype: Archetype): { next: World; lines: TraceLine[]; events: TurnEvent[] } {
  const orders = botOrders(world, archetype);
  const next = endTurn(orders.world, moveAllFar);
  const events = [...orders.events.map((event) => ({ turn: orders.world.turn, event })), ...next.events.map((event) => ({ turn: next.turn, event }))];
  return { next, lines: [...traceOf(orders.events, orders.world.turn), ...traceOf(next.events, next.turn)], events };
}

// Adds the seed, archetype, turn and truck position to any error of the turn.
function inContext<T>(label: string, world: World, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const pos = playerVehicle(world).pos;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} at turn ${world.turn} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}): ${message}`, { cause: error });
  }
}

// The movement step: every truck travels far. A towed player follows its tower in the pipeline instead.
function moveAllFar(w: World): void {
  const towed = isTowed(w);
  for (const v of w.vehicles) if (!(towed && v.id === w.player.vehicleId)) advanceFar(w, v);
}

function traceOf(events: GameEvent[], turn: number): TraceLine[] {
  return events.flatMap((e) => (e.t === 'practice' ? [{ turn, source: e.source, amount: e.amount, difficulty: e.difficulty, target: e.target }] : []));
}

// Fails loud when the player truck stays within STALL_TILES of one point for a whole in-game day. A turn parked on
// purpose starts the day over.
export class StallWatch {
  private anchor: { turn: number; pos: Vec };

  constructor(private readonly label: string, turn: number, pos: Vec) {
    this.anchor = { turn, pos: { ...pos } };
  }

  note(turn: number, pos: Vec, onPurpose: boolean): void {
    if (onPurpose || dist(pos, this.anchor.pos) >= STALL_TILES) {
      this.anchor = { turn, pos: { ...pos } };
      return;
    }
    if (turn - this.anchor.turn < TIME.turnsPerDay) return;
    const at = `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`;
    throw new Error(`${this.label}: the player truck stalled at turn ${turn} at ${at}; it moved under ${STALL_TILES} tile since turn ${this.anchor.turn}`);
  }
}
