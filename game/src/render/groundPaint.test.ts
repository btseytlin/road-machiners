import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import type { TerrainTypeId } from '../data/terrain';
import { desertWeight, groundDiscs } from './groundPaint';

describe('desertWeight', () => {
  it('keeps farmland, old highways, hull plating, pools and the orchard marks out of the warm sand and its patches', () => {
    const kept: TerrainTypeId[] = ['field', 'asphalt', 'ash', 'saltCrust', 'mud', 'dirtyWater', 'toxic', 'hull', 'track', 'canal', 'concrete'];
    for (const type of kept) expect(desertWeight(type), type).toBe(0);
  });
});

describe('ground discs', () => {
  it('paints the Fallen Sun its disc and the outlined Old Orchard none', () => {
    const ids = groundDiscs().map((d) => d.id);
    expect(ids).toContain('fallen-sun');
    expect(ids).not.toContain('orchard');
    const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    expect(groundDiscs().find((d) => d.id === 'fallen-sun')!.radius).toBe(sun.radius + 0.5);
  });
});
