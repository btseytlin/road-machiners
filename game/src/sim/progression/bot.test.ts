import { PRESSURE_MAX } from '../../data/market';
import type { GameEvent, Vehicle, World } from '../types';
import { describe, expect, it } from 'vitest';
import { REGION } from '../../data/region';
import { playerVehicle, vehicleById } from '../damage';
import { makePart } from '../factory';
import { goodsCount, mountedParts } from '../grid';
import { addGoods, removeAllGoods } from '../inventory';
import { nearestPad, nearestTown } from '../sites';
import { isStranded } from '../stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls, startCombat } from '../testkit';
import { startEscort } from '../tow';
import type { Vec } from '../vec';
import { playerSees } from '../vision';
import { cloneWorld } from '../world';
import { botOrders, raiderHuntGrounds } from './bot';

function town(id: string) {
  const found = REGION.towns.find((t) => t.id === id);
  if (!found) throw new Error(`No town ${id}`);
  return found;
}

// An empty world with the player parked on a pad of a town, its cargo gone, and both towns known.
function parkedAt(id: string) {
  const site = town(id);
  const w = emptyWorld(nearestPad(site, site.pos));
  const me = playerVehicle(w);
  removeAllGoods(me);
  me.speed = 0;
  w.player.discovered = ['bowl', 'nose'];
  return w;
}

// Salt flooded at Nose and short at Bowl, so it is the clear best haul whatever the tuned prices.
function saltGlut(w: World): World {
  w.shops.nose.pressure.salt = -PRESSURE_MAX;
  w.shops.bowl.pressure.salt = PRESSURE_MAX;
  return w;
}

describe('botOrders', () => {
  it('gives a knocked-out player no commands', () => {
    const w = parkedAt('bowl');
    w.player.state = 'knockedOut';

    const turn = botOrders(w, 'trader');

    expect(turn.world).toBe(w);
    expect(turn.events).toEqual([]);
  });

  // Nose sells salt cheap, and Bowl pays well for it.
  it('has a trader buy the most profitable good in the town it stands at', () => {
    const w = saltGlut(parkedAt('nose'));

    const turn = botOrders(w, 'trader');

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
    expect(turn.world.player.money).toBeLessThan(w.player.money);
  });

  it('has a trader carry its cargo to the known town that pays more for it', () => {
    const w = parkedAt('bowl');
    addGoods(w, playerVehicle(w), 'electronics', 2);
    w.player.costBasis.electronics = 100;

    const turn = botOrders(w, 'trader');

    const order = playerVehicle(turn.world).order;
    const nose = town('nose');
    expect(order).toEqual({ kind: 'stopAt', dest: nearestPad(nose, playerVehicle(w).pos) });
  });

  it('has a scavenger with no salvage left and every site found trade instead', () => {
    const w = saltGlut(parkedAt('nose'));
    w.salvage = [];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((site) => site.id);

    const turn = botOrders(w, 'scavenger');

    expect(Object.keys(goodsCount(playerVehicle(turn.world)))).toEqual(['salt']);
  });

  it('has a scavenger with no salvage left, every site found and no load it can afford wait in the nearest town', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const me = playerVehicle(w);
    removeAllGoods(me);
    w.salvage = [];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((site) => site.id);
    w.player.money = 0;

    const turn = botOrders(w, 'scavenger');

    const home = nearestTown(w);
    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: nearestPad(home, me.pos) });
  });

  // A knockout strips the engine, and the stranded truck is stuck until it gets one.
  function withoutEngine(w: ReturnType<typeof parkedAt>) {
    const me = playerVehicle(w);
    me.items = me.items.filter((it) => it.kind !== 'part' || !mountedParts(me, 'engine').includes(it.part));
    return w;
  }

  it('has a scavenger beside a wreck wait to search it while in combat', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = playerVehicle(w);
    me.speed = 0;
    w.salvage.push({ id: 'wreck-beside', pos: { x: 31.5, y: 30 }, radius: 0.6, goods: { scrap: 2 }, parts: [] });
    startCombat(w, addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }), me);

    const turn = botOrders(w, 'scavenger');

    expect(playerVehicle(turn.world).job).toBeNull();
  });

  it('has a stranded truck crawl to the nearest town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    const me = playerVehicle(w);
    me.pos = { x: me.pos.x + 20, y: me.pos.y - 20 };

    const turn = botOrders(w, 'trader');

    const after = playerVehicle(turn.world);
    expect(after.order).toEqual({ kind: 'stopAt', dest: nearestPad(nearestTown(w), me.pos) });
    expect(turn.world.player.beacon).toBe(true);
  });

  it('has a stranded truck without an engine buy and mount one in town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.shops.bowl.stock.push(makePart(w, 'stockEngine', 0));
    expect(isStranded(w, playerVehicle(w))).toBe(true);

    const turn = botOrders(w, 'fighter');

    expect(mountedParts(playerVehicle(turn.world), 'engine')).toHaveLength(1);
    expect(isStranded(turn.world, playerVehicle(turn.world))).toBe(false);
  });

  it('has a broke stranded truck crawl on with its goal instead of waiting in town', () => {
    const w = withoutEngine(parkedAt('bowl'));
    w.player.money = 0;

    const turn = botOrders(w, 'fighter');

    expect(mountedParts(playerVehicle(turn.world), 'engine')).toHaveLength(0);
    expect(playerVehicle(turn.world).order?.kind).toBe('stopAt');
  });

  // A parked raider can hold the exact point of a ground, so the stop order ends a little short of it.
  it('has a fighter whose stop ended near a hunting ground go on to the next one', () => {
    const ground = raiderHuntGrounds()[1];
    const w = parkedAt('bowl');
    const me = playerVehicle(w);
    me.pos = { x: ground.x + 1.5, y: ground.y };
    me.order = null;

    const turn = botOrders(w, 'fighter');

    expect(playerVehicle(turn.world).order).toEqual({ kind: 'stopAt', dest: raiderHuntGrounds()[2] });
  });
});

// ---- Robbery.

// A trader in the player's sight, at peace, with goods on its grid and a goal line that says it carries cargo.
function addTrader(w: World, pos: Vec, parts: string[] = ['stockEngine']): Vehicle {
  const v = addVehicle(w, 'traders', 'hauler', parts, pos);
  v.brain = npcBrain('trader', pos, ['trader']);
  v.brain.goals = [{ kind: 'sell', targetId: 'nose', destination: { ...town('nose').pos }, phase: 'travel', reason: 'deliver purchased cargo' }];
  if (addGoods(w, v, 'electronics', 4) < 4) throw new Error('No room for trader cargo');
  return v;
}

// A supply convoy on its way to load cargo, and a convoy guard escorting it, both beside it.
function addGuardedConvoy(w: World, pos: Vec): { convoy: Vehicle; guard: Vehicle } {
  const convoy = addVehicle(w, 'convoys', 'hauler', ['stockEngine'], pos);
  convoy.brain = npcBrain('convoy', pos, ['supplier']);
  convoy.brain.goals = [{ kind: 'haul', targetId: 'nose', destination: { ...town('nose').pos }, phase: 'travel', reason: 'load cargo at its source' }];
  if (addGoods(w, convoy, 'water', 4) < 4) throw new Error('No room for convoy cargo');
  const guardPos = { x: pos.x, y: pos.y + 3 };
  const guard = addVehicle(w, 'convoys', 'scout', ['mg', 'stockEngine'], guardPos);
  guard.brain = npcBrain('convoyGuard', guardPos, ['guard', 'brave']);
  startEscort(w, guard, convoy, null, 0);
  return { convoy, guard };
}

function radioed(turn: { events: GameEvent[] }, target: Vehicle): boolean {
  return turn.events.some((e) => e.t === 'call' && e.with === target.id && e.outcome === 'opened');
}

// The player parked in open ground away from towns, with the scout kit's one machine gun.
function robberWorld(): World {
  const w = emptyWorld({ x: 60, y: 60 });
  playerVehicle(w).speed = 0;
  w.player.discovered = ['bowl', 'nose'];
  return w;
}

describe('botOrders for robbers', () => {
  it('does not radio a loaded trader out of sight', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 160, y: 60 });
    expect(playerSees(w, trader.pos)).toBe(false);

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, trader)).toBe(false);
  });

  it('radios a loaded trader in sight', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 64, y: 60 });
    expect(playerSees(w, trader.pos)).toBe(true);

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, trader)).toBe(true);
    expect(turn.world.player.talked[trader.id]?.rob).toBeDefined();
  });

  it('skips a trader with more guns than the player', () => {
    const w = robberWorld();
    const trader = addTrader(w, { x: 64, y: 60 }, ['mg', 'mg', 'stockEngine']);

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, trader)).toBe(false);
  });

  it('skips a convoy whose guard is in sight', () => {
    const w = robberWorld();
    const { convoy } = addGuardedConvoy(w, { x: 64, y: 60 });

    const turn = botOrders(w, 'robber');

    expect(radioed(turn, convoy)).toBe(false);
  });

  it('has the convoy robber radio a guarded convoy', () => {
    const w = robberWorld();
    const { convoy } = addGuardedConvoy(w, { x: 64, y: 60 });

    const turn = botOrders(w, 'convoyRobber');

    expect(radioed(turn, convoy)).toBe(true);
  });

  it('notes the answer of a demand', () => {
    forceOption('threatened', 'comply');
    const w = robberWorld();
    w.rngState = rngStateForForcedRolls(4);
    const trader = addTrader(w, { x: 62, y: 60 });

    const turn = botOrders(w, 'robber');

    expect(turn.notes).toContainEqual({ kind: 'demand', target: trader.id, answer: 'comply', guarded: false });
  });

  it('searches the pile a complying trader drops, then takes it', () => {
    forceOption('threatened', 'comply');
    const w = robberWorld();
    w.rngState = rngStateForForcedRolls(4);
    const trader = addTrader(w, { x: 61.5, y: 60 });

    const demanded = botOrders(w, 'robber');
    const pile = demanded.world.salvage.find((s) => s.pile && s.goods.electronics);
    if (!pile) throw new Error('The trader dropped no pile');
    expect(playerVehicle(demanded.world).job).toMatchObject({ kind: 'search', stockId: pile.id });

    const searched = cloneWorld(demanded.world);
    playerVehicle(searched).job = null;
    searched.player.scavenged.push(pile.id);
    const looted = botOrders(searched, 'robber');

    expect(goodsCount(playerVehicle(looted.world)).electronics).toBe(4);
    expect(goodsCount(vehicleById(looted.world, trader.id)).electronics).toBeUndefined();
  });
});
