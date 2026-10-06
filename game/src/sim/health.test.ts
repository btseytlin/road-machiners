import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { healPlayer, maxHealthOf } from './health';
import { sitePads } from './sites';
import { emptyWorld } from './testkit';

const gate = sitePads(REGION.towns[0])[0];

describe('healing', () => {
  it('heals a parked player with supplies and spends supplies', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    Object.assign(w.player, { health: 50, supplies: 5 });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.health).toBe(50 + RULES.healPerTurn);
    expect(w.player.supplies).toBeCloseTo(5 - RULES.healSupplies);
  });

  it('heals faster in a town', () => {
    const w = emptyWorld(gate);
    Object.assign(w.player, { health: 50, supplies: 5 });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.health).toBe(50 + RULES.healPerTurn * RULES.townHealMult);
  });

  it('does not heal while driving', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 50, supplies: 5 });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    healPlayer(w);
    expect(w.player.health).toBe(50);
    expect(w.player.supplies).toBe(5);
  });

  it('heals while driving with the Long haul perk', () => {
    const w = emptyWorld();
    w.player.perks = ['longHaul'];
    Object.assign(w.player, { health: 50, supplies: 5 });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    healPlayer(w);
    expect(w.player.health).toBe(50 + RULES.healPerTurn);
    expect(w.player.supplies).toBeCloseTo(5 - RULES.healSupplies);
  });

  it('does not heal without supplies', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 50, supplies: 0 });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.health).toBe(50);
  });

  it('stops at full health and spends nothing there', () => {
    const w = emptyWorld(gate);
    Object.assign(w.player, { health: RULES.maxHealth - 1, supplies: 5 });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.health).toBe(RULES.maxHealth);
    healPlayer(w);
    expect(w.player.supplies).toBeCloseTo(5 - RULES.healSupplies);
  });

  it('never spends supplies below zero', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 50, supplies: RULES.healSupplies / 2 });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.supplies).toBe(0);
  });

  it('does not revive a player at 0 health before the death check', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 0, supplies: 5 });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.health).toBe(0);
  });

  it('heals while knocked out but not when dead', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 50, supplies: 5, state: 'knockedOut' });
    w.vehicles[0].speed = 0;
    healPlayer(w);
    expect(w.player.health).toBe(50 + RULES.healPerTurn);
    Object.assign(w.player, { health: 0, state: 'dead' });
    healPlayer(w);
    expect(w.player.health).toBe(0);
  });
});

describe('toughness on health', () => {
  it('raises max health for the player at rank 5', () => {
    const w = emptyWorld();
    expect(maxHealthOf(w)).toBe(RULES.maxHealth);
    w.player.ranks.toughness = 5;
    expect(maxHealthOf(w)).toBe(Math.round(RULES.maxHealth * (1 + 5 * SKILL_EFFECTS.toughness.maxHealth)));
  });

  it('heals past the base max health at rank 5', () => {
    const w = emptyWorld(gate);
    Object.assign(w.player, { health: RULES.maxHealth, supplies: 5 });
    w.vehicles[0].speed = 0;
    w.player.ranks.toughness = 5;
    healPlayer(w);
    expect(w.player.health).toBeGreaterThan(RULES.maxHealth);
    for (let i = 0; i < 20; i++) healPlayer(w);
    expect(w.player.health).toBe(maxHealthOf(w));
  });
});
