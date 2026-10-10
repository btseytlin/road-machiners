import { PAL } from '../../../render/palette';
import type { SiteBuilder } from '../sites';
import { addMarket } from './market';

const PUMP_LANTERN = { x: 0.7, z: 1.9, yaw: 0.5 };
const OASIS_LAMPS = 4;
const OASIS_LAMP_RING = 3.3;
const GREEN_PIT_MARKET = { x: -2.4, z: 1.2, drums: { u: 0.2, v: 1.7 } };
const GREEN_PIT_SHACKS = [
  { x: 1.4, z: -3.0, yaw: Math.PI / 2 },
  { x: 3.0, z: -1.2, yaw: Math.PI },
];

export function buildPump(b: SiteBuilder): void {
  b.addRuin(-1.7, 0, 3, 3.8);
  b.addModel('pump_station', 2.5, 0);
  b.addBox(-2, 0, 1.2, 0.85, 2, PAL.rust.side);
  b.addLantern(PUMP_LANTERN.x, PUMP_LANTERN.z, PUMP_LANTERN.yaw);
}

export function buildOasis(b: SiteBuilder): void {
  b.addTank(0, 0, 2.8, 0.04, PAL.waterLight);
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    b.addModel('palm', Math.cos(a) * 4, Math.sin(a) * 4, a * 2.3);
  }
  for (let i = 0; i < OASIS_LAMPS; i++) {
    const a = (i + 0.5) * Math.PI * 2 / OASIS_LAMPS;
    b.addLantern(Math.cos(a) * OASIS_LAMP_RING, Math.sin(a) * OASIS_LAMP_RING, -a);
  }
  addMarket(b, 'green-pit', GREEN_PIT_MARKET);
  for (const shack of GREEN_PIT_SHACKS) b.addModel('shack', shack.x, shack.z, shack.yaw, 1.2).name = 'green-pit-shack';
  b.addModel('crates', -1.2, -3.2, 0.4);
}
