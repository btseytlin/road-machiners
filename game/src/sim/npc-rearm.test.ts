import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOR, NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { advanceNpcKnockouts, isDefeated } from './defeat';
import { corePart, mountedParts } from './grid';
import { fitToHunt } from './npc-decisions';
import { resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { watchStalls } from './npc-watchdog';
import { liesUp } from './npc-service';
import { getResources } from './resources';
import { siteGates, sitePads } from './sites';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import { npcHomeSite } from './tow';
import type { PartInstance, Vehicle, World } from './types';
import { maxHp } from './wear';
import { cloneWorld } from './world';
import { dist, type Vec } from './vec';

const kiln = REGION.locations.find((l) => l.id === 'kiln')!;
const gate = siteGates(kiln)[0];

function outside(d: number): Vec {
  return { x: gate.x + ((gate.x - kiln.pos.x) / kiln.radius) * d, y: gate.y + ((gate.y - kiln.pos.y) / kiln.radius) * d };
}

function raider(): { w: World; v: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine', 'plates'], outside(20));
  v.brain = npcBrain('buggy', v.pos, NPCS.buggy.traits);
  return { w, v };
}

const gunsOf = (v: Vehicle): PartInstance[] => mountedParts(v, 'weapon');
const armorOf = (v: Vehicle): PartInstance[] => mountedParts(v, 'armor');

function crippleGear(v: Vehicle): void {
  for (const gun of gunsOf(v)) gun.hp = 0;
  for (const plate of armorOf(v)) plate.hp = Math.floor(maxHp(plate) * 0.2);
}

function parkAtCamp(v: Vehicle): void {
  v.pos = outside(1);
  v.speed = 0;
}

describe('a raider unfit to hunt', () => {
  it('drives to its camp for service when broke, with no cargo and a sound core, instead of raiding', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 0;
    forceOption('idle', 'raid');
    expect(corePart(v, 'cab').hp).toBe(maxHp(corePart(v, 'cab')));
    expect(fitToHunt(w, v)).toBe(false);
    expect(thinkNpc(w, v)).toMatchObject({ kind: 'resupply', targetId: 'kiln', reason: 'unfit to hunt' });
    expect(v.brain!.goals.map((g) => g.kind)).toEqual(['resupply']);
  });

  it('is repaired at camp, guns and armor included, when it can pay, and then may raid again', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 166667;
    expect(thinkNpc(w, v)).toMatchObject({ kind: 'resupply', targetId: 'kiln' });
    parkAtCamp(v);
    resolveNpcActivities(w);
    for (const part of [...gunsOf(v), ...armorOf(v)]) expect(part.hp).toBe(maxHp(part));
    expect(getResources(w, v).money).toBeLessThan(166667);
    expect(topGoal(v)).toBeNull();
    expect(fitToHunt(w, v)).toBe(true);
    forceOption('idle', 'raid');
    expect(thinkNpc(w, v).kind).toBe('raid');
  });
});

const RAIDER_LIE_UP = NPCS.buggy.cap * NPCS.buggy.interval;

const itemIds = (v: Vehicle): string[] => v.items.map((it) => it.id).sort();
const goalKinds = (v: Vehicle): string[] => v.brain!.goals.map((g) => g.kind);

function npcTurn(w: World, v: Vehicle): void {
  w.events = [];
  w.turn++;
  thinkNpc(w, v);
  const top = topGoal(v);
  if (top?.kind === 'rearm') v.pos = { ...top.destination! };
  if (top?.kind === 'retreat') v.pos = { ...sitePads(npcHomeSite(v)!)[0] };
  resolveNpcActivities(w);
  watchStalls(w);
  expect(w.events.filter((e) => e.t === 'stall')).toEqual([]);
}

function lieUpUntil(w: World, v: Vehicle, turn: number): void {
  const items = itemIds(v);
  while (w.turn < turn - 1) {
    npcTurn(w, v);
    expect(liesUp(v)).toBe(true);
    expect(goalKinds(v)).not.toContain('raid');
    expect(goalKinds(v)).not.toContain('patrol');
    expect(itemIds(v)).toEqual(items);
  }
}

function serveAtCamp(w: World, v: Vehicle): void {
  expect(thinkNpc(w, v)).toMatchObject({ kind: 'resupply', targetId: 'kiln' });
  parkAtCamp(v);
  resolveNpcActivities(w);
}

describe('the lie-up for fresh gear', () => {
  it('holds a raider still unfit after a camp service it could not pay for until its camp refill time, then refits it', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 0;
    serveAtCamp(w, v);
    expect(topGoal(v)).toMatchObject({ kind: 'rearm', targetId: 'kiln', until: w.turn + RAIDER_LIE_UP });
    expect(fitToHunt(w, v)).toBe(false);
    const until = topGoal(v)!.until!;
    const items = itemIds(v);
    lieUpUntil(w, v, until);
    npcTurn(w, v);
    expect(itemIds(v)).not.toEqual(items);
    expect(fitToHunt(w, v)).toBe(true);
    expect(getResources(w, v).money).toBe(0);
    expect(goalKinds(v)).not.toContain('rearm');
  });

  it('holds a raider with junk guns that camp service cannot rebuild', () => {
    const { w, v } = raider();
    for (const gun of gunsOf(v)) { gun.wear = 5; gun.hp = 0; }
    getResources(w, v).money = 166667;
    serveAtCamp(w, v);
    for (const plate of armorOf(v)) expect(plate.hp).toBe(maxHp(plate));
    expect(topGoal(v)).toMatchObject({ kind: 'rearm', until: w.turn + RAIDER_LIE_UP });
    const until = topGoal(v)!.until!;
    w.turn = until - 1;
    npcTurn(w, v);
    expect(gunsOf(v).every((gun) => gun.wear <= 4 && gun.hp > 0)).toBe(true);
    expect(goalKinds(v)).not.toContain('rearm');
  });

  it('lies up at a random free spot beyond the camp edge and off its pad, apart from a truck already lying up', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 0;
    serveAtCamp(w, v);
    const first = topGoal(v)!.destination!;
    v.pos = { ...first };
    const other = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine', 'plates'], outside(20));
    other.brain = npcBrain('buggy', other.pos, NPCS.buggy.traits);
    crippleGear(other);
    getResources(w, other).money = 0;
    serveAtCamp(w, other);
    const second = topGoal(other)!.destination!;

    for (const spot of [first, second]) {
      expect(sitePads(kiln).some((pad) => dist(pad, spot) < 0.01)).toBe(false);
      expect(dist(spot, kiln.pos) - kiln.radius).toBeGreaterThanOrEqual(NPC_BEHAVIOR.lieUp.gap.min);
      expect(dist(spot, kiln.pos) - kiln.radius).toBeLessThanOrEqual(NPC_BEHAVIOR.lieUp.gap.max);
    }
    expect(dist(first, second)).toBeGreaterThanOrEqual(2 * RULES.arriveRadius + NPC_BEHAVIOR.lieUp.spacing);
    expect(liesUp(v)).toBe(true);
    expect(liesUp(other)).toBe(false);
  });

  it('ends without fresh gear once the driver is fit again', () => {
    const { w, v } = raider();
    getResources(w, v).health = RULES.maxHealth * 0.4;
    getResources(w, v).money = 166667;
    serveAtCamp(w, v);
    expect(topGoal(v)?.kind).toBe('rearm');
    const items = itemIds(v);
    npcTurn(w, v);
    expect(topGoal(v)?.kind).toBe('rearm');
    getResources(w, v).health = RULES.maxHealth * 0.6;
    npcTurn(w, v);
    expect(goalKinds(v)).not.toContain('rearm');
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'activity', previous: 'rearm', reason: 'fit again' }));
    expect(itemIds(v)).toEqual(items);
  });

  it('survives a save and reload, refitting on the same turn with the same items', () => {
    const { w, v } = raider();
    crippleGear(v);
    getResources(w, v).money = 0;
    serveAtCamp(w, v);
    const until = topGoal(v)!.until!;
    w.turn = until - 3;
    const saved = cloneWorld(w);
    const reloaded: World = { ...saved, vehicles: saved.vehicles.map((x) => JSON.parse(JSON.stringify(x)) as Vehicle) };
    const runToRefit = (world: World): { turn: number; items: string[] } => {
      const npc = world.vehicles.find((x) => x.id === v.id)!;
      const before = itemIds(npc);
      while (itemIds(npc).join() === before.join()) npcTurn(world, npc);
      return { turn: world.turn, items: itemIds(npc) };
    };
    const live = runToRefit(w);
    expect(live.turn).toBe(until);
    expect(runToRefit(reloaded)).toEqual(live);
  });

  it('lies up a stranded-for-good trader at a town instead of refitting it at once', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const pad = sitePads(REGION.towns[0])[0];
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], pad);
    trader.brain = npcBrain('trader', pad, NPCS.trader.traits);
    for (const engine of mountedParts(trader, 'engine')) { engine.wear = 5; engine.hp = 0; }
    getResources(w, trader).money = 0;
    const items = itemIds(trader);
    thinkNpc(w, trader);
    expect(topGoal(trader)).toMatchObject({ kind: 'rearm', targetId: REGION.towns[0].id, until: w.turn + NPCS.trader.cap * NPCS.trader.interval });
    expect(itemIds(trader)).toEqual(items);
    lieUpUntil(w, trader, topGoal(trader)!.until!);
    npcTurn(w, trader);
    expect(itemIds(trader)).not.toEqual(items);
    expect(goalKinds(trader)).not.toContain('rearm');
  });
});

describe('a defeated raider', () => {
  function retreating(): { w: World; v: Vehicle } {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 150, y: 150 });
    v.brain = npcBrain('buggy', v.pos, ['raider']);
    strip(v);
    return { w, v };
  }

  function strip(v: Vehicle): void {
    v.items = v.items.filter((it) => !(it.kind === 'part' && it.part.defId === 'mg'));
    v.defeat = { phase: 'retreat', turns: 3, unseen: 0, foes: [], gaveUp: true };
  }

  it('lies up still defeated when it reaches home, and refits only at the end', () => {
    const { w, v } = retreating();
    v.pos = { ...sitePads(npcHomeSite(v)!)[0] };
    npcTurn(w, v);
    expect(topGoal(v)).toMatchObject({ kind: 'rearm', until: w.turn + RAIDER_LIE_UP });
    expect(goalKinds(v)).not.toContain('retreat');
    expect(isDefeated(v)).toBe(true);
    const until = topGoal(v)!.until!;
    lieUpUntil(w, v, until);
    expect(isDefeated(v)).toBe(true);
    npcTurn(w, v);
    expect(isDefeated(v)).toBe(false);
    expect(fitToHunt(w, v)).toBe(true);
  });

  it('appears at home unrefitted, then lies up there', () => {
    const { w, v } = retreating();
    const items = itemIds(v);
    for (let turn = 0; turn < RULES.retreatTeleportTurns; turn++) advanceNpcKnockouts(w);
    expect(sitePads(npcHomeSite(v)!).some((pad) => dist(pad, v.pos) < 0.01)).toBe(true);
    expect(isDefeated(v)).toBe(true);
    expect(itemIds(v)).toEqual(items);
    npcTurn(w, v);
    expect(topGoal(v)?.kind).toBe('rearm');
    const at = { ...v.pos };
    for (let turn = 0; turn < RULES.retreatTeleportTurns * 2; turn++) advanceNpcKnockouts(w);
    expect(v.pos).toEqual(at);
    expect(itemIds(v)).toEqual(items);
  });

  it('mints at most one fresh loadout per camp refill time however often it is knocked out and stripped', () => {
    const { w, v } = retreating();
    v.pos = { ...sitePads(npcHomeSite(v)!)[0] };
    let minted = 0;
    let held = new Set(itemIds(v));
    for (let turn = 0; turn < RAIDER_LIE_UP * 2; turn++) {
      if (!isDefeated(v) && topGoal(v)?.kind !== 'rearm') strip(v);
      npcTurn(w, v);
      if (itemIds(v).some((id) => !held.has(id))) minted++;
      held = new Set(itemIds(v));
      if (goalKinds(v).includes('raid') || goalKinds(v).includes('patrol')) expect(fitToHunt(w, v)).toBe(true);
    }
    expect(minted).toBeGreaterThanOrEqual(1);
    expect(minted).toBeLessThanOrEqual(2);
  });
});
