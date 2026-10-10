import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { formatLoadoutReport, templateStats } from './loadout-report';

const ROLLS = 10;

describe('NPC loadout report', () => {
  it.each(Object.keys(NPCS))('%s reports sane numbers', (id) => {
    const s = templateStats(id, ROLLS);
    expect(s.guns, 'guns').toBeGreaterThan(0);
    expect(s.armor, 'armor').toBeGreaterThanOrEqual(0);
    expect(s.armor, 'armor').toBeLessThanOrEqual(1 + 1e-9);
    expect(s.speed, 'speed kept').toBeGreaterThan(0);
    expect(s.speed, 'speed kept').toBeLessThanOrEqual(2);
    expect(s.spent, 'gear money spent').toBeGreaterThan(0);
  });

  it('prints one row per template', () => {
    const ids = Object.keys(NPCS);
    const text = formatLoadoutReport(ids.map((id) => templateStats(id, 3)));
    for (const id of ids) expect(text).toContain(`| ${id} |`);
  });
});
