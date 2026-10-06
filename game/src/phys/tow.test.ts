// Tow approaches and hitched towers (src/sim/tow.ts), played through real physics.
// These race a driving approach against the NPC's own threat and detection checks, or check that trucks get
// past each other without a crash, so they need the game's real driving, not the generic test stand-in in
// src/sim/testkit.ts.

import { beforeAll, describe, expect, it } from 'vitest';
import { canVehicleSee } from '../sim/vision';
import { playerVehicle } from '../sim/damage';
import { NPCS } from '../data/npcs';
import { REGION } from '../data/region';
import { siteGates, sitePads } from '../sim/sites';
import { chassisDef } from '../data/chassis';
import { partDef } from '../data/parts';
import { topGoal } from '../sim/npc-activities';
import { addVehicle, emptyWorld, forceOption, npcBrain } from '../sim/testkit';
import { chooseOption, currentOptions } from '../sim/dialogue';
import { npcHomeSite, playerTow, setBeacon } from '../sim/tow';
import type { GameEvent, Vehicle, World } from '../sim/types';
import { dist, type Vec } from '../sim/vec';
import { endTurn } from '../sim/world';
import { addRopeFrames } from '../three/travel';
import { RULES } from '../data/rules';
import { addState } from '../sim/states';
import { buildDrive, freeDrive, initPhysics, TURN_STEPS, type Drive } from './drive';
import { physicsMove } from './turn';

beforeAll(async () => {
  await initPhysics();
});

// Plays n turns through the real turn pipeline with physics movement.
function play(w: World, n: number): { w: World } {
  let d = buildDrive(w);
  for (let i = 0; i < n; i++) {
    let next: Drive | null = null;
    w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
    freeDrive(d);
    d = next!;
  }
  freeDrive(d);
  return { w };
}

function withTower(w: World, templateId: string, faction: Vehicle['faction'], chassis: string, pos: Vec): Vehicle {
  const v = addVehicle(w, faction, chassis, ['stockEngine'], pos, Math.PI);
  v.brain = npcBrain(templateId, pos, NPCS[templateId].traits);
  return v;
}

const onlyCore = (v: Vehicle) => { v.items = v.items.filter((it) => it.kind === 'part' && partDef(it.part.defId).kind === 'core'); };

// A stranded, unarmed player with an empty tank and a trader in sight: unarmed, so a towing trait
// never flees it as a threat before it can offer to help.
function stranded(playerPos: Vec = { x: 30, y: 30 }, traderPos: Vec = { x: 40, y: 30 }) {
  const w = emptyWorld(playerPos);
  w.player.fuel = 0;
  onlyCore(w.vehicles[0]);
  const trader = withTower(w, 'trader', 'traders', 'hauler', traderPos);
  return { w, trader };
}

function runUntil(w: World, max: number, done: (w: World) => boolean): { w: World; turns: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 1; i <= max; i++) {
    ({ w } = play(w, 1));
    events.push(...w.events);
    if (done(w)) return { w, turns: i, events };
  }
  return { w, turns: max, events };
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

describe('hitched tower traffic', () => {
  // A hitched tower on its way to town, a point `ahead` tiles along its way and `side` tiles to its left, and how
  // far along its way a point lies.
  function underWay(): { w: World; tower: Vehicle; along: (ahead: number, side: number) => Vec; progress: (p: Vec) => number } {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    const offer = runUntil(s.w, 30, (x) => playerTow(x) !== null);
    expect(playerTow(offer.w)).not.toBeNull();
    const w = play(chooseOption(offer.w, currentOptions(offer.w).findIndex((o) => o.text === 'Deal. Hitch me up.')), 2).w;
    const tower = find(w, s.trader.id);
    const goal = topGoal(tower)!.destination!;
    const a = Math.atan2(goal.y - tower.pos.y, goal.x - tower.pos.x);
    const along = (ahead: number, side: number) => ({
      x: tower.pos.x + Math.cos(a) * ahead - Math.sin(a) * side,
      y: tower.pos.y + Math.sin(a) * ahead + Math.cos(a) * side,
    });
    const origin = { ...tower.pos };
    const progress = (p: Vec) => (p.x - origin.x) * Math.cos(a) + (p.y - origin.y) * Math.sin(a);
    return { w, tower, along, progress };
  }

  const crashes = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'collision' && (e.a === id || e.b === id));

  it('a hitched tower gets past a parked truck in its path without a collision', () => {
    const { w, tower, along } = underWay();
    const parked = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], along(14, 0.5), 0);
    const r = runUntil(w, 20, () => false);
    expect(crashes(r.events, tower.id)).toEqual([]);
    expect(dist(find(r.w, tower.id).pos, parked.pos)).toBeGreaterThan(10);
  }, 90_000); // takes 10-25s alone and over 30s when the whole suite shares the cores

  it('a hitched tower and a truck meeting it head-on both get past without a collision', () => {
    const { w, tower, along, progress } = underWay();
    const start = along(25, 0);
    const behind = along(-30, 0);
    const other = withTower(w, 'scavenger', 'scavengers', 'hauler', start);
    other.heading = Math.atan2(behind.y - start.y, behind.x - start.x);
    other.brain!.goals = [{ kind: 'raid', targetId: null, destination: behind, phase: 'travel', reason: 'drive past the tower' }];
    const passed = (x: World) => progress(find(x, other.id).pos) < 0 && progress(find(x, tower.id).pos) > 10;
    const r = runUntil(w, 20, passed);
    expect(crashes(r.events, tower.id)).toEqual([]);
    expect(passed(r.w)).toBe(true);
  });
});

describe('tow approach traffic', () => {
  const crashes = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'collision' && (e.a === id || e.b === id));
  const feuds = (events: GameEvent[]) => events.filter((e) => e.t === 'hostile');
  // The tower ends the job hitched, or its claim lapsed.
  const settled = (w: World) => playerTow(w) !== null || !w.states.some((st) => st.kind === 'answering');

  function patrolled(place: (client: Vec) => Vec): { w: World; tower: Vehicle; patrol: Vehicle } {
    const s = stranded();
    const client = playerVehicle(s.w).pos;
    const patrol = withTower(s.w, 'bowlFarmer', 'bowl', 'hauler', place(client));
    patrol.brain!.goals = [];
    return { w: s.w, tower: s.trader, patrol };
  }

  it('a tower parks beside a stranded truck without ramming a patrol parked at its approach spot', () => {
    forceOption('strandedSeen', 'tow');
    forceOption('idle', 'wait');
    // The tower comes from the east, so the approach-side spot lies a few tiles east of the client.
    const reach = chassisDef('hauler').radius * 2 + RULES.arriveRadius;
    const { w, tower, patrol } = patrolled((c) => ({ x: c.x + reach, y: c.y }));
    const r = runUntil(w, 40, settled);
    expect(crashes(r.events, tower.id)).toEqual([]);
    expect(feuds(r.events)).toEqual([]);
    expect(settled(r.w)).toBe(true);
    expect(patrol.id).not.toBe(tower.id);
  });

  it('a tower arriving as a patrol drives across its approach spot does not crash into it', () => {
    forceOption('strandedSeen', 'tow');
    const { w, tower, patrol } = patrolled((c) => ({ x: c.x + 5, y: c.y + 14 }));
    const to = { x: patrol.pos.x, y: patrol.pos.y - 28 };
    patrol.heading = -Math.PI / 2;
    patrol.brain!.goals = [{ kind: 'raid', targetId: null, destination: to, phase: 'travel', reason: 'drive across the approach' }];
    const r = runUntil(w, 40, settled);
    expect(crashes(r.events, tower.id)).toEqual([]);
    expect(feuds(r.events)).toEqual([]);
  });

  it('a free approach still offers, hitches and tows', () => {
    const s = stranded();
    forceOption('strandedSeen', 'tow');
    const r = runUntil(s.w, 30, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
  });
});

describe('emergency beacon', () => {
  const player = { x: 30, y: 30 };
  const activitiesOf = (events: GameEvent[], id: string) => events.filter((e) => e.t === 'activity' && e.vehicle === id);

  it('a trader out of sight but in range drives over and offers', () => {
    const s = stranded(player, { x: 130, y: 30 });
    // The trader's first goal is the answer, not an idle roll of its own.
    forceOption('idle', 'wait');
    forceOption('strandedSeen', 'tow');
    const w = setBeacon(s.w, true);
    expect(w.player.beacon).toBe(true);
    expect(canVehicleSee(w, find(w, s.trader.id), playerVehicle(w).pos)).toBe(false);
    const r = runUntil(w, 150, (x) => playerTow(x) !== null);
    expect(playerTow(r.w)?.holder).toBe(s.trader.id);
    expect(activitiesOf(r.events, s.trader.id)[0]).toMatchObject({ activity: 'tow', reason: 'help a stranded truck' });
  });

  it('a raider comes to a beaconing truck with cargo', () => {
    const w = emptyWorld(player);
    w.player.fuel = 0;
    // An armed raider: one with no gun is unfit to hunt and heads for its camp.
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 130, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, NPCS.buggy.traits);
    forceOption('contactHeard', 'investigate');
    const r = runUntil(setBeacon(w, true), 60, (x) => dist(find(x, raider.id).pos, playerVehicle(x).pos) < 15);
    expect(dist(find(r.w, raider.id).pos, playerVehicle(r.w).pos)).toBeLessThan(15);
    expect(activitiesOf(r.events, raider.id)[0]).toMatchObject({ activity: 'investigate' });
  });
});

describe('after a tow into town', () => {
  it('the tower, parked on the pad, starts its next goal for that town there and does not ram the truck it towed', () => {
    const town = REGION.towns.find((t) => t.id === 'bowl')!;
    const gate = siteGates(town)[0];
    const out = { x: (gate.x - town.pos.x) / town.radius, y: (gate.y - town.pos.y) / town.radius };
    const at = (d: number) => ({ x: gate.x + out.x * d, y: gate.y + out.y * d });
    const s = stranded(at(20), at(30));
    for (const id of Object.keys(NPCS)) s.w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('idle', 'wait');
    forceOption('strandedSeen', 'tow');
    const offer = runUntil(s.w, 30, (x) => playerTow(x) !== null);
    const hitched = chooseOption(offer.w, currentOptions(offer.w).findIndex((o) => o.text === 'Deal. Hitch me up.'));
    const arrived = runUntil(hitched, 120, (x) => playerTow(x) === null).w;
    expect(playerTow(arrived)).toBeNull();
    find(arrived, s.trader.id).brain!.goals = [{ kind: 'travel', targetId: town.id, destination: { ...town.pos }, phase: 'travel', reason: 'go on to town' }];
    const parkedAt = { ...playerVehicle(arrived).pos };

    const r = runUntil(arrived, 15, () => false);

    expect(crashesBetween(r.events, s.trader.id, r.w.player.vehicleId)).toEqual([]);
    expect(dist(playerVehicle(r.w).pos, parkedAt)).toBeLessThan(0.05);
    expect(r.events.some((e) => e.t === 'activity' && e.vehicle === s.trader.id && e.reason === 'arrived')).toBe(true);
  });
});

describe('a client that jumps home as its NPC tow ends', () => {
  it('still gets frames', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const tower = withTower(w, 'trader', 'traders', 'hauler', { x: 150, y: 150 });
    const client = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 147, y: 150 });
    client.brain = npcBrain('buggy', client.pos, ['raider']);
    client.defeat = { phase: 'retreat', turns: 3, unseen: RULES.retreatTeleportTurns, foes: [], gaveUp: true };
    tower.items = tower.items.filter((it) => !(it.kind === 'part' && partDef(it.part.defId).kind === 'engine'));
    tower.brain!.goals = [{ kind: 'tow', targetId: client.id, destination: null, phase: 'act', reason: 'test' }];
    addState(w, 'tow', tower.id, client.id, { kind: 'tow', site: npcHomeSite(client)!.id, fee: 0, waived: 0, hitched: true });
    const before = w;

    const after = play(before, 1).w;

    expect(after.events.some((e) => e.t === 'towDropped')).toBe(true);
    const c = after.vehicles.find((v) => v.id === client.id)!;
    expect(c.trail).toHaveLength(0);
    expect(sitePads(npcHomeSite(c)!).some((pad) => dist(pad, c.pos) < 0.01)).toBe(true);
    const frames: Parameters<typeof addRopeFrames>[2] = {};
    addRopeFrames(before, after, frames);
    expect(frames[client.id]).toHaveLength(TURN_STEPS);
  });
});

const crashesBetween = (events: GameEvent[], a: string, b: string) =>
  events.filter((e) => e.t === 'collision' && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
