import * as THREE from 'three';
import type { V3 } from '../../../phys/frames';
import { PAL } from '../../../render/palette';
import type { ChunkBatch } from './chunks';
import type { Particles, ParticleLook } from './particles';

export type BlastGround = { color: number; dust: number };

export type BlastSinks = {
  smoke: Pick<Particles, 'spawn'>;
  glow: Pick<Particles, 'spawn'>;
  chunks: Pick<ChunkBatch, 'spawn'>;
};

export const BLAST_CAPS = { fireball: 18, sparks: 24, chunks: 14, dust: 10, smoke: 6 } as const;

export const BLAST_GLOW_MAX = 1 + BLAST_CAPS.fireball + BLAST_CAPS.sparks;

const DUST_COLOR = 0xd8c098;
const TAU = Math.PI * 2;

const LOOK = {
  flash: { life: 0.2, size: { from: 0.9, to: 1.5 }, colors: [0xfff4d0, 0xffb050], alpha: { peak: 1, fadeIn: 0.05 }, drag: 0, gravity: 0, streak: 0 },
  fireball: { life: 0.85, size: { from: 0.5, to: 1.2 }, colors: [0xfff0b0, 0xffb040, 0xc04810, 0x3a1408], alpha: { peak: 0.9, fadeIn: 0.08 }, drag: 2.2, gravity: -1.5, streak: 0 },
  flame: { life: 0.9, size: { from: 0.5, to: 1.1 }, colors: [0xffd070, 0xff7a20, 0x7a2008], alpha: { peak: 0.95, fadeIn: 0.1 }, drag: 1.2, gravity: -1.2, streak: 0 },
  spark: { life: 0.6, size: { from: 0.09, to: 0.05 }, colors: [0xfff0c0, 0xff9030, 0x802010], alpha: { peak: 1, fadeIn: 0.02 }, drag: 0.6, gravity: 9, streak: 0.07 },
  metal: { life: 0.45, size: { from: 0.09, to: 0.05 }, colors: [0xffffff, 0xffc060, 0xa04018], alpha: { peak: 1, fadeIn: 0.02 }, drag: 0.5, gravity: 9, streak: 0.06 },
  muzzleGlow: { life: 0.1, size: { from: 0.9, to: 0.4 }, colors: [PAL.flash, 0xff9030], alpha: { peak: 0.9, fadeIn: 0.1 }, drag: 0, gravity: 0, streak: 0 },
  smoke: { life: 4, size: { from: 1, to: 3.5 }, colors: [0x5a4e42, 0x30291f], alpha: { peak: 0.5, fadeIn: 0.1 }, drag: 1, gravity: -0.35, streak: 0 },
  soot: { life: 2, size: { from: 0.5, to: 1.8 }, colors: [0x2a2622, 0x1c1916], alpha: { peak: 0.65, fadeIn: 0.1 }, drag: 0.8, gravity: -0.4, streak: 0 },
  dust: { life: 1.3, size: { from: 0.4, to: 1.5 }, alpha: { peak: 0.5, fadeIn: 0.1 }, drag: 2.2, gravity: -0.2, streak: 0 },
} as const;

const BLAST = {
  flash: { base: 1.4, perRadius: 1.2 },
  fireball: { base: 8, perRadius: 3, scale: { base: 0.9, perRadius: 0.4, max: 4.5 }, speed: { base: 1, perRadius: 0.5 }, spread: 0.12 },
  sparks: { base: 10, perRadius: 2, speed: { min: 6, spread: 8, perRadius: 0.6 } },
  chunks: { base: 4, perRadius: 1.5, size: { min: 0.08, spread: 0.14, perRadius: 0.02, max: 0.5 }, life: 1.6, up: { min: 4, spread: 5 }, out: 4, shade: 0.72 },
  dust: { base: 4, perRadius: 1, speed: { base: 3, perRadius: 1 }, scale: { base: 0.8, perRadius: 0.1, max: 2.5 } },
  smoke: { base: 2, perRadius: 0.6, scale: { base: 1.2, perRadius: 0.4, max: 5 }, speed: { base: 1.4, perRadius: 0.3 }, lift: 0.8 },
} as const;

const IMPACT = {
  dust: { count: { small: 4, big: 8 }, scale: { small: 0.8, big: 1.3 }, up: { min: 1, spread: 1.6 }, out: 1.6, groundShare: 0.6 },
  sparks: { ground: { small: 3, big: 5 }, truck: { small: 6, big: 11 }, speed: { min: 3, spread: 5 } },
  chunks: { small: 2, big: 3, size: { min: 0.05, spread: 0.07 }, life: 1.1, up: { min: 2, spread: 2.5 }, out: 2 },
  glint: { small: 0.5, big: 0.9 },
} as const;

const CRASH = { sparks: 10, dust: 3, dustScale: 0.9, glint: 0.8, speed: { min: 2.5, spread: 5 }, up: 3 } as const;

const AIR = { fireball: 10, sparks: 14, flash: 1.6, scale: 0.55, speed: 3 } as const;

const FIRE = { flames: 8, soot: 4, rise: { min: 2, spread: 1.5 }, side: 1.6, sootScale: 1 } as const;

const MUZZLE = { glow: 0.9, sparks: { min: 2, spread: 3 }, speed: { min: 8, spread: 10 }, cone: 0.3, life: 0.6 } as const;

function between(min: number, spread: number): number {
  return min + Math.random() * spread;
}

function outward(speed: number, up: number): V3 {
  const a = Math.random() * TAU;
  const s = speed * (0.4 + Math.random() * 0.6);
  return { x: Math.cos(a) * s, y: up * (0.3 + Math.random() * 0.7), z: Math.sin(a) * s };
}

function direction(): V3 {
  const a = Math.random() * TAU;
  const lift = Math.random();
  const flat = Math.sqrt(1 - lift * lift);
  return { x: Math.cos(a) * flat, y: lift, z: Math.sin(a) * flat };
}

function around(p: V3, radius: number): V3 {
  const d = outward(radius, radius * 0.5);
  return { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
}

function lifted(p: V3, dy: number): V3 {
  return { x: p.x, y: p.y + dy, z: p.z };
}

function scaled(v: V3, k: number): V3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

export class Blasts {
  private readonly dustLooks = new Map<number, ParticleLook>();
  private readonly chunkColors = new Map<number, THREE.Color>();

  constructor(private readonly sinks: BlastSinks) {}

  impact(p: V3, truck: boolean, big: boolean, ground: BlastGround | null): void {
    const size = big ? 'big' : 'small';
    if (truck) {
      this.sparks(p, IMPACT.sparks.truck[size], LOOK.metal, IMPACT.sparks.speed.min, IMPACT.sparks.speed.spread);
      this.sinks.glow.spawn(p, { x: 0, y: 0, z: 0 }, LOOK.flash, IMPACT.glint[size]);
      return;
    }
    const kick = ground ?? { color: DUST_COLOR, dust: 1 };
    const dust = this.dustLook(kick.color, IMPACT.dust.groundShare);
    const n = Math.max(1, Math.round(IMPACT.dust.count[size] * Math.min(1, kick.dust)));
    for (let i = 0; i < n; i++) this.sinks.smoke.spawn(lifted(p, 0.1), outward(IMPACT.dust.out, between(IMPACT.dust.up.min, IMPACT.dust.up.spread)), dust, IMPACT.dust.scale[size] * between(0.8, 0.4));
    this.sparks(p, IMPACT.sparks.ground[size], LOOK.spark, IMPACT.sparks.speed.min, IMPACT.sparks.speed.spread);
    const c = IMPACT.chunks;
    for (let i = 0; i < c[size]; i++) {
      const vel = outward(c.out, between(c.up.min, c.up.spread));
      this.sinks.chunks.spawn(lifted(p, 0.05), vel, between(c.size.min, c.size.spread), c.life * between(0.7, 0.6), this.chunkColor(kick.color, BLAST.chunks.shade));
    }
  }

  blast(p: V3, radius: number, ground: BlastGround | null): void {
    const kick = ground ?? { color: DUST_COLOR, dust: 1 };
    this.flash(p, radius);
    this.fireball(p, radius);
    this.sparks(p, Math.min(BLAST_CAPS.sparks, Math.round(BLAST.sparks.base + BLAST.sparks.perRadius * radius)), LOOK.spark, BLAST.sparks.speed.min + BLAST.sparks.speed.perRadius * radius, BLAST.sparks.speed.spread);
    this.chunks(p, radius, kick.color);
    this.dustRing(p, radius, kick.color);
    this.smoke(p, radius);
  }

  crash(p: V3, ground: BlastGround | null): void {
    const kick = ground ?? { color: DUST_COLOR, dust: 1 };
    this.sinks.glow.spawn(p, { x: 0, y: 0, z: 0 }, LOOK.flash, CRASH.glint);
    this.sparks(p, CRASH.sparks, LOOK.metal, CRASH.speed.min, CRASH.speed.spread, CRASH.up);
    const dust = this.dustLook(kick.color, IMPACT.dust.groundShare);
    for (let i = 0; i < CRASH.dust; i++) this.sinks.smoke.spawn(lifted(p, 0.2), outward(IMPACT.dust.out, 1.5), dust, CRASH.dustScale * between(0.8, 0.4));
  }

  airBurst(p: V3): void {
    this.sinks.glow.spawn(p, { x: 0, y: 0, z: 0 }, LOOK.flash, AIR.flash);
    for (let i = 0; i < AIR.fireball; i++) this.sinks.glow.spawn(around(p, AIR.scale * 0.3), outward(AIR.speed, 1), LOOK.fireball, AIR.scale * between(0.7, 0.6));
    this.sparks(p, AIR.sparks, LOOK.spark, BLAST.sparks.speed.min, BLAST.sparks.speed.spread);
  }

  fireBurst(p: V3): void {
    for (let i = 0; i < FIRE.flames; i++) {
      const vel = { x: (Math.random() - 0.5) * FIRE.side, y: between(FIRE.rise.min, FIRE.rise.spread), z: (Math.random() - 0.5) * FIRE.side };
      this.sinks.glow.spawn(p, vel, LOOK.flame, between(0.8, 0.4));
    }
    for (let i = 0; i < FIRE.soot; i++) {
      const vel = { x: (Math.random() - 0.5) * FIRE.side * 0.6, y: between(FIRE.rise.min * 0.6, FIRE.rise.spread), z: (Math.random() - 0.5) * FIRE.side * 0.6 };
      this.sinks.smoke.spawn(p, vel, LOOK.soot, FIRE.sootScale * between(0.8, 0.4));
    }
  }

  muzzle(p: V3, dir: V3, length: number): void {
    this.sinks.glow.spawn(p, { x: 0, y: 0, z: 0 }, LOOK.muzzleGlow, length * MUZZLE.glow);
    const along = scaled(dir, 1 / Math.hypot(dir.x, dir.y, dir.z));
    const n = Math.floor(between(MUZZLE.sparks.min, MUZZLE.sparks.spread));
    for (let i = 0; i < n; i++) {
      const speed = between(MUZZLE.speed.min, MUZZLE.speed.spread);
      const jitter = { x: (Math.random() - 0.5) * MUZZLE.cone, y: (Math.random() - 0.5) * MUZZLE.cone, z: (Math.random() - 0.5) * MUZZLE.cone };
      const vel = scaled({ x: along.x + jitter.x, y: along.y + jitter.y, z: along.z + jitter.z }, speed);
      this.sinks.glow.spawn(p, vel, LOOK.spark, MUZZLE.life);
    }
  }

  private flash(p: V3, radius: number): void {
    this.sinks.glow.spawn(lifted(p, 0.3), { x: 0, y: 0, z: 0 }, LOOK.flash, BLAST.flash.base + BLAST.flash.perRadius * radius);
  }

  private fireball(p: V3, radius: number): void {
    const f = BLAST.fireball;
    const n = Math.min(BLAST_CAPS.fireball, Math.round(f.base + f.perRadius * radius));
    const scale = Math.min(f.scale.max, f.scale.base + f.scale.perRadius * radius);
    const speed = f.speed.base + f.speed.perRadius * radius;
    for (let i = 0; i < n; i++) this.sinks.glow.spawn(lifted(around(p, radius * f.spread), 0.3), outward(speed, speed * 0.8), LOOK.fireball, scale * between(0.7, 0.6));
  }

  private sparks(p: V3, count: number, look: ParticleLook, minSpeed: number, spreadSpeed: number, lift = 0): void {
    for (let i = 0; i < count; i++) {
      const d = scaled(direction(), between(minSpeed, spreadSpeed));
      this.sinks.glow.spawn(p, { x: d.x, y: d.y + lift, z: d.z }, look, 1);
    }
  }

  private chunks(p: V3, radius: number, ground: number): void {
    const c = BLAST.chunks;
    const n = Math.min(BLAST_CAPS.chunks, Math.round(c.base + c.perRadius * radius));
    const color = this.chunkColor(ground, c.shade);
    for (let i = 0; i < n; i++) {
      const vel = outward(c.out + radius * 0.3, between(c.up.min, c.up.spread));
      const size = Math.min(c.size.max, between(c.size.min, c.size.spread) + c.size.perRadius * radius);
      this.sinks.chunks.spawn(lifted(p, 0.1), vel, size, c.life * between(0.7, 0.6), color);
    }
  }

  private dustRing(p: V3, radius: number, ground: number): void {
    const d = BLAST.dust;
    const n = Math.min(BLAST_CAPS.dust, Math.round(d.base + d.perRadius * radius));
    const scale = Math.min(d.scale.max, d.scale.base + d.scale.perRadius * radius);
    const look = this.dustLook(ground, IMPACT.dust.groundShare);
    for (let i = 0; i < n; i++) this.sinks.smoke.spawn(lifted(p, 0.2), outward(d.speed.base + d.speed.perRadius * radius, 0.8), look, scale * between(0.8, 0.4));
  }

  private smoke(p: V3, radius: number): void {
    const s = BLAST.smoke;
    const n = Math.min(BLAST_CAPS.smoke, Math.round(s.base + s.perRadius * radius));
    const scale = Math.min(s.scale.max, s.scale.base + s.scale.perRadius * radius);
    const speed = s.speed.base + s.speed.perRadius * radius;
    for (let i = 0; i < n; i++) this.sinks.smoke.spawn(lifted(p, scale * s.lift), outward(speed, speed), LOOK.smoke, scale * between(0.8, 0.4));
  }

  private dustLook(ground: number, share: number): ParticleLook {
    const key = ground + share * 0x1000000;
    let look = this.dustLooks.get(key);
    if (!look) {
      const tint = new THREE.Color(DUST_COLOR).lerp(new THREE.Color(ground), share);
      const pale = tint.clone().lerp(new THREE.Color(0xffffff), 0.15);
      look = { ...LOOK.dust, colors: [tint.getHex(), pale.getHex()] };
      this.dustLooks.set(key, look);
    }
    return look;
  }

  private chunkColor(ground: number, shade: number): THREE.Color {
    let color = this.chunkColors.get(ground);
    if (!color) {
      color = new THREE.Color(ground).multiplyScalar(shade);
      this.chunkColors.set(ground, color);
    }
    return color;
  }
}
