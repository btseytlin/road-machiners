import { describe, expect, it } from 'vitest';
import { SIDES } from './armor';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { toughness } from './fight-odds';
import { addVehicle, emptyWorld } from './testkit';
import type { Cell } from './grid';

const side = (name: (typeof SIDES)[number]) => SIDES.indexOf(name);

function vanWith(armor: { id: string; side: Cell; count: number }[]) {
  const w = emptyWorld();
  const v = addVehicle(w, 'traders', 'van', ['stockEngine'], { x: 30, y: 30 });
  for (const { id, side: at, count } of armor) for (let i = 0; i < count; i++) expect(mountPart(w, v, makePart(w, id, 0), [at])).toBe(true);
  return v;
}

describe('gear toughness', () => {
  it('takes more rounds to stop a truck from a plated side', () => {
    const bare = toughness(vanWith([]));
    const plated = toughness(vanWith([{ id: 'plates', side: 'F', count: 1 }]));
    expect(plated[side('front')]).toBeGreaterThan(bare[side('front')]);
    expect(plated[side('rear')]).toBeCloseTo(bare[side('rear')]);
  });

  // Flank plates sit in corner cells that front lanes also cross. Their wear must not count as the front armor's.
  it('never makes the front weaker when the flanks get plates', () => {
    const front = (v: ReturnType<typeof vanWith>) => toughness(v)[side('front')];
    const plated = vanWith([{ id: 'plates', side: 'F', count: 1 }]);
    const flanked = vanWith([{ id: 'plates', side: 'F', count: 1 }, { id: 'plates', side: 'L', count: 1 }, { id: 'plates', side: 'R', count: 1 }]);
    expect(front(flanked)).toBeGreaterThanOrEqual(front(plated) - 1e-9);
  });

  it('counts plates that stop rounds above cages that let them through', () => {
    const plates = toughness(vanWith([{ id: 'plates', side: 'F', count: 1 }]));
    const cages = toughness(vanWith([{ id: 'cage', side: 'F', count: 1 }]));
    expect(plates[side('front')]).toBeGreaterThan(cages[side('front')]);
  });
});
