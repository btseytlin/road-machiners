// Wheel mount points of a vehicle body. Shared by physics and the 3D models.

import type { Body } from '../sim/body';

export function wheelMounts(b: Body): { x: number; y: number; z: number }[] {
  return [
    { x: b.wheelX, y: b.wheelY, z: -b.wheelZ },
    { x: b.wheelX, y: b.wheelY, z: b.wheelZ },
    { x: -b.wheelX, y: b.wheelY, z: -b.wheelZ },
    { x: -b.wheelX, y: b.wheelY, z: b.wheelZ },
  ];
}
