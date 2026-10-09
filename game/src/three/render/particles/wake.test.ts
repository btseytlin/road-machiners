import { describe, expect, it } from 'vitest';
import { newWake, stepWake, WAKE_LOOK, WakeTracker, type WakeMover, type WakeSpot, type WakeState } from './wake';

const EAST: WakeMover = { x: 0, z: 0, vx: 6, vz: 0 };
const spot = (x: number, z: number, height = 1): WakeSpot => ({ x, z, height });

function run(state: WakeState, home: WakeSpot, movers: WakeMover[], seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) stepWake(state, home, 1, movers, 0.05);
}

describe('stepWake', () => {
  it('pushes a puff in front of the truck out to the side', () => {
    const s = newWake();
    run(s, spot(2, 0.5), [EAST], 0.3);
    expect(s.oz).toBeGreaterThan(0.05);
  });

  it('pushes the two sides of the path apart', () => {
    const left = newWake();
    const right = newWake();
    run(left, spot(1, 1), [EAST], 0.3);
    run(right, spot(1, -1), [EAST], 0.3);
    expect(left.oz).toBeGreaterThan(0);
    expect(right.oz).toBeLessThan(0);
  });

  it('pulls a puff behind the truck along with a share of its velocity', () => {
    const s = newWake();
    run(s, spot(-1.5, 0.3), [EAST], 0.5);
    expect(s.ux).toBeGreaterThan(0.5);
    expect(s.ux).toBeLessThan(EAST.vx);
  });

  it('leaves a far puff, a slow truck and a high puff alone', () => {
    const far = newWake();
    const slow = newWake();
    const high = newWake();
    run(far, spot(WAKE_LOOK.reach + 1, 0), [EAST], 1);
    run(slow, spot(1, 0.5), [{ ...EAST, vx: 0.1 }], 1);
    run(high, spot(1, 0.5, WAKE_LOOK.top + WAKE_LOOK.fadeHeight), [EAST], 1);
    for (const s of [far, slow, high]) expect(s).toEqual(newWake());
  });

  it('drifts back home after the truck is gone', () => {
    const s = newWake();
    run(s, spot(1, 0.5), [EAST], 0.6);
    const pushed = Math.hypot(s.ox, s.oz);
    run(s, spot(1, 0.5), [], 30);
    expect(pushed).toBeGreaterThan(0.3);
    expect(Math.hypot(s.ox, s.oz)).toBeLessThan(pushed * 0.1);
  });

  it('keeps the offset inside the maximum and ignores a zero step', () => {
    const s = newWake();
    run(s, spot(0.5, 0.2), [{ x: 0, z: 0, vx: 60, vz: 0 }], 5);
    expect(Math.hypot(s.ox, s.oz)).toBeLessThanOrEqual(WAKE_LOOK.maxOffset + 1e-9);
    const before = { ...s };
    stepWake(s, spot(1, 0), 1, [EAST], 0);
    expect(s).toEqual(before);
  });
});

describe('WakeTracker', () => {
  const at = (x: number) => new Map([['a', { x, z: 0 }]]);

  it('derives velocity from position change over play time', () => {
    const t = new WakeTracker();
    let last = t.update(at(0), 0);
    for (let i = 1; i <= 40; i++) last = t.update(at(i * 0.1), i * 100);
    expect(last.movers[0].vx).toBeCloseTo(1, 1);
    expect(last.dt).toBeCloseTo(0.1, 5);
  });

  it('holds still when the play clock does not advance', () => {
    const t = new WakeTracker();
    t.update(at(0), 0);
    for (let i = 1; i <= 20; i++) t.update(at(i * 0.1), i * 100);
    const moving = t.update(at(2), 2000).movers[0].vx;
    const stopped = t.update(at(5), 2000);
    expect(stopped.dt).toBe(0);
    expect(stopped.movers[0].vx).toBe(moving);
  });

  it('reads a jump as a teleport and forgets removed vehicles', () => {
    const t = new WakeTracker();
    t.update(at(0), 0);
    expect(t.update(at(500), 100).movers[0].vx).toBe(0);
    expect(t.update(new Map(), 200).movers).toEqual([]);
  });
});
