// A dead truck's wreck draws as its charred chassis, a hulk: the base model with no wheels, parts, paint or light.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { FACTION_COLORS } from '../../render/palette';
import { propPose } from '../../sim/mapgen';
import { flatTerrain } from '../../sim/testkit';
import type { Obstacle } from '../../sim/types';
import { buildHulk, type HulkPose } from './obstacles';
import { loadModels } from './models';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

const S = PHYSICS.metersPerTile;
const terrain = flatTerrain(64);
const kill = (chassisId: string, id = 'wreck-npc7'): Obstacle => ({ id, pos: { x: 20, y: 20 }, r: 0.9, kind: 'wreck', hulk: { chassisId, yaw: 0 } });

function hulk(o: Obstacle): THREE.Group {
  const g = buildHulk(terrain, o, propPose(o) as HulkPose);
  g.updateMatrixWorld(true);
  return g;
}

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

function positions(g: THREE.Object3D): number[] {
  return meshes(g).flatMap((m) => [...(m.geometry.getAttribute('position').array as Float32Array)]);
}

describe('hulks', () => {
  it('draws each chassis at its own size, lying on the ground', () => {
    const buggy = new THREE.Box3().setFromObject(hulk(kill('buggy')));
    const bus = new THREE.Box3().setFromObject(hulk(kill('bus')));
    const ground = terrain.heights[0] * S;

    expect(bus.max.x - bus.min.x).toBeGreaterThan(buggy.max.x - buggy.min.x + 2);
    for (const box of [buggy, bus]) {
      expect(box.min.y).toBeLessThan(ground + 0.15);
      expect(box.min.y).toBeGreaterThan(ground - 0.6);
    }
  });

  it('keeps no faction paint and no light', () => {
    const paints = new Set(Object.values(FACTION_COLORS).flatMap((c) => [c.top, c.side, c.cab, c.cabSide]));
    for (const m of meshes(hulk(kill('bus')))) {
      const mat = m.material as THREE.MeshLambertMaterial;
      expect(paints.has(mat.color.getHex())).toBe(false);
      expect(mat.emissive.getHex()).toBe(0);
    }
  });

  it('builds the same jag and tilt for the same id, and another for another id', () => {
    expect(positions(hulk(kill('buggy')))).toEqual(positions(hulk(kill('buggy'))));
    expect(positions(hulk(kill('buggy', 'wreck-npc8')))).not.toEqual(positions(hulk(kill('buggy'))));
  });
});
