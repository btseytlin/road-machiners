// A drawn gun turns only where the sim lets it fire.

import { describe, expect, it } from 'vitest';
import { restFrame } from '../../phys/drive';
import { aimWithin, gunSpans } from '../../sim/armor';
import { facingOf, mountedItems } from '../../sim/grid';
import type { Rot } from '../../sim/types';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { angleDiff, DEG } from '../../sim/vec';
import { loadModels } from './models';
import { sweepOf } from './gunClearance';
import { signedDegrees, VehicleView } from './vehicle';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

function drawn(gun: string, headingDeg: number, aimDeg: number | null, rot: Rot = 0, spot?: { chassis: string; x: number; y: number }): number {
  const w = emptyWorld();
  const v = addVehicle(w, 'raiders', spot?.chassis ?? 'scout', [gun, 'stockEngine'], { x: 40, y: 40 }, headingDeg * DEG);
  const item = mountedItems(v, 'weapon')[0];
  item.rot = rot;
  if (spot) Object.assign(item, { x: spot.x, y: spot.y });
  const id = item.part.id;
  const view = new VehicleView(v, true);
  view.pose(restFrame(w, v), 0.016);
  view.aim(() => (aimDeg === null ? null : aimDeg * DEG));
  const { dir } = view.muzzle(id);
  return angleDiff(headingDeg * DEG, Math.atan2(dir.z, dir.x)) / DEG;
}

describe('turret aim', () => {
  it.each([0, 90, -135])('a 60 degree gun at heading %i keeps in-arc aim and stops at the arc edge', (heading) => {
    const rel = (deg: number) => drawn('longRifle', heading, heading + deg);
    expect(rel(10)).toBeCloseTo(10, 1);
    expect(rel(-30)).toBeCloseTo(-30, 1);
    expect(rel(31)).toBeCloseTo(30, 1);
    expect(rel(-100)).toBeCloseTo(-30, 1);
  });

  it.each([0, 90, -135])('a machine gun at heading %i points at any bearing its spans allow', (heading) => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 40, y: 40 });
    const spans = gunSpans(v, mountedItems(v, 'weapon')[0]);
    expect(spans.length).toBeGreaterThan(0);
    for (const deg of [-170, -90, 0, 60, 135, 180]) {
      expect(drawn('mg', heading, heading + deg)).toBeCloseTo(aimWithin(spans, deg), 1);
    }
  });

  it.each([1, 2, 3] as const)('a turret at rot %i rests at the allowed bearing nearest its facing', (rot) => {
    const spot = { chassis: 'longbed', x: 2, y: 8 };
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', spot.chassis, ['mg', 'stockEngine'], { x: 40, y: 40 });
    const item = mountedItems(v, 'weapon')[0];
    Object.assign(item, { rot, x: spot.x, y: spot.y });
    const spans = gunSpans(v, item);
    const facing = facingOf(item) > 180 ? facingOf(item) - 360 : facingOf(item);
    expect(drawn('mg', 0, null, rot, spot)).toBeCloseTo(aimWithin(spans, facing), 1);
  });

  it('keeps a rear-facing machine gun aim inside its rotated arc', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 40, y: 40 });
    const item = mountedItems(v, 'weapon')[0];
    item.rot = 2;
    const spans = gunSpans(v, item);
    for (const deg of [-170, 100, 180]) {
      expect(Math.abs(drawn('mg', 0, deg, 2))).toBeCloseTo(Math.abs(aimWithin(spans, deg)), 1);
    }
  });

  it('rests inside its spans with no target', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['longRifle', 'stockEngine'], { x: 40, y: 40 });
    const item = mountedItems(v, 'weapon')[0];
    const spans = gunSpans(v, item);
    expect(drawn('longRifle', 0, null)).toBeCloseTo(aimWithin(spans, 0), 1);
  });
});

describe('sweepOf', () => {
  it('keeps the spans of a turning gun', () => {
    const spans = [{ from: -45, to: 45 }];
    expect(sweepOf(spans, true, 90)).toBe(spans);
  });

  it('rests a fixed gun on its facing', () => {
    expect(sweepOf([{ from: -45, to: 45 }], false, 90)).toEqual([{ from: 90, to: 90 }]);
    expect(sweepOf([], true)).toEqual([{ from: 0, to: 0 }]);
  });
});

describe('signedDegrees', () => {
  it.each([[0, 0], [90, 90], [180, 180], [270, -90], [-90, -90], [450, 90]])('maps %i to %i', (deg, want) => {
    expect(signedDegrees(deg)).toBe(want);
  });
});
