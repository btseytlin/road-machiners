// Ruts: a grounded wheel on soft ground lays one segment per step of travel, never on roads, in the air or from a
// truck the player cannot see, and the pool never passes its cap. tirePoints, which ruts and wheel dust share, is
// checked here too.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PHYSICS } from '../../data/physics';
import type { TerrainTypeId } from '../../data/terrain';
import { wheelMounts } from '../../phys/body';
import { groundPoint, headingQuat, type VehicleFrame } from '../../phys/frames';
import { bodyOf } from '../../sim/body';
import { DECKS } from '../../sim/bridge';
import { editableTerrain, emptyWorld } from '../../sim/testkit';
import type { Vehicle, World } from '../../sim/types';
import type { CameraRig } from './camera';
import { Fx3D, TruckFx } from './fx';
import { RUT, Ruts, tirePoints } from './ruts';

const S = PHYSICS.metersPerTile;
const Y = 30; // the map row the test truck drives along, facing +x

function worldOn(ground: TerrainTypeId): World {
  const w = emptyWorld();
  const t = editableTerrain(w);
  t.types.fill(ground);
  return w;
}

function truckOf(w: World): Vehicle {
  return w.vehicles[0];
}

// The truck's pose with its center x meters along the row, every wheel on the ground or in the air.
function frameAt(v: Vehicle, x: number, ground = true, y = Y * S): VehicleFrame {
  const wheels = wheelMounts(bodyOf(v.chassisId)).map(() => ({ steer: 0, spin: 0, suspension: 0, ground }));
  return { pos: { x, y: 1, z: y }, rot: headingQuat(0), acc: { x: 0, y: 0, z: 0 }, wheels };
}

const FRAME_MOVE = 0.125; // meters per frame; exact in binary, so steps land on frames without rounding

function track(ruts: Ruts, w: World, v: Vehicle, f: VehicleFrame): void {
  ruts.layTracks(w, v, f, tirePoints(w.terrain, v.chassisId, f));
}

// Drives the truck from x0 to x1 meters in small frame moves, as playback does.
function drive(ruts: Ruts, w: World, x0: number, x1: number, ground = true): void {
  const v = truckOf(w);
  for (let i = 0; x0 + i * FRAME_MOVE <= x1; i++) track(ruts, w, v, frameAt(v, x0 + i * FRAME_MOVE, ground));
}

// The wheels that mark: a pair, however many wheels the truck has.
const marking = RUT.wheels.length;

describe('Ruts', () => {
  it('lays one segment per step of travel for each of the rear pair on sand', () => {
    const w = worldOn('sand');
    const ruts = new Ruts(new THREE.Scene());

    drive(ruts, w, 100, 100 + 4 * RUT.step);

    expect(ruts.mesh.count).toBe(4 * marking);
  });

  it('leaves one left and one right track while turning, not a doubled arc', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const ruts = new Ruts(new THREE.Scene());
    const radius = 12; // meters, the turn's centre line
    const centre = { x: 100, z: Y * S + radius };
    for (let a = 0; a < 1.2; a += 0.01) {
      const f = frameAt(v, centre.x + radius * Math.sin(a), true, centre.z - radius * Math.cos(a));
      track(ruts, w, v, { ...f, rot: headingQuat(a) });
    }

    const stepsOfArc = Math.ceil((radius * 1.2) / RUT.step);
    expect(ruts.mesh.count).toBeGreaterThan(stepsOfArc); // both tracks lay segments
    expect(ruts.mesh.count).toBeLessThanOrEqual(2 * (stepsOfArc + 2)); // and no more than a left and a right strip
  });

  it('lays nothing below one step of travel', () => {
    const w = worldOn('sand');
    const ruts = new Ruts(new THREE.Scene());

    drive(ruts, w, 100, 100 + RUT.step * 0.8);

    expect(ruts.mesh.count).toBe(0);
  });

  it('lays nothing on a road', () => {
    const w = worldOn('road');
    const ruts = new Ruts(new THREE.Scene());

    drive(ruts, w, 100, 104);

    expect(ruts.mesh.count).toBe(0);
  });

  it('lays nothing from wheels in the air', () => {
    const w = worldOn('sand');
    const ruts = new Ruts(new THREE.Scene());

    drive(ruts, w, 100, 104, false);

    expect(ruts.mesh.count).toBe(0);
  });

  it('lays nothing on a deck', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const ruts = new Ruts(new THREE.Scene());
    const deck = DECKS[0];
    const along = (k: number) => ({ x: (deck.from.x + deck.axis.x * k) * S, z: (deck.from.y + deck.axis.y * k) * S });

    for (let k = deck.length * 0.4; k <= deck.length * 0.6; k += 0.02) {
      const p = along(k);
      track(ruts, w, v, { ...frameAt(v, p.x, true, p.z), rot: headingQuat(Math.atan2(deck.axis.y, deck.axis.x)) });
    }

    expect(ruts.mesh.count).toBe(0);
  });

  it('joins a long move between frames to the strip', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const ruts = new Ruts(new THREE.Scene());

    track(ruts, w, v, frameAt(v, 100));
    track(ruts, w, v, frameAt(v, 100 + 3 * RUT.step));

    expect(ruts.mesh.count).toBe(marking);
  });

  it('starts a new strip after a jump of over a gap, with no segment across it', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const ruts = new Ruts(new THREE.Scene());

    track(ruts, w, v, frameAt(v, 100));
    track(ruts, w, v, frameAt(v, 100 + RUT.gap + RUT.step));
    track(ruts, w, v, frameAt(v, 100 + RUT.gap + 2 * RUT.step));

    expect(ruts.mesh.count).toBe(marking);
  });

  it('starts a new strip after a wheel lifts', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const ruts = new Ruts(new THREE.Scene());

    track(ruts, w, v, frameAt(v, 100));
    track(ruts, w, v, frameAt(v, 100 + RUT.step, false));
    track(ruts, w, v, frameAt(v, 100 + 2 * RUT.step));

    expect(ruts.mesh.count).toBe(0);
  });

  it('never holds more than the cap, overwriting the oldest', () => {
    const w = worldOn('sand');
    const ruts = new Ruts(new THREE.Scene());
    const per = marking;

    drive(ruts, w, 10, 10 + (RUT.max / per + 10) * RUT.step);

    expect(ruts.mesh.count).toBe(RUT.max);
  });

  it('drapes a segment at the ground plus the lift, as wide as the tire', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const ruts = new Ruts(new THREE.Scene());

    track(ruts, w, v, frameAt(v, 100));
    track(ruts, w, v, frameAt(v, 100 + RUT.step));

    const m = new THREE.Matrix4();
    ruts.mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    expect(pos.y).toBeCloseTo(RUT.lift, 6);
    expect(scale.x).toBeCloseTo(RUT.step, 6);
    expect(scale.z).toBeCloseTo(RUT.width, 6);
  });

  it('fades a segment to nothing over its life', () => {
    const w = worldOn('sand');
    const ruts = new Ruts(new THREE.Scene());
    drive(ruts, w, 100, 100 + RUT.step);
    const color = new THREE.Color();

    ruts.tick(w.turn);
    ruts.mesh.getColorAt(0, color);
    const fresh = color.r;
    ruts.tick(w.turn + RUT.lifeTurns / 2);
    ruts.mesh.getColorAt(0, color);
    const half = color.r;
    ruts.tick(w.turn + RUT.lifeTurns);
    ruts.mesh.getColorAt(0, color);

    expect(fresh).toBeLessThan(half);
    expect(half).toBeLessThan(1);
    expect(color.r).toBe(1);
  });

  it('never marks from a truck the player does not see, or between turns', () => {
    const w = worldOn('sand');
    const v = truckOf(w);
    const element = { style: {}, appendChild: () => undefined };
    vi.stubGlobal('document', { createElement: () => element });
    const fx = new Fx3D(new THREE.Scene(), element as unknown as HTMLElement, {} as CameraRig);
    const truckFx = new TruckFx(fx);

    for (let i = 0; i <= 16; i++) {
      truckFx.emit(w, v, frameAt(v, 100 + i * FRAME_MOVE), true, 1 / 60, false);
      truckFx.emit(w, v, frameAt(v, 100 + i * FRAME_MOVE), false, 1 / 60, true);
    }
    expect(fx.ruts.mesh.count).toBe(0);

    for (let i = 0; i <= 16; i++) truckFx.emit(w, v, frameAt(v, 100 + i * FRAME_MOVE), true, 1 / 60, true);
    expect(fx.ruts.mesh.count).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

describe('tirePoints', () => {
  it('gives each tire’s ground point under the pose, in wheelMounts order, as wheel dust used', () => {
    const w = worldOn('sand');
    const t = editableTerrain(w);
    t.heights.forEach((_, k) => (t.heights[k] = (k % (t.size + 1)) * 0.05)); // a slope rising along +x
    const v = truckOf(w);
    const f: VehicleFrame = { ...frameAt(v, 100), rot: headingQuat(Math.PI / 2) }; // facing map +y
    const mounts = wheelMounts(bodyOf(v.chassisId));

    const points = tirePoints(t, v.chassisId, f);

    // Facing +y, a mount's forward x runs along map +y and its side z along map -x.
    const expected = mounts.map((m) => groundPoint(t, { x: (f.pos.x - m.z) / S, y: (f.pos.z + m.x) / S }));
    expect(points).toHaveLength(mounts.length);
    for (const [i, p] of points.entries()) {
      expect(p.x).toBeCloseTo(expected[i].x, 9);
      expect(p.y).toBeCloseTo(expected[i].y, 9);
      expect(p.z).toBeCloseTo(expected[i].z, 9);
    }
  });
});
