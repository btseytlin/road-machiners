import { describe, expect, it } from 'vitest';
import { LOCAL_TOPICS } from '../data/locals';
import type { Contract } from '../sim/market';
import { offerText } from './talk';

describe('work offer text', () => {
  it('puts the contract terms into the local line', () => {
    const c: Contract = { id: 'ct1', shop: 'bowl', kind: 'haul', good: 'salt', units: 3, to: 'nose', reward: 12000, deadline: 500, window: 100, rush: false, tier: 1 };

    const text = offerText(LOCAL_TOPICS['dag.work'].work!.offer, c);

    expect(text).toMatch(/^Could be\. Haul 3 Salt to Nose, pays 120 M, within \d+ h\. Interested\?$/);
  });
});
