import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PAL } from '../../render/palette';
import { paintShipGlow } from './obstacles';

function groupOf(...names: string[]): THREE.Group {
  const g = new THREE.Group();
  for (const name of names) {
    const m = new THREE.MeshLambertMaterial({ color: 0x808080 });
    m.name = name;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
  }
  return g;
}

function materialsOf(g: THREE.Group): THREE.MeshLambertMaterial[] {
  return g.children.map((c) => (c as THREE.Mesh).material as THREE.MeshLambertMaterial);
}

describe('paintShipGlow', () => {
  it('makes ship_glow materials emissive in the ship glow and leaves others alone (IV7)', () => {
    const g = groupOf('metal', 'ship_glow');

    paintShipGlow(g);

    const [metal, glow] = materialsOf(g);
    expect(glow.emissive.getHex()).toBe(PAL.shipGlow);
    expect(glow.emissiveIntensity).toBeGreaterThan(0);
    expect(metal.emissive.getHex()).toBe(0);
    expect(metal.emissiveIntensity).toBe(1);
  });

  it('adds no light', () => {
    const g = groupOf('ship_glow');

    paintShipGlow(g);

    let lights = 0;
    g.traverse((o) => {
      if (o instanceof THREE.Light) lights++;
    });
    expect(lights).toBe(0);
  });
});
