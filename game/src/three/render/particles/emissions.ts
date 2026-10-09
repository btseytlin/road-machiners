import type { V3 } from '../../../phys/frames';
import type { ParticleLook, Particles } from './particles';

const rand = (spread: number) => (Math.random() - 0.5) * spread;
const vary = (base: number, spread: number) => base * (1 - spread / 2 + Math.random() * spread);

export const EMISSION_LOOK = {
  exhaust: { life: 1.1, size: { from: 0.2, to: 0.95 }, colors: [0x3c3935, 0x57524c], alpha: { peak: 0.5, fadeIn: 0.12 }, drag: 1.4, gravity: -0.5, streak: 0 },
  exhaustJet: { back: 0.9, side: 0.4, up: { min: 1.0, spread: 0.8 } },
  steam: { life: 1.5, size: { from: 0.3, to: 1.5 }, colors: [0xf6f3ec, 0xffffff], alpha: { peak: 0.55, fadeIn: 0.12 }, drag: 0.7, gravity: -1.3, streak: 0 },
  steamJet: { side: 0.6, up: { min: 1.8, spread: 1.0 } },
  douse: { life: 2.3, size: { from: 0.8, to: 3.6 }, colors: [0xffffff, 0xeeece6], alpha: { peak: 0.85, fadeIn: 0.1 }, drag: 1.3, gravity: -0.3, streak: 0 },
  douseJet: { side: 3.2, up: { min: 1.4, spread: 1.6 } },
  breakdown: { life: 3.4, size: { from: 0.7, to: 2.8 }, colors: [0x2a2724, 0x45403b], alpha: { peak: 0.85, fadeIn: 0.1 }, drag: 0.7, gravity: -0.55, streak: 0 },
  breakdownJet: { side: 0.35, up: { min: 1.2, spread: 0.7 }, lean: 0.45 },
  hurt: { life: 2.2, size: { from: 0.45, to: 1.9 }, alpha: { peak: 0.6, fadeIn: 0.12 }, drag: 1.0, gravity: -0.4, streak: 0 },
  hurtJet: { side: 0.5, up: { min: 0.8, spread: 0.6 } },
  hurtShades: [
    [0xb8b2a8, 0x8a847a],
    [0x8a847a, 0x5e5953],
    [0x5e5953, 0x3a3631],
    [0x3a3632, 0x26231f],
  ],
  missile: { life: 1.9, size: { from: 0.25, to: 1.25 }, colors: [0xb4aea4, 0x8a8278], alpha: { peak: 0.6, fadeIn: 0.1 }, drag: 1.6, gravity: -0.15, streak: 0 },
  missileJet: { side: 0.5, up: { min: 0.2, spread: 0.3 }, keep: 0.6 },
  nozzle: { life: 0.13, size: { from: 0.55, to: 0.2 }, colors: [0xffe0a0, 0xff8a30], alpha: { peak: 0.9, fadeIn: 0.15 }, drag: 0, gravity: 0, streak: 0 },
  dust: { life: 0.9, size: { from: 0.4, to: 1.3 }, colors: [0xd8c098, 0xe4d2b0], alpha: { peak: 0.6, fadeIn: 0.1 }, drag: 1.2, gravity: -0.2, streak: 0 },
  dustJet: { side: 1.2, up: { max: 0.6 } },
} as const;

const L = EMISSION_LOOK;

const HURT_LOOKS: ParticleLook[] = L.hurtShades.map((colors) => ({ ...L.hurt, colors }));

export class Emissions {
  constructor(private readonly lit: Particles, private readonly glow: Particles) {}

  exhaust(p: V3, back: V3): void {
    const j = L.exhaustJet;
    const vel = { x: back.x * j.back + rand(j.side), y: j.up.min + Math.random() * j.up.spread, z: back.z * j.back + rand(j.side) };
    this.lit.spawn(p, vel, L.exhaust, vary(1, 0.4));
  }

  steam(p: V3): void {
    const j = L.steamJet;
    const vel = { x: rand(j.side), y: j.up.min + Math.random() * j.up.spread, z: rand(j.side) };
    this.lit.spawn(p, vel, L.steam, vary(1, 0.4));
  }

  douse(p: V3): void {
    const j = L.douseJet;
    const vel = { x: rand(j.side), y: j.up.min + Math.random() * j.up.spread, z: rand(j.side) };
    this.lit.spawn(p, vel, L.douse, vary(1, 0.5));
  }

  breakdown(p: V3, motion: V3): void {
    const j = L.breakdownJet;
    const vel = { x: motion.x * j.lean + rand(j.side), y: j.up.min + Math.random() * j.up.spread, z: motion.z * j.lean + rand(j.side) };
    this.lit.spawn(p, vel, L.breakdown, vary(1, 0.4));
  }

  hurt(p: V3, damage: number): void {
    const j = L.hurtJet;
    const shade = Math.min(HURT_LOOKS.length - 1, Math.floor(Math.min(1, Math.max(0, damage)) * HURT_LOOKS.length));
    const vel = { x: rand(j.side), y: j.up.min + Math.random() * j.up.spread, z: rand(j.side) };
    this.lit.spawn(p, vel, HURT_LOOKS[shade], vary(1, 0.4));
  }

  missile(p: V3): void {
    const j = L.missileJet;
    if (Math.random() > j.keep) return;
    const vel = { x: rand(j.side), y: j.up.min + Math.random() * j.up.spread, z: rand(j.side) };
    this.lit.spawn(p, vel, L.missile, vary(1, 0.4));
    this.glow.spawn(p, { x: 0, y: 0, z: 0 }, L.nozzle, 1);
  }

  dust(p: V3): void {
    const j = L.dustJet;
    const a = Math.random() * Math.PI * 2;
    const s = j.side * (0.4 + Math.random() * 0.6);
    this.lit.spawn(p, { x: Math.cos(a) * s, y: Math.random() * j.up.max * s, z: Math.sin(a) * s }, L.dust, vary(1, 0.4));
  }
}
