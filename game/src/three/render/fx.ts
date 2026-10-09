import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES, type TerrainType } from '../../data/terrain';
import { ENGINE_HEAT } from '../../data/wear';
import { wheelMounts } from '../../phys/body';
import { headingOf, toMap, type V3, type VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { bodyOf } from '../../sim/body';
import { corePart, mountedParts } from '../../sim/grid';
import { inOverdrive, isStranded, vehicleStats } from '../../sim/stats';
import { tileAt, type Terrain } from '../../sim/terrain';
import type { Vehicle, World } from '../../sim/types';
import { maxHp } from '../../sim/wear';
import type { CameraRig } from './camera';
import { tirePoints, Ruts } from './ruts';
import type { GroundAt } from './lines';
import { Casings, Projectiles, type Muzzle, type ProjectileSpec, type RoundPlan, type ShotCues } from './projectiles';
import { CONFIG } from '../../config';
import { CardBatch, createCardShapes } from './particles/cards';
import { ChunkBatch } from './particles/chunks';
import { liveNear, Particles, type ParticleLook } from './particles/particles';
import { Blasts, type BlastGround } from './particles/blasts';
import { Emissions } from './particles/emissions';

const MAX_TEXTS = 24;
const RISE_METERS = 1.5;
const LABEL_ROW_PX = 22;

const FLASH = {
  life: 0.07,
  endScale: 0.3,
  max: 48,
};

type FloatText = { el: HTMLDivElement; pos: V3; rowPx: number; age: number; life: number; used: boolean };
type Flash = { mesh: THREE.Mesh; size: number; age: number };
type Pending = { left: number; run: () => void };

function flashGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pts.push(...a, ...b, ...c);
  const half = 0.18;
  tri([0, 0, 0], [0.3, half, 0], [1, 0, 0]);
  tri([0, 0, 0], [1, 0, 0], [0.3, -half, 0]);
  tri([0, 0, 0], [0.3, 0, half], [1, 0, 0]);
  tri([0, 0, 0], [1, 0, 0], [0.3, 0, -half]);
  const points = 6;
  const outer = 0.32;
  const inner = 0.1;
  const x = 0.06;
  for (let i = 0; i < points * 2; i++) {
    const a0 = (i / (points * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (points * 2)) * Math.PI * 2;
    const r0 = i % 2 === 0 ? outer : inner;
    const r1 = i % 2 === 0 ? inner : outer;
    tri([x, 0, 0], [x, Math.cos(a0) * r0, Math.sin(a0) * r0], [x, Math.cos(a1) * r1, Math.sin(a1) * r1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

class MuzzleFlashes {
  private flashes: Flash[] = [];
  private turn = new THREE.Quaternion();
  private roll = new THREE.Quaternion();
  private dir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = flashGeometry();
    const mat = new THREE.MeshBasicMaterial({ color: PAL.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < FLASH.max; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.flashes.push({ mesh, size: 0, age: 0 });
    }
  }

  show(m: Muzzle, length: number): void {
    const f = this.flashes.find((x) => !x.mesh.visible);
    if (!f) return;
    f.size = length;
    f.age = 0;
    f.mesh.visible = true;
    f.mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
    this.turn.setFromUnitVectors(X_AXIS, this.dir.set(m.dir.x, m.dir.y, m.dir.z).normalize());
    this.roll.setFromAxisAngle(X_AXIS, Math.random() * Math.PI * 2);
    f.mesh.quaternion.copy(this.turn).multiply(this.roll);
    f.mesh.scale.setScalar(f.size);
  }

  tick(dt: number): void {
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.age += dt;
      if (f.age >= FLASH.life) {
        f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(f.size * (1 - (1 - FLASH.endScale) * (f.age / FLASH.life)));
    }
  }
}

const AMMO_BLAST_RADIUS = 0.8;
const CLAYMORE_FX_RADIUS = 10;
const EXPLODE_RADIUS = 1.8;
const DUST = { color: 0xd8c098 };

const MAX_PARTICLES = 4000;
const MAX_GLOW_PARTICLES = 1000;
const MAX_VIEW_CARDS = 2000;
const MAX_CHUNKS = 600;

const SPRAY = {
  surfacePower: 2.5,
  dust: { perMeter: 6, groundShare: 0.45, life: 2.6, size: { from: 0.5, to: 3.8 }, alpha: { peak: 0.55, fadeIn: 0.1 }, drag: 1.8, gravity: -0.4 },
  haze: { perMeter: 0.35, life: 12, size: { from: 2.5, to: 9 }, alpha: { peak: 0.3, fadeIn: 0.08 }, drag: 0.8, gravity: -0.05, back: 1.2, spread: 0.8, rise: 0.3, lift: 0.8 },
  clods: { perMeter: 1.4, minMetersPerSecond: 2.5, back: { min: 0.15, spread: 0.3 }, up: { min: 1.2, spread: 2.6 }, aside: 1.4, lift: 0.15, size: { min: 0.1, spread: 0.2 }, life: 1.6, shade: 0.72 },
} as const;

export function sprayShare(ground: TerrainType): number {
  return ground.dust ** SPRAY.surfacePower;
}

export type CardLights = { sun: THREE.DirectionalLight; sky: THREE.HemisphereLight };

export class Fx3D {
  private readonly shapes = createCardShapes(Math.random);
  readonly cards = {
    lit: new CardBatch(MAX_PARTICLES + MAX_VIEW_CARDS, 'lit', this.shapes, CONFIG.fxFillScreens),
    glow: new CardBatch(MAX_GLOW_PARTICLES + MAX_VIEW_CARDS, 'glow', this.shapes, CONFIG.fxFillScreens),
  };
  private readonly nearby = liveNear(() => this.world());
  private readonly particles = new Particles(MAX_PARTICLES, this.nearby);
  private readonly glowParticles = new Particles(MAX_GLOW_PARTICLES, this.nearby);
  private readonly chunks = new ChunkBatch(MAX_CHUNKS, Math.random, this.nearby);
  private readonly emissions = new Emissions(this.particles, this.glowParticles);
  private readonly sprayLooks = new Map<TerrainType, { dust: ParticleLook; haze: ParticleLook; clod: THREE.Color }>();
  private readonly cardLight = { sunDir: new THREE.Vector3(), sun: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color() };
  private texts: FloatText[] = [];
  private projectiles: Projectiles;
  private pending: Pending[] = [];
  private flashes: MuzzleFlashes;
  private casings: Casings;
  readonly ruts: Ruts;
  private readonly blasts = new Blasts({ smoke: this.particles, glow: this.glowParticles, chunks: this.chunks });
  private terrain: Terrain | null = null;

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private rig: CameraRig, private readonly world: () => World) {
    scene.add(...this.cards.lit.meshes, ...this.cards.glow.meshes, ...this.chunks.meshes);
    this.flashes = new MuzzleFlashes(scene);
    this.casings = new Casings(scene);
    this.ruts = new Ruts(scene);
    this.projectiles = new Projectiles(scene, (p) => this.missileSmoke(p));
    for (let i = 0; i < MAX_TEXTS; i++) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.font = 'bold 15px var(--font-mono)';
      el.style.textShadow = '0 1px 2px #1a1410';
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      overlay.appendChild(el);
      this.texts.push({ el, pos: { x: 0, y: 0, z: 0 }, rowPx: 0, age: 0, life: 1, used: false });
    }
  }

  shot(spec: ProjectileSpec, muzzle: () => Muzzle, plan: RoundPlan, blastRadius: number, cues: ShotCues, ground: GroundAt, turn: number): void {
    const onFire = (m: Muzzle) => {
      this.flashes.show(m, spec.flash);
      this.casings.eject(m, spec.casing, turn);
      this.blasts.muzzle(m.pos, m.dir, spec.flash);
      cues.fired(m);
    };
    const onLand = () => {
      if (plan.impact !== 'none') this.landing(plan, blastRadius, spec.look === 'shell');
      cues.landed();
    };
    this.projectiles.launch({ spec, muzzle, plan, onFire, onLand, ground });
  }

  releaseRopes(): void {
    this.projectiles.releaseRopes();
  }

  private landing(plan: RoundPlan, blastRadius: number, big: boolean): void {
    if (blastRadius > 0) this.blast(plan.land, blastRadius);
    else this.impact(plan, big);
  }

  private impact(plan: RoundPlan, big: boolean): void {
    this.blasts.impact(plan.land, plan.impact === 'truck', big, this.groundAt(plan.land));
  }

  private blast(p: V3, radius: number): void {
    this.blasts.blast(p, radius, this.groundAt(p));
  }

  private groundAt(p: V3): BlastGround | null {
    if (!this.terrain) return null;
    const ground = TERRAIN_TYPES[this.terrain.types[tileAt(this.terrain, toMap(p))]];
    return { color: ground.color, dust: ground.dust };
  }

  ammoBlast(p: V3): void {
    this.blast(p, AMMO_BLAST_RADIUS);
  }

  airBurst(p: V3): void {
    this.blasts.airBurst(p);
  }

  fireBurst(p: V3): void {
    this.blasts.fireBurst(p);
  }

  private missileSmoke(p: V3): void {
    this.emissions.missile(p);
  }

  label(p: V3, text: string, color: string, row: number, delayMs: number, readMs: number): void {
    this.pending.push({ left: delayMs / 1000, run: () => this.floatText(p, text, color, readMs, row * LABEL_ROW_PX) });
  }

  explode(p: V3): void {
    this.blast(p, EXPLODE_RADIUS);
  }

  claymoreBlast(p: V3): void {
    this.blast(p, CLAYMORE_FX_RADIUS);
  }

  crash(p: V3): void {
    this.blasts.crash(p, this.groundAt(p));
  }

  dust(p: V3): void {
    this.emissions.dust(p);
  }

  smoke(p: V3, damage = 0): void {
    this.emissions.hurt(p, damage);
  }

  light({ sun, sky }: CardLights): void {
    const l = this.cardLight;
    l.sunDir.copy(sun.position).sub(sun.target.position).normalize();
    l.sun.copy(sun.color).multiplyScalar(sun.intensity);
    l.sky.copy(sky.color).multiplyScalar(sky.intensity);
    l.ground.copy(sky.groundColor).multiplyScalar(sky.intensity);
    this.cards.lit.light(l);
  }

  wheelDust(p: V3, back: V3, out: V3, ground: TerrainType): void {
    const along = 1.5 + Math.random() * 1.5;
    const aside = 0.5 + Math.random() * 0.9;
    const vel = { x: back.x * along + out.x * aside, y: 0.2 + Math.random() * 0.5, z: back.z * along + out.z * aside };
    this.particles.spawn(p, vel, this.sprayOf(ground).dust, 0.8 + Math.random() * 0.4);
  }

  clod(p: V3, back: V3, out: V3, metersPerSecond: number, ground: TerrainType): void {
    const c = SPRAY.clods;
    const along = metersPerSecond * (c.back.min + Math.random() * c.back.spread);
    const aside = c.aside * (Math.random() - 0.3);
    const vel = { x: back.x * along + out.x * aside, y: c.up.min + Math.random() * c.up.spread, z: back.z * along + out.z * aside };
    const size = c.size.min + Math.random() * Math.random() * c.size.spread;
    this.chunks.spawn({ x: p.x, y: p.y + c.lift, z: p.z }, vel, size, c.life * (0.7 + Math.random() * 0.6), this.sprayOf(ground).clod);
  }

  dustHaze(p: V3, back: V3, ground: TerrainType): void {
    const h = SPRAY.haze;
    const vel = { x: back.x * h.back + (Math.random() - 0.5) * h.spread, y: h.rise * Math.random(), z: back.z * h.back + (Math.random() - 0.5) * h.spread };
    this.particles.spawn({ x: p.x, y: p.y + h.lift, z: p.z }, vel, this.sprayOf(ground).haze, 0.8 + Math.random() * 0.4);
  }

  private sprayOf(ground: TerrainType): { dust: ParticleLook; haze: ParticleLook; clod: THREE.Color } {
    let look = this.sprayLooks.get(ground);
    if (!look) {
      const d = SPRAY.dust;
      const h = SPRAY.haze;
      const tint = new THREE.Color(DUST.color).lerp(new THREE.Color(ground.color), d.groundShare);
      const pale = tint.clone().lerp(new THREE.Color(0xffffff), 0.15);
      const colors = [tint.getHex(), pale.getHex()];
      look = {
        dust: { life: d.life, size: d.size, colors, alpha: d.alpha, drag: d.drag, gravity: d.gravity, streak: 0, form: 'cloud' },
        haze: { life: h.life, size: h.size, colors, alpha: h.alpha, drag: h.drag, gravity: h.gravity, streak: 0, form: 'cloud' },
        clod: new THREE.Color(ground.color).multiplyScalar(SPRAY.clods.shade),
      };
      this.sprayLooks.set(ground, look);
    }
    return look;
  }

  exhaust(p: V3, back: V3): void {
    this.emissions.exhaust(p, back);
  }

  steam(p: V3): void {
    this.emissions.steam(p);
  }

  douseSteam(p: V3): void {
    this.emissions.douse(p);
  }

  breakdownSmoke(p: V3, motion: V3): void {
    this.emissions.breakdown(p, motion);
  }

  floatText(p: V3, text: string, color: string, durationMs: number, rowPx = 0): void {
    const slot = this.texts.find((x) => !x.used) ?? this.texts.reduce((a, b) => (a.age > b.age ? a : b));
    slot.used = true;
    slot.age = 0;
    slot.life = durationMs / 1000;
    slot.rowPx = rowPx;
    slot.pos = { x: p.x, y: p.y, z: p.z };
    slot.el.textContent = text;
    slot.el.style.color = color;
    slot.el.style.display = 'block';
    slot.el.style.opacity = '1';
  }

  tick(playMs: number, realMs: number, world: World): void {
    const dt = playMs / 1000;
    this.terrain = world.terrain;
    this.particles.tick(dt);
    this.glowParticles.tick(dt);
    this.chunks.tick(dt, world.terrain);
    this.particles.draw(this.cards.lit);
    this.glowParticles.draw(this.cards.glow);
    this.cards.lit.flush(this.rig.camera);
    this.cards.glow.flush(this.rig.camera);
    this.flashes.tick(dt);
    this.casings.tick(dt, world.terrain, world.turn);
    this.ruts.tick(world.turn);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const job = this.pending[i];
      job.left -= dt;
      if (job.left > 0) continue;
      this.pending.splice(i, 1);
      job.run();
    }
    this.projectiles.tick(dt);
    this.floatTexts(realMs / 1000);
  }

  private floatTexts(dt: number): void {
    for (const slot of this.texts) {
      if (!slot.used) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.used = false;
        slot.el.style.display = 'none';
        continue;
      }
      const t = slot.age / slot.life;
      const screen = this.rig.screenOf({ x: slot.pos.x, y: slot.pos.y + t * RISE_METERS, z: slot.pos.z });
      slot.el.style.left = `${screen.x}px`;
      slot.el.style.top = `${screen.y - slot.rowPx}px`;
      slot.el.style.opacity = `${1 - t}`;
    }
  }
}

const MIN_DUST_SPEED = 0.5;
const FRONT_DUST = 0.5;
const EXHAUST_RATE = 14;
const EXHAUST_FULL_ACCEL = 3;
const CRUISE_SHARE = 0.8;
const CRUISE_RATE = 1.5;
const OVERDRIVE_RATE = 10;
const EXHAUST_SIDE = 0.6;
const STEAM_RATE = 10;
const DOUSE_RATE = 60;
const DOUSE_SECONDS = 1.2;
const BREAKDOWN_RATE = 5;
const DAMAGE_RATE = 3;
const HURT_CAB = 0.35;

type Traits = { stranded: boolean; maxSpeed: number; hurt: boolean; damage: number };
type Pose = { f: VehicleFrame; h: number; half: { x: number; y: number; z: number } };

export class TruckFx {
  private world: World | null = null;
  private traits = new Map<string, Traits>();
  private douseLeft = 0;

  constructor(private fx: Fx3D) {}

  emit(world: World, v: Vehicle, f: VehicleFrame, moving: boolean, dt: number, seen: boolean): void {
    const traits = this.traitsOf(world, v);
    const pose: Pose = { f, h: headingOf(f.rot), half: bodyOf(v.chassisId).half };
    if (moving) this.driving(world, v, pose, traits, seen, dt);
    if (v.id === world.player.vehicleId) {
      this.overdriveExhaust(world, v, traits, pose, dt);
      this.steam(world.player.engineHeat, pose, dt);
      this.douseCloud(pose, dt);
    }
    if (traits.stranded) this.puffs(BREAKDOWN_RATE, dt, () => this.fx.breakdownSmoke(onBody(pose, 0.5, 1, 0), motionOf(v, pose.h, moving)));
    else if (traits.hurt) this.puffs(DAMAGE_RATE, dt, () => this.fx.smoke(f.pos, traits.damage));
  }

  private driving(world: World, v: Vehicle, pose: Pose, traits: Traits, seen: boolean, dt: number): void {
    const back = { x: -Math.cos(pose.h), y: 0, z: -Math.sin(pose.h) };
    this.wheels(world, v, pose, back, seen, dt);
    if (traits.stranded) return;
    const along = -(pose.f.acc.x * back.x + pose.f.acc.z * back.z);
    const cruise = v.speed > traits.maxSpeed * CRUISE_SHARE ? CRUISE_RATE : 0;
    const rate = EXHAUST_RATE * Math.min(1, Math.max(0, along / EXHAUST_FULL_ACCEL)) + cruise;
    this.puffs(rate, dt, () => this.fx.exhaust(onBody(pose, -1, 1, -EXHAUST_SIDE), back));
  }

  private overdriveExhaust(world: World, v: Vehicle, traits: Traits, pose: Pose, dt: number): void {
    if (!inOverdrive(world, v) || traits.stranded) return;
    const back = { x: -Math.cos(pose.h), y: 0, z: -Math.sin(pose.h) };
    this.puffs(OVERDRIVE_RATE, dt, () => this.fx.exhaust(onBody(pose, -1, 1, -EXHAUST_SIDE), back));
  }

  private steam(heat: number, pose: Pose, dt: number): void {
    if (heat < ENGINE_HEAT.warnAt) return;
    const share = (heat - ENGINE_HEAT.warnAt) / (1 - ENGINE_HEAT.warnAt);
    this.puffs((STEAM_RATE * (1 + 2 * share)) / 3, dt, () => this.fx.steam(onBody(pose, 0.7, 1, 0)));
  }

  douse(): void {
    this.douseLeft = DOUSE_SECONDS;
  }

  private douseCloud(pose: Pose, dt: number): void {
    if (this.douseLeft <= 0) return;
    this.douseLeft -= dt;
    this.puffs(DOUSE_RATE, dt, () => this.fx.douseSteam(onBody(pose, 0.3 + Math.random() * 0.8, 0.8, Math.random() * 2.4 - 1.2)));
  }

  private wheels(world: World, v: Vehicle, pose: Pose, back: V3, seen: boolean, dt: number): void {
    if (!seen && v.speed <= MIN_DUST_SPEED) return;
    const tires = tirePoints(world.terrain, v.chassisId, pose.f);
    if (seen) this.fx.ruts.layTracks(world, v, pose.f, tires);
    if (v.speed > MIN_DUST_SPEED) this.dust(world, v, pose, back, tires, dt);
  }

  private dust(world: World, v: Vehicle, pose: Pose, back: V3, tires: V3[], dt: number): void {
    const ground = TERRAIN_TYPES[world.terrain.types[tileAt(world.terrain, v.pos)]];
    const metersPerSecond = v.speed * PHYSICS.metersPerTile;
    const loose = sprayShare(ground);
    const rate = SPRAY.dust.perMeter * metersPerSecond * loose;
    const clodRate = metersPerSecond > SPRAY.clods.minMetersPerSecond ? SPRAY.clods.perMeter * metersPerSecond * loose : 0;
    const mounts = wheelMounts(bodyOf(v.chassisId));
    for (const [i, tire] of tires.entries()) {
      const side = Math.sign(mounts[i].z);
      const out = { x: -Math.sin(pose.h) * side, y: 0, z: Math.cos(pose.h) * side };
      const front = i < 2 ? FRONT_DUST : 1;
      this.puffs(rate * front, dt, () => this.fx.wheelDust(tire, back, out, ground));
      this.puffs(clodRate * front, dt, () => this.fx.clod(tire, back, out, metersPerSecond, ground));
    }
    const hazeRate = SPRAY.haze.perMeter * metersPerSecond * loose;
    const [left, right] = tires.slice(-2);
    const rear = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 };
    this.puffs(hazeRate, dt, () => this.fx.dustHaze(rear, back, ground));
  }

  private puffs(rate: number, dt: number, puff: () => void): void {
    for (let n = Math.floor(rate * dt + Math.random()); n > 0; n--) puff();
  }

  private traitsOf(world: World, v: Vehicle): Traits {
    if (world !== this.world) {
      this.world = world;
      this.traits.clear();
    }
    let t = this.traits.get(v.id);
    if (!t) {
      const cab = corePart(v, 'cab');
      t = {
        stranded: isStranded(world, v),
        maxSpeed: vehicleStats(world, v).maxSpeed,
        hurt: cab.hp < maxHp(cab) * HURT_CAB || mountedParts(v).some((p) => p.hp === 0),
        damage: 1 - cab.hp / maxHp(cab),
      };
      this.traits.set(v.id, t);
    }
    return t;
  }
}

function motionOf(v: Vehicle, h: number, moving: boolean): V3 {
  const mps = moving ? v.speed * PHYSICS.metersPerTile : 0;
  return { x: Math.cos(h) * mps, y: 0, z: Math.sin(h) * mps };
}

function rotate(x: number, z: number, h: number): { x: number; z: number } {
  return { x: x * Math.cos(h) - z * Math.sin(h), z: x * Math.sin(h) + z * Math.cos(h) };
}

function onBody(pose: Pose, x: number, y: number, z: number): V3 {
  const off = rotate(x * pose.half.x, z * pose.half.z, pose.h);
  return { x: pose.f.pos.x + off.x, y: pose.f.pos.y + y * pose.half.y, z: pose.f.pos.z + off.z };
}
