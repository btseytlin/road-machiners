import { NPCS } from '../data/npcs';
import { describe, expect, it } from 'vitest';
import { SALVAGE } from '../data/salvage';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { beginSearch, startSearch } from './search';
import { addVehicle, emptyWorld, npcBrain, practiceOf, spotWorld, testDrive } from './testkit';
import { propReach } from './mapgen';
import { spotTable } from './territory';
import { goodsCount } from './grid';
import { suppliesCap } from './stats';
import { canLoot, canScavenge, lootBlockerHere, salvageListNear, scavenge, takeAllLoot, takeLoot, takeStores } from './locations';
import { resolveNpcActivities } from './npc-activities';
import { refreshVision } from './vision';
import { findSpot, gridOf } from './grid';
import { endTurn, setMoveOrder } from './world';
import { advanceJobs, isBusy, startAutoRepair } from './jobs';
import { addGoods } from './inventory';
import { canTakeAny, collectSalvage, createWreckSalvage, dumpOnPile, emptyHidden, hiddenUnits, isRoadWreck, renewSalvage, revealTurn, wreckStockId } from './salvage';
import { SEARCH, WORK } from '../data/utilities';
import { TIME } from '../data/time';
import { cloneWorld } from './world';
import type { HiddenLoot, Job, SalvageStock, Vehicle, World } from './types';
import type { Vec } from './vec';
import { mountedParts } from './grid';
import { Refused } from './world';

// The refusal a command throws, so a test can check what it names.
function refusalOf(command: () => unknown): unknown {
  try {
    command();
  } catch (err) {
    if (err instanceof Refused) return err.refusal;
    throw err;
  }
  throw new Error('The command was not refused');
}

describe('timed scavenging search', () => {
  it('replaces a running auto patch', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.speed = 0;
    mountedParts(me)[0].hp = 1;
    addGoods(w, me, 'parts', 5);
    startAutoRepair(w);
    expect(me.job).toEqual(expect.objectContaining({ kind: 'repair', auto: true }));
    expect(isBusy(me)).toBe(false);
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [], hidden: emptyHidden() });
    const next = scavenge(w, 'rich');
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search' }));
    expect(next.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled', job: expect.objectContaining({ auto: true }) }));
  });

  it('an NPC nudged out of reach of its stock cancels the search instead of failing', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 50, y: 50 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn }, parts: [], hidden: emptyHidden() });
    const npc = addVehicle(w, 'scavengers', 'scout', [], { x: 50, y: 51 });
    npc.brain = npcBrain('trader', npc.pos, ['raider']);
    beginSearch(w, npc, 'rich');
    npc.pos = { x: 50, y: 70 };
    advanceJobs(w);
    expect(npc.job).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled' }));
  });

  it('takes turns in proportion to the stock, then opens it for looting', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [], hidden: emptyHidden() });
    let next = scavenge(w, 'rich');
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 3, total: 3 }));
    let turns = 0;
    while (next.vehicles[0].job) {
      next = endTurn(next, testDrive);
      if (++turns > 20) throw new Error('search never finished');
    }
    expect(turns).toBe(3);
    expect(next.events).toContainEqual({ t: 'searched', stock: 'rich' });
    expect(canLoot(next, 'rich')).toBe(true);
    expect(canScavenge(next, 'rich')).toBe(false);
  });

  it('searches a pile in one turn, however big', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const pile = { until: w.turn + SALVAGE.pileTurns, fromPlayer: false, basis: {} };
    w.salvage.push({ id: 'pile', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [], pile, hidden: emptyHidden() });
    const next = endTurn(scavenge(w, 'pile'), testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.events).toContainEqual({ t: 'searched', stock: 'pile' });
  });

  it('a move cancels the search, and the stock stays closed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [], hidden: emptyHidden() });
    let next = endTurn(scavenge(w, 'rich'), testDrive);
    next = setMoveOrder(next, { kind: 'through', dest: { x: 60, y: 30 } });
    for (let t = 0; t < 5 && next.vehicles[0].job; t++) next = endTurn(next, testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.player.scavenged).not.toContain('rich');
  });

  it('takes one loot item into a chosen cell, and never more than the stock holds', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part');
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() });
    w.player.scavenged.push('rich');
    const spot = findSpot(gridOf(w.vehicles[0]), w.vehicles[0].items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    const next = takeLoot(w, 'rich', { kind: 'good', good: 'scrap' }, spot);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(1);
    expect(next.salvage.find((s) => s.id === 'rich')!.goods.scrap).toBe(0);
    expect(() => takeLoot(next, 'rich', { kind: 'good', good: 'scrap' }, spot)).toThrow();
  });

  it('takes five turns to install salvage and leaves the part in stock until completion', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part], hidden: emptyHidden() });
    w.player.scavenged.push('weapon-stock');
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: 5 });
    for (let turn = 0; turn < 4; turn++) advanceJobs(next);
    expect(next.salvage.find((stock) => stock.id === 'weapon-stock')?.parts).toHaveLength(1);
    advanceJobs(next);
    expect(next.salvage.find((stock) => stock.id === 'weapon-stock')?.parts).toHaveLength(0);
    expect(next.vehicles[0].items.some((item) => item.kind === 'part' && item.part.id === weapon.part.id)).toBe(true);
  });

  it.each(['movement', 'missing part', 'missing stock'])('cancels salvage installation after %s without duplicating the part', (reason) => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part], hidden: emptyHidden() });
    w.player.scavenged.push('weapon-stock');
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    const stock = next.salvage.find((entry) => entry.id === 'weapon-stock');
    if (!stock) throw new Error('Expected stock');
    if (reason === 'movement') next.vehicles[0].speed = 5;
    if (reason === 'missing part') stock.parts = [];
    if (reason === 'missing stock') next.salvage = next.salvage.filter((entry) => entry.id !== stock.id);
    advanceJobs(next);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.vehicles[0].items.some((item) => item.kind === 'part' && item.part.id === weapon.part.id)).toBe(false);
    if (reason === 'movement') expect(stock.parts).toHaveLength(1);
  });

  it('refuses loot from a stock that was never searched', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 2 }, parts: [], hidden: emptyHidden() });
    expect(() => takeAllLoot(w, 'rich')).toThrow(/Search/);
  });

  it('lets an NPC scavenger finish a search job', () => {
    const { w, spot } = spotWorld();
    w.vehicles[0].pos = { x: 60, y: 60 };
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    for (const key of Object.keys(NPCS)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    npc.pos = { x: spot.pos.x + propReach(spot) + 1, y: spot.pos.y };
    npc.heading = Math.PI;
    npc.resources!.fuel = 20;
    let cur = w;
    let sawJob = false;
    let finished = false;
    for (let t = 0; t < 800; t++) {
      cur = endTurn(cur, testDrive);
      const actor = cur.vehicles.find((v) => v.id === npc.id)!;
      if (actor.job?.kind === 'search') sawJob = true;
      if (sawJob && !actor.job) { finished = true; break; }
    }
    expect(sawJob).toBe(true);
    expect(finished).toBe(true);
  });
});

describe('machining on searches', () => {
  it('searches in fewer turns for the player at rank 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [], hidden: emptyHidden() });
    w.player.ranks.machining = 5;
    const turns = Math.ceil(5 * (1 - 5 * SKILL_EFFECTS.machining.search));
    expect(scavenge(w, 'rich').vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: turns, total: turns }));
  });

  it('still takes at least one turn at rank 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'small', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() });
    w.player.ranks.machining = 5;
    expect(scavenge(w, 'small').vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 1, total: 1 }));
  });

  it('leaves NPC searches at full length', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    w.salvage.push({ id: 'rich', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [], hidden: emptyHidden() });
    w.player.ranks.machining = 5;
    beginSearch(w, npc, 'rich');
    expect(npc.job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 5, total: 5 }));
  });

  it('installs salvage in one job with the Cannibal perk', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part], hidden: emptyHidden() });
    w.player.scavenged.push('weapon-stock');
    w.player.perks = ['cannibal'];
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    const turns = PERK_NUMBERS.cannibal.turns;
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
  });

  it('installs salvage in fewer turns for the player at rank 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part], hidden: emptyHidden() });
    w.player.scavenged.push('weapon-stock');
    w.player.ranks.machining = 5;
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    const turns = Math.ceil(RULES.refitTurnsPerPart * WORK.noCraneTime * (1 - 5 * SKILL_EFFECTS.machining.refit));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
  });
});

describe('one looter per wreck, for the player', () => {
  function sharedWreck() {
    const w = emptyWorld({ x: 30, y: 30 });
    const wreck = { id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [], fuel: 2, hidden: emptyHidden() };
    w.salvage.push(wreck);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 31.5, y: 30 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    return { w, wreck, npc };
  }

  const scrapSpot = (w: ReturnType<typeof emptyWorld>) =>
    findSpot(gridOf(w.vehicles[0]), w.vehicles[0].items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;

  it('refuses a search while another driver searches the wreck, and names the driver', () => {
    const { w, wreck, npc } = sharedWreck();
    beginSearch(w, npc, wreck.id);
    expect(canScavenge(w, wreck.id)).toBe(false);
    expect(lootBlockerHere(w, wreck.id)).toBe(npc);
    const looting = { id: 'looting', by: npc.id, place: 'wreck' };
    expect(refusalOf(() => scavenge(w, wreck.id))).toEqual(looting);
    expect(refusalOf(() => startSearch(w, wreck.id))).toEqual(looting);
  });

  it('refuses to take from a searched wreck while another driver searches it', () => {
    const { w, wreck, npc } = sharedWreck();
    w.player.scavenged.push(wreck.id);
    beginSearch(w, npc, wreck.id);
    const looting = { id: 'looting', by: npc.id, place: 'wreck' };
    expect(refusalOf(() => takeLoot(w, wreck.id, { kind: 'good', good: 'scrap' }, scrapSpot(w)))).toEqual(looting);
    expect(refusalOf(() => takeAllLoot(w, wreck.id))).toEqual(looting);
    expect(refusalOf(() => takeStores(w, wreck.id))).toEqual(looting);
    expect(wreck.goods.scrap).toBe(SALVAGE.unitsPerTurn * 3);
    expect(wreck.fuel).toBe(2);
  });

  it('keeps a player pile dropped on a wreck apart from the wreck', () => {
    const { w, wreck } = sharedWreck();
    const me = w.vehicles[0];
    const pile = dumpOnPile(w, me, me.items.find((item) => item.kind === 'good') ?? me.items[0]);
    expect(salvageListNear(w).map((s) => s.id)).toEqual(expect.arrayContaining([wreck.id, pile.id]));
    expect(canScavenge(w, pile.id)).toBe(false);
    expect(canLoot(w, pile.id)).toBe(true);
    expect(canLoot(w, wreck.id)).toBe(false);
    expect(scavenge(w, wreck.id).vehicles[0].job).toMatchObject({ kind: 'search', stockId: wreck.id });
  });

  it('searches and loots once the other driver is gone', () => {
    const { w, wreck, npc } = sharedWreck();
    beginSearch(w, npc, wreck.id);
    w.vehicles = w.vehicles.filter((v) => v.id !== npc.id);
    expect(lootBlockerHere(w, wreck.id)).toBeNull();
    expect(scavenge(w, wreck.id).vehicles[0].job).toMatchObject({ kind: 'search', stockId: wreck.id });
    w.player.scavenged.push(wreck.id);
    expect(goodsCount(takeAllLoot(w, wreck.id).vehicles[0]).scrap).toBeGreaterThan(0);
  });

  it('keeps an arriving driver from starting at a wreck the parked player holds', () => {
    const { w, wreck, npc } = sharedWreck();
    npc.brain!.goals = [{ kind: 'loot', targetId: wreck.id, destination: { ...wreck.pos }, phase: 'travel', reason: 'lootDowned' }];
    refreshVision(w);
    resolveNpcActivities(w);
    expect(npc.job).toBeNull();
    expect(npc.brain!.goals).toEqual([]);
    expect(canScavenge(w, wreck.id)).toBe(true);
  });

  it('lets one truck at a time search a loot spot', () => {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos };
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: propReach(spot), goods: { scrap: 4 }, parts: [], hidden: emptyHidden() }];
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { ...site.pos });
    beginSearch(w, npc, site.id);
    expect(lootBlockerHere(w, site.id)?.id).toBe(npc.id);
    expect(canScavenge(w, site.id)).toBe(false);
  });
});

function hiddenStock(id: string, pos: Vec, hidden: Partial<HiddenLoot>): SalvageStock {
  return { id, pos: { ...pos }, radius: 1, goods: {}, parts: [], fuel: 0, supplies: 0, hidden: { ...emptyHidden(), ...hidden } };
}

const sum = (goods: Record<string, number>) => Object.values(goods).reduce((a, b) => a + b, 0);

function stockTotal(s: SalvageStock): number {
  const h = s.hidden;
  return sum(s.goods) + s.parts.length + (s.fuel ?? 0) + (s.supplies ?? 0) + sum(h.goods) + h.parts.length + h.fuel + h.supplies;
}

function searchJob(v: Vehicle): Extract<Job, { kind: 'search' }> {
  if (v.job?.kind !== 'search') throw new Error('Expected a search job');
  return v.job;
}

describe('finite hidden salvage', () => {
  it('rolls spot and road wreck stock into hidden, and leaves the revealed loot empty', () => {
    const { w, stock } = spotWorld();
    const rolled = [stock, ...w.salvage.filter((s) => isRoadWreck(s))];
    expect(rolled.length).toBeGreaterThan(0);
    for (const s of rolled) {
      expect(s.goods).toEqual({});
      expect(s.parts).toEqual([]);
      expect(hiddenUnits(s)).toBeGreaterThan(0);
    }
  });

  it('leaves a destroyed truck wreck fully revealed', () => {
    const w = emptyWorld();
    const npc = addVehicle(w, 'raiders', 'scout', ['mg'], { x: 40, y: 30 });
    createWreckSalvage(w, npc);
    const wreck = w.salvage.find((s) => s.id === wreckStockId(npc.id))!;
    expect(wreck.hidden).toEqual(emptyHidden());
    expect(wreck.parts.length).toBeGreaterThan(0);
  });

  it('reveals from hidden only and conserves the total', () => {
    const w = emptyWorld();
    const s = hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: 20 }, fuel: 5, supplies: 2 });
    s.goods.water = 3;
    const total = stockTotal(s);
    const found = revealTurn(w, s, 0.5);
    expect(stockTotal(s)).toBe(total);
    expect(s.goods.water).toBe(3);
    expect(s.goods.scrap ?? 0).toBe(found.goods.scrap ?? 0);
    expect(s.hidden.goods.scrap).toBe(20 - (found.goods.scrap ?? 0));
    expect(s.fuel).toBe(found.fuel);
    expect(s.hidden.fuel).toBe(5 - found.fuel);
  });

  it('reveals each unit at the given chance, from the search stream only', () => {
    const w = emptyWorld();
    const s = hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: 3 }, supplies: 2 });
    const worldRoll = w.rngState;
    revealTurn(w, s, 0);
    expect(hiddenUnits(s)).toBe(4);
    revealTurn(w, s, 1);
    expect(hiddenUnits(s)).toBe(0);
    expect(s.goods.scrap).toBe(3);
    expect(s.supplies).toBe(2);
    expect(w.rngState).toBe(worldRoll);
  });

  it('finds more on a turn when more is hidden', () => {
    const w = emptyWorld();
    const finds = (units: number) => {
      let found = 0;
      for (let trial = 0; trial < 200; trial++) found += revealTurn(w, hiddenStock('s', { x: 0, y: 0 }, { goods: { scrap: units } }), SEARCH.reveal).goods.scrap ?? 0;
      return found / 200;
    };
    const few = finds(10);
    const many = finds(40);
    expect(many).toBeGreaterThan(few * 3);
    expect(few).toBeCloseTo(10 * SEARCH.reveal, 0);
  });

  it('reveals at the scraper chance with a working scraper, and never yields more than the stock', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const plain = addVehicle(w, 'traders', 'hauler', [], { x: 10, y: 10 });
    const knife = addVehicle(w, 'traders', 'hauler', ['scrapersKnife'], { x: 20, y: 10 });
    w.salvage.push(hiddenStock('a', plain.pos, { goods: { scrap: 2000 } }), hiddenStock('b', knife.pos, { goods: { scrap: 2000 } }));
    beginSearch(w, plain, 'a');
    beginSearch(w, knife, 'b');
    advanceJobs(w);
    const revealed = (id: string) => w.salvage.find((s) => s.id === id)!.goods.scrap / 2000;
    expect(revealed('a')).toBeCloseTo(SEARCH.reveal, 1);
    expect(revealed('b')).toBeCloseTo(SEARCH.scraperReveal, 1);
    for (let turn = 0; turn < 2000 && knife.job; turn++) advanceJobs(w);
    const b = w.salvage.find((s) => s.id === 'b')!;
    expect(goodsCount(knife).scrap ?? 0).toBeLessThanOrEqual(2000);
    expect((goodsCount(knife).scrap ?? 0) + stockTotal(b)).toBe(2000);
  });

  it('job length counts hidden units, or the revealed ones when nothing is hidden', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const s = hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: SALVAGE.unitsPerTurn * 4 } });
    s.goods.scrap = SALVAGE.unitsPerTurn * 10;
    w.salvage.push(s);
    expect(searchJob(scavenge(w, 'rich').vehicles[0]).total).toBe(4);
    s.hidden = emptyHidden();
    expect(searchJob(scavenge(w, 'rich').vehicles[0]).total).toBe(10);
  });

  it('logs what each search turn finds for the player', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push(hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: 400 } }));
    const next = endTurn(scavenge(w, 'rich'), testDrive);
    const found = next.events.find((e) => e.t === 'found');
    expect(found).toMatchObject({ t: 'found', vehicle: next.player.vehicleId, stock: 'rich' });
    expect(next.salvage.find((s) => s.id === 'rich')!.goods.scrap).toBe(found?.t === 'found' ? found.goods.scrap : -1);
  });

  it('lets the player search again while hidden units remain, and loot only revealed loot', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const s = hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: 4 } });
    w.salvage.push(s);
    w.player.scavenged.push('rich');
    expect(canScavenge(w, 'rich')).toBe(true);
    expect(canLoot(w, 'rich')).toBe(false);
    s.goods.scrap = 1;
    expect(canLoot(w, 'rich')).toBe(true);
    s.hidden = emptyHidden();
    expect(canScavenge(w, 'rich')).toBe(false);
    expect(canLoot(w, 'rich')).toBe(true);
  });

  it('pays search XP once, on the first search of a stock', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push(hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: 200 } }));
    let next = scavenge(w, 'rich');
    next.vehicles[0].job = { ...searchJob(next.vehicles[0]), turnsLeft: 1 };
    next = endTurn(next, testDrive);
    expect(practiceOf(next, 'search')).toHaveLength(1);
    next = scavenge(next, 'rich');
    next.vehicles[0].job = { ...searchJob(next.vehicles[0]), turnsLeft: 1 };
    next = endTurn(next, testDrive);
    expect(practiceOf(next, 'search')).toHaveLength(0);
  });

  it('two searchers on one shared site never take more than its total', () => {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos };
    w.salvage = [{ ...hiddenStock(site.id, site.pos, { goods: { scrap: 30 }, fuel: 4 }), radius: propReach(spot) }];
    const me = w.vehicles[0];
    me.items = me.items.filter((item) => item.kind === 'part');
    const npc = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], { ...me.pos });
    for (let round = 0; round < 40 && hiddenUnits(w.salvage[0]) > 0; round++) {
      if (!me.job) beginSearch(w, me, site.id);
      if (!npc.job) beginSearch(w, npc, site.id);
      advanceJobs(w);
    }
    w.player.scavenged.push(site.id);
    collectSalvage(w, me, site.id, Infinity);
    const taken = (goodsCount(me).scrap ?? 0) + (goodsCount(npc).scrap ?? 0);
    expect(hiddenUnits(w.salvage[0])).toBe(0);
    expect(taken + (w.salvage[0].goods.scrap ?? 0)).toBe(30);
  });

  it('an NPC takes only the revealed loot when its search ends, and leaves the hidden rest', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], { x: 10, y: 10 });
    const s = hiddenStock('rich', npc.pos, { goods: { scrap: 10 } });
    w.salvage.push(s);
    beginSearch(w, npc, 'rich');
    searchJob(npc).turnsLeft = 1;
    advanceJobs(w);
    expect(npc.job).toBeNull();
    expect(s.hidden.goods.scrap).toBeGreaterThan(0);
    expect(goodsCount(npc).scrap).toBeGreaterThan(0);
    expect(goodsCount(npc).scrap).toBe(10 - s.hidden.goods.scrap);
  });

  it('an NPC searches a stock with only hidden units, and gives up an empty one', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    const s = hiddenStock('wreck950', npc.pos, { goods: { scrap: 6 } });
    w.salvage.push(s);
    expect(canTakeAny(w, npc, s)).toBe(true);
    npc.brain.goals = [{ kind: 'loot', targetId: s.id, destination: { ...s.pos }, phase: 'travel', reason: 'lootOnTheWay' }];
    refreshVision(w);
    resolveNpcActivities(w);
    expect(npc.job).toMatchObject({ kind: 'search', stockId: s.id });
    npc.job = null;
    s.hidden = emptyHidden();
    resolveNpcActivities(w);
    expect(npc.brain.goals).toEqual([]);
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'activity', vehicle: npc.id, reason: 'salvageExhausted' }));
  });

  it('restocks a spot into hidden, capped against hidden plus revealed', () => {
    const { w, spot } = spotWorld();
    const full = w.salvage[0];
    full.hidden = emptyHidden();
    full.goods = {};
    full.parts = [];
    full.fuel = 0;
    full.supplies = 0;
    w.turn = TIME.turnsPerDay;
    renewSalvage(w);
    expect(hiddenUnits(full) > 0).toBe(true);
    expect(full.goods).toEqual({});
    expect(full.parts).toEqual([]);
    const table = spotTable(spot);
    full.hidden = emptyHidden();
    full.goods = { parts: table.parts[1] };
    w.turn = TIME.turnsPerDay * 2;
    renewSalvage(w);
    expect(full.hidden.goods.parts ?? 0).toBe(0);
  });

  it('keeps a road wreck with hidden loot from counting as looted', () => {
    const w = emptyWorld();
    const wreck = hiddenStock('wreck950', { x: 80, y: 80 }, { goods: { scrap: 2 } });
    w.salvage.push(wreck);
    w.turn = TIME.turnsPerDay;
    renewSalvage(w);
    expect(wreck.emptySince).toBeUndefined();
  });

  it('keeps hidden, revealed, the job and the search stream across a save and load mid-search', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push(hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: 12, water: 5 }, fuel: 3 }));
    const mid = endTurn(scavenge(w, 'rich'), testDrive);
    const saved = JSON.parse(JSON.stringify({ salvage: mid.salvage, vehicles: mid.vehicles, searchRng: mid.searchRng })) as Pick<World, 'salvage' | 'vehicles' | 'searchRng'>;
    const loaded: World = { ...cloneWorld(mid), ...saved };
    expect(loaded.salvage).toEqual(mid.salvage);
    expect(loaded.vehicles[0].job).toEqual(mid.vehicles[0].job);
    expect(loaded.searchRng).toEqual(mid.searchRng);
    let a = mid;
    let b = loaded;
    for (let turn = 0; turn < 10; turn++) { a = endTurn(a, testDrive); b = endTurn(b, testDrive); }
    expect(b.salvage).toEqual(a.salvage);
    expect(b.searchRng).toEqual(a.searchRng);
  });

  it('searches again past revealed supplies the full tank cannot take', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    me.speed = 0;
    w.player.supplies = suppliesCap(me);
    const stock = hiddenStock('rich', { x: 30, y: 30 }, { goods: { scrap: SALVAGE.unitsPerTurn * 2 } });
    stock.supplies = 20;
    w.salvage.push(stock);
    w.player.scavenged.push('rich');
    expect(canScavenge(w, 'rich')).toBe(true);
    const before = stockTotal(stock) + (goodsCount(me).scrap ?? 0);
    let next = scavenge(w, 'rich');
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search' }));
    for (let turns = 0; next.vehicles[0].job; turns++) {
      next = endTurn(next, testDrive);
      if (turns > 20) throw new Error('search never finished');
    }
    const after = next.salvage.find((entry) => entry.id === 'rich')!;
    expect(after.supplies).toBe(20);
    expect(next.player.supplies).toBeLessThanOrEqual(suppliesCap(next.vehicles[0]));
    expect(stockTotal(after) + (goodsCount(next.vehicles[0]).scrap ?? 0)).toBe(before);
  });
});
