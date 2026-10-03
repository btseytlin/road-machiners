// NPC spawning up to per-template caps. Raiders appear at their camp gates, neutrals at the gates of any
// town or other location.

import { FIRST_NAMES, NPCS, OPPOSED_TRAITS, SPAWN, SURNAMES, type NpcTemplate, type TraitId } from "../data/npcs";
import { chassisDef } from "../data/chassis";
import { REGION } from "../data/region";
import { playerVehicle } from "./damage";
import { makeVehicle } from "./factory";
import { isDriveObstacle, touchesObstacle } from "./mapgen";
import { generateNpcLoadout, type NpcLoadout } from "./npc-loadout";
import { getKnownSite, profileOf } from "./npc-decisions";
import { chance, randInt, randRange, type Rng } from "./rng";
import { isFortress, siteGates, siteUnder, type Site } from "./sites";
import { startEscort } from "./tow";
import type { Vehicle, World } from "./types";
import { dist, type Vec } from "./vec";

// Escort templates never spawn on their own timer. They come with their leader.
export function spawnNpcs(world: World): void {
  for (const tpl of Object.values(NPCS)) {
    if (tpl.spawn.kind === "escort") continue;
    const left = (world.spawnTimer[tpl.id] ?? tpl.interval) - 1;
    world.spawnTimer[tpl.id] = left;
    if (left > 0) continue;
    world.spawnTimer[tpl.id] = tpl.interval;
    if (aliveOf(world, tpl) < tpl.cap) spawnWithEscorts(world, tpl, () => siteFor(world, tpl), true);
  }
}

// The first drivers, plus start traffic at the gate nearest the player of the town the player's road leaves, so
// drivers soon pass the player. Drivers deal their sites from shuffled decks, so every seed spreads them evenly over their sites.
// Each world must start with the whole roster, so a driver with no free spot stops the new game.
export function spawnInitial(world: World): void {
  const decks = new Map<string, Site[]>();
  for (const id of SPAWN.initial) {
    spawnRequired(world, NPCS[id], dealSite(world, decks, sitesFor(NPCS[id])), null);
  }
  const town = REGION.towns.find((t) => t.id === SPAWN.startTraffic.town);
  if (!town) throw new Error(`Unknown start traffic town ${SPAWN.startTraffic.town}`);
  const gate = nearestGate(town, playerVehicle(world).pos);
  for (const id of SPAWN.startTraffic.templates) spawnRequired(world, NPCS[id], town, gate);
}

function nearestGate(site: Site, from: Vec): Vec {
  return siteGates(site).reduce((a, b) => (dist(from, a) <= dist(from, b) ? a : b));
}

// The next site from the deck of these sites, reshuffled once every site is dealt.
function dealSite(world: World, decks: Map<string, Site[]>, sites: readonly Site[]): Site {
  const key = sites.map((s) => s.id).join();
  let deck = decks.get(key) ?? [];
  if (deck.length === 0) {
    deck = [...sites];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randInt(world, 0, i);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  const site = deck.pop()!;
  decks.set(key, deck);
  return site;
}

function aliveOf(world: World, tpl: NpcTemplate): number {
  return world.vehicles.filter((v) => v.brain?.templateId === tpl.id).length;
}

// Spawns a driver, then its escorts.
function spawnWithEscorts(world: World, tpl: NpcTemplate, pick: () => Site, respawn: boolean): void {
  const leader = spawnOne(world, tpl, pick, respawn, null);
  if (leader) spawnEscorts(world, tpl, leader);
}

// Like spawnWithEscorts at a fixed site and gate, or a random gate when null, but a driver or escort with no free
// spot throws.
function spawnRequired(world: World, tpl: NpcTemplate, site: Site, gate: Vec | null): void {
  const leader = spawnOne(world, tpl, () => site, false, gate);
  if (!leader) throw new Error(`No free spot to spawn ${tpl.name} at ${site.id} in the new world`);
  const missed = spawnEscorts(world, tpl, leader);
  if (missed.length > 0) throw new Error(`No free spot to spawn ${missed[0].name} beside ${tpl.name} in the new world`);
}

// One of each escort template that follows the leader's template, while the escort is under its cap. Each escort
// guards its leader for no fee and no destination. Returns the escorts that found no free spot.
function spawnEscorts(world: World, tpl: NpcTemplate, leader: Vehicle): NpcTemplate[] {
  const missed: NpcTemplate[] = [];
  for (const escort of escortsOf(tpl).filter((e) => aliveOf(world, e) < e.cap)) {
    const guard = spawnBeside(world, escort, leader);
    if (guard) startEscort(world, guard, leader, null, 0);
    else missed.push(escort);
  }
  return missed;
}

function escortsOf(tpl: NpcTemplate): NpcTemplate[] {
  return Object.values(NPCS).filter((e) => e.spawn.kind === "escort" && e.spawn.of === tpl.id);
}

// An escort spawns SPAWN.escortGap tiles from its leader's side, at a random free angle. Null when no spot is free.
function spawnBeside(world: World, tpl: NpcTemplate, leader: Vehicle): Vehicle | null {
  const loadout = generateNpcLoadout(world, tpl);
  const radius = chassisDef(loadout.chassisId).radius;
  const d = chassisDef(leader.chassisId).radius + radius + SPAWN.escortGap;
  for (let i = 0; i < SPAWN.tries; i++) {
    const a = randRange(world, -Math.PI, Math.PI);
    const pos = { x: leader.pos.x + Math.cos(a) * d, y: leader.pos.y + Math.sin(a) * d };
    if (!isFree(world, pos, radius, null)) continue;
    return spawnAt(world, tpl, loadout, pos);
  }
  world.events.push({ t: "info", text: `No free spot to spawn ${tpl.name}`, debug: true });
  return null;
}

// The template's base traits plus each extra that wins its roll and opposes no trait held already. Every extra
// rolls, so the RNG draws stay the same whatever wins.
export function rollTraits(world: Rng, tpl: NpcTemplate): TraitId[] {
  const won = tpl.extraTraits.filter((extra) => chance(world, extra.chance)).map((extra) => extra.trait);
  return won.reduce((held, trait) => (opposesAny(trait, held) ? held : [...held, trait]), [...tpl.traits]);
}

function opposesAny(trait: TraitId, held: TraitId[]): boolean {
  return OPPOSED_TRAITS.some(([a, b]) => (a === trait && held.includes(b)) || (b === trait && held.includes(a)));
}

// pick chooses the site for each try, and gate its gate, or a random gate when null. A respawn keeps
// SPAWN.minPlayerDist from the player. Initial spawns do not. Returns null when no free spot was found this time.
// The next interval tries again.
function spawnOne(world: World, tpl: NpcTemplate, pick: () => Site, respawn: boolean, gate: Vec | null): Vehicle | null {
  const loadout = generateNpcLoadout(world, tpl);
  const radius = chassisDef(loadout.chassisId).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const pos = gateSpot(world, pick(), gate, radius);
    if (respawn && dist(pos, playerVehicle(world).pos) < SPAWN.minPlayerDist) continue;
    if (!isFree(world, pos, radius, null)) continue;
    return spawnAt(world, tpl, loadout, pos);
  }
  world.events.push({ t: "info", text: `No free spot to spawn ${tpl.name}`, debug: true });
  return null;
}

// Adds a template's vehicle with a sampled loadout at pos. The caller checks that pos is free.
export function spawnAt(world: World, tpl: NpcTemplate, loadout: NpcLoadout, pos: Vec): Vehicle {
  const v = makeVehicle(world, {
    name: tpl.name,
    faction: tpl.faction,
    ...loadout,
    pos,
    heading: randRange(world, -Math.PI, Math.PI),
    brain: {
      templateId: tpl.id,
      driver: driverName(world.nameRng),
      traits: rollTraits(world, tpl),
      goals: [],
      noticed: {},
      hurt: 0,
      attackers: {},
      goal: null,
      home: { ...pos },
      stepIndex: 0,
    },
  });
  world.vehicles.push(v);
  world.events.push({ t: "spawn", vehicle: v.id });
  return v;
}

const NAME_SALT = 0x6e616d65;

export function nameStream(seed: number): Rng {
  return { rngState: seed ^ NAME_SALT };
}

// A first name and a surname from the pools in src/data/npcs.ts.
function driverName(names: Rng): string {
  const first = FIRST_NAMES[randInt(names, 0, FIRST_NAMES.length - 1)];
  const last = SURNAMES[randInt(names, 0, SURNAMES.length - 1)];
  return `${first} ${last}`;
}

// The name texts give an NPC truck: its template's profession and its driver's name, like "Roamer Silas Kane".
export function npcName(v: Vehicle): string {
  if (!v.brain) return v.name;
  const template = NPCS[v.brain.templateId];
  if (!template) throw new Error(`Unknown NPC template ${v.brain.templateId}`);
  return `${template.profession} ${v.brain.driver}`;
}

// Territories have no gates to spawn at.
const NEUTRAL_SITES: readonly Site[] = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== "camp" && l.kind !== "territory")];

// A random site among the template's spawn sites.
function siteFor(world: World, tpl: NpcTemplate): Site {
  const sites = sitesFor(tpl);
  return sites[randInt(world, 0, sites.length - 1)];
}

// Raiders spawn at their camps, neutrals at any town or other location, and others at their listed sites.
function sitesFor(tpl: NpcTemplate): readonly Site[] {
  const place = tpl.spawn;
  if (place.kind === "camp") return campsOf(tpl);
  if (place.kind === "town") return NEUTRAL_SITES;
  if (place.kind === "sites") return place.ids.map(getKnownSite);
  throw new Error(`${tpl.id} spawns only beside a new ${place.of}`);
}

function campsOf(tpl: NpcTemplate): Site[] {
  const bases = profileOf(tpl.traits).bases;
  if (bases.length === 0) throw new Error(`${tpl.id} spawns at a camp but its traits know none`);
  return bases.map((id) => {
    const camp = REGION.locations.find((l) => l.id === id);
    if (!camp) throw new Error(`Unknown camp ${id}`);
    return camp;
  });
}

// A point on the track just outside the given gate of the site, or a random one when null.
function gateSpot(world: World, site: Site, given: Vec | null, radius: number): Vec {
  const gates = siteGates(site);
  const gate = given ?? gates[randInt(world, 0, gates.length - 1)];
  const a = Math.atan2(gate.y - site.pos.y, gate.x - site.pos.x) + randRange(world, -SPAWN.gateAngle, SPAWN.gateAngle);
  const d = radius + 0.3 + randRange(world, 0, SPAWN.gateSpread);
  return { x: gate.x + Math.cos(a) * d, y: gate.y + Math.sin(a) * d };
}

function onMap(world: World, pos: Vec, radius: number): boolean {
  return pos.x >= radius && pos.y >= radius && pos.x <= world.size - radius && pos.y <= world.size - radius;
}

// A fortress has no circle obstacle, so the ground inside its curtain is kept free here.
function insideFortress(pos: Vec): boolean {
  const site = siteUnder(pos);
  return site !== null && isFortress(site);
}

// Whether a vehicle of radius fits at pos, on the map and clear of obstacles and other vehicles.
// ignoreId names a vehicle left out of the check, like the one being moved.
export function isFree(world: World, pos: Vec, radius: number, ignoreId: string | null): boolean {
  if (!onMap(world, pos, radius) || insideFortress(pos)) return false;
  const margin = 0.3;
  if (world.obstacles.filter(isDriveObstacle).some((o) => touchesObstacle(o, pos, radius, margin))) return false;
  return world.vehicles.every(
    (v) => v.id === ignoreId || dist(v.pos, pos) >= chassisDef(v.chassisId).radius + radius + margin,
  );
}
