import { PAL } from '../../../render/palette';
import type { SiteBuilder } from '../sites';

const FIRE_MAST = 0.7;
const MAST_RING = 2;
const MAST_HEIGHT = 1.2;
const SHACK_FACE = 2.3;
const WALL_LAMP_HEIGHT = 0.95;

export function buildCamp(b: SiteBuilder, id: string): void {
  const turn = id === 'kiln' ? 1.3 : 0;
  for (let i = 0; i < 3; i++) {
    const a = turn + i * 2.1;
    const x = Math.cos(a) * 3.2;
    const z = Math.sin(a) * 3.2;
    b.addBox(x, z, 1.8, 1.1, 1.4, i % 2 ? PAL.rust.side : PAL.metal, 0, -a);
    b.addBox(x, z, 2.1, 0.12, 1.7, PAL.rust.top, 1.1, -a + 0.1);
  }
  b.addTank(0, 0, 0.7, 0.12, PAL.rust.dark);
  for (const a of [turn + 1, turn + 1.3]) b.addTank(Math.cos(a) * 4.3, Math.sin(a) * 4.3, 0.45, 0.9, PAL.rust.top);
  b.addHull(Math.cos(turn + 3.1) * 3.6, Math.sin(turn + 3.1) * 3.6, 3, 1.4, turn + 1.6);
  b.addModel('crates', Math.cos(turn + 5.2) * 3.5, Math.sin(turn + 5.2) * 3.5, turn);
  b.addLight('fire', b.addMast(0, 0, FIRE_MAST, 0), { x: -0.4, z: -0.4 }, PAL.siteLight.fire);
  addCampLamps(b, turn);
}

function addCampLamps(b: SiteBuilder, turn: number): void {
  for (const a of [turn + 1.05, turn + 5.25]) b.addMast(Math.cos(a) * MAST_RING, Math.sin(a) * MAST_RING, MAST_HEIGHT, -a);
  for (const i of [0, 2]) {
    const a = turn + i * 2.1;
    const out = { x: -Math.cos(a), z: -Math.sin(a) };
    b.addWallLamp({ x: Math.cos(a) * SHACK_FACE, z: Math.sin(a) * SHACK_FACE }, out, WALL_LAMP_HEIGHT);
  }
}
