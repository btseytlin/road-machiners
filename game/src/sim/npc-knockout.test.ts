import { describe, expect, it } from 'vitest';
import { cabKnockChance } from './cab-knock';
import { maxHp } from './wear';
import { RULES } from '../data/rules';
import { autoOrders, isFoe, resolveDestroyed } from './combat';
import { advanceNpcKnockouts, checkKnockout, knockOutNpc, refitAtHome } from './defeat';
import { corePart, coreParts } from './grid';
import { addVehicle, emptyWorld, npcBrain, rngStateWhere } from './testkit';
import type { Vehicle, World } from './types';
import { refreshVision } from './vision';
import { setWeaponOrder } from './world';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { getResources } from './resources';
import { sitePads } from './sites';
import { addState, stateOf } from './states';
import { optionWeights } from './npc-decisions';
import { yieldTo } from './parley';
import { NPC_BEHAVIOR } from '../data/npcs';
import { vehicleStats } from './stats';
import { canTowNpc, npcHomeSite } from './tow';
import { dist } from './vec';

// The player at 30,30 with a machine gun, and a raider buggy beside it that the player hit last.
function beside(): { w: World; me: Vehicle; buggy: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI);
  buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
  buggy.lastHitBy = me.id;
  buggy.brain.attackers[me.id] = true;
  refreshVision(w);
  return { w, me, buggy };
}

function breakCab(w: World, v: Vehicle, dies: boolean): void {
  corePart(v, 'cab').hp = 0;
  w.rngState = rngStateWhere((roll) => (roll < RULES.npcDeathChance) === dies);
  resolveDestroyed(w);
}

function gunOf(v: Vehicle): string {
  const gun = v.items.find((it) => it.kind === 'part' && it.part.defId === 'mg');
  if (gun?.kind !== 'part') throw new Error('Expected a machine gun');
  return gun.part.id;
}

describe('NPC knockout', () => {
  it('keeps the truck and every item in the world, and brakes it', () => {
    const { w, buggy } = beside();
    const items = buggy.items.map((it) => it.id).sort();
    breakCab(w, buggy, false);
    expect(w.vehicles).toContain(buggy);
    expect(buggy.items.map((it) => it.id).sort()).toEqual(items);
    expect(buggy.defeat).toMatchObject({ phase: 'out', turns: 0 });
    expect(buggy.order).toEqual({ kind: 'brake' });
    expect(w.salvage.some((s) => s.id.includes(buggy.id))).toBe(false);
    expect(w.events).toContainEqual({ t: 'npcKnockout', vehicle: buggy.id, by: w.player.vehicleId });
  });

  it('dies into a wreck when the death roll hits', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, true);
    expect(w.vehicles).not.toContain(buggy);
    expect(w.obstacles.some((o) => o.id === `wreck-${buggy.id}`)).toBe(true);
  });

  it('drops every order aimed at it, so auto fire and NPCs leave it alone', () => {
    const { w, me, buggy } = beside();
    me.weaponOrders[gunOf(me)] = { targetId: buggy.id, aim: 'body' };
    breakCab(w, buggy, false);
    expect(me.weaponOrders).toEqual({});
    autoOrders(w, me);
    expect(me.weaponOrders).toEqual({});
    expect(isFoe(w, me, buggy)).toBe(false);
  });

  it('lets the player aim at it by hand', () => {
    const { w, me, buggy } = beside();
    breakCab(w, buggy, false);
    const next = setWeaponOrder(w, gunOf(me), { targetId: buggy.id, aim: 'body' });
    expect(Object.values(next.vehicles[0].weaponOrders)).toEqual([{ targetId: buggy.id, aim: 'body' }]);
  });
});

describe('finishing off', () => {
  function shotAt(w: World, target: Vehicle, damage: number): void {
    const hits = [{ part: corePart(target, 'cab').id, damage }];
    w.events = [{ t: 'shot', shooter: w.player.vehicleId, weapon: 'mg', target: target.id, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [{ hit: true, crit: false, offset: 0, struck: target.id, hits, blast: [] }] }];
  }

  it('turns a knocked-out truck into a wreck when a shot damages it', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    shotAt(w, buggy, 5);
    resolveDestroyed(w);
    expect(w.vehicles).not.toContain(buggy);
    expect(w.events).toContainEqual({ t: 'destroyed', vehicle: buggy.id, by: w.player.vehicleId });
  });

  it('leaves it knocked out after a shot that did no damage', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    shotAt(w, buggy, 0);
    resolveDestroyed(w);
    expect(w.vehicles).toContain(buggy);
  });
});

describe('towing a knocked-out truck', () => {
  it('takes no tow while it lies knocked out, and takes one once awake', () => {
    const { w, buggy } = beside();
    for (const engine of buggy.items) if (engine.kind === 'part' && engine.part.defId === 'stockEngine') engine.part.hp = 0;
    breakCab(w, buggy, false);
    expect(canTowNpc(w, buggy)).toBe(false);
    advanceNpcKnockouts(w);
    buggy.defeat = { ...buggy.defeat!, phase: 'retreat' };
    corePart(buggy, 'cab').hp = 10;
    expect(canTowNpc(w, buggy)).toBe(true);
  });
});

describe('NPC waking', () => {
  it('stays out while the truck that beat it sees it', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    advanceNpcKnockouts(w);
    expect(buggy.defeat).toMatchObject({ phase: 'out', turns: 1 });
  });

  it('wakes once its attackers are gone and patches its broken core parts', () => {
    const { w, me, buggy } = beside();
    breakCab(w, buggy, false);
    coreParts(buggy, 'wheel')[0].hp = 0;
    me.pos = { x: 200, y: 200 };
    refreshVision(w);
    advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('retreat');
    expect(corePart(buggy, 'cab').hp).toBeGreaterThan(0);
    expect(coreParts(buggy, 'wheel')[0].hp).toBeGreaterThan(0);
    expect(w.events).toContainEqual({ t: 'npcWake', vehicle: buggy.id });
  });

  it('wakes at the turn limit with its attacker still watching', () => {
    const { w, buggy } = beside();
    breakCab(w, buggy, false);
    for (let turn = 1; turn < RULES.knockoutMaxTurns; turn++) advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('out');
    advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('retreat');
  });
});

describe('the retreat home', () => {
  // A raider buggy that woke from a knockout far from the player, stripped of its gun.
  function retreating(): { w: World; buggy: Vehicle } {
    const w = emptyWorld();
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 150, y: 150 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    buggy.items = buggy.items.filter((it) => !(it.kind === 'part' && it.part.defId === 'mg'));
    buggy.defeat = { phase: 'retreat', turns: 3, unseen: 0, foes: [], gaveUp: true };
    refreshVision(w);
    return { w, buggy };
  }

  it('heads for its home site and makes no other decision', () => {
    const { w, buggy } = retreating();
    const home = npcHomeSite(buggy)!;
    expect(thinkNpc(w, buggy)).toMatchObject({ kind: 'retreat', targetId: home.id });
  });

  it('appears at a home pad after enough turns beyond the player\'s gray vision, refitted on the same chassis', () => {
    const { w, buggy } = retreating();
    const home = npcHomeSite(buggy)!;
    const money = getResources(w, buggy).money;
    for (let turn = 1; turn < RULES.retreatTeleportTurns; turn++) advanceNpcKnockouts(w);
    expect(buggy.defeat?.unseen).toBe(RULES.retreatTeleportTurns - 1);
    advanceNpcKnockouts(w);
    expect(sitePads(home).some((pad) => dist(pad, buggy.pos) < 0.01)).toBe(true);
    expect(buggy.defeat).toBeUndefined();
    expect(buggy.chassisId).toBe('buggy');
    expect(vehicleStats(w, buggy).weapons.length).toBeGreaterThan(0);
    expect(getResources(w, buggy).money).toBe(money);
  });

  it('never appears at home while the player can see it', () => {
    const { w, buggy } = retreating();
    buggy.pos = { x: 34, y: 30 };
    for (let turn = 0; turn < RULES.retreatTeleportTurns; turn++) advanceNpcKnockouts(w);
    expect(buggy.defeat).toMatchObject({ phase: 'retreat', unseen: 0 });
  });

  it('stays on a tow rope instead of appearing at home', () => {
    const { w, buggy } = retreating();
    const tower = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 152, y: 150 });
    addState(w, 'tow', tower.id, buggy.id, { kind: 'tow', site: npcHomeSite(buggy)!.id, fee: 0, hitched: true, waived: 0 });
    for (let turn = 0; turn < RULES.retreatTeleportTurns; turn++) advanceNpcKnockouts(w);
    expect(buggy.defeat?.phase).toBe('retreat');
    expect(buggy.pos).toEqual({ x: 150, y: 150 });
  });

  it('refits when it drives up to its home pad', () => {
    const { w, buggy } = retreating();
    buggy.pos = { ...sitePads(npcHomeSite(buggy)!)[0] };
    thinkNpc(w, buggy);
    resolveNpcActivities(w);
    expect(buggy.defeat).toBeUndefined();
    expect(topGoal(buggy)?.kind).not.toBe('retreat');
  });
});

describe('revenge', () => {
  function knockOutRolling(w: World, v: Vehicle, grudge: boolean): void {
    corePart(v, 'cab').hp = 0;
    w.rngState = rngStateWhere((roll) => (roll < NPC_BEHAVIOR.revengeChance) === grudge);
    knockOutNpc(w, v);
  }

  it('an NPC the player knocks out may hold a grudge against the player', () => {
    const { w, me, buggy } = beside();
    knockOutRolling(w, buggy, true);
    expect(stateOf(w, 'revenge', buggy.id, me.id)).not.toBeNull();
  });

  it('an NPC knocked out by another truck holds no grudge against the player', () => {
    const { w, me, buggy } = beside();
    buggy.lastHitBy = 'someone-else';
    knockOutRolling(w, buggy, true);
    expect(stateOf(w, 'revenge', buggy.id, me.id)).toBeNull();
  });

  it('raises a raider\'s chance to fight the player', () => {
    const { w, me, buggy } = beside();
    const before = optionWeights(w, buggy, 'hostileSeen', me.id, null).fight!;
    addState(w, 'revenge', buggy.id, me.id, { kind: 'none' });
    expect(optionWeights(w, buggy, 'hostileSeen', me.id, null).fight).toBeGreaterThan(before);
  });

  it('raises a trader\'s chance to rob the player', () => {
    const { w, me } = beside();
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 30, y: 34 });
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    refreshVision(w);
    const before = optionWeights(w, trader, 'preySeen', me.id, null).rob!;
    addState(w, 'revenge', trader.id, me.id, { kind: 'none' });
    expect(optionWeights(w, trader, 'preySeen', me.id, null).rob).toBeGreaterThan(before);
  });

  it('ends once the holder knocks the player out', () => {
    const { w, me, buggy } = beside();
    addState(w, 'revenge', buggy.id, me.id, { kind: 'none' });
    me.lastHitBy = buggy.id;
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(stateOf(w, 'revenge', buggy.id, me.id)).toBeNull();
    expect(w.events.some((e) => e.t === 'stateEnded' && e.state.kind === 'revenge' && e.ending === 'fulfilled')).toBe(true);
  });

  it('ends once the player hands the holder its cargo', () => {
    const { w, me, buggy } = beside();
    addState(w, 'revenge', buggy.id, me.id, { kind: 'none' });
    yieldTo(w, me, buggy);
    expect(stateOf(w, 'revenge', buggy.id, me.id)).toBeNull();
  });

  it('outlasts a defeat and the refit at home', () => {
    const { w, me, buggy } = beside();
    knockOutRolling(w, buggy, true);
    refitAtHome(w, buggy);
    expect(stateOf(w, 'revenge', buggy.id, me.id)).not.toBeNull();
  });
});

// The cab drops from half to 5% this turn by one hit, and the next world roll is `roll`-ish.
function cabHitFromHalf(w: World, v: Vehicle, roll: (r: number) => boolean): void {
  const cab = corePart(v, 'cab');
  cab.hp = maxHp(cab) * 0.05;
  const damage = maxHp(cab) * 0.45;
  const round = { struck: v.id, hits: [{ part: cab.id, damage }], blast: [] };
  w.events.push({ t: 'shot', shooter: w.player.vehicleId, weapon: 'w', target: v.id, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [round] } as never);
  w.rngState = rngStateWhere(roll);
}

describe('cab knock', () => {
  it('knocks an NPC out with a working cab, never into a wreck, even on a low roll', () => {
    const { w, buggy } = beside();
    cabHitFromHalf(w, buggy, (roll) => roll < RULES.npcDeathChance);
    resolveDestroyed(w);
    expect(w.vehicles).toContain(buggy);
    expect(corePart(buggy, 'cab').hp).toBeGreaterThan(0);
    expect(buggy.defeat).toMatchObject({ phase: 'out', gaveUp: false });
    expect(w.events).toContainEqual({ t: 'npcKnockout', vehicle: buggy.id, by: w.player.vehicleId });
  });

  it('keeps an NPC active when the roll fails', () => {
    const { w, buggy } = beside();
    const miss = cabKnockChance(0.5, 0.05, RULES.cabKnock);
    cabHitFromHalf(w, buggy, (roll) => roll >= miss);
    resolveDestroyed(w);
    expect(buggy.defeat).toBeUndefined();
  });
});

describe('winners strip the trucks they knock out', () => {
  function duel(): { w: World; winner: Vehicle; loser: Vehicle } {
    const w = emptyWorld({ x: 200, y: 200 });
    const winner = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 });
    winner.brain = npcBrain('buggy', winner.pos, ['raider']);
    const loser = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    loser.brain = npcBrain('trader', loser.pos, ['trader']);
    loser.lastHitBy = winner.id;
    loser.brain.attackers[winner.id] = true;
    return { w, winner, loser };
  }

  it('sends a raider that knocked out another driver to loot the truck', () => {
    const { w, winner, loser } = duel();

    knockOutNpc(w, loser);

    expect(topGoal(winner)).toMatchObject({ kind: 'loot', targetId: loser.id });
  });

  it('leaves a hurt raider out of the looting', () => {
    const { w, winner, loser } = duel();
    corePart(winner, 'cab').hp = 1;

    knockOutNpc(w, loser);

    expect(topGoal(winner)?.kind).not.toBe('loot');
  });
});
