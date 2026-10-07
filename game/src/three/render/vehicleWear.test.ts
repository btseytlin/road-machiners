// A truck draws each part's wear as a look step, and answers where each part is.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { startKit } from '../../data/start';
import { wheelMounts } from '../../phys/body';
import { BODY_PARTS, WEAR_LOOK_STEPS, wearLookStep } from '../../render/partLooks';
import { bodyOf } from '../../sim/body';
import { playerVehicle } from '../../sim/damage';
import { mountedParts } from '../../sim/grid';
import { PLAIN_KIT } from '../../sim/testkit';
import type { Vehicle } from '../../sim/types';
import { maxHp } from '../../sim/wear';
import { newWorld } from '../../sim/world';
import { TEST_MAP } from '../../test/map';
import { loadModels } from './models';
import { signatureOf, VehicleView } from './vehicle';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

function truck(): Vehicle {
  return playerVehicle(newWorld(1337, PLAIN_KIT, TEST_MAP));
}

function colors(view: VehicleView): string {
  const hexes = new Set<number>();
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) hexes.add(o.material.color.getHex());
  });
  return [...hexes].sort().join(',');
}

describe('part wear look', () => {
  it('rebuilds the signature when a part crosses a look step, not inside one', () => {
    const v = truck();
    const part = mountedParts(v)[0];
    const max = maxHp(part);
    part.hp = max;
    const full = signatureOf(v);
    part.hp = max - 1;
    const first = signatureOf(v);
    expect(first).not.toBe(full);
    part.hp = max - 2;
    expect(signatureOf(v)).toBe(first);
    part.hp = 0;
    expect(signatureOf(v)).not.toBe(first);
    part.hp = max;
    expect(signatureOf(v)).toBe(full);
    expect(WEAR_LOOK_STEPS).toBeGreaterThan(2);
  });

  it('grays a worn truck and gives the original colors back on repair', () => {
    const v = truck();
    const view = new VehicleView(v, true);
    const clean = colors(view);
    const part = mountedParts(v).find((p) => maxHp(p) > 1)!;
    const max = maxHp(part);
    part.hp = 1;
    view.update(v, true);
    expect(colors(view)).not.toBe(clean);
    part.hp = max;
    view.update(v, true);
    expect(colors(view)).toBe(clean);
  });

  it('draws the new-game truck with a nearly broken engine and a worn body', () => {
    const v = playerVehicle(newWorld(1337, startKit('standard'), TEST_MAP));
    const step = (defId: string) => wearLookStep(mountedParts(v).find((p) => p.defId === defId)!);
    expect(step('stockEngine')).toBe(WEAR_LOOK_STEPS - 1);
    expect(step('cabPickup')).toBeGreaterThan(0);
    expect(colors(new VehicleView(v, true))).not.toBe(colors(new VehicleView(truck(), true)));
  });

  it('wears the body with the cab part and restores it on repair', () => {
    const v = truck();
    const view = new VehicleView(v, true);
    const clean = colors(view);
    const full = signatureOf(v);
    const cab = mountedParts(v).find((p) => BODY_PARTS.has(p.defId))!;
    const max = maxHp(cab);
    cab.hp = max - 1;
    expect(signatureOf(v)).not.toBe(full);
    view.update(v, true);
    expect(colors(view)).not.toBe(clean);
    cab.hp = max;
    view.update(v, true);
    expect(signatureOf(v)).toBe(full);
    expect(colors(view)).toBe(clean);
  });

  it('answers a world point for every mounted part, a wheel at its mount', () => {
    const v = truck();
    const view = new VehicleView(v, true);
    view.pose({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, acc: { x: 0, y: 0, z: 0 }, wheels: wheelMounts(bodyOf(v.chassisId)).map(() => ({ suspension: 0, steer: 0, spin: 0, ground: true })) }, 0.016);
    for (const p of mountedParts(v)) expect(view.partPoint(p.id), p.id).toBeDefined();
    const mounts = wheelMounts(bodyOf(v.chassisId));
    const wheels = mountedParts(v, 'core').filter((p) => p.defId.startsWith('wheel'));
    expect(wheels.length).toBe(mounts.length);
    for (const w of wheels) {
      const at = view.partPoint(w.id);
      expect(Math.min(...mounts.map((m) => Math.hypot(at.x - m.x, at.z - m.z)))).toBeLessThan(0.1);
    }
    expect(() => view.partPoint('nope')).toThrow();
  });
});
