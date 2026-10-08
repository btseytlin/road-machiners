// Throttle zones fanned ahead of the truck, draped on the ground, like the 2D src/render/throttle.ts.
// The caller supplies the half-angle (it already clamps a minimum so barely-turning trucks keep
// visible zones) and the hover color (throttle color under the cursor, or PAL.plan off any zone).

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { zoneEdges, type Throttle } from '../../sim/steering';
import { heightAt, markHeightAt, type Terrain } from '../../sim/terrain';
import type { Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const ZONE_ALPHA: Record<Throttle, number> = { brake: 0.24, hold: 0.28, accelerate: 0.28 };
const SAMPLE_TILES = 0.5;
const LIFT = 0.1;
const HOVER_RADIUS_TILES = 0.6;
const HOVER_WIDTH_TILES = 0.08;
const HOVER_SEGMENTS = 32;

export class ZonesView {
  readonly root = new THREE.Group();
  private bands: Record<Throttle, THREE.Mesh>;
  private ring: THREE.Mesh;

  constructor() {
    this.bands = {
      brake: this.makeBand(PAL.throttle.brake, ZONE_ALPHA.brake),
      hold: this.makeBand(PAL.throttle.hold, ZONE_ALPHA.hold),
      accelerate: this.makeBand(PAL.throttle.accelerate, ZONE_ALPHA.accelerate),
    };
    for (const k of Object.keys(this.bands) as Throttle[]) this.root.add(this.bands[k]);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.01, 0.02, HOVER_SEGMENTS).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: PAL.plan, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 850;
    this.root.add(this.ring);
  }

  private makeBand(color: number, opacity: number): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.renderOrder = 800;
    mesh.visible = false;
    return mesh;
  }

  update(terrain: Terrain, pos: Vec, heading: number, speed: number, halfAngle: number): void {
    const z = zoneEdges();
    const brakeEnd = speed === 0 ? z.restBrakeEnd : z.brakeEnd;
    const holdEnd = speed === 0 ? z.restBrakeEnd : z.holdEnd;
    this.band('brake', terrain, pos, heading, halfAngle, 0, brakeEnd);
    this.band('hold', terrain, pos, heading, halfAngle, brakeEnd, holdEnd);
    this.band('accelerate', terrain, pos, heading, halfAngle, holdEnd, z.reach);
  }

  private band(t: Throttle, terrain: Terrain, pos: Vec, heading: number, half: number, r0: number, r1: number): void {
    const mesh = this.bands[t];
    if (r1 - r0 < 0.05) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const arcSteps = Math.ceil((2 * half * r1) / SAMPLE_TILES);
    const radialSteps = Math.ceil((r1 - r0) / SAMPLE_TILES);
    const positions: number[] = [];
    for (let i = 0; i <= arcSteps; i++) {
      const a = heading - half + (2 * half * i) / arcSteps;
      for (let j = 0; j <= radialSteps; j++) pushPoint(positions, terrain, pos, a, r0 + ((r1 - r0) * j) / radialSteps);
    }
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.geometry.setIndex(gridIndices(arcSteps, radialSteps));
  }

  hover(terrain: Terrain, p: Vec | null, color: number): void {
    this.ring.visible = p !== null;
    if (!p) return;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    const h = heightAt(terrain, p.x, p.y) * S + LIFT;
    this.ring.position.set(p.x * S, h, p.y * S);
    const r = HOVER_RADIUS_TILES * S;
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.RingGeometry(r - HOVER_WIDTH_TILES * S, r, HOVER_SEGMENTS).rotateX(-Math.PI / 2);
  }
}

function pushPoint(out: number[], terrain: Terrain, pos: Vec, a: number, r: number): void {
  const x = pos.x + Math.cos(a) * r;
  const y = pos.y + Math.sin(a) * r;
  const h = markHeightAt(terrain, pos, x, y) * S + LIFT;
  out.push(x * S, h, y * S);
}

function gridIndices(arcSteps: number, radialSteps: number): number[] {
  const idx: number[] = [];
  const row = radialSteps + 1;
  for (let i = 0; i < arcSteps; i++)
    for (let j = 0; j < radialSteps; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  return idx;
}
