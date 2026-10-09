import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hoist, rock, SiteMotion, slew, spin, travel, type Motion } from './site-motion';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

function part(): THREE.Object3D {
  const node = new THREE.Object3D();
  node.position.set(1, 2, 3);
  node.rotation.set(0, 0.4, 0);
  node.updateMatrix();
  node.matrixAutoUpdate = false;
  return node;
}

function after(motion: Motion, seconds: number): THREE.Matrix4 {
  const node = part();
  const motions = new SiteMotion();
  motions.add(node, motion);
  motions.tick(seconds);
  return node.matrix.clone();
}

function expectMatrix(actual: THREE.Matrix4, expected: THREE.Matrix4): void {
  actual.elements.forEach((e, i) => expect(e, `element ${i}`).toBeCloseTo(expected.elements[i], 6));
}

const REST = part().matrix;

describe('site motion', () => {
  it('brings each motion back to the rest pose after one period (IV20)', () => {
    expectMatrix(after(spin(Y, 3), 3), REST);
    expectMatrix(after(rock(X, 0.3, 6), 6), REST);
    expectMatrix(after(slew(0.6, 14), 14), REST);
    expectMatrix(after(hoist(2, 8), 8), REST);
    expectMatrix(after(travel(new THREE.Vector3(2, 1, 0), 4), 4), REST);
  });

  it('travels a part along its offset at an even speed, then jumps back to start again', () => {
    const at = (seconds: number) => new THREE.Vector3().setFromMatrixPosition(after(travel(new THREE.Vector3(2, 1, 0), 4), seconds)).toArray();
    expect(at(1)).toEqual([1.5, 2.25, 3].map((v) => expect.closeTo(v, 6)));
    expect(at(3)).toEqual([2.5, 2.75, 3].map((v) => expect.closeTo(v, 6)));
    expect(at(5)).toEqual([1.5, 2.25, 3].map((v) => expect.closeTo(v, 6)));
  });

  it('spins a part a quarter turn in a quarter period', () => {
    const turned = new THREE.Object3D();
    turned.position.set(1, 2, 3);
    turned.rotation.set(0, 0.4 + Math.PI / 2, 0);
    turned.updateMatrix();
    expectMatrix(after(spin(Y, 3), 0.75), turned.matrix);
  });

  it('rocks a part to its amplitude a quarter period in, about its own axis', () => {
    const rocked = new THREE.Object3D();
    rocked.position.set(1, 2, 3);
    rocked.quaternion.setFromEuler(new THREE.Euler(0, 0.4, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.3));
    rocked.updateMatrix();
    expectMatrix(after(rock(X, 0.3, 6), 1.5), rocked.matrix);
  });

  it('slews a part about the vertical by its amplitude and back', () => {
    const slewed = new THREE.Object3D();
    slewed.position.set(1, 2, 3);
    slewed.rotation.set(0, 0.4 - 0.6, 0);
    slewed.updateMatrix();
    expectMatrix(after(slew(0.6, 14), 10.5), slewed.matrix);
  });

  it('hoists a part up by its range half a period in', () => {
    const top = new THREE.Vector3().setFromMatrixPosition(after(hoist(2, 8), 4));
    expect(top.toArray()).toEqual([1, 4, 3].map((v) => expect.closeTo(v, 6)));
  });

  it('sums ticks, so a motion runs on the time since its part was added', () => {
    const node = part();
    const motions = new SiteMotion();
    motions.add(node, hoist(2, 8));
    motions.tick(1);
    motions.tick(3);
    expect(node.position.y).toBeCloseTo(4, 6);
  });

  it('touches only the parts added to it (IV20)', () => {
    const moving = part();
    const still = part();
    const motions = new SiteMotion();
    motions.add(moving, spin(Y, 3));
    motions.tick(1);
    expectMatrix(still.matrix, REST);
    expect(moving.matrix.equals(REST)).toBe(false);
  });

  it('throws when a part is added twice', () => {
    const node = part();
    const motions = new SiteMotion();
    motions.add(node, spin(Y, 3));
    expect(() => motions.add(node, rock(X, 0.3, 6))).toThrow(/twice/);
  });

  it('throws for a motion with no finite period', () => {
    expect(() => spin(Y, 0)).toThrow(/period/);
    expect(() => rock(X, 0.3, Infinity)).toThrow(/period/);
    expect(() => slew(0.6, -1)).toThrow(/period/);
    expect(() => hoist(2, Number.NaN)).toThrow(/period/);
    expect(() => travel(X, 0)).toThrow(/period/);
  });
});
