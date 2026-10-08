import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { VehicleFrame } from '../../phys/frames';
import { TruckMotion, WHIPS } from './truckMotion';

function frame(acc: { x: number; y: number; z: number }): VehicleFrame {
  return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, acc, wheels: [] };
}

function drive(motion: TruckMotion, acc: { x: number; y: number; z: number }): void {
  for (let i = 0; i < 60; i++) motion.step(frame(acc), 1 / 60, false);
}

function setup() {
  const body = new THREE.Group();
  const antenna = new THREE.Group();
  const chain = new THREE.Group();
  const motion = new TruckMotion(body, new THREE.Vector3(0, -0.3, 0), 0);
  motion.addWhip(antenna, WHIPS.antenna);
  motion.addWhip(chain, WHIPS.chain);
  return { body, antenna, chain, motion };
}

describe('truck motion', () => {
  it('lifts the nose and swings loose parts back when the truck speeds up', () => {
    const { body, antenna, chain, motion } = setup();
    drive(motion, { x: 8, y: 0, z: 0 });
    expect(body.rotation.z).toBeGreaterThan(0.01);
    expect(new THREE.Vector3(0, 1, 0).applyEuler(antenna.rotation).x).toBeLessThan(0);
    expect(new THREE.Vector3(0, -1, 0).applyEuler(chain.rotation).x).toBeLessThan(0);
  });

  it('dips the nose on braking', () => {
    const { body, motion } = setup();
    drive(motion, { x: -8, y: 0, z: 0 });
    expect(body.rotation.z).toBeLessThan(-0.01);
  });

  it('leans out of a right turn', () => {
    const { body, motion } = setup();
    drive(motion, { x: 0, y: 0, z: 8 });
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion).z).toBeLessThan(-0.01);
  });

  it('keeps the lean within its cap on a hard bump', () => {
    const { body, motion } = setup();
    drive(motion, { x: 500, y: 0, z: 500 });
    expect(Math.abs(body.rotation.z)).toBeLessThan(0.13);
    expect(Math.abs(body.rotation.x)).toBeLessThan(0.13);
  });

  it('holds the lean while the same frame repeats, as between turns', () => {
    const { body, motion } = setup();
    drive(motion, { x: 8, y: 0, z: 0 });
    const held = frame({ x: 8, y: 0, z: 0 });
    motion.step(held, 1 / 60, false);
    const lean = body.rotation.z;
    for (let i = 0; i < 120; i++) motion.step(held, 1 / 60, false);
    expect(body.rotation.z).toBe(lean);
  });

  it('rejects a negative time step', () => {
    const { motion } = setup();
    expect(() => motion.step(frame({ x: 0, y: 0, z: 0 }), -0.01, false)).toThrow(/Truck motion step/);
  });
});
