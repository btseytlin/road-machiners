// Work lights of the inhabited sites. Every site registers its fixtures here as plain anchors; a fixed pool of spot lights
// serves the ones nearest the camera at night. The pool joins the scene whole at sunset and leaves at dawn, in the same frame
// as the truck beams, because any change in the count of lights recompiles every material.

import * as THREE from 'three';
import type { V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { DEG } from '../../sim/vec';
import { lampsOn } from './daylight';
import { NIGHT_POOLS, type PoolLamp } from './lightPools';

export type SiteLightKind = 'flood' | 'wash' | 'gate' | 'fire' | 'window' | 'fill';
export type SiteLight = { id: string; siteId: string; kind: SiteLightKind; at: V3; aim: V3; ground: number; color?: number; range?: number; intensity?: number };

type Look = { color: number; intensity: number; range: number; angle: number; penumbra: number; decay: number; shadow: boolean };

export const SITE_LIGHT_POOL = 12;
export const SITE_SHADOW_SLOTS = 3;
export const SITE_LIGHT_FADE_S = 1.5;
export const GATE_APRON_MARGIN = 3;
const SHADOW_MAP = 1024;
const SHADOW_BIAS = 0.3;

export const LOOKS: Record<SiteLightKind, Look> = {
  flood: { color: PAL.siteLight.sodium, intensity: 20, range: 18, angle: 38 * DEG, penumbra: 0.6, decay: 1, shadow: false },
  wash: { color: PAL.siteLight.sodium, intensity: 60, range: 32, angle: 17 * DEG, penumbra: 0.6, decay: 1, shadow: false },
  gate: { color: PAL.siteLight.sodium, intensity: 70, range: 22, angle: 30 * DEG, penumbra: 0.5, decay: 1, shadow: false },
  fire: { color: PAL.siteLight.fire, intensity: 15, range: 12, angle: 60 * DEG, penumbra: 0.8, decay: 1, shadow: false },
  window: { color: PAL.siteLight.amber, intensity: 10, range: 10, angle: 85 * DEG, penumbra: 1, decay: 1, shadow: false },
  fill: { color: PAL.siteLight.amber, intensity: 40, range: 40, angle: 60 * DEG, penumbra: 1, decay: 1, shadow: true },
};

export function lookOf(light: SiteLight): Look {
  return LOOKS[light.kind];
}

// Where the cone meets flat ground, edge rays plus inner rings. The inner rings catch the range arc of a cone that rises over the ground.
const CONE_RINGS = [0.4, 0.7, 1];

export function groundHits(light: SiteLight, bearings: number): V3[] {
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
      const t = (light.ground - light.at.y) / edge.y;
      if (t < 0 || t > look.range) continue;
      hits.push({ x: light.at.x + edge.x * t, y: light.ground, z: light.at.z + edge.z * t });
    }
  }
  return hits;
}

export function siteLightOrder(lights: SiteLight[], inView: (l: SiteLight) => boolean, reaches: (p: V3) => boolean, focus: V3): SiteLight[] {
  const dist = (l: SiteLight) => Math.hypot(l.at.x - focus.x, l.at.y - focus.y, l.at.z - focus.z);
  return lights
    .filter((l) => reaches(l.at))
    .map((l) => ({ l, fill: l.kind === 'fill', view: inView(l), d: dist(l) }))
    .sort((a, b) => Number(b.view) - Number(a.view) || Number(b.fill) - Number(a.fill) || a.d - b.d || (a.l.id < b.l.id ? -1 : a.l.id > b.l.id ? 1 : 0))
    .map((e) => e.l);
}

type Slot = { spot: THREE.SpotLight; anchor: string | null; look: Look | null };

const frustum = new THREE.Frustum();
const projected = new THREE.Matrix4();
const sphere = new THREE.Sphere();

export class SiteLights {
  private slots: Slot[] = [];
  private lastMs: number | null = null;
  private level = 0;
  private readonly lights: SiteLight[];

  constructor(
    private readonly scene: THREE.Scene,
    sites: { lights: SiteLight[]; lamps: PoolLamp[] },
    pools: { worldSize: number; maxTextureSize: number },
  ) {
    this.lights = sites.lights;
    NIGHT_POOLS.bake(sites.lamps, pools.worldSize, pools.maxTextureSize);
  }

  get pooled(): number {
    return this.slots.length;
  }

  spots(): THREE.SpotLight[] {
    return this.slots.map((s) => s.spot);
  }

  get nightLevel(): number {
    return this.level;
  }

  sync(night: boolean, lightTurn: number, camera: THREE.Camera, reaches: (p: V3) => boolean, focus: V3, nowMs: number): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    const step = dt / SITE_LIGHT_FADE_S;
    this.level = night ? Math.min(1, this.level + step) : Math.max(0, this.level - step);
    NIGHT_POOLS.setLevel(this.level);
    if (!night) {
      this.clear();
      return;
    }
    if (this.slots.length === 0) this.fill();
    camera.updateMatrixWorld();
    projected.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projected);
    const inView = (l: SiteLight) => frustum.intersectsSphere(sphere.set(new THREE.Vector3(l.at.x, l.at.y, l.at.z), lookOf(l).range));
    const order = siteLightOrder(this.lights, inView, reaches, focus);
    const shadowed = order.filter((l) => lookOf(l).shadow);
    const plain = order.filter((l) => !lookOf(l).shadow);
    this.slots.forEach((slot, i) => {
      const light = slot.spot.castShadow ? shadowed[i] : plain[i - SITE_SHADOW_SLOTS];
      if (slot.spot.castShadow) slot.spot.shadow.autoUpdate = light !== undefined;
      this.drive(slot, light, lightTurn, dt);
    });
  }

  private fill(): void {
    for (let i = 0; i < SITE_LIGHT_POOL; i++) {
      const spot = new THREE.SpotLight(0xffffff, 0);
      spot.castShadow = i < SITE_SHADOW_SLOTS;
      if (spot.castShadow) {
        spot.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
        spot.shadow.normalBias = SHADOW_BIAS;
        spot.shadow.needsUpdate = true;
      }
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
    const anchor = light?.id ?? null;
    if (slot.anchor !== anchor) slot.spot.intensity = 0;
    slot.anchor = anchor;
    if (!light) return;
    slot.look = lookOf(light);
    aim(slot.spot, light, slot.look);
    fade(slot.spot, light, slot.look, lightTurn, dt);
  }
}

function aim(spot: THREE.SpotLight, light: SiteLight, look: Look): void {
  spot.position.set(light.at.x, light.at.y, light.at.z);
  spot.target.position.set(light.aim.x, light.aim.y, light.aim.z);
  spot.target.updateMatrixWorld();
  spot.color.setHex(light.color ?? look.color);
  spot.distance = light.range ?? look.range;
  spot.angle = look.angle;
  spot.penumbra = look.penumbra;
  spot.decay = look.decay;
}

function fade(spot: THREE.SpotLight, light: SiteLight, look: Look, lightTurn: number, dt: number): void {
  const full = light.intensity ?? look.intensity;
  const goal = lampsOn(light.siteId, lightTurn) ? full : 0;
  const step = (full * dt) / SITE_LIGHT_FADE_S;
  spot.intensity = spot.intensity < goal ? Math.min(goal, spot.intensity + step) : Math.max(goal, spot.intensity - step);
}
