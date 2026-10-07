// Harpoon lines in physics (src/phys/drive.ts): a one-sided spring between two trucks that tears under a hard pull.

import { beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS } from '../data/physics';
import { HARPOON } from '../data/utilities';
import { mountedParts } from '../sim/grid';
import { lineAnchors, type LineAnchor } from '../sim/harpoon';
import { addVehicle, emptyWorld, npcBrain } from '../sim/testkit';
import type { Vehicle, World } from '../sim/types';
import { buildDrive, freeDrive, initPhysics, simulateTurn, syncDrive, type Drive, type TurnResult } from './drive';
import { rotateBy } from './frames';
import { applyTurn } from './turn';

beforeAll(async () => {
  await initPhysics();
});

const S = PHYSICS.metersPerTile;
// A pace in tiles per turn whose throttle, at a standstill, is half of full.
const HALF_THROTTLE = ((0.5 / PHYSICS.driver.throttleGain) * PHYSICS.turnSeconds) / S;

// A parked truck with a harpoon and a target truck 3 tiles ahead of it, both facing east, held by a line that is just
// taut. The target drives east at the given pace in tiles per turn, or as fast as it can, from the given speed.
function tethered(opts: { pace?: number; from?: string; to?: string; speed?: number } = {}): { w: World; hauler: Vehicle; scout: Vehicle } {
  const w = emptyWorld();
  const hauler = addVehicle(w, 'traders', opts.from ?? 'hauler', ['stockEngine', 'harpoon'], { x: 30, y: 30 });
  const scout = addVehicle(w, 'traders', opts.to ?? 'scout', ['stockEngine'], { x: 33, y: 30 });
  w.vehicles = w.vehicles.filter((v) => v.id === w.player.vehicleId || v === hauler || v === scout);
  w.vehicles[0].pos = { x: 30, y: 26 };
  const harpoon = mountedParts(hauler, 'weapon').find((p) => p.defId === 'harpoon');
  if (!harpoon) throw new Error('The harpoon did not mount');
  const held = mountedParts(scout, 'engine')[0];
  w.lines = [{ id: 'l1', from: hauler.id, fromPart: harpoon.id, to: scout.id, toPart: held.id, length: 0, turnsLeft: 3 }];
  w.lines[0].length = anchorGap(scout, hauler, lineAnchors(w)[0]);
  scout.speed = opts.speed ?? 0;
  scout.order = { kind: 'through', dest: { x: 80, y: 30 }, ...(opts.pace === undefined ? {} : { pace: opts.pace }) };
  hauler.order = { kind: 'brake' };
  return { w, hauler, scout };
}

// Meters between the anchors on the ground plane, from the trucks' sim poses.
function anchorGap(scout: Vehicle, hauler: Vehicle, line: LineAnchor): number {
  const at = (v: Vehicle, p: { x: number; z: number }) => ({
    x: v.pos.x * S + Math.cos(v.heading) * p.x - Math.sin(v.heading) * p.z,
    z: v.pos.y * S + Math.sin(v.heading) * p.x + Math.cos(v.heading) * p.z,
  });
  const a = at(hauler, line.fromAt);
  const b = at(scout, line.toAt);
  return Math.hypot(b.x - a.x, b.z - a.z);
}

// Plays turns of physics, carrying the drive from turn to turn, and applies each turn's result to the world.
// Ages nothing, so only the pull ends the line. Returns each turn's result before its drive is freed.
function play(w: World, turns: number, each: (r: TurnResult, turn: number) => void): void {
  let d: Drive = buildDrive(w);
  for (let i = 0; i < turns; i++) {
    syncDrive(d, w);
    const r = simulateTurn(d, w);
    applyTurn(w, r);
    each(r, i);
    freeDrive(d);
    d = r.next;
  }
  freeDrive(d);
}

describe('harpoon line physics', () => {
  it.each([
    ['from rest', 'hauler', 0],
    ['already at speed', 'hauler', 7],
    ['from a parked scout, at speed', 'scout', 7],
  ])('holds a scout fleeing at full throttle %s for the line\'s 10 turns', (_name, from, speed) => {
    const { w } = tethered({ from: from as string, speed: speed as number });

    play(w, 10, (r) => expect(r.tears).toEqual([]));

    expect(w.lines).toHaveLength(1);
  });

  it.each(['hauler', 'bus', 'tractor'])('lets a %s drag a braking scout away for the line\'s 10 turns', (to) => {
    const { w, hauler: scout } = tethered({ from: 'scout', to });
    const start = scout.pos.x;

    play(w, 10, (r) => expect(r.tears).toEqual([]));

    expect(w.lines).toHaveLength(1);
    expect(scout.pos.x - start).toBeGreaterThan(5);
  });

  it('lets a scout drag a frozen truck, which has no brakes, much farther than a braking one', () => {
    const dragged = (frozen: boolean): number => {
      const { w, hauler } = tethered({ from: 'scout' });
      hauler.brain = npcBrain('trader', hauler.pos, ['trader']);
      w.player.frozen = frozen;
      const start = hauler.pos.x;
      play(w, 5, (r) => expect(r.tears).toEqual([]));
      return hauler.pos.x - start;
    };

    const free = dragged(true);
    expect(free).toBeGreaterThan(10);
    expect(free).toBeGreaterThan(10 * dragged(false));
  });

  it('tears at a stretch pull above the tear force, and damages the held part once', () => {
    const { w, scout } = tethered();
    w.lines[0].length -= HARPOON.tearForce / HARPOON.stiffness + 1;
    const held = mountedParts(scout, 'engine')[0];
    const hp = held.hp;
    const tears: number[] = [];

    play(w, 1, (r) => tears.push(...r.tears.map((t) => t.step)));

    expect(tears).toEqual([0]);
    expect(w.lines).toEqual([]);
    expect(held.hp).toBe(hp - HARPOON.tearDamage);
  });

  // At half throttle the scout pulls about 8 kN, which the 30000 N/m spring holds at well under a meter.
  it('holds a scout at half throttle within half a meter of its length', () => {
    const { w, hauler, scout } = tethered({ pace: HALF_THROTTLE });
    let worst = 0;

    const line = lineAnchors(w)[0];

    play(w, 3, (r) => {
      expect(r.tears).toEqual([]);
      r.frames[hauler.id].forEach((a, step) => {
        const b = r.frames[scout.id][step];
        const pa = rotateBy(a.rot, line.fromAt);
        const pb = rotateBy(b.rot, line.toAt);
        const gap = Math.hypot(b.pos.x + pb.x - a.pos.x - pa.x, b.pos.z + pb.z - a.pos.z - pa.z);
        worst = Math.max(worst, gap - line.length);
      });
    });

    expect(w.lines).toHaveLength(1);
    expect(worst).toBeLessThanOrEqual(0.5);
  });

  it('does not pull a slack line', () => {
    const { w, hauler } = tethered();
    w.lines[0].length = 50;
    const start = { ...hauler.pos };

    play(w, 1, (r) => expect(r.tears).toEqual([]));

    expect(hauler.pos.x).toBeCloseTo(start.x, 1);
  });
});
