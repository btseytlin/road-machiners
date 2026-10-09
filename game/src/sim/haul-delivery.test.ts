import { defaultSetup } from './settings';
import { describe, expect, it } from 'vitest';
import { GOODS } from '../data/goods';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { goodsCount } from './grid';
import { acceptContract, contractReward, estimateTurns, goodValue, haulWindow, shopState, siteOf, type Contract } from './market';
import { playTurns } from './progression/record';
import { nearestPad } from './sites';
import { newWorld, update } from './world';

const UNITS = 8;

// The reported route: tools from Bowl to Granary, rolled by the haul rule, driven by the hauler bot through the real turn pipeline.
function offer(rush: boolean): Extract<Contract, { kind: 'haul' }> {
  const turns = estimateTurns(siteOf('bowl').pos, siteOf('granary').pos);
  const window = haulWindow(turns, rush);
  return { id: 'ct-test', shop: 'bowl', kind: 'haul', good: 'tools', units: UNITS, to: 'granary', reward: contractReward(turns, UNITS * goodValue('tools'), rush), deadline: window, window, rush, tier: GOODS.tools.tier };
}

describe('Bowl to Granary tools haul', () => {
  it.each([false, true])('is delivered on time and pays its reward (rush %s)', (rush) => {
    let world = newWorld(1, startKit('midgame'), TEST_MAP, defaultSetup('roaming'));
    const pad = nearestPad(siteOf('bowl'), playerVehicle(world).pos);
    const haul = offer(rush);
    world = update(world, (d) => {
      playerVehicle(d).pos = { ...pad };
      shopState(d, 'bowl').contracts.push({ ...haul });
    });
    world = acceptContract(world, haul.id);
    expect(goodsCount(playerVehicle(world)).tools).toBe(UNITS);
    const deadline = world.player.contracts[0].deadline;
    let done = false;
    let paid = 0;
    for (const played of playTurns(world, `haul rush ${rush}`, 'hauler', haul.window)) {
      world = played.next;
      expect(played.events.some((e) => e.t === 'stall')).toBe(false);
      if (played.events.some((e) => e.t === 'contract' && e.outcome === 'done')) {
        done = true;
        paid = played.ledger.contracts ?? 0;
        break;
      }
    }
    expect(done).toBe(true);
    expect(world.turn).toBeLessThanOrEqual(deadline);
    expect(paid).toBe(haul.reward);
    expect(goodsCount(playerVehicle(world)).tools ?? 0).toBe(0);
  }, 300_000);
});
