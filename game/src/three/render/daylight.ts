// Light from the clock, and the lights that switch on at night. The sun moves continuously: warm white at noon, gold in the late afternoon,
// red at the horizon with long shadows, then a short twilight hands over to blue moonlight.

import * as THREE from "three";
import { TERRAIN } from "../../data/terrain";
import { TIME } from "../../data/time";
import { clockOf, sunAt } from "../../sim/sun";
import { hashStr } from "../../render/noise";
import type { V3, VehicleFrame } from "../../phys/frames";
import { PAL } from "../../render/palette";
import { bodyOf } from "../../sim/body";
import type { Vehicle, World } from "../../sim/types";
import { DEG, type Vec } from "../../sim/vec";
export { enableSunShadows } from "./shadowFilter";

const MIN_LIGHT_ELEVATION = 6;
const TWILIGHT = 10;
const MOON_ELEVATION = 25;
const MOON_DIR = TERRAIN.light;
const WHITE = new THREE.Color(0xffffff);
const GLASS_SATURATION = 0.9;
const SHADOW_SOFTNESS = 1;

type Key = {
  h: number;
  sun: number;
  sunI: number;
  sky: number;
  ground: number;
  skyI: number;
  glassI: number;
  glassWhite: number;
  beamI: number;
};
const KEYS: Key[] = [
  {
    h: 45,
    sun: 0xfff0d8,
    sunI: 2.3,
    sky: 0x9cbff0,
    ground: 0xc08a52,
    skyI: 0.9,
    glassI: 0,
    glassWhite: 0,
    beamI: 0.3,
  },
  {
    h: 20,
    sun: 0xffe4c0,
    sunI: 2.35,
    sky: 0xa4b8e8,
    ground: 0xc08a52,
    skyI: 0.88,
    glassI: 0,
    glassWhite: 0,
    beamI: 0.45,
  },
  {
    h: 8,
    sun: 0xffa050,
    sunI: 2.2,
    sky: 0xa79ebe,
    ground: 0x936c46,
    skyI: 0.85,
    glassI: 0.1,
    glassWhite: 0,
    beamI: 0.75,
  },
  {
    h: 1,
    sun: 0xff5a30,
    sunI: 1.8,
    sky: 0x9070a0,
    ground: 0x3a2a28,
    skyI: 0.7,
    glassI: 0.4,
    glassWhite: 0,
    beamI: 1,
  },
  {
    h: -4,
    sun: 0xa04050,
    sunI: 0.8,
    sky: 0x6a5c88,
    ground: 0x241e2a,
    skyI: 0.75,
    glassI: 0.35,
    glassWhite: 0.5,
    beamI: 1,
  },
  {
    h: -TWILIGHT,
    sun: 0x8090c0,
    sunI: 0.6,
    sky: 0x5a6c9c,
    ground: 0x1c1e2a,
    skyI: 0.78,
    glassI: 0.2,
    glassWhite: 0.8,
    beamI: 1,
  },
];

export type Daylight = {
  dir: Vec;
  elevation: number;
  sun: THREE.Color;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  skyIntensity: number;
  glass: THREE.Color;
  beam: number;
};

function sunHeight(hour: number): { h: number; dir: Vec } {
  const span = TIME.sunset - TIME.sunrise;
  const t = (hour - TIME.sunrise) / span;
  if (t >= 0 && t <= 1) {
    return {
      h: Math.sin(Math.PI * t) * TIME.noonElevation,
      dir: { x: Math.cos(Math.PI * t), y: -Math.sin(Math.PI * t) },
    };
  }
  const rate = (TIME.noonElevation * Math.PI) / span;
  const afterSunset = (hour - TIME.sunset + 24) % 24;
  const beforeSunrise = (TIME.sunrise - hour + 24) % 24;
  const evening = afterSunset < beforeSunrise;
  return {
    h: -Math.min(afterSunset, beforeSunrise) * rate,
    dir: evening ? { x: -1, y: 0 } : { x: 1, y: 0 },
  };
}

function colorsAt(h: number): Omit<Daylight, "dir" | "elevation"> {
  const hi = KEYS.findIndex((k) => k.h <= h);
  const a = hi === -1 ? KEYS[KEYS.length - 1] : KEYS[Math.max(0, hi - 1)];
  const b = hi === -1 ? a : KEYS[hi];
  const s = a === b ? 0 : (a.h - h) / (a.h - b.h);
  const mix = (x: number, y: number) =>
    new THREE.Color(x).lerp(new THREE.Color(y), s);
  return {
    sun: mix(a.sun, b.sun),
    sunIntensity: a.sunI + (b.sunI - a.sunI) * s,
    sky: mix(a.sky, b.sky),
    ground: mix(a.ground, b.ground),
    skyIntensity: a.skyI + (b.skyI - a.skyI) * s,
    beam: a.beamI + (b.beamI - a.beamI) * s,
    glass: desaturate(mix(a.sun, b.sun).lerp(WHITE, a.glassWhite + (b.glassWhite - a.glassWhite) * s))
      .multiplyScalar(a.glassI + (b.glassI - a.glassI) * s),
  };
}

function desaturate(c: THREE.Color): THREE.Color {
  const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
  return c.setHSL(hsl.h, hsl.s * GLASS_SATURATION, hsl.l);
}

export function daylightAt(turn: number): Daylight {
  const { h, dir } = sunHeight(clockOf(turn).hour);
  const colors = colorsAt(h);
  if (h >= 0)
    return {
      ...colors,
      dir,
      elevation: Math.max(h, MIN_LIGHT_ELEVATION) * DEG,
    };
  const s = Math.min(1, -h / TWILIGHT);
  const x = dir.x + (MOON_DIR.x - dir.x) * s;
  const y = dir.y + (MOON_DIR.y - dir.y) * s;
  const len = Math.hypot(x, y);
  const elevation =
    MIN_LIGHT_ELEVATION + (MOON_ELEVATION - MIN_LIGHT_ELEVATION) * s;
  return {
    ...colors,
    dir: { x: x / len, y: y / len },
    elevation: elevation * DEG,
  };
}

const SUN_RADIUS = 150;

const snapZ = new THREE.Vector3();
const snapX = new THREE.Vector3();
const snapY = new THREE.Vector3();
const snapF = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function snapToShadowTexels(focus: V3, toLight: V3, texel: number): V3 {
  if (!(texel > 0) || !Number.isFinite(texel)) throw new Error(`Shadow texel must be positive, got ${texel}`);
  if (!Number.isFinite(focus.x + focus.y + focus.z + toLight.x + toLight.y + toLight.z))
    throw new Error("Shadow snap needs finite vectors");
  snapZ.set(toLight.x, toLight.y, toLight.z).normalize();
  snapX.crossVectors(UP, snapZ).normalize();
  snapY.crossVectors(snapZ, snapX);
  snapF.set(focus.x, focus.y, focus.z);
  const fx = snapF.dot(snapX);
  const fy = snapF.dot(snapY);
  snapF.addScaledVector(snapX, Math.round(fx / texel) * texel - fx).addScaledVector(snapY, Math.round(fy / texel) * texel - fy);
  return { x: snapF.x, y: snapF.y, z: snapF.z };
}

export function lightScene(sun: THREE.DirectionalLight, sky: THREE.HemisphereLight, drawn: V3, light: Daylight): void {
  const flat = Math.cos(light.elevation);
  const horiz = flat * SUN_RADIUS;
  const lift = Math.sin(light.elevation);
  const { camera, mapSize } = sun.shadow;
  const texel = (camera.right - camera.left) / mapSize.x;
  const focus = snapToShadowTexels(drawn, { x: light.dir.x * flat, y: lift, z: light.dir.y * flat }, texel);
  sun.target.position.set(focus.x, focus.y, focus.z);
  sun.position.set(focus.x + light.dir.x * horiz, focus.y + lift * SUN_RADIUS, focus.z + light.dir.y * horiz);
  sun.color.copy(light.sun);
  sun.intensity = light.sunIntensity;
  sky.color.copy(light.sky);
  sky.groundColor.copy(light.ground);
  sky.intensity = light.skyIntensity;
}

export function sunLight(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.3;
  sun.shadow.radius = SHADOW_SOFTNESS;
  Object.assign(sun.shadow.camera, {
    left: -80,
    right: 80,
    top: 80,
    bottom: -80,
    near: 1,
    far: 500,
  });
  return sun;
}

const BEAM_COLOR = 0xfff2c8;
const BEAM_INTENSITY = 25;
const BEAM_DECAY = 0.4;
const BEAM_RANGE = 70;
const BEAM_ANGLE = 42 * DEG;
const BEAM_PENUMBRA = 0.6;
const BEAM_HEIGHT = 4;
const SHADOW_BEAMS = 4;
const BEAM_SHADOW_MAP = 1024;
const BEAM_SHADOW_BIAS = 0.3;
const BEAM_AIM = { ahead: 30, down: 6 };

const GLOW_INTENSITY = 0.5;
const GLOW_RANGE = 4.5;
const GLOW_DECAY = 1;
const GLOW_HEIGHT = 3;

export function vehicleLampsOn(world: World, v: Vehicle, lightTurn: number): boolean {
  return v.id === world.player.vehicleId ? world.player.headlights : lampsOn(v.id, lightTurn);
}

export function lampsOn(id: string, lightTurn: number): boolean {
  const delay = 1 - hashStr(id);
  return !sunAt(Math.floor(lightTurn + 1 - delay));
}

export type LitVehicle = { chassisId: string; frame: VehicleFrame; on: boolean; player: boolean };

export function nightLightsWanted(turn: number, lit: Pick<LitVehicle, "on" | "player">[]): boolean {
  return !sunAt(turn) || lit.some((v) => !v.player && v.on);
}

const scratchRot = new THREE.Quaternion();
const scratchAt = new THREE.Vector3();

export function beamOrder(lit: LitVehicle[], truck: V3): LitVehicle[] {
  const dist = (v: LitVehicle) => Math.hypot(v.frame.pos.x - truck.x, v.frame.pos.y - truck.y, v.frame.pos.z - truck.z);
  return lit
    .flatMap((v, i) => (v.on ? [{ v, i, d: dist(v) }] : []))
    .sort((x, y) => x.d - y.d || (x.v.chassisId < y.v.chassisId ? -1 : x.v.chassisId > y.v.chassisId ? 1 : 0) || x.i - y.i)
    .map((e) => e.v);
}

export class VehicleLights {
  private readonly shadowed: THREE.SpotLight[] = [];
  private readonly plain: THREE.SpotLight[] = [];
  private glow: THREE.PointLight | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  sync(world: World, frames: Record<string, VehicleFrame>, lightTurn: number, reaches: (pos: V3) => boolean, truck: V3): void {
    const lit = world.vehicles
      .filter((v) => frames[v.id] && reaches(frames[v.id].pos))
      .map((v) => ({
        chassisId: v.chassisId,
        frame: frames[v.id],
        on: vehicleLampsOn(world, v, lightTurn),
        player: v.id === world.player.vehicleId,
      }));
    this.update(nightLightsWanted(world.turn, lit), daylightAt(lightTurn).beam, truck, lit);
  }

  update(night: boolean, beam: number, truck: V3, lit: LitVehicle[]): void {
    const order = beamOrder(lit, truck);
    if (!night) {
      this.removeGlow();
      this.trim(this.shadowed, Math.min(order.length, SHADOW_BEAMS));
      this.trim(this.plain, Math.max(0, order.length - SHADOW_BEAMS));
    }
    this.aim(this.shadowed, order.slice(0, SHADOW_BEAMS), true, beam);
    this.aim(this.plain, order.slice(SHADOW_BEAMS), false, beam);
    if (!night) return;
    if (!this.glow) {
      this.glow = new THREE.PointLight(PAL.truckGlow, GLOW_INTENSITY, GLOW_RANGE, GLOW_DECAY);
      this.scene.add(this.glow);
    }
    this.glow.position.set(truck.x, truck.y + GLOW_HEIGHT, truck.z);
  }

  private trim(pool: THREE.SpotLight[], n: number): void {
    for (const beam of pool.splice(n)) {
      this.scene.remove(beam, beam.target);
      beam.dispose();
    }
  }

  private removeGlow(): void {
    if (!this.glow) return;
    this.scene.remove(this.glow);
    this.glow.dispose();
    this.glow = null;
  }

  private newBeam(shadows: boolean): THREE.SpotLight {
    const beam = new THREE.SpotLight(BEAM_COLOR, 0, BEAM_RANGE, BEAM_ANGLE, BEAM_PENUMBRA, BEAM_DECAY);
    if (shadows) {
      beam.castShadow = true;
      beam.shadow.mapSize.set(BEAM_SHADOW_MAP, BEAM_SHADOW_MAP);
      beam.shadow.normalBias = BEAM_SHADOW_BIAS;
    }
    this.scene.add(beam, beam.target);
    return beam;
  }

  private aim(pool: THREE.SpotLight[], vehicles: LitVehicle[], shadows: boolean, share: number): void {
    while (pool.length < vehicles.length) pool.push(this.newBeam(shadows));
    pool.forEach((beam, i) => {
      const v = vehicles[i];
      beam.intensity = v ? BEAM_INTENSITY * share : 0;
      if (shadows) beam.shadow.autoUpdate = v !== undefined;
      if (v) this.aimAt(beam, v);
    });
  }

  private aimAt(beam: THREE.SpotLight, v: LitVehicle): void {
    const f = v.frame;
    const rot = scratchRot.set(f.rot.x, f.rot.y, f.rot.z, f.rot.w);
    const at = scratchAt.set(f.pos.x, f.pos.y, f.pos.z);
    const nose = bodyOf(v.chassisId).half.x;
    beam.position.set(nose, BEAM_HEIGHT, 0).applyQuaternion(rot).add(at);
    beam.target.position.set(nose + BEAM_AIM.ahead, -BEAM_AIM.down, 0).applyQuaternion(rot).add(at);
  }
}
