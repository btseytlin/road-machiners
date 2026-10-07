import { describe, expect, it } from 'vitest';
import { partDef, type WeaponDef } from '../data/parts';
import { fightOdds, killRate, targetOf } from './fight-odds';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { addVehicle, emptyWorld } from './testkit';
import type { Vehicle, World } from './types';

function setUp() {
  const w = emptyWorld({ x: 200, y: 200 });
  return w;
}

// A wagon with a forward cannon: it can only shoot what is ahead.
function cannonWagon(w: World, x: number, engine = 'stockEngine'): Vehicle {
  return addVehicle(w, 'raiders', 'wagon', ['cannon', engine], { x, y: 10 });
}

describe('fight odds', () => {
  // A truck that only shoots forward loses to one that is faster and gets behind it.
  it('lets the faster truck pick the sides', () => {
    const w = setUp();
    const slowMg = addVehicle(w, 'traders', 'wagon', ['mg', 'heavyDiesel'], { x: 40, y: 10 });
    const fastMg = addVehicle(w, 'traders', 'buggy', ['mg', 'turbine'], { x: 40, y: 40 });
    const wagon = cannonWagon(w, 10);
    expect(fightOdds(w, [fastMg], [wagon]).win).toBeGreaterThan(fightOdds(w, [slowMg], [wagon]).win);
  });

  it('counts the armor on the side a gun fires into', () => {
    const w = setUp();
    const bare = addVehicle(w, 'traders', 'van', ['stockEngine'], { x: 40, y: 10 });
    const plated = addVehicle(w, 'traders', 'van', ['stockEngine'], { x: 60, y: 10 });
    expect(mountPart(w, plated, makePart(w, 'plates', 0), ['F'])).toBe(true);
    const cannon = partDef('cannon') as WeaponDef;
    expect(killRate(cannon, targetOf(plated), 'front')).toBeLessThan(killRate(cannon, targetOf(bare), 'front'));
    expect(killRate(cannon, targetOf(plated), 'rear')).toBeCloseTo(killRate(cannon, targetOf(bare), 'rear'));
  });

  it('gives a slower truck in a foe\'s range no getaway', () => {
    const w = setUp();
    const slow = addVehicle(w, 'traders', 'wagon', ['mg', 'heavyDiesel'], { x: 20, y: 10 });
    const fast = addVehicle(w, 'raiders', 'buggy', ['mg', 'turbine'], { x: 26, y: 10 });
    expect(fightOdds(w, [slow], [fast]).getaway).toBe(0);
  });

  it('lets a faster truck out of every range get away clean', () => {
    const w = setUp();
    const fast = addVehicle(w, 'traders', 'buggy', ['mg', 'turbine'], { x: 10, y: 10 });
    const slow = addVehicle(w, 'raiders', 'wagon', ['mg', 'heavyDiesel'], { x: 60, y: 10 });
    expect(fightOdds(w, [fast], [slow]).getaway).toBe(1);
  });

  it('cannot be won by a truck with no working gun', () => {
    const w = setUp();
    const unarmed = addVehicle(w, 'traders', 'van', ['stockEngine'], { x: 40, y: 10 });
    expect(fightOdds(w, [unarmed], [cannonWagon(w, 10)]).win).toBe(0);
  });

  // A trader with no gun fled from a stranded buggy with no gun, as if the stand-off were a coin flip.
  it('is never lost against a truck with no working gun', () => {
    const w = setUp();
    const unarmed = addVehicle(w, 'traders', 'van', ['stockEngine'], { x: 40, y: 10 });
    const harmless = addVehicle(w, 'raiders', 'buggy', [], { x: 46, y: 10 });
    expect(fightOdds(w, [unarmed], [harmless]).win).toBe(1);
  });

  it('adds a mate\'s fire to its group', () => {
    const w = setUp();
    const me = addVehicle(w, 'traders', 'van', ['mg', 'stockEngine'], { x: 40, y: 10 });
    const mate = addVehicle(w, 'traders', 'van', ['mg', 'stockEngine'], { x: 44, y: 10 });
    const foe = cannonWagon(w, 10);
    expect(fightOdds(w, [me, mate], [foe]).win).toBeGreaterThan(fightOdds(w, [me], [foe]).win);
  });
});
