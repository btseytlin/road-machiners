import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { partDef } from '../data/parts';
import type { GearLevel } from '../data/npcs';
import { advanceNpcKnockouts, isDefeated, refitAtHome } from './defeat';
import { corePart, mountedParts } from './grid';
import { generateNpcLoadout } from './npc-loadout';
import { fitToHunt } from './npc-decisions';
import { resolveNpcActivities, thinkNpc, topGoal, watchStalls } from './npc-activities';
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

// A point `d` tiles out from the kiln gate, away from the camp. One tile out stands on its pad.
function outside(d: number): Vec {
  return { x: gate.x + ((gate.x - kiln.pos.x) / kiln.radius) * d, y: gate.y + ((gate.y - kiln.pos.y) / kiln.radius) * d };
}

// A raider buggy far from the player, out on the road from the kiln, with a gun and armor plates.
function raider(): { w: World; v: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const v = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine', 'plates'], outside(20));
  v.brain = npcBrain('buggy', v.pos, NPCS.buggy.traits);
  return { w, v };
}

const gunsOf = (v: Vehicle): PartInstance[] => mountedParts(v, 'weapon');
const armorOf = (v: Vehicle): PartInstance[] => mountedParts(v, 'armor');

// Breaks every gun and wears the armor down, leaving the cab, engine and drive sound.
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
    getResources(w, v).money = 5000;
    expect(thinkNpc(w, v)).toMatchObject({ kind: 'resupply', targetId: 'kiln' });
    parkAtCamp(v);
    resolveNpcActivities(w);
    for (const part of [...gunsOf(v), ...armorOf(v)]) expect(part.hp).toBe(maxHp(part));
    expect(getResources(w, v).money).toBeLessThan(5000);
    expect(topGoal(v)).toBeNull();
    expect(fitToHunt(w, v)).toBe(true);
    forceOption('idle', 'raid');
    expect(thinkNpc(w, v).kind).toBe('raid');
  });
});

// The turns a buggy lies up: its camp's refill time.
const RAIDER_LIE_UP = NPCS.buggy.cap * NPCS.buggy.interval;

const itemIds = (v: Vehicle): string[] => v.items.map((it) => it.id).sort();
const goalKinds = (v: Vehicle): string[] => v.brain!.goals.map((g) => g.kind);

// One NPC turn without physics: the driver thinks, works on its goal, and the stall watchdog runs.
function npcTurn(w: World, v: Vehicle): void {
  w.events = [];
  w.turn++;
  thinkNpc(w, v);
  resolveNpcActivities(w);
  watchStalls(w);
  expect(w.events.filter((e) => e.t === 'stall')).toEqual([]);
}

// Runs NPC turns up to the turn before `turn`, checking each one. The driver keeps its items and never raids or patrols.
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

// Drives the raider to its camp for service and lets the camp serve it.
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
    getResources(w, v).money = 5000;
    serveAtCamp(w, v);
    for (const plate of armorOf(v)) expect(plate.hp).toBe(maxHp(plate));
    expect(topGoal(v)).toMatchObject({ kind: 'rearm', until: w.turn + RAIDER_LIE_UP });
    const until = topGoal(v)!.until!;
    w.turn = until - 1;
    npcTurn(w, v);
    expect(gunsOf(v).every((gun) => gun.wear <= 4 && gun.hp > 0)).toBe(true);
    expect(goalKinds(v)).not.toContain('rearm');
  });

  it('ends without fresh gear once the driver is fit again', () => {
    const { w, v } = raider();
    getResources(w, v).health = RULES.maxHealth * 0.4;
    getResources(w, v).money = 5000;
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
  // A raider buggy that woke from a knockout far from the player, stripped of its gun.
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

  it('refits from scraps at its lowest gear level, while a driver that was only stranded rolls its usual level', () => {
    const gearAfterRefit = (w: World, v: Vehicle): string[] => {
      refitAtHome(w, v);
      return mountedParts(v).filter((p) => partDef(p.defId).kind !== 'core').map((p) => `${p.defId}@${p.wear}`).sort();
    };
    const expected = (w: World, level: GearLevel | null): string[] =>
      generateNpcLoadout(cloneWorld(w), NPCS.buggy, 'buggy', level).parts.map((p) => `${p.defId}@${p.wear}`).sort();
    let differs = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const beaten = retreating();
      beaten.w.rngState = seed;
      const lowest = expected(beaten.w, 'light');
      expect(gearAfterRefit(beaten.w, beaten.v)).toEqual(lowest);
      expect(isDefeated(beaten.v)).toBe(false);
      const stranded = retreating();
      delete stranded.v.defeat;
      stranded.w.rngState = seed;
      const rolled = expected(stranded.w, null);
      expect(gearAfterRefit(stranded.w, stranded.v)).toEqual(rolled);
      if (rolled.join() !== lowest.join()) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('mints at most one fresh loadout per camp refill time however often it is knocked out and stripped', () => {
    const { w, v } = retreating();
    v.pos = { ...sitePads(npcHomeSite(v)!)[0] };
    let minted = 0;
    let held = new Set(itemIds(v));
    for (let turn = 0; turn < RAIDER_LIE_UP * 2; turn++) {
      // The player knocks it out and strips it again the moment it is back on its feet.
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
