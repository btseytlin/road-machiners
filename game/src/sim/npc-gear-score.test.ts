import { describe, expect, it } from 'vitest';
import { SIDES } from './armor';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { toughness } from './fight-odds';
import { gearScorer } from './npc-gear-score';
import type { LoadoutPriorities } from '../data/npcs';
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

describe('gear score', () => {
  const priorities = (change: Partial<LoadoutPriorities>): LoadoutPriorities => ({ speed: 0, firepower: 0, armor: 0, cargo: 0, ...change });
  const scorer = (p: LoadoutPriorities) => {
    const w = emptyWorld();
    return { w, score: gearScorer(w, p, vanWith([])) };
  };

  it('scores armor higher when the armor priority is set', () => {
    const { score } = scorer(priorities({ armor: 3 }));
    expect(score(vanWith([{ id: 'plates', side: 'F', count: 1 }]))).toBeGreaterThan(score(vanWith([])));
  });

  it('scores armor of a better quality higher on the same side', () => {
    const { score } = scorer(priorities({ armor: 3 }));
    expect(score(vanWith([{ id: 'plates', side: 'F', count: 1 }]))).toBeGreaterThan(score(vanWith([{ id: 'cage', side: 'F', count: 1 }])));
  });

  it('scores armor at nothing when the armor priority is zero', () => {
    const { score } = scorer(priorities({ firepower: 3 }));
    expect(score(vanWith([{ id: 'plates', side: 'F', count: 1 }]))).toBeCloseTo(score(vanWith([])));
  });

  it('scores a gun higher with firepower priority and lower with only the speed priority', () => {
    const armed = () => {
      const v = vanWith([]);
      expect(mountPart(emptyWorld(), v, makePart(emptyWorld(), 'mg', 0))).toBe(true);
      return v;
    };
    expect(scorer(priorities({ firepower: 3 })).score(armed())).toBeGreaterThan(scorer(priorities({ firepower: 3 })).score(vanWith([])));
    expect(scorer(priorities({ speed: 3 })).score(armed())).toBeLessThan(scorer(priorities({ speed: 3 })).score(vanWith([])));
  });
});
