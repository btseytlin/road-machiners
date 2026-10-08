import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { SMOKE } from '../data/utilities';
import { hitOdds } from './combat';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { deploySmoke, smokeCrosses } from './hazards';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import type { PartInstance, Vehicle, World } from './types';
import { activateUtilities, advanceUtilityEffects, utilityOrderError } from './utility';
import type { Vec } from './vec';
import { canVehicleSee, hasLineOfFire, refreshVision } from './vision';
import { endTurn } from './world';

function duel(): { w: World; me: Vehicle; buggy: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
  buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
  return { w, me, buggy };
}

function cloud(w: World, pos: Vec, r: number): void {
  deploySmoke(w, w.vehicles[0], pos, r, 3);
}

function smokeCause(w: World, me: Vehicle, buggy: Vehicle): number {
  return hitOdds(w, me, vehicleStats(w, me).weapons[0], buggy, 'body').causes.smoke;
}

function playerWith(defId: string): { w: World; me: Vehicle; part: PartInstance } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const part = makePart(w, defId, 0);
  if (!mountPart(w, me, part)) throw new Error(`No deck room for ${defId}`);
  return { w, me, part };
}

describe('smokeCrosses', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it('is true when the shooter stands inside a cloud', () => {
    const w = emptyWorld();
    cloud(w, { x: 1, y: 0 }, 2);

    expect(smokeCrosses(w, a, b)).toBe(true);
  });

  it('is true when the target stands inside a cloud', () => {
    const w = emptyWorld();
    cloud(w, { x: 11, y: 1 }, 2);

    expect(smokeCrosses(w, a, b)).toBe(true);
  });

  it('is true when the line crosses a cloud between them', () => {
    const w = emptyWorld();
    cloud(w, { x: 5, y: 1.5 }, 2);

    expect(smokeCrosses(w, a, b)).toBe(true);
  });

  it('is true when both stand inside one cloud', () => {
    const w = emptyWorld();
    cloud(w, { x: 5, y: 0 }, 8);

    expect(smokeCrosses(w, a, b)).toBe(true);
  });

  it('is false when the cloud lies beside the line, or beyond its ends on the same line', () => {
    const w = emptyWorld();
    cloud(w, { x: 5, y: 2.5 }, 2);
    cloud(w, { x: -3, y: 0 }, 2);
    cloud(w, { x: 13, y: 0 }, 2);

    expect(smokeCrosses(w, a, b)).toBe(false);
  });
});

describe('the smoke spread cause', () => {
  it('adds SMOKE.spread to a shot through a cloud, and nothing to a clear shot', () => {
    const { w, me, buggy } = duel();
    buggy.speed = 3;
    expect(smokeCause(w, me, buggy)).toBe(0);

    cloud(w, { x: 31.5, y: 30 }, 1);

    expect(smokeCause(w, me, buggy)).toBeCloseTo(SMOKE.spread, 9);
  });

  it('counts the cause once however many clouds the line crosses', () => {
    const { w, me, buggy } = duel();
    buggy.speed = 3;
    cloud(w, { x: 31, y: 30 }, 1);
    cloud(w, { x: 32, y: 30 }, 1);

    expect(smokeCause(w, me, buggy)).toBeCloseTo(SMOKE.spread, 9);
  });

  it('scales down with the rest of the spread for a still target', () => {
    const { w, me, buggy } = duel();
    buggy.speed = 0;
    const mg = vehicleStats(w, me).weapons[0];
    const clear = hitOdds(w, me, mg, buggy, 'body').spread;

    cloud(w, { x: 31.5, y: 30 }, 1);
    const smoky = hitOdds(w, me, mg, buggy, 'body').spread;

    expect(smoky - clear).toBeCloseTo(SMOKE.spread * RULES.stillSpread, 9);
  });

  it('changes neither sight nor line of fire', () => {
    const { w, me, buggy } = duel();
    const before = { npcSees: canVehicleSee(w, buggy, me.pos), fire: hasLineOfFire(w, buggy.pos, me.pos) };
    const visible = [...w.player.visible];

    cloud(w, { x: 31.5, y: 30 }, 4);
    refreshVision(w);

    expect({ npcSees: canVehicleSee(w, buggy, me.pos), fire: hasLineOfFire(w, buggy.pos, me.pos) }).toEqual(before);
    expect(before).toEqual({ npcSees: true, fire: true });
    expect(w.player.visible).toEqual(visible);
  });
});

describe('the Sprout', () => {
  it('puts a cloud around the truck that already spoils this turn\'s shots, and starts its reload', () => {
    const { w, me, part } = playerWith('sprout');
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI);
    buggy.speed = 3;
    me.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(w.smoke).toEqual([{ id: expect.any(String), source: me.id, pos: me.pos, r: 5, turnsLeft: 6 }]);
    expect(smokeCause(w, me, buggy)).toBeCloseTo(SMOKE.spread, 9);
    expect(part.charge).toEqual({ reload: 10 });
  });

  it('used in a turn, still has all its turns left when the turn ends', () => {
    const { w, me, part } = playerWith('sprout');
    me.utilityOrders[part.id] = { kind: 'self' };

    const next = endTurn(w, testDrive);

    expect(next.smoke.map((s) => s.turnsLeft)).toEqual([6]);
    expect(next.vehicles[0].utilityOrders).toEqual({});
  });

  it('covers shots for its turns and is then gone', () => {
    const { w, me, part } = playerWith('sprout');
    me.utilityOrders[part.id] = { kind: 'self' };
    activateUtilities(w);

    for (let turn = 1; turn < 6; turn++) advanceUtilityEffects(w);
    expect(w.smoke).toHaveLength(1);

    advanceUtilityEffects(w);
    expect(w.smoke).toEqual([]);
  });
});

describe('the Smoke mortar', () => {
  it('refuses a point nearer than its minimum or farther than its maximum range', () => {
    const { w, me, part } = playerWith('smokeMortar');
    const at = (dx: number) => ({ kind: 'point' as const, pos: { x: me.pos.x + dx, y: me.pos.y } });

    expect(utilityOrderError(w, me, part.id, at(4.9))).toMatch(/range/);
    expect(utilityOrderError(w, me, part.id, at(16.1))).toMatch(/range/);
    expect(utilityOrderError(w, me, part.id, at(5))).toBeNull();
    expect(utilityOrderError(w, me, part.id, at(16))).toBeNull();
  });

  it('puts its cloud on the chosen point, out of sight or not', () => {
    const { w, me, part } = playerWith('smokeMortar');
    const pos = { x: me.pos.x, y: me.pos.y + 12 };
    me.utilityOrders[part.id] = { kind: 'point', pos };

    activateUtilities(w);

    expect(w.smoke).toEqual([{ id: expect.any(String), source: me.id, pos, r: 4, turnsLeft: 5 }]);
    expect(part.charge).toEqual({ reload: 8 });
  });

  it('drops an order whose point the truck has driven out of range of', () => {
    const { w, me, part } = playerWith('smokeMortar');
    me.utilityOrders[part.id] = { kind: 'point', pos: { x: me.pos.x + 10, y: me.pos.y } };
    me.pos = { x: me.pos.x + 8, y: me.pos.y };

    activateUtilities(w);

    expect(w.smoke).toEqual([]);
    expect(part.charge).toEqual({ reload: 0 });
  });
});
