import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { AID } from '../data/npc-behavior';
import { NPC_UPKEEP, NPCS, STATE_TURNS } from '../data/npcs';
import { RULES } from '../data/rules';
import { agreeAid, aidPrice, aidWork, onNeedySeen, playerAid, readyAid, spareAid, startAid, wantedAid } from './aid';
import { playerVehicle } from './damage';
import { truckSupplyForSale } from './economy';
import { makePart } from './factory';
import { corePart, mountedParts } from './grid';
import { stowPart } from './inventory';
import { vehicleValue } from './market';
import { fuelReserveFor, thinkNpc, topGoal } from './npc-activities';
import { bodyCondition, optionWeights } from './npc-decisions';
import { addState, aidData, stateOf, workOf } from './states';
import { fuelCap, suppliesCap } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls, testDrive , startCombat } from './testkit';
import type { TraitId } from '../data/npcs';
import type { GameEvent, Vehicle, World } from './types';
import { maxHp } from './wear';
import { autoRuns, endTurn, update } from './world';

type Terms = Parameters<typeof agreeAid>[2];

const HANDOVER = { started: false, work: 1, workLeft: 1 };

function withDriver(x: number, traits: TraitId[] = ['trader']): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x, y: 30 }, Math.PI);
  npc.brain = npcBrain('trader', npc.pos, traits);
  npc.resources!.fuel = fuelCap(npc);
  npc.resources!.supplies = suppliesCap(npc);
  npc.resources!.money = 500;
  return { w, npc };
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function runUntil(w: World, max: number, done: (w: World) => boolean, press = true): { w: World; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !done(w); i++) {
    if (w.player.call) w = update(w, (d) => { d.player.call = null; });
    const ready = press ? readyAid(w) : null;
    if (ready) {
      w = startAid(w, ready.holder);
      events.push(...w.events);
    }
    w = endTurn(w, testDrive);
    events.push(...w.events);
  }
  return { w, events };
}

const aidOpen = (w: World, npcId: string) => stateOf(w, 'aid', npcId, w.player.vehicleId) !== null;
const aidEvents = (events: GameEvent[]) => events.filter((e) => e.t === 'aid');

function agreed(start: World, npcId: string, terms: Terms): World {
  return update(start, (w) => { agreeAid(w, find(w, npcId), terms); });
}

const playerGift = (fuel: number, price = 0): Terms => ({ giver: 'player', fuel, supplies: 0, price, free: price === 0 });

function poorLowPlayer(w: World): void {
  for (const p of mountedParts(playerVehicle(w))) p.hp = Math.floor(maxHp(p) * 0.4);
  w.player.fuel = Math.floor(fuelCap(playerVehicle(w)) * RULES.lowFuelThreshold);
}

describe('aid deal', () => {
  it('moves a player gift only after the player starts the handover, and only once', () => {
    const { w: start, npc } = withDriver(60);
    start.vehicles.find((v) => v.id === npc.id)!.resources!.fuel = fuelCap(npc) * 0.1;
    const fuel0 = start.player.fuel;
    let w = agreed(start, npc.id, playerGift(5));
    w = endTurn(w, testDrive);
    expect(w.player.fuel).toBe(fuel0);
    const parked = runUntil(w, 40, (x) => readyAid(x) !== null, false);
    expect(readyAid(parked.w)).not.toBeNull();
    const idle = runUntil(parked.w, 3, () => false, false);
    expect(idle.w.player.fuel).toBe(fuel0);
    expect(aidOpen(idle.w, npc.id)).toBe(true);
    const started = startAid(idle.w, npc.id);
    expect(started.events).toContainEqual({ t: 'aidStarted', giver: started.player.vehicleId, receiver: npc.id });
    expect(started.player.fuel).toBe(fuel0);
    const run = runUntil(started, 3, (x) => !aidOpen(x, npc.id));
    expect(run.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'fulfilled' }));
    expect(aidEvents(run.events)).toEqual([{ t: 'aid', giver: run.w.player.vehicleId, receiver: npc.id, fuel: 5, supplies: 0, paid: 0 }]);
    expect(run.w.player.fuel).toBe(fuel0 - 5);
    const after = runUntil(run.w, 3, () => false);
    expect(aidEvents(after.events)).toEqual([]);
    expect(after.w.player.fuel).toBe(fuel0 - 5);
  });

  it('a free player gift trains Social through aid XP', () => {
    const { w: start, npc } = withDriver(34);
    find(start, npc.id).resources!.fuel = 1;
    const run = runUntil(agreed(start, npc.id, playerGift(5)), 3, (x) => !aidOpen(x, npc.id));
    const xp = run.events.filter((e) => e.t === 'practice' && e.source === 'aid');
    expect(xp).toEqual([expect.objectContaining({ amount: 5 * ECONOMY.supplyPrice.fuel, target: npc.id })]);
  });

  it('a paid player gift moves the money and pays no aid XP', () => {
    const { w: start, npc } = withDriver(34);
    find(start, npc.id).resources!.fuel = 1;
    const price = aidPrice(start, npc, { fuel: 5, supplies: 0 });
    expect(price).toBe(5 * ECONOMY.supplyPrice.fuel);
    const money0 = start.player.money;
    const run = runUntil(agreed(start, npc.id, playerGift(5, price)), 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.money).toBe(money0 + price);
    expect(find(run.w, npc.id).resources!.money).toBe(500 - price);
    expect(run.events.some((e) => e.t === 'practice' && e.source === 'aid')).toBe(false);
  });

  it('an NPC gift pays no aid XP', () => {
    const { w: start, npc } = withDriver(34);
    start.player.fuel = 2;
    const run = runUntil(agreed(start, npc.id, { giver: 'npc', fuel: 4, supplies: 0, price: 0, free: true }), 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.fuel).toBe(6);
    expect(run.events.some((e) => e.t === 'practice' && e.source === 'aid')).toBe(false);
  });

  it('an NPC spares only stock above its trade reserve', () => {
    const { w, npc } = withDriver(34);
    w.player.fuel = 1;
    const reserve = fuelCap(npc) * NPC_UPKEEP.tradeReserve;
    npc.resources!.fuel = reserve + 2;
    expect(truckSupplyForSale(npc, 'fuel')).toBe(2);
    expect(spareAid(w, npc)).toEqual({ fuel: 2, supplies: 0 });
    npc.resources!.fuel = fuelCap(npc);
    expect(spareAid(w, npc).fuel).toBe(Math.floor(AID.giftShare * fuelCap(playerVehicle(w))));
  });

  it('with no surplus of what the player lacks, give and aid are unavailable', () => {
    const { w, npc } = withDriver(34);
    w.player.fuel = 1;
    npc.resources!.fuel = fuelCap(npc) * NPC_UPKEEP.tradeReserve;
    expect(spareAid(w, npc)).toEqual({ fuel: 0, supplies: 0 });
    expect(optionWeights(w, npc, 'aidAsked', w.player.vehicleId, null)).not.toHaveProperty('give');
    expect(optionWeights(w, npc, 'needySeen', w.player.vehicleId, null)).not.toHaveProperty('aid');
  });

  it('give is unavailable while another aid deal with the player is open', () => {
    const { w, npc } = withDriver(34);
    w.player.fuel = 1;
    const other = addVehicle(w, 'traders', 'scout', [], { x: 60, y: 60 });
    other.brain = npcBrain('trader', other.pos, ['trader']);
    expect(optionWeights(w, npc, 'aidAsked', w.player.vehicleId, null)).toHaveProperty('give');
    addState(w, 'aid', other.id, w.player.vehicleId, { kind: 'aid', giver: 'npc', fuel: 1, supplies: 0, price: 0, free: true, agreed: false, ...HANDOVER });
    expect(optionWeights(w, npc, 'aidAsked', w.player.vehicleId, null)).not.toHaveProperty('give');
  });

  it('moves no more than the giver still holds', () => {
    const { w: start, npc } = withDriver(34);
    find(start, npc.id).resources!.fuel = 1;
    const w0 = agreed(start, npc.id, playerGift(10));
    w0.player.fuel = 4;
    const run = runUntil(w0, 3, (x) => !aidOpen(x, npc.id));
    expect(aidEvents(run.events)).toEqual([expect.objectContaining({ fuel: 4 })]);
    expect(run.w.player.fuel).toBe(0);
  });

  it('moves no more than the receiver has room for, and pays only for what moved', () => {
    const { w: start, npc } = withDriver(34);
    const w0 = agreed(start, npc.id, playerGift(10, 10 * ECONOMY.supplyPrice.fuel));
    find(w0, npc.id).resources!.fuel = fuelCap(npc) - 3;
    const fuel0 = w0.player.fuel;
    const money0 = w0.player.money;
    const run = runUntil(w0, 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.fuel).toBe(fuel0 - 3);
    expect(aidEvents(run.events)).toEqual([expect.objectContaining({ fuel: 3, paid: 3 * ECONOMY.supplyPrice.fuel })]);
    expect(run.w.player.money).toBe(money0 + 3 * ECONOMY.supplyPrice.fuel);
  });

  it('pays no more than the NPC holds', () => {
    const { w: start, npc } = withDriver(34);
    find(start, npc.id).resources!.fuel = 1;
    const w0 = agreed(start, npc.id, playerGift(5, 5 * ECONOMY.supplyPrice.fuel));
    find(w0, npc.id).resources!.money = 7;
    const money0 = w0.player.money;
    const run = runUntil(w0, 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.money).toBe(money0 + 7);
    expect(find(run.w, npc.id).resources!.money).toBe(0);
  });

  it('an NPC giver that dipped into its reserve gives only what is still above it', () => {
    const { w: start, npc } = withDriver(34);
    start.player.fuel = 0;
    const w0 = agreed(start, npc.id, { giver: 'npc', fuel: 5, supplies: 0, price: 0, free: true });
    find(w0, npc.id).resources!.fuel = fuelCap(npc) * NPC_UPKEEP.tradeReserve + 2.9;
    const run = runUntil(w0, 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.fuel).toBe(2);
  });

  it('a feud breaks the deal and moves nothing', () => {
    const { w: start, npc } = withDriver(60);
    const fuel0 = start.player.fuel;
    const w = update(agreed(start, npc.id, playerGift(5)), (d) => { addState(d, 'feud', npc.id, d.player.vehicleId, { kind: 'feud', robbery: false }); });
    const run = runUntil(w, 3, (x) => !aidOpen(x, npc.id));
    expect(run.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'broken' }));
    expect(aidEvents(run.events)).toEqual([]);
    expect(run.w.player.fuel).toBe(fuel0);
  });

  it('a deal that never comes together expires with nothing moved', () => {
    const { w: start, npc } = withDriver(80);
    const fuel0 = start.player.fuel;
    const w0 = update(start, (w) => { addState(w, 'aid', npc.id, w.player.vehicleId, { kind: 'aid', ...playerGift(5), agreed: true, ...HANDOVER }); });
    const run = runUntil(w0, STATE_TURNS.aid! + 2, (x) => !aidOpen(x, npc.id));
    expect(run.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'expired' }));
    expect(aidEvents(run.events)).toEqual([]);
    expect(run.w.player.fuel).toBe(fuel0);
  });
});

describe('meeting for aid', () => {
  it('a stranded NPC receiver waits parked until the player drives alongside', () => {
    const { w: start, npc } = withDriver(45);
    find(start, npc.id).resources!.fuel = 0;
    let w = agreed(start, npc.id, playerGift(5));
    expect(topGoal(find(w, npc.id))).toMatchObject({ kind: 'meet', destination: null });
    w = runUntil(w, 3, () => false).w;
    expect(find(w, npc.id).pos).toEqual({ x: 45, y: 30 });
    expect(aidOpen(w, npc.id)).toBe(true);
    w = update(w, (d) => { playerVehicle(d).pos = { x: 41, y: 30 }; });
    const run = runUntil(w, 3, (x) => !aidOpen(x, npc.id));
    expect(aidEvents(run.events)).toEqual([expect.objectContaining({ fuel: 5 })]);
    expect(find(run.w, npc.id).resources!.fuel).toBe(5);
  });

  it('a driving NPC giver drives over to the player', () => {
    const { w: start, npc } = withDriver(60);
    start.player.fuel = 0;
    const w = agreed(start, npc.id, { giver: 'npc', fuel: 4, supplies: 0, price: 0, free: true });
    expect(topGoal(find(w, npc.id))).toMatchObject({ kind: 'meet', targetId: w.player.vehicleId });
    const run = runUntil(w, 40, (x) => !aidOpen(x, npc.id));
    expect(find(run.w, npc.id).pos.x).toBeLessThan(45);
    expect(run.w.player.fuel).toBe(4);
  });

  it('the meet goal ends with the deal', () => {
    const { w: start, npc } = withDriver(34);
    const run = runUntil(agreed(start, npc.id, playerGift(5)), 3, (x) => !aidOpen(x, npc.id));
    expect(topGoal(find(endTurn(run.w, testDrive), npc.id))?.kind).not.toBe('meet');
  });
});

describe('unprompted aid offer', () => {
  function needyScene(): { w: World; npc: Vehicle } {
    const { w, npc } = withDriver(40);
    poorLowPlayer(w);
    forceOption('needySeen', 'aid');
    w.rngState = rngStateForForcedRolls(1);
    return { w, npc };
  }

  it('the start truck counts as worth little', () => {
    expect(vehicleValue(playerVehicle(emptyWorld()))).toBeLessThanOrEqual(AID.poorValue);
  });

  it('offers when every gate holds', () => {
    const { w, npc } = needyScene();
    onNeedySeen(w, npc);
    const s = playerAid(w);
    expect(s?.holder).toBe(npc.id);
    expect(aidData(s!)).toMatchObject({ giver: 'npc', agreed: false, price: 0, free: true, fuel: spareAid(w, npc).fuel });
    expect(aidData(s!).fuel).toBeGreaterThan(0);
  });

  it('a thinking driver makes the offer', () => {
    const { w, npc } = needyScene();
    thinkNpc(w, npc);
    expect(playerAid(w)?.holder).toBe(npc.id);
  });

  it('does not roll for a player in good shape', () => {
    const { w, npc } = needyScene();
    for (const p of mountedParts(playerVehicle(w))) p.hp = maxHp(p);
    expect(bodyCondition(playerVehicle(w))).toBeGreaterThanOrEqual(AID.poorCondition);
    onNeedySeen(w, npc);
    expect(playerAid(w)).toBeNull();
    expect(npc.brain!.noticed).not.toHaveProperty(`needySeen:${w.player.vehicleId}`);
  });

  it('does not roll for a rich player', () => {
    const { w, npc } = needyScene();
    const me = playerVehicle(w);
    for (const id of ['flamer', 'slugCannon', 'shotgun', 'longRifle']) expect(stowPart(w, me, makePart(w, id, 0))).toBe(true);
    expect(vehicleValue(me)).toBeGreaterThan(AID.poorValue);
    onNeedySeen(w, npc);
    expect(playerAid(w)).toBeNull();
  });

  it('does not roll for a player who is not low', () => {
    const { w, npc } = needyScene();
    w.player.fuel = fuelCap(playerVehicle(w));
    onNeedySeen(w, npc);
    expect(playerAid(w)).toBeNull();
  });

  it('does not roll for a player in combat', () => {
    const { w, npc } = needyScene();
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 24, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(w, raider, w.vehicles[0]);
    onNeedySeen(w, npc);
    expect(playerAid(w)).toBeNull();
  });

  it('does not roll while another aid deal with the player is open', () => {
    const { w, npc } = needyScene();
    const other = addVehicle(w, 'traders', 'scout', [], { x: 60, y: 60 });
    other.brain = npcBrain('trader', other.pos, ['trader']);
    addState(w, 'aid', other.id, w.player.vehicleId, { kind: 'aid', giver: 'npc', fuel: 1, supplies: 0, price: 0, free: true, agreed: false, ...HANDOVER });
    onNeedySeen(w, npc);
    expect(stateOf(w, 'aid', npc.id, w.player.vehicleId)).toBeNull();
    expect(npc.brain!.noticed).not.toHaveProperty(`needySeen:${w.player.vehicleId}`);
  });

  it('a raider never offers', () => {
    const { w, npc } = needyScene();
    npc.brain!.traits = ['raider'];
    onNeedySeen(w, npc);
    expect(playerAid(w)).toBeNull();
  });
});

describe('what a low driver asks for', () => {
  it('asks for fuel up to its pump reserve, never more than the small share of its tank', () => {
    const { w, npc } = withDriver(36);
    npc.resources!.fuel = 0;
    const cap = Math.floor(fuelCap(npc) * AID.fillShare);
    expect(wantedAid(w, npc).fuel).toBe(Math.min(cap, Math.max(1, Math.ceil(fuelReserveFor(w, npc)))));
    expect(wantedAid(w, npc).fuel).toBeLessThanOrEqual(cap);
  });

  it('asks for no fuel while its tank leaks, but still asks for supplies', () => {
    const { w, npc } = withDriver(36);
    npc.resources!.fuel = 0;
    npc.resources!.supplies = 0;
    corePart(npc, 'tank')!.hp = 0;
    const wanted = wantedAid(w, npc);
    expect(wanted.fuel).toBe(0);
    expect(wanted.supplies).toBeGreaterThan(0);
    npc.resources!.supplies = suppliesCap(npc);
    expect(wantedAid(w, npc)).toEqual({ fuel: 0, supplies: 0 });
  });
});

describe('aid handover', () => {
  function parkedDeal(): { w: World; npc: Vehicle } {
    const { w: start, npc } = withDriver(34);
    find(start, npc.id).resources!.fuel = 1;
    return { w: agreed(start, npc.id, playerGift(5)), npc };
  }

  it('startAid throws without a deal, for a pending offer, apart, twice, or in combat', () => {
    const { w: start, npc } = withDriver(34);
    expect(() => startAid(start, npc.id)).toThrow();
    const pending = update(start, (d) => { addState(d, 'aid', npc.id, d.player.vehicleId, { kind: 'aid', giver: 'npc', fuel: 1, supplies: 0, price: 0, free: true, agreed: false, ...HANDOVER }); });
    expect(() => startAid(pending, npc.id)).toThrow();
    const far = withDriver(80);
    expect(() => startAid(agreed(far.w, far.npc.id, playerGift(5)), far.npc.id)).toThrow();
    const { w } = parkedDeal();
    const started = startAid(w, npc.id);
    expect(() => startAid(started, npc.id)).toThrow();
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 24, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(w, raider, w.vehicles[0]);
    expect(() => startAid(w, npc.id)).toThrow();
  });

  it('shows work for both trucks only while started and parked together', () => {
    const { w, npc } = parkedDeal();
    expect(workOf(w, playerVehicle(w))).toBeNull();
    const started = startAid(w, npc.id);
    const s = playerAid(started)!;
    expect(aidWork(started, s)).toEqual({ turnsLeft: 1, total: 1 });
    expect(workOf(started, playerVehicle(started))).toMatchObject({ from: 'state', turnsLeft: 1 });
    expect(workOf(started, find(started, npc.id))).toMatchObject({ from: 'state', turnsLeft: 1 });
    const apart = update(started, (d) => { playerVehicle(d).pos = { x: 10, y: 30 }; });
    expect(aidWork(apart, playerAid(apart)!)).toBeNull();
  });

  it('a move pauses the handover, and parking again resumes it', () => {
    const { w, npc } = parkedDeal();
    const fuel0 = w.player.fuel;
    let d = startAid(w, npc.id);
    d = update(d, (x) => { playerVehicle(x).pos = { x: 10, y: 30 }; });
    d = endTurn(d, testDrive);
    expect(aidData(playerAid(d)!).workLeft).toBe(1);
    expect(d.player.fuel).toBe(fuel0);
    d = update(d, (x) => { playerVehicle(x).speed = 0; playerVehicle(x).pos = { x: 30, y: 30 }; });
    const run = runUntil(d, 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.fuel).toBe(fuel0 - 5);
  });

  it('combat breaks the deal, started or not, and moves nothing', () => {
    const { w, npc } = parkedDeal();
    const fuel0 = w.player.fuel;
    const started = startAid(w, npc.id);
    const raider = addVehicle(started, 'raiders', 'buggy', ['mg'], { x: 24, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(started, raider, started.vehicles[0]);
    const run = runUntil(started, 3, (x) => !aidOpen(x, npc.id));
    expect(run.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'broken' }));
    expect(aidEvents(run.events)).toEqual([]);
    expect(run.w.player.fuel).toBe(fuel0);
  });

  it('an agreed deal waits past its timer while parked, and a pending offer still lapses', () => {
    const { w, npc } = parkedDeal();
    const run = runUntil(w, STATE_TURNS.aid! + 5, () => false, false);
    expect(aidOpen(run.w, npc.id)).toBe(true);
    expect(aidData(playerAid(run.w)!).started).toBe(false);
    const { w: start, npc: other } = withDriver(200);
    const offer = update(start, (d) => { addState(d, 'aid', other.id, d.player.vehicleId, { kind: 'aid', giver: 'npc', fuel: 1, supplies: 0, price: 0, free: true, agreed: false, ...HANDOVER }); });
    expect(aidOpen(runUntil(offer, STATE_TURNS.aid! + 2, () => false, false).w, other.id)).toBe(false);
  });

  it('an NPC giver goes through the same handover', () => {
    const { w: start, npc } = withDriver(34);
    start.player.fuel = 2;
    const w = agreed(start, npc.id, { giver: 'npc', fuel: 4, supplies: 0, price: 0, free: true });
    const held = runUntil(w, 3, () => false, false);
    expect(held.w.player.fuel).toBe(2);
    const run = runUntil(held.w, 3, (x) => !aidOpen(x, npc.id));
    expect(run.w.player.fuel).toBe(6);
  });

  it('automatic turns stop while a handover waits for the player', () => {
    const { w } = parkedDeal();
    w.player.beacon = true;
    expect(readyAid(w)).not.toBeNull();
    expect(autoRuns(w)).toBe(false);
  });
});
