import type { SiteBuilder } from '../sites';

export function addMarket(b: SiteBuilder, site: string, at: { x: number; z: number; drums: { u: number; v: number } }): void {
  const yaw = Math.atan2(at.z, -at.x);
  b.addModel('lean_to', at.x, at.z, yaw).name = `${site}-market`;
  const u = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const v = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  b.addModel('drums', at.x + u.x * at.drums.u + v.x * at.drums.v, at.z + u.z * at.drums.u + v.z * at.drums.v, yaw).name = `${site}-water-drums`;
}
