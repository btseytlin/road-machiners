import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type MeshLambertMaterial, type Object3D } from 'three';
import { loadModels } from './models';
import { buildSites, gateGunPoint } from './sites';
import { FORTRESS } from '../../data/fortress';
import { PAL } from '../../render/palette';
import { guardedSites } from '../../sim/guards';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { insideCurtain } from '../../sim/fortress';
import { isFortress, siteGates } from '../../sim/sites';
import { heightAt, type Terrain } from '../../sim/terrain';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const sites = buildSites({ size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] });

const ALL = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
const ABANDONED = ALL.filter((s) => !isFortress(s));

function measureSite(id: string): Vector3 {
  const site = sites.getObjectByName(`landmark-${id}`);
  if (!site) throw new Error(`Missing site ${id}`);
  return new Box3().setFromObject(site).getSize(new Vector3());
}

// Pieces marked outsideEdge, like Canyon Bridge, lie outside their site on purpose.
function outsideEdge(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.outsideEdge) return true;
  return false;
}

describe('landmark scale', () => {
  it('builds inhabited settlements rather than truck-sized props', () => {
    for (const id of ['bowl', 'nose']) {
      const size = measureSite(id);
      expect(size.x).toBeGreaterThan(100);
      expect(size.z).toBeGreaterThan(100);
      expect(sites.getObjectByName(`landmark-${id}`)!.userData.homes).toBeGreaterThan(15);
    }
  });

  it('draws no edge for a fortress site, whose curtain is baked (IV7)', () => {
    for (const site of ALL.filter(isFortress)) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      expect(group.userData.wallSections, site.id).toBeUndefined();
      expect(group.userData.gates, site.id).toBeUndefined();
    }
  });

  it('keeps the edge of every abandoned site', () => {
    expect(ABANDONED.length).toBeGreaterThan(0);
    for (const site of ABANDONED) expect(sites.getObjectByName(`landmark-${site.id}`)!.userData.wallSections, site.id).toBeGreaterThan(0);
  });

  it('closes every abandoned site with shut doors at each gate', () => {
    for (const site of ABANDONED) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      expect(group.userData.wallSections, site.id).toBeGreaterThan(5);
      expect(group.userData.gates, site.id).toBe(siteGates(site).length);
      expect(group.userData.doors, site.id).toBe(2 * siteGates(site).length);
    }
  });

  it('draws each abandoned edge on the collision edge, at most 1.5 tiles thick', () => {
    for (const site of ABANDONED) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      const reach = group.userData.edgeReach as [number, number];
      expect(reach[0], site.id).toBeGreaterThan(site.radius - 1.5);
      expect(reach[1], site.id).toBeLessThanOrEqual(site.radius + 0.01);
    }
  });

  it('keeps every pulled-in interior piece at its height over the ground on a slope', () => {
    const size = 800;
    const heights = Array.from({ length: (size + 1) ** 2 }, (_, k) => 0.004 * (k % (size + 1)) + 0.003 * Math.floor(k / (size + 1)));
    const slope: Terrain = { size, heights, types: Array.from({ length: size * size }, () => 'hardpan' as const) };
    const sloped = buildSites(slope);
    for (const site of ALL.filter(isFortress)) {
      const flat = sites.getObjectByName(`landmark-${site.id}`)!.children;
      const hill = sloped.getObjectByName(`landmark-${site.id}`)!.children;
      expect(hill.length, site.id).toBe(flat.length);
      hill.forEach((child, i) => {
        if (child.userData.gateFurniture) return;
        const ground = heightAt(slope, child.position.x / PHYSICS.metersPerTile, child.position.z / PHYSICS.metersPerTile) * PHYSICS.metersPerTile;
        expect(child.position.y - ground, `${site.id} child ${i}`).toBeCloseTo(flat[i].position.y, 4);
      });
    }
  });

  it('keeps every vertex of a fortress interior inside its curtain, inset by half a wall depth (IV8)', () => {
    const v = new Vector3();
    const m = new Matrix4();
    for (const site of ALL.filter(isFortress)) {
      const bad: string[] = [];
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (!(o instanceof Mesh) || o.userData.gateFurniture) return;
        o.updateWorldMatrix(true, false);
        const pos = o.geometry.getAttribute('position');
        const copies = o instanceof InstancedMesh ? o.count : 1;
        for (let k = 0; k < copies; k++) {
          const at = o.matrixWorld.clone();
          if (o instanceof InstancedMesh) at.multiply(o.getMatrixAt(k, m));
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(at);
            if (!insideCurtain(site, { x: v.x / PHYSICS.metersPerTile, y: v.z / PHYSICS.metersPerTile })) {
              bad.push(`${o.name || o.geometry.type} at ${(v.x / PHYSICS.metersPerTile - site.pos.x).toFixed(1)},${(v.z / PHYSICS.metersPerTile - site.pos.y).toFixed(1)}`);
              return;
            }
          }
        }
      });
      expect(bad.slice(0, 5), `${site.id}: ${bad.length} outside`).toEqual([]);
    }
  });

  it('hangs two lit lamps within one gate width of every gate (IV11, IV7)', () => {
    const S = PHYSICS.metersPerTile;
    for (const site of ALL) {
      const lit: Vector3[] = [];
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (o instanceof Mesh && (o.material as MeshLambertMaterial).color.getHex() === PAL.lamp.on) lit.push(o.position.clone());
      });
      for (const gate of siteGates(site)) {
        const near = lit.filter((p) => Math.hypot(p.x / S - gate.x, p.z / S - gate.y) <= FORTRESS.gate.width);
        expect(near.length, `${site.id} gate at ${gate.x.toFixed(0)},${gate.y.toFixed(0)}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('sights the gate gun over the gate point at the gatehouse top (IV12)', () => {
    const flat = { size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] } as Terrain;
    const p = gateGunPoint(flat, { x: 0.5, y: 0.5 });
    expect(p.y).toBeCloseTo((FORTRESS.gate.height + FORTRESS.gunLift) * PHYSICS.metersPerTile, 5);
    expect(p.x).toBeCloseTo(0.5 * PHYSICS.metersPerTile, 5);
  });

  it('puts the gate gun of each guarded gate at the gun point, and no gun at the other sites (IV12)', () => {
    const S = PHYSICS.metersPerTile;
    const guarded = guardedSites();
    const flat = { size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] } as Terrain;
    for (const site of ALL.filter(isFortress)) {
      const metal: Mesh[] = [];
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (o instanceof Mesh && o.userData.gateFurniture && (o.material as MeshLambertMaterial).color.getHex() === PAL.metal && o.geometry.parameters.width === 0.8 * S) metal.push(o);
      });
      if (!guarded.includes(site)) {
        expect(metal, site.id).toHaveLength(0);
        continue;
      }
      expect(metal, site.id).toHaveLength(siteGates(site).length);
      for (const gate of siteGates(site)) {
        const muzzle = gateGunPoint(flat, gate);
        const gun = metal.find((o) => Math.hypot(o.position.x - muzzle.x, o.position.z - muzzle.z) <= 0.8 * S)!;
        const half = new Vector3(0.4 * S, 0, 0).applyQuaternion(gun.quaternion);
        const ends = [gun.position.clone().add(half), gun.position.clone().sub(half)];
        const far = Math.min(...ends.map((e) => Math.hypot(e.x - muzzle.x, e.z - muzzle.z)));
        expect(far, `${site.id} muzzle`).toBeLessThanOrEqual(0.3);
        expect(gun.position.y - muzzle.y, `${site.id} height`).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('keeps everything a truck could touch inside the edge of an abandoned site', () => {
    const S = PHYSICS.metersPerTile;
    const reach = 1; // tiles above the ground a truck body reaches
    const v = new Vector3();
    const m = new Matrix4();
    for (const site of ABANDONED) {
      let worst = 0;
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (!(o instanceof Mesh) || outsideEdge(o)) return;
        o.updateWorldMatrix(true, false);
        const pos = o.geometry.getAttribute('position');
        const copies = o instanceof InstancedMesh ? o.count : 1;
        for (let k = 0; k < copies; k++) {
          const at = o.matrixWorld.clone();
          if (o instanceof InstancedMesh) at.multiply(o.getMatrixAt(k, m));
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(at);
            if (v.y > reach * S) continue;
            worst = Math.max(worst, Math.hypot(v.x / S - site.pos.x, v.z / S - site.pos.y) - site.radius);
          }
        }
      });
      expect.soft(worst, site.id).toBeLessThanOrEqual(0.05);
    }
  });
});
