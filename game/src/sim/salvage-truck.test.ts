import { describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { PERK_NUMBERS } from '../data/skills';
import { knockOutNpc } from './defeat';
import { corePart, findSpot, goodsCount, gridOf, isMounted, MOUNT_CELLS, type Spot } from './grid';
import { addGoods } from './inventory';
import { advanceJobs } from './jobs';
import { optionWeights } from './npc-decisions';
import { thinkNpc, topGoal } from './npc-activities';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import { lootTruckTurn, takeFromTruck } from './salvage';
import { lootBlockerHere } from './locations';
import type { GridItem, Vehicle, World } from './types';
import { refreshVision } from './vision';

function downed(): { w: World; me: Vehicle; buggy: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + gap, y: 30 });
  buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
  addGoods(w, buggy, 'scrap', 2);
  corePart(buggy, 'cab').hp = 0;
  knockOutNpc(w, buggy);
  refreshVision(w);
  return { w, me, buggy };
}

function itemOf(v: Vehicle, test: (it: GridItem) => boolean): GridItem {
  const item = v.items.find(test);
  if (!item) throw new Error(`No such item on ${v.name}`);
  return item;
}

const gunOn = (v: Vehicle) => itemOf(v, (it) => it.kind === 'part' && it.part.defId === 'mg');
const scrapOn = (v: Vehicle) => itemOf(v, (it) => it.kind === 'good' && it.good === 'scrap');
const cabOn = (v: Vehicle) => itemOf(v, (it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core' && it.part.id === corePart(v, 'cab').id);

function spareSpot(me: Vehicle, item: GridItem): Spot {
  const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
  const spot = findSpot(gridOf(me), me.items, { ...item, id: 'probe' }, null, avoid);
  if (!spot) throw new Error('No spare spot');
  return spot;
}

describe('the player looting a knocked-out truck', () => {
  it('takes a good at once', () => {
    const { w, me, buggy } = downed();
    const scrap = scrapOn(buggy);
    const held = goodsCount(me).scrap ?? 0;
    const next = takeFromTruck(w, buggy.id, scrap.id, spareSpot(me, scrap));
    expect(goodsCount(next.vehicles[0]).scrap).toBe(held + 1);
    expect(goodsCount(next.vehicles.find((v) => v.id === buggy.id)!).scrap).toBe(1);
    expect(next.vehicles[0].job).toBeNull();
  });

  it('removes an installed gun in a field refit that ends with the gun on the player grid', () => {
    const { w, me, buggy } = downed();
    const gun = gunOn(buggy);
    const next = takeFromTruck(w, buggy.id, gun.id, spareSpot(me, gun));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: Math.ceil(RULES.refitTurnsPerPart) });
    for (let turn = 1; turn < Math.ceil(RULES.refitTurnsPerPart); turn++) advanceJobs(next);
    const target = () => next.vehicles.find((v) => v.id === buggy.id)!;
    expect(target().items.some((it) => it.id === gun.id)).toBe(true);
    advanceJobs(next);
    expect(target().items.some((it) => it.id === gun.id)).toBe(false);
    expect(next.vehicles[0].items.some((it) => it.kind === 'part' && it.part.id === (gun.kind === 'part' ? gun.part.id : ''))).toBe(true);
    expect(next.vehicles[0].job).toBeNull();
  });

  it('removes an installed gun in one job with the Cannibal perk', () => {
    const { w, me, buggy } = downed();
    w.player.perks = ['cannibal'];
    const gun = gunOn(buggy);
    const next = takeFromTruck(w, buggy.id, gun.id, spareSpot(me, gun));
    const turns = PERK_NUMBERS.cannibal.turns;
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
  });

  it('cancels the removal when the truck wakes, and the gun stays on it', () => {
    const { w, me, buggy } = downed();
    const gun = gunOn(buggy);
    const next = takeFromTruck(w, buggy.id, gun.id, spareSpot(me, gun));
    const target = next.vehicles.find((v) => v.id === buggy.id)!;
    target.defeat = { ...target.defeat!, phase: 'retreat' };
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(target.items.some((it) => it.id === gun.id)).toBe(true);
  });

  it('refuses a built-in part', () => {
    const { w, me, buggy } = downed();
    const cab = cabOn(buggy);
    expect(() => takeFromTruck(w, buggy.id, cab.id, spareSpot(me, cab))).toThrow('Built-in parts stay on the truck');
  });

  it('refuses a truck out of reach or awake', () => {
    const { w, me, buggy } = downed();
    const scrap = scrapOn(buggy);
    buggy.defeat = { ...buggy.defeat!, phase: 'retreat' };
    expect(() => takeFromTruck(w, buggy.id, scrap.id, spareSpot(me, scrap))).toThrow('Park beside a knocked-out truck');
  });
});

function looterBeside(w: World, buggy: Vehicle): Vehicle {
  const gap = chassisDef('hauler').radius + chassisDef('buggy').radius + 0.2;
  const looter = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], { x: buggy.pos.x, y: buggy.pos.y + gap });
  looter.brain = npcBrain('scavenger', looter.pos, ['scavenger']);
  return looter;
}

describe('the player and another looter at one knocked-out truck', () => {
  it('refuses to take from a truck another driver strips, and names the driver', () => {
    const { w, me, buggy } = downed();
    const looter = looterBeside(w, buggy);
    lootTruckTurn(w, looter, buggy);
    const gun = gunOn(buggy);
    const items = buggy.items.length;
    expect(() => takeFromTruck(w, buggy.id, gun.id, spareSpot(me, gun))).toThrow(`${looter.name} is looting this truck`);
    expect(buggy.items).toHaveLength(items);
    expect(lootBlockerHere(w, buggy.id)).toBe(looter);
  });

  it('takes from the truck once the other driver is gone', () => {
    const { w, me, buggy } = downed();
    const looter = looterBeside(w, buggy);
    lootTruckTurn(w, looter, buggy);
    w.vehicles = w.vehicles.filter((v) => v.id !== looter.id);
    const gun = gunOn(buggy);
    const next = takeFromTruck(w, buggy.id, gun.id, spareSpot(me, gun));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', pickup: { from: 'truck', vehicleId: buggy.id } });
  });
});

describe('an NPC looting a knocked-out truck', () => {
  it('takes loose items at once, then one installed part per refit', () => {
    const { w, me, buggy } = downed();
    me.pos = { x: 200, y: 200 };
    const looter = looterBeside(w, buggy);
    expect(lootTruckTurn(w, looter, buggy)).toBeNull();
    expect(goodsCount(looter).scrap).toBe(2);
    expect(looter.job).toMatchObject({ kind: 'refit', turnsLeft: Math.ceil(RULES.refitTurnsPerPart) });
    for (let turn = 0; turn < Math.ceil(RULES.refitTurnsPerPart); turn++) advanceJobs(w);
    const left = buggy.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind !== 'core');
    expect(left).toHaveLength(1);
    expect(looter.items.filter((it) => it.kind === 'part' && !isMounted(looter.chassisId, it))).toHaveLength(1);
    expect(lootTruckTurn(w, looter, buggy)).toBeNull();
    for (let turn = 0; turn < Math.ceil(RULES.refitTurnsPerPart); turn++) advanceJobs(w);
    expect(lootTruckTurn(w, looter, buggy)).toBe('nothing left to loot');
  });

  it('takes the full refit turns while the player holds the Cannibal perk', () => {
    const { w, me, buggy } = downed();
    w.player.perks = ['cannibal'];
    me.pos = { x: 200, y: 200 };
    const looter = looterBeside(w, buggy);
    lootTruckTurn(w, looter, buggy);
    expect(looter.job).toMatchObject({ kind: 'refit', turnsLeft: Math.ceil(RULES.refitTurnsPerPart) });
  });

  it('rolls the same loot decision for a knocked-out truck as for a wreck in sight', () => {
    const { w, me, buggy } = downed();
    me.pos = { x: 200, y: 200 };
    const looter = looterBeside(w, buggy);
    looter.pos = { x: buggy.pos.x, y: buggy.pos.y + 6 };
    w.salvage.push({ id: 'wreck-road', pos: { x: buggy.pos.x + 1, y: buggy.pos.y + 6 }, radius: 0.7, goods: { scrap: 2 }, parts: [] });
    refreshVision(w);
    expect(optionWeights(w, looter, 'salvageSeen', buggy.id, null)).toEqual(optionWeights(w, looter, 'salvageSeen', 'wreck-road', null));
  });

  it('pushes a loot goal on a knocked-out truck it passes', () => {
    const { w, me, buggy } = downed();
    me.pos = { x: 200, y: 200 };
    const looter = looterBeside(w, buggy);
    looter.pos = { x: buggy.pos.x, y: buggy.pos.y + 6 };
    looter.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'test' }];
    forceOption('salvageSeen', 'loot');
    refreshVision(w);
    thinkNpc(w, looter);
    expect(topGoal(looter)).toMatchObject({ kind: 'loot', targetId: buggy.id });
  });
});
