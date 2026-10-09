import { describe, expect, it } from 'vitest';
import { TIME } from '../../data/time';
import { JobTally } from './job-checks';
import type { TurnLine } from './turn-log';

const line = (extra: Partial<TurnLine> = {}): TurnLine => ({ ev: [], ledger: {}, ...extra }) as TurnLine;

const SHOT = 'shot v1:player/scout>v71:buggy/niva p18 hits 1/6';

function play(tally: JobTally, archetype: Parameters<JobTally['failure']>[0], days: number, turn: () => TurnLine): string | null {
  let failure: string | null = null;
  for (let i = 0; i < days * TIME.turnsPerDay; i++) {
    tally.note(turn());
    failure ??= tally.failure(archetype);
  }
  return failure;
}

describe('JobTally', () => {
  it('fails a hunter that fires too few rounds a day', () => {
    const failure = play(new JobTally(), 'hunter', 3, () => line({ ev: [] }));
    expect(failure).toMatch(/hunter does not play its job: 0.0 rounds fired by the player per day over 3 days, floor 12/);
  });

  it('passes a hunter that fires enough rounds', () => {
    let turn = 0;
    const failure = play(new JobTally(), 'hunter', 5, () => line({ ev: turn++ % 20 === 0 ? [SHOT] : [] }));
    expect(failure).toBeNull();
  });

  it('counts only rounds of the player faction', () => {
    const failure = play(new JobTally(), 'hunter', 3, () => line({ ev: ['shot v7:raiders/van>v1:player/scout p9 hits 1/2'] }));
    expect(failure).not.toBeNull();
  });

  it('judges a trader by turns with a sale', () => {
    expect(play(new JobTally(), 'trader', 3, () => line())).toMatch(/turns with a sale/);
    let turn = 0;
    expect(play(new JobTally(), 'trader', 3, () => line({ ledger: turn++ % 200 === 0 ? { goodsSold: 90 } : {} }))).toBeNull();
  });

  it('gives a hauler five days before its contract money counts', () => {
    expect(play(new JobTally(), 'hauler', 4, () => line())).toBeNull();
    expect(play(new JobTally(), 'hauler', 5, () => line())).toMatch(/money from contracts/);
  });

  it('sets no floor for a bot that switches jobs', () => {
    expect(play(new JobTally(), 'climber', 5, () => line())).toBeNull();
    expect(play(new JobTally(), 'markov', 5, () => line())).toBeNull();
  });
});
