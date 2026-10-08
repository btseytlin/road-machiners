// Moving scenery parts: windmill rotors, pumpjack beams, cranes, conveyor loads and radar dishes. Motion is render-only
// and runs on real time, like the weather, so no rule reads it. Each part is a node whose origin is its pivot.

import * as THREE from 'three';

export type Pose = { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion };
export type Motion = (seconds: number, node: THREE.Object3D, rest: Pose) => void;

type Mover = { node: THREE.Object3D; motion: Motion; rest: Pose };

const UP = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();

export class SiteMotion {
  private readonly movers: Mover[] = [];
  private seconds = 0;

  add(node: THREE.Object3D, motion: Motion): void {
    if (this.movers.some((m) => m.node === node)) throw new Error(`Moving part ${node.name || node.uuid} was added twice`);
    this.movers.push({ node, motion, rest: { position: node.position.clone(), quaternion: node.quaternion.clone() } });
  }

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

function phaseAt(seconds: number, period: number): number {
  return (2 * Math.PI * seconds) / period;
}

export function spin(axis: THREE.Vector3, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.quaternion.copy(rest.quaternion).multiply(turn.setFromAxisAngle(axis, phaseAt(seconds, period)));
  };
}

export function rock(axis: THREE.Vector3, amplitude: number, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.quaternion.copy(rest.quaternion).multiply(turn.setFromAxisAngle(axis, amplitude * Math.sin(phaseAt(seconds, period))));
  };
}

export function slew(amplitude: number, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.quaternion.copy(rest.quaternion).premultiply(turn.setFromAxisAngle(UP, amplitude * Math.sin(phaseAt(seconds, period))));
  };
}

export function hoist(range: number, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    node.position.copy(rest.position);
    node.position.y += (range * (1 - Math.cos(phaseAt(seconds, period)))) / 2;
  };
}

export function travel(offset: THREE.Vector3, period: number): Motion {
  checkPeriod(period);
  return (seconds, node, rest) => {
    const share = seconds / period - Math.floor(seconds / period);
    node.position.copy(rest.position).addScaledVector(offset, share);
  };
}
