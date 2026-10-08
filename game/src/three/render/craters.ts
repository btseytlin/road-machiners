// Blast craters on the map: a scorched disc draped on the ground and a low ring of thrown dirt. The rim stands on
// the same points and as high as the physics rim (craterColliders() in src/phys/drive.ts), so the bump a truck feels
// is the one drawn. Craters live in their own render scope, which greys them in gray vision like props but adds no

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CRATER } from '../../data/rules';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { craterReach, craterRimPoints } from '../../sim/craters';
import { groundAt, markHeightAt, type Terrain } from '../../sim/terrain';
import type { Crater, World } from '../../sim/types';
import { dist, type Vec } from '../../sim/vec';
import { RenderScope, type SightLimit } from './scope';

const S = PHYSICS.metersPerTile;
const LIFT = 0.06;
const SECTORS = 16;
const SCORCH = [
  { at: 0, alpha: 0.92 },
  { at: 0.5, alpha: 0.88 },
  { at: 0.85, alpha: 0.6 },
  { at: 1.3, alpha: 0 },
];
const SPLASH = 0.6;
const RIM_SIDES = 6;

export function craterShows(c: Crater, turn: number, settled: number, revealed: ReadonlySet<string>): boolean {
  return c.turn < turn || c.turn <= settled || revealed.has(c.id);
}

export class CraterViews {
  readonly root = new THREE.Group();
  readonly scope: RenderScope;
  private readonly terrain: Terrain;
  private readonly views = new Map<string, { crater: Crater; obj: THREE.Group }>();
  private readonly revealed = new Set<string>();
  private turn: number;
  private settled = Number.NEGATIVE_INFINITY;
  private readonly scorch = new THREE.MeshLambertMaterial({
    color: PAL.scorch, vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  private readonly dirt = new THREE.MeshLambertMaterial({ color: PAL.craterRim, flatShading: true });

  constructor(world: World, limit: SightLimit, parent: THREE.Object3D) {
    parent.add(this.root);
    this.terrain = world.terrain;
    this.turn = world.turn;
    this.scope = new RenderScope(this.root, world.size, limit, true, false);
    this.sync(world);
    this.revealAll(world.turn);
  }

  sync(world: World): void {
    this.turn = world.turn;
    const ids = new Set(world.craters.map((c) => c.id));
    const shown = this.shownPoints(world);
    for (const [id, view] of this.views) if (!ids.has(id)) this.drop(id, view.obj);
    for (const c of world.craters) {
      if (this.views.has(c.id)) continue;
      this.add(c);
      if (shown.some((p) => p.x === c.pos.x && p.y === c.pos.y)) this.revealed.add(c.id);
    }
    this.refresh();
  }

  private shownPoints(world: World): Vec[] {
    if (world.craters.every((c) => this.views.has(c.id))) return [];
    return [...this.views.values()].filter((v) => v.obj.visible).map((v) => v.crater.pos);
  }

  reveal(point: Vec): void {
    for (const { crater } of this.views.values()) if (dist(crater.pos, point) * S <= crater.radius) this.revealed.add(crater.id);
    this.refresh();
  }

  revealAll(turn: number): void {
    this.settled = Math.max(this.settled, turn);
    this.refresh();
  }

  private refresh(): void {
    for (const { crater, obj } of this.views.values()) obj.visible = craterShows(crater, this.turn, this.settled, this.revealed);
  }

  private add(c: Crater): void {
    const obj = new THREE.Group();
    obj.name = c.id;
    const disc = new THREE.Mesh(scorchGeometry(this.terrain, c), this.scorch);
    disc.receiveShadow = true;
    const rim = new THREE.Mesh(rimGeometry(this.terrain, c), this.dirt);
    rim.name = `${c.id}-rim`;
    rim.receiveShadow = true;
    obj.add(disc, rim);
    this.scope.add(obj, c.pos, craterReach(c));
    this.views.set(c.id, { crater: c, obj });
  }

  private drop(id: string, obj: THREE.Group): void {
    this.scope.remove(obj);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.views.delete(id);
    this.revealed.delete(id);
  }
}

function scorchGeometry(t: Terrain, c: Crater): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const r = c.radius / S;
  for (const ring of SCORCH) {
    const sectors = ring.at === 0 ? 1 : SECTORS;
    for (let k = 0; k < sectors; k++) {
      const a = (2 * Math.PI * k) / SECTORS;
      const at = ring.alpha === 0 ? ring.at * (1 + SPLASH * (splashOf(c, k) - 0.5)) : ring.at;
      const x = c.pos.x + Math.cos(a) * r * at;
      const y = c.pos.y + Math.sin(a) * r * at;
      positions.push(x * S, markHeightAt(t, c.pos, x, y) * S + LIFT, y * S);
      colors.push(1, 1, 1, ring.alpha);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(discIndices(SCORCH.length - 1));
  geo.computeVertexNormals();
  return geo;
}

function splashOf(c: Crater, k: number): number {
  const h = Math.sin(c.pos.x * 12.9898 + c.pos.y * 78.233 + k * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

function discIndices(rings: number): number[] {
  const idx: number[] = [];
  const at = (ring: number, k: number) => 1 + (ring - 1) * SECTORS + (k % SECTORS);
  for (let k = 0; k < SECTORS; k++) idx.push(0, at(1, k + 1), at(1, k));
  for (let ring = 1; ring < rings; ring++)
    for (let k = 0; k < SECTORS; k++) {
      const a = at(ring, k);
      const b = at(ring, k + 1);
      const c = at(ring + 1, k);
      const d = at(ring + 1, k + 1);
      idx.push(a, b, c, b, d, c);
    }
  return idx;
}

function rimGeometry(t: Terrain, c: Crater): THREE.BufferGeometry {
  const radius = (CRATER.rimWidthRatio * c.radius) / 2;
  const lift = CRATER.rimRatio * c.radius - radius;
  const rim = craterRimPoints(c).map((p) => new THREE.Vector3(p.x * S, groundAt(t, p.x, p.y) * S + lift, p.y * S));
  const up = new THREE.Vector3(0, 1, 0);
  const pieces = rim.map((a, k) => {
    const b = rim[(k + 1) % rim.length];
    const along = new THREE.Vector3().subVectors(b, a);
    const piece = new THREE.CapsuleGeometry(radius, along.length(), 2, RIM_SIDES);
    piece.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, along.clone().normalize()));
    return piece.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  });
  const merged = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  if (!merged) throw new Error(`Crater ${c.id} rim pieces would not merge`);
  return merged;
}
