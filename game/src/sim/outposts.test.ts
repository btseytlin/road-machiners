import { describe, expect, it } from 'vitest';
import { ECONOMY, GOODS } from '../data/goods';
import { GAUNTLET } from '../data/gauntlet';
import { startKit } from '../data/start';
import { REPAIR } from '../data/wear';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { courseLine, pointAt } from './gauntlet-layout';
import { corePart, goodsCount, mountedParts } from './grid';
import { startRepair } from './jobs';
import { repairPlan } from './repair';
import { outpostBuyGood, outpostBuyPart, outpostBuySupply, outpostGoodPrice, outpostPartPrice, outpostRepairAll, outpostRepairBasics } from './outposts';
import { defaultSetup } from './settings';
import type { World } from './types';
import { maxHp } from './wear';
import { endTurn, newWorld } from './world';

const still = () => {};

function atOutpost(): World {
  const w = newWorld(3, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
  const me = playerVehicle(w);
  me.pos = { ...w.gauntlet!.outposts[0].pad };
  me.speed = 0;
  return endTurn(w, still);
}

function batter(w: World): void {
  for (const part of mountedParts(playerVehicle(w))) part.hp = Math.floor(maxHp(part) / 2);
}

describe('outpost services', () => {
  it('repairs every part for the garage price', () => {
    const w = atOutpost();
    batter(w);
    w.player.money = 10_000_000;
    const money = w.player.money;

    const after = outpostRepairAll(w);

    expect(mountedParts(playerVehicle(after)).every((p) => p.hp === maxHp(p))).toBe(true);
    expect(after.player.money).toBeLessThan(money);
  });

  it('repairs only the core parts for the basics price', () => {
    const w = atOutpost();
    batter(w);

    const after = outpostRepairBasics(w);
    const me = playerVehicle(after);

    expect(corePart(me, 'cab').hp).toBe(maxHp(corePart(me, 'cab')));
    expect(mountedParts(me, 'weapon').some((p) => p.hp < maxHp(p))).toBe(true);
  });

  it('sells fuel at the town price', () => {
    const w = atOutpost();
    w.player.fuel -= 10;
    const money = w.player.money;

    const after = outpostBuySupply(w, 'fuel', 10);

    expect(after.player.fuel).toBe(w.player.fuel + 10);
    expect(after.player.money).toBe(money - ECONOMY.supplyPrice.fuel * 10);
  });

  it('sells a stock part onto the truck and off the shelf', () => {
    const w = atOutpost();
    w.player.money = 10_000_000;
    const post = w.gauntlet!.outposts[0];
    const part = post.stock[0];
    const price = outpostPartPrice(w, part);

    const after = outpostBuyPart(w, part.id);

    expect(after.gauntlet!.outposts[0].stock.map((p) => p.id)).not.toContain(part.id);
    expect(playerVehicle(after).items.some((it) => it.kind === 'part' && it.part.id === part.id)).toBe(true);
    expect(after.player.money).toBe(w.player.money - price);
  });

  it('sells parts for field patching at a markup', () => {
    const w = atOutpost();
    const held = goodsCount(playerVehicle(w)).parts ?? 0;

    const after = outpostBuyGood(w, 2);

    expect(goodsCount(playerVehicle(after)).parts).toBe(held + 2);
    expect(after.player.money).toBe(w.player.money - outpostGoodPrice() * 2);
    expect(outpostGoodPrice()).toBe(Math.ceil(GOODS.parts.value * GAUNTLET.goodsMarkup));
  });

  it('carries a bought part into the next stretch', () => {
    let w = atOutpost();
    w.player.money = 10_000_000;
    const part = w.gauntlet!.outposts[0].stock[0];
    w = outpostBuyPart(w, part.id);
    const me = playerVehicle(w);
    me.pos = pointAt(courseLine(w.gauntlet!.course), w.gauntlet!.outposts[0].at + 30, GAUNTLET.laneOffsets[1]);

    w = endTurn(w, still);

    expect(w.gauntlet!.stretch).toBe(1);
    expect(playerVehicle(w).items.some((it) => it.kind === 'part' && it.part.id === part.id)).toBe(true);
  });

  it('patches a broken engine in the field with bought parts, up to the field cap', () => {
    let w = atOutpost();
    w.player.money = 10_000_000;
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    engine.hp = 0;
    const plan = repairPlan(w, playerVehicle(w), engine.id);
    w = outpostBuyGood(w, plan.needed - plan.parts);
    w.player.autoRepair = false;
    w = startRepair(w, engine.id);
    for (let i = 0; i < 30 && playerVehicle(w).job; i++) w = endTurn(w, still);

    const patched = mountedParts(playerVehicle(w), 'engine')[0];
    expect(patched.hp).toBeCloseTo(maxHp(patched) * REPAIR.fieldCapShare, 0);
  });
});

describe('outpost commands off the pad', () => {
  const commands: [string, (w: World) => World][] = [
    ['repair all', outpostRepairAll],
    ['repair basics', outpostRepairBasics],
    ['buy fuel', (w) => outpostBuySupply(w, 'fuel', 1)],
    ['buy a part', (w) => outpostBuyPart(w, w.gauntlet!.outposts[0].stock[0].id)],
    ['buy parts', (w) => outpostBuyGood(w, 1)],
  ];

  it.each(commands)('refuse to %s away from the pad', (_name, command) => {
    const w = atOutpost();
    playerVehicle(w).pos = { x: 20, y: 20 };

    expect(() => command(w)).toThrow(/outpost/);
  });

  it.each(commands)('refuse to %s at an outpost not reached yet', (_name, command) => {
    const w = newWorld(3, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));
    const me = playerVehicle(w);
    me.pos = { ...w.gauntlet!.outposts[1].pad };
    me.speed = 0;
    w.player.fuel -= 5;

    expect(() => command(w)).toThrow(/outpost/);
  });

  it.each(commands)('refuse to %s on the move', (_name, command) => {
    const w = atOutpost();
    playerVehicle(w).speed = 3;
    w.player.fuel -= 5;

    expect(() => command(w)).toThrow(/outpost/);
  });
});
