import { describe, expect, it } from 'vitest';
import { SKILL_IDS } from '../../data/skills';
import { TIME } from '../../data/time';
import type { World } from '../types';
import { emptyWorld } from '../testkit';
import { record, recordFrom, recordTurns, StallWatch, type TraceLine } from './record';
import { replay } from './replay';

const SHORT_RUN = 60;
const DETERMINISM_RUN = 15;
const RUN_TIMEOUT = 120_000;

describe('record', () => {
  it('gives the same trace for the same seed and archetype', () => {
    const first = record(1337, 'trader', DETERMINISM_RUN);
    const second = record(1337, 'trader', DETERMINISM_RUN);

    expect(first.lines.length).toBeGreaterThan(0);
    expect(first.death).toBeNull();
    expect(second).toEqual(first);
  }, RUN_TIMEOUT);

  it('replays to the XP the world gave through practice', async () => {
    const lines: TraceLine[] = [];
    let last: World | null = null;
    for (const step of recordTurns(1337, 'scavenger', SHORT_RUN)) {
      lines.push(...step.lines);
      last = step.world;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!last) throw new Error('The recording ran no turns');
    const world = last;

    const curve = replay(lines, SHORT_RUN);

    for (const skill of SKILL_IDS) expect(curve[skill].total, skill).toBe(world.player.skills[skill]);
  }, RUN_TIMEOUT);
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
