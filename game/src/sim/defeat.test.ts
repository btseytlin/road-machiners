import { NPCS } from '../data/npcs';
import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { CONDITION } from '../data/wear';
import { autoOrders, isHostile } from './combat';
import { buyGood } from './economy';
import { advanceKnockout, checkDeath, checkKnockout, gaveUp, isKnockedOut, standDown } from './defeat';
import { corePart, coreParts, goodsCount, hasLoot, isLoot } from './grid';
import { addGoods, dumpItem, moveItem } from './inventory';
import { scavenge } from './locations';
import { startSearch } from './search';
import { addState, endState, stateOf } from './states';
import { startRepair } from './jobs';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, rngStateWhere, testDrive } from './testkit';
import { maxHp } from './wear';
import { maxHealthOf } from './health';
import { PERK_NUMBERS } from '../data/skills';
import { territoryOfStock } from './territory';
import { refreshVision } from './vision';
import type { Vehicle, World } from './types';
import { endTurn, setDirect, setMoveOrder, setWeaponOrder } from './world';

// Every goods unit and part id a vehicle and the stocks hold, for checking that nothing is lost or copied.
function inventory(w: World, v: Vehicle): { goods: Record<string, number>; parts: string[] } {
  const goods: Record<string, number> = { ...goodsCount(v) };
  const parts = v.items.flatMap((it) => (it.kind === 'part' ? [it.part.id] : []));
  for (const stock of w.salvage) {
    for (const [good, n] of Object.entries(stock.goods)) goods[good] = (goods[good] ?? 0) + n;
    parts.push(...stock.parts.map((p) => p.id));
  }
  for (const [good, n] of Object.entries(goods)) if (n === 0) delete goods[good];
  return { goods, parts: parts.sort() };
}

function knockedOut(): { w: World; me: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  w.salvage = [];
  const me = w.vehicles[0];
  corePart(me, 'cab').hp = 0;
  checkKnockout(w);
  return { w, me };
}

// A raider that dealt the knockout blow and watches the truck, so it keeps the driver down.
function knockedOutByRaider(parts: string[] = []): { w: World; me: Vehicle; raider: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  w.salvage = [];
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER; // no new drivers, whose goals need a stock
  const me = w.vehicles[0];
  const raider = addVehicle(w, 'raiders', 'buggy', parts, { x: 36, y: 30 });
  me.lastHitBy = raider.id;
  corePart(me, 'cab').hp = 0;
  checkKnockout(w);
  return { w, me, raider };
}

describe('death', () => {
  it('kills the player at 0 health', () => {
    const w = emptyWorld();
    w.player.health = 0;
    checkDeath(w);
    expect(w.player.state).toBe('dead');
    expect(w.events).toEqual([{ t: 'death' }]);
    checkDeath(w);
    expect(w.events).toEqual([{ t: 'death' }]);
  });

  it('keeps a living player alive', () => {
    const w = emptyWorld();
    w.player.health = 1;
    checkDeath(w);
    expect(w.player.state).toBe('active');
  });

  it('dies in a turn that ends at 0 health, and no turn runs after', () => {
    let w = emptyWorld();
    w.player.health = 0;
    w = endTurn(w, testDrive);
    expect(w.player.state).toBe('dead');
    expect(w.events.some((e) => e.t === 'death')).toBe(true);
    expect(w.events.some((e) => e.t === 'knockout')).toBe(false);
    expect(() => endTurn(w, testDrive)).toThrow(/dead/);
  });

  it('does not knock out a dead player with a broken cab', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 0, state: 'dead' });
    corePart(w.vehicles[0], 'cab').hp = 0;
    const items = w.vehicles[0].items.length;
    checkKnockout(w);
    expect(w.vehicles[0].items).toHaveLength(items);
    expect(w.events).toEqual([]);
  });

  it('a broke, starving player weakens to the starve floor without a knockout', () => {
    let w = emptyWorld({ x: 30, y: 30 });
    Object.assign(w.player, { fuel: 0, supplies: 0, money: 0 });
    for (let i = 0; i < 20; i++) w = endTurn(w, testDrive);
    expect(w.player.health).toBe(RULES.starveFloor);
    expect(w.player.state).toBe('active');
    expect(w.player.knockouts).toBe(0);
    expect(corePart(w.vehicles[0], 'cab').hp).toBeGreaterThan(0);
  });

  it('starts the player active with a full supply load', () => {
    const w = emptyWorld();
    expect(w.player.state).toBe('active');
    expect(w.player.knockoutTurns).toBe(0);
    expect(w.player.supplies).toBe(RULES.baseSupplies);
  });
});

describe('loot', () => {
  it('counts goods, spare parts and mounted non-core parts, never core parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    expect(hasLoot(me)).toBe(true);
    const bare = addVehicle(w, 'traders', 'scout', [], { x: 40, y: 30 });
    expect(hasLoot(bare)).toBe(false);
    const gunned = addVehicle(w, 'traders', 'scout', ['mg'], { x: 44, y: 30 });
    expect(hasLoot(gunned)).toBe(true);
  });
});

describe('knockout', () => {
  it('keeps every item on the truck, drops no pile, and makes the truck nobody’s foe', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage = [];
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    expect(isHostile(w, raider, me)).toBe(true);
    corePart(me, 'cab').hp = 0;
    const items = structuredClone(me.items);
    const money = w.player.money;
    const fuel = w.player.fuel;
    const supplies = w.player.supplies;
    checkKnockout(w);
    expect(me.items).toEqual(items);
    expect(w.salvage).toEqual([]);
    expect(isKnockedOut(me)).toBe(true);
    expect(isHostile(w, raider, me)).toBe(false);
    expect(w.player).toMatchObject({ money, fuel, supplies, state: 'knockedOut', knockoutTurns: 0, knockouts: 1 });
    expect(w.events).toContainEqual({ t: 'knockout' });
  });

  it('brakes the truck, clears its orders and its job, and fulfils feuds against it', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    addState(w, 'feud', raider.id, me.id, { kind: 'feud', robbery: false });
    me.order = { kind: 'stopAt', dest: { x: 50, y: 30 } };
    me.speed = 0;
    me.job = { kind: 'repair', partId: corePart(me, 'cab').id, parts: 1, turnsLeft: 3, total: 3 };
    me.weaponOrders = { x: { targetId: raider.id, aim: 'body' } };
    me.trail = [{ x: 29, y: 30, heading: 0 }, { x: 30, y: 30, heading: 0 }];
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(me.order).toEqual({ kind: 'brake' });
    expect(me.speed).toBe(0);
    expect(me.job).toBeNull();
    expect(me.weaponOrders).toEqual({});
    expect(me.trail).toEqual([]);
    expect(stateOf(w, 'feud', raider.id, me.id)).toBeNull();
    expect(w.events).toContainEqual({ t: 'stateEnded', state: expect.objectContaining({ kind: 'feud', holder: raider.id }), ending: 'fulfilled' });
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled' }));
  });

  it('a hurt but working cab is no knockout', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'cab').hp = 1;
    checkKnockout(w);
    expect(w.player.state).toBe('active');
    expect(w.events).toEqual([]);
  });

  it('keeps the knocked-out truck in place over turns', () => {
    let { w } = knockedOutByRaider();
    const at = { ...w.vehicles[0].pos };
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(w.player.state).toBe('knockedOut');
      expect(w.vehicles[0].pos).toEqual(at);
    }
  });
});

describe('fight through', () => {
  // The player truck with a broken cab and health at a share of max health.
  function brokenCab(healthShare: number, perks: World['player']['perks']): World {
    const w = emptyWorld({ x: 30, y: 30 });
    w.player.perks = perks;
    w.player.health = maxHealthOf(w) * healthShare;
    corePart(w.vehicles[0], 'cab').hp = 0;
    return w;
  }

  it('keeps the player driving on a broken cab while health is above the perk share', () => {
    const w = brokenCab(PERK_NUMBERS.fightThrough.health + 0.01, ['fightThrough']);
    checkKnockout(w);
    expect(w.player.state).toBe('active');
    expect(isKnockedOut(w.vehicles[0])).toBe(false);
  });

  it('knocks the player out once health falls to the perk share', () => {
    const w = brokenCab(PERK_NUMBERS.fightThrough.health, ['fightThrough']);
    checkKnockout(w);
    expect(w.player.state).toBe('knockedOut');
  });

  it('knocks out a player without the perk at full health', () => {
    const w = brokenCab(1, []);
    checkKnockout(w);
    expect(w.player.state).toBe('knockedOut');
  });
});

describe('waking', () => {
  it('wakes the next turn when no hostile sees the truck, and patches broken core parts', () => {
    const { w, me } = knockedOut();
    const wheel = coreParts(me, 'wheel')[0];
    wheel.hp = 0;
    const next = endTurn(w, testDrive);
    const truck = next.vehicles[0];
    expect(next.player.state).toBe('active');
    expect(next.events).toContainEqual({ t: 'wake' });
    const patched = (defId: string) => Math.max(1, Math.round(partDef(defId).hp * RULES.defeatPatch));
    expect(corePart(truck, 'cab').hp).toBe(patched('cab'));
    expect(coreParts(truck, 'wheel').find((p) => p.id === wheel.id)!.hp).toBe(patched(wheel.defId));
  });

  it('leaves junk core parts broken on waking', () => {
    const { w, me } = knockedOut();
    const wheel = coreParts(me, 'wheel')[0];
    wheel.hp = 0;
    wheel.wear = CONDITION.maxWear + 1;
    const next = endTurn(w, testDrive);
    expect(next.player.state).toBe('active');
    expect(coreParts(next.vehicles[0], 'wheel').find((p) => p.id === wheel.id)!.hp).toBe(0);
  });

  it('stops with the reason when the cab is junk', () => {
    const { w, me } = knockedOut();
    corePart(me, 'cab').wear = CONDITION.maxWear + 1;
    expect(() => advanceKnockout(w)).toThrow(/junk/);
  });

  it('stays knocked out while the truck that fought it sees it', () => {
    const { w } = knockedOutByRaider(['mg', 'stockEngine']);
    advanceKnockout(w);
    expect(w.player.state).toBe('knockedOut');
    expect(w.player.knockoutTurns).toBe(1);
  });

  it('wakes with a truck in sight that did not fight it, and ends the defeat', () => {
    const { w, me } = knockedOut();
    addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    advanceKnockout(w);
    expect(w.player.state).toBe('active');
    expect(me.defeat).toBeUndefined();
  });

  it('wakes at the turn limit with the raider that fought it idling in sight', () => {
    let { w } = knockedOutByRaider();
    // The turns spawn NPCs, and a spawned scavenger may head for a territory loot spot, which every map has.
    w.salvage = emptyWorld().salvage.filter((stock) => territoryOfStock(stock) !== null);
    let turns = 0;
    while (w.player.state === 'knockedOut') {
      w = endTurn(w, testDrive);
      turns++;
      expect(turns).toBeLessThanOrEqual(RULES.knockoutMaxTurns);
    }
    expect(turns).toBe(RULES.knockoutMaxTurns);
    expect(w.player.state).toBe('active');
  });
});

describe('the loot rule', () => {
  it('a raider ignores a truck without loot but fights on a feud', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    const bare = addVehicle(w, 'traders', 'scout', [], { x: 40, y: 30 });
    expect(isHostile(w, raider, bare)).toBe(false);
    expect(isHostile(w, bare, raider)).toBe(false);
    autoOrders(w, raider);
    expect(Object.values(raider.weaponOrders).map((o) => o.targetId)).not.toContain(bare.id);
    const feud = addState(w, 'feud', bare.id, raider.id, { kind: 'feud', robbery: false });
    expect(isHostile(w, raider, bare)).toBe(true);
    endState(w, feud, 'expired');
    expect(isHostile(w, raider, bare)).toBe(false);
    addState(w, 'feud', raider.id, bare.id, { kind: 'feud', robbery: false });
    expect(isHostile(w, bare, raider)).toBe(true);
  });

  it('a raider is hostile to a truck with loot, and others ignore each other', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 36, y: 30 });
    const trader = addVehicle(w, 'traders', 'scout', ['mg'], { x: 40, y: 30 });
    const bare = addVehicle(w, 'traders', 'scout', [], { x: 44, y: 30 });
    expect(isHostile(w, raider, trader)).toBe(true);
    expect(isHostile(w, trader, raider)).toBe(true);
    expect(isHostile(w, trader, bare)).toBe(false);
  });

  it('a raider that fought the player without a robbery sets out to loot the truck', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    me.lastHitBy = raider.id;
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(raider.brain.goals.at(-1)).toMatchObject({ kind: 'loot', targetId: me.id });
  });

  it('a raider that knocked the player out loots goods straight off the truck', () => {
    const { w: w0, me, raider } = knockedOutByRaider(['mg', 'stockEngine']);
    const before = inventory(w0, me);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('idle', 'scavenge');
    for (const key of Object.keys(NPCS)) w0.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const units = (v: Vehicle) => Object.values(goodsCount(v)).reduce((a, n) => a + n, 0);
    const full = units(me);
    expect(full).toBeGreaterThan(0);
    let w = w0;
    let took = false;
    for (let turn = 0; turn < 20 && !took; turn++) {
      w = endTurn(w, testDrive);
      took = units(w.vehicles[0]) < full;
    }
    expect(took).toBe(true);
    expect(w.salvage).toEqual([]);
    const actor = w.vehicles.find((v) => v.id === raider.id)!;
    const after = inventory(w, w.vehicles[0]);
    const carried = inventory(w, actor);
    for (const [good, n] of Object.entries(before.goods)) expect((after.goods[good] ?? 0) + (carried.goods[good] ?? 0)).toBe(n);
  });
});

describe('commands while knocked out', () => {
  it('reject every player command', () => {
    const { w, me } = knockedOut();
    const commands: (() => unknown)[] = [
      () => setMoveOrder(w, { kind: 'stopAt', dest: { x: 40, y: 30 } }),
      () => setWeaponOrder(w, 'x', null),
      () => setDirect(w, true),
      () => startRepair(w, corePart(me, 'cab').id),
      () => startSearch(w, 'bowl'),
      () => moveItem(w, me.items[0].id, { x: 0, y: 0, rot: 0 }),
      () => dumpItem(w, me.items[0].id),
      () => buyGood(w, 'scrap', 1),
      () => scavenge(w, 'bowl'),
    ];
    for (const command of commands) expect(command).toThrow('Player is knockedOut');
  });

  it('does not start an auto repair', () => {
    let { w } = knockedOutByRaider();
    expect(addGoods(w, w.vehicles[0], 'parts', 1)).toBe(1);
    w.player.autoRepair = true;
    w = endTurn(w, testDrive);
    expect(w.player.state).toBe('knockedOut');
    expect(w.vehicles[0].job).toBeNull();
  });
});

describe('knockout practice', () => {
  it('pays the player for a knockout with a foe in sight', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    refreshVision(w);
    corePart(w.vehicles[0], 'cab').hp = 0;
    checkKnockout(w);
    expect(practiceOf(w, 'knockout')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('pays nothing for a knockout next to a raider that ignores a stripped truck', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => !isLoot(me.chassisId, it));
    addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 });
    refreshVision(w);
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(w.player.state).toBe('knockedOut');
    expect(practiceOf(w, 'knockout')).toEqual([]);
  });

  it('pays nothing for a knockout with nobody around', () => {
    const { w } = knockedOut();
    advanceKnockout(w);
    expect(w.player.state).toBe('active');
    expect(practiceOf(w, 'knockout')).toEqual([]);
  });

  it('pays nothing for an NPC whose cab breaks', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    corePart(npc, 'cab').hp = 0;
    checkKnockout(w);
    advanceKnockout(w);
    expect(practiceOf(w, 'knockout')).toEqual([]);
  });
});


describe('cab knock of the player', () => {
  // A working cab that dropped from half to 5% this turn, with a roll that knocks out.
  function hurtCab(health: number, perks: World['player']['perks']): World {
    const w = emptyWorld({ x: 30, y: 30 });
    w.player.perks = perks;
    w.player.health = health;
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    cab.hp = maxHp(cab) * 0.05;
    const round = { struck: me.id, hits: [{ part: cab.id, damage: maxHp(cab) * 0.45 }], blast: [] };
    w.events.push({ t: 'shot', shooter: 'x', weapon: 'w', target: me.id, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [round] } as never);
    w.rngState = rngStateWhere((roll) => roll < 0.01);
    return w;
  }

  it('spares the player at 75 health or more and draws no RNG', () => {
    const w = hurtCab(80, []);
    const state = w.rngState;
    checkKnockout(w);
    expect(w.player.state).toBe('active');
    expect(w.rngState).toBe(state);
  });

  it('knocks the player out below 75 health, and the knockout is not a give-up', () => {
    const w = hurtCab(60, []);
    checkKnockout(w);
    expect(w.player.state).toBe('knockedOut');
    expect(w.vehicles[0].defeat?.gaveUp).toBe(false);
    expect(w.events).toContainEqual({ t: 'knockout' });
  });

  it('spares a player who fights through', () => {
    const w = hurtCab(maxHealthOf(emptyWorld()) * (PERK_NUMBERS.fightThrough.health + 0.1), ['fightThrough']);
    w.player.health = Math.min(w.player.health, 70);
    const state = w.rngState;
    checkKnockout(w);
    expect(w.player.state).toBe('active');
    expect(w.rngState).toBe(state);
  });
});

describe('gave up', () => {
  it('is true after standDown and false after a knockout', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    standDown(w, npc, w.player.vehicleId);
    expect(gaveUp(npc)).toBe(true);
    npc.defeat!.gaveUp = false;
    expect(gaveUp(npc)).toBe(false);
  });
});
