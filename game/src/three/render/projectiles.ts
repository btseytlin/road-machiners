// What flies from a muzzle to where each round lands: tracers, shells and missiles, with their look and speed per
// weapon. Rounds fly straight from the barrel tip. Hits end on the truck they struck, and misses end on the ground
// at the point the sim put them, so the sim's spread shows. Render-only: randomness here never changes rules.

import * as THREE from 'three';
import { PARTS } from '../../data/parts';
import { TIME } from '../../data/time';
import { computeRoundPoint, groundPoint, toMap, type V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { Terrain } from '../../sim/terrain';
import type { ShotRound } from '../../sim/types';

// Where a round leaves the gun and the unit direction it leaves in, read when the round fires.
export type Muzzle = { pos: V3; dir: V3 };

// What a round tells the sound when it leaves the muzzle and when it lands.
export type ShotCues = { fired: (m: Muzzle) => void; landed: () => void };

type Look = 'tracer' | 'shell' | 'missile' | 'grenade';

export type ProjectileSpec = {
  look: Look;
  speed: number; // m/s; a flight longer than the rest of the shot band is cut to fit it
  gapMs: number; // ms between the rounds of one burst; a burst is squeezed to fit CONFIG.combatBurstMaxMs
  length: number; // meters, of the drawn round or streak
  width: number; // meters
  color: number;
  flash: number; // muzzle flash length, meters
  wobble: number; // meters of side swing at mid flight
  casing: CasingSize | null; // the spent casing the gun throws per round, in CASING; null for caseless rounds
  pellets?: true; // the rounds of one volley are pellets of one shell, so the volley throws one casing
};

// The look of round k of a volley. Only the first pellet of a shell throws its casing.
export function roundSpec(spec: ProjectileSpec, k: number): ProjectileSpec {
  return spec.pellets && k > 0 ? { ...spec, casing: null } : spec;
}

// The shot band is CONFIG.combatShotMs, so slow rounds mostly fly the rest of the band and fast ones a part of it.
// Keys are weapon part def ids.
export const PROJECTILES: Record<string, ProjectileSpec> = {
  mg: { look: 'tracer', speed: 220, gapMs: 80, length: 1.4, width: 0.05, color: PAL.flash, flash: 0.6, wobble: 0, casing: 'small' },
  // Buckshot leaves almost at once, as a cloud of short streaks.
  shotgun: { look: 'tracer', speed: 160, gapMs: 8, length: 0.6, width: 0.04, color: PAL.flash, flash: 0.8, wobble: 0, casing: 'small', pellets: true },
  autocannon: { look: 'tracer', speed: 140, gapMs: 140, length: 1.2, width: 0.1, color: 0xffad50, flash: 0.9, wobble: 0, casing: 'small' },
  cannon: { look: 'shell', speed: 60, gapMs: 0, length: 0.6, width: 0.22, color: 0xffad50, flash: 1.4, wobble: 0, casing: 'large' },
  tankGun: { look: 'shell', speed: 60, gapMs: 0, length: 0.75, width: 0.28, color: 0xffad50, flash: 1.6, wobble: 0, casing: 'large' },
  sniperCannon: { look: 'shell', speed: 110, gapMs: 0, length: 0.7, width: 0.16, color: 0xffd080, flash: 1.2, wobble: 0, casing: 'large' },
  heavyMg: { look: 'tracer', speed: 200, gapMs: 90, length: 1.4, width: 0.07, color: PAL.flash, flash: 0.7, wobble: 0, casing: 'small' },
  gatling: { look: 'tracer', speed: 220, gapMs: 38, length: 1.2, width: 0.05, color: PAL.flash, flash: 0.7, wobble: 0, casing: 'small' },
  // Rifle rounds are one fast bright streak.
  longRifle: { look: 'tracer', speed: 260, gapMs: 0, length: 2, width: 0.05, color: 0xffd080, flash: 0.8, wobble: 0, casing: 'small' },
  amRifle: { look: 'tracer', speed: 260, gapMs: 0, length: 2.2, width: 0.08, color: 0xffd080, flash: 1.1, wobble: 0, casing: 'small' },
  battleRifle: { look: 'tracer', speed: 240, gapMs: 110, length: 1.6, width: 0.06, color: 0xffd080, flash: 0.8, wobble: 0, casing: 'small' },
  flechette: { look: 'tracer', speed: 280, gapMs: 70, length: 1.8, width: 0.04, color: 0xd8e0e8, flash: 0.8, wobble: 0, casing: null },
  // Burning fuel crawls out in short fat orange gouts.
  flamer: { look: 'tracer', speed: 30, gapMs: 50, length: 0.8, width: 0.3, color: 0xff7a20, flash: 1, wobble: 0.3, casing: null },
  pneumobolter: { look: 'shell', speed: 90, gapMs: 0, length: 0.9, width: 0.08, color: 0xb8b0a0, flash: 0.4, wobble: 0, casing: null },
  slugCannon: { look: 'shell', speed: 100, gapMs: 150, length: 0.4, width: 0.14, color: 0xffad50, flash: 1, wobble: 0, casing: 'large' },
  recoilless: { look: 'shell', speed: 60, gapMs: 0, length: 0.7, width: 0.2, color: 0xffad50, flash: 1.6, wobble: 0, casing: null },
  grenadeLauncher: { look: 'grenade', speed: 45, gapMs: 160, length: 0.3, width: 0.3, color: 0x4a4a3c, flash: 0.9, wobble: 0, casing: null },
  rocketRack: { look: 'missile', speed: 40, gapMs: 110, length: 0.9, width: 0.16, color: 0x6a6a64, flash: 0.9, wobble: 0.5, casing: null },
};

// The blast radius in meters of a weapon's rounds, or 0 for rounds that do not explode.
export function blastRadiusOf(key: string): number {
  const def = PARTS[key];
  if (def?.kind !== 'weapon') throw new Error(`${key} is not a weapon`);
  return def.round.splashRadius;
}

export function projectileOf(key: string): ProjectileSpec {
  const spec = PROJECTILES[key];
  if (!spec) throw new Error(`No projectile look for ${key}. Add it to PROJECTILES.`);
  return spec;
}

// Hits land below the gun point on the truck body, scattered over a band of its height.
const HIT = { drop: 0.8, band: 0.7 }; // meters
const MISS_DEPTH = 1; // meters a non-exploding ground miss may land short or long of the sim point
const GRENADE_ARC = 3; // meters a grenade climbs above the straight line at mid flight
const SHELL_TAIL = 3; // a shell's glowing trail, as a multiple of its length
const MISSILE = {
  swings: 1.5, // side swings over one flight
  smokePerSecond: 90, // trail puffs
  nose: 0x9a3a2a, // warhead, palette rust top family
  flame: 0xffc060,
};

// What a round hit: a truck, the ground, or nothing drawn, like a stray into a truck the player cannot see.
export type Impact = 'truck' | 'ground' | 'none';
export type RoundPlan = { land: V3; impact: Impact; delayMs: number; flightMs: number };
// Where one round flies: point b of the truck it struck and its offset across the line of fire, or the point where
// it lands on the ground or ends unseen.
export type RoundAim = { impact: 'truck'; b: V3; offset: number } | { impact: 'ground' | 'none'; land: V3 };

// A round that struck no truck lands where the sim put its miss. A round that struck a truck other than its target
// flies to that truck when it shows, else it ends unseen at the miss point. pointOf gives the point of a truck that
// shows, and missAt the ground point of a miss at an offset across the line of fire.
export function roundAims(b: V3, targetId: string, rounds: ShotRound[], pointOf: (id: string) => V3 | null, missAt: (offset: number) => V3): RoundAim[] {
  return rounds.map((r): RoundAim => {
    if (r.struck === null) return { impact: 'ground', land: missAt(r.offset) };
    if (r.struck === targetId) return { impact: 'truck', b, offset: r.offset };
    const p = pointOf(r.struck);
    return p ? { impact: 'truck', b: p, offset: 0 } : { impact: 'none', land: missAt(r.offset) };
  });
}

// When a volley leaves and how long its band is. startMs is the volley's own start; burstMaxMs caps one burst's length.
export type VolleyTiming = { startMs: number; windowMs: number; burstMaxMs: number };

// Where and when each round of a volley from gun point a lands. groundY gives the ground height under a point.
// Rounds leave gapMs apart from startMs, and every one lands within the window. A ground miss of a round with a
// blast radius lands exactly on its point, since the sim applied the splash there.
export function planVolley(spec: ProjectileSpec, a: V3, rounds: RoundAim[], timing: VolleyTiming, groundY: (p: V3) => number, blastRadius: number): RoundPlan[] {
  const { startMs, windowMs, burstMaxMs } = timing;
  const gap = rounds.length > 1 ? Math.min(spec.gapMs, burstMaxMs / (rounds.length - 1)) : 0;
  if (startMs + Math.max(0, rounds.length - 1) * gap >= windowMs) throw new Error(`A volley starting at ${startMs} ms leaves no time to fire ${rounds.length} rounds in ${windowMs} ms`);
  return rounds.map((r, k) => {
    const land = r.impact === 'truck' ? hitPoint(a, r.b, r.offset) : r.impact === 'ground' && blastRadius === 0 ? groundMiss(a, r.land, groundY) : r.land;
    const delayMs = startMs + k * gap;
    const meters = Math.hypot(land.x - a.x, land.y - a.y, land.z - a.z);
    return { land, impact: r.impact, delayMs, flightMs: Math.min((meters / spec.speed) * 1000, windowMs - delayMs) };
  });
}

function hitPoint(a: V3, b: V3, offset: number): V3 {
  const p = computeRoundPoint(a, b, offset);
  return { x: p.x, y: b.y - HIT.drop + (Math.random() - 0.5) * HIT.band, z: p.z };
}

// A miss moved a little short or long along the line of fire, so a burst does not sit on one straight line.
function groundMiss(a: V3, land: V3, groundY: (p: V3) => number): V3 {
  const dx = land.x - a.x;
  const dz = land.z - a.z;
  const len = Math.hypot(dx, dz);
  const shift = (Math.random() * 2 - 1) * MISS_DEPTH;
  const end = { x: land.x + (dx / len) * shift, y: 0, z: land.z + (dz / len) * shift };
  return { ...end, y: groundY(end) };
}

// ---- Flights.

// A round waiting for its delay, then flying from the muzzle to its landing point over its life.
type Flight = {
  spec: ProjectileSpec;
  obj: THREE.Object3D;
  muzzle: () => Muzzle;
  from: THREE.Vector3;
  to: THREE.Vector3;
  side: THREE.Vector3; // unit horizontal direction the wobble swings along
  phase: number;
  age: number; // seconds; negative while waiting
  life: number;
  onFire: (m: Muzzle) => void;
  onLand: () => void;
};

export type Launch = { spec: ProjectileSpec; muzzle: () => Muzzle; plan: RoundPlan; onFire: (m: Muzzle) => void; onLand: () => void };

const X_AXIS = new THREE.Vector3(1, 0, 0);

// Builds meshes from shared geometry and materials, which live as long as the scene.
class ProjectileKit {
  private box = new THREE.BoxGeometry(1, 1, 1);
  private solid = new Map<number, THREE.MeshBasicMaterial>();
  private shellCore = new THREE.OctahedronGeometry(0.5).scale(1, 0.6, 0.6);
  private body = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateZ(-Math.PI / 2);
  private cone = new THREE.ConeGeometry(0.5, 1, 6).rotateZ(-Math.PI / 2);
  private glow = new Map<number, THREE.MeshBasicMaterial>();
  private paint = new Map<number, THREE.MeshLambertMaterial>();
  private nose = new THREE.MeshLambertMaterial({ color: MISSILE.nose, flatShading: true });

  build(spec: ProjectileSpec): THREE.Object3D {
    if (spec.look === 'tracer') return this.tracer(spec);
    if (spec.look === 'shell') return this.shell(spec);
    if (spec.look === 'grenade') return this.grenade(spec);
    return this.missile(spec);
  }

  // A streak whose front is the round. It is stretched each frame, so its x scale is set by the flight.
  private tracer(spec: ProjectileSpec): THREE.Object3D {
    const streak = new THREE.Mesh(this.box, this.glowOf(spec.color, 1));
    streak.position.x = -0.5;
    const g = new THREE.Group();
    g.add(streak);
    g.scale.set(spec.length, spec.width, spec.width);
    return g;
  }

  // A hot slug with a fading glow trail behind it.
  private shell(spec: ProjectileSpec): THREE.Object3D {
    const g = new THREE.Group();
    const core = new THREE.Mesh(this.shellCore, this.glowOf(0xfff0c0, 1));
    core.scale.set(spec.length, spec.width, spec.width);
    const tail = new THREE.Mesh(this.box, this.glowOf(spec.color, 0.55));
    tail.scale.set(spec.length * SHELL_TAIL, spec.width * 0.6, spec.width * 0.6);
    tail.position.x = (-spec.length * SHELL_TAIL) / 2;
    g.add(core, tail);
    return g;
  }

  // A dull round grenade with no glow, lobbed on an arc.
  private grenade(spec: ProjectileSpec): THREE.Object3D {
    const body = new THREE.Mesh(this.shellCore, this.solidOf(spec.color));
    body.scale.set(spec.length, spec.width, spec.width);
    return body;
  }

  // A finned rocket: body, warhead cone and a flame at the tail.
  private missile(spec: ProjectileSpec): THREE.Object3D {
    const g = new THREE.Group();
    const L = spec.length;
    const w = spec.width;
    const metal = this.paintOf(spec.color);
    const body = new THREE.Mesh(this.body, metal);
    body.scale.set(L * 0.75, w, w);
    const nose = new THREE.Mesh(this.cone, this.nose);
    nose.scale.set(L * 0.25, w, w);
    nose.position.x = L * 0.5;
    const flame = new THREE.Mesh(this.cone, this.glowOf(MISSILE.flame, 1));
    flame.scale.set(L * 0.5, w * 0.9, w * 0.9);
    flame.rotation.z = Math.PI;
    flame.position.x = -L * 0.62;
    g.add(body, nose, flame);
    for (const turn of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(this.box, metal);
      fin.scale.set(L * 0.2, w * 2.2, 0.02);
      fin.rotation.x = turn;
      fin.position.x = -L * 0.3;
      g.add(fin);
    }
    return g;
  }

  private paintOf(color: number): THREE.MeshLambertMaterial {
    let mat = this.paint.get(color);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.paint.set(color, mat);
    }
    return mat;
  }

  private solidOf(color: number): THREE.MeshBasicMaterial {
    let mat = this.solid.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color });
      this.solid.set(color, mat);
    }
    return mat;
  }

  private glowOf(color: number, opacity: number): THREE.MeshBasicMaterial {
    const key = color * 10 + Math.round(opacity * 9);
    let mat = this.glow.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.glow.set(key, mat);
    }
    return mat;
  }
}

export class Projectiles {
  private kit = new ProjectileKit();
  private flights: Flight[] = [];
  private at = new THREE.Vector3();
  private ahead = new THREE.Vector3();
  private dir = new THREE.Vector3();

  // smoke puffs one trail puff at a point behind a missile.
  constructor(private scene: THREE.Scene, private smoke: (p: V3) => void) {}

  launch(l: Launch): void {
    const obj = this.kit.build(l.spec);
    obj.visible = false;
    this.scene.add(obj);
    const to = new THREE.Vector3(l.plan.land.x, l.plan.land.y, l.plan.land.z);
    this.flights.push({
      spec: l.spec,
      obj,
      muzzle: l.muzzle,
      from: new THREE.Vector3(),
      to,
      side: new THREE.Vector3(),
      phase: Math.random() * Math.PI * 2,
      age: -l.plan.delayMs / 1000,
      life: l.plan.flightMs / 1000,
      onFire: l.onFire,
      onLand: l.onLand,
    });
  }

  tick(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const before = f.age;
      f.age += dt;
      if (f.age < 0) continue;
      if (before <= 0) this.fire(f); // the delay ran out this frame
      if (f.age >= f.life) {
        this.scene.remove(f.obj);
        this.flights.splice(i, 1);
        f.onLand();
        continue;
      }
      this.place(f, dt);
    }
  }

  private fire(f: Flight): void {
    const m = f.muzzle();
    f.from.set(m.pos.x, m.pos.y, m.pos.z);
    f.side.set(-(f.to.z - f.from.z), 0, f.to.x - f.from.x).normalize();
    f.obj.visible = true;
    f.onFire(m);
  }

  private place(f: Flight, dt: number): void {
    const t = f.age / f.life;
    this.pointAt(f, t, this.at);
    this.pointAt(f, Math.min(1, t + 0.01), this.ahead);
    this.dir.subVectors(this.ahead, this.at).normalize();
    f.obj.position.copy(this.at);
    f.obj.quaternion.setFromUnitVectors(X_AXIS, this.dir);
    // A streak never reaches back past the muzzle.
    if (f.spec.look === 'tracer') f.obj.scale.x = Math.min(f.spec.length, this.at.distanceTo(f.from));
    if (f.spec.look === 'missile') this.trail(f, dt);
  }

  // Straight from the muzzle to the landing point, plus a swing that is zero at both ends. A grenade also arcs up.
  private pointAt(f: Flight, t: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(f.from, f.to, t);
    const swing = f.spec.wobble * Math.sin(Math.PI * t) * Math.sin(MISSILE.swings * 2 * Math.PI * t + f.phase);
    if (f.spec.look === 'grenade') out.y += GRENADE_ARC * 4 * t * (1 - t);
    return out.addScaledVector(f.side, swing);
  }

  private trail(f: Flight, dt: number): void {
    for (let n = Math.floor(MISSILE.smokePerSecond * dt + Math.random()); n > 0; n--) {
      const back = this.at.clone().addScaledVector(this.dir, -f.spec.length * (0.8 + Math.random() * 0.4));
      this.smoke({ x: back.x, y: back.y, z: back.z });
    }
  }
}

// Spent brass a gun throws out as each round fires. A casing leaves from behind the muzzle, flies out to the gun's
// right side and up, bounces once on the ground or deck and lies flat. Casings stay a day of turns and shrink away in
// the last tenth of it. Render-only: never saved, so they are gone after a load, and never read by sim or physics.

export type CasingSize = 'small' | 'large';

// Sizes are a little larger than real brass, so a casing still reads from the isometric camera without looking like loot.
export const CASING = {
  max: 400, // casings alive at once, both sizes together; a new one past it replaces the oldest
  lifeTurns: TIME.turnsPerDay,
  fadeShare: 0.1, // the last share of the life over which a casing shrinks away
  small: { length: 0.14, radius: 0.03 }, // meters
  large: { length: 0.28, radius: 0.06 },
  glint: 0x4a3810, // brass glows this much, so a casing reads against dark ground and in shade
  back: 0.6, // meters behind the muzzle along the barrel where the casing leaves the breech
  eject: { side: 2.4, up: 2.2, spread: 0.8, spin: 18 }, // m/s out to the right and up, ± m/s of spread, rad/s of tumble
  gravity: 9.8, // m/s^2
  bounce: 0.35, // share of the falling speed kept by the one bounce
  slide: 0.4, // share of the ground speed kept by the bounce
} as const;

type Casing = {
  size: CasingSize;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number; // radians about up
  roll: number; // radians of tumble about the casing's own axis line
  spin: number; // rad/s of tumble while flying
  bounced: boolean;
  resting: boolean;
  turn: number; // the turn it was thrown in
};

const SIZES: CasingSize[] = ['small', 'large'];
const UP = new THREE.Vector3(0, 1, 0);
const AXIS = new THREE.Vector3(1, 0, 0); // a casing's length, before its yaw

export class Casings {
  readonly meshes: Record<CasingSize, THREE.InstancedMesh>;
  private casings: Casing[] = []; // oldest first
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private tumble = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private material = new THREE.MeshLambertMaterial({ color: PAL.brass, emissive: CASING.glint, flatShading: true });

  constructor(private scene: THREE.Scene) {
    this.meshes = { small: casingMesh(CASING.small, this.material), large: casingMesh(CASING.large, this.material) };
    scene.add(this.meshes.small, this.meshes.large);
  }

  // Throws one casing from the gun as its round fires. A gun with no casing (size null) throws nothing.
  eject(muzzle: Muzzle, size: CasingSize | null, turn: number): void {
    if (size === null) return;
    const dir = new THREE.Vector3(muzzle.dir.x, muzzle.dir.y, muzzle.dir.z).normalize();
    const flat = Math.hypot(dir.x, dir.z);
    if (!(flat > 0)) throw new Error('A casing needs a muzzle pointing off the vertical, to know its right side');
    // Positive offsets across the line of fire are the shooter's right, as in computeRoundPoint.
    const right = new THREE.Vector3(-dir.z / flat, 0, dir.x / flat);
    const pos = new THREE.Vector3(muzzle.pos.x, muzzle.pos.y, muzzle.pos.z).addScaledVector(dir, -CASING.back);
    const e = CASING.eject;
    const vel = right.multiplyScalar(e.side + spread()).addScaledVector(UP, e.up + spread()).addScaledVector(dir, spread());
    if (this.casings.length >= CASING.max) this.casings.shift();
    const yaw = -Math.atan2(dir.z, dir.x);
    this.casings.push({ size, pos, vel, yaw, roll: 0, spin: e.spin * (Math.random() + 0.5), bounced: false, resting: false, turn });
  }

  // Moves flying casings, drops the expired ones and draws the rest. terrain gives the ground or deck height.
  tick(dt: number, terrain: Terrain, turn: number): void {
    this.casings = this.casings.filter((c) => turn - c.turn < CASING.lifeTurns);
    for (const c of this.casings) if (!c.resting) this.fly(c, dt, terrain);
    this.draw(turn);
  }

  dispose(): void {
    this.scene.remove(this.meshes.small, this.meshes.large);
    for (const size of SIZES) this.meshes[size].geometry.dispose();
    this.material.dispose();
  }

  // A simple arc under gravity. The first touch of the ground bounces it, the second lays it flat at a random yaw.
  private fly(c: Casing, dt: number, terrain: Terrain): void {
    c.vel.y -= CASING.gravity * dt;
    c.pos.addScaledVector(c.vel, dt);
    c.roll += c.spin * dt;
    const rest = groundPoint(terrain, toMap(c.pos)).y + CASING[c.size].radius;
    if (c.pos.y > rest) return;
    c.pos.y = rest;
    if (c.bounced) return this.lay(c);
    c.bounced = true;
    c.vel.set(c.vel.x * CASING.slide, -c.vel.y * CASING.bounce, c.vel.z * CASING.slide);
  }

  private lay(c: Casing): void {
    c.resting = true;
    c.vel.set(0, 0, 0);
    c.yaw = Math.random() * Math.PI * 2;
    c.roll = 0;
  }

  private draw(turn: number): void {
    const counts: Record<CasingSize, number> = { small: 0, large: 0 };
    for (const c of this.casings) {
      this.quat.setFromAxisAngle(UP, c.yaw).multiply(this.tumble.setFromAxisAngle(AXIS, c.roll));
      this.scale.setScalar(fadeOf(turn - c.turn));
      this.matrix.compose(c.pos, this.quat, this.scale);
      this.meshes[c.size].setMatrixAt(counts[c.size]++, this.matrix);
    }
    for (const size of SIZES) {
      this.meshes[size].count = counts[size];
      this.meshes[size].instanceMatrix.needsUpdate = true;
    }
  }
}

// The size share left at an age in turns: whole until the last fadeShare of the life, then down toward nothing.
function fadeOf(age: number): number {
  const fade = CASING.lifeTurns * CASING.fadeShare;
  return Math.min(1, (CASING.lifeTurns - age) / fade);
}

function spread(): number {
  return (Math.random() * 2 - 1) * CASING.eject.spread;
}

// A six-sided brass cylinder lying along +x, one instance per casing of a size.
function casingMesh(size: { length: number; radius: number }, material: THREE.Material): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(size.radius, size.radius, size.length, 6).rotateZ(Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, CASING.max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false; // casings land anywhere; the bounds of one casing mean nothing
  return mesh;
}
