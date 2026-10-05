import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OIL } from '../../data/utilities';
import { PAL } from '../../render/palette';
import { dropField, spillOil } from '../../sim/hazards';
import { addVehicle, emptyWorld } from '../../sim/testkit';
import type { Vehicle, World } from '../../sim/types';
import { cloneWorld } from '../../sim/world';
import type * as Zones from './zones';

// Every GroundBand mesh made while a test runs, so a view tree can be checked for rings, discs and bands.
const bands = vi.hoisted(() => new Set<object>());
vi.mock('./zones', async (load) => {
  const zones = await load<typeof Zones>();
  class RecordedBand extends zones.GroundBand {
    constructor(look: ConstructorParameters<typeof zones.GroundBand>[0]) {
      super(look);
      bands.add(this.mesh);
    }
  }
  return { ...zones, GroundBand: RecordedBand };
});

const { HazardViews, cutShare, fieldShown, volleyShown } = await import('./hazards');

// A canvas that takes the texture drawing calls, since Node has no DOM.
function stubCanvas(): void {
  const ctx = { createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: '' };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}

// The player truck drove 10 tiles east along y = 30 this turn, from x = 20 to x = 30, in 10 even steps.
function droveEast(world: World): Vehicle {
  const me = world.vehicles[0];
  me.pos = { x: 30, y: 30 };
  me.heading = 0;
  me.trail = Array.from({ length: 11 }, (_, i) => ({ x: 20 + i, y: 30, heading: 0 }));
  return me;
}

const clock = (before: World, progress: number, moved = false) => ({ before, progress, moved });

describe('fieldShown', () => {
  it('shows a caltrop field once the dropper has passed it by half its length and the field radius', () => {
    const world = emptyWorld();
    const me = droveEast(world);
    const before = cloneWorld(world);
    // The field's near edge lies `behind` = 1 tile behind the rear, so it shows one tile before the turn's end.
    dropField(world, me, 'caltrops', { radius: 1.25, turns: 5, behind: 1 });
    const field = world.fields[0];

    expect(fieldShown(world, field, clock(before, 0))).toBe(false);
    expect(fieldShown(world, field, clock(before, 0.88))).toBe(false);
    expect(fieldShown(world, field, clock(before, 0.92))).toBe(true);
    expect(fieldShown(world, field, clock(before, 1))).toBe(true);
  });

  it('shows an oil streak from its far end first, as the truck drives along it', () => {
    const world = emptyWorld();
    const me = droveEast(world);
    const before = cloneWorld(world);
    spillOil(world, me, { turns: 8, behind: 0.5, fuel: 2 });

    const shownAt = (progress: number) => world.fields.filter((f) => fieldShown(world, f, clock(before, progress))).length;

    expect(shownAt(0)).toBe(0);
    expect(shownAt(0.75)).toBeGreaterThan(0);
    expect(shownAt(0.75)).toBeLessThan(OIL.blobs);
    // The far blobs, laid first along the path, are the ones shown.
    const farFirst = world.fields.map((f) => fieldShown(world, f, clock(before, 0.75)));
    expect(farFirst).toEqual([...farFirst].sort((a, b) => Number(a) - Number(b)));
    expect(shownAt(1)).toBe(OIL.blobs);
  });

  it('shows every field once movement has played, and with no playback', () => {
    const world = emptyWorld();
    const me = droveEast(world);
    const before = cloneWorld(world);
    dropField(world, me, 'caltrops', { radius: 1.25, turns: 5, behind: 1 });

    expect(fieldShown(world, world.fields[0], clock(before, 0, true))).toBe(true);
    expect(fieldShown(world, world.fields[0], null)).toBe(true);
  });

  it('shows a field from an earlier turn at once', () => {
    const world = emptyWorld();
    const me = droveEast(world);
    dropField(world, me, 'caltrops', { radius: 1.25, turns: 5, behind: 1 });
    const before = cloneWorld(world);

    expect(fieldShown(world, world.fields[0], clock(before, 0))).toBe(true);
  });

  it('waits for the end of movement when the dropper has left the world', () => {
    const world = emptyWorld();
    const npc = addVehicle(world, 'raiders', 'buggy', ['stockEngine'], { x: 30, y: 30 });
    npc.trail = Array.from({ length: 11 }, (_, i) => ({ x: 20 + i, y: 30, heading: 0 }));
    const before = cloneWorld(world);
    dropField(world, npc, 'caltrops', { radius: 1.25, turns: 5, behind: 1 });
    world.vehicles = world.vehicles.filter((v) => v !== npc);

    expect(fieldShown(world, world.fields[0], clock(before, 1))).toBe(false);
    expect(fieldShown(world, world.fields[0], clock(before, 1, true))).toBe(true);
  });
});

describe('volleyShown', () => {
  it('holds smoke made this turn until movement has played', () => {
    const world = emptyWorld();
    const before = cloneWorld(world);
    world.smoke.push({ id: 's1', source: world.player.vehicleId, pos: { x: 30, y: 30 }, r: 4, turnsLeft: 5 });

    expect(volleyShown(clock(before, 1), 'smoke', 's1')).toBe(false);
    expect(volleyShown(clock(before, 1, true), 'smoke', 's1')).toBe(true);
    expect(volleyShown(null, 'smoke', 's1')).toBe(true);
  });

  it('shows a flare from an earlier turn at once', () => {
    const world = emptyWorld();
    world.flares.push({ id: 'f1', source: world.player.vehicleId, pos: { x: 34, y: 30 }, r: 10, turnsLeft: 3 });
    const before = cloneWorld(world);

    expect(volleyShown(clock(before, 0), 'flares', 'f1')).toBe(true);
  });
});

describe('cutShare', () => {
  // The player's truck at the origin, seen by a camera looking straight down.
  const cut = { at: new THREE.Vector3(0, 0, 0), look: new THREE.Vector3(0, -1, 0) };
  const half = 6; // meters, a 3-tile puff

  it('thins a puff between the camera and the player truck', () => {
    expect(cutShare(cut, new THREE.Vector3(0.5, 4, 0), half)).toBeLessThan(0.2);
  });

  it('leaves whole a puff clear of the truck on screen, one behind it, and every puff with no truck', () => {
    expect(cutShare(cut, new THREE.Vector3(12, 4, 0), half)).toBe(1);
    expect(cutShare(cut, new THREE.Vector3(0.5, -4, 0), half)).toBe(1);
    expect(cutShare(null, new THREE.Vector3(0.5, 4, 0), half)).toBe(1);
  });
});

describe('HazardViews', () => {
  beforeEach(() => {
    stubCanvas();
    bands.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  // A turn with no gunfire ends its playback in the frame its movement ends, so the views never see a clock at the
  // volley. A flare made in it must still fly from its cannon before it lights.
  it('flies a flare made this turn when the playback ended in the volley frame', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const before = cloneWorld(world);
    const pos = { x: me.pos.x + 12, y: me.pos.y };
    world.flares.push({ id: 'f1', source: me.id, pos, r: 10, turnsLeft: 6 });
    world.events = [{ t: 'utility', vehicle: me.id, part: 'p1', effect: 'flare', target: null, point: { ...pos } }];
    const views = new HazardViews();
    const camera = new THREE.PerspectiveCamera();

    views.update(world, world.terrain, new Map(), 1000, clock(before, 0.5), camera);
    views.update(world, world.terrain, new Map(), 1016, null, camera);

    const shown: THREE.Sprite[] = [];
    views.root.traverse((o) => {
      if (o instanceof THREE.Sprite && o.visible && o.parent?.visible !== false) shown.push(o);
    });
    expect(shown.some((o) => o.material.color.getHex() === PAL.flare.head)).toBe(true);
    expect(shown.some((o) => o.material.color.getHex() === PAL.flare.glow)).toBe(false);
  });

  // IV23: hazard views draw no ground ring, disc or band at a hazard's radius.
  it('draws smoke, oil, caltrops, flares and pulses without a ground band', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const npc = addVehicle(world, 'raiders', 'buggy', ['stockEngine'], { x: 33, y: 30 });
    world.smoke.push({ id: 's1', source: me.id, pos: { x: 30, y: 30 }, r: 4, turnsLeft: 5 });
    world.fields.push({ id: 'g1', kind: 'oil', source: me.id, pos: { x: 27, y: 30 }, r: 0.9, turnsLeft: 5, hit: [] });
    world.fields.push({ id: 'g2', kind: 'caltrops', source: me.id, pos: { x: 25, y: 32 }, r: 1.25, turnsLeft: 5, hit: [] });
    world.flares.push({ id: 'f1', source: me.id, pos: { x: 34, y: 30 }, r: 10, turnsLeft: 3 });
    world.events = [{ t: 'pulse', vehicle: me.id, pos: { ...me.pos }, hit: [npc.id] }];
    const views = new HazardViews();

    views.update(world, world.terrain, new Map(), 1000, null, new THREE.PerspectiveCamera());

    const meshes: THREE.Object3D[] = [];
    views.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.filter((m) => bands.has(m))).toEqual([]);
  });
});
