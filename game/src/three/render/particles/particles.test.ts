import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { perfSnapshot, resetPerf } from '../../../perf';
import type { Card, CardBatch } from './cards';
import { alphaAt, colorAt, FAR_COUNTER, OVERWRITE_COUNTER, Particles, sizeAt, type ParticleLook } from './particles';

const LOOK: ParticleLook = { life: 1, size: { from: 1, to: 3 }, colors: [0xff0000, 0x0000ff], alpha: { peak: 0.6, fadeIn: 0.2 }, drag: 0, gravity: 0, streak: 0 };
const AT = { x: 0, y: 0, z: 0 };
const STILL = { x: 0, y: 0, z: 0 };
const NEAR = () => true;

class RecordingBatch {
  cards: Card[] = [];
  push(card: Card): void {
    this.cards.push(card);
  }
}

function drawn(p: Particles): Card[] {
  const batch = new RecordingBatch();
  p.draw(batch as unknown as CardBatch);
  return batch.cards;
}

describe('particle curves', () => {
  it('grows size from its start to its end', () => {
    expect(sizeAt(LOOK, 0)).toBe(1);
    expect(sizeAt(LOOK, 1)).toBe(3);
    expect(sizeAt(LOOK, 0.5)).toBeGreaterThan(2);
  });

  it('fades alpha in to its peak, then out to zero', () => {
    expect(alphaAt(LOOK, 0)).toBe(0);
    expect(alphaAt(LOOK, 0.2)).toBeCloseTo(0.6);
    expect(alphaAt(LOOK, 1)).toBeCloseTo(0);
    expect(alphaAt(LOOK, 0.6)).toBeLessThan(0.6);
  });

  it('blends color keys spread evenly over life', () => {
    const keys = [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)];
    const out = new THREE.Color();
    expect(colorAt(keys, 0, out).r).toBe(1);
    expect(colorAt(keys, 0.5, out).g).toBe(1);
    expect(colorAt(keys, 0.75, out).b).toBeCloseTo(0.5);
    expect(colorAt(keys, 1, out).b).toBe(1);
  });
});

describe('Particles', () => {
  beforeEach(() => resetPerf());

  it('spawns nothing out of the live range and counts the skip', () => {
    const p = new Particles(4, (at) => at.x < 10);
    p.spawn({ x: 5, y: 0, z: 0 }, STILL, LOOK, 1);
    p.spawn({ x: 50, y: 0, z: 0 }, STILL, LOOK, 1);
    expect(p.alive()).toBe(1);
    expect(perfSnapshot()[FAR_COUNTER].calls).toBe(1);
  });

  it('reuses the oldest slot when full and counts the overwrite', () => {
    const p = new Particles(2, NEAR);
    p.spawn({ x: 1, y: 0, z: 0 }, STILL, LOOK, 1);
    p.spawn({ x: 2, y: 0, z: 0 }, STILL, LOOK, 1);
    p.spawn({ x: 3, y: 0, z: 0 }, STILL, LOOK, 1);
    expect(p.alive()).toBe(2);
    expect(drawn(p).map((c) => c.x).sort()).toEqual([2, 3]);
    expect(perfSnapshot()[OVERWRITE_COUNTER].calls).toBe(1);
  });

  it('frees a particle at the end of its life', () => {
    const p = new Particles(4, NEAR);
    p.spawn(AT, STILL, LOOK, 1);
    p.tick(LOOK.life * 1.21);
    expect(p.alive()).toBe(0);
    expect(drawn(p)).toEqual([]);
  });

  it('moves a particle by its velocity and gravity', () => {
    const p = new Particles(1, NEAR);
    p.spawn(AT, { x: 1, y: 0, z: 0 }, { ...LOOK, gravity: -1 }, 1);
    p.tick(0.5);
    const [card] = drawn(p);
    expect(card.x).toBeGreaterThan(0.4);
    expect(card.y).toBeGreaterThan(0);
  });
});
