import { describe, expect, it } from 'vitest';
import { goodsCount } from './grid';
import { cargoHaul, surrenderHaul } from './haul';
import { addGoods, cargoRoom } from './inventory';
import { thinkNpc } from './npc-activities';
import { answersHoldUp, hasStrippable, surrenderTo } from './parley';
import { RULES } from '../data/rules';
import { hasCargo } from './salvage';
import { addVehicle, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import type { Vehicle, World } from './types';
import { endTurn } from './world';

function scene(preyGoods: Record<string, number>, fillRobber = 0) {
  forceOption('preySeen', 'rob');
  forceOption('mugging', 'demand');
  forceOption('threatened', 'comply');
  const w = emptyWorld({ x: 200, y: 200 });
  const robber = addVehicle(w, 'scavengers', 'wagon', ['heavyMg', 'mg', 'stockEngine'], { x: 10, y: 10 });
  robber.brain = npcBrain('scavenger', robber.pos, ['scavenger', 'scumbag']);
  if (fillRobber > 0) addGoods(w, robber, 'scrap', fillRobber);
  const prey = addVehicle(w, 'traders', 'scout', ['mg', 'stockEngine'], { x: 15, y: 10 });
  prey.brain = npcBrain('trader', prey.pos, ['trader']);
  for (const [good, n] of Object.entries(preyGoods)) addGoods(w, prey, good, n);
  return { w, robber, prey };
}

const total = (v: Vehicle) => Object.values(goodsCount(v)).reduce((a, b) => a + b, 0);
const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function playUntilPicked(w0: World, robber: Vehicle): World {
  let w = w0;
  for (let i = 0; i < 80 && find(w, robber.id).brain!.goals.some((g) => g.kind === 'loot'); i++) w = endTurn(w, testDrive);
  return endTurn(w, testDrive);
}

describe('a robbery from compliance to pickup', () => {
  it('an NPC victim drops what the robber can carry and the robber picks all of it up', () => {
    const { w, robber, prey } = scene({ scrap: 2, electronics: 4 });
    const held = total(prey);
    thinkNpc(w, robber);
    const dropped = held - total(prey);
    expect(dropped).toBeGreaterThan(0);
    expect(w.salvage.some((s) => s.id.startsWith('cargo-'))).toBe(true);
    const done = playUntilPicked(w, robber);
    expect(done.salvage.some((s) => s.id.startsWith('cargo-'))).toBe(false);
    expect(total(find(done, robber.id))).toBe(dropped);
    expect(total(find(done, prey.id))).toBe(held - dropped);
  });

  it('a robber that can carry only part of the load leaves the rest with the victim', () => {
    const { w, robber, prey } = scene({ scrap: 6, electronics: 6 });
    while (cargoRoom(robber) > 2) addGoods(w, robber, 'scrap', 1);
    const held = total(prey);
    const expected = cargoHaul(robber, prey).length;
    expect(expected).toBeLessThan(held);
    thinkNpc(w, robber);
    expect(held - total(prey)).toBe(expected);
    const done = playUntilPicked(w, robber);
    expect(done.salvage.some((s) => s.id.startsWith('cargo-'))).toBe(false);
    expect(hasCargo(find(done, prey.id))).toBe(true);
  });

  it('a robber with no room makes no demand', () => {
    const { w, robber, prey } = scene({ scrap: 2 });
    while (cargoRoom(robber) > 0) addGoods(w, robber, 'electronics', 1);
    expect(() => answersHoldUp(w, prey, robber, 'comply')).toThrow(/does not hold up/);
    thinkNpc(w, robber);
    expect(total(prey)).toBe(2);
  });

  it('a robber with no room strips nothing from a beaten truck', () => {
    const { w, robber, prey } = scene({ scrap: 2 });
    expect(hasStrippable(w, robber, prey)).toBe(true);
    while (cargoRoom(robber) > 0) addGoods(w, robber, 'electronics', 1);
    const bare = hasStrippable(w, robber, prey);
    expect(surrenderHaul(robber, prey).length > 0).toBe(bare);
    expect(cargoHaul(robber, prey)).toEqual([]);
  });

  it('a surrendering truck hands over cargo and mounted parts the robber can load, and no more', () => {
    const { w, robber, prey } = scene({ scrap: 1 });
    const haul = surrenderHaul(robber, prey);
    const parts = haul.filter((item) => item.kind === 'part');
    expect(parts.length).toBeLessThanOrEqual(RULES.surrenderParts);
    surrenderTo(w, prey, robber);
    expect(total(prey)).toBe(0);
    const done = playUntilPicked(w, robber);
    expect(done.salvage.some((s) => s.id.startsWith('cargo-'))).toBe(false);
  });
});
