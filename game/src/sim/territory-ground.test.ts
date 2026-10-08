import { defaultSetup } from './settings';
import { describe, expect, it } from 'vitest';
import { REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { blockingBoxes } from './mapgen';
import { siteGap } from './sites';
import { heightAt } from './terrain';
import type { Obstacle } from './types';
import type { Vec } from './vec';
import { newWorld } from './world';

// The ground under Old Orchard's props on the committed map: nothing the farm stands floats over a slope or sinks
// into one.
const orchard = REGION.locations.find((l) => l.id === 'orchard') as TerritoryDef;
const RELIEF = 0.1; // height units (0.4 m) a blocking box corner's ground may lie off the prop's seat
const world = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
// Dead trees stand on a trunk and rocks sit in the ground, so their boxes may overhang a slope.
const props = world.obstacles.filter((o) => o.kind === 'landmark' && o.look !== 'deadTree' && o.look !== 'crag' && siteGap(orchard, o.pos) < 0);

// The four ground corners of each box that blocks a truck, in map tiles.
function groundCorners(o: Obstacle): Vec[] {
  return blockingBoxes(o, world.terrain).flatMap((b) =>
    [-1, 1].flatMap((i) =>
      [-1, 1].map((j) => ({
        x: b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * j,
        y: b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * j,
      })),
    ),
  );
}

describe('the ground under Old Orchard', () => {
  it('seats every prop but dead trees and rocks with each blocking corner within 0.1 of its seat', () => {
    expect(props.length).toBeGreaterThan(100);
    for (const o of props) {
      const seat = heightAt(world.terrain, o.pos.x, o.pos.y);
      const worst = Math.max(...groundCorners(o).map((p) => Math.abs(heightAt(world.terrain, p.x, p.y) - seat)));
      expect(worst, `${o.kind === 'landmark' ? o.look : o.kind} ${o.id} at ${o.pos.x.toFixed(1)},${o.pos.y.toFixed(1)}`).toBeLessThanOrEqual(RELIEF);
    }
  });
});
