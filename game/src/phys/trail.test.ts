import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { dist } from '../sim/vec';
import { TURN_STEPS } from './drive';
import { trailOf } from './turn';

// Frames of a truck driving along +x at `speed` tiles per physics step, in physics meters (4 per tile).
function straight(speed: number) {
  return Array.from({ length: TURN_STEPS }, (_, k) => ({ pos: { x: (k + 1) * speed * 4, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, wheels: [] }));
}

describe('physics trails', () => {
  it('are evenly timed on a straight at constant speed', () => {
    const frames = straight(0.07) as unknown as Parameters<typeof trailOf>[1];
    const trail = trailOf({ x: 0, y: 0, heading: 0 }, frames);
    expect(trail).toHaveLength(RULES.substeps + 1);
    const first = dist(trail[0], trail[1]);
    for (let i = 1; i < trail.length; i++) expect(dist(trail[i - 1], trail[i])).toBeCloseTo(first, 6);
  });

  it('start at the start pose and end at the last frame', () => {
    const frames = straight(0.07) as unknown as Parameters<typeof trailOf>[1];
    const trail = trailOf({ x: 0, y: 0, heading: 0 }, frames);
    expect(trail[0]).toEqual({ x: 0, y: 0, heading: 0 });
    expect(trail[trail.length - 1].x).toBeCloseTo(TURN_STEPS * 0.07, 9);
  });
});
