// Render-only motion of a truck body and its loose parts. Driving physics never reads it.
// The body leans on a spring toward a tilt set by the truck's acceleration. It lifts its nose when the truck speeds up,
// dips it on braking and leans out of turns. A running engine shakes it a little while a turn plays.

import * as THREE from 'three';
import type { VehicleFrame } from '../../phys/frames';

const SWAY = {
  hz: 1.6,
  damping: 0.5,
  pitchPerAccel: 0.007,
  rollPerAccel: 0.0085,
  liftPerAccel: 0.004,
  maxPitch: 0.085,
  maxRoll: 0.1,
  maxLift: 0.06,
};
const MAX_ACCEL = 20;
const IDLE = { liftHz: 11, lift: 0.012, rollHz: 7.3, roll: 0.005 };
const MAX_SUBSTEP = 1 / 120;
const MAX_GAP = 0.25;

export type WhipKind = { hz: number; damping: number; perAccel: number; max: number; up: boolean };
export const WHIPS = {
  antenna: { hz: 2.2, damping: 0.2, perAccel: 0.028, max: 0.5, up: true },
  chain: { hz: 0.9, damping: 0.2, perAccel: 0.14, max: 1.1, up: false },
} satisfies Record<string, WhipKind>;

class Spring {
  x = 0;
  private v = 0;
  constructor(
    private readonly hz: number,
    private readonly damping: number,
  ) {}

  step(target: number, dt: number): void {
    const w = 2 * Math.PI * this.hz;
    this.v += (w * w * (target - this.x) - 2 * this.damping * w * this.v) * dt;
    this.x += this.v * dt;
  }

  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

class Whip {
  private readonly pitch: Spring;
  private readonly roll: Spring;
  constructor(
    readonly obj: THREE.Object3D,
    private readonly kind: WhipKind,
  ) {
    this.pitch = new Spring(kind.hz, kind.damping);
    this.roll = new Spring(kind.hz, kind.damping);
  }

  step(along: number, across: number, dt: number): void {
    const sign = this.kind.up ? 1 : -1;
    this.pitch.step(clamp(sign * along * this.kind.perAccel, this.kind.max), dt);
    this.roll.step(clamp(-sign * across * this.kind.perAccel, this.kind.max), dt);
  }

  apply(): void {
    this.obj.rotation.set(this.roll.x, 0, this.pitch.x, 'XZY');
  }

  reset(): void {
    this.pitch.reset();
    this.roll.reset();
  }
}

export class TruckMotion {
  private readonly pitch = new Spring(SWAY.hz, SWAY.damping);
  private readonly roll = new Spring(SWAY.hz, SWAY.damping);
  private readonly lift = new Spring(SWAY.hz, SWAY.damping);
  private readonly whips: Whip[] = [];
  private time = 0;
  private last: VehicleFrame | null = null;
  private readonly local = new THREE.Vector3();
  private readonly inverse = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(
    private readonly body: THREE.Object3D,
    private readonly pivot: THREE.Vector3,
    phase: number,
  ) {
    this.time = phase * 100;
  }

  addWhip(obj: THREE.Object3D, kind: WhipKind): void {
    this.whips.push(new Whip(obj, kind));
  }

  clearWhips(): void {
    this.whips.length = 0;
  }

  step(f: VehicleFrame, dt: number, running: boolean): void {
    if (!(dt >= 0)) throw new Error(`Truck motion step of ${dt} s`);
    this.time += dt;
    const paused = f === this.last;
    this.last = f;
    if (paused) return this.apply(false);
    if (dt > MAX_GAP) this.reset();
    this.inverse.set(f.rot.x, f.rot.y, f.rot.z, f.rot.w).invert();
    this.local.set(f.acc.x, f.acc.y, f.acc.z).applyQuaternion(this.inverse);
    const along = clamp(this.local.x, MAX_ACCEL);
    const up = clamp(this.local.y, MAX_ACCEL);
    const across = clamp(this.local.z, MAX_ACCEL);
    const pitch = clamp(along * SWAY.pitchPerAccel, SWAY.maxPitch);
    const roll = clamp(-across * SWAY.rollPerAccel, SWAY.maxRoll);
    const lift = clamp(-up * SWAY.liftPerAccel, SWAY.maxLift);
    let left = Math.min(dt, MAX_GAP);
    while (left > 0) {
      const h = Math.min(left, MAX_SUBSTEP);
      this.pitch.step(pitch, h);
      this.roll.step(roll, h);
      this.lift.step(lift, h);
      for (const whip of this.whips) whip.step(along, across, h);
      left -= h;
    }
    this.apply(running);
  }

  private apply(running: boolean): void {
    const shake = running ? 1 : 0;
    const t = 2 * Math.PI * this.time;
    const roll = this.roll.x + shake * IDLE.roll * Math.sin(t * IDLE.rollHz);
    const lift = this.lift.x + shake * IDLE.lift * Math.sin(t * IDLE.liftHz);
    this.tilt.setFromEuler(this.euler.set(roll, 0, this.pitch.x, 'XZY'));
    this.body.quaternion.copy(this.tilt);
    this.body.position.copy(this.pivot).sub(this.local.copy(this.pivot).applyQuaternion(this.tilt));
    this.body.position.y += lift;
    for (const whip of this.whips) whip.apply();
  }

  private reset(): void {
    this.pitch.reset();
    this.roll.reset();
    this.lift.reset();
    for (const whip of this.whips) whip.reset();
  }
}

function clamp(x: number, max: number): number {
  return Math.max(-max, Math.min(max, x));
}
