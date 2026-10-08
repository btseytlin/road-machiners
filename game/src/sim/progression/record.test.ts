import { describe, expect, it } from 'vitest';
import { RANK_COSTS, SKILL_IDS, XP_SOURCES } from '../../data/skills';
import { START_KITS } from '../../data/start';
import { TIME } from '../../data/time';
import type { World, XpSource } from '../types';
import { cumulativeCost } from '../progress';
import { playerVehicle } from '../damage';
import { emptyWorld } from '../testkit';
import { record, recordFrom, recordTurns, StallWatch, stepsFrom, type TraceLine } from './record';
import { replay } from './replay';

const SHORT_RUN = 60;
// A nondeterminism bug (stray Math.random, object-identity leaks, iteration-order drift) shows up within a
// handful of turns; it does not need thousands to surface. Short enough to keep this check cheap, long enough
// to have run through several bot decisions.
const DETERMINISM_RUN = 15;
const RUN_TIMEOUT = 360_000; // one world turn takes about 40 ms and a new world about 400 ms; a loaded machine running the whole suite made the 60-turn run take over 120 s

describe('record', () => {
  it('gives the same trace for the same seed and archetype', async () => {
    const first = record(1337, 'trader', DETERMINISM_RUN);
    // Each run takes about half a minute on a loaded machine, so the worker's status messages get a turn between them.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = record(1337, 'trader', DETERMINISM_RUN);

    expect(first.lines.length).toBeGreaterThan(0);
    expect(first.death).toBeNull();
    expect(second).toEqual(first);
  }, RUN_TIMEOUT);

  it('starts in a Roaming world with the given settings, the missing ones at their defaults', () => {
    const first = recordTurns(1337, 'trader', 1, { settings: { damage: 2, fuelUse: 1.5 } }).next();

    expect(first.done).toBe(false);
    expect(first.value?.world.setup).toEqual({ mode: 'roaming', settings: { damage: 2, fuelUse: 1.5, supplyUse: 1 } });
  }, RUN_TIMEOUT);

  it('fails a run with a bad setting before it plays', () => {
    expect(() => recordTurns(1337, 'trader', 1, { settings: { damage: 9 } }).next()).toThrow(/damage/);
    expect(() => recordTurns(1337, 'trader', 1, { settings: { speed: 1 } }).next()).toThrow(/speed/);
  }, RUN_TIMEOUT);

  it('replays to the XP the world gave through practice', async () => {
    const lines: TraceLine[] = [];
    let last: World | null = null;
    for (const step of recordTurns(1337, 'scavenger', SHORT_RUN)) {
      lines.push(...step.lines);
      last = step.world;
      // A minute of turns without a yield would starve the worker's status messages to the runner.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!last) throw new Error('The recording ran no turns');
    const world = last;

    const curve = replay(lines, SHORT_RUN);

    for (const skill of SKILL_IDS) {
      const bySource = (Object.keys(XP_SOURCES) as XpSource[]).filter((s) => XP_SOURCES[s].skill === skill).reduce((sum, s) => sum + world.player.xpBySource[s], 0);
      expect(curve[skill].total, skill).toBeCloseTo(bySource, 6);
    }
    // The recorder buys ranks from the pool as it fills, so the XP earned is what is left plus what ranks cost.
    const pool = SKILL_IDS.reduce((sum, skill) => sum + curve[skill].total, 0);
    const spent = SKILL_IDS.reduce((sum, skill) => sum + cumulativeCost(world.player.ranks[skill]), 0);
    expect(pool).toBeCloseTo(world.player.xp + spent, 6);
  }, RUN_TIMEOUT);

  it('starts the hunter on the snowball kit and the others on the standard kit unless a kit is named', () => {
    const chassisOf = (archetype: 'hunter' | 'trader', kit?: string): string => {
      const [step] = recordTurns(1337, archetype, 1, kit === undefined ? {} : { kit });
      return playerVehicle(step.world).chassisId;
    };

    expect(chassisOf('hunter')).toBe(START_KITS.snowball.chassis);
    expect(chassisOf('trader')).toBe(START_KITS.standard.chassis);
    expect(chassisOf('hunter', 'standard')).toBe(START_KITS.standard.chassis);
  }, RUN_TIMEOUT);
});

describe('record with a pool to spend', () => {
  it('buys the ranks the pool pays for before the bot plays the turn', () => {
    const start = emptyWorld();
    start.player.xp = RANK_COSTS[0];

    const [step] = [...stepsFrom(start, 'saver', 'trader', 1)];

    expect(step.world.player.ranks).toEqual({ ...start.player.ranks, driving: 1 });
    expect(step.world.player.xp).toBeLessThan(RANK_COSTS[0]);
  });
});

describe('record at the player\'s death', () => {
  it('ends the run on the death turn and keeps the trace so far', () => {
    const start = emptyWorld();
    start.player.health = 0;

    const recording = recordFrom(start, 'dying driver', 'trader', 10);

    const deathTurn = start.turn + 1;
    expect(recording.death).toEqual({ end: 'death', turn: deathTurn });
    expect(recording.lines.every((line) => line.turn <= deathTurn)).toBe(true);
  });
});

describe('StallWatch', () => {
  const start = { x: 10, y: 10 };

  it('throws once the truck stays within a tile for a whole day', () => {
    const watch = new StallWatch('seed 7 trader', 1, start);
    for (let turn = 2; turn < 1 + TIME.turnsPerDay; turn++) watch.note(turn, { x: 10.5, y: 10 }, false);

    expect(() => watch.note(1 + TIME.turnsPerDay, { x: 10.5, y: 10 }, false)).toThrow(new RegExp(`seed 7 trader.*turn ${1 + TIME.turnsPerDay}.*10\\.5, 10`));
  });

  it('starts the day over when the truck moves a tile', () => {
    const watch = new StallWatch('seed 7 trader', 1, start);
    watch.note(100, { x: 11, y: 10 }, false);

    expect(() => watch.note(1 + TIME.turnsPerDay, { x: 11, y: 10 }, false)).not.toThrow();
  });

  it('does not count turns parked on purpose', () => {
    const watch = new StallWatch('seed 7 trader', 1, start);
    watch.note(150, start, true);

    expect(() => watch.note(1 + TIME.turnsPerDay, start, false)).not.toThrow();
  });
});
