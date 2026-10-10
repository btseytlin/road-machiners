import { PAL } from '../../../render/palette';
import type { SiteBuilder } from '../sites';

const SHED_SCALE = 1.5;
const SHED_DOOR = {
  reach: (2.03 * SHED_SCALE) / 4 + 0.01,
  width: (0.9 * SHED_SCALE) / 4 - 0.04,
  height: (1.8 * SHED_SCALE) / 4 - 0.05,
};
const SHED_LAMP = { reach: 0.12, size: 0.14, lift: 0.66, throw: 2 };

export function addShed(b: SiteBuilder, site: string, shed: { x: number; z: number; yaw: number }): void {
  b.addModel('shack', shed.x, shed.z, shed.yaw, SHED_SCALE).name = `${site}-shed`;
  const out = { x: Math.cos(shed.yaw), z: -Math.sin(shed.yaw) };
  const at = (reach: number) => ({ x: shed.x + out.x * reach, z: shed.z + out.z * reach });
  const door = at(SHED_DOOR.reach);
  b.addBox(door.x, door.z, 0.02, SHED_DOOR.height, SHED_DOOR.width, PAL.rust.dark, 0, shed.yaw).name = `${site}-shed-door`;
  const bracket = at(SHED_DOOR.reach + SHED_LAMP.reach / 2);
  b.addBox(bracket.x, bracket.z, SHED_LAMP.reach, 0.03, 0.03, PAL.metal, SHED_LAMP.lift + SHED_LAMP.size, shed.yaw);
  const lamp = at(SHED_DOOR.reach + SHED_LAMP.reach);
  const head = b.addBox(lamp.x, lamp.z, SHED_LAMP.size, SHED_LAMP.size, SHED_LAMP.size, PAL.lamp.on, SHED_LAMP.lift, shed.yaw);
  head.name = `${site}-shed-lamp`;
  b.addLight('window', head, { x: lamp.x + out.x * SHED_LAMP.throw, z: lamp.z + out.z * SHED_LAMP.throw }, PAL.siteLight.amber);
}
