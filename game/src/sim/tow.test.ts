import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { BEACON, TOW } from '../data/tow';
import { MAX_RANK, SKILL_EFFECTS, XP_SOURCES } from '../data/skills';
import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { route, routeLength } from './path';
import { canUseSite, nearestPad, siteGates, sitePads, type Site } from './sites';
import { getResources } from './resources';
import { fuelCap, isStranded, vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateWhere, testDrive , startCombat } from './testkit';
import { hasLoot, mountedParts } from './grid';
import { CONDITION } from '../data/wear';
import { resolveNpcActivities, startTow, thinkNpc, topGoal } from './npc-activities';
import { optionChances, optionWeights, usefulContacts } from './npc-decisions';
import { addState, endState, stateOf, towData } from './states';
import { callVehicle, chooseOption, currentOptions, endCallIfOut, hangUp } from './dialogue';
import { dropTow, isOnRope, runTow, isTowed, playerTow, playerTowing, setBeacon, steerToStranded, towOf, unhitch } from './tow';
import { sunAt } from './sun';
import { canVehicleSee, refreshVision } from './vision';
import type { GameEvent, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { autoRuns, cloneWorld, endTurn, setDirect, setMoveOrder } from './world';

type Setup = { w: World; trader: Vehicle };

function withTower(w: World, templateId: string, faction: Vehicle['faction'], chassis: string, pos: Vec): Vehicle {
  const v = addVehicle(w, faction, chassis, ['stockEngine'], pos, Math.PI);
  v.brain = npcBrain(templateId, pos, NPCS[templateId].traits);
  return v;
}

const FAR: Vec = { x: 80, y: 200 };
const MID_NEAR: Vec = { x: 80, y: 420 };
const MID_FAR: Vec = { x: 80, y: 330 };

function stranded(playerPos: Vec = { x: 30, y: 30 }, traderPos: Vec = { x: 40, y: 30 }): Setup {
  const w = emptyWorld(playerPos);
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  w.player.fuel = 0;
  const trader = withTower(w, 'trader', 'traders', 'hauler', traderPos);
  return { w, trader };
}

function endLieUp(w: World, npc: Vehicle): void {
  const goal = topGoal(npc);
  expect(goal?.kind).toBe('rearm');
  w.turn = goal!.until!;
  thinkNpc(w, npc);
  resolveNpcActivities(w);
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; turns: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 1; i <= max; i++) {
    w = endTurn(w, testDrive);
    events.push(...w.events);
    if (done(w)) return { w, turns: i, events };
  }
  return { w, turns: max, events };
}

const onlyCore = (v: Vehicle) => { v.items = v.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core'); };
const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;
const feeOf = (w: World) => towData(playerTow(w)!).fee;

function offered(s: Setup, topic: 'tow' | 'towFree' = 'tow'): World {
  const r = runUntil(s.w, 30, (w) => playerTow(w) !== null);
  expect(playerTow(r.w)).not.toBeNull();
  expect(r.w.player.call).toMatchObject({ with: playerTow(r.w)!.holder, topic });
  return r.w;
}

function answer(w: World, text: string): World {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return chooseOption(w, i);
}

const acceptTow = (w: World) => answer(w, 'Deal. Hitch me up.');
const refuseTow = (w: World) => answer(w, 'No thanks.');

describe('tow offer', () => {
  it('a tow call ends when the offer is dropped later in the same turn, so no answer throws', () => {
    const w = offered(stranded());
    const tow = playerTow(w)!;
    dropTow(w, tow, 'danger');
    w.events = [];

    endCallIfOut(w);

    expect(w.player.call).toBeNull();
    expect(w.events).toContainEqual({ t: 'call', with: tow.holder, outcome: 'ended' });
  });

  it('a trader that sees a stranded player drives over and offers a tow', () => {
    const s = stranded();
    const r = runUntil(s.w, 30, (w) => playerTow(w) !== null);
    expect(playerTow(r.w)).toMatchObject({ kind: 'tow', holder: s.trader.id, other: r.w.player.vehicleId, data: { kind: 'tow', site: 'bowl', fee: expect.any(Number), waived: 0, hitched: false } });
    expect(feeOf(r.w)).toBeGreaterThan(TOW.base);
    expect(r.events.filter((e) => e.t === 'towOffer')).toEqual([{ t: 'towOffer', by: s.trader.id, town: 'bowl', fee: feeOf(r.w) }]);
    const trader = find(r.w, s.trader.id);
    expect(dist(trader.pos, playerVehicle(r.w).pos)).toBeLessThan(10 - 1);
    expect(topGoal(trader)?.kind).toBe('tow');
  });

  it('prices the tow by the route length to the nearest pad of the town', () => {
    const s = stranded();
    const w = offered(s);
    const me = playerVehicle(w);
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const pad = sitePads(town).reduce((a, b) => (dist(me.pos, a) <= dist(me.pos, b) ? a : b));
    const length = routeLength(me.pos, route(w, me.pos, pad, vehicleStats(w, find(w, s.trader.id)).radius, []));
    expect(feeOf(w)).toBe(Math.round(Math.min(TOW.maxFee, TOW.base + TOW.perTile * length)));
  });

  it('caps a long tow at TOW.maxFee', () => {
    const w = offered(stranded(FAR, { x: FAR.x + 10, y: FAR.y }));
    expect(feeOf(w)).toBe(Math.round(TOW.maxFee));
  });

  it('a longer tow costs more below the cap', () => {
    const near = feeOf(offered(stranded(MID_NEAR, { x: MID_NEAR.x + 10, y: MID_NEAR.y })));
    const mid = feeOf(offered(stranded(MID_FAR, { x: MID_FAR.x + 10, y: MID_FAR.y })));
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(Math.round(TOW.maxFee));
  });

  it('refusing stops that NPC from offering again while the player stays in sight', () => {
    const s = stranded();
    let w = refuseTow(offered(s));
    expect(playerTow(w)).toBeNull();
    expect(stateOf(w, 'turnedDown', s.trader.id, w.player.vehicleId)).not.toBeNull();
    const r = runUntil(w, 15, (x) => playerTow(x) !== null);
    w = r.w;
    expect(playerTow(w)).toBeNull();
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('hanging up on the offer counts as refusing', () => {
    const s = stranded();
    const w = hangUp(offered(s));
    expect(playerTow(w)).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, client: w.player.vehicleId, reason: 'refused' });
    expect(stateOf(w, 'turnedDown', s.trader.id, w.player.vehicleId)).not.toBeNull();
    const later = runUntil(w, 15, (x) => playerTow(x) !== null);
    expect(later.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  function startFight(w: World): string {
    const foe = addVehicle(w, 'traders', 'scout', [], { x: 24, y: 30 });
    addState(w, 'feud', w.player.vehicleId, foe.id, { kind: 'feud', robbery: false });
    startCombat(w, playerVehicle(w), foe);
    return foe.id;
  }

  function endFight(w: World, foeId: string): World {
    endState(w, stateOf(w, 'feud', w.player.vehicleId, foeId)!, 'broken');
    for (const c of w.states.filter((x) => x.kind === 'combat')) endState(w, c, 'broken');
    return w;
  }

  it('no driver sets out to tow a player in combat, and one comes once the fight ends', () => {
    forceOption('strandedSeen', 'tow');
    const s = stranded();
    const foe = startFight(s.w);
    const w = endTurn(s.w, testDrive);
    expect(topGoal(find(w, s.trader.id))?.kind).not.toBe('tow');
    offered({ w: endFight(w, foe), trader: s.trader });
  });

  it('a hostile that only passes by does not hold back a tow offer to the player', () => {
    forceOption('strandedSeen', 'tow');
    forceOption('hostileSeen', 'keep');
    const s = stranded();
    addVehicle(s.w, 'raiders', 'buggy', [], { x: 24, y: 30 });
    offered(s);
  });

  it('a tower already on its way waits beside a player in combat and offers once the fight ends', () => {
    forceOption('strandedSeen', 'tow');
    const s = stranded();
    const setOut = runUntil(s.w, 30, (w) => topGoal(find(w, s.trader.id))?.kind === 'tow');
    const foe = startFight(setOut.w);
    const r = runUntil(setOut.w, 30, (w) => {
      startCombat(w, find(w, foe), playerVehicle(w));
      return playerTow(w) !== null || w.player.call !== null;
    });
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
    expect(r.w.player.call).toBeNull();
    expect(topGoal(find(r.w, s.trader.id))?.kind).toBe('tow');
    expect(dist(find(r.w, s.trader.id).pos, playerVehicle(r.w).pos)).toBeLessThan(10 - 1);
    offered({ w: endFight(r.w, foe), trader: s.trader });
  });

  it('a stranded player can ask a passing trader, which comes over and offers', () => {
    const s = stranded({ x: 30, y: 30 }, { x: 44, y: 30 });
    forceOption('strandedSeen', 'keep');
    let w = endTurn(s.w, testDrive);
    expect(topGoal(find(w, s.trader.id))?.kind).not.toBe('tow');
    w = callVehicle(w, s.trader.id);
    w = answer(w, 'I am stranded. Can you tow me?');
    w = answer(w, 'Thanks. I will wait.');
    expect(topGoal(find(w, s.trader.id))?.kind).toBe('tow');
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    expect(r.w.player.call).toMatchObject({ with: s.trader.id, topic: 'tow' });
  });

  it('a driver that cannot tow is not asked', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    const w = callVehicle(s.w, s.trader.id);
    expect(currentOptions(w).map((o) => o.text)).not.toContain('I am stranded. Can you tow me?');
  });

  it('raiders never tow', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    const me = w.vehicles[0];
    me.items = me.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core');
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 40, y: 30 });
    const r = runUntil(w, 20, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === raider.id && e.activity === 'tow')).toBe(false);
  });

  it('a player stranded on the pad of the town a tow would go to gets no offer', () => {
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const pad = sitePads(town)[0];
    const out = { x: (pad.x - town.pos.x) / dist(pad, town.pos), y: (pad.y - town.pos.y) / dist(pad, town.pos) };
    const s = stranded(pad, { x: pad.x + out.x * 12, y: pad.y + out.y * 12 });
    expect(canUseSite(pad, town)).toBe(true);
    for (const id of Object.keys(NPCS)) s.w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('idle', 'wait');
    forceOption('strandedSeen', 'tow');
    const r = runUntil(s.w, 20, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === s.trader.id && e.activity === 'tow')).toBe(false);
  });

  it('a scavenger offers a tow too', () => {
    const w = emptyWorld();
    w.player.fuel = 0;
    const scav = withTower(w, 'scavenger', 'scavengers', 'scout', { x: 40, y: 30 });
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(scav.id);
  });

  it('a player who can drive gets no offer', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    const r = runUntil(s.w, 15, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
  });
});

describe('towing', () => {
  it('accepting hitches the player, and the player follows the tower', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    expect(isTowed(w)).toBe(true);
    expect(playerVehicle(w).order).toBeNull();
    expect(playerVehicle(w).speed).toBe(0);
    expect(autoRuns(w)).toBe(true);
    const start = { ...playerVehicle(w).pos };
    for (let i = 0; i < 12; i++) {
      w = endTurn(w, testDrive);
      const me = playerVehicle(w);
      const tower = find(w, s.trader.id);
      expect(dist(me.pos, tower.pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
      expect(me.speed).toBe(tower.speed);
      expect(me.trail).toHaveLength(tower.trail.length);
      expect(me.trail[me.trail.length - 1]).toEqual({ x: me.pos.x, y: me.pos.y, heading: me.heading });
    }
    const me = playerVehicle(w);
    const tower = find(w, s.trader.id);
    expect(dist(me.pos, start)).toBeGreaterThan(10);
    expect(dist(me.pos, tower.pos)).toBeGreaterThan(TOW.gap * 0.9);
    const free = structuredClone(w);
    free.states = [];
    expect(vehicleStats(w, tower).maxSpeed).toBeCloseTo(vehicleStats(free, find(free, s.trader.id)).maxSpeed * TOW.speedShare);
    expect(w.player.fuel).toBe(0);
  });

  it('commands other than unhitch throw while hitched', () => {
    const w = acceptTow(offered(stranded()));
    expect(() => setMoveOrder(w, { kind: 'stopAt', dest: { x: 0, y: 0 } })).toThrow(/towed/);
    expect(() => setDirect(w, true)).toThrow(/towed/);
    expect(() => acceptTow(w)).toThrow(/No call/);
    expect(() => unhitch(w)).not.toThrow();
  });

  it('unhitch needs a hitch', () => {
    expect(() => unhitch(stranded().w)).toThrow(/not towed/);
  });

  it('unhitching is free and ends the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    for (let i = 0; i < 4; i++) w = endTurn(w, testDrive);
    const money = w.player.money;
    w = unhitch(w);
    expect(playerTow(w)).toBeNull();
    expect(w.player.money).toBe(money);
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, client: w.player.vehicleId, reason: 'unhitched' });
    expect(autoRuns(w)).toBe(false);
    expect(() => setMoveOrder(w, { kind: 'stopAt', dest: { x: 0, y: 0 } })).not.toThrow();
    const r = runUntil(w, 10, (x) => playerTow(x) !== null);
    expect(r.w.player.money).toBe(money);
    expect(find(r.w, s.trader.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
    expect(r.events.some((e) => e.t === 'towOffer')).toBe(false);
  });

  it('a tower that enters danger drops the tow for free', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w, testDrive);
    const money = w.player.money;
    const tower = find(w, s.trader.id);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: tower.pos.x + 8, y: tower.pos.y });
    forceOption('hostileSeen', 'flee');
    w = endTurn(w, testDrive);
    expect(playerTow(w)).toBeNull();
    expect(w.player.money).toBe(money);
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, client: w.player.vehicleId, reason: 'danger' });
    expect(topGoal(find(w, s.trader.id))?.kind).toBe('flee');
  });

  it('a tower keeps its tow when it only hears a hostile beyond sight', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w, testDrive);
    const tower = find(w, s.trader.id);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: tower.pos.x + 8, y: tower.pos.y });
    raider.speed = 8;
    for (let d = 20; d <= 120; d += 2) {
      raider.pos = { x: tower.pos.x + d, y: tower.pos.y };
      refreshVision(w);
      if (usefulContacts(w, tower).length > 0 && !canVehicleSee(w, tower, raider.pos)) break;
    }
    expect(usefulContacts(w, tower).map((c) => c.vehicleId)).toEqual([raider.id]);
    expect(canVehicleSee(w, tower, raider.pos)).toBe(false);
    forceOption('contactHeard', 'flee');
    w.events = [];
    thinkNpc(w, tower);
    expect(playerTow(w)).not.toBeNull();
    expect(topGoal(tower)?.kind).toBe('tow');
    expect(w.events.some((e) => e.t === 'towDropped')).toBe(false);
    expect(tower.brain!.goals.some((g) => g.kind === 'flee')).toBe(false);
  });

  it('a tower that can no longer drive drops the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w, testDrive);
    expect(isOnRope(w, w.player.vehicleId)).toBe(true);
    const money = w.player.money;
    const traderMoney = getResources(w, find(w, s.trader.id)).money;
    find(w, s.trader.id).resources!.fuel = 0;
    w = endTurn(w, testDrive);
    expect(playerTow(w)).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, client: w.player.vehicleId, reason: 'stranded' });
    expect(isOnRope(w, w.player.vehicleId)).toBe(false);
    expect(w.player.money).toBe(money);
    expect(getResources(w, find(w, s.trader.id)).money).toBe(traderMoney);
    expect(w.states.filter((x) => ['tow', 'towPromise', 'answering'].includes(x.kind))).toEqual([]);
    expect(find(w, s.trader.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('a tower that is destroyed drops the tow', () => {
    const s = stranded();
    let w = acceptTow(offered(s));
    w = endTurn(w, testDrive);
    const tower = find(w, s.trader.id);
    tower.resources!.health = 0;
    w = endTurn(w, testDrive);
    expect(playerTow(w)).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: s.trader.id, client: w.player.vehicleId, reason: 'gone' });
  });

  it('arrival in town charges the fee once and allows debt', () => {
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(town)[0];
    const out = { x: (gate.x - town.pos.x) / town.radius, y: (gate.y - town.pos.y) / town.radius };
    const at = (d: number) => ({ x: gate.x + out.x * d, y: gate.y + out.y * d });
    const s = stranded(at(20), at(30));
    forceOption('strandedSeen', 'tow');
    for (const id of Object.keys(NPCS)) s.w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('idle', 'wait');
    forceOption('strandedSeen', 'tow');
    let w = offered(s);
    const fee = feeOf(w);
    w.player.money = 333;
    const traderMoney = find(w, s.trader.id).resources!.money;
    w = acceptTow(w);
    const r = runUntil(w, 120, (x) => playerTow(x) === null);
    w = r.w;
    expect(r.events.filter((e) => e.t === 'towDone')).toEqual([{ t: 'towDone', by: s.trader.id, client: w.player.vehicleId, fee }]);
    expect(r.events.filter((e) => e.t === 'stateEnded').map((e) => e.t === 'stateEnded' && e.ending)).toEqual(['fulfilled']);
    expect(w.player.money).toBe(333 - fee);
    expect(w.player.money).toBeLessThan(0);
    expect(find(w, s.trader.id).resources!.money).toBe(traderMoney + fee);
    expect(canUseSite(find(w, s.trader.id).pos, town)).toBe(true);
    const me = playerVehicle(w);
    expect(me.speed).toBe(0);
    expect(dist(me.pos, find(w, s.trader.id).pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
    const pad = nearestPad(town, me.pos);
    const outward = Math.atan2(pad.y - town.pos.y, pad.x - town.pos.x);
    const along = (me.pos.x - pad.x) * Math.cos(outward) + (me.pos.y - pad.y) * Math.sin(outward);
    expect(Math.abs(along)).toBeLessThan(REGION.sites.pad.length / 2 - 0.5);
    expect(autoRuns(w)).toBe(false);
    const after = runUntil(w, 5, () => false);
    expect(after.events.some((e) => e.t === 'towDone')).toBe(false);
    expect(after.w.player.money).toBe(333 - fee);
  });
});

describe('answering a stranded truck', () => {
  const answering = (w: World) => w.states.filter((st) => st.kind === 'answering');

  function crowd(): { w: World; towers: Vehicle[] } {
    const w = emptyWorld({ x: 30, y: 30 });
    w.player.fuel = 0;
    const towers = [0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2;
      const tpl = k % 2 ? 'trader' : 'scavenger';
      return withTower(w, tpl, tpl === 'trader' ? 'traders' : 'scavengers', 'hauler', { x: 30 + Math.cos(a) * 12, y: 30 + Math.sin(a) * 12 });
    });
    return { w, towers };
  }

  it('only one of five towers in sight takes the tow goal, and the rest keep their work', () => {
    const { w, towers } = crowd();
    forceOption('strandedSeen', 'tow');
    const next = endTurn(w, testDrive);
    const tows = towers.filter((t) => topGoal(find(next, t.id))?.kind === 'tow');
    expect(tows).toHaveLength(1);
    expect(answering(next)).toMatchObject([{ holder: tows[0].id, other: next.player.vehicleId }]);
    for (const t of towers) if (t !== tows[0]) expect(find(next, t.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('a driver with a tow goal drops it once another driver holds the claim', () => {
    const { w, towers } = crowd();
    const [first, second] = towers;
    forceOption('strandedSeen', 'tow');
    thinkNpc(w, find(w, second.id));
    expect(topGoal(find(w, second.id))?.kind).toBe('tow');
    addState(w, 'answering', first.id, w.player.vehicleId, { kind: 'none' });
    w.turn++;
    thinkNpc(w, find(w, second.id));
    expect(find(w, second.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('after the claimed tower gives up, another tower answers on a later decision', () => {
    const { w, towers } = crowd();
    forceOption('strandedSeen', 'tow');
    let next = endTurn(w, testDrive);
    const [claim] = answering(next);
    const holder = find(next, claim.holder);
    holder.brain!.goals = holder.brain!.goals.filter((g) => g.kind !== 'tow');
    next = runUntil(next, 3, (x) => answering(x).some((st) => st.holder !== claim.holder)).w;
    const [again] = answering(next);
    expect(again.holder).not.toBe(claim.holder);
    expect(towers.map((t) => t.id)).toContain(again.holder);
    expect(topGoal(find(next, again.holder))?.kind).toBe('tow');
  });

  function blocked(): { w: World; tower: Vehicle } {
    const { w, trader } = stranded();
    const client = find(w, w.player.vehicleId);
    startTow(w, trader, client, { ...client.pos });
    return { w, tower: trader };
  }
  const pin = (w: World, at: Vec, id: string): World => {
    const next = endTurn(w, testDrive);
    find(next, id).pos = { ...at };
    find(next, id).speed = 0;
    return next;
  };
  const claimOf = (w: World, holder: string) => w.states.find((st) => st.kind === 'answering' && st.holder === holder);

  it('a tower that cannot get through gives up 20 turns after it has its client in sight, and drops its goal', () => {
    const { tower, w: start } = blocked();
    let w = start;
    const at = { ...find(w, tower.id).pos };
    const events: GameEvent[] = [];
    for (let i = 1; i <= 19; i++) w = pin(w, at, tower.id);
    expect(claimOf(w, tower.id)).toBeDefined();
    for (let i = 0; i < 3; i++) {
      w = pin(w, at, tower.id);
      events.push(...w.events);
    }
    expect(claimOf(w, tower.id)).toBeUndefined();
    expect(events.find((e) => e.t === 'towDropped')).toMatchObject({ by: tower.id, reason: 'blocked' });
    expect(find(w, tower.id).brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('after the claim lapses, another tower can claim the client and the lapsed one does not at once', () => {
    const { w: start, tower } = blocked();
    let w = start;
    const at = { ...find(w, tower.id).pos };
    const other = withTower(w, 'trader', 'traders', 'hauler', { x: 30, y: 42 });
    for (let i = 0; i < 30 && claimOf(w, tower.id); i++) w = pin(w, at, tower.id);
    expect(claimOf(w, tower.id)).toBeUndefined();
    find(w, other.id).pos = { x: 30, y: 42 };
    refreshVision(w);
    forceOption('strandedSeen', 'tow');
    w.turn++;
    thinkNpc(w, find(w, other.id));
    expect(claimOf(w, other.id)).toBeDefined();
    forceOption('strandedSeen', 'tow');
    w.turn++;
    thinkNpc(w, find(w, tower.id));
    expect(claimOf(w, tower.id)).toBeUndefined();
  });

  it('the claim clock holds while the client is in combat or out of sight', () => {
    const { w: start, tower } = blocked();
    let w = start;
    const at = { ...find(w, tower.id).pos };
    const foe = withTower(w, 'scavenger', 'scavengers', 'hauler', { x: 30, y: 12 });
    const me = w.player.vehicleId;
    for (let i = 0; i < 30; i++) {
      w = pin(w, at, tower.id);
      if (!stateOf(w, 'feud', foe.id, me)) addState(w, 'feud', foe.id, me, { kind: 'feud', robbery: false });
      if (!stateOf(w, 'combat', foe.id, me)) startCombat(w, foe, find(w, me));
    }
    expect(claimOf(w, tower.id)).toBeDefined();
  });

  it('the claim clock holds while the tower cannot see its client, as on a beacon answer', () => {
    const { w: start, tower } = blocked();
    let w = start;
    w.player.beacon = true;
    const me = find(w, w.player.vehicleId).pos;
    const far = { x: me.x + 40, y: me.y };
    for (let i = 0; i < 30; i++) w = pin(w, far, tower.id);
    expect(claimOf(w, tower.id)).toBeDefined();
  });

  it('a tower that reaches its client on the turn its claim lapses ends the job without hitching', () => {
    const s = stranded();
    const client = find(s.w, s.w.player.vehicleId);
    startTow(s.w, s.trader, client, { ...client.pos });
    endState(s.w, claimOf(s.w, s.trader.id)!, 'expired');
    s.trader.pos = { x: client.pos.x + 4, y: client.pos.y };
    const goal = topGoal(s.trader)!;
    expect(runTow(s.w, s.trader, goal)).toBe('could not get through to the truck');
    expect(playerTow(s.w)).toBeNull();
  });

  it('a hitched tow never lapses on a timer', () => {
    const s = stranded();
    const w = acceptTow(offered(s));
    const r = runUntil(w, 30, (x) => playerTow(x) === null);
    expect(r.events.some((e) => e.t === 'towDropped' && e.reason === 'blocked')).toBe(false);
  });

  it('a truck at a town gate gets the tow chosen far less often than 40 tiles out, and still above 0', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(bowl)[0];
    const out = { x: (gate.x - bowl.pos.x) / bowl.radius, y: (gate.y - bowl.pos.y) / bowl.radius };
    const towChance = (away: number) => {
      const at = { x: gate.x + out.x * away, y: gate.y + out.y * away };
      const s = stranded(at, { x: at.x + out.x * 8, y: at.y + out.y * 8 });
      return optionChances(optionWeights(s.w, s.trader, 'strandedSeen', s.w.player.vehicleId, null)).tow!;
    };
    const atGate = towChance(0);
    const farOut = towChance(40);
    expect(atGate).toBeGreaterThan(0);
    expect(atGate).toBeLessThan(farOut / 3);
  });
});

describe('tow deals', () => {
  it('a trader that is crawling itself does not offer a tow', () => {
    const s = stranded();
    getResources(s.w, s.trader).fuel = 0;
    forceOption('strandedSeen', 'tow');
    const r = runUntil(s.w, 15, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)).toBeNull();
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === s.trader.id && e.activity === 'tow')).toBe(false);
  });

  it('a tower that dropped the tow for danger offers the same deal again', () => {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    let w = acceptTow(offered(s));
    const deal = { holder: playerTow(w)!.holder, ...towData(playerTow(w)!) };
    for (let i = 0; i < 5; i++) w = endTurn(w, testDrive);
    expect(isTowed(w)).toBe(true);
    dropTow(w, playerTow(w)!, 'danger');
    expect(stateOf(w, 'towPromise', deal.holder, w.player.vehicleId)).not.toBeNull();
    w.rngState = rngStateWhere((roll) => roll > 0.4 && roll < 0.6);
    thinkNpc(w, find(w, deal.holder));
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    const again = playerTow(r.w)!;
    expect(again.holder).toBe(deal.holder);
    expect(towData(again)).toEqual({ kind: 'tow', site: deal.site, fee: deal.fee, waived: 0, hitched: false });
    expect(stateOf(r.w, 'towPromise', deal.holder, r.w.player.vehicleId)).toBeNull();
  });

  it('a tower that dropped the tow for danger waits before it offers again', () => {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    let w = acceptTow(offered(s));
    for (let i = 0; i < 5; i++) w = endTurn(w, testDrive);
    const holder = playerTow(w)!.holder;
    dropTow(w, playerTow(w)!, 'danger');
    w.rngState = rngStateWhere((roll) => roll > 0.4 && roll < 0.6);
    thinkNpc(w, find(w, holder));

    const wait = TOW.dangerWait;
    TOW.dangerWait = 200;
    try {
      expect(playerTow(runUntil(w, 30, (x) => playerTow(x) !== null).w)).toBeNull();
    } finally {
      TOW.dangerWait = wait;
    }
  });

  it('a tower forgets its promise once the player drives again', () => {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    let w = acceptTow(offered(s));
    const tower = playerTow(w)!.holder;
    dropTow(w, playerTow(w)!, 'danger');
    w.player.fuel = 30;

    w = endTurn(w, testDrive);

    expect(isStranded(w, playerVehicle(w))).toBe(false);
    expect(stateOf(w, 'towPromise', tower, w.player.vehicleId)).toBeNull();
  });
});

describe('free tow for a broke player', () => {
  const broke = (money: number): Setup => {
    const s = stranded();
    s.w.player.money = money;
    forceOption('strandedSeen', 'tow');
    return s;
  };

  it('offers a free tow to a player with no money, and arrival takes nothing', () => {
    const s = broke(0);
    let w = offered(s, 'towFree');
    expect(feeOf(w)).toBe(0);
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'towOffer', fee: 0 }));
    expect(w.events.some((e) => e.t === 'say' && /No charge/.test(e.text))).toBe(true);
    const traderMoney = getResources(w, find(w, s.trader.id)).money;
    w = acceptTow(w);
    const r = runUntil(w, 150, (x) => playerTow(x) === null);
    expect(r.events.filter((e) => e.t === 'towDone')).toEqual([{ t: 'towDone', by: s.trader.id, client: r.w.player.vehicleId, fee: 0 }]);
    expect(r.w.player.money).toBe(0);
    expect(getResources(r.w, find(r.w, s.trader.id)).money).toBe(traderMoney);
  });

  it('offers a player in debt a free tow', () => {
    const w = offered(broke(-1667), 'towFree');
    expect(feeOf(w)).toBe(0);
    expect(w.player.money).toBe(-1667);
  });

  it('charges a funded player the route fee under the tow topic', () => {
    const w = offered(broke(16667));
    expect(feeOf(w)).toBeGreaterThan(0);
  });

  it('keeps a free tow free when it is dropped for danger and offered again', () => {
    const s = broke(0);
    let w = acceptTow(offered(s, 'towFree'));
    for (let i = 0; i < 3; i++) w = endTurn(w, testDrive);
    dropTow(w, playerTow(w)!, 'danger');
    w.player.money = 16667;
    w.rngState = rngStateWhere((roll) => roll > 0.4 && roll < 0.6);
    thinkNpc(w, find(w, s.trader.id));
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    expect(towData(playerTow(r.w)!).fee).toBe(0);
  });

  it('gives a paid promise free to a player who is broke when it is offered again', () => {
    const s = broke(16667);
    let w = acceptTow(offered(s));
    for (let i = 0; i < 3; i++) w = endTurn(w, testDrive);
    dropTow(w, playerTow(w)!, 'danger');
    expect(stateOf(w, 'towPromise', s.trader.id, w.player.vehicleId)).not.toBeNull();
    w.player.money = 0;
    w.rngState = rngStateWhere((roll) => roll > 0.4 && roll < 0.6);
    thinkNpc(w, find(w, s.trader.id));
    const r = runUntil(w, 30, (x) => playerTow(x) !== null);
    expect(towData(playerTow(r.w)!).fee).toBe(0);
  });

  it('never names a paid fee of 0, even at the top social rank', () => {
    expect(TOW.base * (1 - SKILL_EFFECTS.social.towFee * MAX_RANK)).toBeGreaterThan(1);
  });
});

describe('emergency beacon', () => {
  const player = { x: 30, y: 30 };
  const activitiesOf = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'activity' && e.vehicle === id);

  it('a tower re-aims at a player who crawled off at night, then reaches and offers', () => {
    const s = stranded(player, { x: 90, y: 30 });
    let w = s.w;
    while (sunAt(w.turn + 1)) w.turn++;
    w = runUntil(setBeacon(w, true), 5, (x) => topGoal(find(x, s.trader.id))?.kind === 'tow').w;
    expect(topGoal(find(w, s.trader.id))?.kind).toBe('tow');
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 30, y: 44 } });
    const r = runUntil(w, 60, (x) => playerTow(x) !== null);
    expect(sunAt(r.w.turn)).toBeNull();
    expect(playerVehicle(r.w).pos.y).toBeGreaterThan(40);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
  });

  it('a tower beyond sight heads for the newest beacon circle', () => {
    const s = stranded(player, { x: 90, y: 30 });
    let w = runUntil(setBeacon(s.w, true), 5, (x) => topGoal(find(x, s.trader.id))?.kind === 'tow').w;
    playerVehicle(w).pos = { x: 30, y: 60 };
    w = endTurn(w, testDrive);
    const trader = find(w, s.trader.id);
    expect(canVehicleSee(w, trader, playerVehicle(w).pos)).toBe(false);
    expect(dist(topGoal(trader)!.destination!, playerVehicle(w).pos)).toBeLessThanOrEqual(BEACON.radius);
  });

  it('a tower that set out for a beacon does not roll to rob its client on arrival', () => {
    const s = stranded(player, { x: 130, y: 30 });
    const w = setBeacon(s.w, true);
    const trader = find(w, s.trader.id);
    trader.brain!.traits = ['trader', 'scumbag'];
    expect(hasLoot(playerVehicle(w))).toBe(true);
    forceOption('strandedSeen', 'tow');
    forceOption('preySeen', 'rob');
    thinkNpc(w, trader);
    expect(topGoal(trader)?.kind).toBe('tow');
    trader.pos = { x: 40, y: 30 };
    w.turn++;
    thinkNpc(w, trader);
    expect(topGoal(trader)?.kind).toBe('tow');
    expect(stateOf(w, 'feud', trader.id, w.player.vehicleId)).toBeNull();
  });

  it('a trader outside the range ignores it', () => {
    const s = stranded(player, { x: 30 + BEACON.range + 60, y: 30 });
    let w = setBeacon(s.w, true);
    for (let i = 0; i < 10; i++) {
      w = endTurn(w, testDrive);
      const trader = find(w, s.trader.id);
      expect(dist(trader.pos, playerVehicle(w).pos)).toBeGreaterThan(BEACON.range);
      expect(topGoal(trader)?.kind).not.toBe('tow');
    }
  });

  it('only the first tower to hear a beacon answers it, and its claim ends with the offer', () => {
    const s = stranded(player, { x: 100, y: 30 });
    const late = withTower(s.w, 'trader', 'traders', 'hauler', { x: 30, y: 150 });
    for (const id of Object.keys(NPCS)) s.w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('strandedSeen', 'tow');
    const r = runUntil(setBeacon(s.w, true), 150, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
    expect(activitiesOf(r.events, late.id).filter((e) => e.t === 'activity' && e.activity === 'tow')).toEqual([]);
    expect(r.w.states.filter((st) => st.kind === 'answering')).toEqual([]);
  });

  it('a raider ignores a stripped beaconing truck', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    onlyCore(w.vehicles[0]);
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', { x: 130, y: 30 });
    runUntil(setBeacon(w, true), 30, (x) => {
      const goal = topGoal(find(x, raider.id));
      expect(goal?.targetId === x.player.vehicleId && ['investigate', 'fight'].includes(goal.kind)).toBe(false);
      return false;
    });
  });

  it('needs a stranded, active and unhitched truck', () => {
    const s = stranded();
    s.w.player.fuel = 30;
    expect(() => setBeacon(s.w, true)).toThrow(/stranded/);
    s.w.player.fuel = 0;
    s.w.player.state = 'knockedOut';
    expect(() => setBeacon(s.w, true)).toThrow(/knockedOut/);
    s.w.player.state = 'active';
    const on = setBeacon(s.w, true);
    expect(setBeacon(on, false).player.beacon).toBe(false);
    expect(() => setBeacon(acceptTow(offered({ w: on, trader: s.trader })), true)).toThrow(/towed/);
  });

  it('switches off on hitching', () => {
    const s = stranded();
    const w = acceptTow(offered({ w: setBeacon(s.w, true), trader: s.trader }));
    expect(w.player.beacon).toBe(false);
  });

  it('switches off when the truck can drive again', () => {
    const s = stranded();
    let w = setBeacon(s.w, true);
    w = endTurn(w, testDrive);
    expect(w.player.beacon).toBe(true);
    w.player.fuel = 30;
    w = endTurn(w, testDrive);
    expect(w.player.beacon).toBe(false);
  });

  it('starts off in a new world', () => {
    expect(emptyWorld().player.beacon).toBe(false);
  });

  it('runs turns on its own while the beacon is on, the truck is parked and no offer is open', () => {
    const s = stranded();
    expect(autoRuns(s.w)).toBe(false);
    const w = setBeacon(s.w, true);
    playerVehicle(w).speed = 0;
    expect(autoRuns(w)).toBe(true);
    playerVehicle(w).speed = 1;
    expect(autoRuns(w)).toBe(false);
    playerVehicle(w).speed = 0;
    expect(autoRuns(setMoveOrder(w, { kind: 'stopAt', dest: { x: 40, y: 40 } }))).toBe(false);
    addState(w, 'tow', s.trader.id, w.player.vehicleId, { kind: 'tow', site: 'bowl', fee: 10, waived: 0, hitched: false });
    expect(autoRuns(w)).toBe(false);
  });
});

describe('social on tow fees', () => {
  it('prices the tow lower for a player at rank 5', () => {
    const s = stranded();
    s.w.player.ranks.social = 5;
    const w = offered(s);
    const me = playerVehicle(w);
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const pad = sitePads(town).reduce((a, b) => (dist(me.pos, a) <= dist(me.pos, b) ? a : b));
    const length = routeLength(me.pos, route(w, me.pos, pad, vehicleStats(w, find(w, s.trader.id)).radius, []));
    const cut = 1 - 5 * SKILL_EFFECTS.social.towFee;
    expect(feeOf(w)).toBe(Math.round(Math.min(TOW.maxFee, TOW.base + TOW.perTile * length) * cut));
  });

  it('cuts a capped fee too', () => {
    const s = stranded(FAR, { x: FAR.x + 10, y: FAR.y });
    s.w.player.ranks.social = 5;
    expect(feeOf(offered(s))).toBe(Math.round(TOW.maxFee * (1 - 5 * SKILL_EFFECTS.social.towFee)));
  });
});

describe('the player towing an NPC', () => {
  const OFFER = 'Need a tow to town?';
  const HITCH = 'Deal. Hitch up.';
  const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
  const gate = siteGates(bowl)[0];
  const out = { x: (gate.x - bowl.pos.x) / bowl.radius, y: (gate.y - bowl.pos.y) / bowl.radius };
  const at = (d: number) => ({ x: gate.x + out.x * d, y: gate.y + out.y * d });

  function strandedNpc(): { w: World; npc: Vehicle } {
    const w = emptyWorld(at(25));
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = withTower(w, 'scavenger', 'scavengers', 'scout', at(28));
    npc.resources!.fuel = 0;
    return { w, npc };
  }

  function pick(w: World, text: string): World {
    const i = currentOptions(w).findIndex((o) => o.text === text);
    if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
    return chooseOption(w, i);
  }

  function hitched(): { w: World; npc: Vehicle } {
    const { w, npc } = strandedNpc();
    return { w: pick(pick(callVehicle(w, npc.id), OFFER), HITCH), npc };
  }

  it('a player tower that can no longer drive drops the tow and earns no fee', () => {
    let { w, npc } = hitched();
    w = runUntil(setMoveOrder(w, { kind: 'stopAt', dest: gate }), 2, () => false).w;
    expect(isOnRope(w, npc.id)).toBe(true);
    const money = w.player.money;
    const npcMoney = getResources(w, find(w, npc.id)).money;
    w.player.fuel = 0;
    w = endTurn(w, testDrive);
    expect(playerTowing(w)).toBeNull();
    expect(w.events).toContainEqual({ t: 'towDropped', by: w.player.vehicleId, client: npc.id, reason: 'stranded' });
    expect(isOnRope(w, npc.id)).toBe(false);
    expect(w.player.money).toBe(money);
    expect(getResources(w, find(w, npc.id)).money).toBe(npcMoney);
    expect(w.states.filter((x) => x.kind === 'tow')).toEqual([]);
  });

  it('the driver names its nearest town and a fee it can pay', () => {
    const { w: start, npc } = strandedNpc();
    npc.resources!.money = 1000;
    const w = pick(callVehicle(start, npc.id), OFFER);
    expect(w.player.call?.vars).toEqual({ site: { kind: 'site', id: 'bowl' }, fee: { kind: 'money', amount: 1000 } });
  });

  it('hitching takes the driver out of physics, and it trails the player', () => {
    let { w, npc } = hitched();
    expect(isOnRope(w, npc.id)).toBe(true);
    expect(towData(playerTowing(w)!)).toMatchObject({ site: 'bowl', hitched: true });
    w = setMoveOrder(w, { kind: 'stopAt', dest: at(40) });
    for (let i = 0; i < 4; i++) {
      w = endTurn(w, testDrive);
      expect(dist(find(w, npc.id).pos, playerVehicle(w).pos)).toBeLessThanOrEqual(TOW.gap + 1e-6);
      expect(find(w, npc.id).order).toBeNull();
    }
  });

  it('the player tows slower', () => {
    const { w } = hitched();
    const free = structuredClone(w);
    free.states = [];
    expect(vehicleStats(w, playerVehicle(w)).maxSpeed).toBeCloseTo(vehicleStats(free, playerVehicle(free)).maxSpeed * TOW.speedShare);
  });

  it('reaching the town gets the player paid once and leaves the driver there', () => {
    let { w, npc } = hitched();
    const fee = towData(playerTowing(w)!).fee;
    const money = w.player.money;
    const npcMoney = find(w, npc.id).resources!.money;
    w = setMoveOrder(w, { kind: 'stopAt', dest: gate });
    const r = runUntil(w, 60, (x) => playerTowing(x) === null);
    expect(r.events.filter((e) => e.t === 'stateEnded').map((e) => e.t === 'stateEnded' && e.ending)).toEqual(['fulfilled']);
    expect(r.w.player.money).toBe(money + fee);
    expect(find(r.w, npc.id).resources!.money).toBe(npcMoney - fee);
    expect(find(r.w, npc.id).speed).toBe(0);
  });

  it('the player can let the driver off the rope for free', () => {
    let { w, npc } = hitched();
    const money = w.player.money;
    w = pick(pick(callVehicle(w, npc.id), 'I am letting you off the rope here.'), 'Over and out.');
    expect(playerTowing(w)).toBeNull();
    expect(isOnRope(w, npc.id)).toBe(false);
    expect(w.player.money).toBe(money);
  });

  it('hostility breaks the tow', () => {
    let { w, npc } = hitched();
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    w = setMoveOrder(w, { kind: 'stopAt', dest: at(40) });
    w = endTurn(w, testDrive);
    expect(playerTowing(w)).toBeNull();
  });

  it('a free tow moves no money and pays Social XP for the waived fee on arrival', () => {
    const { w: start, npc } = strandedNpc();
    let w = pick(pick(callVehicle(start, npc.id), OFFER), 'No charge. Hitch up.');
    const data = towData(playerTowing(w)!);
    expect(data.fee).toBe(0);
    expect(data.waived).toBeGreaterThan(0);
    const money = w.player.money;
    const npcMoney = find(w, npc.id).resources!.money;
    w = setMoveOrder(w, { kind: 'stopAt', dest: gate });
    const r = runUntil(w, 60, (x) => playerTowing(x) === null);
    expect(r.w.player.money).toBe(money);
    expect(find(r.w, npc.id).resources!.money).toBe(npcMoney);
    const practice = r.events.filter((e) => e.t === 'practice' && e.source === 'freeTow');
    expect(practice).toMatchObject([{ amount: data.waived, target: npc.id }]);
    expect(r.w.player.xpBySource.freeTow).toBeCloseTo(data.waived * XP_SOURCES.freeTow.weight);
  });

  it('a driver towed in with no engine drives on with a fresh one', () => {
    const { w: start, npc } = strandedNpc();
    for (const part of mountedParts(npc, 'engine')) npc.items = npc.items.filter((i) => i.kind !== 'part' || i.part.id !== part.id);
    const w = pick(pick(callVehicle(start, npc.id), OFFER), HITCH);
    const r = runUntil(setMoveOrder(w, { kind: 'stopAt', dest: gate }), 60, (x) => playerTowing(x) === null);
    const lying = runUntil(r.w, 3, () => false).w;
    const goal = topGoal(find(lying, npc.id));
    expect(goal).toMatchObject({ kind: 'rearm' });
    expect(mountedParts(find(lying, npc.id), 'engine')).toHaveLength(0);
    const ready = cloneWorld(lying);
    ready.turn = goal!.until! - 1;
    const after = runUntil(ready, 3, () => false).w;
    expect(mountedParts(find(after, npc.id), 'engine')).toHaveLength(1);
    expect(isStranded(after, find(after, npc.id))).toBe(false);
  });

  it('a paid tow pays no free tow XP', () => {
    let { w } = hitched();
    w = setMoveOrder(w, { kind: 'stopAt', dest: gate });
    const r = runUntil(w, 60, (x) => playerTowing(x) === null);
    expect(playerTowing(r.w)).toBeNull();
    expect(r.events.some((e) => e.t === 'practice' && e.source === 'freeTow')).toBe(false);
  });

  it('the player can tow a raider under a truce, and it names its camp', () => {
    const kiln = REGION.locations.find((l) => l.id === 'kiln')!;
    const kilnGate = siteGates(kiln)[0];
    const len = dist(kilnGate, kiln.pos);
    const outKiln = (d: number) => ({ x: kilnGate.x + ((kilnGate.x - kiln.pos.x) / len) * d, y: kilnGate.y + ((kilnGate.y - kiln.pos.y) / len) * d });
    const w = emptyWorld(outKiln(25));
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const raider = withTower(w, 'buggy', 'raiders', 'buggy', outKiln(28));
    raider.resources!.fuel = 0;
    addState(w, 'truce', raider.id, w.player.vehicleId, { kind: 'none' });
    const offered = pick(callVehicle(w, raider.id), OFFER);
    expect(offered.player.call?.vars.site).toEqual({ kind: 'site', id: 'kiln' });
    const towing = pick(offered, HITCH);
    expect(towData(playerTowing(towing)!).site).toBe('kiln');
  });

  it('is not offered to a driver already at its town', () => {
    const { w, npc } = strandedNpc();
    npc.pos = { ...sitePads(bowl)[0] };
    playerVehicle(w).pos = { x: npc.pos.x + out.x * 3, y: npc.pos.y + out.y * 3 };
    refreshVision(w);
    expect(canUseSite(npc.pos, bowl)).toBe(true);
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(OFFER);
  });

  it('is not offered to a driver that can drive or parks out of reach', () => {
    const { w, npc } = strandedNpc();
    npc.resources!.fuel = 50;
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(OFFER);
    const far = strandedNpc();
    far.npc.pos = at(35);
    expect(currentOptions(callVehicle(far.w, far.npc.id)).map((o) => o.text)).not.toContain(OFFER);
  });
});

describe('NPCs towing each other', () => {
  const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
  const kiln = REGION.locations.find((l) => l.id === 'kiln')!;

  function outFrom(site: Site, d: number): Vec {
    const gate = siteGates(site)[0];
    const len = dist(gate, site.pos);
    return { x: gate.x + ((gate.x - site.pos.x) / len) * d, y: gate.y + ((gate.y - site.pos.y) / len) * d };
  }

  type Driver = [templateId: string, faction: Vehicle['faction'], chassis: string];
  const TRADER: Driver = ['trader', 'traders', 'hauler'];
  const SCAVENGER: Driver = ['scavenger', 'scavengers', 'scout'];
  const RAIDER: Driver = ['buggy', 'raiders', 'buggy'];

  function roadside(site: Site, client: Driver, tower: Driver): { w: World; client: Vehicle; tower: Vehicle } {
    const raiders = client[1] === 'raiders' || tower[1] === 'raiders';
    const w = emptyWorld(raiders ? bowl.pos : outFrom(site, 20));
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('idle', 'wait');
    forceOption('strandedSeen', 'tow');
    const c = withTower(w, ...client, outFrom(site, 30));
    c.resources!.fuel = 0;
    c.resources!.money = 33333;
    return { w, client: c, tower: withTower(w, ...tower, outFrom(site, 38)) };
  }

  it('a tower whose client is drawn into a fight this turn keeps its point, and calls the tow off next turn', () => {
    const { w, client, tower } = roadside(bowl, TRADER, SCAVENGER);
    const r = runUntil(w, 10, (x) => topGoal(find(x, tower.id))?.kind === 'tow');
    const towing = find(r.w, tower.id);
    const goal = topGoal(towing)!;
    const before = { ...goal.destination! };
    const foe = addVehicle(r.w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: client.pos.x + 6, y: client.pos.y });
    startCombat(r.w, foe, find(r.w, client.id));
    steerToStranded(r.w, towing, goal);
    expect(goal.destination).toEqual(before);
    thinkNpc(r.w, towing);
    expect(towing.brain!.goals.some((g) => g.kind === 'tow')).toBe(false);
  });

  it('a scavenger hitches a stranded trader and tows it to its nearest town for a fee', () => {
    const s = roadside(bowl, TRADER, SCAVENGER);
    const hitch = runUntil(s.w, 40, (w) => isOnRope(w, s.client.id));
    const tow = towOf(hitch.w, s.client.id)!;
    expect(tow.holder).toBe(s.tower.id);
    expect(towData(tow)).toMatchObject({ site: 'bowl', hitched: true, waived: 0 });
    expect(hitch.events).toContainEqual({ t: 'towHitched', by: s.tower.id, client: s.client.id, site: 'bowl' });
    const fee = towData(tow).fee;
    expect(fee).toBeGreaterThan(0);
    const clientMoney = find(hitch.w, s.client.id).resources!.money;
    const towerMoney = find(hitch.w, s.tower.id).resources!.money;
    const r = runUntil(hitch.w, 200, (w) => towOf(w, s.client.id) === null);
    expect(r.events.filter((e) => e.t === 'towDone')).toEqual([{ t: 'towDone', by: s.tower.id, client: s.client.id, fee }]);
    expect(find(r.w, s.client.id).resources!.money).toBe(clientMoney - fee);
    expect(find(r.w, s.tower.id).resources!.money).toBe(towerMoney + fee);
    expect(canUseSite(find(r.w, s.tower.id).pos, bowl)).toBe(true);
  });

  it('the fee is capped by what the client can pay', () => {
    const s = roadside(bowl, TRADER, SCAVENGER);
    s.client.resources!.money = 7;
    const hitch = runUntil(s.w, 40, (w) => isOnRope(w, s.client.id));
    expect(towData(towOf(hitch.w, s.client.id)!).fee).toBe(7);
  });

  it('a raider hitches a stranded raider and tows it to its nearest camp', () => {
    const s = roadside(kiln, RAIDER, RAIDER);
    const hitch = runUntil(s.w, 40, (w) => isOnRope(w, s.client.id));
    const tow = towOf(hitch.w, s.client.id)!;
    expect(tow.holder).toBe(s.tower.id);
    expect(towData(tow).site).toBe('kiln');
  });

  it('a raider helps a stranded raider as readily as a scavenger helps a trader, at the same crawl home', () => {
    const r = roadside(kiln, RAIDER, RAIDER);
    const t = roadside(bowl, TRADER, SCAVENGER);
    refreshVision(r.w);
    refreshVision(t.w);
    const raider = optionChances(optionWeights(r.w, r.tower, 'strandedSeen', r.client.id, null)).tow;
    expect(raider).toBeCloseTo(optionChances(optionWeights(t.w, t.tower, 'strandedSeen', t.client.id, null)).tow!);
    expect(raider).toBeGreaterThan(0.5);
  });

  it('a trader never tows a stranded raider, and a raider never tows a trader or the player', () => {
    const r = roadside(kiln, RAIDER, TRADER);
    refreshVision(r.w);
    expect(optionWeights(r.w, r.tower, 'strandedSeen', r.client.id, null)).not.toHaveProperty('tow');
    const t = roadside(bowl, TRADER, RAIDER);
    t.w.player.fuel = 0;
    onlyCore(t.w.vehicles[0]);
    playerVehicle(t.w).pos = outFrom(bowl, 34);
    refreshVision(t.w);
    expect(canVehicleSee(t.w, t.tower, playerVehicle(t.w).pos)).toBe(true);
    expect(optionWeights(t.w, t.tower, 'strandedSeen', t.client.id, null)).not.toHaveProperty('tow');
    expect(optionWeights(t.w, t.tower, 'strandedSeen', t.w.player.vehicleId, null)).not.toHaveProperty('tow');
  });

  it('only one tower answers a stranded driver', () => {
    const s = roadside(bowl, TRADER, SCAVENGER);
    forceOption('strandedSeen', 'tow');
    const second = withTower(s.w, ...TRADER, outFrom(bowl, 36));
    const r = runUntil(s.w, 40, (w) => isOnRope(w, s.client.id));
    const claims = r.w.states.filter((st) => (st.kind === 'tow' || st.kind === 'answering') && st.other === s.client.id);
    expect(claims).toHaveLength(1);
    expect(topGoal(find(r.w, [s.tower.id, second.id].find((id) => id !== claims[0].holder)!))?.kind).not.toBe('tow');
  });

  it('a tower busy with one client does not take a second', () => {
    const s = roadside(bowl, TRADER, SCAVENGER);
    forceOption('strandedSeen', 'tow');
    const other = withTower(s.w, ...TRADER, outFrom(bowl, 42));
    other.resources!.fuel = 0;
    const r = runUntil(s.w, 40, (w) => isOnRope(w, s.client.id) || isOnRope(w, other.id));
    expect(r.w.states.filter((st) => st.holder === s.tower.id && (st.kind === 'tow' || st.kind === 'answering'))).toHaveLength(1);
    expect(find(r.w, s.tower.id).brain!.goals.filter((g) => g.kind === 'tow')).toHaveLength(1);
  });

  it('a tower in danger drops its client for free and promises to come back', () => {
    const s = roadside(bowl, TRADER, SCAVENGER);
    let w = runUntil(s.w, 40, (x) => isOnRope(x, s.client.id)).w;
    const money = find(w, s.client.id).resources!.money;
    const tower = find(w, s.tower.id);
    withTower(w, 'buggy', 'raiders', 'buggy', { x: tower.pos.x + 8, y: tower.pos.y });
    forceOption('hostileSeen', 'flee');
    forceOption('attacked', 'flee');
    const r = runUntil(w, 5, (x) => towOf(x, s.client.id) === null);
    w = r.w;
    expect(isOnRope(w, s.client.id)).toBe(false);
    expect(find(w, s.client.id).resources!.money).toBe(money);
    expect(r.events).toContainEqual({ t: 'towDropped', by: s.tower.id, client: s.client.id, reason: 'danger' });
    expect(stateOf(w, 'towPromise', s.tower.id, s.client.id)).not.toBeNull();
  });
});

describe('a truck stranded for good', () => {
  const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
  const far = { x: bowl.pos.x + bowl.radius + 25, y: bowl.pos.y };

  function engineless(pos: Vec): { w: World; npc: Vehicle } {
    const w = emptyWorld(pos);
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: pos.x + 3, y: pos.y }, Math.PI);
    npc.brain = npcBrain('scavenger', pos, NPCS.scavenger.traits);
    expect(mountedParts(npc, 'engine')).toHaveLength(0);
    return { w, npc };
  }

  it('heads for a town to be repaired', () => {
    const { w, npc } = engineless(far);
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply' });
  });

  it('heads for a town even when broke and on his way to loot salvage', () => {
    const { w, npc } = engineless(far);
    getResources(w, npc).money = 0;
    npc.brain!.goals.push({ kind: 'loot', targetId: 'wreck', destination: { x: far.x + 40, y: far.y }, phase: 'travel', reason: 'loot salvage on the way' });
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply' });
    expect(topGoal(npc)?.kind).toBe('resupply');
  });

  it('with money, heads for a town, not a stall that cannot fit an engine', () => {
    const yard = REGION.locations.find((l) => l.id === 'salvage-yard')!;
    const pad = sitePads(yard)[0];
    const { w, npc } = engineless(pad);
    npc.pos = { ...pad };
    getResources(w, npc).money = 5000;
    const goal = thinkNpc(w, npc);
    expect(goal).toMatchObject({ kind: 'resupply' });
    expect(REGION.towns.map((t) => t.id)).toContain(goal.targetId);
  });

  it('a junk engine counts too', () => {
    const pad = nearestPad(bowl, far);
    const w = emptyWorld(pad);
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { ...pad }, Math.PI);
    npc.brain = npcBrain('scavenger', pad, NPCS.scavenger.traits);
    const engine = mountedParts(npc, 'engine')[0];
    engine.wear = CONDITION.maxWear + 1;
    engine.hp = 0;
    thinkNpc(w, npc);
    endLieUp(w, npc);
    const fresh = mountedParts(npc, 'engine')[0];
    expect(fresh.wear).toBeLessThanOrEqual(CONDITION.maxWear);
    expect(fresh.hp).toBeGreaterThan(0);
  });

  it('lies up on reaching a town, however it got there, then gets a fresh engine from its loadout pool', () => {
    const pad = nearestPad(bowl, far);
    const { w, npc } = engineless(pad);
    npc.pos = { ...pad };
    thinkNpc(w, npc);
    expect(topGoal(npc)).toMatchObject({ kind: 'rearm', until: w.turn + NPCS.scavenger.cap * NPCS.scavenger.interval });
    expect(mountedParts(npc, 'engine')).toHaveLength(0);
    endLieUp(w, npc);
    expect(mountedParts(npc, 'engine')).toHaveLength(1);
    expect(isStranded(w, npc)).toBe(false);
  });
});

describe('a broke driver', () => {
  const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
  const far = { x: bowl.pos.x + bowl.radius + 25, y: bowl.pos.y };

  function broke(pos: Vec): { w: World; npc: Vehicle } {
    const w = emptyWorld(far);
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { ...pos }, Math.PI);
    npc.brain = npcBrain('scavenger', pos, NPCS.scavenger.traits);
    getResources(w, npc).money = 0;
    return { w, npc };
  }

  it('with an empty tank heads for a town instead of waiting', () => {
    const { w, npc } = broke({ x: far.x + 3, y: far.y });
    getResources(w, npc).fuel = 0;
    expect(thinkNpc(w, npc)).toMatchObject({ kind: 'resupply' });
  });

  it('that can still drive works on instead of waiting', () => {
    const { w, npc } = broke({ x: far.x + 3, y: far.y });
    getResources(w, npc).fuel = 1;
    expect(thinkNpc(w, npc).kind).not.toBe('wait');
  });

  it('low on fuel heads for a town, not a fuel stall, while it can still drive', () => {
    const pump = REGION.locations.find((l) => l.id === 'pump-station')!;
    const { w, npc } = broke({ x: pump.pos.x + pump.radius + 4, y: pump.pos.y });
    getResources(w, npc).fuel = 1;
    const goal = thinkNpc(w, npc);
    expect(goal).toMatchObject({ kind: 'resupply' });
    expect(REGION.towns.map((t) => t.id)).toContain(goal.targetId);
  });

  it('with a full tank keeps working', () => {
    const { w, npc } = broke({ x: far.x + 3, y: far.y });
    getResources(w, npc).fuel = fuelCap(npc);
    expect(thinkNpc(w, npc).kind).not.toBe('resupply');
  });

  it('dry on a town pad with working parts gets scrap fuel and keeps its loadout', () => {
    const { w, npc } = broke(nearestPad(bowl, far));
    const engine = mountedParts(npc, 'engine')[0];
    getResources(w, npc).fuel = 0;
    thinkNpc(w, npc);
    expect(getResources(w, npc).fuel).toBeGreaterThan(0);
    expect(mountedParts(npc, 'engine')[0].id).toBe(engine.id);
    expect(isStranded(w, npc)).toBe(false);
  });

  it('a broke raider on a town pad gets no scrap fuel', () => {
    const pad = nearestPad(bowl, far);
    const w = emptyWorld(far);
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    const npc = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { ...pad }, Math.PI);
    npc.brain = npcBrain('buggy', pad, ['raider']);
    getResources(w, npc).money = 0;
    getResources(w, npc).fuel = 0;
    thinkNpc(w, npc);
    expect(getResources(w, npc).fuel).toBe(0);
  });

  it('stranded on a town pad by a broken engine lies up, then gets a fresh loadout and can drive', () => {
    const { w, npc } = broke(nearestPad(bowl, far));
    mountedParts(npc, 'engine')[0].hp = 0;
    getResources(w, npc).fuel = 0;
    thinkNpc(w, npc);
    expect(isStranded(w, npc)).toBe(true);
    endLieUp(w, npc);
    expect(isStranded(w, npc)).toBe(false);
  });

  it('with money on a town pad pays for its repair and keeps its loadout', () => {
    const { w, npc } = broke(nearestPad(bowl, far));
    getResources(w, npc).money = 166667;
    const engine = mountedParts(npc, 'engine')[0];
    engine.hp = 0;
    thinkNpc(w, npc);
    expect(mountedParts(npc, 'engine')[0].id).toBe(engine.id);
    expect(getResources(w, npc).money).toBeLessThan(166667);
    expect(isStranded(w, npc)).toBe(false);
  });
});
