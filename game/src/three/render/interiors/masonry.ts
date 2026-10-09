import { PAL } from '../../../render/palette';
import type { SiteBuilder } from '../sites';

const MAST = 3.3;
const PUMP_LANTERN = { x: 0.7, z: 1.9, yaw: 0.5 };
const OASIS_LAMPS = 4;
const OASIS_LAMP_RING = 3.3;

export function buildPump(b: SiteBuilder): void {
  b.addRuin(-1.7, 0, 3, 3.8);
  b.addModel('pump_station', 2.5, 0);
  b.addBox(-2, 0, 1.2, 0.85, 2, PAL.rust.side);
  b.addLantern(PUMP_LANTERN.x, PUMP_LANTERN.z, PUMP_LANTERN.yaw);
}

export function buildLock(b: SiteBuilder): void {
  for (const x of [-1.6, 1.6]) b.addBox(x, 0, 0.6, 1.1, 3.8, PAL.wall.side);
  b.addBox(0, 0, 2.6, 0.05, 3.8, PAL.water);
  b.addModel('lock_gate', 0, 0, Math.PI / 2);
  b.addRuin(3.7, 0, 1.7, 2);
  b.addWorkLight('flood', 2.4, 2.4, MAST, { x: 0, z: 0, lift: 1 }, PAL.siteLight.warm);
  b.addWash(0.9, PAL.siteLight.warm);
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
}
