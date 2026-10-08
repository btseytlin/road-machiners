import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { partDef } from '../data/parts';
import { CONDITION, PATCH } from '../data/wear';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { playerVehicle } from './damage';
import { callVehicle, chooseOption, currentOptions } from './dialogue';
import { corePart, goodsCount, mountedParts } from './grid';
import { maxHp } from './wear';
import { addGoods, removeGoods } from './inventory';
import { thinkNpc, topGoal } from './npc-activities';
import { agreePatch, dealAvailable, needsPatch, patchData, patchTerms, settlePatch } from './patch';
import { makePeace } from './parley';
import { addState, stateOf } from './states';
import { isStranded } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, testDrive , startCombat } from './testkit';
import type { GameEvent, PatchDeal, Vehicle, World } from './types';
import { cloneWorld, endTurn, setMoveOrder } from './world';

function answer(w: World, text: string): World {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return chooseOption(w, i);
}

function breakEngine(v: Vehicle): void {
  mountedParts(v, 'engine')[0].hp = 0;
}

const parts = (v: Vehicle) => goodsCount(v).parts ?? 0;

function setParts(w: World, v: Vehicle, n: number): void {
  removeGoods(v, 'parts', parts(v));
  addGoods(w, v, 'parts', n);
}
const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function brokenPlayer(traderParts: number): { w: World; trader: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  w.player.autoRepair = false;
  breakEngine(playerVehicle(w));
  setParts(w, playerVehicle(w), 0);
  const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 38, y: 30 }, Math.PI);
  trader.brain = npcBrain('trader', trader.pos, ['trader']);
  addGoods(w, trader, 'parts', traderParts);
  return { w, trader };
}

const patchOutcomes = (events: GameEvent[]) => events.flatMap((e) => (e.t === 'patch' ? [e.outcome] : []));

function askPatch(w: World, traderId: string): World {
  w = callVehicle(w, traderId);
  return answer(w, 'My truck is broken down. Can you patch it?');
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !done(w); i++) {
    w = endTurn(w, testDrive);
    events.push(...w.events);
  }
  return { w, events };
}

function agreedTerms(start: World, traderId: string, deal: PatchDeal): World {
  forceOption('patchDeal', deal);
  let w = askPatch(start, traderId);
  w = answer(w, 'Engine, gearbox or tank. What would it take?');
  expect(w.player.call?.vars.deal).toMatchObject({ kind: 'deal', deal, patcher: 'npc' });
  return answer(w, 'Deal. I will stay put.');
}

describe('asking a driver for a patch', () => {
  it('a driver without parts cannot help', () => {
    const { w, trader } = brokenPlayer(0);
    const asked = askPatch(w, trader.id);
    expect(currentOptions(asked).map((o) => o.text)).toContain('Engine, gearbox or tank. Can you do anything?');
  });

  it('a junk engine needs no patch, since no patch rebuilds it', () => {
    const { w } = brokenPlayer(4);
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    expect(needsPatch(w, playerVehicle(w))).toBe(true);
    engine.wear = CONDITION.maxWear + 1;
    expect(needsPatch(w, playerVehicle(w))).toBe(false);
  });

  it('a truck that is not broken cannot ask', () => {
    const { w, trader } = brokenPlayer(4);
    mountedParts(playerVehicle(w), 'engine')[0].hp = 10;
    const open = callVehicle(w, trader.id);
    expect(currentOptions(open).map((o) => o.text)).not.toContain('My truck is broken down. Can you patch it?');
  });

  it('agreeing to a patch pays no deal XP until the patch is done', () => {
    const { w: start, trader } = brokenPlayer(4);
    expect(practiceOf(agreedTerms(start, trader.id, 'free'), 'deal')).toEqual([]);
  });

  it('a free patch spends the patcher parts, costs nothing and gets the truck going', () => {
    const { w: start, trader } = brokenPlayer(4);
    const money = start.player.money;
    let w = agreedTerms(start, trader.id, 'free');
    const needed = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).parts;
    expect(topGoal(find(w, trader.id))?.kind).toBe('patch');
    const r = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null);
    w = r.w;
    expect(r.events.filter((e) => e.t === 'patch').map((e) => e.t === 'patch' && e.outcome)).toEqual(['started', 'done']);
    expect(parts(find(w, trader.id))).toBe(4 - needed);
    expect(w.player.money).toBe(money);
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    expect(engine.hp).toBe(Math.max(1, Math.round(partDef(engine.defId).hp * PATCH.share)));
    expect(isStranded(w, playerVehicle(w))).toBe(false);
  });

  it('a paid patch charges the client once, into debt if need be', () => {
    const { w: start, trader } = brokenPlayer(4);
    start.player.money = 0;
    const traderMoney = trader.resources!.money;
    let w = agreedTerms(start, trader.id, 'paid');
    const price = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).price;
    expect(price).toBeGreaterThan(0);
    w = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null).w;
    expect(w.player.money).toBe(-price);
    expect(find(w, trader.id).resources!.money).toBe(traderMoney + price);
  });

  it('an own-parts patch spends the client parts', () => {
    const { w: start, trader } = brokenPlayer(0);
    setParts(start, playerVehicle(start), 3);
    let w = agreedTerms(start, trader.id, 'ownParts');
    const needed = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).parts;
    w = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null).w;
    expect(parts(playerVehicle(w))).toBe(3 - needed);
    expect(isStranded(w, playerVehicle(w))).toBe(false);
  });

  it('auto patch leaves the parts of an own-parts deal alone', () => {
    const { w: start, trader } = brokenPlayer(0);
    start.player.autoRepair = true;
    setParts(start, playerVehicle(start), 3);
    let w = agreedTerms(start, trader.id, 'ownParts');
    const needed = patchData(stateOf(w, 'patch', trader.id, w.player.vehicleId)!).parts;
    setParts(w, playerVehicle(w), needed);
    const r = runUntil(w, 40, (x) => stateOf(x, 'patch', trader.id, x.player.vehicleId) === null);
    expect(r.events.filter((e) => e.t === 'patch').map((e) => e.t === 'patch' && e.outcome)).toEqual(['started', 'done']);
    expect(parts(playerVehicle(r.w))).toBe(0);
    expect(isStranded(r.w, playerVehicle(r.w))).toBe(false);
  });

  it('a driver under attack takes no patch and calls off an agreed one', () => {
    const { w: start, trader } = brokenPlayer(4);
    let w = agreedTerms(start, trader.id, 'free');
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 38, y: 34 });
    find(w, trader.id).brain!.attackers[raider.id] = true;
    startCombat(w, raider, find(w, trader.id));
    const open = callVehicle(cloneWorld(w), trader.id);
    expect(currentOptions(open).map((o) => o.text)).not.toContain('My truck is broken down. Can you patch it?');
    thinkNpc(w, find(w, trader.id));
    expect(patchOutcomes(w.events)).toEqual(['broken']);
    expect(stateOf(w, 'patch', trader.id, w.player.vehicleId)).toBeNull();
    expect(find(w, trader.id).brain!.goals.some((g) => g.kind === 'patch')).toBe(false);
  });

  it('never rolls a deal its payer cannot cover', () => {
    const { w, trader } = brokenPlayer(0);
    setParts(w, playerVehicle(w), 3);
    forceOption('patchDeal', 'free');
    const asked = answer(askPatch(w, trader.id), 'Engine, gearbox or tank. What would it take?');
    expect(asked.player.call?.vars.deal).toMatchObject({ deal: 'ownParts' });
  });
});

describe('a stranded driver asking the player', () => {
  function brokenNpc(): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    w.player.autoRepair = false;
    setParts(w, playerVehicle(w), 4);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    breakEngine(npc);
    return { w, npc };
  }

  it('calls once, and the player patches it for pay by parking beside it', () => {
    const { w: start, npc } = brokenNpc();
    forceOption('patchDeal', 'paid');
    let w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'patchRequest' });
    w = answer(w, 'What are you offering?');
    w = answer(w, 'Deal. Stay where you are.');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    expect(topGoal(find(w, npc.id))?.reason).toBe('wait for a patch');
    const playerMoney = w.player.money;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 38, y: 30 } });
    const r = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null);
    w = r.w;
    expect(isStranded(w, find(w, npc.id))).toBe(false);
    expect(w.player.money).toBe(playerMoney + deal.price);
    expect(parts(playerVehicle(w))).toBe(4 - deal.parts);
    expect(w.player.talked[npc.id]).toEqual({ patchRequest: 'agreed' });
  });

  it('holds the client parked when auto patch is on and the player holds only the promised parts', () => {
    const { w: start, npc } = brokenNpc();
    start.player.autoRepair = true;
    for (const p of mountedParts(playerVehicle(start))) p.hp = Math.round(p.hp / 2);
    forceOption('patchDeal', 'paid');
    let w = endTurn(start, testDrive);
    w = answer(answer(w, 'What are you offering?'), 'Deal. Stay where you are.');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    setParts(w, playerVehicle(w), deal.parts);
    const money = w.player.money;
    const agreedAt = { ...find(w, npc.id).pos };
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 38, y: 30 } });
    const r = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null);
    w = r.w;
    expect(r.events.some((e) => e.t === 'patch' && e.outcome === 'done')).toBe(true);
    expect(isStranded(w, find(w, npc.id))).toBe(false);
    expect(Math.hypot(find(w, npc.id).pos.x - agreedAt.x, find(w, npc.id).pos.y - agreedAt.y)).toBeLessThan(RULES.arriveRadius);
    expect(w.player.money).toBe(money + deal.price);
  });

  it('the player can offer the patch over the radio before the driver asks', () => {
    const { w: start, npc } = brokenNpc();
    forceOption('patchDeal', 'paid');
    let w = callVehicle(start, npc.id);
    w = answer(w, 'Your truck looks dead. Want me to patch it?');
    w = answer(w, 'What can you offer?');
    w = answer(w, 'Deal. Stay where you are.');
    expect(stateOf(w, 'patch', w.player.vehicleId, npc.id)).not.toBeNull();
    expect(topGoal(find(w, npc.id))?.reason).toBe('wait for a patch');
  });

  it('a driver with a sound truck gets no patch offer', () => {
    const { w: start, npc } = brokenNpc();
    mountedParts(npc, 'engine')[0].hp = partDef('stockEngine').hp;
    const w = callVehicle(start, npc.id);
    expect(currentOptions(w).map((o) => o.text)).not.toContain('Your truck looks dead. Want me to patch it?');
  });

  it('a hostile raider gets no patch until a truce, then waits parked for it', () => {
    const w0 = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w0.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    w0.player.autoRepair = false;
    setParts(w0, playerVehicle(w0), 4);
    const raider = addVehicle(w0, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    breakEngine(raider);
    forceOption('mugging', 'attack');
    expect(endTurn(w0, testDrive).player.call).toBeNull();
    expect(currentOptions(callVehicle(w0, raider.id)).map((o) => o.text)).not.toContain('Your truck looks dead. Want me to patch it?');
    makePeace(w0, playerVehicle(w0), raider);
    forceOption('patchDeal', 'paid');
    let w = callVehicle(w0, raider.id);
    w = answer(w, 'Your truck looks dead. Want me to patch it?');
    w = answer(w, 'What can you offer?');
    w = answer(w, 'Deal. Stay where you are.');
    const start = { ...raider.pos };
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 38, y: 30 } });
    w = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, raider.id) === null).w;
    expect(isStranded(w, find(w, raider.id))).toBe(false);
    expect(find(w, raider.id).pos.x).toBeCloseTo(start.x, 0);
  });

  it('a driver carrying the parts fixes its own truck instead of asking', () => {
    const { w: start, npc } = brokenNpc();
    addGoods(start, npc, 'parts', 2);
    const w = endTurn(start, testDrive);
    expect(w.player.call).toBeNull();
  });

  it('a refused request is not raised again', () => {
    const { w: start, npc } = brokenNpc();
    let w = endTurn(start, testDrive);
    w = answer(w, 'What are you offering?');
    w = answer(w, 'Not today.');
    w = runUntil(w, 5, (x) => x.player.call !== null).w;
    expect(w.player.call).toBeNull();
    expect(w.player.talked[npc.id]).toEqual({ patchRequest: 'refused' });
  });

  it('a client that can no longer pay breaks the deal for free', () => {
    const { w: start, npc } = brokenNpc();
    forceOption('patchDeal', 'paid');
    let w = endTurn(start, testDrive);
    w = answer(answer(w, 'What are you offering?'), 'Deal. Stay where you are.');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    Object.assign(deal, { deal: 'paid', price: Math.max(deal.price, 1) });
    find(w, npc.id).resources!.money = 0;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 38, y: 30 } });
    const r = runUntil(w, 40, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null);
    w = r.w;
    expect(patchOutcomes(r.events).filter((o) => o !== 'started')).toEqual(['broken']);
    expect(find(w, npc.id).resources!.money).toBe(0);
    expect(isStranded(w, find(w, npc.id))).toBe(true);
    expect(parts(playerVehicle(w))).toBe(4);
  });

  it('a deal nobody works on lapses for free', () => {
    const { w: start, npc } = brokenNpc();
    let w = endTurn(start, testDrive);
    w = answer(w, 'What are you offering?');
    w = answer(w, 'Deal. Stay where you are.');
    const money = w.player.money;
    const r = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null);
    expect(r.events.some((e) => e.t === 'patch' && e.outcome === 'lapsed')).toBe(true);
    expect(r.w.player.money).toBe(money);
    expect(parts(playerVehicle(r.w))).toBe(4);
    expect(topGoal(find(endTurn(r.w, testDrive), npc.id))?.kind).not.toBe('patch');
  });
});

describe('a holed fuel tank', () => {
  function holedNpc(fuel: number): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    w.player.autoRepair = false;
    setParts(w, playerVehicle(w), 4);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    corePart(npc, 'tank')!.hp = 0;
    npc.resources!.fuel = fuel;
    return { w, npc };
  }

  it('is patched once the leak has emptied the tank, and the truck stays stranded', () => {
    const { w: start, npc } = holedNpc(0);
    expect(needsPatch(start, npc)).toBe(true);
    forceOption('patchDeal', 'paid');
    let w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'patchRequest' });
    w = answer(answer(w, 'What are you offering?'), 'Deal. Stay where you are.');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    const money = w.player.money;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: 39.5, y: 30 } });
    w = runUntil(w, 60, (x) => stateOf(x, 'patch', x.player.vehicleId, npc.id) === null).w;
    const tank = corePart(find(w, npc.id), 'tank')!;
    expect(tank.hp).toBe(Math.max(1, Math.round(maxHp(tank) * PATCH.share)));
    expect(w.player.money).toBe(money + deal.price);
    expect(practiceOf(w, 'patch')).toHaveLength(1);
    expect(isStranded(w, find(w, npc.id))).toBe(true);
  });

  it('needs no patch while fuel is left, and never when junk', () => {
    const { w, npc } = holedNpc(10);
    expect(needsPatch(w, npc)).toBe(false);
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain('Your truck looks dead. Want me to patch it?');
    npc.resources!.fuel = 0;
    corePart(npc, 'tank')!.wear = CONDITION.maxWear + 1;
    expect(needsPatch(w, npc)).toBe(false);
  });

  it('gets no patch or aid offer and raises no request while on a tow rope', () => {
    const { w, npc } = holedNpc(0);
    npc.resources!.supplies = 0;
    const offers = ['Your truck looks dead. Want me to patch it?', 'Running low? I can spare some.'];
    expect(currentOptions(callVehicle(cloneWorld(w), npc.id)).map((o) => o.text)).toEqual(expect.arrayContaining(offers));
    const tower = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 44, y: 30 }, Math.PI);
    tower.trail = [{ x: tower.pos.x, y: tower.pos.y, heading: Math.PI }];
    const tow = addState(w, 'tow', tower.id, npc.id, { kind: 'tow', site: 'bowl', fee: 0, waived: 0, hitched: true });
    const texts = currentOptions(callVehicle(cloneWorld(w), npc.id)).map((o) => o.text);
    for (const offer of offers) expect(texts).not.toContain(offer);
    expect(endTurn(cloneWorld(w), testDrive).player.call?.topic).not.toBe('patchRequest');
    w.states.splice(w.states.indexOf(tow), 1);
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).toEqual(expect.arrayContaining(offers));
  });

  it('is fixed by a driver that carries enough parts, which asks no one', () => {
    const { w: start, npc } = holedNpc(0);
    addGoods(start, npc, 'parts', 6);
    const w = endTurn(start, testDrive);
    expect(w.player.call).toBeNull();
    expect(find(w, npc.id).brain!.goals.some((g) => g.kind === 'repair')).toBe(true);
  });
});

describe('patch practice', () => {
  function settle(w: World, patcher: Vehicle, client: Vehicle): void {
    setParts(w, patcher, 1);
    breakEngine(client);
    settlePatch(w, addState(w, 'patch', patcher.id, client.id, { kind: 'patch', deal: 'free', parts: 1, partIds: [mountedParts(client, 'engine')[0].id], price: 0, work: 1, workLeft: 0 }));
  }

  it('pays the player for patching another truck', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 32, y: 30 });
    settle(w, playerVehicle(w), npc);
    expect(practiceOf(w, 'patch')).toMatchObject([{ amount: 1, difficulty: null }]);
    expect(practiceOf(w, 'deal')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('pays nothing when an NPC patches the player', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    settle(w, npc, playerVehicle(w));
    expect(practiceOf(w, 'patch')).toEqual([]);
    expect(practiceOf(w, 'deal')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('pays nothing when an NPC patches another NPC', () => {
    const w = emptyWorld();
    const patcher = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 50, y: 30 });
    const client = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 52, y: 30 });
    settle(w, patcher, client);
    expect(practiceOf(w, 'patch')).toEqual([]);
    expect(practiceOf(w, 'deal')).toEqual([]);
  });
});

describe('social on patch prices', () => {
  function laborPrice(w: World, npcId: string, social: number): number {
    const copy = cloneWorld(w);
    copy.player.ranks.social = social;
    forceOption('patchDeal', 'ownParts');
    const terms = patchTerms(copy, find(copy, npcId));
    if (terms?.kind !== 'deal' || terms.deal !== 'ownParts') throw new Error(`Expected own-parts terms, got ${JSON.stringify(terms)}`);
    return terms.price;
  }

  it('the player pays less for a patch at rank 5', () => {
    const { w, trader } = brokenPlayer(0);
    setParts(w, playerVehicle(w), 3);
    const base = laborPrice(w, trader.id, 0);
    const cut = 1 - 5 * SKILL_EFFECTS.social.patchPrice;
    expect(laborPrice(w, trader.id, 5)).toBe(Math.round(base * cut));
    expect(Math.round(base * cut)).toBeLessThan(base);
  });

  it('an NPC client pays the full price to a rank 5 player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.money = 10000;
    addGoods(w, npc, 'parts', 3);
    breakEngine(npc);
    expect(laborPrice(w, npc.id, 5)).toBe(laborPrice(w, npc.id, 0));
  });

  it("an NPC client pays for the player's parts at the base price", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.money = 10000;
    breakEngine(npc);
    setParts(w, playerVehicle(w), 3);
    const paidPrice = (social: number): number => {
      const copy = cloneWorld(w);
      copy.player.ranks.social = social;
      forceOption('patchDeal', 'paid');
      const terms = patchTerms(copy, find(copy, npc.id));
      if (terms?.kind !== 'deal' || terms.deal !== 'paid') throw new Error(`Expected paid terms, got ${JSON.stringify(terms)}`);
      return terms.price;
    };
    expect(paidPrice(5)).toBe(paidPrice(0));
  });
});


describe('road mechanic', () => {
  function brokenNpc(money: number): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.resources!.money = money;
    breakEngine(npc);
    setParts(w, playerVehicle(w), 3);
    return { w, npc };
  }

  function priceWith(w: World, npcId: string, deal: PatchDeal, perks: World['player']['perks']): number {
    const copy = cloneWorld(w);
    copy.player.perks = perks;
    forceOption('patchDeal', deal);
    const terms = patchTerms(copy, find(copy, npcId));
    if (terms?.kind !== 'deal' || terms.deal !== deal) throw new Error(`Expected ${deal} terms, got ${JSON.stringify(terms)}`);
    return terms.price;
  }

  it('an NPC client pays the perk multiple for a patch by the player', () => {
    const { w, npc } = brokenNpc(10000);
    const base = priceWith(w, npc.id, 'paid', []);
    expect(base).toBeGreaterThan(0);
    expect(priceWith(w, npc.id, 'paid', ['roadMechanic'])).toBe(Math.round(base * PERK_NUMBERS.roadMechanic.price));
  });

  it('an NPC that cannot pay the raised price gets no paid deal', () => {
    const { w, npc } = brokenNpc(10000);
    npc.resources!.money = priceWith(w, npc.id, 'paid', []);
    expect(dealAvailable('paid')(w, npc)).toBe(true);
    w.player.perks = ['roadMechanic'];
    expect(dealAvailable('paid')(w, npc)).toBe(false);
  });

  it('does not change the price the player pays an NPC patcher', () => {
    const { w, trader } = brokenPlayer(3);
    expect(priceWith(w, trader.id, 'paid', ['roadMechanic'])).toBe(priceWith(w, trader.id, 'paid', []));
  });
});

describe('patching a worn truck that still drives', () => {
  const OFFER = 'Your engine sounds rough. Want me to patch it before it quits?';
  const offered = (w: World, id: string) => currentOptions(callVehicle(cloneWorld(w), id)).map((o) => o.text).includes(OFFER);
  const target = (p: { defId: string; hp: number }) => Math.max(1, Math.round(partDef(p.defId).hp * PATCH.share));

  function wornNpc(): { w: World; npc: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    w.player.autoRepair = false;
    setParts(w, playerVehicle(w), 4);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 40, y: 30 }, Math.PI);
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    setParts(w, npc, 0);
    const engine = mountedParts(npc, 'engine')[0];
    engine.hp = Math.round(partDef(engine.defId).hp * 0.1);
    const driving = endTurn(w, testDrive);
    return { w: driving, npc: find(driving, npc.id) };
  }

  function agree(w: World, npcId: string, deal: PatchDeal): World {
    forceOption('patchDeal', deal);
    w = callVehicle(w, npcId);
    w = answer(w, OFFER);
    w = answer(w, 'What can you offer?');
    return answer(w, 'Deal. Pull over and wait.');
  }
  const patchOpen = (w: World, npcId: string) => stateOf(w, 'patch', w.player.vehicleId, npcId) !== null;

  it('lifts a worn engine to the patch target, once paid', () => {
    const { w: start, npc } = wornNpc();
    expect(isStranded(start, npc)).toBe(false);
    const before = topGoal(npc)?.kind;
    let w = agree(start, npc.id, 'paid');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    expect(topGoal(find(w, npc.id))?.kind).toBe('patch');
    const money = w.player.money;
    const npcMoney = find(w, npc.id).resources!.money;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: find(w, npc.id).pos.x - 1.5, y: find(w, npc.id).pos.y } });
    w = runUntil(w, 60, (x) => !patchOpen(x, npc.id)).w;
    const engine = mountedParts(find(w, npc.id), 'engine')[0];
    expect(engine.hp).toBe(target(engine));
    expect(parts(playerVehicle(w))).toBe(4 - deal.parts);
    expect(w.player.money).toBe(money + deal.price);
    expect(find(w, npc.id).resources!.money).toBe(npcMoney - deal.price);
    expect(practiceOf(w, 'patch')).toHaveLength(1);
    w = runUntil(w, 3, (x) => topGoal(find(x, npc.id))?.kind !== 'patch').w;
    expect(topGoal(find(w, npc.id))?.kind).toBe(before);
  });

  it('gives the goal back when the deal lapses unworked', () => {
    const { w: start, npc } = wornNpc();
    const before = topGoal(npc)?.kind;
    let w = agree(start, npc.id, 'paid');
    w = runUntil(w, 80, (x) => !patchOpen(x, npc.id)).w;
    expect(mountedParts(find(w, npc.id), 'engine')[0].hp).toBeLessThan(target(mountedParts(npc, 'engine')[0]));
    w = runUntil(w, 3, (x) => topGoal(find(x, npc.id))?.kind !== 'patch').w;
    expect(topGoal(find(w, npc.id))?.kind).toBe(before);
  });

  it('gives the goal back when combat breaks the deal', () => {
    const { w: start, npc } = wornNpc();
    const before = topGoal(npc)?.kind;
    let w = agree(start, npc.id, 'paid');
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 50, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    startCombat(w, find(w, npc.id), raider);
    w = runUntil(w, 5, (x) => !patchOpen(x, npc.id)).w;
    expect(patchOpen(w, npc.id)).toBe(false);
    expect(topGoal(find(w, npc.id))?.kind).not.toBe('patch');
    expect(before).not.toBe('patch');
  });

  it('seals a holed tank that still holds fuel', () => {
    const { w: start, npc } = wornNpc();
    mountedParts(npc, 'engine')[0].hp = partDef('stockEngine').hp;
    corePart(npc, 'tank')!.hp = 0;
    npc.resources!.fuel = 10;
    expect(isStranded(start, npc)).toBe(false);
    let w = agree(start, npc.id, 'free');
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: find(w, npc.id).pos.x - 1.5, y: find(w, npc.id).pos.y } });
    w = runUntil(w, 60, (x) => !patchOpen(x, npc.id)).w;
    const tank = corePart(find(w, npc.id), 'tank')!;
    expect(tank.hp).toBe(target(tank));
  });

  it('a holed-tank client that strands mid-deal still gets its agreed parts', () => {
    const { w: start, npc } = wornNpc();
    corePart(npc, 'tank')!.hp = 0;
    npc.resources!.fuel = 4;
    const money = npc.resources!.money;
    let w = agree(start, npc.id, 'paid');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: find(w, npc.id).pos.x - 1.5, y: find(w, npc.id).pos.y } });
    w = runUntil(w, 80, (x) => !patchOpen(x, npc.id)).w;
    const after = find(w, npc.id);
    expect(mountedParts(after, 'engine')[0].hp).toBe(target(mountedParts(after, 'engine')[0]));
    expect(corePart(after, 'tank')!.hp).toBe(target(corePart(after, 'tank')!));
    expect(after.resources!.money).toBe(money - deal.price);
  });

  it('a Machining rank bought mid-deal leaves a worn patch intact', () => {
    const { w: start, npc } = wornNpc();
    let w = agree(start, npc.id, 'paid');
    const deal = patchData(stateOf(w, 'patch', w.player.vehicleId, npc.id)!);
    const money = w.player.money;
    w.player.ranks.machining = 3;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: find(w, npc.id).pos.x - 1.5, y: find(w, npc.id).pos.y } });
    const r = runUntil(w, 60, (x) => !patchOpen(x, npc.id));
    expect(patchOutcomes(r.events)).toEqual(['started', 'done']);
    expect(w.player.money).toBe(money);
    expect(r.w.player.money).toBe(money + deal.price);
    expect(mountedParts(find(r.w, npc.id), 'engine')[0].hp).toBe(target(mountedParts(npc, 'engine')[0]));
  });

  it('a part worn after agreement is not patched', () => {
    const { w: start, npc } = wornNpc();
    let w = agree(start, npc.id, 'paid');
    const tr = corePart(find(w, npc.id), 'transmission');
    if (tr) tr.hp = 1;
    w = setMoveOrder(w, { kind: 'stopAt', dest: { x: find(w, npc.id).pos.x - 1.5, y: find(w, npc.id).pos.y } });
    w = runUntil(w, 60, (x) => !patchOpen(x, npc.id)).w;
    const engine = mountedParts(find(w, npc.id), 'engine')[0];
    expect(engine.hp).toBe(target(engine));
    const after = corePart(find(w, npc.id), 'transmission');
    if (after) expect(after.hp).toBe(1);
  });

  it('an agreed part already above target at settle is not lowered', () => {
    const { w, npc } = wornNpc();
    const engine = mountedParts(npc, 'engine')[0];
    const above = target(engine) + 5;
    engine.hp = above;
    settlePatch(w, addState(w, 'patch', w.player.vehicleId, npc.id, { kind: 'patch', deal: 'free', parts: 0, partIds: [engine.id], price: 0, work: 1, workLeft: 0 }));
    expect(engine.hp).toBe(above);
  });

  it('refuses to agree a patch with nothing to patch', () => {
    const { w, npc } = wornNpc();
    mountedParts(npc, 'engine')[0].hp = partDef('stockEngine').hp;
    expect(() => agreePatch(w, npc, { kind: 'deal', deal: 'free', patcher: 'player', price: 0, parts: 1, turns: 2 })).toThrow(/nothing to patch/);
  });

  it('offers nothing for a healthy, sound, junk, self-fixing, towing or player-stranded case', () => {
    const { w, npc } = wornNpc();
    expect(offered(w, npc.id)).toBe(true);
    const engine = mountedParts(npc, 'engine')[0];
    const cases: [string, (x: World, n: Vehicle) => void][] = [
      ['healthy', (_x, n) => { mountedParts(n, 'engine')[0].hp = partDef('stockEngine').hp; }],
      ['at target', (_x, n) => { const e = mountedParts(n, 'engine')[0]; e.hp = target(e); }],
      ['junk', (_x, n) => { mountedParts(n, 'engine')[0].wear = CONDITION.maxWear + 1; }],
      ['self-fixing', (x, n) => addGoods(x, n, 'parts', 6)],
      ['towing', (x, n) => { const o = addVehicle(x, 'traders', 'hauler', ['stockEngine'], { x: 20, y: 30 }, 0); addState(x, 'tow', n.id, o.id, { kind: 'tow', site: 'bowl', fee: 0, waived: 0, hitched: true }); }],
      ['stranded player', (x) => breakEngine(playerVehicle(x))],
    ];
    for (const [name, change] of cases) {
      const x = cloneWorld(w);
      change(x, find(x, npc.id));
      expect(offered(x, npc.id), name).toBe(false);
    }
    expect(engine.hp).toBeLessThan(target(engine));
  });

  it('lists no terms when the player has no parts, and shows the back-out', () => {
    const { w: start, npc } = wornNpc();
    setParts(start, playerVehicle(start), 0);
    const w = answer(callVehicle(start, npc.id), OFFER);
    expect(currentOptions(w).map((o) => o.text)).toContain('On second thought, I cannot.');
  });

  it('keeps stranded terms to the broken part only', () => {
    const { w, npc } = wornNpc();
    breakEngine(npc);
    const tr = corePart(npc, 'transmission');
    if (tr) tr.hp = 1;
    expect(patchTerms(w, npc)).toMatchObject({ kind: 'deal' });
    const engine = mountedParts(npc, 'engine')[0];
    settlePatch(w, addState(w, 'patch', w.player.vehicleId, npc.id, { kind: 'patch', deal: 'free', parts: 0, partIds: [engine.id], price: 0, work: 1, workLeft: 0 }));
    expect(engine.hp).toBe(target(engine));
    if (tr) expect(tr.hp).toBe(1);
  });

  it('a stranded player asking a worn driver stays the client', () => {
    const { w, npc } = wornNpc();
    breakEngine(playerVehicle(w));
    setParts(w, playerVehicle(w), 0);
    setParts(w, npc, 4);
    const asked = callVehicle(w, npc.id);
    expect(currentOptions(asked).map((o) => o.text)).toContain('My truck is broken down. Can you patch it?');
    expect(dealAvailable('free')(w, npc)).toBe(true);
    expect(patchTerms(w, npc)).toMatchObject({ patcher: 'npc' });
  });
});
