import { describe, expect, it } from 'vitest';
import { PlayClock } from './play-clock';

const EASE = 100;

function frame(clock: PlayClock, run: (c: PlayClock) => void): number {
  clock.beginFrame();
  run(clock);
  return clock.frameMs();
}

describe('PlayClock', () => {
  it('follows playback time exactly while a turn plays', () => {
    const clock = new PlayClock(EASE);
    expect(frame(clock, (c) => (c.advance(16), c.coast(16, true, 1)))).toBe(16);
    expect(frame(clock, (c) => (c.advance(32), c.coast(16, true, 2)))).toBe(32);
    expect(clock.nowMs()).toBe(48);
  });

  it('stands still when no turn plays or is wanted', () => {
    const clock = new PlayClock(EASE);
    expect(frame(clock, (c) => c.coast(16, false, 1))).toBe(0);
    expect(clock.nowMs()).toBe(0);
  });

  it('slows to a stop after a turn instead of halting', () => {
    const clock = new PlayClock(EASE);
    frame(clock, (c) => c.advance(16));
    const tail = [1, 2, 3, 4, 5, 6, 7].map(() => frame(clock, (c) => c.coast(20, false, 1)));
    expect(tail[0]).toBeGreaterThan(tail[2]);
    expect(tail[2]).toBeGreaterThan(0);
    expect(tail.slice(5)).toEqual([0, 0]);
  });

  it('speeds up while the next turn is wanted, before it plays', () => {
    const clock = new PlayClock(EASE);
    const lead = [1, 2, 3].map(() => frame(clock, (c) => c.coast(20, true, 1)));
    expect(lead[0]).toBeGreaterThan(0);
    expect(lead[1]).toBeGreaterThan(lead[0]);
    expect(lead[2]).toBeLessThanOrEqual(20);
  });

  it('refuses time running backward', () => {
    expect(() => new PlayClock(EASE).advance(-1)).toThrow();
  });
});
