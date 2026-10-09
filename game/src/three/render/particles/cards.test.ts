import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { perfSnapshot } from '../../../perf';
import { CardBatch, OVERFILL_COUNTER, type Card } from './cards';

const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 1, 100);
camera.updateProjectionMatrix();

function card(alpha: number, size: number): Card {
  return { x: 0, y: 0, z: 0, size, spin: 0, shape: 0, r: 1, g: 1, b: 1, alpha, sx: 0, sy: 0, sz: 0 };
}

function drawn(batch: CardBatch): number {
  return (batch.meshes[0].geometry as THREE.InstancedBufferGeometry).instanceCount;
}

describe('card fill ceiling', () => {
  it('draws every card while they paint less than the ceiling', () => {
    const batch = new CardBatch(16, 'glow', new THREE.Texture(), 2);
    for (let i = 0; i < 4; i++) batch.push(card(0.5, 5));
    batch.flush(camera);
    expect(drawn(batch)).toBe(4);
  });

  it('stops drawing the faintest cards once they would paint the screen more times over than the ceiling', () => {
    const batch = new CardBatch(16, 'glow', new THREE.Texture(), 2);
    const before = perfSnapshot()[OVERFILL_COUNTER]?.calls ?? 0;
    for (const alpha of [0.1, 0.9, 0.2, 0.8, 0.3, 0.7]) batch.push(card(alpha, 10));
    batch.flush(camera);
    expect(drawn(batch)).toBe(2);
    expect(perfSnapshot()[OVERFILL_COUNTER].calls - before).toBe(4);
    const tints = batch.meshes[0].geometry.getAttribute('tint');
    const kept = [tints.getW(0), tints.getW(1)].sort();
    expect(kept[0]).toBeCloseTo(0.8);
    expect(kept[1]).toBeCloseTo(0.9);
  });

  it('counts a streak by its length on screen', () => {
    const batch = new CardBatch(16, 'glow', new THREE.Texture(), 1);
    batch.push({ ...card(0.9, 5), sx: 15 });
    batch.push(card(0.5, 5));
    batch.flush(camera);
    expect(drawn(batch)).toBe(1);
  });
});
