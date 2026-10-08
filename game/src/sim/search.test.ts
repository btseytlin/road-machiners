import { NPCS } from '../data/npcs';
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { SALVAGE } from '../data/salvage';
import { RULES } from '../data/rules';
import { PERK_NUMBERS, SKILL_EFFECTS } from '../data/skills';
import { beginSearch, startSearch } from './search';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import { goodsCount } from './grid';
import { canLoot, canScavenge, lootBlockerHere, salvageListNear, scavenge, takeAllLoot, takeLoot, takeStores } from './locations';
import { resolveNpcActivities } from './npc-activities';
import { sitePads } from './sites';
import { refreshVision } from './vision';
import { findSpot, gridOf } from './grid';
import { endTurn, setMoveOrder } from './world';
import { advanceJobs, isBusy, startAutoRepair } from './jobs';
import { addGoods } from './inventory';
import { dumpOnPile } from './salvage';
import { mountedParts } from './grid';

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
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
    const next = scavenge(w, 'rich');
    expect(next.vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search' }));
    expect(next.events).toContainEqual(expect.objectContaining({ t: 'job', outcome: 'cancelled', job: expect.objectContaining({ auto: true }) }));
  });

  it('an NPC nudged out of reach of its stock cancels the search instead of failing', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 50, y: 50 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn }, parts: [] });
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
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [] });
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
    w.salvage.push({ id: 'pile', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [], pile });
    const next = endTurn(scavenge(w, 'pile'), testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.events).toContainEqual({ t: 'searched', stock: 'pile' });
  });

  it('a move cancels the search, and the stock stays closed', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    let next = endTurn(scavenge(w, 'rich'), testDrive);
    next = setMoveOrder(next, { kind: 'through', dest: { x: 60, y: 30 } });
    for (let t = 0; t < 5 && next.vehicles[0].job; t++) next = endTurn(next, testDrive);
    expect(next.vehicles[0].job).toBeNull();
    expect(next.player.scavenged).not.toContain('rich');
  });

  it('takes one loot item into a chosen cell, and never more than the stock holds', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].items = w.vehicles[0].items.filter((item) => item.kind === 'part');
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.scavenged.push('rich');
    const spot = findSpot(gridOf(w.vehicles[0]), w.vehicles[0].items, { id: 'x', kind: 'good', good: 'scrap', x: 0, y: 0, rot: 0 }, null, null)!;
    const next = takeLoot(w, 'rich', { kind: 'good', good: 'scrap' }, spot);
    expect(goodsCount(next.vehicles[0]).scrap).toBe(1);
    expect(next.salvage.find((s) => s.id === 'rich')!.goods.scrap).toBe(0);
    expect(() => takeLoot(next, 'rich', { kind: 'good', good: 'scrap' }, spot)).toThrow();
  });

  it('takes three turns to install salvage and leaves the part in stock until completion', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const weapon = me.items.find((item) => item.kind === 'part' && item.part.defId === 'mg');
    if (!weapon || weapon.kind !== 'part') throw new Error('Expected weapon');
    me.items = me.items.filter((item) => item.id !== weapon.id);
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
    w.player.scavenged.push('weapon-stock');
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: 3 });
    for (let turn = 0; turn < 2; turn++) advanceJobs(next);
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
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
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
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 2 }, parts: [] });
    expect(() => takeAllLoot(w, 'rich')).toThrow(/Search/);
  });

  it('lets an NPC scavenger finish a search job', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    for (const key of Object.keys(NPCS)) w.spawnTimer[key] = Number.MAX_SAFE_INTEGER;
    const convoy = REGION.locations.find((site) => site.kind === 'convoy')!;
    npc.pos = { x: convoy.pos.x + convoy.radius + 1, y: convoy.pos.y };
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
    w.salvage.push({ id: 'rich', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
    w.player.ranks.machining = 5;
    const turns = Math.ceil(5 * (1 - 5 * SKILL_EFFECTS.machining.search));
    expect(scavenge(w, 'rich').vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: turns, total: turns }));
  });

  it('still takes at least one turn at rank 5', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'small', pos: { x: 30, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [] });
    w.player.ranks.machining = 5;
    expect(scavenge(w, 'small').vehicles[0].job).toEqual(expect.objectContaining({ kind: 'search', turnsLeft: 1, total: 1 }));
  });

  it('leaves NPC searches at full length', () => {
    const w = emptyWorld({ x: 60, y: 60 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 10, y: 10 });
    w.salvage.push({ id: 'rich', pos: { x: 10, y: 10 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 5 }, parts: [] });
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
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
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
    w.salvage.push({ id: 'weapon-stock', pos: { ...me.pos }, radius: 1, goods: {}, parts: [weapon.part] });
    w.player.scavenged.push('weapon-stock');
    w.player.ranks.machining = 5;
    const next = takeLoot(w, 'weapon-stock', { kind: 'part', partId: weapon.part.id }, { x: weapon.x, y: weapon.y, rot: weapon.rot });
    const turns = Math.ceil(RULES.refitTurnsPerPart * (1 - 5 * SKILL_EFFECTS.machining.refit));
    expect(next.vehicles[0].job).toMatchObject({ kind: 'refit', turnsLeft: turns, total: turns });
  });
});

describe('one looter per wreck, for the player', () => {
  function sharedWreck() {
    const w = emptyWorld({ x: 30, y: 30 });
    const wreck = { id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: SALVAGE.unitsPerTurn * 3 }, parts: [], fuel: 2 };
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
    expect(() => scavenge(w, wreck.id)).toThrow(`${npc.name} is looting this wreck`);
    expect(() => startSearch(w, wreck.id)).toThrow(`${npc.name} is looting this wreck`);
  });

  it('refuses to take from a searched wreck while another driver searches it', () => {
    const { w, wreck, npc } = sharedWreck();
    w.player.scavenged.push(wreck.id);
    beginSearch(w, npc, wreck.id);
    const error = `${npc.name} is looting this wreck`;
    expect(() => takeLoot(w, wreck.id, { kind: 'good', good: 'scrap' }, scrapSpot(w))).toThrow(error);
    expect(() => takeAllLoot(w, wreck.id)).toThrow(error);
    expect(() => takeStores(w, wreck.id)).toThrow(error);
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
    npc.brain!.goals = [{ kind: 'loot', targetId: wreck.id, destination: { ...wreck.pos }, phase: 'travel', reason: 'test loot' }];
    refreshVision(w);
    resolveNpcActivities(w);
    expect(npc.job).toBeNull();
    expect(npc.brain!.goals).toEqual([]);
    expect(canScavenge(w, wreck.id)).toBe(true);
  });

  it('shares a salvage site with other searchers', () => {
    const site = REGION.locations.find((l) => l.id === 'podfield')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 4 }, parts: [] }];
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { ...site.pos });
    beginSearch(w, npc, site.id);
    expect(lootBlockerHere(w, site.id)).toBeNull();
    expect(canScavenge(w, site.id)).toBe(true);
  });
});
