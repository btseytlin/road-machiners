import { afterEach, describe, expect, it } from 'vitest';
import { TIME } from '../data/time';
import { setHeadless } from './fidelity';
import { heatAt, sunAt } from './sun';
import { addVehicle, emptyWorld } from './testkit';
import type { Vec } from './vec';
import { canVehicleSee } from './vision';
import type { World } from './types';

afterEach(() => setHeadless(false));

function rockBetween(w: World, at: Vec) {
  const watcher = addVehicle(w, 'raiders', 'buggy', [], at);
  w.obstacles = [{ id: 'rock', pos: { x: at.x + 4, y: at.y }, r: 1.2, kind: 'rock' }];
  return { watcher, spot: { x: at.x + 8, y: at.y } };
}

function lowSunTurn(): number {
  let best = 0;
  let low = Infinity;
  for (let turn = 1; turn <= TIME.turnsPerDay; turn++) {
    const sun = sunAt(turn);
    if (sun && sun.elevation < low) [best, low] = [turn, sun.elevation];
  }
  return best;
}

describe('cheap far rules', () => {
  it('lets a near watcher be blocked by a rock', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const { watcher, spot } = rockBetween(w, { x: 30, y: 40 });

    expect(canVehicleSee(w, watcher, spot)).toBe(false);
  });

  it('lets a far watcher see through the same rock', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const { watcher, spot } = rockBetween(w, { x: 200, y: 200 });

    expect(canVehicleSee(w, watcher, spot)).toBe(true);
  });

  it('still limits a far watcher to its sight radius', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const { watcher } = rockBetween(w, { x: 200, y: 200 });

    expect(canVehicleSee(w, watcher, { x: 200, y: 260 })).toBe(false);
  });

  it('treats a meeting beside the player as near when only one party is', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const { watcher } = rockBetween(w, { x: 30, y: 40 });

    expect(canVehicleSee(w, watcher, { x: 40, y: 40 })).toBe(false);
  });

  it('counts every truck as far in headless mode', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const { watcher, spot } = rockBetween(w, { x: 30, y: 40 });
    setHeadless(true);

    expect(canVehicleSee(w, watcher, spot)).toBe(true);
  });

  it('heats a far truck in the open sun and a near truck in the rock shade', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.turn = lowSunTurn();
    const sun = sunAt(w.turn);
    if (!sun) throw new Error('No sun at the low sun turn');
    const rockAt = (at: Vec) => ({ id: `rock-${at.x}`, pos: { x: at.x + 2 * sun.dir.x, y: at.y + 2 * sun.dir.y }, r: 1.2, kind: 'rock' as const });
    const near = { x: 30, y: 60 };
    const far = { x: 200, y: 200 };
    w.obstacles = [rockAt(near), rockAt(far)];

    expect(heatAt(w, near)).toBe(1);
    expect(heatAt(w, far)).toBeGreaterThan(1);
  });
});
