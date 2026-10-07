import { describe, expect, it } from 'vitest';
import { RULES } from '../../data/rules';
import { tileAt } from '../terrain';
import { addVehicle, editableTerrain, emptyWorld } from '../testkit';
import type { World } from '../types';
import { worldLine, type TruckSnap } from './turn-log';

// A world on sand with a single road tile under (40, 40), on a snapshot turn.
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

  it('marks a truck moving only above the parked speed', () => {
    const w = sandWithOneRoadTile();
    const parked = addVehicle(w, 'raiders', 'buggy', [], { x: 50.5, y: 40.5 });
    const moving = addVehicle(w, 'raiders', 'buggy', [], { x: 60.5, y: 40.5 });
    parked.speed = RULES.parkedSpeed;
    moving.speed = RULES.parkedSpeed + 1;

    expect(snapOf(w, parked.id).moving).toBe(false);
    expect(snapOf(w, moving.id).moving).toBe(true);
  });
});
