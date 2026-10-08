import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { cabDamageThisTurn, cabKnockChance, rollCabKnock } from './cab-knock';
import { corePart } from './grid';
import { maxHp } from './wear';
import { emptyWorld } from './testkit';
import type { World } from './types';

const rule = RULES.cabKnock;
const survive = (before: number, after: number) => 1 - cabKnockChance(before, after, rule);

describe('cabKnockChance', () => {
  it('is 0 for a drop above the band and for no drop', () => {
    expect(cabKnockChance(1, 0.6, rule)).toBe(0);
    expect(cabKnockChance(0.3, 0.3, rule)).toBe(0);
  });

  it('grows with the drop and with depth', () => {
    expect(cabKnockChance(0.5, 0.3, rule)).toBeGreaterThan(cabKnockChance(0.5, 0.4, rule));
    expect(cabKnockChance(0.2, 0.0, rule)).toBeGreaterThan(cabKnockChance(0.5, 0.3, rule));
  });

  it('gives 1 - exp(-hazard) for a drop from half to 0', () => {
    expect(cabKnockChance(0.5, 0, rule)).toBeCloseTo(1 - Math.exp(-rule.hazard), 12);
  });

  it('gives the same survival over any split of a drop', () => {
    for (const pieces of [2, 5, 30]) {
      let product = 1;
      for (let i = 0; i < pieces; i++) product *= survive(1 - (i / pieces) * 0.95, 1 - ((i + 1) / pieces) * 0.95);
      expect(product).toBeCloseTo(survive(1, 0.05), 9);
    }
  });
});

function hit(w: World, damage: number, part: string, kind: 'shot' | 'collision' | 'blast'): void {
  const target = w.vehicles[0].id;
  const hits = [{ part, damage }];
  if (kind === 'collision') w.events.push({ t: 'collision', a: target, b: 'other', hitsA: hits, hitsB: [] });
  else {
    const round = { struck: kind === 'shot' ? target : null, hits: kind === 'shot' ? hits : [], blast: kind === 'blast' ? [{ vehicle: target, hits }] : [] };
    w.events.push({ t: 'shot', shooter: 'x', weapon: 'w', target, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [round] } as never);
  }
}

describe('rollCabKnock', () => {
  it('draws no RNG without a cab hit this turn or with the cab at 0', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    cab.hp = maxHp(cab) * 0.2;
    hit(w, 20, 'other-part', 'shot');
    const state = w.rngState;
    expect(rollCabKnock(w, me)).toBe(false);
    cab.hp = 0;
    hit(w, 20, cab.id, 'shot');
    expect(rollCabKnock(w, me)).toBe(false);
    expect(w.rngState).toBe(state);
  });

  it('sums cab hits from a shot, a blast and a collision', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    hit(w, 5, cab.id, 'shot');
    hit(w, 7, cab.id, 'blast');
    hit(w, 11, cab.id, 'collision');
    hit(w, 100, 'other-part', 'shot');
    expect(cabDamageThisTurn(w, me)).toBe(23);
  });
});
