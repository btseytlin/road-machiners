// Work lights of the inhabited sites. Every site registers its fixtures here as plain anchors; a fixed pool of spot lights
// serves the ones nearest the camera at night. The pool joins the scene whole at sunset and leaves at dawn, in the same frame
// as the truck beams, because any change in the count of lights recompiles every material.

import * as THREE from 'three';
import type { V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { DEG } from '../../sim/vec';
import { lampsOn } from './daylight';

export type SiteLightKind = 'flood' | 'gate' | 'fire';
export type SiteLight = { id: string; siteId: string; kind: SiteLightKind; at: V3; aim: V3; color?: number };

type Look = { color: number; intensity: number; range: number; angle: number; penumbra: number; decay: number };

export const SITE_LIGHT_POOL = 8;
export const SITE_LIGHT_FADE_S = 1.5;
export const GATE_APRON_MARGIN = 3;

export const LOOKS: Record<SiteLightKind, Look> = {
  flood: { color: PAL.siteLight.sodium, intensity: 150, range: 14, angle: 30 * DEG, penumbra: 0.5, decay: 1 },
  gate: { color: PAL.siteLight.sodium, intensity: 70, range: 22, angle: 36 * DEG, penumbra: 0.5, decay: 1 },
  fire: { color: PAL.siteLight.fire, intensity: 30, range: 12, angle: 60 * DEG, penumbra: 0.8, decay: 1 },
};

export function lookOf(light: SiteLight): Look {
  return LOOKS[light.kind];
}

// Where the cone meets flat ground, edge rays plus inner rings. The inner rings catch the range arc of a cone that rises over the ground.
const CONE_RINGS = [0.4, 0.7, 1];

export function groundHits(light: SiteLight, groundY: number, bearings: number): V3[] {
  const look = lookOf(light);
  const axis = new THREE.Vector3(light.aim.x - light.at.x, light.aim.y - light.at.y, light.aim.z - light.at.z).normalize();
  const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
  side.normalize();
  const hits: V3[] = [];
  for (const ring of CONE_RINGS) {
    for (let k = 0; k < bearings; k++) {
      const edge = axis.clone().applyAxisAngle(side, look.angle * ring).applyAxisAngle(axis, (k / bearings) * Math.PI * 2);
      if (edge.y >= -1e-9) continue;
      const t = (groundY - light.at.y) / edge.y;
      if (t < 0 || t > look.range) continue;
      hits.push({ x: light.at.x + edge.x * t, y: groundY, z: light.at.z + edge.z * t });
    }
  }
  return hits;
}

export function siteLightOrder(lights: SiteLight[], inView: (l: SiteLight) => boolean, reaches: (p: V3) => boolean, focus: V3): SiteLight[] {
  const dist = (l: SiteLight) => Math.hypot(l.at.x - focus.x, l.at.y - focus.y, l.at.z - focus.z);
  return lights
    .filter((l) => reaches(l.at))
    .map((l) => ({ l, view: inView(l), d: dist(l) }))
    .sort((a, b) => Number(b.view) - Number(a.view) || a.d - b.d || (a.l.id < b.l.id ? -1 : a.l.id > b.l.id ? 1 : 0))
    .map((e) => e.l);
}

type Slot = { spot: THREE.SpotLight; anchor: string | null; look: Look | null };

const frustum = new THREE.Frustum();
const projected = new THREE.Matrix4();
const sphere = new THREE.Sphere();

export class SiteLights {
  private slots: Slot[] = [];
  private lastMs: number | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lights: SiteLight[],
  ) {}

  get pooled(): number {
    return this.slots.length;
  }

  spots(): THREE.SpotLight[] {
    return this.slots.map((s) => s.spot);
  }

  sync(night: boolean, lightTurn: number, camera: THREE.Camera, reaches: (p: V3) => boolean, focus: V3, nowMs: number): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    if (!night) {
      this.clear();
      return;
    }
    if (this.slots.length === 0) this.fill();
    camera.updateMatrixWorld();
    projected.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projected);
    const inView = (l: SiteLight) => frustum.intersectsSphere(sphere.set(new THREE.Vector3(l.at.x, l.at.y, l.at.z), lookOf(l).range));
    const order = siteLightOrder(this.lights, inView, reaches, focus).slice(0, SITE_LIGHT_POOL);
    this.slots.forEach((slot, i) => this.drive(slot, order[i], lightTurn, dt));
  }

  private fill(): void {
    for (let i = 0; i < SITE_LIGHT_POOL; i++) {
      const spot = new THREE.SpotLight(0xffffff, 0);
      spot.castShadow = false;
      this.scene.add(spot, spot.target);
      this.slots.push({ spot, anchor: null, look: null });
    }
  }

  private clear(): void {
    for (const { spot } of this.slots) {
      this.scene.remove(spot, spot.target);
      spot.dispose();
    }
    this.slots = [];
  }

  private drive(slot: Slot, light: SiteLight | undefined, lightTurn: number, dt: number): void {
    const { spot } = slot;
    if (light && slot.anchor !== light.id) {
      slot.anchor = light.id;
      spot.intensity = 0;
    }
    if (!light) {
      slot.anchor = null;
      spot.intensity = 0;
      return;
    }
    const look = lookOf(light);
    slot.look = look;
    spot.position.set(light.at.x, light.at.y, light.at.z);
    spot.target.position.set(light.aim.x, light.aim.y, light.aim.z);
    spot.target.updateMatrixWorld();
    spot.color.setHex(light.color ?? look.color);
    spot.distance = look.range;
    spot.angle = look.angle;
    spot.penumbra = look.penumbra;
    spot.decay = look.decay;
    const goal = lampsOn(light.siteId, lightTurn) ? look.intensity : 0;
    const step = (look.intensity * dt) / SITE_LIGHT_FADE_S;
    spot.intensity = spot.intensity < goal ? Math.min(goal, spot.intensity + step) : Math.max(goal, spot.intensity - step);
  }
}
