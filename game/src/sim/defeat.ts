// A lost fight knocks a driver out, the player or an NPC alike. The truck keeps every item, trucks parked beside
// it strip it, and nobody is its foe while it lies out. It wakes once the trucks that fought it look away. Health
// at 0 ends the player's run. A woken NPC retreats home and lies up there, and nobody is its foe until it refits at
// the end of the lie-up.

import { NPC_BEHAVIOR, NPCS } from "../data/npcs";
import { chassisDef } from "../data/chassis";
import { RULES } from "../data/rules";
import { isJunk, maxHp, restorePart } from "./wear";
import { playerVehicle } from "./damage";
import { beatenBy, isHostile } from "./combat";
import { rollCabKnock } from "./cab-knock";
import { corePart, mountedParts } from "./grid";
import { cancelJob } from "./jobs";
import { practice, vehicleHasPerk } from "./progress";
import { maxHealthOf } from "./health";
import { PERK_NUMBERS } from "../data/skills";
import { addState, endState, stateOf } from "./states";
import { makeVehicle } from "./factory";
import { generateNpcLoadout } from "./npc-loadout";
import { getResources } from "./resources";
import { chance } from "./rng";
import { sitePads, type Site } from "./sites";
import { isFree } from "./spawn";
import { npcHomeSite, towOf } from "./tow";
import { lootRobbed } from "./npc-activities";
import { liesUp } from "./npc-service";
import { isWeak, wantsLoot } from "./npc-decisions";
import type { Vehicle, World } from "./types";
import { dist, type Vec } from "./vec";
import { canVehicleSee, grayRadius } from "./vision";

export function checkDeath(world: World): void {
  const p = world.player;
  if (p.health > 0 || p.state === "dead") return;
  p.state = "dead";
  world.events.push({ t: "death" });
}

export function checkKnockout(world: World): void {
  const p = world.player;
  const me = playerVehicle(world);
  if (p.state !== "active" || !knockedNow(world, me)) return;
  // Only a knockout with a hostile truck in sight teaches toughness. A cab broken on purpose does not.
  const watchers = world.vehicles.filter((v) => isHostile(world, v, me) && canVehicleSee(world, v, me.pos));
  if (watchers.length > 0) practice(world, "knockout", 1, null, "driver");
  me.defeat = { phase: "out", turns: 0, unseen: 0, foes: withLastHitter(world, me, watchers.map((v) => v.id)), gaveUp: false };
  p.state = "knockedOut";
  p.knockoutTurns = 0;
  p.knockouts++;
  stopKnockedOut(world, me);
  me.trail = [];
  const robbers = robbersOf(world, me);
  // Whoever fought the player got what the feud was for.
  for (const s of world.states.filter((x) => x.kind === "feud" && x.other === me.id))
    endState(world, s, "fulfilled");
  sendToLoot(world, me, robbers);
  settleRevenge(world, me);
  world.events.push({ t: "knockout" });
}

// A broken cab knocks the player out unless Fight through holds. A working cab may knock them out below
// RULES.cabKnock.playerHealth. The cheap checks come first, so a spared player draws no RNG.
function knockedNow(world: World, me: Vehicle): boolean {
  if (fightsThrough(world, me)) return false;
  if (corePart(me, "cab").hp <= 0) return true;
  return world.player.health < RULES.cabKnock.playerHealth && rollCabKnock(world, me);
}

// The Fight through perk keeps the driver going on a broken cab or a cab knock while health stays above its share.
function fightsThrough(world: World, me: Vehicle): boolean {
  return vehicleHasPerk(world, me, "fightThrough") && world.player.health > maxHealthOf(world) * PERK_NUMBERS.fightThrough.health;
}

// The trucks that fought the player keep the driver down while they watch, so a robber strips the truck in peace.
export function advanceKnockout(world: World): void {
  const p = world.player;
  if (p.state !== "knockedOut") return;
  p.knockoutTurns++;
  const me = playerVehicle(world);
  if (!me.defeat) throw new Error("A knocked-out player truck has no defeat");
  if (attackerWatches(world, me, me.defeat.foes) && p.knockoutTurns < RULES.knockoutMaxTurns) return;
  patchBrokenCore(me);
  delete me.defeat;
  p.state = "active";
  world.events.push({ t: "wake" });
}

// Other junk core parts stay broken. A junk cab cannot wake, so restorePart stops the game with the reason.
export function patchBrokenCore(me: Vehicle): void {
  const cab = corePart(me, "cab");
  const broken = mountedParts(me, "core").filter((part) => part.hp === 0 && (part === cab || !isJunk(part)));
  for (const part of broken)
    restorePart(part, Math.max(1, Math.round(maxHp(part) * RULES.defeatPatch)));
}

// The truck lost a fight: its driver lies out, or an NPC has not refitted at home yet.
export function isDefeated(v: Vehicle): boolean {
  return v.defeat !== undefined;
}

// The driver lies knocked out, so trucks beside it can strip it.
export function isKnockedOut(v: Vehicle): boolean {
  return v.defeat?.phase === "out";
}

// A knocked-out driver gave up when a demand made it stand down, and was knocked out when a fight did.
export function gaveUp(v: Vehicle): boolean {
  return isKnockedOut(v) && v.defeat!.gaveUp;
}

function layDown(world: World, v: Vehicle, foes: string[], gaveUp: boolean): void {
  v.defeat = { phase: "out", turns: 0, unseen: 0, foes, gaveUp };
  stopKnockedOut(world, v);
}

// A driver that gives up lies as if knocked out, with no knockout event, death or grudge.
export function standDown(world: World, v: Vehicle, winnerId: string): void {
  layDown(world, v, [...new Set([...foesOf(world, v), winnerId])], true);
}

export function knockOutNpc(world: World, v: Vehicle): void {
  layDown(world, v, foesOf(world, v), false);
  const by = beatenBy(world, v);
  world.events.push({ t: "npcKnockout", vehicle: v.id, by });
  if (by === world.player.vehicleId && chance(world, NPC_BEHAVIOR.revengeChance))
    addState(world, "revenge", v.id, world.player.vehicleId, { kind: "none" });
  sendToLoot(world, v, strippers(world, v));
}

// The NPCs that beat the driver and want its truck's cargo and parts: raiders, and drivers that rob. A winner that is
// itself hurt or stranded leaves the truck alone.
function strippers(world: World, victim: Vehicle): Vehicle[] {
  return world.vehicles.filter((v) => v.brain && victim.defeat!.foes.includes(v.id) && !isKnockedOut(v) && !isWeak(world, v) && (v.faction === "raiders" || wantsLoot(world, v, victim)));
}

// The driver is out, so the truck brakes to a stop instead of coasting on. Every gun aimed at it drops its order,
// so finishing it off takes a new manual order.
function stopKnockedOut(world: World, v: Vehicle): void {
  v.order = { kind: "brake" };
  v.weaponOrders = {};
  cancelJob(world, v);
  for (const other of world.vehicles) dropOrdersAt(other, v.id);
}

// The trucks that attacked the NPC, and the one that dealt the last blow.
function foesOf(world: World, v: Vehicle): string[] {
  if (!v.brain) throw new Error(`${v.id} has no NPC brain to knock out`);
  return withLastHitter(world, v, Object.keys(v.brain.attackers));
}

// The given foes and the truck that dealt the last blow, while it is still in the world.
function withLastHitter(world: World, v: Vehicle, ids: string[]): string[] {
  const foes = new Set(ids);
  if (v.lastHitBy && world.vehicles.some((x) => x.id === v.lastHitBy)) foes.add(v.lastHitBy);
  return [...foes];
}

// The foes that come for the player's cargo: raiders, and drivers that want it. A won robbery already sent its robber.
// Read before the feuds end, since a robbery feud is what marks a robber.
function robbersOf(world: World, me: Vehicle): Vehicle[] {
  return world.vehicles.filter((v) => v.brain && me.defeat!.foes.includes(v.id) && (v.faction === "raiders" || wantsLoot(world, v, me)));
}

function sendToLoot(world: World, me: Vehicle, robbers: Vehicle[]): void {
  for (const robber of robbers.filter((v) => !isLooting(v, me.id))) lootRobbed(world, robber.id, me.id);
}

function isLooting(v: Vehicle, targetId: string): boolean {
  const top = v.brain!.goals.at(-1);
  return top?.kind === "loot" && top.targetId === targetId;
}

// The truck that knocked the player out settles any grudge it held.
function settleRevenge(world: World, me: Vehicle): void {
  const held = me.lastHitBy ? stateOf(world, "revenge", me.lastHitBy, me.id) : null;
  if (held) endState(world, held, "fulfilled");
}

function dropOrdersAt(shooter: Vehicle, targetId: string): void {
  for (const [weaponId, order] of Object.entries(shooter.weaponOrders))
    if (order.targetId === targetId) delete shooter.weaponOrders[weaponId];
}

// The player's knockout runs in advanceKnockout.
export function advanceNpcKnockouts(world: World): void {
  for (const v of world.vehicles.filter((x) => x.id !== world.player.vehicleId)) {
    if (v.defeat?.phase === "out") advanceNpcKnockout(world, v);
    else if (v.defeat?.phase === "retreat") advanceRetreat(world, v);
  }
}

// Looters that did not fight it do not keep the driver down.
function advanceNpcKnockout(world: World, v: Vehicle): void {
  const defeat = v.defeat!;
  defeat.turns++;
  if (attackerWatches(world, v, defeat.foes) && defeat.turns < RULES.knockoutMaxTurns) return;
  patchBrokenCore(v);
  v.defeat = { ...defeat, phase: "retreat", unseen: 0 };
  world.events.push({ t: "npcWake", vehicle: v.id });
}

function attackerWatches(world: World, v: Vehicle, foes: string[]): boolean {
  return world.vehicles.some((x) => foes.includes(x.id) && canVehicleSee(world, x, v.pos));
}

// ---- The retreat home. The NPC drives or crawls to its home site, and towers may tow it there. Out of the player's
// sight for long enough, it appears at the home pad instead. At home it lies up, and refits when the lie-up ends.

// A truck on a tow rope or waiting for a tower stays where the tow puts it. A truck lying up at home stays put.
function advanceRetreat(world: World, v: Vehicle): void {
  const defeat = v.defeat!;
  defeat.unseen = inPlayerView(world, v.pos) ? 0 : defeat.unseen + 1;
  if (defeat.unseen < RULES.retreatTeleportTurns || staysPut(world, v)) return;
  const spot = hiddenHomeSpot(world, v);
  if (spot) teleportHome(world, v, spot);
}

function staysPut(world: World, v: Vehicle): boolean {
  return liesUp(v) || towOf(world, v.id) !== null || answered(world, v);
}

function answered(world: World, v: Vehicle): boolean {
  return world.states.some((s) => s.kind === "answering" && s.other === v.id);
}

function inPlayerView(world: World, pos: Vec): boolean {
  return dist(playerVehicle(world).pos, pos) <= grayRadius(world, pos);
}

// A free pad of the home site beyond the player's gray vision, nearest the truck first, or null.
function hiddenHomeSpot(world: World, v: Vehicle): Vec | null {
  const home = homeOf(v);
  const radius = chassisDef(v.chassisId).radius;
  const pads = [...sitePads(home)].sort((a, b) => dist(v.pos, a) - dist(v.pos, b));
  return pads.find((pad) => !inPlayerView(world, pad) && isFree(world, pad, radius, v.id)) ?? null;
}

function homeOf(v: Vehicle): Site {
  const home = npcHomeSite(v);
  if (!home) throw new Error(`${v.id} knows no home to retreat to`);
  return home;
}

function teleportHome(world: World, v: Vehicle, spot: Vec): void {
  v.pos = { ...spot };
  v.speed = 0;
  v.order = null;
  v.trail = [];
  delete v.brain!.farRoute;
}

// At the end of a lie-up, the truck at its site gets a fresh loadout for its template on the same chassis, and spawn
// fuel, supplies and health. The old items are scrapped. The driver keeps its money, name, traits and goals. Any
// defeat ends.
export function refitAtHome(world: World, v: Vehicle): void {
  const template = NPCS[v.brain!.templateId];
  const loadout = generateNpcLoadout(world, template, v.chassisId);
  const fresh = makeVehicle(world, { name: v.name, faction: v.faction, ...loadout, pos: v.pos, heading: v.heading, brain: null });
  v.items = fresh.items;
  v.resources = { ...fresh.resources!, money: getResources(world, v).money };
  v.job = null;
  delete v.defeat;
}
