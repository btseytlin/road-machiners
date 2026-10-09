// Short-lived combat and movement effects: tracers, muzzle flash, sparks, smoke, dust and floating
// damage numbers, like the 2D src/render/fx.ts, and what a truck puffs out as it drives. Particles live
// in fixed pools of billboards that age and recycle, one draw call per pool, so any number of effects in

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES, type TerrainType } from '../../data/terrain';
import { ENGINE_HEAT } from '../../data/wear';
import { wheelMounts } from '../../phys/body';
import { headingOf, type V3, type VehicleFrame } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { bodyOf } from '../../sim/body';
import { corePart, mountedParts } from '../../sim/grid';
import { inOverdrive, isStranded, vehicleStats } from '../../sim/stats';
import { tileAt } from '../../sim/terrain';
import type { Vehicle, World } from '../../sim/types';
import { maxHp } from '../../sim/wear';
import type { CameraRig } from './camera';
import { tirePoints, Ruts } from './ruts';
import type { GroundAt } from './lines';
import { Casings, Projectiles, type Muzzle, type ProjectileSpec, type RoundPlan, type ShotCues } from './projectiles';
import { CONFIG } from '../../config';
import { CardBatch, createCardShapes } from './particles/cards';
import { ChunkBatch } from './particles/chunks';
import { Particles, type ParticleLook } from './particles/particles';

const MAX_PUFFS = 2048;
const MAX_GLOWS = 256;
const MAX_TEXTS = 24;
const GRAVITY = 2;
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

type ParticleSpec = {
  vel: V3;
  life: number;
  fromScale: number;
  toScale: number;
  color: number;
  opacity: number;
  drag: number;
  gravity: number;
};

type Slot = { pos: THREE.Vector3; vel: THREE.Vector3; age: number; spec: ParticleSpec; used: boolean };

const VERTEX = `
  attribute vec3 offset;
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vUv = uv;
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(offset, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = vAlpha * 0.9 * (1.0 - smoothstep(0.0, 1.0, r));
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vTint, a);
    #include <colorspace_fragment>
  }
`;

class ParticlePool {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private slots: Slot[] = [];
  private free: number[] = [];
  private offsets: THREE.InstancedBufferAttribute;
  private sizes: THREE.InstancedBufferAttribute;
  private alphas: THREE.InstancedBufferAttribute;
  private tints: THREE.InstancedBufferAttribute;
  private color = new THREE.Color();

  constructor(private capacity: number, additive: boolean) {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.sizes = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.alphas = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.tints = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.offsets, this.sizes, this.alphas, this.tints]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('offset', this.offsets);
    geo.setAttribute('size', this.sizes);
    geo.setAttribute('alpha', this.alphas);
    geo.setAttribute('tint', this.tints);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.slots.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, spec: null as never, used: false });
      this.free.push(capacity - 1 - i);
    }
  }

  spawn(p: V3, spec: ParticleSpec): boolean {
    const i = this.free.pop();
    if (i === undefined) return false;
    const slot = this.slots[i];
    slot.used = true;
    slot.age = 0;
    slot.spec = spec;
    slot.pos.set(p.x, p.y, p.z);
    slot.vel.set(spec.vel.x, spec.vel.y, spec.vel.z);
    return true;
  }

  tick(dt: number): void {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const slot = this.slots[i];
      if (!slot.used) continue;
      slot.age += dt;
      const s = slot.spec;
      if (slot.age >= s.life) {
        slot.used = false;
        this.free.push(i);
        continue;
      }
      const t = slot.age / s.life;
      slot.vel.multiplyScalar(Math.exp(-s.drag * dt));
      slot.vel.y -= s.gravity * dt;
      slot.pos.addScaledVector(slot.vel, dt);
      const grow = 1 - (1 - t) * (1 - t);
      this.offsets.setXYZ(n, slot.pos.x, slot.pos.y, slot.pos.z);
      this.sizes.setX(n, s.fromScale + (s.toScale - s.fromScale) * grow);
      this.alphas.setX(n, s.opacity * (1 - t));
      this.color.setHex(s.color);
      this.tints.setXYZ(n, this.color.r, this.color.g, this.color.b);
      n++;
    }
    this.geo.instanceCount = n;
    for (const a of [this.offsets, this.sizes, this.alphas, this.tints]) a.needsUpdate = true;
  }
}

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
  private puffs = new ParticlePool(MAX_PUFFS, false);
  private glows = new ParticlePool(MAX_GLOWS, true);
  private readonly shapes = createCardShapes(Math.random);
  readonly cards = {
    lit: new CardBatch(MAX_PARTICLES + MAX_VIEW_CARDS, 'lit', this.shapes, CONFIG.fxFillScreens),
    glow: new CardBatch(MAX_GLOW_PARTICLES + MAX_VIEW_CARDS, 'glow', this.shapes, CONFIG.fxFillScreens),
  };
  private readonly particles = new Particles(MAX_PARTICLES);
  private readonly glowParticles = new Particles(MAX_GLOW_PARTICLES);
  private readonly chunks = new ChunkBatch(MAX_CHUNKS, Math.random);
  private readonly sprayLooks = new Map<TerrainType, { dust: ParticleLook; haze: ParticleLook; clod: THREE.Color }>();
  private readonly cardLight = { sunDir: new THREE.Vector3(), sun: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color() };
  private texts: FloatText[] = [];
  private projectiles: Projectiles;
  private pending: Pending[] = [];
  private flashes: MuzzleFlashes;
  private casings: Casings;
  readonly ruts: Ruts;

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private rig: CameraRig) {
    scene.add(this.puffs.mesh, this.glows.mesh, this.cards.lit.mesh, this.cards.glow.mesh, ...this.chunks.meshes);
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

  private puff(p: V3, color: number, count: number, opts: { speed: number; life: number; scale: number; grow: number; additive?: boolean }): void {
    const pool = opts.additive ? this.glows : this.puffs;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.6;
      const s = opts.speed * (0.4 + Math.random() * 0.6);
      const vel = { x: Math.cos(a) * s, y: up * s, z: Math.sin(a) * s };
      const spec: ParticleSpec = { vel, life: opts.life, fromScale: opts.scale, toScale: opts.scale * opts.grow, color, opacity: 1, drag: 0, gravity: GRAVITY };
      if (!pool.spawn(p, spec)) return;
    }
  }

  shot(spec: ProjectileSpec, muzzle: () => Muzzle, plan: RoundPlan, blastRadius: number, cues: ShotCues, ground: GroundAt, turn: number): void {
    const onFire = (m: Muzzle) => {
      this.flashes.show(m, spec.flash);
      this.casings.eject(m, spec.casing, turn);
      this.puff(m.pos, PAL.flash, 1, { speed: 0, life: 0.12, scale: spec.flash * 0.6, grow: 1.6, additive: true });
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
    if (plan.impact === 'truck') this.puff(plan.land, 0xffa040, big ? 14 : 6, { speed: 4, life: 0.35, scale: 0.35, grow: 0.3, additive: true });
    else this.puff(plan.land, DUST.color, big ? 10 : 4, { speed: big ? 3 : 1.5, life: 0.9, scale: big ? 0.8 : 0.5, grow: 1.4 });
  }

  private blast(p: V3, radius: number): void {
    this.puff(p, 0xffc060, 1, { speed: 0, life: 0.45, scale: radius * 1.8, grow: 1.4, additive: true });
    this.puff(p, 0xffa040, Math.round(14 + 8 * radius), { speed: 2 + 2 * radius, life: 0.55, scale: 0.4 + 0.15 * radius, grow: 0.5, additive: true });
    this.puff(p, DUST.color, Math.round(8 + 6 * radius), { speed: 3 + 1.2 * radius, life: 1.2, scale: 0.5 + 0.15 * radius, grow: 2 });
    this.puff(p, 0x3a3028, Math.round(6 + 4 * radius), { speed: 0.8 + 0.5 * radius, life: 2 + 0.3 * radius, scale: 0.7 + 0.3 * radius, grow: 2.6 });
  }

  ammoBlast(p: V3): void {
    this.blast(p, AMMO_BLAST_RADIUS);
  }

  airBurst(p: V3): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 3;
      const vel = { x: Math.cos(a) * s, y: 0.2 + Math.random() * 0.6, z: Math.sin(a) * s };
      this.puffs.spawn(p, { vel, life: 0.5 + Math.random() * 0.2, fromScale: 0.2, toScale: 0.9 + Math.random() * 0.4, color: 0xe4e6e8, opacity: 0.6, drag: 3, gravity: 0 });
    }
  }

  fireBurst(p: V3): void {
    const side = () => (Math.random() - 0.5) * 1.6;
    for (let i = 0; i < 10; i++) {
      const vel = { x: side(), y: 2.5 + Math.random() * 1.5, z: side() };
      this.glows.spawn(p, { vel, life: 0.8 + Math.random() * 0.3, fromScale: 0.5, toScale: 1.1, color: i % 3 === 0 ? 0xffc060 : 0xff8a30, opacity: 1, drag: 1.2, gravity: -0.5 });
    }
    for (let i = 0; i < 5; i++) {
      const vel = { x: side() * 0.6, y: 1.5 + Math.random() * 1.0, z: side() * 0.6 };
      this.puffs.spawn(p, { vel, life: 1.6 + Math.random() * 0.6, fromScale: 0.5, toScale: 1.8, color: 0x2a2622, opacity: 0.7, drag: 0.8, gravity: -0.3 });
    }
  }

  private missileSmoke(p: V3): void {
    const vel = { x: (Math.random() - 0.5) * 0.5, y: 0.3 + Math.random() * 0.3, z: (Math.random() - 0.5) * 0.5 };
    this.puffs.spawn(p, { vel, life: 0.9, fromScale: 0.15, toScale: 0.7 + Math.random() * 0.3, color: 0x8a8278, opacity: 0.6, drag: 2, gravity: -0.2 });
  }

  label(p: V3, text: string, color: string, row: number, delayMs: number, readMs: number): void {
    this.pending.push({ left: delayMs / 1000, run: () => this.floatText(p, text, color, readMs, row * LABEL_ROW_PX) });
  }

  explode(p: V3): void {
    this.puff(p, 0xffa040, 30, { speed: 6, life: 0.4, scale: 0.4, grow: 0.3, additive: true });
    this.puff(p, 0x3a3028, 16, { speed: 3, life: 1.6, scale: 1.0, grow: 2.4 });
    this.puff(p, 0xffc060, 1, { speed: 0, life: 0.4, scale: 3.2, grow: 1.6, additive: true });
  }

  claymoreBlast(p: V3): void {
    this.blast(p, CLAYMORE_FX_RADIUS);
  }

  crash(p: V3): void {
    this.puff(p, 0xffa040, 10, { speed: 5, life: 0.35, scale: 0.35, grow: 0.3, additive: true });
    this.dust(p);
  }

  dust(p: V3): void {
    this.puff(p, DUST.color, 1, { speed: 1.2, life: 0.9, scale: 0.5, grow: 1.4 });
  }

  smoke(p: V3): void {
    this.puff(p, 0x4a3f32, 1, { speed: 1.5, life: 1.6, scale: 0.8, grow: 2.4 });
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
        dust: { life: d.life, size: d.size, colors, alpha: d.alpha, drag: d.drag, gravity: d.gravity, streak: 0 },
        haze: { life: h.life, size: h.size, colors, alpha: h.alpha, drag: h.drag, gravity: h.gravity, streak: 0 },
        clod: new THREE.Color(ground.color).multiplyScalar(SPRAY.clods.shade),
      };
      this.sprayLooks.set(ground, look);
    }
    return look;
  }

  exhaust(p: V3, back: V3): void {
    const vel = { x: back.x * 0.8 + (Math.random() - 0.5) * 0.4, y: 1.2 + Math.random() * 0.8, z: back.z * 0.8 + (Math.random() - 0.5) * 0.4 };
    this.puffs.spawn(p, { vel, life: 0.9, fromScale: 0.15, toScale: 0.8 + Math.random() * 0.4, color: 0x1c1a18, opacity: 0.75, drag: 1.5, gravity: -0.4 });
  }

  steam(p: V3): void {
    const vel = { x: (Math.random() - 0.5) * 0.6, y: 1.2 + Math.random() * 0.8, z: (Math.random() - 0.5) * 0.6 };
    this.puffs.spawn(p, { vel, life: 1.8, fromScale: 0.3, toScale: 1.4 + Math.random() * 0.6, color: 0xf2efe8, opacity: 0.55, drag: 1, gravity: -0.3 });
  }

  douseSteam(p: V3): void {
    const vel = { x: (Math.random() - 0.5) * 2.4, y: 1.6 + Math.random() * 1.2, z: (Math.random() - 0.5) * 2.4 };
    this.puffs.spawn(p, { vel, life: 2.2, fromScale: 0.6, toScale: 2.4 + Math.random() * 1.0, color: 0xf2efe8, opacity: 0.75, drag: 1.2, gravity: -0.25 });
  }

  breakdownSmoke(p: V3): void {
    const vel = { x: (Math.random() - 0.5) * 0.4, y: 0.8 + Math.random() * 0.6, z: (Math.random() - 0.5) * 0.4 };
    this.puffs.spawn(p, { vel, life: 2.6, fromScale: 0.5, toScale: 2.2 + Math.random() * 0.8, color: 0x151311, opacity: 0.7, drag: 0.6, gravity: -0.35 });
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
    this.puffs.tick(dt);
    this.glows.tick(dt);
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

type Traits = { stranded: boolean; maxSpeed: number; hurt: boolean };
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
    if (traits.stranded) this.puffs(BREAKDOWN_RATE, dt, () => this.fx.breakdownSmoke(onBody(pose, 0.5, 1, 0)));
    else if (traits.hurt) this.puffs(DAMAGE_RATE, dt, () => this.fx.smoke(f.pos));
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
      };
      this.traits.set(v.id, t);
    }
    return t;
  }
}

function rotate(x: number, z: number, h: number): { x: number; z: number } {
  return { x: x * Math.cos(h) - z * Math.sin(h), z: x * Math.sin(h) + z * Math.cos(h) };
}

function onBody(pose: Pose, x: number, y: number, z: number): V3 {
  const off = rotate(x * pose.half.x, z * pose.half.z, pose.h);
  return { x: pose.f.pos.x + off.x, y: pose.f.pos.y + y * pose.half.y, z: pose.f.pos.z + off.z };
}
