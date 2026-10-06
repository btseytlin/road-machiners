import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { templateStats } from './loadout-report';

// Averages over enough rolls to sit well inside a band unless the tables or the generator drift.
const ROLLS = 40;

describe('NPC loadout bands', () => {
  it.each(Object.keys(NPCS))('%s stays inside its gun and armor bands', (id) => {
    const { guns, armor } = NPCS[id].loadout.targets;
    const s = templateStats(id, ROLLS);
    expect(s.guns, 'guns').toBeGreaterThanOrEqual(guns[0]);
    expect(s.guns, 'guns').toBeLessThanOrEqual(guns[1]);
    expect(s.armor, 'armor').toBeGreaterThanOrEqual(armor[0]);
    // A fully armored template averages to 1 with float rounding on top.
    expect(s.armor, 'armor').toBeLessThanOrEqual(armor[1] + 1e-9);
  });
});
