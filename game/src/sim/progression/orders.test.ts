import { describe, expect, it } from 'vitest';
import { REGION } from '../../data/region';
import { startKit } from '../../data/start';
import { playerVehicle } from '../damage';
import { makePart } from '../factory';
import { freeCells, mountedParts } from '../grid';
import { shopState } from '../market';
import { nearestPad } from '../sites';
import { emptyWorld } from '../testkit';
import type { World } from '../types';
import { Orders, upgradeGear, type UpgradeStyle } from './orders';

const STYLE: UpgradeStyle = { skip: [], chassis: 'value', job: 'courier' };
const FIGHTER: UpgradeStyle = { ...STYLE, job: 'fighter' };
const capital = startKit('standard').money;

// The player parked on a pad of Bowl, which has a garage, with plenty of money.
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

  it('lets a fighter save for a gun instead of spending on armor', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock = [makePart(w, 'steelPlate', 0), makePart(w, 'cage', 0)];
    const o = new Orders(w);

    upgradeGear(o, FIGHTER);

    expect(o.world.player.money).toBe(w.player.money);
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
    const offer = (world: World) => shopState(world, 'bowl').stock.push(makePart(world, 'heavyMg', 0));
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
