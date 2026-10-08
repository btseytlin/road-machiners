// Towing a stranded truck. An NPC that sees a stranded truck may choose to help at its strandedSeen decision. It
// drives over and claims the job, so no other driver answers. A tow is a `tow` state held by the tower toward its
// client. Once hitched, the client leaves physics and trails the tower along its path. Arrival fulfils the state,

import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { ECONOMY } from '../data/goods';
import { NPC_BEHAVIOR, NPCS } from '../data/npcs';
import { BEACON, TOW } from '../data/tow';
import { inCombat, inCombatWithOther, isHostile } from './combat';
import { bodyOf } from './body';
import { playerVehicle, vehicleById } from './damage';
import { isDefeated, isKnockedOut } from './defeat';
import { contactsOf, hearsBeacon } from './detect';
import { route, routeLength } from './path';
import { decide, getKnownSite, getUpkeepReserve, isWeak, npcProfile } from './npc-decisions';
import { placeBase, popGoal } from './npc-activities';
import { skillEffect } from './progress';
import { canUseSite, nearestPad, reachedSite, type Site } from './sites';
import { addState, endState, stateOf, towData, towPromiseData } from './states';
import { isStranded, vehicleStats } from './stats';
import { getResources } from './resources';
import type { GameEvent, NpcActivity, NpcState, Pose, StateData, StateEnding, StateKindId, Vehicle, World } from './types';
import { bearing, dist, type Vec } from './vec';
import { canVehicleSee } from './vision';
import { playerCommand, update } from './world';

export function inTowReach(tower: Vehicle, towed: Vehicle): boolean {
  const radii = chassisDef(tower.chassisId).radius + chassisDef(towed.chassisId).radius;
  return dist(tower.pos, towed.pos) <= (radii + ECONOMY.useRange) * ECONOMY.interactionScale;
}

type DropReason = Exclude<Extract<GameEvent, { t: 'towDropped' }>['reason'], 'gone'>;

export function towOf(world: World, clientId: string): NpcState | null {
  const tows = world.states.filter((s) => s.kind === 'tow' && s.other === clientId);
  if (tows.length > 1) throw new Error(`${clientId} has ${tows.length} tows`);
  return tows[0] ?? null;
}

export function towHeldBy(world: World, towerId: string): NpcState | null {
  const tows = world.states.filter((s) => s.kind === 'tow' && s.holder === towerId);
  if (tows.length > 1) throw new Error(`${towerId} holds ${tows.length} tows`);
  return tows[0] ?? null;
}

export function playerTow(world: World): NpcState | null {
  return towOf(world, world.player.vehicleId);
}

export function playerTowing(world: World): NpcState | null {
  return towHeldBy(world, world.player.vehicleId);
}

export function isTowed(world: World): boolean {
  return isOnRope(world, world.player.vehicleId);
}

function hitchedTows(world: World): NpcState[] {
  return world.states.filter((s) => s.kind === 'tow' && towData(s).hitched);
}

export function isOnRope(world: World, id: string): boolean {
  return hitchedTows(world).some((s) => s.other === id);
}

export function ropeClientOf(world: World, towerId: string): string | null {
  return hitchedTows(world).find((s) => s.holder === towerId)?.other ?? null;
}

export function isTowing(world: World, id: string): boolean {
  return hitchedTows(world).some((s) => s.holder === id);
}

export function towsClient(world: World, tower: Vehicle, client: Vehicle): boolean {
  return stateOf(world, 'tow', tower.id, client.id) !== null || stateOf(world, 'answering', tower.id, client.id) !== null;
}

function isPlayer(world: World, v: Vehicle): boolean {
  return v.id === world.player.vehicleId;
}

function towAllowed(world: World, tower: Vehicle, client: Vehicle): boolean {
  const raider = (v: Vehicle) => v.faction === 'raiders';
  if (raider(tower)) return raider(client);
  return !raider(client) || isPlayer(world, tower);
}

function canTow(world: World, tower: Vehicle, client: Vehicle): boolean {
  return canPull(world, tower, client) && ropesFree(world, tower, client) && unclaimed(world, tower, client)
    && awake(world, client) && towDestination(world, tower, client) !== null;
}

function canPull(world: World, tower: Vehicle, client: Vehicle): boolean {
  if (tower.id === client.id || !isStranded(world, client) || isStranded(world, tower)) return false;
  return towAllowed(world, tower, client) && !isHostile(world, tower, client);
}

function ropesFree(world: World, tower: Vehicle, client: Vehicle): boolean {
  return !towOf(world, client.id) && !towOf(world, tower.id) && !towHeldBy(world, client.id)
    && !awaitsPatch(world, client) && !busyElsewhere(world, tower, client);
}

function unclaimed(world: World, tower: Vehicle, client: Vehicle): boolean {
  return isPlayer(world, tower) || !answeredByOther(world, tower, client);
}

function awake(world: World, client: Vehicle): boolean {
  return isPlayer(world, client) ? world.player.state === 'active' : !isKnockedOut(client);
}

function busyElsewhere(world: World, tower: Vehicle, client: Vehicle): boolean {
  return world.states.some((s) => (s.kind === 'tow' || s.kind === 'answering') && s.holder === tower.id && s.other !== client.id);
}

function awaitsPatch(world: World, v: Vehicle): boolean {
  return world.states.some((s) => s.kind === 'patch' && (s.holder === v.id || s.other === v.id));
}

function answeredByOther(world: World, tower: Vehicle, client: Vehicle): boolean {
  return world.states.some((s) => s.kind === 'answering' && s.other === client.id && s.holder !== tower.id);
}

function towDestination(world: World, tower: Vehicle, client: Vehicle): Site | null {
  if (!isPlayer(world, client) && !client.brain) return null;
  const site = isPlayer(world, client) ? nearestSite(npcProfile(tower).towns, client.pos) : npcHomeSite(client);
  return site && !canUseSite(client.pos, site) ? site : null;
}

export function npcHomeSite(v: Vehicle): Site | null {
  const profile = npcProfile(v);
  return nearestSite(profile.bases.length > 0 ? profile.bases : profile.towns, v.pos);
}

function nearestSite(ids: readonly string[], from: Vec): Site | null {
  const sites = ids.map(getKnownSite).sort((a, b) => dist(from, a.pos) - dist(from, b.pos));
  return sites[0] ?? null;
}

export function towSite(world: World, tower: Vehicle, client: Vehicle): Site {
  const site = towDestination(world, tower, client);
  if (!site) throw new Error(`${tower.id} has nowhere to tow ${client.id}`);
  return site;
}

export function canTowNpc(world: World, npc: Vehicle): boolean {
  const me = playerVehicle(world);
  return canTow(world, me, npc) && inTowReach(me, npc);
}

export function npcTowTerms(world: World, npc: Vehicle): { site: Site; fee: number; full: number } {
  const me = playerVehicle(world);
  const site = towSite(world, me, npc);
  const full = towFee(world, me, npc, site);
  return { site, fee: Math.min(full, Math.max(0, getResources(world, npc).money)), full };
}

export function hitchNpc(world: World, npc: Vehicle, free: boolean): void {
  if (!canTowNpc(world, npc)) throw new Error(`The player cannot tow ${npc.id}`);
  const { site, fee, full } = npcTowTerms(world, npc);
  const terms = free ? { fee: 0, waived: full } : { fee, waived: 0 };
  addState(world, 'tow', world.player.vehicleId, npc.id, { kind: 'tow', site: site.id, ...terms, hitched: true });
  npc.order = null;
  npc.speed = 0;
  delete npc.brain!.farRoute;
}

export function releaseNpc(world: World, npc: Vehicle): void {
  const tow = playerTowing(world);
  if (tow?.other !== npc.id) throw new Error(`The player does not tow ${npc.id}`);
  endState(world, tow, 'broken');
}

export function checkTowPromise(world: World, s: NpcState): StateEnding | null {
  const client = world.vehicles.find((v) => v.id === s.other);
  return client && !isStranded(world, client) ? 'broken' : null;
}

export function checkPlayerTow(world: World, s: NpcState): StateEnding | null {
  const me = world.vehicles.find((v) => v.id === s.holder);
  const npc = world.vehicles.find((v) => v.id === s.other);
  if (!me || !npc) return null;
  if (isHostile(world, me, npc)) return 'broken';
  return canUseSite(me.pos, getKnownSite(towData(s).site)) ? 'fulfilled' : null;
}

export function towGoal(world: World, vehicle: Vehicle): NpcActivity {
  const tow = towHeldBy(world, vehicle.id);
  if (!tow) throw new Error(`${vehicle.id} holds no tow`);
  const data = towData(tow);
  if (!data.hitched) return { kind: 'tow', targetId: tow.other, destination: null, phase: 'act', reason: 'wait for an answer to a tow offer' };
  const site = getKnownSite(data.site);
  const reason = tow.other === world.player.vehicleId ? 'tow the player to town' : 'tow a stranded truck';
  return { kind: 'tow', targetId: site.id, destination: { ...site.pos }, phase: 'travel', reason };
}

export function strandedAt(world: World, vehicle: Vehicle, client: Vehicle): Vec | null {
  if ((!isPlayer(world, client) && inCombatWithOther(world, client, vehicle.id)) || !canTow(world, vehicle, client)) return null;
  if (canVehicleSee(world, vehicle, client.pos)) return client.pos;
  return isPlayer(world, client) ? beaconCenter(world, vehicle, client) : null;
}

export function steerToStranded(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const at = strandedAt(world, vehicle, vehicleById(world, goal.targetId!));
  if (at) goal.destination = { ...at };
}

export function strandedPlayerAt(world: World, vehicle: Vehicle): Vec | null {
  return strandedAt(world, vehicle, playerVehicle(world));
}

function beaconCenter(world: World, listener: Vehicle, me: Vehicle): Vec | null {
  if (!hearsBeacon(world, listener, me)) return null;
  const contact = contactsOf(world, listener, BEACON.range).find((c) => c.vehicleId === me.id);
  if (!contact) throw new Error(`${listener.id} hears the beacon but has no contact for it`);
  return contact.center;
}

export function setBeacon(world: World, on: boolean): World {
  return playerCommand(world, (w) => {
    if (on && !isStranded(w, playerVehicle(w))) throw new Error('The beacon needs a stranded truck');
    w.player.beacon = on;
  });
}

export function checkBeacon(world: World): void {
  if (!world.player.beacon) return;
  if (isTowed(world) || !isStranded(world, playerVehicle(world))) world.player.beacon = false;
}

export function runTow(world: World, vehicle: Vehicle, activity: NpcActivity): string | null {
  const held = towHeldBy(world, vehicle.id);
  if (held && !towData(held).hitched) {
    if (inTowReach(vehicle, vehicleById(world, held.other))) return null;
    refuse(world, held);
    return 'the player drove away from the tow offer';
  }
  if (held) {
    if (!canUseSite(vehicleById(world, held.other).pos, getKnownSite(towData(held).site))) return null;
    activity.phase = 'act';
    endState(world, held, 'fulfilled');
    return held.other === world.player.vehicleId ? 'towed the player to town' : 'towed a stranded truck';
  }
  return reachClient(world, vehicle, activity, vehicleById(world, activity.targetId!));
}

function reachClient(world: World, tower: Vehicle, activity: NpcActivity, client: Vehicle): string | null {
  if (!isStranded(world, client) || !towDestination(world, tower, client)) return 'the truck needs no tow anymore';
  if (!stateOf(world, 'answering', tower.id, client.id)) return 'could not get through to the truck';
  if (!readyToTow(world, tower, client)) return null;
  activity.phase = 'act';
  if (isPlayer(world, client)) offer(world, tower, client);
  else hitch(world, tower, client);
  return null;
}

function towerTerms(world: World, tower: Vehicle, client: Vehicle): { site: string; fee: number } {
  const promise = stateOf(world, 'towPromise', tower.id, client.id);
  if (promise) {
    const kept = towPromiseData(promise);
    endState(world, promise, 'fulfilled');
    return kept;
  }
  const site = towSite(world, tower, client);
  return { site: site.id, fee: towFee(world, tower, client, site) };
}

function leftForDanger(world: World, tower: Vehicle, client: Vehicle): boolean {
  const promise = stateOf(world, 'towPromise', tower.id, client.id);
  return promise !== null && world.turn - promise.born < TOW.dangerWait;
}

function readyToTow(world: World, tower: Vehicle, client: Vehicle): boolean {
  if (towOf(world, client.id) || !inTowReach(tower, client) || leftForDanger(world, tower, client)) return false;
  return !isPlayer(world, client) || !inCombat(world, client);
}

function endClaim(world: World, tower: Vehicle, client: Vehicle): void {
  const claim = stateOf(world, 'answering', tower.id, client.id);
  if (!claim) throw new Error(`${tower.id} tows ${client.id} it never answered`);
  endState(world, claim, 'fulfilled');
}

function offer(world: World, tower: Vehicle, me: Vehicle): void {
  const terms = towerTerms(world, tower, me);
  const { site } = terms;
  const fee = getResources(world, me).money <= 0 ? 0 : terms.fee;
  endClaim(world, tower, me);
  addState(world, 'tow', tower.id, me.id, { kind: 'tow', site, fee, waived: 0, hitched: false });
  world.events.push({ t: 'towOffer', by: tower.id, town: site, fee });
}

function hitch(world: World, tower: Vehicle, client: Vehicle): void {
  const { site, fee } = towerTerms(world, tower, client);
  endClaim(world, tower, client);
  const paid = Math.min(fee, Math.max(0, getResources(world, client).money));
  addState(world, 'tow', tower.id, client.id, { kind: 'tow', site, fee: paid, waived: 0, hitched: true });
  client.order = null;
  client.speed = 0;
  delete client.brain!.farRoute;
  world.events.push({ t: 'towHitched', by: tower.id, client: client.id, site });
}

function towFee(world: World, tower: Vehicle, client: Vehicle, site: Site): number {
  const pad = nearestPad(site, client.pos);
  const length = routeLength(client.pos, route(world, client.pos, pad, vehicleStats(world, tower).radius, [], tower));
  const involved = isPlayer(world, tower) || isPlayer(world, client);
  const cut = involved ? 1 - skillEffect(world, playerVehicle(world), 'social', 'towFee') : 1;
  return Math.round(Math.min(TOW.maxFee, TOW.base + TOW.perTile * length) * cut);
}

function refuse(world: World, tow: NpcState): void {
  addState(world, 'turnedDown', tow.holder, tow.other, { kind: 'none' });
  dropTow(world, tow, 'refused');
}

export function lapseClaim(world: World, claim: NpcState): void {
  world.events.push({ t: 'towDropped', by: claim.holder, client: claim.other, reason: 'blocked' });
}

export function dropTow(world: World, tow: NpcState, reason: DropReason): void {
  const data = towData(tow);
  endState(world, tow, 'broken');
  if (data.hitched && reason === 'danger') addState(world, 'towPromise', tow.holder, tow.other, { kind: 'towPromise', site: data.site, fee: data.fee });
  world.events.push({ t: 'towDropped', by: tow.holder, client: tow.other, reason });
}

export function dropStrandedTowers(world: World): void {
  for (const tow of hitchedTows(world)) {
    const tower = world.vehicles.find((v) => v.id === tow.holder);
    if (!tower || !isStranded(world, tower)) continue;
    dropTow(world, tow, 'stranded');
    if (tower.brain && popGoal(world, tower, 'cannot drive').kind !== 'tow') throw new Error(`${tower.id} held a tow without a tow goal on top`);
  }
}

export function followTower(world: World): void {
  for (const tow of hitchedTows(world)) follow(vehicleById(world, tow.holder), vehicleById(world, tow.other));
}

function follow(tower: Vehicle, towed: Vehicle): void {
  if (tower.trail.length === 0) throw new Error(`Tower ${tower.id} has no trail to follow`);
  const towerAxle = axleTiles(tower.chassisId);
  const towedAxle = axleTiles(towed.chassisId);
  const bar = TOW.gap - towerAxle - towedAxle;
  if (bar <= 0) throw new Error(`Tow bar of ${tower.chassisId} and ${towed.chassisId} is ${bar} tiles, not above 0`);
  const start: Pose = { x: towed.pos.x, y: towed.pos.y, heading: towed.heading };
  let front = axlePoint(start, towedAxle);
  let rear = axlePoint(start, -towedAxle);
  let prevHitch = axlePoint(tower.trail[0], -towerAxle);
  const trail: Pose[] = [start];
  for (let i = 1; i < tower.trail.length; i++) {
    const hitch = axlePoint(tower.trail[i], -towerAxle);
    ({ front, rear } = trailerStep(front, rear, hitch, bar, TOW.takeUp * dist(hitch, prevHitch), towedAxle));
    prevHitch = hitch;
    trail.push({ x: (front.x + rear.x) / 2, y: (front.y + rear.y) / 2, heading: bearing(rear, front) });
  }
  towed.trail = trail;
  const end = trail[trail.length - 1];
  towed.pos = { x: end.x, y: end.y };
  towed.heading = end.heading;
  towed.speed = tower.speed;
}

function axleTiles(chassisId: string): number {
  return bodyOf(chassisId).wheelX / PHYSICS.metersPerTile;
}

function axlePoint(p: Pose, offset: number): Vec {
  return { x: p.x + Math.cos(p.heading) * offset, y: p.y + Math.sin(p.heading) * offset };
}

function trailerStep(front: Vec, rear: Vec, hitch: Vec, bar: number, maxMove: number, towedAxle: number): { front: Vec; rear: Vec } {
  const away = dist(hitch, front);
  let nextFront = front;
  if (away > 0) {
    const target = { x: hitch.x + ((front.x - hitch.x) / away) * bar, y: hitch.y + ((front.y - hitch.y) / away) * bar };
    const want = dist(front, target);
    const t = want === 0 ? 0 : Math.min(1, maxMove / want);
    nextFront = { x: front.x + (target.x - front.x) * t, y: front.y + (target.y - front.y) * t };
  }
  const span = dist(rear, nextFront);
  const wheelbase = 2 * towedAxle;
  if (span === 0) return { front: nextFront, rear };
  return { front: nextFront, rear: { x: nextFront.x + ((rear.x - nextFront.x) / span) * wheelbase, y: nextFront.y + ((rear.y - nextFront.y) / span) * wheelbase } };
}

export function acceptOffer(world: World): void {
  const tow = openOffer(world);
  towData(tow).hitched = true;
  const me = playerVehicle(world);
  me.order = null;
  me.speed = 0;
  checkBeacon(world);
}

export function refuseOffer(world: World): void {
  refuse(world, openOffer(world));
}

function openOffer(world: World): NpcState {
  const tow = playerTow(world);
  if (!tow || towData(tow).hitched) throw new Error('No open tow offer');
  return tow;
}

export function unhitch(world: World): World {
  return update(world, (w) => {
    if (w.player.state !== 'active') throw new Error(`Player is ${w.player.state}`);
    const tow = playerTow(w);
    if (!tow || !towData(tow).hitched) throw new Error('Player is not towed');
    addState(w, 'turnedDown', tow.holder, tow.other, { kind: 'none' });
    dropTow(w, tow, 'unhitched');
  });
}

const FOLLOWING: readonly StateKindId[] = ['escort'];

export function follows(world: World, follower: Vehicle, leaderId: string): boolean {
  return world.states.some((s) => FOLLOWING.includes(s.kind) && s.holder === follower.id && s.other === leaderId);
}

export function followGoal(leader: Vehicle): NpcActivity {
  return { kind: 'follow', targetId: leader.id, destination: { ...leader.pos }, phase: 'travel', reason: 'follow its leader' };
}

export function startEscort(world: World, escort: Vehicle, leader: Vehicle, site: string | null, fee: number): NpcActivity {
  addState(world, 'escort', escort.id, leader.id, { kind: 'escort', site, fee });
  const goal = followGoal(leader);
  placeBase(world, escort, goal);
  return goal;
}

export function steerFollow(world: World, vehicle: Vehicle, goal: NpcActivity): void {
  const leader = vehicleById(world, goal.targetId!);
  const rank = escortsOf(world, leader.id).findIndex((e) => e.id === vehicle.id);
  if (rank < 0) throw new Error(`${vehicle.id} follows ${leader.id} without escorting it`);
  const radii = vehicleStats(world, leader).radius + vehicleStats(world, vehicle).radius;
  const side = (rank % 2 === 0 ? 1 : -1) * (radii + NPC_BEHAVIOR.followGap);
  const back = radii * (1 + 2 * Math.floor(rank / 2)) - leader.speed;
  const fx = Math.cos(leader.heading);
  const fy = Math.sin(leader.heading);
  goal.destination = { x: leader.pos.x - fx * back - fy * side, y: leader.pos.y - fy * back + fx * side };
}

export function followPace(follower: Vehicle, leader: Vehicle, spot: Vec): number {
  const ahead = (spot.x - follower.pos.x) * Math.cos(leader.heading) + (spot.y - follower.pos.y) * Math.sin(leader.heading);
  return Math.max(0, ahead);
}

export function escortsOf(world: World, leaderId: string): Vehicle[] {
  const holders = new Set(world.states.filter((s) => s.kind === 'escort' && s.other === leaderId).map((s) => s.holder));
  return world.vehicles.filter((v) => holders.has(v.id));
}

export function unguardedLeader(world: World, guard: Vehicle): Vehicle | null {
  const tpl = NPCS[guard.brain!.templateId];
  if (!tpl || tpl.spawn.kind !== 'escort') throw new Error(`${guard.id} has no escort template`);
  const place = tpl.spawn;
  const free = world.vehicles.filter((v) => v.brain?.templateId === place.of && v.faction === guard.faction && !isDefeated(v) && escortsOf(world, v.id).length === 0);
  return free.sort((a, b) => dist(guard.pos, a.pos) - dist(guard.pos, b.pos))[0] ?? null;
}

export function joinLeader(world: World, guard: Vehicle): NpcActivity {
  const leader = unguardedLeader(world, guard);
  if (!leader) throw new Error(`${guard.id} chose an escort with no unguarded leader`);
  return startEscort(world, guard, leader, null, 0);
}

function escortData(s: NpcState): Extract<StateData, { kind: 'escort' }> {
  if (s.data.kind !== 'escort') throw new Error(`State ${s.id} holds no escort`);
  return s.data;
}

export function checkEscort(w: World, s: NpcState): StateEnding | null {
  const escort = w.vehicles.find((v) => v.id === s.holder);
  const leader = w.vehicles.find((v) => v.id === s.other);
  if (!escort || !leader) return null;
  if (escortBroken(w, escort, leader)) return 'broken';
  const site = escortData(s).site;
  return site !== null && reachedSite(leader.pos, getKnownSite(site)) ? 'fulfilled' : null;
}

function escortBroken(w: World, escort: Vehicle, leader: Vehicle): boolean {
  return isDefeated(escort) || isDefeated(leader) || isHostile(w, escort, leader) || isHostile(w, leader, escort);
}

export function payEscort(w: World, s: NpcState): void {
  const leader = getResources(w, vehicleById(w, s.other));
  const fee = Math.min(escortData(s).fee, Math.max(0, leader.money));
  leader.money -= fee;
  getResources(w, vehicleById(w, s.holder)).money += fee;
  w.events.push({ t: 'escortPaid', by: s.holder, client: s.other, fee });
}

const TRIPS: readonly NpcActivity['kind'][] = ['trade', 'sell', 'travel'];

export function tripSite(client: Vehicle): string | null {
  const base = client.brain?.goals[0];
  return base && TRIPS.includes(base.kind) ? base.targetId : null;
}

export function escortFee(client: Vehicle, site: string): number {
  return Math.round(dist(client.pos, getKnownSite(site).pos) * NPC_BEHAVIOR.escortFeePerTile);
}

export function isFreeMerc(world: World, v: Vehicle): boolean {
  if (!v.brain?.traits.includes('merc') || isDefeated(v)) return false;
  return !world.states.some((s) => s.kind === 'escort' && s.holder === v.id);
}

export function mercsInSight(world: World, client: Vehicle): Vehicle[] {
  const mercs = world.vehicles.filter((v) => v.id !== client.id && isFreeMerc(world, v) && !inCombatWithOther(world, v, client.id) && !isHostile(world, client, v) && canVehicleSee(world, client, v.pos));
  return mercs.sort((a, b) => dist(client.pos, a.pos) - dist(client.pos, b.pos));
}

export function canHire(world: World, client: Vehicle, merc: Vehicle): boolean {
  const site = tripSite(client);
  if (site === null || escortsOf(world, client.id).length > 0) return false;
  if (getResources(world, client).money - getUpkeepReserve(client) < escortFee(client, site)) return false;
  return mercsInSight(world, client).some((v) => v.id === merc.id);
}

export function offerEscort(world: World, client: Vehicle, merc: Vehicle): void {
  const site = tripSite(client);
  if (site === null) throw new Error(`${client.id} offers an escort with no trip`);
  if (decide(world, merc, 'hireOffered', client.id, null) === 'decline') {
    world.events.push({ t: 'escortRefused', by: merc.id, client: client.id });
    return;
  }
  const fee = escortFee(client, site);
  startEscort(world, merc, client, site, fee);
  world.events.push({ t: 'escortHired', by: merc.id, client: client.id, site, fee });
}

export function canTakeEscort(world: World, merc: Vehicle, client: Vehicle): boolean {
  return isFreeMerc(world, merc) && !isHostile(world, merc, client);
}

export function declineFactor(world: World, merc: Vehicle): number {
  return isWeak(world, merc) ? NPC_BEHAVIOR.weakDecline : 1;
}
