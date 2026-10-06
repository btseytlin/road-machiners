// What flies from a muzzle to where each round lands: tracers, shells, missiles and the harpoon's bolt, with their
// look and speed per weapon. Rounds fly straight from the barrel tip. Hits end on the target truck, and misses fly past
// it into the ground, so the sim's spread shows. A round with a rope trails it from the muzzle: on a hit the rope
// stays until the turn's playback ends and the line takes over (see lines.ts), and on a miss it lies where the round
// fell and reels back in. Render-only: randomness here never changes rules.

import * as THREE from 'three';
import { PARTS, type WeaponRound } from '../../data/parts';
import { computeRoundPoint, type V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { reelRope, Rope, ROPE_LOOK, type GroundAt } from './lines';
import type { ShotRound } from '../../sim/types';

// Where a round leaves the gun and the unit direction it leaves in, read when the round fires.
export type Muzzle = { pos: V3; dir: V3 };

// A muzzle at a fixed gun point, like a guard tower, facing its target.
export function towardFrom(from: V3, target: V3): Muzzle {
  return { pos: from, dir: { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z } };
}

// What a round tells the sound when it leaves the muzzle and when it lands.
export type ShotCues = { fired: (m: Muzzle) => void; landed: () => void };

type Look = 'tracer' | 'shell' | 'missile' | 'grenade' | 'bolt';

export type ProjectileSpec = {
  look: Look;
  speed: number; // m/s; a flight longer than the rest of the shot band is cut to fit it
  gapMs: number; // ms between the rounds of one burst; a burst is squeezed to fit CONFIG.combatBurstMaxMs
  length: number; // meters, of the drawn round or streak
  width: number; // meters
  color: number;
  flash: number; // muzzle flash length, meters
  wobble: number; // meters of side swing at mid flight
  rope?: true; // the round trails a rope from the muzzle
};

// The shot band is CONFIG.combatShotMs, so slow rounds mostly fly the rest of the band and fast ones a part of it.
// Keys are weapon part def ids, plus guard for town and camp guns.
export const PROJECTILES: Record<string, ProjectileSpec> = {
  mg: { look: 'tracer', speed: 220, gapMs: 80, length: 1.4, width: 0.05, color: PAL.flash, flash: 0.6, wobble: 0 },
  guard: { look: 'tracer', speed: 220, gapMs: 80, length: 1.4, width: 0.05, color: PAL.flash, flash: 0.6, wobble: 0 },
  // Buckshot leaves almost at once, as a cloud of short streaks.
  shotgun: { look: 'tracer', speed: 160, gapMs: 8, length: 0.6, width: 0.04, color: PAL.flash, flash: 0.8, wobble: 0 },
  autocannon: { look: 'tracer', speed: 140, gapMs: 140, length: 1.2, width: 0.1, color: 0xffad50, flash: 0.9, wobble: 0 },
  cannon: { look: 'shell', speed: 60, gapMs: 0, length: 0.6, width: 0.22, color: 0xffad50, flash: 1.4, wobble: 0 },
  tankGun: { look: 'shell', speed: 60, gapMs: 0, length: 0.75, width: 0.28, color: 0xffad50, flash: 1.6, wobble: 0 },
  sniperCannon: { look: 'shell', speed: 110, gapMs: 0, length: 0.7, width: 0.16, color: 0xffd080, flash: 1.2, wobble: 0 },
  heavyMg: { look: 'tracer', speed: 200, gapMs: 90, length: 1.4, width: 0.07, color: PAL.flash, flash: 0.7, wobble: 0 },
  gatling: { look: 'tracer', speed: 220, gapMs: 38, length: 1.2, width: 0.05, color: PAL.flash, flash: 0.7, wobble: 0 },
  // Rifle rounds are one fast bright streak.
  longRifle: { look: 'tracer', speed: 260, gapMs: 0, length: 2, width: 0.05, color: 0xffd080, flash: 0.8, wobble: 0 },
  amRifle: { look: 'tracer', speed: 260, gapMs: 0, length: 2.2, width: 0.08, color: 0xffd080, flash: 1.1, wobble: 0 },
  battleRifle: { look: 'tracer', speed: 240, gapMs: 110, length: 1.6, width: 0.06, color: 0xffd080, flash: 0.8, wobble: 0 },
  flechette: { look: 'tracer', speed: 280, gapMs: 70, length: 1.8, width: 0.04, color: 0xd8e0e8, flash: 0.8, wobble: 0 },
  // Burning fuel crawls out in short fat orange gouts.
  flamer: { look: 'tracer', speed: 30, gapMs: 50, length: 0.8, width: 0.3, color: 0xff7a20, flash: 1, wobble: 0.3 },
  pneumobolter: { look: 'shell', speed: 90, gapMs: 0, length: 0.9, width: 0.08, color: 0xb8b0a0, flash: 0.4, wobble: 0 },
  slugCannon: { look: 'shell', speed: 100, gapMs: 150, length: 0.4, width: 0.14, color: 0xffad50, flash: 1, wobble: 0 },
  recoilless: { look: 'shell', speed: 60, gapMs: 0, length: 0.7, width: 0.2, color: 0xffad50, flash: 1.6, wobble: 0 },
  grenadeLauncher: { look: 'grenade', speed: 45, gapMs: 160, length: 0.3, width: 0.3, color: 0x4a4a3c, flash: 0.9, wobble: 0 },
  // The harpoon's dark barbed bolt flies as fast as a cannon shell, trailing its rope.
  harpoon: { look: 'bolt', speed: 110, gapMs: 0, length: 1.1, width: 0.16, color: 0x2e2a26, flash: 0.5, wobble: 0, rope: true },
  rocketRack: { look: 'missile', speed: 40, gapMs: 110, length: 0.9, width: 0.16, color: 0x6a6a64, flash: 0.9, wobble: 0.5 },
};

// The blast radius in meters of a weapon's rounds, or 0 for rounds that do not explode. Guard guns fire bullets.
export function blastRadiusOf(key: string): number {
  return key === 'guard' ? 0 : roundOf(key).splashRadius;
}

function roundOf(key: string): WeaponRound {
  const def = PARTS[key];
  if (def?.kind === 'weapon') return def.round;
  throw new Error(`${key} fires no shot`);
}

export function projectileOf(key: string): ProjectileSpec {
  const spec = PROJECTILES[key];
  if (!spec) throw new Error(`No projectile look for ${key}. Add it to PROJECTILES.`);
  return spec;
}

// Hits land below the gun point on the truck body, scattered over a band of its height.
const HIT = { drop: 0.8, band: 0.7 }; // meters
// A stray round flies on past the target and hits the ground this many meters beyond it.
const MISS = { minPast: 3, maxPast: 9 };
const GRENADE_ARC = 3; // meters a grenade climbs above the straight line at mid flight
const SHELL_TAIL = 3; // a shell's glowing trail, as a multiple of its length
const MISSILE = {
  swings: 1.5, // side swings over one flight
  smokePerSecond: 90, // trail puffs
  nose: 0x9a3a2a, // warhead, palette rust top family
  flame: 0xffc060,
};

export type RoundPlan = { land: V3; struck: boolean; delayMs: number; flightMs: number };
// Where one round flies: point b of the truck it struck, or of its target when it struck none, and its offset
// across the line of fire.
export type RoundAim = { b: V3; struck: boolean; offset: number };

// A round that struck a truck other than its target flies to that truck when it shows, else past the target.
// pointOf gives the point of a truck that shows.
export function roundAims(b: V3, targetId: string, rounds: ShotRound[], pointOf: (id: string) => V3 | null): RoundAim[] {
  return rounds.map((r) => {
    if (r.struck === null || r.struck === targetId) return { b, struck: r.struck !== null, offset: r.offset };
    const p = pointOf(r.struck);
    return p ? { b: p, struck: true, offset: 0 } : { b, struck: false, offset: r.offset };
  });
}

// When a volley leaves and how long its band is. startMs is the volley's own start; burstMaxMs caps one burst's length.
export type VolleyTiming = { startMs: number; windowMs: number; burstMaxMs: number };

// Where and when each round of a volley from gun point a lands. groundY gives the ground height under a point.
// Rounds leave gapMs apart from startMs, and every one lands within the window.
export function planVolley(spec: ProjectileSpec, a: V3, rounds: RoundAim[], timing: VolleyTiming, groundY: (p: V3) => number): RoundPlan[] {
  const { startMs, windowMs, burstMaxMs } = timing;
  const gap = rounds.length > 1 ? Math.min(spec.gapMs, burstMaxMs / (rounds.length - 1)) : 0;
  if (startMs + Math.max(0, rounds.length - 1) * gap >= windowMs) throw new Error(`A volley starting at ${startMs} ms leaves no time to fire ${rounds.length} rounds in ${windowMs} ms`);
  return rounds.map((r, k) => {
    const struck = r.struck;
    const land = struck ? hitPoint(a, r.b, r.offset) : missPoint(a, r.b, r.offset, groundY);
    const delayMs = startMs + k * gap;
    const meters = Math.hypot(land.x - a.x, land.y - a.y, land.z - a.z);
    return { land, struck, delayMs, flightMs: Math.min((meters / spec.speed) * 1000, windowMs - delayMs) };
  });
}

function hitPoint(a: V3, b: V3, offset: number): V3 {
  const p = computeRoundPoint(a, b, offset);
  return { x: p.x, y: b.y - HIT.drop + (Math.random() - 0.5) * HIT.band, z: p.z };
}

function missPoint(a: V3, b: V3, offset: number, groundY: (p: V3) => number): V3 {
  const p = computeRoundPoint(a, b, offset);
  const dx = p.x - a.x;
  const dz = p.z - a.z;
  const len = Math.hypot(dx, dz);
  const past = MISS.minPast + Math.random() * (MISS.maxPast - MISS.minPast);
  const end = { x: p.x + (dx / len) * past, y: 0, z: p.z + (dz / len) * past };
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
  rope: Rope | null;
  struck: boolean;
  ground: GroundAt;
};

// A rope left by a round that missed: it lies from the muzzle to where the round fell and reels in over age seconds.
type Reel = { rope: Rope; from: THREE.Vector3; to: THREE.Vector3; age: number; ground: GroundAt };

// ground: the ground height under a point, where a rope comes to rest.
export type Launch = { spec: ProjectileSpec; muzzle: () => Muzzle; plan: RoundPlan; onFire: (m: Muzzle) => void; onLand: () => void; ground: GroundAt };

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
    if (spec.look === 'bolt') return this.bolt(spec);
    return this.missile(spec);
  }

  // A barbed bolt: a thin shaft behind a wide pointed head, dark iron with no glow.
  private bolt(spec: ProjectileSpec): THREE.Object3D {
    const g = new THREE.Group();
    const iron = this.paintOf(spec.color);
    const shaft = new THREE.Mesh(this.body, iron);
    shaft.scale.set(spec.length * 0.75, spec.width * 0.35, spec.width * 0.35);
    shaft.position.x = -spec.length * 0.25;
    const head = new THREE.Mesh(this.cone, iron);
    head.scale.set(spec.length * 0.3, spec.width, spec.width);
    head.position.x = spec.length * 0.3;
    g.add(shaft, head);
    return g;
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
  private held: Rope[] = []; // ropes of rounds that struck, until releaseRopes()
  private reels: Reel[] = [];
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
      rope: l.spec.rope ? new Rope() : null,
      struck: l.plan.struck,
      ground: l.ground,
    });
  }

  // Drops the ropes of rounds that struck, when the turn's playback ends and the lines show.
  releaseRopes(): void {
    for (const rope of this.held) this.scene.remove(rope.root);
    this.held = [];
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
        this.landRope(f);
        f.onLand();
        continue;
      }
      this.place(f, dt);
    }
    this.reel(dt);
  }

  // The rope ends where the round landed: held taut there on a hit, and on a miss dropping slack onto the ground
  // before it reels in.
  private landRope(f: Flight): void {
    if (!f.rope) return;
    f.rope.set(f.from, f.to, f.from.distanceTo(f.to), f.ground);
    if (f.struck) this.held.push(f.rope);
    else this.reels.push({ rope: f.rope, from: f.from, to: f.to, age: 0, ground: f.ground });
  }

  // A missed rope lies on the ground for a beat, then its far end drags back into the muzzle.
  private reel(dt: number): void {
    for (let i = this.reels.length - 1; i >= 0; i--) {
      const r = this.reels[i];
      r.age += dt;
      const left = 1 - Math.max(0, r.age * 1000 - ROPE_LOOK.restMs) / ROPE_LOOK.reelMs;
      if (left <= 0) {
        this.scene.remove(r.rope.root);
        this.reels.splice(i, 1);
        continue;
      }
      if (r.age * 1000 < ROPE_LOOK.restMs) r.rope.set(r.from, r.to, r.from.distanceTo(r.to) * (1 + ROPE_LOOK.missSlack), r.ground);
      else reelRope(r.rope, r.from, r.to, left, r.ground);
    }
  }

  private fire(f: Flight): void {
    const m = f.muzzle();
    f.from.set(m.pos.x, m.pos.y, m.pos.z);
    f.side.set(-(f.to.z - f.from.z), 0, f.to.x - f.from.x).normalize();
    f.obj.visible = true;
    if (f.rope) this.scene.add(f.rope.root);
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
    if (f.rope) f.rope.set(f.from, this.at, f.from.distanceTo(this.at), f.ground);
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
