import * as THREE from 'three';
import { toMap, type V3 } from '../../../phys/frames';
import { inLiveRange } from '../../../sim/fidelity';
import type { World } from '../../../sim/types';
import { count } from '../../../perf';
import { CARD_SHAPES, type CardBatch } from './cards';

export const OVERWRITE_COUNTER = 'fx.particles.overwritten';
export const FAR_COUNTER = 'fx.particles.far';

export type Nearby = (p: V3) => boolean;

export function liveNear(world: () => World): Nearby {
  return (p) => inLiveRange(world(), toMap(p));
}

export type ParticleLook = {
  life: number;
  size: { from: number; to: number };
  colors: readonly number[];
  alpha: { peak: number; fadeIn: number };
  drag: number;
  gravity: number;
  streak: number;
};

type Slot = {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  spin: number;
  spinRate: number;
  shape: number;
  look: ParticleLook;
};

const SPIN_RATE = 1.2;

export class Particles {
  private readonly slots: Slot[];
  private head = 0;
  private readonly colorKeys = new Map<ParticleLook, THREE.Color[]>();
  private readonly color = new THREE.Color();

  constructor(private readonly capacity: number, private readonly nearby: Nearby) {
    this.slots = Array.from({ length: capacity }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      life: 1,
      scale: 1,
      spin: 0,
      spinRate: 0,
      shape: 0,
      look: null as never,
    }));
  }

  spawn(p: V3, vel: V3, look: ParticleLook, scale: number): void {
    if (!this.nearby(p)) {
      count(FAR_COUNTER);
      return;
    }
    const slot = this.slots[this.head];
    if (slot.alive) count(OVERWRITE_COUNTER);
    this.head = (this.head + 1) % this.capacity;
    slot.alive = true;
    slot.pos.set(p.x, p.y, p.z);
    slot.vel.set(vel.x, vel.y, vel.z);
    slot.age = 0;
    slot.life = look.life * (0.8 + Math.random() * 0.4);
    slot.scale = scale;
    slot.spin = Math.random() * Math.PI * 2;
    slot.spinRate = (Math.random() - 0.5) * 2 * SPIN_RATE;
    slot.shape = Math.floor(Math.random() * CARD_SHAPES);
    slot.look = look;
  }

  tick(dt: number): void {
    for (const s of this.slots) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.alive = false;
        continue;
      }
      s.vel.multiplyScalar(Math.exp(-s.look.drag * dt));
      s.vel.y -= s.look.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.spin += s.spinRate * dt;
    }
  }

  draw(batch: CardBatch): void {
    for (const s of this.slots) {
      if (!s.alive) continue;
      const t = s.age / s.life;
      colorAt(this.keysOf(s.look), t, this.color);
      batch.push({
        x: s.pos.x,
        y: s.pos.y,
        z: s.pos.z,
        size: sizeAt(s.look, t) * s.scale,
        spin: s.spin,
        shape: s.shape,
        r: this.color.r,
        g: this.color.g,
        b: this.color.b,
        alpha: alphaAt(s.look, t),
        sx: s.vel.x * s.look.streak,
        sy: s.vel.y * s.look.streak,
        sz: s.vel.z * s.look.streak,
      });
    }
  }

  alive(): number {
    return this.slots.filter((s) => s.alive).length;
  }

  private keysOf(look: ParticleLook): THREE.Color[] {
    let keys = this.colorKeys.get(look);
    if (!keys) {
      if (look.colors.length === 0) throw new Error('A particle look needs at least one color');
      keys = look.colors.map((c) => new THREE.Color(c));
      this.colorKeys.set(look, keys);
    }
    return keys;
  }
}

export function sizeAt(look: ParticleLook, t: number): number {
  const grow = 1 - (1 - t) * (1 - t);
  return look.size.from + (look.size.to - look.size.from) * grow;
}

export function alphaAt(look: ParticleLook, t: number): number {
  const { peak, fadeIn } = look.alpha;
  if (t < fadeIn) return (peak * t) / fadeIn;
  const u = (t - fadeIn) / (1 - fadeIn);
  return peak * (1 - u * u * (3 - 2 * u));
}

export function colorAt(keys: readonly THREE.Color[], t: number, out: THREE.Color): THREE.Color {
  if (keys.length === 1) return out.copy(keys[0]);
  const at = Math.min(1, Math.max(0, t)) * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(at));
  return out.copy(keys[i]).lerp(keys[i + 1], at - i);
}
