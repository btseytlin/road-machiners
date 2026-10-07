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

const MIN_LIGHT_ELEVATION = 6; // degrees; a lower light would stretch every shadow across the whole view
const TWILIGHT = 10; // degrees below the horizon where the handover to moonlight ends
const MOON_ELEVATION = 25; // degrees
const MOON_DIR = TERRAIN.light;
const WHITE = new THREE.Color(0xffffff);
const GLASS_SATURATION = 0.9; // share of the glow color's saturation kept, so windows read softer than the light
const SHADOW_SOFTNESS = 1; // shadow-map texels between the 3x3 filter taps, a clear edge about three texels wide

// Keyed by the sun's height in degrees, highest first. Negative is below the horizon.
// By day the ground color is warm sand, so faces turned down catch light bounced off the desert. The day sky is a
// light blue, so shadows on the orange sand go mauve-brown.
type Key = {
  h: number;
  sun: number;
  sunI: number;
  sky: number;
  ground: number;
  skyI: number;
  glassI: number; // strength of the glow cab windows add: none by day, most at sunset
  glassWhite: number; // share of white in that glow, so it goes from the sunset color to a whitish night glow
  beamI: number; // share of the headlight beam strength that shows: all of it from sunset on, less under a high sun
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
  dir: Vec; // unit map direction toward the light
  elevation: number; // radians
  sun: THREE.Color;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  skyIntensity: number;
  glass: THREE.Color; // glow cab windows add: the sun color at sunset, whitish at night
  beam: number; // share of the headlight beam strength that shows, 1 from sunset on
};

// The sun's height in degrees. At night it keeps sinking at its horizon rate, so twilight has a length.
function sunHeight(hour: number): { h: number; dir: Vec } {
  const span = TIME.sunset - TIME.sunrise;
  const t = (hour - TIME.sunrise) / span;
  if (t >= 0 && t <= 1) {
    return {
      h: Math.sin(Math.PI * t) * TIME.noonElevation,
      dir: { x: Math.cos(Math.PI * t), y: -Math.sin(Math.PI * t) },
    };
  }
  const rate = (TIME.noonElevation * Math.PI) / span; // degrees per hour at the horizon
  const afterSunset = (hour - TIME.sunset + 24) % 24;
  const beforeSunrise = (TIME.sunrise - hour + 24) % 24;
  const evening = afterSunset < beforeSunrise;
  return {
    h: -Math.min(afterSunset, beforeSunrise) * rate,
    dir: evening ? { x: -1, y: 0 } : { x: 1, y: 0 },
  };
}

function colorsAt(h: number): Omit<Daylight, "dir" | "elevation"> {
  // Past either end the light holds the end key, so deep night never extrapolates.
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
  // Below the horizon the light swings from the set sun to the moon while it is dim.
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

const SUN_RADIUS = 150; // meters from the focus to the sun light

// Moves focus along the shadow camera's right and up axes to the nearest whole texel, so the shadow map's
// sampling grid stays fixed on the ground while the focus travels. The light axis is untouched.
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
  // Same basis as Matrix4.lookAt() with up = (0, 1, 0).
  snapX.crossVectors(UP, snapZ).normalize();
  snapY.crossVectors(snapZ, snapX);
  snapF.set(focus.x, focus.y, focus.z);
  const fx = snapF.dot(snapX);
  const fy = snapF.dot(snapY);
  snapF.addScaledVector(snapX, Math.round(fx / texel) * texel - fx).addScaledVector(snapY, Math.round(fy / texel) * texel - fy);
  return { x: snapF.x, y: snapF.y, z: snapF.z };
}

// Puts the sun above focus in the light's direction and colors both lights.
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

// The sun light with its shadow box. The box follows the player, snapped to whole texels so static shadows hold still.
export function sunLight(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The terrain shadows itself. Without a normal offset its lit slopes show striped shadow acne.
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

// Vehicle lights. At night: headlight beams for every vehicle within gray vision, also one the player cannot see,
// and a faint glow over the player truck so its paint reads against the dark ground. By day: only the beams of lamps
// that are on, which is the player's switch, scaled by Daylight.beam.

const BEAM_COLOR = 0xfff2c8;
const BEAM_INTENSITY = 25;
const BEAM_DECAY = 0.4; // below the physical 2, so the ground by the nose does not burn white
const BEAM_RANGE = 70; // meters where the light fades to nothing
const BEAM_ANGLE = 42 * DEG; // half-angle of the cone
const BEAM_PENUMBRA = 0.6; // soft share of the cone edge
const BEAM_HEIGHT = 4; // meters above the truck center where the beam starts
const SHADOW_BEAMS = 4; // beams that cast shadows: the lamp-on trucks nearest the player truck
const BEAM_SHADOW_MAP = 1024; // texels per side of a beam's shadow map
const BEAM_SHADOW_BIAS = 0.3; // meters along the surface normal, against acne on ground the beam grazes
const BEAM_AIM = { ahead: 30, down: 6 }; // meters ahead of the nose and below the truck center the beam points at

const GLOW_INTENSITY = 0.5;
const GLOW_RANGE = 4.5; // meters where the glow fades to nothing
const GLOW_DECAY = 1; // below the physical 2, so the roof under the light does not burn white
const GLOW_HEIGHT = 3; // meters above the truck center

// Whether a vehicle's lamps shine now. The player's truck follows the player's switch; every other vehicle follows
// the clock. lightTurn: the clock the light shows, fractional while a turn plays.
export function vehicleLampsOn(world: World, v: Vehicle, lightTurn: number): boolean {
  return v.id === world.player.vehicleId ? world.player.headlights : lampsOn(v.id, lightTurn);
}

// The clock rule for NPC lamps. Callers use vehicleLampsOn. Each vehicle switches its lamps at its own moment
// within the turn that dusk or dawn falls on.
export function lampsOn(id: string, lightTurn: number): boolean {
  // The share of the movement that plays before the switch, in (0, 1]. A vehicle at rest shows its turn's state.
  const delay = 1 - hashStr(id);
  return !sunAt(Math.floor(lightTurn + 1 - delay));
}

// on: the vehicle's lamps shine now. Beams of vehicles with lamps off stay in the pool at zero.
// player: the player's truck, whose lamps follow the switch and not the clock.
export type LitVehicle = { chassisId: string; frame: VehicleFrame; on: boolean; player: boolean };

// Whether the night lights should exist. At dawn NPC lamps switch off one by one, so the night lights stay until the
// last one is off. The player's switch alone does not keep them. By day the beams follow the lamps that are on instead.
export function nightLightsWanted(turn: number, lit: Pick<LitVehicle, "on" | "player">[]): boolean {
  return !sunAt(turn) || lit.some((v) => !v.player && v.on);
}

const scratchRot = new THREE.Quaternion();
const scratchAt = new THREE.Vector3();

// The lamp-on vehicles nearest the truck first. Ties break by chassis id, then by input order.
export function beamOrder(lit: LitVehicle[], truck: V3): LitVehicle[] {
  const dist = (v: LitVehicle) => Math.hypot(v.frame.pos.x - truck.x, v.frame.pos.y - truck.y, v.frame.pos.z - truck.z);
  return lit
    .flatMap((v, i) => (v.on ? [{ v, i, d: dist(v) }] : []))
    .sort((x, y) => x.d - y.d || (x.v.chassisId < y.v.chassisId ? -1 : x.v.chassisId > y.v.chassisId ? 1 : 0) || x.i - y.i)
    .map((e) => e.v);
}

// A change in light count recompiles every material, and a change in the count of shadowed lights does too. So
// through the night both beam pools only grow, and unused beams stay at zero until dawn. By day the pools hold exactly
// the lamps that are on, so the count changes only at a lamp switch or at the dusk and dawn handover.
// The SHADOW_BEAMS nearest lamp-on vehicles take shadowed beams, so props block their light. The rest take plain
// beams, which shine through props, because each shadowed beam costs a depth pass per frame.
export class VehicleLights {
  private readonly shadowed: THREE.SpotLight[] = [];
  private readonly plain: THREE.SpotLight[] = [];
  private glow: THREE.PointLight | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  // Lights the vehicles within gray vision. truck: the drawn player truck position.
  sync(world: World, frames: Record<string, VehicleFrame>, lightTurn: number, reaches: (pos: V3) => boolean, truck: V3, beam: number): void {
    const lit = world.vehicles
      .filter((v) => frames[v.id] && reaches(frames[v.id].pos))
      .map((v) => ({
        chassisId: v.chassisId,
        frame: frames[v.id],
        on: vehicleLampsOn(world, v, lightTurn),
        player: v.id === world.player.vehicleId,
      }));
    this.update(nightLightsWanted(world.turn, lit), beam, truck, lit);
  }

  // night: nightLightsWanted. beam: Daylight.beam. truck: the drawn player truck position. lit: vehicles within gray vision.
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
