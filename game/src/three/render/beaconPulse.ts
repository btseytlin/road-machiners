// The player's emergency beacon, made visible: while it calls, red full rings spread out from the truck.
// Sound arcs show what the player hears, from one bearing. These show what the player sends, in all
// directions, so they are circles in their own color and draw under the sound arcs.
// Timing runs on the wall clock, so pulses stay sparing while turns run on their own and keep going
// while turns are stopped. Render only: nothing here reads or changes the rules.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { heightAt, type Terrain } from '../../sim/terrain';
import type { Vec } from '../../sim/vec';

const S = PHYSICS.metersPerTile;
const RENDER_ORDER = 904; // above the fog and shade, below the contact markers and the sound arcs
const LIFT = 0.1; // meters above the ground under the truck
const PULSE = {
  period: 6, // seconds from one pulse start to the next
  rings: 2, // rings in one pulse
  stagger: 0.35, // seconds between rings
  seconds: 2, // time for one ring to spread and fade
  start: 1.5, // tiles from the truck center where a ring begins
  reach: 10, // tiles where a ring ends
  thickness: 0.18, // tiles, the same at every size
  opacity: 0.7, // of a fresh ring
  segments: 64,
};

// Phase in [0, 1) of each ring in flight, first ring first. Pure in (onSinceMs, nowMs).
export function beaconPulseRings(onSinceMs: number | null, nowMs: number): number[] {
  if (onSinceMs === null) return [];
  const periodMs = PULSE.period * 1000;
  const elapsedMs = (((nowMs - onSinceMs) % periodMs) + periodMs) % periodMs;
  const phases: number[] = [];
  for (let k = 0; k < PULSE.rings; k++) {
    const p = (elapsedMs - k * PULSE.stagger * 1000) / (PULSE.seconds * 1000);
    if (p >= 0 && p < 1) phases.push(p);
  }
  return phases;
}

export class BeaconPulseView {
  readonly root = new THREE.Group();
  private readonly meshes: THREE.Mesh[];
  private onSinceMs: number | null = null;

  constructor() {
    this.meshes = Array.from({ length: PULSE.rings }, () => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(1, 2, PULSE.segments),
        new THREE.MeshBasicMaterial({ color: PAL.beacon, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = RENDER_ORDER;
      mesh.frustumCulled = false; // the vertices move, so the bounding sphere from the first radii would cull a spread ring
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    });
  }

  // at: the player's truck as drawn this frame, in map tiles.
  update(terrain: Terrain, on: boolean, at: Vec, nowMs: number): void {
    if (!on) this.onSinceMs = null;
    else if (this.onSinceMs === null) this.onSinceMs = nowMs;
    this.root.position.set(at.x * S, heightAt(terrain, at.x, at.y) * S + LIFT, at.y * S);
    const phases = beaconPulseRings(this.onSinceMs, nowMs);
    this.meshes.forEach((mesh, i) => {
      const p = phases[i];
      mesh.visible = p !== undefined;
      if (p === undefined) return;
      const inner = PULSE.start + (PULSE.reach - PULSE.start) * p;
      setRadii(mesh, inner * S, (inner + PULSE.thickness) * S);
      (mesh.material as THREE.MeshBasicMaterial).opacity = PULSE.opacity * (1 - p) ** 2;
    });
  }
}

const UNIT = Array.from({ length: PULSE.segments + 1 }, (_, i) => {
  const a = (i / PULSE.segments) * Math.PI * 2;
  return { c: Math.cos(a), s: Math.sin(a) };
});

// RingGeometry lists the inner circle's vertices first, then the outer circle's.
function setRadii(mesh: THREE.Mesh, inner: number, outer: number): void {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count / 2;
  for (let i = 0; i < n; i++) {
    const { c, s } = UNIT[i];
    pos.setXY(i, c * inner, s * inner);
    pos.setXY(n + i, c * outer, s * outer);
  }
  pos.needsUpdate = true;
}
