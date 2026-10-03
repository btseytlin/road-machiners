// Crater tracks: twin dirt ruts along each territory track, draped on the baked heights. Decoration only: trucks
// drive the ground under them, and nav, roads and NPCs never read them. Track lines come from src/sim/territory.ts,
// the owner the bake reads, so debris keeps clear of the ruts it draws around.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { PAL } from '../../render/palette';
import { isTerritory, territoryTracks } from '../../sim/territory';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Vec } from '../../sim/vec';
import { RenderScope, type SightLimit } from './scope';

const S = PHYSICS.metersPerTile;
export const RUT_LIFT = 0.05; // meters a rut floats over the ground, so the ground never shows through it
const RUT_GAP = 0.45; // tiles from the track's middle line to each rut's middle, a wide wheel track that reads from the camera
const RUT_WIDTH = 0.35; // tiles across one rut
const STEP = 0.5; // tiles between rut samples, so a rut follows the ground between corners
const PIECE = 16; // tiles of track per culled piece

// The ruts get their own scope under root: they grey out of sight like props, but take no prop outline, since
// outlines mark PROP_BIT and that stencil bit belongs to props.
export function addCraterTracks(t: Terrain, root: THREE.Object3D, limit: SightLimit): RenderScope {
  const scope = new RenderScope(root, t.size, limit, true, false);
  const material = new THREE.MeshLambertMaterial({ color: PAL.rut, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const territory of REGION.locations.filter(isTerritory)) {
    for (const track of territoryTracks(territory)) {
      for (const piece of pieces(samples(track))) {
        const mesh = new THREE.Mesh(rutGeometry(t, piece), material);
        mesh.name = 'crater-track';
        mesh.receiveShadow = true;
        const mid = piece[Math.floor(piece.length / 2)];
        scope.add(mesh, mid, PIECE / 2 + RUT_GAP + RUT_WIDTH);
      }
    }
  }
  return scope;
}

// The two rut strips along a line of samples, as one geometry in meters.
export function rutGeometry(t: Terrain, line: readonly Vec[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (const side of [-1, 1]) {
    const base = positions.length / 3;
    line.forEach((p, i) => {
      const n = normalAt(line, i);
      for (const edge of [-1, 1]) {
        const off = side * RUT_GAP + (edge * RUT_WIDTH) / 2;
        const x = p.x + n.x * off;
        const y = p.y + n.y * off;
        positions.push(x * S, heightAt(t, x, y) * S + RUT_LIFT, y * S);
      }
      if (i === 0) return;
      const a = base + (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// The unit normal to the line at sample i, to its left.
function normalAt(line: readonly Vec[], i: number): Vec {
  const a = line[Math.max(0, i - 1)];
  const b = line[Math.min(line.length - 1, i + 1)];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

// Points every STEP tiles along the line, with both ends.
function samples(line: readonly Vec[]): Vec[] {
  const out: Vec[] = [line[0]];
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

// Runs of samples about PIECE tiles long that share their end points, so the ruts stay joined.
function pieces(line: readonly Vec[]): Vec[][] {
  const per = Math.round(PIECE / STEP);
  const out: Vec[][] = [];
  for (let i = 0; i < line.length - 1; i += per) out.push(line.slice(i, i + per + 1));
  return out;
}
