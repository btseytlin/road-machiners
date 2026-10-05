// The Blender bases cut their arches where the game draws the wheels: at PHYSICS.bodies wheelX, hub height and wheelZ.
// A base marks its arch with the sockets arch_front, arch_rear (the left arch center at the hub) and arch_front_top (the crown).

import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { loadModels, socket, type ModelName } from './models';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

const TOLERANCE = 0.02; // meters
const ARCH_CLEARANCE = 0.06; // tools/blender/parts_common_base.py: the gap between a wheel and its arch

describe('wheel arches of the issue 149 bases', () => {
  it.each(['lincoln', 'niva', 'bukhanka'] as const)('%s: arches sit on the physics wheels', (id) => {
    const body = PHYSICS.bodies[id];
    const name = `base_${id}` as ModelName;
    const hub = body.wheelY - PHYSICS.truck.suspensionRest;
    const front = socket(name, 'arch_front');
    const rear = socket(name, 'arch_rear');
    const top = socket(name, 'arch_front_top');
    // glTF y is up and the truck's left side is -z, so compare |z|.
    expect(Math.abs(front.x - body.wheelX)).toBeLessThan(TOLERANCE);
    expect(Math.abs(rear.x + body.wheelX)).toBeLessThan(TOLERANCE);
    expect(Math.abs(front.y - hub)).toBeLessThan(TOLERANCE);
    expect(Math.abs(rear.y - hub)).toBeLessThan(TOLERANCE);
    expect(Math.abs(Math.abs(front.z) - body.wheelZ)).toBeLessThan(TOLERANCE);
    expect(Math.abs(top.y - front.y - (body.wheelRadius + ARCH_CLEARANCE))).toBeLessThan(TOLERANCE);
  });
});
