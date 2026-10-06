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

const STYLE: UpgradeStyle = { skip: [], chassis: 'value', keepRoom: false };
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

  it('spends no money that belongs to the trade capital', () => {
    const w = atBowl();
    w.player.money = capital;
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, STYLE);

    expect(engineIds(o.world)).toEqual(engineIds(w));
    expect(o.world.player.money).toBe(capital);
  });

  it('mounts a better part from garage storage instead of buying one', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock = [];
    const spare = makePart(w, 'tunedEngine', 0);
    w.player.storage.push(spare);
    const o = new Orders(w);

    upgradeGear(o, { skip: ['weapon', 'armor', 'cargo', 'store'], chassis: 'value', keepRoom: false });

    expect(mountedParts(playerVehicle(o.world), 'engine').map((p) => p.id)).toEqual([spare.id]);
  });

  it('never buys a kind its style skips', () => {
    const w = atBowl();
    shopState(w, 'bowl').stock.push(makePart(w, 'turbine', 0));
    const o = new Orders(w);

    upgradeGear(o, { skip: ['engine'], chassis: 'value', keepRoom: false });

    expect(engineIds(o.world)).toEqual(engineIds(w));
  });

  it('with keepRoom, takes no gun that would fill cargo cells, where a fighter would', () => {
    const roomOf = (world: World) => freeCells({ ...playerVehicle(world), items: playerVehicle(world).items.filter((it) => it.kind === 'part') });
    // The gun is the only offer, so no cargo part bought beside it adds room.
    const offer = (world: World) => { shopState(world, 'bowl').stock = [makePart(world, 'heavyMg', 0)]; };
    const trader = atBowl();
    offer(trader);
    const fighter = structuredClone(trader);
    const kept = new Orders(trader);
    const spent = new Orders(fighter);

    upgradeGear(kept, { ...STYLE, keepRoom: true });
    upgradeGear(spent, STYLE);

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
