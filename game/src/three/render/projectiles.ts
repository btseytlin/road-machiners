// What flies from a muzzle to where each round lands: tracers, shells, missiles and the harpoon's bolt, with their
// look and speed per weapon. Rounds fly straight from the barrel tip. Hits end on the truck they struck, and misses end
// on the ground at the point the sim put them, so the sim's spread shows. A round with a rope trails it from the

import * as THREE from 'three';
import { PARTS } from '../../data/parts';
import { TIME } from '../../data/time';
import { computeRoundPoint, groundPoint, toMap, type V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import type { Terrain } from '../../sim/terrain';
import { reelRope, Rope, ROPE_LOOK, type GroundAt } from './lines';
import type { ShotRound } from '../../sim/types';

export type Muzzle = { pos: V3; dir: V3 };

export type ShotCues = { fired: (m: Muzzle) => void; landed: () => void };

type Look = 'tracer' | 'shell' | 'missile' | 'grenade' | 'bolt';

export type ProjectileSpec = {
  look: Look;
  speed: number;
  gapMs: number;
  length: number;
  width: number;
  color: number;
  flash: number;
  wobble: number;
  casing: CasingSize | null;
  pellets?: true;
  rope?: true;
};

export function roundSpec(spec: ProjectileSpec, k: number): ProjectileSpec {
  return spec.pellets && k > 0 ? { ...spec, casing: null } : spec;
}

export const PROJECTILES: Record<string, ProjectileSpec> = {
  mg: { look: 'tracer', speed: 220, gapMs: 80, length: 1.4, width: 0.05, color: PAL.flash, flash: 0.6, wobble: 0, casing: 'small' },
  shotgun: { look: 'tracer', speed: 160, gapMs: 8, length: 0.6, width: 0.04, color: PAL.flash, flash: 0.8, wobble: 0, casing: 'small', pellets: true },
  autocannon: { look: 'tracer', speed: 140, gapMs: 140, length: 1.2, width: 0.1, color: 0xffad50, flash: 0.9, wobble: 0, casing: 'small' },
  cannon: { look: 'shell', speed: 60, gapMs: 0, length: 0.6, width: 0.22, color: 0xffad50, flash: 1.4, wobble: 0, casing: 'large' },
  tankGun: { look: 'shell', speed: 60, gapMs: 0, length: 0.75, width: 0.28, color: 0xffad50, flash: 1.6, wobble: 0, casing: 'large' },
  sniperCannon: { look: 'shell', speed: 110, gapMs: 0, length: 0.7, width: 0.16, color: 0xffd080, flash: 1.2, wobble: 0, casing: 'large' },
  heavyMg: { look: 'tracer', speed: 200, gapMs: 90, length: 1.4, width: 0.07, color: PAL.flash, flash: 0.7, wobble: 0, casing: 'small' },
  gatling: { look: 'tracer', speed: 220, gapMs: 38, length: 1.2, width: 0.05, color: PAL.flash, flash: 0.7, wobble: 0, casing: 'small' },
  longRifle: { look: 'tracer', speed: 260, gapMs: 0, length: 2, width: 0.05, color: 0xffd080, flash: 0.8, wobble: 0, casing: 'small' },
  amRifle: { look: 'tracer', speed: 260, gapMs: 0, length: 2.2, width: 0.08, color: 0xffd080, flash: 1.1, wobble: 0, casing: 'small' },
  battleRifle: { look: 'tracer', speed: 240, gapMs: 110, length: 1.6, width: 0.06, color: 0xffd080, flash: 0.8, wobble: 0, casing: 'small' },
  flechette: { look: 'tracer', speed: 280, gapMs: 70, length: 1.8, width: 0.04, color: 0xd8e0e8, flash: 0.8, wobble: 0, casing: null },
  flamer: { look: 'tracer', speed: 30, gapMs: 50, length: 0.8, width: 0.3, color: 0xff7a20, flash: 1, wobble: 0.3, casing: null },
  pneumobolter: { look: 'shell', speed: 90, gapMs: 0, length: 0.9, width: 0.08, color: 0xb8b0a0, flash: 0.4, wobble: 0, casing: null },
  slugCannon: { look: 'shell', speed: 100, gapMs: 150, length: 0.4, width: 0.14, color: 0xffad50, flash: 1, wobble: 0, casing: 'large' },
  recoilless: { look: 'shell', speed: 60, gapMs: 0, length: 0.7, width: 0.2, color: 0xffad50, flash: 1.6, wobble: 0, casing: null },
  grenadeLauncher: { look: 'grenade', speed: 45, gapMs: 160, length: 0.3, width: 0.3, color: 0x4a4a3c, flash: 0.9, wobble: 0, casing: null },
  harpoon: { look: 'bolt', speed: 110, gapMs: 0, length: 1.1, width: 0.16, color: 0x2e2a26, flash: 0.5, wobble: 0, casing: null, rope: true },
  rocketRack: { look: 'missile', speed: 40, gapMs: 110, length: 0.9, width: 0.16, color: 0x6a6a64, flash: 0.9, wobble: 0.5, casing: null },
};

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

const HIT = { drop: 0.8, band: 0.7 };
const MISS_DEPTH = 1;
const GRENADE_ARC = 3;
const SHELL_TAIL = 3;
const MISSILE = {
  swings: 1.5,
  smokePerSecond: 90,
  nose: 0x9a3a2a,
  flame: 0xffc060,
};

export type Impact = 'truck' | 'ground' | 'none';
export type RoundPlan = { land: V3; impact: Impact; delayMs: number; flightMs: number };
export type RoundAim = { impact: 'truck'; b: V3; offset: number } | { impact: 'ground' | 'none'; land: V3 };

export function roundAims(b: V3, targetId: string, rounds: ShotRound[], pointOf: (id: string) => V3 | null, missAt: (offset: number) => V3): RoundAim[] {
  return rounds.map((r): RoundAim => {
    if (r.struck === null) return { impact: 'ground', land: missAt(r.offset) };
    if (r.struck === targetId) return { impact: 'truck', b, offset: r.offset };
    const p = pointOf(r.struck);
    return p ? { impact: 'truck', b: p, offset: 0 } : { impact: 'none', land: missAt(r.offset) };
  });
}

export type VolleyTiming = { startMs: number; windowMs: number; burstMaxMs: number };

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

function groundMiss(a: V3, land: V3, groundY: (p: V3) => number): V3 {
  const dx = land.x - a.x;
  const dz = land.z - a.z;
  const len = Math.hypot(dx, dz);
  const shift = (Math.random() * 2 - 1) * MISS_DEPTH;
  const end = { x: land.x + (dx / len) * shift, y: 0, z: land.z + (dz / len) * shift };
  return { ...end, y: groundY(end) };
}

type Flight = {
  spec: ProjectileSpec;
  obj: THREE.Object3D;
  muzzle: () => Muzzle;
  from: THREE.Vector3;
  to: THREE.Vector3;
  side: THREE.Vector3;
  phase: number;
  age: number;
  life: number;
  onFire: (m: Muzzle) => void;
  onLand: () => void;
  rope: Rope | null;
  struck: boolean;
  ground: GroundAt;
};

type Reel = { rope: Rope; from: THREE.Vector3; to: THREE.Vector3; age: number; ground: GroundAt };

export type Launch = { spec: ProjectileSpec; muzzle: () => Muzzle; plan: RoundPlan; onFire: (m: Muzzle) => void; onLand: () => void; ground: GroundAt };

const X_AXIS = new THREE.Vector3(1, 0, 0);

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

  private tracer(spec: ProjectileSpec): THREE.Object3D {
    const streak = new THREE.Mesh(this.box, this.glowOf(spec.color, 1));
    streak.position.x = -0.5;
    const g = new THREE.Group();
    g.add(streak);
    g.scale.set(spec.length, spec.width, spec.width);
    return g;
  }

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

  private grenade(spec: ProjectileSpec): THREE.Object3D {
    const body = new THREE.Mesh(this.shellCore, this.solidOf(spec.color));
    body.scale.set(spec.length, spec.width, spec.width);
    return body;
  }

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
  private held: Rope[] = [];
  private reels: Reel[] = [];
  private at = new THREE.Vector3();
  private ahead = new THREE.Vector3();
  private dir = new THREE.Vector3();

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
      struck: l.plan.impact === 'truck',
      ground: l.ground,
    });
  }

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
      if (before <= 0) this.fire(f);
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

  private landRope(f: Flight): void {
    if (!f.rope) return;
    f.rope.set(f.from, f.to, f.from.distanceTo(f.to), f.ground);
    if (f.struck) this.held.push(f.rope);
    else this.reels.push({ rope: f.rope, from: f.from, to: f.to, age: 0, ground: f.ground });
  }

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
    if (f.spec.look === 'tracer') f.obj.scale.x = Math.min(f.spec.length, this.at.distanceTo(f.from));
    if (f.spec.look === 'missile') this.trail(f, dt);
    if (f.rope) f.rope.set(f.from, this.at, f.from.distanceTo(this.at), f.ground);
  }

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

export type CasingSize = 'small' | 'large';

export const CASING = {
  max: 400,
  lifeTurns: TIME.turnsPerDay,
  fadeShare: 0.1,
  small: { length: 0.14, radius: 0.03 },
  large: { length: 0.28, radius: 0.06 },
  glint: 0x4a3810,
  back: 0.6,
  eject: { side: 2.4, up: 2.2, spread: 0.8, spin: 18 },
  gravity: 9.8,
  bounce: 0.35,
  slide: 0.4,
} as const;

type Casing = {
  size: CasingSize;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  roll: number;
  spin: number;
  bounced: boolean;
  resting: boolean;
  turn: number;
};

const SIZES: CasingSize[] = ['small', 'large'];
const UP = new THREE.Vector3(0, 1, 0);
const AXIS = new THREE.Vector3(1, 0, 0);

export class Casings {
  readonly meshes: Record<CasingSize, THREE.InstancedMesh>;
  private casings: Casing[] = [];
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private tumble = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private material = new THREE.MeshLambertMaterial({ color: PAL.brass, emissive: CASING.glint, flatShading: true });

  constructor(private scene: THREE.Scene) {
    this.meshes = { small: casingMesh(CASING.small, this.material), large: casingMesh(CASING.large, this.material) };
    scene.add(this.meshes.small, this.meshes.large);
  }

  eject(muzzle: Muzzle, size: CasingSize | null, turn: number): void {
    if (size === null) return;
    const dir = new THREE.Vector3(muzzle.dir.x, muzzle.dir.y, muzzle.dir.z).normalize();
    const flat = Math.hypot(dir.x, dir.z);
    if (!(flat > 0)) throw new Error('A casing needs a muzzle pointing off the vertical, to know its right side');
    const right = new THREE.Vector3(-dir.z / flat, 0, dir.x / flat);
    const pos = new THREE.Vector3(muzzle.pos.x, muzzle.pos.y, muzzle.pos.z).addScaledVector(dir, -CASING.back);
    const e = CASING.eject;
    const vel = right.multiplyScalar(e.side + spread()).addScaledVector(UP, e.up + spread()).addScaledVector(dir, spread());
    if (this.casings.length >= CASING.max) this.casings.shift();
    const yaw = -Math.atan2(dir.z, dir.x);
    this.casings.push({ size, pos, vel, yaw, roll: 0, spin: e.spin * (Math.random() + 0.5), bounced: false, resting: false, turn });
  }

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

function fadeOf(age: number): number {
  const fade = CASING.lifeTurns * CASING.fadeShare;
  return Math.min(1, (CASING.lifeTurns - age) / fade);
}

function spread(): number {
  return (Math.random() * 2 - 1) * CASING.eject.spread;
}

function casingMesh(size: { length: number; radius: number }, material: THREE.Material): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(size.radius, size.radius, size.length, 6).rotateZ(Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, material, CASING.max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}
