// Debug console commands. Each returns a new world through update() and throws CheatError on bad input.
// God mode is the one cheat that acts inside the turn pipeline.

import { chassisDef, PLAYER_CHASSIS } from '../data/chassis';
import { GOOD_IDS, GOODS } from '../data/goods';
import { GEAR_LEVEL_IDS, NPCS, type GearLevel, type NpcTemplate } from '../data/npcs';
import { PARTS, partDef } from '../data/parts';
import { REGION } from '../data/region';
import { CHEATS } from '../data/rules';
import { PERK_IDS, PERKS, SKILL_IDS } from '../data/skills';
import { TIME } from '../data/time';
import { resolveDestroyed, wreckVehicle } from './combat';
import { damagePart, isJunk, maxHp, restorePart } from './wear';
import { playerVehicle } from './damage';
import { makePart, makeVehicle } from './factory';
import { maxHealthOf } from './health';
import { corePart, mountedParts } from './grid';
import { addGoods, stowPart } from './inventory';
import { generateNpcLoadout } from './npc-loadout';
import { grantXp, isPerkId, pickedFromPair } from './progress';
import { isTerritory, nearestPad, type Site } from './sites';
import { territoryEntries } from './territory';
import { isFree, spawnAt } from './spawn';
import { addState, settleStates, stateOf } from './states';
import { isTowed } from './tow';
import { clockOf } from './sun';
import type { Faction, SkillId, Vehicle, World } from './types';
import { dist, type Vec } from './vec';
import { randInt } from './rng';
import { refreshVision } from './vision';
import { makeWeather } from './weather';
import { hostileToPlayer, playerCanAct, update } from './world';
import { fuelCap, suppliesCap } from './stats';

// Bad user input to a cheat. Any other error from a cheat is a bug.
export class CheatError extends Error {}

export type VehicleRow = {
  id: string;
  name: string;
  templateId: string | null; // null for a vehicle without an NPC brain
  faction: Faction;
  distance: number; // tiles from the player truck
  hostile: boolean;
};

const WEATHER_KINDS = ['storm', 'heatwave', 'overcast'] as const;

function requireInteger(label: string, n: number, min: number, max: number): void {
  if (!Number.isInteger(n)) throw new CheatError(`${label} must be a whole number, got ${n}`);
  requireRange(label, n, min, max);
}

function requireRange(label: string, n: number, min: number, max: number): void {
  if (Number.isNaN(n)) throw new CheatError(`${label} must be a number, got ${n}`);
  if (n < min) throw new CheatError(`${label} must be at least ${min}, got ${n}`);
  if (n > max) throw new CheatError(`${label} must be at most ${max}, got ${n}`);
}

export function setMoney(world: World, n: number): World {
  requireInteger('Money', n, 0, Number.MAX_SAFE_INTEGER);
  return update(world, (w) => { w.player.money = n; });
}

export function setFuel(world: World, n: number): World {
  requireRange('Fuel', n, 0, fuelCap(playerVehicle(world)));
  return update(world, (w) => { w.player.fuel = n; });
}

export function setSupplies(world: World, n: number): World {
  requireRange('Supplies', n, 0, suppliesCap(playerVehicle(world)));
  return update(world, (w) => { w.player.supplies = n; });
}

export function setEngineHeat(world: World, n: number): World {
  requireRange('Engine heat', n, 0, 1);
  return update(world, (w) => { w.player.engineHeat = n; });
}

export function setHealth(world: World, n: number): World {
  requireInteger('Health', n, 0, maxHealthOf(world));
  return update(world, (w) => { w.player.health = n; });
}

export function addSkillXp(world: World, skill: string, n: number): World {
  if (!isSkillId(skill)) throw new CheatError(`No skill ${skill}. Skills: ${SKILL_IDS.join(', ')}`);
  requireInteger('XP', n, 1, Number.MAX_SAFE_INTEGER);
  return update(world, (w) => grantXp(w, skill, n));
}

// Grants a perk whatever the skill level. A pair still holds one pick.
export function grantPerk(world: World, id: string): World {
  if (!isPerkId(id)) throw new CheatError(`No perk ${id}. Perks: ${PERK_IDS.join(', ')}`);
  const picked = pickedFromPair(world, id);
  if (picked) throw new CheatError(`${PERKS[picked].name} is already picked from the pair of ${PERKS[id].name}`);
  return update(world, (w) => { w.player.perks.push(id); });
}

function isSkillId(id: string): id is SkillId {
  return (SKILL_IDS as readonly string[]).includes(id);
}

// Mounted and spare parts alike. Junk parts stay broken, since no repair rebuilds them.
function repairParts(v: Vehicle): void {
  for (const it of v.items) if (it.kind === 'part' && !isJunk(it.part)) restorePart(it.part, maxHp(it.part));
}

export function repairAll(world: World): World {
  return update(world, (w) => repairParts(playerVehicle(w)));
}

export function damagePartTo(world: World, defId: string, hp: number): World {
  return update(world, (w) => {
    const mounted = mountedParts(playerVehicle(w));
    const part = mounted.find((p) => p.defId === defId);
    if (!part) throw new CheatError(`No mounted ${defId}. Mounted: ${[...new Set(mounted.map((p) => p.defId))].join(', ')}`);
    requireInteger('Hit points', hp, 0, maxHp(part));
    if (hp <= part.hp) {
      damagePart(part, part.hp - hp, 0);
      return;
    }
    if (part.hp === 0 && isJunk(part)) throw new CheatError(`${partDef(defId).name} is junk and cannot be rebuilt`);
    restorePart(part, hp);
  });
}

export function give(world: World, id: string, count: number): World {
  requireInteger('Count', count, 1, Number.MAX_SAFE_INTEGER);
  if (id in PARTS) return update(world, (w) => givePart(w, id, count));
  if (id in GOODS) return update(world, (w) => giveGoods(w, id, count));
  throw new CheatError(`Unknown item ${id}. Give a part id from the parts list or a good: ${GOOD_IDS.join(', ')}`);
}

function givePart(w: World, defId: string, count: number): void {
  const me = playerVehicle(w);
  for (let i = 0; i < count; i++) {
    if (!stowPart(w, me, makePart(w, defId, 0))) throw new CheatError(`No room for ${count} ${defId}`);
  }
}

function giveGoods(w: World, good: string, count: number): void {
  if (addGoods(w, playerVehicle(w), good, count) < count) throw new CheatError(`No room for ${count} ${good}`);
}

export function toggleGod(world: World): World {
  return update(world, (w) => { w.player.god = !w.player.god; });
}

export function toggleFullLog(world: World): World {
  return update(world, (w) => { w.player.fullLog = !w.player.fullLog; });
}

// Runs on the turn draft before destruction and defeat checks, so nothing the turn did can break the truck.
export function applyGodMode(world: World): void {
  if (!world.player.god) return;
  const me = playerVehicle(world);
  repairParts(me);
  world.player.health = maxHealthOf(world);
  world.player.fuel = fuelCap(me);
  world.player.supplies = suppliesCap(me);
}

// The first free point on rings around center, nearest ring first. Null when all rings are blocked.
function freeSpotNear(w: World, center: Vec, radius: number, ignoreId: string | null): Vec | null {
  if (isFree(w, center, radius, ignoreId)) return { ...center };
  for (let ring = 1; ring <= CHEATS.searchRings; ring++) {
    const r = ring * CHEATS.searchStep;
    const points = Math.ceil((2 * Math.PI * r) / CHEATS.searchStep);
    const spot = firstFree(w, circlePoints(center, r, points), radius, ignoreId);
    if (spot) return spot;
  }
  return null;
}

function circlePoints(center: Vec, r: number, count: number): Vec[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
  });
}

function firstFree(w: World, points: Vec[], radius: number, ignoreId: string | null): Vec | null {
  return points.find((p) => isFree(w, p, radius, ignoreId)) ?? null;
}

export function teleport(world: World, target: Vec): World {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new CheatError(`Bad target ${target.x}, ${target.y}`);
  if (!playerCanAct(world)) throw new CheatError(`Cannot teleport while ${whyPlayerCannotAct(world)}`);
  return update(world, (w) => {
    const me = playerVehicle(w);
    const spot = freeSpotNear(w, target, chassisDef(me.chassisId).radius, me.id);
    if (!spot) throw new CheatError(`No free spot near ${target.x}, ${target.y}`);
    me.pos = spot;
    me.order = null;
    me.speed = 0;
    me.trail = [];
    refreshVision(w);
  });
}

// What keeps the player from acting: a tow rope, an open radio call or a driver who is not active.
function whyPlayerCannotAct(world: World): string {
  if (isTowed(world)) return 'the player is towed';
  if (world.player.call) return 'a radio call is open';
  return `the player is ${world.player.state}`;
}

// Noclip flight: puts the player truck at a map point, clamped to the map, without checking obstacles.
export function noclipMove(world: World, target: Vec): World {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new CheatError(`Bad target ${target.x}, ${target.y}`);
  if (!playerCanAct(world)) throw new CheatError(`Cannot fly while ${whyPlayerCannotAct(world)}`);
  return update(world, (w) => {
    const me = playerVehicle(w);
    me.pos = { x: Math.min(Math.max(target.x, 0), w.size), y: Math.min(Math.max(target.y, 0), w.size) };
    me.order = null;
    me.speed = 0;
    me.trail = [];
    refreshVision(w);
  });
}

// Where a place's services work, nearest the truck: the pad of its nearest gate, or a territory's nearest road end.
export function placeSpot(world: World, id: string): Vec {
  const places: Site[] = [...REGION.towns, ...REGION.locations];
  const place = places.find((p) => p.id === id);
  if (!place) throw new CheatError(`Unknown place ${id}. Places: ${places.map((p) => p.id).join(', ')}`);
  const from = playerVehicle(world).pos;
  // A territory has no pads: its nearest road end is where its ground starts.
  if (isTerritory(place)) return { ...territoryEntries(place).reduce((a, b) => (dist(from, a) <= dist(from, b) ? a : b)) };
  return { ...nearestPad(place, from) };
}

export function skipToHour(world: World, hour: number): World {
  requireInteger('Hour', hour, 0, 23);
  for (let turn = world.turn + 1; turn <= world.turn + TIME.turnsPerDay; turn++) {
    if (Math.floor(clockOf(turn).hour) !== hour) continue;
    return update(world, (w) => {
      w.turn = turn;
      refreshVision(w);
    });
  }
  throw new Error(`No turn within a day of ${world.turn} starts hour ${hour}`);
}

export function startWeather(world: World, kind: string): World {
  const known = WEATHER_KINDS.find((k) => k === kind);
  if (!known) throw new CheatError(`Unknown weather ${kind}. Kinds: ${WEATHER_KINDS.join(', ')}`);
  return update(world, (w) => {
    w.weather = w.weather.filter((e) => e.kind !== known);
    const event = makeWeather(w, known);
    if (event.kind === 'storm') event.pos = { ...playerVehicle(w).pos };
    w.weather.push(event);
    w.events.push({ t: 'weather', event, outcome: 'started' });
  });
}

export function revealMap(world: World): World {
  return update(world, (w) => {
    w.player.explored.fill(1);
    refreshVision(w);
  });
}

export function spawnNear(world: World, templateId: string, hostile: boolean): World {
  const tpl = NPCS[templateId];
  if (!tpl) throw new CheatError(`Unknown template ${templateId}. Templates: ${Object.keys(NPCS).join(', ')}`);
  return update(world, (w) => spawnInDraft(w, tpl, hostile));
}

// Spawns a hostile NPC of any template, picked with the world RNG.
export function startBattle(world: World): World {
  const templates = Object.values(NPCS);
  return update(world, (w) => spawnInDraft(w, templates[randInt(w, 0, templates.length - 1)], true));
}

// Every NPC template paired with each player chassis its loadout table can roll, or only `templateId`'s pairs.
export function kitChoices(templateId: string | null = null): { tpl: NpcTemplate; chassisId: string }[] {
  if (templateId !== null && !NPCS[templateId]) throw new CheatError(`Unknown template ${templateId}. Templates: ${Object.keys(NPCS).join(', ')}`);
  const templates = templateId === null ? Object.values(NPCS) : [NPCS[templateId]];
  const choices = templates.flatMap((tpl) =>
    tpl.loadout.chassis.filter((c) => PLAYER_CHASSIS.includes(c.value)).map((c) => ({ tpl, chassisId: c.value })));
  if (choices.length === 0) throw new CheatError(`${templateId} rolls no chassis the player can drive`);
  return choices;
}

// Swaps the player truck for a random template's chassis with a loadout rolled like an NPC's, picked with the world
// RNG. level is a gear level from 1 for poor to 5 for loaded, or null for one picked evenly at random. The truck
// keeps its id, name and place. Its goods and spares go, and fuel and supplies are cut to the new caps.
export function randomKit(world: World, level: number | null): World {
  if (!playerCanAct(world)) throw new CheatError(`Cannot swap trucks while the player is ${isTowed(world) ? 'towed' : world.player.state}`);
  if (level !== null) gearLevelOf(level);
  const choices = kitChoices();
  return update(world, (w) => {
    const gear = gearLevelOf(level ?? randInt(w, 1, GEAR_LEVEL_IDS.length));
    const { tpl, chassisId } = choices[randInt(w, 0, choices.length - 1)];
    const old = playerVehicle(w);
    const spot = freeSpotNear(w, old.pos, chassisDef(chassisId).radius, old.id);
    if (!spot) throw new CheatError(`No free spot for a ${chassisId} here`);
    const loadout = generateNpcLoadout(w, tpl, chassisId, gear);
    const truck = makeVehicle(w, { name: old.name, faction: 'player', chassisId, parts: loadout.parts, spares: [], cargo: {}, pos: spot, heading: old.heading, brain: null });
    truck.id = old.id;
    w.vehicles = w.vehicles.map((v) => (v.id === old.id ? truck : v));
    w.player.fuel = Math.min(w.player.fuel, fuelCap(truck));
    w.player.supplies = Math.min(w.player.supplies, suppliesCap(truck));
    refreshVision(w);
  });
}

// Gear level 1 is the first of GEAR_LEVEL_IDS, poor, and the last is loaded.
function gearLevelOf(level: number): GearLevel {
  const found = Number.isInteger(level) ? GEAR_LEVEL_IDS[level - 1] : undefined;
  if (!found) throw new CheatError(`Gear level must be 1 to ${GEAR_LEVEL_IDS.length}: ${GEAR_LEVEL_IDS.join(', ')}`);
  return found;
}

function spawnInDraft(w: World, tpl: NpcTemplate, hostile: boolean): void {
  const loadout = generateNpcLoadout(w, tpl);
  const radius = chassisDef(loadout.chassisId).radius;
  const center = playerVehicle(w).pos;
  const circle = circlePoints(center, CHEATS.spawnDistance, CHEATS.spawnAngles);
  const spot = firstFree(w, circle, radius, null) ?? freeSpotNear(w, center, radius, null);
  if (!spot) throw new CheatError(`No free spot to spawn ${tpl.name}`);
  const v = spawnAt(w, tpl, loadout, spot);
  if (hostile) turnHostile(w, v);
}

// The vehicle starts a feud with the player and counts the player as its attacker, so it decides at once whether
// to fight back.
function turnHostile(w: World, v: Vehicle): void {
  const me = w.player.vehicleId;
  if (!stateOf(w, 'feud', v.id, me)) {
    addState(w, 'feud', v.id, me, { kind: 'feud', robbery: false });
    w.events.push({ t: 'hostile', vehicle: v.id, against: me });
  }
  if (v.brain && !(me in v.brain.attackers)) v.brain.attackers[me] = false;
}

function otherVehicle(w: World, vehicleId: string): Vehicle {
  if (vehicleId === w.player.vehicleId) throw new CheatError('That is the player truck');
  const v = w.vehicles.find((x) => x.id === vehicleId);
  if (!v) throw new CheatError(`No vehicle ${vehicleId}`);
  return v;
}

export function makeHostile(world: World, vehicleId: string): World {
  return update(world, (w) => turnHostile(w, otherVehicle(w, vehicleId)));
}

function killTargets(w: World, target: string): Vehicle[] {
  const others = w.vehicles.filter((v) => v.id !== w.player.vehicleId);
  if (target === 'all') return others;
  if (target === 'hostiles') return others.filter((v) => hostileToPlayer(w, v));
  return [otherVehicle(w, target)];
}

// Zeroes each target's cab and turns it into a wreck with salvage, never a knockout. No kill is credited.
// States with a killed party end at once, as they do after destruction in a turn. So a killed tower drops its tow.
export function killVehicles(world: World, target: string): World {
  return update(world, (w) => {
    for (const v of killTargets(w, target)) {
      const cab = corePart(v, 'cab');
      damagePart(cab, cab.hp, 0);
      v.lastHitBy = null;
      wreckVehicle(w, v);
    }
    // Clears old wrecks and orders at the dead.
    resolveDestroyed(w);
    settleStates(w);
  });
}

export function nearbyVehicles(world: World): VehicleRow[] {
  const me = playerVehicle(world);
  return world.vehicles
    .filter((v) => v.id !== me.id)
    .map((v) => ({
      id: v.id,
      name: v.name,
      templateId: v.brain ? v.brain.templateId : null,
      faction: v.faction,
      distance: dist(me.pos, v.pos),
      hostile: hostileToPlayer(world, v),
    }))
    .sort((a, b) => a.distance - b.distance);
}
