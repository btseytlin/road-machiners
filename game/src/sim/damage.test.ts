import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { damagePart } from './damage';
import { corePart } from './grid';
import { consumeVehicleSupplies } from './resources';
import { addVehicle, emptyWorld, practiceOf } from './testkit';

describe('damage practice', () => {
  it('pays the player for the health lost when the cab is hit', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const health = w.player.health;
    damagePart(w, me, corePart(me, 'cab'), 10);
    const lost = health - w.player.health;
    expect(lost).toBeGreaterThan(0);
    expect(practiceOf(w, 'damage')).toMatchObject([{ amount: lost, difficulty: null }]);
  });

  it('pays nothing for a hit on a part other than the cab', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    damagePart(w, me, corePart(me, 'transmission'), 10);
    expect(practiceOf(w, 'damage')).toEqual([]);
  });

  it('pays nothing for health lost to starving', () => {
    const w = emptyWorld();
    w.player.supplies = 0;
    w.player.health = RULES.maxHealth;
    consumeVehicleSupplies(w, w.vehicles[0]);
    expect(w.player.health).toBeLessThan(RULES.maxHealth);
    expect(practiceOf(w, 'damage')).toEqual([]);
  });

  it('pays nothing for a hit on an NPC cab', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    damagePart(w, npc, corePart(npc, 'cab'), 10);
    expect(practiceOf(w, 'damage')).toEqual([]);
  });
});

describe('toughness on cab damage', () => {
  it('loses less health from a cab hit at rank 5', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    w.player.ranks.toughness = 5;
    const health = w.player.health;
    const dealt = damagePart(w, me, corePart(me, 'cab'), 20);
    const share = RULES.cabHealthShare * (1 - 5 * SKILL_EFFECTS.toughness.cabShare);
    expect(health - w.player.health).toBe(Math.round(dealt * share));
    expect(health - w.player.health).toBeLessThan(Math.round(dealt * RULES.cabHealthShare));
  });
});


describe('fight through on a broken cab', () => {
  function healthLostToTransmissionHit(perk: boolean): number {
    const w = emptyWorld();
    const me = w.vehicles[0];
    if (perk) w.player.perks.push('fightThrough');
    corePart(me, 'cab').hp = 0;
    const health = w.player.health;
    damagePart(w, me, corePart(me, 'transmission'), 20);
    return health - w.player.health;
  }

  it('hurts the driver when any part is hit', () => {
    expect(healthLostToTransmissionHit(true)).toBeGreaterThan(0);
  });

  it('keeps other parts from hurting a driver without the perk', () => {
    expect(healthLostToTransmissionHit(false)).toBe(0);
  });
});
