import { REGION } from '../../data/region';
import { describe, expect, it } from 'vitest';
import { tileAt } from '../terrain';
import { addVehicle, editableTerrain, emptyWorld } from '../testkit';
import type { World } from '../types';
import { worldLine, type TruckSnap } from './turn-log';

function sandWithOneRoadTile(): World {
  const w = emptyWorld();
  const terrain = editableTerrain(w);
  terrain.types.fill('sand');
  terrain.types[tileAt(terrain, { x: 40, y: 40 })] = 'road';
  w.turn = 100;
  return w;
}

function snapOf(w: World, id: string): TruckSnap {
  const trucks = worldLine(w, [])?.trucks;
  if (!trucks) throw new Error(`Turn ${w.turn} wrote no snapshot`);
  const snap = trucks.find((s) => s.id === id);
  if (!snap) throw new Error(`No snapshot of ${id}`);
  return snap;
}

describe('world log snapshot', () => {
  it('marks a truck on a road tile as on road and one on open ground as off it', () => {
    const w = sandWithOneRoadTile();
    const onRoad = addVehicle(w, 'raiders', 'buggy', [], { x: 40.5, y: 40.5 });
    const offRoad = addVehicle(w, 'raiders', 'buggy', [], { x: 50.5, y: 40.5 });

    expect(snapOf(w, onRoad.id).onRoad).toBe(true);
    expect(snapOf(w, offRoad.id).onRoad).toBe(false);
  });

  it('records the gap to the nearest road edge, rounded and capped at 20 tiles', () => {
    const w = sandWithOneRoadTile();
    const [a, b] = REGION.roads[0];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const at = (gap: number) => ({ x: a.x - ((b.y - a.y) / len) * (REGION.roadWidth / 2 + gap), y: a.y + ((b.x - a.x) / len) * (REGION.roadWidth / 2 + gap) });
    const on = addVehicle(w, 'raiders', 'buggy', [], { ...a });
    const near = addVehicle(w, 'raiders', 'buggy', [], at(8));
    const far = addVehicle(w, 'raiders', 'buggy', [], at(60));
    expect(snapOf(w, on.id).roadGap).toBe(0);
    expect(snapOf(w, near.id).roadGap).toBeGreaterThan(0);
    expect(snapOf(w, near.id).roadGap).toBeLessThanOrEqual(8);
    expect(snapOf(w, far.id).roadGap).toBe(20);
  });
});
