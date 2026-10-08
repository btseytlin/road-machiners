import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { emptyWorld } from '../../sim/testkit';
import { beaconPulseRings, BeaconPulseView } from './beaconPulse';

const at = { x: 30, y: 30 };
const terrain = emptyWorld().terrain;
const rings = (v: BeaconPulseView) => v.root.children as THREE.Mesh[];
const visible = (v: BeaconPulseView) => rings(v).filter((m) => m.visible);
const opacity = (m: THREE.Mesh) => (m.material as THREE.MeshBasicMaterial).opacity;

describe('beaconPulseRings', () => {
  it('shows nothing without a beacon', () => {
    for (const t of [0, 500, 99999]) expect(beaconPulseRings(null, t)).toEqual([]);
  });

  it('starts a pulse the moment the beacon comes on', () => {
    expect(beaconPulseRings(1000, 1000)).toEqual([0]);
  });

  it('adds the second ring after the stagger', () => {
    const p = beaconPulseRings(0, 350);
    expect(p).toHaveLength(2);
    expect(p[0]).toBeCloseTo(0.175);
    expect(p[1]).toBeCloseTo(0);
  });

  it('hides rings between pulses and repeats exactly each period', () => {
    expect(beaconPulseRings(0, 3000)).toEqual([]);
    expect(beaconPulseRings(0, 5999)).toEqual([]);
    for (const k of [1, 2, 3]) expect(beaconPulseRings(0, k * 6000)).toEqual([0]);
  });

  it('does not replay a backlog after a long gap', () => {
    expect(beaconPulseRings(0, 600_000 + 350)).toEqual([0.175, 0]);
  });
});

describe('BeaconPulseView', () => {
  it('shows while on, hides at once when off, and restarts at phase 0', () => {
    const v = new BeaconPulseView();
    v.update(terrain, true, at, 0);
    expect(visible(v)).toHaveLength(1);
    v.update(terrain, false, at, 500);
    expect(visible(v)).toHaveLength(0);
    v.update(terrain, true, at, 9000);
    expect(visible(v)).toHaveLength(1);
    expect(opacity(visible(v)[0])).toBeCloseTo(0.7);
  });

  it('keeps its meshes and geometry', () => {
    const v = new BeaconPulseView();
    const geometry = rings(v).map((m) => m.geometry);
    for (let i = 0; i < 1000; i++) v.update(terrain, i % 300 < 200, at, i * 37);
    expect(rings(v)).toHaveLength(geometry.length);
    expect(rings(v).map((m) => m.geometry)).toEqual(geometry);
  });

  it('keeps the thickness while the ring grows, and fades', () => {
    const v = new BeaconPulseView();
    let last = Infinity;
    for (const ms of [0, 500, 1000, 1500, 1900]) {
      v.update(terrain, true, at, ms);
      const m = rings(v)[0];
      const pos = m.geometry.getAttribute('position');
      const n = pos.count / 2;
      const inner = Math.hypot(pos.getX(0), pos.getY(0));
      const outer = Math.hypot(pos.getX(n), pos.getY(n));
      expect(outer - inner).toBeCloseTo(0.18 * 4, 5);
      expect(opacity(m)).toBeLessThanOrEqual(last);
      last = opacity(m);
    }
  });
});
