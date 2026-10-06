import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type MeshLambertMaterial, type Object3D } from 'three';
import { loadModels } from './models';
import { buildSites, gateGunPoint } from './sites';
import { FORTRESS } from '../../data/fortress';
import { PAL } from '../../render/palette';
import { guardedSites } from '../../sim/guards';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { fortressGates, insideCurtain, onFortressRock, pitDepth } from '../../sim/fortress';
import { GATE_CLEAR, riseFront } from './interiors/nose';
import { boxDistance, propBoxes, propObstacle, propShape } from '../../sim/mapgen';
import { noseRocks } from '../../sim/nose';
import { isFortress, siteGates } from '../../sim/sites';
import { heightAt, type Terrain } from '../../sim/terrain';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const { root: sites, movers } = buildSites({ size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] });

// The ship's belly stands at least one wall height over the yard, 16 m.
const FORTRESS_WALL_TILES = 4;
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

  it('counts each Nose shelter as a home', () => {
    const group = sites.getObjectByName('landmark-nose')!;
    let shelters = 0;
    group.traverse((o) => {
      if (o.name === 'nose-shelters') shelters += (o.children[0] as InstancedMesh).count;
    });
    expect(shelters).toBeGreaterThan(40);
    expect(group.userData.homes).toBe(shelters);
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
    const sloped = buildSites(slope).root;
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

  it('keeps every vertex of a fortress interior inside its curtain, inset by half a wall depth, or in its rock (IV8)', () => {
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
            const p = { x: v.x / PHYSICS.metersPerTile, y: v.z / PHYSICS.metersPerTile };
            // Where rock closes the curtain, a piece may run on into the rock.
            if (!insideCurtain(site, p) && !onFortressRock(site, p)) {
              bad.push(`${o.name || o.geometry.type} at ${(v.x / PHYSICS.metersPerTile - site.pos.x).toFixed(1)},${(v.z / PHYSICS.metersPerTile - site.pos.y).toFixed(1)}`);
              return;
            }
          }
        }
      });
      expect(bad.slice(0, 5), `${site.id}: ${bad.length} outside`).toEqual([]);
    }
  });

  it('hangs two lit lamps within one gate width of every gate face (IV11, IV7)', () => {
    const S = PHYSICS.metersPerTile;
    for (const site of ALL) {
      const lit: Vector3[] = [];
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (o instanceof Mesh && (o.material as MeshLambertMaterial).color.getHex() === PAL.lamp.on) lit.push(o.position.clone());
      });
      const faces = isFortress(site) ? fortressGates(site).map((g) => ({ at: g.face, width: g.width })) : siteGates(site).map((g) => ({ at: g, width: REGION.settlement.gateWidth }));
      for (const face of faces) {
        const near = lit.filter((p) => Math.hypot(p.x / S - face.at.x, p.z / S - face.at.y) <= face.width);
        expect(near.length, `${site.id} gate at ${face.at.x.toFixed(0)},${face.at.y.toFixed(0)}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('lights every lit lamp box with its own color (IV21)', () => {
    let lamps = 0;
    sites.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const material = o.material as MeshLambertMaterial;
      if (material.color.getHex() !== PAL.lamp.on) return;
      expect(material.emissive.getHex(), o.parent?.name).toBe(PAL.lamp.on);
      lamps++;
    });
    expect(lamps).toBeGreaterThan(0);
  });

  it('sights the gate gun over the gate face at the gatehouse top (IV12)', () => {
    const S = PHYSICS.metersPerTile;
    const flat = { size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] } as Terrain;
    for (const site of guardedSites().filter(isFortress)) {
      for (const g of fortressGates(site)) {
        const p = gateGunPoint(flat, site, g.gate);
        expect(p.y, site.id).toBeCloseTo((g.height + FORTRESS.gunLift) * S, 5);
        expect(p.x, site.id).toBeCloseTo(g.face.x * S, 5);
        expect(p.z, site.id).toBeCloseTo(g.face.y * S, 5);
      }
    }
  });

  it('throws for a gun point at no gate of the site', () => {
    const flat = { size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] } as Terrain;
    const bowl = ALL.find((s) => s.id === 'bowl')!;
    expect(() => gateGunPoint(flat, bowl, { x: bowl.pos.x, y: bowl.pos.y })).toThrow(/no gate/);
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
        const muzzle = gateGunPoint(flat, site, gate);
        const gun = metal.find((o) => Math.hypot(o.position.x - muzzle.x, o.position.z - muzzle.z) <= 0.8 * S)!;
        const half = new Vector3(0.4 * S, 0, 0).applyQuaternion(gun.quaternion);
        const ends = [gun.position.clone().add(half), gun.position.clone().sub(half)];
        const far = Math.min(...ends.map((e) => Math.hypot(e.x - muzzle.x, e.z - muzzle.z)));
        expect(far, `${site.id} muzzle`).toBeLessThanOrEqual(0.3);
        expect(gun.position.y - muzzle.y, `${site.id} height`).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('hands out each moving part once, from inside its site (IV20)', () => {
    const nodes = movers.map((m) => m.node);
    expect(new Set(nodes).size).toBe(nodes.length);
    for (const { node } of movers) {
      let site: Object3D | null = node;
      while (site !== null && !site.name.startsWith('landmark-')) site = site.parent;
      expect(site, node.name).not.toBeNull();
    }
  });

  it('stands every Bowl house, tree and crop row on one pit level across its footprint (IV18)', () => {
    const S = PHYSICS.metersPerTile;
    const bowl = ALL.find((s) => s.id === 'bowl')!;
    const counts: Record<string, number> = { 'bowl-houses': 0, 'bowl-trees': 0, 'bowl-crops': 0 };
    const m = new Matrix4();
    sites.getObjectByName('landmark-bowl')!.traverse((o) => {
      const tag = [o.name, o.parent?.name].find((n) => n !== undefined && n in counts);
      if (!(o instanceof InstancedMesh) || tag === undefined) return;
      o.updateWorldMatrix(true, false);
      o.geometry.computeBoundingBox();
      for (let k = 0; k < o.count; k++) {
        const box = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld.clone().multiply(o.getMatrixAt(k, m)));
        const xs = [box.min.x / S, box.max.x / S, (box.min.x + box.max.x) / 2 / S];
        const ys = [box.min.z / S, box.max.z / S, (box.min.z + box.max.z) / 2 / S];
        const depths = new Set(xs.flatMap((x) => ys.map((y) => pitDepth(bowl, { x, y }))));
        expect(depths.size, `${tag} ${k} at ${(xs[2] - bowl.pos.x).toFixed(1)},${(ys[2] - bowl.pos.y).toFixed(1)}`).toBe(1);
        counts[tag]++;
      }
    });
    for (const [tag, n] of Object.entries(counts)) expect(n, tag).toBeGreaterThan(10);
  });

  it('turns the Bowl windmill wheel as its one moving part, inside the site over its whole turn (IV20)', () => {
    const S = PHYSICS.metersPerTile;
    const bowl = ALL.find((s) => s.id === 'bowl')!;
    const own = movers.filter(({ node }) => {
      let p: Object3D | null = node;
      while (p !== null && p.name !== 'landmark-bowl') p = p.parent;
      return p !== null;
    });
    expect(own.map((m) => m.node.name)).toEqual(['windmill-rotor']);
    const { node, motion } = own[0];
    const rest = { position: node.position.clone(), quaternion: node.quaternion.clone() };
    for (const seconds of [0, 0.75, 1.5, 2.25]) {
      motion(seconds, node, rest);
      node.updateMatrix();
      const box = new Box3().setFromObject(node);
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) expect(Math.hypot(x / S - bowl.pos.x, z / S - bowl.pos.y)).toBeLessThan(bowl.radius);
    }
    motion(0, node, rest);
    node.updateMatrix();
  });

  it('rocks the Dustwell pumpjack beam as its one moving part, inside the curtain at rest and at both ends of its stroke (IV8, IV20)', () => {
    const S = PHYSICS.metersPerTile;
    const dustwell = ALL.find((s) => s.id === 'dustwell')!;
    const own = movers.filter(({ node }) => {
      let p: Object3D | null = node;
      while (p !== null && p.name !== 'landmark-dustwell') p = p.parent;
      return p !== null;
    });
    expect(own.map((m) => m.node.name)).toEqual(['pumpjack-beam']);
    const { node, motion } = own[0];
    const rest = { position: node.position.clone(), quaternion: node.quaternion.clone() };
    const v = new Vector3();
    // The 6 s stroke is at rest at 0 s and at its ends at 1.5 s and 4.5 s.
    const tilts: number[] = [];
    for (const seconds of [0, 1.5, 4.5]) {
      motion(seconds, node, rest);
      node.updateMatrix();
      node.updateWorldMatrix(true, true);
      tilts.push(node.quaternion.angleTo(rest.quaternion));
      const outside: string[] = [];
      node.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (!insideCurtain(dustwell, { x: v.x / S, y: v.z / S })) outside.push(`${(v.x / S - dustwell.pos.x).toFixed(2)},${(v.z / S - dustwell.pos.y).toFixed(2)}`);
          expect(v.y, `beam at ${seconds} s`).toBeGreaterThan(0);
        }
      });
      expect(outside.slice(0, 3), `beam at ${seconds} s`).toEqual([]);
    }
    expect(tilts[0]).toBeCloseTo(0, 5);
    expect(tilts[1]).toBeCloseTo((18 * Math.PI) / 180, 3);
    expect(tilts[2]).toBeCloseTo((18 * Math.PI) / 180, 3);
    motion(0, node, rest);
    node.updateMatrix();
  });

  it('stands one pumpjack, three storage tanks and a shed with a shut door and a lit lantern inside Dustwell (IV22)', () => {
    const group = sites.getObjectByName('landmark-dustwell')!;
    const named = (name: string) => {
      const found: Object3D[] = [];
      group.traverse((o) => {
        if (o.name === name) found.push(o);
      });
      return found;
    };
    expect(named('pumpjack')).toHaveLength(1);
    expect(named('pumpjack-beam')).toHaveLength(1);
    expect(named('dustwell-shed')).toHaveLength(1);
    expect(named('dustwell-tank')).toHaveLength(3);
    const door = named('dustwell-shed-door');
    expect(door).toHaveLength(1);
    expect(((door[0] as Mesh).material as MeshLambertMaterial).emissive.getHex(), 'a shut door does not glow').toBe(0);
    const lamp = (named('dustwell-shed-lamp')[0] as Mesh).material as MeshLambertMaterial;
    expect(lamp.color.getHex()).toBe(PAL.lamp.on);
    expect(lamp.emissive.getHex()).toBe(PAL.lamp.on);
  });

  it('runs the Granary sacks up the conveyor as its one moving part, inside the curtain over the whole loop (IV8, IV20)', () => {
    const S = PHYSICS.metersPerTile;
    const granary = ALL.find((s) => s.id === 'granary')!;
    const own = movers.filter(({ node }) => {
      let p: Object3D | null = node;
      while (p !== null && p.name !== 'landmark-granary') p = p.parent;
      return p !== null;
    });
    expect(own.map((m) => m.node.name)).toEqual(['granary-sacks']);
    const { node, motion } = own[0];
    expect(node.children).toHaveLength(4);
    // The sacks ride on top of the belt, not under it.
    node.updateWorldMatrix(true, false);
    expect(new Vector3(0, 1, 0).transformDirection(node.matrixWorld).y).toBeGreaterThan(0.7);
    const rest = { position: node.position.clone(), quaternion: node.quaternion.clone() };
    const v = new Vector3();
    // 4 sacks on a belt about 12 m long ride one 3 m spacing per loop at 0.6 m/s, so a loop is about 5 s.
    const heights: number[] = [];
    for (const seconds of [0, 2.4, 4.9]) {
      motion(seconds, node, rest);
      node.updateMatrix();
      node.updateWorldMatrix(true, true);
      heights.push(node.position.y);
      const outside: string[] = [];
      node.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (!insideCurtain(granary, { x: v.x / S, y: v.z / S })) outside.push(`${(v.x / S - granary.pos.x).toFixed(2)},${(v.z / S - granary.pos.y).toFixed(2)}`);
        }
      });
      expect(outside.slice(0, 3), `sacks at ${seconds} s`).toEqual([]);
    }
    // The sacks climb the belt through the loop.
    expect(heights[1]).toBeGreaterThan(heights[0] + 0.5);
    expect(heights[2]).toBeGreaterThan(heights[1] + 0.5);
    motion(0, node, rest);
    node.updateMatrix();
  });

  it('stands four silos, an elevator, two shelters with a lit lamp and four grain bins inside the Granary', () => {
    const group = sites.getObjectByName('landmark-granary')!;
    const count = (name: string) => {
      let n = 0;
      group.traverse((o) => {
        if (o.name === name) n++;
      });
      return n;
    };
    expect(count('granary-silo')).toBe(4);
    expect(count('granary-elevator')).toBe(1);
    expect(count('granary-belt')).toBe(1);
    expect(count('granary-shelter')).toBe(2);
    expect(count('granary-bin')).toBe(4);
    const shelter = group.getObjectByName('granary-shelter')!;
    const glowing: number[] = [];
    shelter.traverse((o) => {
      if (o instanceof Mesh) glowing.push(...[o.material].flat().map((m) => (m as MeshLambertMaterial).emissive.getHex()));
    });
    expect(glowing).toContain(PAL.lamp.on);
  });

  it('slews the Salvage Yard crane and hoists its grab, inside the curtain at rest and at both ends of the slew (IV8, IV20)', () => {
    const S = PHYSICS.metersPerTile;
    const yard = ALL.find((s) => s.id === 'salvage-yard')!;
    const own = movers.filter(({ node }) => {
      let p: Object3D | null = node;
      while (p !== null && p.name !== 'landmark-salvage-yard') p = p.parent;
      return p !== null;
    });
    expect(own.map((m) => m.node.name)).toEqual(['crane-upper', 'crane-grab']);
    const [upper, grab] = own;
    expect(grab.node.parent).toBe(upper.node);
    const rests = own.map(({ node }) => ({ position: node.position.clone(), quaternion: node.quaternion.clone() }));
    const v = new Vector3();
    // The 14 s slew is at rest at 0 s and at its ends at 3.5 s and 10.5 s. The 7 s hoist is at its top at both ends.
    const turns: number[] = [];
    const lifts: number[] = [];
    for (const seconds of [0, 3.5, 10.5]) {
      own.forEach(({ node, motion }, i) => {
        motion(seconds, node, rests[i]);
        node.updateMatrix();
      });
      upper.node.updateWorldMatrix(true, true);
      turns.push(upper.node.quaternion.angleTo(rests[0].quaternion));
      lifts.push(grab.node.position.y - rests[1].position.y);
      const outside: string[] = [];
      upper.node.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (!insideCurtain(yard, { x: v.x / S, y: v.z / S })) outside.push(`${o.name} ${(v.x / S - yard.pos.x).toFixed(2)},${(v.z / S - yard.pos.y).toFixed(2)}`);
        }
      });
      expect(outside.slice(0, 3), `crane at ${seconds} s`).toEqual([]);
    }
    expect(turns[0]).toBeCloseTo(0, 5);
    expect(turns[1]).toBeCloseTo((35 * Math.PI) / 180, 3);
    expect(turns[2]).toBeCloseTo((35 * Math.PI) / 180, 3);
    expect(lifts[0]).toBeCloseTo(0, 5);
    expect(lifts[1]).toBeCloseTo(2, 3);
    own.forEach(({ node, motion }, i) => {
      motion(0, node, rests[i]);
      node.updateMatrix();
    });
  });

  it('stands a crane, stacked wrecks, a tall tank, a container, a jeep and a shed with a shut door and a lit lantern inside the Salvage Yard (IV22)', () => {
    const group = sites.getObjectByName('landmark-salvage-yard')!;
    const named = (name: string) => {
      const found: Object3D[] = [];
      group.traverse((o) => {
        if (o.name === name) found.push(o);
      });
      return found;
    };
    expect(named('salvage-crane')).toHaveLength(1);
    expect(named('salvage-stack').length).toBeGreaterThanOrEqual(3);
    expect(named('salvage-tank')).toHaveLength(1);
    expect(named('salvage-container')).toHaveLength(1);
    expect(named('salvage-jeep')).toHaveLength(1);
    expect(named('salvage-shed')).toHaveLength(1);
    const door = named('salvage-shed-door');
    expect(door).toHaveLength(1);
    expect(((door[0] as Mesh).material as MeshLambertMaterial).emissive.getHex(), 'a shut door does not glow').toBe(0);
    const lamp = (named('salvage-shed-lamp')[0] as Mesh).material as MeshLambertMaterial;
    expect(lamp.emissive.getHex()).toBe(PAL.lamp.on);
    const cab: number[] = [];
    named('crane-upper')[0].traverse((o) => {
      if (o instanceof Mesh) cab.push(...[o.material].flat().map((m) => (m as MeshLambertMaterial).emissive.getHex()));
    });
    expect(cab).toContain(PAL.lamp.on);
  });

  it('turns the Nose radar dish as its one moving part, inside the curtain over its whole turn (IV8, IV20)', () => {
    const S = PHYSICS.metersPerTile;
    const nose = ALL.find((s) => s.id === 'nose')!;
    const own = movers.filter(({ node }) => {
      let p: Object3D | null = node;
      while (p !== null && p.name !== 'landmark-nose') p = p.parent;
      return p !== null;
    });
    expect(own.map((m) => m.node.name)).toEqual(['nose-radar-dish']);
    const { node, motion } = own[0];
    const rest = { position: node.position.clone(), quaternion: node.quaternion.clone() };
    const v = new Vector3();
    // The 8 s turn passes a quarter turn every 2 s.
    const turns: number[] = [];
    for (const seconds of [0, 2, 4, 6]) {
      motion(seconds, node, rest);
      node.updateMatrix();
      node.updateWorldMatrix(true, true);
      turns.push(node.quaternion.angleTo(rest.quaternion));
      const outside: string[] = [];
      node.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (!insideCurtain(nose, { x: v.x / S, y: v.z / S })) outside.push(`${(v.x / S - nose.pos.x).toFixed(2)},${(v.z / S - nose.pos.y).toFixed(2)}`);
        }
      });
      expect(outside.slice(0, 3), `dish at ${seconds} s`).toEqual([]);
    }
    expect(turns.map((t) => +t.toFixed(3))).toEqual([0, +(Math.PI / 2).toFixed(3), +Math.PI.toFixed(3), +(Math.PI / 2).toFixed(3)]);
    motion(0, node, rest);
    node.updateMatrix();
  });

  describe('Nose from its concept (IV8, IV27-IV29)', () => {
    const S = PHYSICS.metersPerTile;
    const nose = ALL.find((s) => s.id === 'nose')!;
    const group = sites.getObjectByName('landmark-nose')!;
    const gates = fortressGates(nose);
    const south = gates[0].out.y > gates[1].out.y ? gates[0] : gates[1];
    // The ship's frame in tiles from the center: u along the ship toward its nose, v back from the south gate.
    const uAxis = { x: -south.out.y, y: south.out.x };
    const toFrame = (p: { x: number; y: number }) => ({ u: (p.x - nose.pos.x) * uAxis.x + (p.y - nose.pos.y) * uAxis.y, v: -((p.x - nose.pos.x) * south.out.x + (p.y - nose.pos.y) * south.out.y) });
    const discs = gates.map((g) => ({ ...toFrame(g.face), r: g.width / 2 + GATE_CLEAR }));
    // The rise and the crag are baked props: a point is under them where their collision boxes stand.
    const rockBoxes = noseRocks(nose).flatMap((p, k) => propBoxes(propObstacle(p, k)));
    const inRise = (p: { x: number; y: number }) => rockBoxes.some((b) => boxDistance(b, p) === 0);
    // Interior points on a 1 tile grid, a tile in from the curtain's wall.
    const interior: { x: number; y: number; u: number; v: number }[] = [];
    for (let x = Math.floor(nose.pos.x - nose.radius); x <= nose.pos.x + nose.radius; x++) {
      for (let y = Math.floor(nose.pos.y - nose.radius); y <= nose.pos.y + nose.radius; y++) {
        if (insideCurtain(nose, { x, y }, 1)) interior.push({ x, y, ...toFrame({ x, y }) });
      }
    }

    it('keeps every Nose mesh inside the curtain, or in the rock where the rock closes it (IV8)', () => {
      const v = new Vector3();
      const outside: string[] = [];
      group.updateWorldMatrix(true, true);
      group.traverse((o) => {
        if (!(o instanceof Mesh) || o instanceof InstancedMesh) return;
        // The gate furniture, lamps and guns, stands on the curtain on purpose. Everything Nose's interior adds is named nose-.
        let ours = false;
        for (let p: Object3D | null = o; p !== null; p = p.parent) ours = ours || p.name.startsWith('nose-');
        if (!ours) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const p = { x: v.x / S, y: v.z / S };
          if (!insideCurtain(nose, p) && !onFortressRock(nose, p)) outside.push(`${o.name || o.parent?.name} ${(v.x / S - nose.pos.x).toFixed(1)},${(v.z / S - nose.pos.y).toFixed(1)}`);
        }
      });
      expect(outside.slice(0, 5)).toEqual([]);
    });

    it('stands the ship on the rise, pitched nose-up, its belly a wall height over the yard (IV28)', () => {
      const frame = group.getObjectByName('nose-frame')!;
      const ship = group.getObjectByName('nose-ship')!;
      frame.updateWorldMatrix(true, true);
      expect((ship.rotation.z * 180) / Math.PI).toBeGreaterThanOrEqual(6);
      expect((ship.rotation.z * 180) / Math.PI).toBeLessThanOrEqual(10);
      const inFrame = new Matrix4().copy(frame.matrixWorld).invert();
      const v = new Vector3();
      let belly = Infinity;
      const shipBox = new Box3();
      const nose0 = ship.children.find((o) => o.name === 'nose-ship-section')!;
      const dish = group.getObjectByName('nose-radar-dish')!;
      for (const section of ship.children) {
        section.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          for (let d: Object3D | null = o; d !== null; d = d.parent) if (d === dish) return;
          const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            if (section === nose0) belly = Math.min(belly, v.y);
            shipBox.expandByPoint(v.applyMatrix4(inFrame));
          }
        });
      }
      expect(belly / S, 'the lowest point of ship_nose').toBeGreaterThanOrEqual(FORTRESS_WALL_TILES);
      // The ship's length along its axis against the curtain's diameter.
      const diameter = 2 * (nose.radius - FORTRESS.inset) * S;
      const length = shipBox.max.x - shipBox.min.x;
      expect(length / diameter).toBeGreaterThanOrEqual(0.7);
      expect(length / diameter).toBeLessThanOrEqual(0.8);
      // The ship's box, in the frame's meters with +y toward the gate, clears both gate discs.
      // The open ground at a gate: half its width and 1.5 tiles more.
      for (const d of discs.map((x) => ({ ...x, r: x.r - GATE_CLEAR + 1.5 }))) {
        const gx = d.u * S;
        const gy = -d.v * S;
        const dx = Math.max(shipBox.min.x - gx, 0, gx - shipBox.max.x);
        const dz = Math.max(shipBox.min.z - -gy, 0, -gy - shipBox.max.z);
        expect(Math.hypot(dx, dz), 'the ship box to a gate disc').toBeGreaterThanOrEqual(d.r * S);
      }
    });

    it('covers 35 to 55% of the interior with the rise and crag, all behind the front edge, and tops the crag over the towers (IV29)', () => {
      const covered = interior.filter((p) => inRise(p));
      expect(covered.length / interior.length).toBeGreaterThanOrEqual(0.35);
      expect(covered.length / interior.length).toBeLessThanOrEqual(0.55);
      // A merged box may reach a little past the rock's front edge.
      for (const p of covered) expect(p.v, `${p.u}, ${p.v}`).toBeGreaterThan(riseFront(p.u) - 0.5);
      expect(Math.max(...propShape('nose_crag').map((b) => b.z1))).toBeGreaterThanOrEqual(1.5 * 22);
    });

    it('builds the yard up: no yard point is more than 4 tiles from a structure (IV27)', () => {
      const structures = group.userData.structures as { x: number; z: number; r: number }[];
      const yard = interior.filter((p) => !inRise(p) && !discs.some((d) => Math.hypot(p.u - d.u, p.v - d.v) < d.r));
      expect(yard.length).toBeGreaterThan(500);
      const bare = yard.filter((p) => structures.every((s) => Math.hypot(p.x - nose.pos.x - s.x, p.y - nose.pos.y - s.z) - s.r > 4));
      expect(bare.slice(0, 5).map((p) => `${p.u.toFixed(0)},${p.v.toFixed(0)}`)).toEqual([]);
    });
  });

  it('lights the Nose shelter lamps and the cockpit windows (IV22)', () => {
    const group = sites.getObjectByName('landmark-nose')!;
    const glowsIn = (name: string) => {
      const found: number[] = [];
      group.traverse((o) => {
        if (o.name !== name) return;
        o.traverse((m) => {
          if (m instanceof Mesh) found.push(...[m.material].flat().map((x) => (x as MeshLambertMaterial).emissive.getHex()));
        });
      });
      return found;
    };
    expect(glowsIn('nose-shelters')).toContain(PAL.lamp.on);
    const nose = group.getObjectByName('nose-ship')!.children[0];
    const cockpit: number[] = [];
    const dish = group.getObjectByName('nose-radar-dish')!;
    nose.traverse((m) => {
      let inDish = false;
      for (let p: Object3D | null = m; p !== null; p = p.parent) if (p === dish) inDish = true;
      if (m instanceof Mesh && !inDish) cockpit.push(...[m.material].flat().map((x) => (x as MeshLambertMaterial).emissive.getHex()));
    });
    expect(cockpit).toContain(PAL.lamp.on);
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
