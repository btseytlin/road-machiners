// Moving scenery parts: windmill rotors, pumpjack beams, cranes, conveyor loads and radar dishes. Motion is render-only
// and runs on real time, like the weather, so no rule reads it. Each part is a node whose origin is its pivot.

import * as THREE from 'three';

// A node's local pose when it was added, which every motion moves from.
export type Pose = { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion };
// Sets a node's local transform from the seconds it has moved and its rest pose. A motion repeats with its period.
export type Motion = (seconds: number, node: THREE.Object3D, rest: Pose) => void;

type Mover = { node: THREE.Object3D; motion: Motion; rest: Pose };

const UP = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();

// Owns every moving scenery part. tick() loops over the added parts only and scans no world list.
export class SiteMotion {
  private readonly movers: Mover[] = [];
  private seconds = 0;

  add(node: THREE.Object3D, motion: Motion): void {
    if (this.movers.some((m) => m.node === node)) throw new Error(`Moving part ${node.name || node.uuid} was added twice`);
    this.movers.push({ node, motion, rest: { position: node.position.clone(), quaternion: node.quaternion.clone() } });
  }

  // dt: seconds since the last drawn frame.
  tick(dt: number): void {
    this.seconds += dt;
    for (const { node, motion, rest } of this.movers) {
      motion(this.seconds, node, rest);
      node.updateMatrix();
    }
  }
}

function checkPeriod(period: number): void {
  if (!Number.isFinite(period) || period <= 0) throw new Error(`A site motion needs a finite positive period, got ${period}`);
}

// The share of a full cycle at this time, in radians.
function phaseAt(seconds: number, period: number): number {
  return (2 * Math.PI * seconds) / period;
}

// One full turn about the node's own axis every period seconds.
export function spin(axis: THREE.Vector3, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.quaternion.copy(rest.quaternion).multiply(turn.setFromAxisAngle(axis, phaseAt(seconds, period)));
  };
}

// Swings about the node's own axis between -amplitude and +amplitude radians.
export function rock(axis: THREE.Vector3, amplitude: number, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.quaternion.copy(rest.quaternion).multiply(turn.setFromAxisAngle(axis, amplitude * Math.sin(phaseAt(seconds, period))));
  };
}

// Swings about the parent's vertical between -amplitude and +amplitude radians, as a crane slews.
export function slew(amplitude: number, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.quaternion.copy(rest.quaternion).premultiply(turn.setFromAxisAngle(UP, amplitude * Math.sin(phaseAt(seconds, period))));
  };
}

// Rises from the rest pose by range, in the parent's units, and back down, as a crane grab hoists.
export function hoist(range: number, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.position.copy(rest.position);
    node.position.y += (range * (1 - Math.cos(phaseAt(seconds, period)))) / 2;
  };
}

// Moves from the rest pose by offset, in the parent's frame, at an even speed over each period, then jumps back to
// the rest pose, as loads ride a belt. Evenly spaced loads one offset apart then read as an endless stream.
export function travel(offset: THREE.Vector3, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    const share = seconds / period - Math.floor(seconds / period);
    node.position.copy(rest.position).addScaledVector(offset, share);
  };
}
