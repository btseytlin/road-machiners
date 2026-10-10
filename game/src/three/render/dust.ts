import * as THREE from 'three';
import { DETECT } from '../../data/detect';
import { PHYSICS } from '../../data/physics';
import { TERRAIN_TYPES, type TerrainTypeId } from '../../data/terrain';
import { PAL } from '../../render/palette';
import { hash2, valueNoise } from '../../render/noise';
import { heightAt, tileAt, type Terrain } from '../../sim/terrain';
import type { DustCloud, World } from '../../sim/types';
import type { Card, FxCards } from './particles/cards';
import { CARD_SHAPES } from './particles/cards';

const S = PHYSICS.metersPerTile;

export const DUST_LOOK = {
  maxCards: 800,
  puffs: 7,
  spread: 0.5,
  spreadGrowth: 3,
  size: 1.8,
  sizeGrowth: 2.5,
  opacity: 0.4,
  fadeIn: 0.5,
  wobble: 0.8,
  wobbleSeconds: 3.5,
  glideSeconds: 1.2,
  groundShare: 0.45,
  paleShare: 0.15,
  spinRange: Math.PI * 2,
};

export function puffsPerCloud(shownClouds: number): number {
  if (shownClouds <= 0) return 0;
  return Math.min(DUST_LOOK.puffs, Math.floor(DUST_LOOK.maxCards / shownClouds));
}

export class DustCloudsView {
  readonly root = new THREE.Group();
  private cards: Card[] = [];
  private lastTurn = -1;
  private turnMs = 0;
  private readonly tints = new Map<string, THREE.Color>();

  draw(cards: FxCards): void {
    for (const card of this.cards) cards.lit.push(card);
  }

  update(world: World, terrain: Terrain, nowMs: number): void {
    if (world.turn !== this.lastTurn) {
      this.lastTurn = world.turn;
      this.turnMs = nowMs;
    }
    const glide = Math.min(1, (nowMs - this.turnMs) / 1000 / DUST_LOOK.glideSeconds);
    const shown = new Set(world.player.clouds);
    for (const c of world.dustClouds) if (c.source === world.player.vehicleId) shown.add(c.id);
    const clouds = world.dustClouds.filter((c) => shown.has(c.id)).slice(0, DUST_LOOK.maxCards);
    const puffs = puffsPerCloud(clouds.length);
    this.cards = [];
    for (const c of clouds) this.place(terrain, c, puffs, glide, nowMs / 1000);
  }

  private place(terrain: Terrain, c: DustCloud, puffs: number, glide: number, seconds: number): void {
    const age = c.age + glide;
    const x = c.pos.x + c.vel.x * glide;
    const y = c.pos.y + c.vel.y * glide;
    const life = Math.min(1, age / DETECT.dust.lifetime);
    const fade = Math.min(1, age / DUST_LOOK.fadeIn) * (1 - life);
    const cx = x * S;
    const cy = (heightAt(terrain, x, y) + age * DETECT.dust.riseHeight) * S;
    const cz = y * S;
    const tint = this.tintOf(terrain.types[tileAt(terrain, c.pos)]);
    const seed = hashId(c.id);
    const span = DUST_LOOK.spread + DUST_LOOK.spreadGrowth * life;
    const t = seconds / DUST_LOOK.wobbleSeconds;
    for (let i = 0; i < puffs; i++) {
      const k = seed + i * 17;
      const wx = (valueNoise(k * 0.13 + t, 1.7) - 0.5) * 2 * DUST_LOOK.wobble;
      const wz = (valueNoise(4.3, k * 0.13 + t) - 0.5) * 2 * DUST_LOOK.wobble;
      const breathe = 0.75 + 0.5 * valueNoise(k * 0.29 + t * 1.3, 8.1);
      this.cards.push({
        x: cx + ((hash2(k, 3) - 0.5) * span + wx) * S,
        y: cy + hash2(k, 7) * span * 0.4 * S,
        z: cz + ((hash2(k, 11) - 0.5) * span + wz) * S,
        size: DUST_LOOK.size * (1 + (DUST_LOOK.sizeGrowth - 1) * life) * breathe * S,
        spin: hash2(k, 19) * DUST_LOOK.spinRange,
        shape: Math.min(CARD_SHAPES - 1, Math.floor(hash2(k, 23) * CARD_SHAPES)),
        r: tint.r,
        g: tint.g,
        b: tint.b,
        alpha: DUST_LOOK.opacity * fade * (0.6 + 0.8 * hash2(k, 13)),
        sx: 0,
        sy: 0,
        sz: 0,
      });
    }
  }

  private tintOf(type: TerrainTypeId): THREE.Color {
    let tint = this.tints.get(type);
    if (!tint) {
      tint = new THREE.Color(PAL.dustTrail).lerp(new THREE.Color(TERRAIN_TYPES[type].color), DUST_LOOK.groundShare);
      tint.lerp(new THREE.Color(0xffffff), DUST_LOOK.paleShare);
      this.tints.set(type, tint);
    }
    return tint;
  }
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
