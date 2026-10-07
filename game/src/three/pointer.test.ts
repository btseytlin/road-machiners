import { describe, expect, it } from 'vitest';
import { type PointerHits, resolvePointer } from './pointer';

const hits = (over: Partial<PointerHits>): PointerHits => ({
  own: null,
  nearestNpc: null,
  radiusPick: null,
  playerId: 'me',
  atRest: false,
  ...over,
});

describe('resolvePointer', () => {
  it('stops a moving truck hit by the ray', () => {
    expect(resolvePointer(hits({ own: 10 }))).toEqual({ kind: 'stop' });
  });

  it('consumes a click on a truck at rest', () => {
    expect(resolvePointer(hits({ own: 10, atRest: true }))).toEqual({ kind: 'own' });
  });

  it('stops when a radius-picked NPC model is not under the ray', () => {
    expect(resolvePointer(hits({ own: 10, radiusPick: 'npc' }))).toEqual({ kind: 'stop' });
  });

  it('targets an NPC drawn in front of the truck', () => {
    expect(resolvePointer(hits({ own: 10, nearestNpc: { id: 'npc', distance: 5 } }))).toEqual({ kind: 'vehicle', id: 'npc' });
  });

  it('stops when the NPC is behind the truck', () => {
    expect(resolvePointer(hits({ own: 10, nearestNpc: { id: 'npc', distance: 15 } }))).toEqual({ kind: 'stop' });
  });

  it('targets a radius-picked NPC when the ray misses the truck', () => {
    expect(resolvePointer(hits({ radiusPick: 'npc' }))).toEqual({ kind: 'vehicle', id: 'npc' });
  });

  it('gives a ground order when the radius picks the truck but the ray misses it', () => {
    expect(resolvePointer(hits({ radiusPick: 'me' }))).toEqual({ kind: 'ground' });
  });

  it('gives a ground order with no hits', () => {
    expect(resolvePointer(hits({}))).toEqual({ kind: 'ground' });
  });
});
