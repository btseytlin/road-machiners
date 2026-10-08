import { describe, expect, it } from 'vitest';
import { REGION } from '../../data/region';
import { startKit } from '../../data/start';
import { playerVehicle } from '../damage';
import { makePart } from '../factory';
import { freeCells, mountedParts } from '../grid';
import { shopState } from '../market';
import { nearestPad } from '../sites';
import { vehicleStats } from '../stats';
import { emptyWorld } from '../testkit';
import type { World } from '../types';
import { Orders, upgradeGear, type UpgradeStyle } from './orders';

const STYLE: UpgradeStyle = { skip: [], chassis: 'value', job: 'courier' };
const FIGHTER: UpgradeStyle = { ...STYLE, job: 'fighter' };
const capital = startKit('standard').money;

function atBowl(): World {
  const bowl = REGION.towns.find((t) => t.id === 'bowl');
  if (!bowl) throw new Error('No town bowl');
  const w = emptyWorld(nearestPad(bowl, bowl.pos));
  playerVehicle(w).speed = 0;
  w.player.money = capital + 100_000;
  return w;
}

const engineIds = (w: World) => mountedParts(playerVehicle(w), 'engine').map((p) => p.defId);

describe('upgradeGear', () => {
  it('replaces the mounted engine with a better one from the shop stock', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, STYLE);

    expect(engineIds(o.world)).toEqual(['turbine']);
  });

  it('keeps the trade capital of a trader', () => {
    const w = atBowl();
    w.player.money = capital;
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, { ...STYLE, job: 'trader' });

    expect(engineIds(o.world)).toEqual(engineIds(w));
    expect(o.world.player.money).toBe(capital);
  });

  it('lets a fighter spend its starting money on a gun, since it keeps no goods money', () => {
    const w = atBowl();
    w.player.money = capital;
    shopState(w, 'bowl').stock.push(makePart(w, 'heavyMg', 0));
    const o = new Orders(w);
    const gunsBefore = mountedParts(playerVehicle(w), 'weapon').length;

    upgradeGear(o, FIGHTER);

    expect(mountedParts(playerVehicle(o.world), 'weapon').length).toBeGreaterThan(gunsBefore);
    expect(o.world.player.money).toBeLessThan(capital);
    expect(shopState(o.world, 'bowl').stock.some((p) => p.defId === 'heavyMg')).toBe(false);
  });

  it('mounts a better part from garage storage instead of buying one', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock = [];
    const spare = makePart(w, 'tunedEngine', 0);
    w.player.storage.push(spare);
    const o = new Orders(w);

    upgradeGear(o, { ...STYLE, skip: ['weapon', 'armor', 'cargo', 'store'] });

    expect(mountedParts(playerVehicle(o.world), 'engine').map((p) => p.id)).toEqual([spare.id]);
  });

  it('lets a gunless fighter save for a gun instead of spending on armor', () => {
    const w = atBowl();
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => it.kind !== 'part' || it.part.defId === 'core' || !mountedParts(me, 'weapon').includes(it.part));
    expect(mountedParts(me, 'weapon')).toHaveLength(0);
    shopState(w, 'bowl').stock = [makePart(w, 'steelPlate', 0), makePart(w, 'cage', 0)];
    const o = new Orders(w);

    upgradeGear(o, FIGHTER);

    expect(o.world.player.money).toBe(w.player.money);
  });

  it('lets an armed fighter spend on armor when it adds fight strength', () => {
    const w = atBowl();
    expect(mountedParts(playerVehicle(w), 'weapon').length).toBeGreaterThan(0);
    shopState(w, 'bowl').stock = [makePart(w, 'steelPlate', 0)];
    const o = new Orders(w);

    upgradeGear(o, FIGHTER);

    expect(o.world.player.money).toBeLessThan(w.player.money);
    expect(mountedParts(playerVehicle(o.world), 'armor').length).toBeGreaterThan(mountedParts(playerVehicle(w), 'armor').length);
  });

  it('never buys a kind its style skips', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, { skip: ['engine'], chassis: 'value', job: 'fighter' });

    expect(engineIds(o.world)).toEqual(engineIds(w));
  });

  it('as a trader, takes no gun that would fill cargo cells, where a fighter would', () => {
    const roomOf = (world: World) => freeCells({ ...playerVehicle(world), items: playerVehicle(world).items.filter((it) => it.kind === 'part') });
    const offer = (world: World) => { shopState(world, 'bowl').stock = [makePart(world, 'heavyMg', 0)]; };
    const trader = atBowl();
    offer(trader);
    const fighter = structuredClone(trader);
    const kept = new Orders(trader);
    const spent = new Orders(fighter);

    upgradeGear(kept, { ...STYLE, job: 'trader' });
    upgradeGear(spent, FIGHTER);

    expect(roomOf(kept.world)).toBeGreaterThanOrEqual(roomOf(trader));
    expect(roomOf(spent.world)).toBeLessThan(roomOf(fighter));
  });

  it('buys nothing away from a garage', () => {
    const w = atBowl();
    playerVehicle(w).pos = { x: 5, y: 5 };
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, STYLE);

    expect(o.world.player.money).toBe(w.player.money);
  });
});

describe('upgradeGear for a fighter', () => {
  const offer = (world: World) => { shopState(world, 'bowl').stock = [makePart(world, 'heavyMg', 0)]; };
  const roomOf = (world: World) => freeCells(playerVehicle(world));
  const speedOf = (world: World) => vehicleStats(world, playerVehicle(world)).maxSpeed;

  it('keeps the free cells it was told to keep for loot, where it would fill them otherwise', () => {
    const w = atBowl();
    offer(w);
    const spent = new Orders(structuredClone(w));
    const kept = new Orders(structuredClone(w));

    upgradeGear(spent, FIGHTER);
    upgradeGear(kept, { ...FIGHTER, lootRoom: roomOf(w) });

    expect(roomOf(spent.world)).toBeLessThan(roomOf(w));
    expect(roomOf(kept.world)).toBeGreaterThanOrEqual(roomOf(w));
  });

  it('takes no part that drops the top speed below the speed it keeps', () => {
    const w = atBowl();
    offer(w);
    const spent = new Orders(structuredClone(w));
    const kept = new Orders(structuredClone(w));

    upgradeGear(spent, FIGHTER);
    upgradeGear(kept, { ...FIGHTER, minSpeed: speedOf(w) });

    expect(speedOf(spent.world)).toBeLessThan(speedOf(w));
    expect(speedOf(kept.world)).toBeGreaterThanOrEqual(speedOf(w));
  });

  it('still buys a part that adds speed, with a speed to keep', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, { ...STYLE, minSpeed: speedOf(w) });

    expect(engineIds(o.world)).toEqual(['turbine']);
  });
});
