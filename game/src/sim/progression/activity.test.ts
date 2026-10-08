import { describe, expect, it } from 'vitest';
import { emptyWorld } from '../testkit';
import { activityFrom, type ActivityLine, type EndLine, type SummaryLine } from './activity';
import { startWorld } from './record';

const SHORT_RUN = 12;
const RUN_TIMEOUT = 120_000;

const run = (start = startWorld(1337), turns = SHORT_RUN, every = 5): ActivityLine[] =>
  [...activityFrom(start, { seed: 1337, archetype: 'mixed', turns, every, sha: 'abc1234' })];

describe('activityFrom', () => {
  it('logs the run header, events in turn order, snapshots, the end and a summary', () => {
    const lines = run();

    expect(lines[0]).toMatchObject({ k: 'run', seed: 1337, archetype: 'mixed', turns: SHORT_RUN, every: 5, sha: 'abc1234' });
    expect((lines[0] as { limits: string[] }).limits.join(' ')).toMatch(/far mode/);
    const turns = lines.filter((line) => line.k === 'event').map((line) => line.turn);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
    const snapshots = lines.filter((line) => line.k === 'snapshot');
    expect(snapshots.map((line) => line.turn)).toEqual([1, 6, 11, 13]);
    expect(snapshots[0].npcs.length).toBeGreaterThan(0);
    expect(snapshots[0].npcs[0]).toHaveProperty('goal');
    const end = lines.at(-2) as EndLine;
    expect(end).toEqual({ k: 'end', turn: 1 + SHORT_RUN, reason: 'complete', message: null });
    const summary = lines.at(-1) as SummaryLine;
    expect(summary.k).toBe('summary');
    expect(summary.turns).toBe(SHORT_RUN);
    expect(Object.values(summary.events).reduce((a, b) => a + b, 0)).toBe(turns.length);
  }, RUN_TIMEOUT);

  it('gives the same log for the same seed', () => {
    expect(run()).toEqual(run());
  }, RUN_TIMEOUT);

  it('ends with a death line when the player dies', () => {
    const start = emptyWorld();
    start.player.health = 0;

    const lines = run(start, 10);

    expect(lines.at(-2)).toEqual({ k: 'end', turn: start.turn + 1, reason: 'death', message: null });
  });

  it('ends with an error line instead of throwing when a turn fails', () => {
    const start = emptyWorld();
    start.vehicles[0].chassisId = 'no-such-chassis';

    const lines = run(start, 10);

    const end = lines.at(-2) as EndLine;
    expect(end.reason).toBe('error');
    expect(end.message).toMatch(/at turn/);
    expect(lines.at(-1)).toMatchObject({ k: 'summary' });
  });

  it('refuses a snapshot interval that is not a positive whole number', () => {
    expect(() => run(startWorld(1), 1, 0)).toThrow(/interval/);
  });
});
