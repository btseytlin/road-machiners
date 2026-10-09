// Part scrap flies, settles, lingers and leaves the scope. The cap frees the oldest bursts first.

import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { initPhysics } from '../../phys/drive';
import { flatTerrain } from '../../sim/testkit';
import { DebrisSim, piecesOf } from './debris';
import { loadModels } from './models';
import { overCap, PART_DEBRIS_MAX, PartDebris } from './partDebris';
import { RenderScope, SightLimit } from './scope';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

const SIZE = 64;
const S = PHYSICS.metersPerTile;

function trackedScope(): { scope: RenderScope; added: THREE.Group[] } {
  const scope = new RenderScope(new THREE.Group(), SIZE, new SightLimit(SIZE), true, false);
  const added: THREE.Group[] = [];
  const add = scope.add.bind(scope);
  vi.spyOn(scope, 'add').mockImplementation((obj, pos, radius) => {
    added.push(obj as THREE.Group);
    add(obj, pos, radius);
  });
  return { scope, added };
}

function ys(group: THREE.Group): number[] {
  return group.children.map((c) => c.position.y);
}

describe('overCap', () => {
  it('frees nothing under or at the cap', () => {
    expect(overCap([10, 10], 10, 30)).toBe(0);
    expect(overCap([], 5, 5)).toBe(0);
  });
  it('frees the oldest bursts first until the new one fits', () => {
    expect(overCap([10, 10, 10], 10, 30)).toBe(1);
    expect(overCap([10, 10, 10], 15, 30)).toBe(2);
    expect(overCap([10, 10, 10], 25, 30)).toBe(3);
    expect(overCap([10, 20], 40, 30)).toBe(2);
  });
});

describe('part debris', () => {
  beforeAll(initPhysics);

  it('flies, settles, then shrinks away out of the scope', () => {
    const { scope, added } = trackedScope();
    const debris = new PartDebris(scope, flatTerrain(SIZE));
    const at = { x: 32 * S, y: 1, z: 32 * S };
    debris.burst('a:b:1', at, { x: at.x - 1, y: 1, z: at.z }, []);
    const group = added[0];
    expect(group.children.length).toBe(piecesOf('good_scrap').length);
    expect(group.parent).not.toBeNull();
    const start = ys(group);
    const dt = 1 / 30;
    for (let i = 0; i < 3; i++) debris.play([], dt);
    expect(ys(group)).not.toEqual(start);
    for (let t = 0; t < 12; t += dt) debris.play([], dt);
    const rest = ys(group);
    debris.play([], dt);
    expect(ys(group)).toEqual(rest);
    for (const y of rest) expect(y).toBeLessThan(1);
    for (let t = 12; t < 24; t += dt) debris.play([], dt);
    expect(group.parent).toBeNull();
    debris.free();
  });

  it('keeps live pieces at the cap', () => {
    const { scope, added } = trackedScope();
    const debris = new PartDebris(scope, flatTerrain(SIZE));
    const each = piecesOf('good_scrap').length;
    const at = { x: 32 * S, y: 1, z: 32 * S };
    const bursts = Math.ceil(PART_DEBRIS_MAX / each) + 3;
    for (let i = 0; i < bursts; i++) debris.burst(`k${i}`, at, { x: 0, y: 1, z: 0 }, []);
    const live = added.filter((g) => g.parent !== null).reduce((n, g) => n + g.children.length, 0);
    expect(live).toBeLessThanOrEqual(PART_DEBRIS_MAX);
    debris.free();
  });
});

describe('prop debris', () => {
  beforeAll(initPhysics);

  it('still splits a prop into every piece of its model', () => {
    const sim = new DebrisSim(flatTerrain(SIZE));
    const group = sim.burst({ id: 'w1', pos: { x: 32, y: 32 }, r: 1.5, kind: 'wreck' }, null, []);
    expect(group.children.length).toBe(piecesOf('wreck').length);
    sim.settle();
    sim.free();
  });
});
