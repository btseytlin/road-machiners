// Spent casings fly off the gun, come to rest on the ground, fade with age and never pass the pool cap.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { flatTerrain } from '../../sim/testkit';
import type { Terrain } from '../../sim/terrain';
import { CASING, Casings, PROJECTILES, Projectiles, type Muzzle } from './projectiles';

const S = PHYSICS.metersPerTile;
const GROUND_TILES = 2;

function raisedTerrain(): Terrain {
  const t = flatTerrain(32);
  return { ...t, heights: t.heights.map(() => GROUND_TILES) };
}

const MUZZLE: Muzzle = { pos: { x: 16 * S, y: GROUND_TILES * S + 1.5, z: 16 * S }, dir: { x: 1, y: 0, z: 0 } };

function settle(c: Casings, terrain: Terrain, turn: number): void {
  for (let i = 0; i < 300; i++) c.tick(1 / 60, terrain, turn);
}

function positionOf(mesh: THREE.InstancedMesh, i: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

describe('Casings', () => {
  it('never holds more than the cap, dropping the oldest first', () => {
    const terrain = raisedTerrain();
    const c = new Casings(new THREE.Scene());
    c.eject(MUZZLE, 'large', 0);
    for (let i = 0; i < CASING.max; i++) c.eject(MUZZLE, 'small', 0);

    c.tick(1 / 60, terrain, 0);

    expect(c.meshes.small.count).toBe(CASING.max);
    expect(c.meshes.large.count).toBe(0);
  });

  it('lays a casing at rest on the ground, to the gun’s right', () => {
    const terrain = raisedTerrain();
    const c = new Casings(new THREE.Scene());
    c.eject(MUZZLE, 'large', 0);

    settle(c, terrain, 0);

    const p = positionOf(c.meshes.large, 0);
    expect(p.y).toBeCloseTo(GROUND_TILES * S + CASING.large.radius, 5);
    expect(p.z).toBeGreaterThan(MUZZLE.pos.z);
  });

  it('ejects nothing for a gun with no casing', () => {
    const terrain = raisedTerrain();
    const c = new Casings(new THREE.Scene());
    c.eject(MUZZLE, null, 0);

    c.tick(1 / 60, terrain, 0);

    expect(c.meshes.small.count + c.meshes.large.count).toBe(0);
  });

  it('shrinks a casing in the last tenth of its life and removes it after', () => {
    const terrain = raisedTerrain();
    const c = new Casings(new THREE.Scene());
    c.eject(MUZZLE, 'small', 0);
    settle(c, terrain, 0);
    const full = scaleOf(c.meshes.small, 0);

    c.tick(1 / 60, terrain, Math.round(CASING.lifeTurns * 0.95));
    const fading = scaleOf(c.meshes.small, 0);
    c.tick(1 / 60, terrain, CASING.lifeTurns);

    expect(fading).toBeLessThan(full);
    expect(fading).toBeGreaterThan(0);
    expect(c.meshes.small.count).toBe(0);
  });

  it('throws on a muzzle pointing straight up, which has no right side', () => {
    const c = new Casings(new THREE.Scene());

    expect(() => c.eject({ pos: MUZZLE.pos, dir: { x: 0, y: 1, z: 0 } }, 'small', 0)).toThrow();
  });

  it('removes its meshes from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const c = new Casings(scene);

    c.dispose();

    expect(scene.children).toHaveLength(0);
  });
});

function scaleOf(mesh: THREE.InstancedMesh, i: number): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixScale(m).x;
}

describe('a burst throwing casings', () => {
  it('throws each round’s casing as that round fires, before any round lands', () => {
    const scene = new THREE.Scene();
    const casings = new Casings(scene);
    const projectiles = new Projectiles(scene, () => undefined);
    const landed: number[] = [];
    const gap = PROJECTILES.mg.gapMs;
    const plan = (k: number) => ({ land: { x: MUZZLE.pos.x + 60, y: MUZZLE.pos.y, z: MUZZLE.pos.z }, impact: 'ground' as const, delayMs: k * gap, flightMs: 900 });
    for (let k = 0; k < 3; k++) {
      projectiles.launch({
        spec: PROJECTILES.mg,
        muzzle: () => MUZZLE,
        plan: plan(k),
        onFire: (m) => casings.eject(m, 'small', 0),
        onLand: () => landed.push(k),
        ground: () => 0,
      });
    }
    const thrown = () => casings.meshes.small.count;
    const dt = 1 / 60;

    projectiles.tick(dt);
    casings.tick(dt, raisedTerrain(), 0);
    expect(thrown()).toBe(1);

    for (let t = dt; t < (gap + 20) / 1000; t += dt) projectiles.tick(dt);
    casings.tick(dt, raisedTerrain(), 0);
    expect(thrown()).toBe(2);
    expect(landed).toEqual([]);
  });
});
