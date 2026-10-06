import { describe, expect, it } from 'vitest';
import { REGION, type TerritoryDef } from '../data/region';
import type { FarmRoad } from '../data/territory';
import { siteGap } from '../sim/sites';
import type { Vec } from '../sim/vec';
import { newDraft, type MapDraft } from './bake';
import { markRoads } from './marks';
import { BUILT_SCRUB, BUILT_TRACK } from './newworld';
import { tileOf } from './oldworld';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun') as TerritoryDef;
const at = (x: number, y: number): Vec => ({ x: fallenSun.pos.x + x, y: fallenSun.pos.y + y });
// A spur out of the north notch onto open land, from inside the outline to 8 tiles past it.
const SPUR: FarmRoad = { points: [at(-1.8, -33), at(-2.2, -45), at(-4.3, -53.5)], width: 2.5, surface: 'track' };
const END = SPUR.points.at(-1)!;

// Flat ground over the whole region, with no marks and no props.
function flatDraft(): MapDraft {
  return newDraft(REGION.size);
}

describe('road marks', () => {
  it('marks an inside road only inside its territory, and a spur past the edge too', () => {
    const inside = flatDraft();
    const spur = flatDraft();

    markRoads(inside, fallenSun, [{ ...SPUR, points: SPUR.points.slice(0, 2) }], 'inside');
    markRoads(spur, fallenSun, [SPUR], 'spur');

    const outsideTiles = (d: MapDraft) => [...d.built.keys()].filter((k) => d.built[k] === BUILT_TRACK && siteGap(fallenSun, { x: (k % d.size) + 0.5, y: Math.floor(k / d.size) + 0.5 }) >= 0);
    expect(outsideTiles(inside)).toEqual([]);
    expect(outsideTiles(spur).length).toBeGreaterThan(10);
    expect(spur.built[tileOf(spur.size, END)]).toBe(BUILT_TRACK);
  });

  it('wears scrub away under a spur', () => {
    const d = flatDraft();
    d.built[tileOf(d.size, END)] = BUILT_SCRUB;

    markRoads(d, fallenSun, [SPUR], 'spur');

    expect(d.built[tileOf(d.size, END)]).toBe(BUILT_TRACK);
  });

  it('throws on a spur over a cliff', () => {
    const d = flatDraft();
    const w = d.size + 1;
    // A step of 2 height units across the spur's outer end.
    for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) if (j < Math.round(END.y) + 1) d.heights[j * w + i] = 2;

    expect(() => markRoads(d, fallenSun, [SPUR], 'spur')).toThrow(/cliff/);
  });

  it('throws on a spur under an earlier prop', () => {
    const d = flatDraft();
    d.props.push({ kind: 'rock', pos: END, r: 1, yaw: 0, group: 0, step: 0 });

    expect(() => markRoads(d, fallenSun, [SPUR], 'spur')).toThrow(/under a rock/);
  });

  it('throws on a spur onto a region road', () => {
    const d = flatDraft();
    const road = REGION.roads.find((r) => siteGap(fallenSun, r.at(-1)!) < 0)!;
    const end = road.at(-2)!;

    expect(() => markRoads(d, fallenSun, [{ ...SPUR, points: [road.at(-1)!, { x: (road.at(-1)!.x + end.x) / 2, y: (road.at(-1)!.y + end.y) / 2 }] }], 'spur')).toThrow(/region road/);
  });
});
