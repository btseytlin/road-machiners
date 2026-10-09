import { describe, it } from 'vitest';

describe('a job queue', () => {
  it('spins forever without yielding', () => {
    let turns = 0;
    while (turns >= 0) turns += 1;
  });
});
