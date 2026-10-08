// Armor rules on a stepped outline: the nose and the tail are narrower than the middle, so the corner cells do not exist.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PARTS } from '../data/parts';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { blastLanes, cabShield, gunSpans, lanePoint, spansHold, walkLane } from './armor';
import { makePart } from './factory';
import { mountedItems, sideOf } from './grid';
import { addVehicle, emptyWorld } from './testkit';
import type { GridItem, Rot, Vehicle, World } from './types';

// A 5 by 8 chassis. The nose is one cell wide, then steps out. The armor cells at (1,1), (3,1), (1,6) and (3,6) face
// two ways, so they carry the letter of the front or rear. The wheels are two cells long and stand at (1,2), (3,2),
// (1,4) and (3,4), which leaves the middle column for the two cell cab.
//   row 0   '  F  '
//   row 1   ' FDF '
//   row 2   'LXXXR'   wheels, the cab
//   row 3   'LXXXR'   wheels, the rest of the cab
//   row 4   'LXDXR'   wheels
//   row 5   'LXDXR'   wheels
//   row 6   ' BDB '
//   row 7   '  B  '
const STEPPED = {
  ...CHASSIS.scout,
  id: 'stepped',
  layout: ['  F  ', ' FDF ', 'LXXXR', 'LXXXR', 'LXDXR', 'LXDXR', ' BDB ', '  B  '],
  core: [
    { defId: 'cabTall', x: 2, y: 2 },
    { defId: 'wheel', x: 1, y: 2 },
    { defId: 'wheel', x: 3, y: 2 },
    { defId: 'wheel', x: 1, y: 4 },
    { defId: 'wheel', x: 3, y: 4 },
  ],
};

// The stepped truck has no model of its own, so it borrows the scout's collision boxes.
const SHAPES = TRUCK_SHAPES as Record<string, unknown>;
beforeAll(() => { CHASSIS.stepped = STEPPED; SHAPES.base_stepped = TRUCK_SHAPES.base_scout; PARTS.cabTall = { ...PARTS.cab, id: 'cabTall', tall: true }; });
afterAll(() => { delete CHASSIS.stepped; delete SHAPES.base_stepped; delete PARTS.cabTall; });

let nextItem = 0;

// A stepped truck with the given parts standing on the given cells.
function steppedWith(w: World, parts: { defId: string; x: number; y: number; rot?: Rot }[]): Vehicle {
  const v = addVehicle(w, 'player', 'stepped', [], { x: 40, y: 40 });
  for (const p of parts) v.items.push({ id: `i-stepped-${nextItem++}`, x: p.x, y: p.y, rot: p.rot ?? 0, kind: 'part', part: makePart(w, p.defId, 0) });
  return v;
}

const plateAt = (v: Vehicle, x: number, y: number): Extract<GridItem, { kind: 'part' }> => mountedItems(v).find((it) => it.x === x && it.y === y)!;
const strong = { damage: 10, pen: 20, blast: false, armorShare: 1 };

describe('a stepped outline', () => {
  it('lets a round from the front meet the nose armor before the parts behind it', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'steelPlate', x: 2, y: 0 }]);
    const hits = walkLane(w, v, 'front', 2, strong);
    expect(hits[0].part).toBe(plateAt(v, 2, 0).part.id);
    expect(hits[1].part).toBe(plateAt(v, 2, 2).part.id);
  });

  it('lets a round on a lane over a missing corner pass it and meet the armor step', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'steelPlate', x: 1, y: 1 }]);
    expect(walkLane(w, v, 'front', 1, strong)[0].part).toBe(plateAt(v, 1, 1).part.id);
    expect(walkLane(w, v, 'left', 1, strong)[0].part).toBe(plateAt(v, 1, 1).part.id);
  });

  it('lets a round on the outermost lane skip the missing corner and hit the side armor', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'steelPlate', x: 0, y: 2 }]);
    expect(walkLane(w, v, 'front', 0, strong)[0].part).toBe(plateAt(v, 0, 2).part.id);
  });

  it('counts armor on a stepped cell for the side its letter names', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'steelPlate', x: 1, y: 1 }, { defId: 'steelPlate', x: 3, y: 6 }, { defId: 'steelPlate', x: 0, y: 3 }]);
    const sides = [plateAt(v, 1, 1), plateAt(v, 3, 6), plateAt(v, 0, 3)].map((it) => sideOf(v, it.part));
    expect(sides).toEqual(['F', 'B', 'L']);
  });

  it('does not mount armor on a plain deck cell inside the ring', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'steelPlate', x: 2, y: 1 }]);
    const inside = v.items.find((it) => it.kind === 'part' && it.x === 2 && it.y === 1)!;
    expect(inside.kind === 'part' && sideOf(v, inside.part)).toBeNull();
  });

  it('lets a gun inside the ring fire out past the missing cells', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'mg', x: 2, y: 4, rot: 2 }]);
    expect(gunSpans(v, plateAt(v, 2, 4))).toEqual([{ from: 45, to: 315 }]);
  });

  it('still blocks that gun forward across the cab', () => {
    const w = emptyWorld();
    const v = steppedWith(w, [{ defId: 'mg', x: 2, y: 4 }]);
    expect(spansHold(gunSpans(v, plateAt(v, 2, 4)), 0)).toBe(false);
  });

  it('shields the cab only by armor on a lane that crosses it', () => {
    const w = emptyWorld();
    const step = steppedWith(w, [{ defId: 'steelPlate', x: 1, y: 1 }]);
    const nose = steppedWith(w, [{ defId: 'steelPlate', x: 2, y: 0 }]);
    const flank = steppedWith(w, [{ defId: 'steelPlate', x: 0, y: 3 }]);
    expect([cabShield(step), cabShield(nose), cabShield(flank)]).toEqual([0, 1, 1]);
  });

  it('aims a blast at a missing corner at the lanes whose faces lie near it', () => {
    const w = emptyWorld();
    const v = steppedWith(w, []);
    const corner = lanePoint(v, 'front', 0);
    expect(blastLanes(v, corner, 0.1)).toEqual({ side: 'front', lanes: [0] });
  });
});
