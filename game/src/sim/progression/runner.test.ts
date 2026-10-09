import { describe, expect, it } from 'vitest';
import { startKit } from '../../data/start';
import { TEST_MAP } from '../../test/map';
import { playerVehicle } from '../damage';
import { goodsCount, mountedParts } from '../grid';
import { defaultSetup } from '../settings';
import type { World } from '../types';
import { maxHp } from '../wear';
import { endTurn, newWorld } from '../world';
import { botOrders } from './bot';

function atFirstOutpost(): World {
  const w = newWorld(3, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
  const me = playerVehicle(w);
  me.pos = { ...w.gauntlet!.outposts[0].pad };
  me.speed = 0;
  return endTurn(w, () => {});
}

describe('the Gauntlet runner bot', () => {
  it('repairs, restocks patch parts and drives on to the next outpost', () => {
    const w = atFirstOutpost();
    for (const part of mountedParts(playerVehicle(w))) part.hp = Math.ceil(maxHp(part) * 0.6);
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => !(it.kind === 'good' && it.good === 'parts'));

    const turn = botOrders(w, 'runner');
    const after = playerVehicle(turn.world);

    expect(mountedParts(after).every((p) => p.hp === maxHp(p))).toBe(true);
    expect(goodsCount(after).parts).toBe(4);
    expect(after.order).toEqual({ kind: 'stopAt', dest: turn.world.gauntlet!.outposts[1].pad });
    expect(turn.ledger.repairs).toBeLessThan(0);
  });

  it('ends the run when stranded with no way to patch', () => {
    const w = newWorld(3, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
    w.player.fuel = 0;

    const turn = botOrders(w, 'runner');

    expect(turn.world.player.state).toBe('dead');
    expect(turn.events).toContainEqual({ t: 'runLost', stretch: 1, cause: 'abandoned' });
  });
});
