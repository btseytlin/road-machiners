// The activity log of a progression run: everything the bot and the NPCs did, turn by turn, for a reader who checks a
// whole run for bugs and dull stretches. The record trace keeps only XP. This log keeps every game event, a snapshot of
// the player and every NPC at a fixed interval, how the run ended and a summary of counts.
// The run uses the recorder, so every truck travels far and a scripted bot drives the player. Close-range driving,
// physics crashes and choices the bot never makes do not happen in it, and the header says so.

import { SKILL_IDS } from '../../data/skills';
import { playerVehicle } from '../damage';
import { levelOf } from '../progress';
import type { DriverResources, GameEvent, NpcActivity, Vehicle, World } from '../types';
import { dist, type Vec } from '../vec';
import type { Archetype } from './bot';
import { stepsFrom, type RecordStep, type TurnEvent } from './record';

export const ACTIVITY_LIMITS = [
  'every truck travels in far mode, so no physics, close driving or crash contact runs',
  'a scripted bot plays the player and makes only the choices its archetype makes',
  'the run uses the test map',
];

export type RunHeader = { k: 'run'; seed: number; archetype: Archetype; turns: number; every: number; sha: string | null; limits: string[] };
export type EventLine = { k: 'event'; turn: number; e: GameEvent };
export type NpcSnapshot = {
  id: string; name: string; faction: string; template: string | null; pos: [number, number];
  goal: string | null; phase: string | null; target: string | null; reason: string | null;
  money: number | null; fuel: number | null; supplies: number | null; health: number | null; defeat: string | null;
};
export type PlayerSnapshot = {
  pos: [number, number]; state: string; money: number; fuel: number; supplies: number; health: number;
  xp: Record<string, number>; levels: Record<string, number>; contracts: number; discovered: number;
};
export type SnapshotLine = { k: 'snapshot'; turn: number; player: PlayerSnapshot; npcs: NpcSnapshot[] };
// complete: every turn ran. death: the player died. error: the turn pipeline threw or the player truck stalled.
export type EndLine = { k: 'end'; turn: number; reason: 'complete' | 'death' | 'error'; message: string | null };
export type SummaryLine = {
  k: 'summary'; turns: number; events: Record<string, number>; npcGoals: Record<string, number>; npcsSeen: number;
  shots: number; hits: number; destroyed: number; knockouts: number; deaths: number; stalls: number;
  moneyIn: number; moneyOut: number; xp: number; levels: Record<string, number>; playerTiles: number;
};
export type ActivityLine = RunHeader | EventLine | SnapshotLine | EndLine | SummaryLine;

export type ActivityOptions = { seed: number; archetype: Archetype; turns: number; every: number; sha: string | null };

const round = (n: number): number => Math.round(n * 10) / 10;

// Plays the run from start and yields the log lines as they happen: the header, then events and snapshots, then the
// end and the summary. A thrown turn ends the log with an error line instead of throwing, since the error is a finding.
export function* activityFrom(start: World, options: ActivityOptions): Generator<ActivityLine> {
  if (!Number.isInteger(options.every) || options.every <= 0) throw new Error(`The snapshot interval must be a positive whole number, got ${options.every}`);
  const play = new Play(start, options.every);
  yield { k: 'run', ...options, limits: ACTIVITY_LIMITS };
  yield snapshot(start);
  try {
    yield* play.turns(stepsFrom(start, `seed ${options.seed} ${options.archetype}`, options.archetype, options.turns));
  } catch (error) {
    play.fail(error);
  }
  yield* play.close();
}

// The state of a run between turns: the last world, the turn of the last snapshot, how it ended and the counts.
class Play {
  private world: World;
  private snapped: number;
  private end: EndLine | null = null;
  private readonly tally: Tally;

  constructor(private readonly start: World, private readonly every: number) {
    this.world = start;
    this.snapped = start.turn;
    this.tally = new Tally(start);
  }

  *turns(steps: Iterable<RecordStep>): Generator<ActivityLine> {
    for (const step of steps) {
      yield* this.step(step);
      if (this.end) return;
    }
  }

  private *step(step: RecordStep): Generator<ActivityLine> {
    for (const line of eventLines(step.events)) {
      this.tally.note(line.e);
      yield line;
    }
    this.tally.move(step.world);
    this.world = step.world;
    if (step.death) this.end = { k: 'end', turn: step.death.turn, reason: 'death', message: null };
    else if ((this.world.turn - this.start.turn) % this.every === 0) yield this.snap();
  }

  fail(error: unknown): void {
    this.end = { k: 'end', turn: this.world.turn, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }

  *close(): Generator<ActivityLine> {
    if (this.snapped !== this.world.turn) yield this.snap();
    yield this.end ?? { k: 'end', turn: this.world.turn, reason: 'complete', message: null };
    yield this.tally.summary(this.world, this.world.turn - this.start.turn);
  }

  private snap(): SnapshotLine {
    this.snapped = this.world.turn;
    return snapshot(this.world);
  }
}

// Debug info lines only show with the full log flag, so they stay out.
function eventLines(events: TurnEvent[]): EventLine[] {
  return events.filter(({ event }) => !(event.t === 'info' && event.debug)).map(({ turn, event }) => ({ k: 'event', turn, e: event }));
}

export function snapshot(world: World): SnapshotLine {
  const p = world.player;
  const me = playerVehicle(world);
  const player: PlayerSnapshot = {
    pos: at(me.pos), state: p.state, money: p.money, fuel: round(p.fuel), supplies: round(p.supplies), health: round(p.health),
    xp: { ...p.skills }, levels: levels(world), contracts: p.contracts.length, discovered: p.discovered.length,
  };
  return { k: 'snapshot', turn: world.turn, player, npcs: world.vehicles.filter((v) => v.id !== p.vehicleId).map(npcSnapshot) };
}

const at = (pos: Vec): [number, number] => [round(pos.x), round(pos.y)];

function levels(world: World): Record<string, number> {
  return Object.fromEntries(SKILL_IDS.map((skill) => [skill, levelOf(world.player.skills[skill])]));
}

function npcSnapshot(v: Vehicle): NpcSnapshot {
  const brain = v.brain;
  return {
    id: v.id, name: brain ? brain.driver : v.name, faction: v.faction, template: brain ? brain.templateId : null, pos: at(v.pos),
    ...goalOf(brain ? brain.goals.at(-1) : undefined), ...resourcesOf(v.resources), defeat: v.defeat ? v.defeat.phase : null,
  };
}

type GoalFields = Pick<NpcSnapshot, 'goal' | 'phase' | 'target' | 'reason'>;
function goalOf(goal: NpcActivity | undefined): GoalFields {
  if (!goal) return { goal: null, phase: null, target: null, reason: null };
  return { goal: goal.kind, phase: goal.phase, target: goal.targetId, reason: goal.reason };
}

type ResourceFields = Pick<NpcSnapshot, 'money' | 'fuel' | 'supplies' | 'health'>;
function resourcesOf(r: DriverResources | null): ResourceFields {
  if (!r) return { money: null, fuel: null, supplies: null, health: null };
  return { money: round(r.money), fuel: round(r.fuel), supplies: round(r.supplies), health: round(r.health) };
}

// What each event adds to the counts beyond its own type count.
const TALLIES: Partial<Record<GameEvent['t'], (tally: Tally, e: GameEvent) => void>> = {
  activity: (tally, e) => { if (e.t === 'activity' && e.activity) tally.count(tally.npcGoals, e.activity); },
  spawn: (tally, e) => { if (e.t === 'spawn') tally.seen.add(e.vehicle); },
  shot: (tally, e) => { if (e.t === 'shot') tally.shoot(e.rounds.filter((r) => r.hit).length); },
  money: (tally, e) => { if (e.t === 'money') tally.pay(e.amount); },
};

// Counts the run for the summary line, so a reader sees a quiet run or a missing kind of activity at a glance.
class Tally {
  readonly events: Record<string, number> = {};
  readonly npcGoals: Record<string, number> = {};
  readonly seen = new Set<string>();
  private shots = 0;
  private hits = 0;
  private moneyIn = 0;
  private moneyOut = 0;
  private tiles = 0;
  private last: Vec;

  constructor(start: World) {
    this.last = { ...playerVehicle(start).pos };
    for (const v of start.vehicles) this.seen.add(v.id);
  }

  note(e: GameEvent): void {
    this.count(this.events, e.t);
    TALLIES[e.t]?.(this, e);
  }

  count(into: Record<string, number>, key: string): void {
    into[key] = (into[key] ?? 0) + 1;
  }

  shoot(hits: number): void {
    this.shots++;
    this.hits += hits;
  }

  pay(amount: number): void {
    if (amount > 0) this.moneyIn += amount;
    else this.moneyOut -= amount;
  }

  move(world: World): void {
    const pos = playerVehicle(world).pos;
    this.tiles += dist(pos, this.last);
    this.last = { ...pos };
  }

  summary(world: World, turns: number): SummaryLine {
    const n = (t: string): number => this.events[t] ?? 0;
    return {
      k: 'summary', turns, events: this.events, npcGoals: this.npcGoals, npcsSeen: this.seen.size - 1,
      shots: this.shots, hits: this.hits, destroyed: n('destroyed'), knockouts: n('npcKnockout') + n('knockout'),
      deaths: n('death'), stalls: n('stall'), moneyIn: this.moneyIn, moneyOut: this.moneyOut,
      xp: SKILL_IDS.reduce((sum, skill) => sum + world.player.skills[skill], 0), levels: levels(world), playerTiles: Math.round(this.tiles),
    };
  }
}
