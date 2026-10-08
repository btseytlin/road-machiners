// A drawn gun turns only where the sim lets it fire.

import { describe, expect, it } from 'vitest';
import { restFrame } from '../../phys/drive';
import { aimWithin, fireSpans, openSides } from '../../sim/armor';
import { mountedItems } from '../../sim/grid';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import { angleDiff, DEG } from '../../sim/vec';
import { loadModels } from './models';
import { VehicleView } from './vehicle';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

function drawn(gun: string, headingDeg: number, aimDeg: number | null): number {
  const w = emptyWorld();
  const v = addVehicle(w, 'raiders', 'scout', [gun, 'stockEngine'], { x: 40, y: 40 }, headingDeg * DEG);
  const id = mountedItems(v, 'weapon')[0].part.id;
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

  it.each([0, 90, -135])('a 360 degree gun at heading %i points at any bearing its open sides allow', (heading) => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 40, y: 40 });
    const spans = fireSpans(360, openSides(v, mountedItems(v, 'weapon')[0]));
    expect(spans.length).toBeGreaterThan(0);
    for (const deg of [-170, -90, 0, 60, 135, 180]) {
      expect(drawn('mg', heading, heading + deg)).toBeCloseTo(aimWithin(spans, deg), 1);
    }
  });

  it('rests inside its spans with no target', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['longRifle', 'stockEngine'], { x: 40, y: 40 });
    const item = mountedItems(v, 'weapon')[0];
    const spans = fireSpans(60, openSides(v, item));
    expect(drawn('longRifle', 0, null)).toBeCloseTo(aimWithin(spans, 0), 1);
  });
});
