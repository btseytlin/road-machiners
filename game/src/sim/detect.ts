// Detection beyond sight: engine sound, dust trails and radio scanners give rough contacts, and the player's
// emergency beacon gives a tight one. At night a flare's launch and its light show the launcher.
// The same rules run for the player and every NPC: contactsOf takes any observer.

import { DETECT } from '../data/detect';
import { RULES } from '../data/rules';
import { TERRAIN, TERRAIN_TYPES } from '../data/terrain';
import type { EngineDef, ScannerDef } from '../data/parts';
import { partDef } from '../data/parts';
import { wornDef } from './wear';
import { mountedParts } from './grid';
import { hasPerk, skillEffect, vehicleHasPerk } from './progress';
import { PERK_NUMBERS } from '../data/skills';
import { hashRandom } from './rng';
import { heightAt, tileAt } from './terrain';
import { hasWorkingEngine, isStalled, isStranded, vehicleStats } from './stats';
import { sunAt } from './sun';
import type { Contact, DustCloud, Vehicle, World } from './types';
import { BEACON } from '../data/tow';
import { WEATHER } from '../data/weather';
import { dist, type Vec } from './vec';
import { flareSightings, litAt, type FlareSighting } from './hazards';
import { isShutDown } from './utility';
import { weatherOn } from './weather';
import { isCheapMeeting } from './fidelity';
import { canVehicleSee, playerSees, sightRadius } from './vision';
import { playerCanAct, update } from './world';

export function soundRange(world: World, v: Vehicle): number {
  if (v.speed <= RULES.parkedSpeed || !engineRuns(world, v) || isStranded(world, v)) return 0;
  const noise = (partDef(mountedParts(v, 'engine')[0].defId) as EngineDef).noise;
  return (DETECT.sound.limp + DETECT.sound.perSpeed * Math.max(0, v.speed - RULES.limpSpeed)) * noise;
}

function engineRuns(world: World, v: Vehicle): boolean {
  return hasWorkingEngine(v) && !isStalled(world, v) && !isShutDown(world, v);
}

function ownHearingPenalty(observer: Vehicle): number {
  return observer.speed <= RULES.parkedSpeed ? 0 : DETECT.sound.ownPenalty * observer.speed;
}

function hearingRange(world: World, observer: Vehicle, v: Vehicle): number {
  const reach = soundRange(world, v) * (1 + skillEffect(world, observer, 'perception', 'hearing'));
  const cold = runsCold(world, v) ? Math.min(reach, sightRadius(world, observer)) : reach;
  return cold - ownHearingPenalty(observer);
}

function runsCold(world: World, v: Vehicle): boolean {
  return vehicleHasPerk(world, v, 'coldRunning') && v.speed < vehicleStats(world, v).maxSpeed * PERK_NUMBERS.coldRunning.speedShare;
}

export function dustRange(world: World, v: Vehicle): number {
  if (v.speed <= RULES.limpSpeed || isStranded(world, v)) return 0;
  if (!sunAt(world.turn)) return 0;
  const terrainType = TERRAIN_TYPES[world.terrain.types[tileAt(world.terrain, v.pos)]];
  const weather = weatherOn(world, v);
  return DETECT.dust.perSpeed * v.speed * terrainType.dust * weather.sight;
}

function dustVisible(world: World, a: Vec, b: Vec, age: number): boolean {
  const eyeA = heightAt(world.terrain, a.x, a.y) + DETECT.dust.eyeHeight;
  const eyeB = heightAt(world.terrain, b.x, b.y) + DETECT.dust.eyeHeight + age * DETECT.dust.riseHeight;
  const n = Math.ceil(dist(a, b) * DETECT.dust.samplesPerTile);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ground = heightAt(world.terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (ground > eyeA + (eyeB - eyeA) * t) return false;
  }
  return true;
}

export function scannerRange(world: World, v: Vehicle): number {
  const scanners = mountedParts(v, 'scanner');
  if (scanners.length === 0 || isShutDown(world, v)) return 0;
  return wornDef<ScannerDef>(scanners[0]).range;
}

function idKey(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
}

export function contactsOf(world: World, observer: Vehicle, within: number): Contact[] {
  return sensesOf(world, observer, within).contacts;
}

export function sensesOf(world: World, observer: Vehicle, within: number): { seen: Vehicle[]; contacts: Contact[] } {
  const seen: Vehicle[] = [];
  const contacts: Contact[] = [];
  const sight = sightTo(world, observer);
  const listener = { scanned: scannerRange(world, observer), clouds: cloudsSeenBy(world, observer).filter((c) => dist(observer.pos, c.pos) <= within) };
  for (const v of world.vehicles) {
    const d = dist(observer.pos, v.pos);
    if (v.id === observer.id || d > within) continue;
    if (seesNear(world, observer, sight, v, d)) seen.push(v);
    else contacts.push(...contactWith(world, observer, listener, v, d));
  }
  addFlares(world, observer, within, sight, contacts);
  return { seen, contacts };
}

function contactWith(world: World, observer: Vehicle, listener: { scanned: number; clouds: DustCloud[] }, v: Vehicle, d: number): Contact[] {
  const dust = newestCloud(listener.clouds, v.id);
  const sources = sourcesOf(world, observer, listener.scanned, v, d, dust !== null);
  if (sources.length === 0) return [];
  const loudness = sources.includes('sound') ? soundRange(world, v) : null;
  return [{ vehicleId: v.id, ...contactCircle(world, observer, v, sources, d, dust), sources, loudness }];
}

function sourcesOf(world: World, observer: Vehicle, scanned: number, v: Vehicle, d: number, dusty: boolean): Contact['sources'] {
  const moving = v.speed > RULES.parkedSpeed;
  const sound = moving && hears(world, observer, v, d);
  const radio = moving && inScanner(scanned, d);
  return [...(sound ? ['sound' as const] : []), ...(dusty ? ['dust' as const] : []), ...(radio ? ['radio' as const] : []), ...trackingSources(world, observer, v)];
}

function inScanner(scanned: number, d: number): boolean {
  return scanned > 0 && d <= scanned;
}

function hears(world: World, observer: Vehicle, v: Vehicle, d: number): boolean {
  const heard = Math.max(0, hearingRange(world, observer, v));
  return heard > 0 && d <= heard;
}

function sightTo(world: World, observer: Vehicle): (p: Vec) => number {
  const dark = sightRadius(world, observer);
  const lit = sightRadius(world, observer, true);
  return (p) => (litAt(world, p) ? lit : dark);
}

function seesNear(world: World, observer: Vehicle, sight: (p: Vec) => number, v: Vehicle, d: number): boolean {
  return d <= sight(v.pos) && canVehicleSee(world, observer, v.pos);
}

function addFlares(world: World, observer: Vehicle, within: number, sight: (p: Vec) => number, out: Contact[]): void {
  for (const s of flareSightings(world, observer)) {
    const d = dist(observer.pos, s.launcher.pos);
    if (d <= within && !seesNear(world, observer, sight, s.launcher, d)) addFlare(out, s.launcher, flareCircle(world, s));
  }
}

function addFlare(out: Contact[], v: Vehicle, circle: { center: Vec; radius: number }): void {
  const known = out.find((c) => c.vehicleId === v.id);
  if (!known) {
    out.push({ vehicleId: v.id, ...circle, sources: ['flare'], loudness: null });
    return;
  }
  if (!known.sources.includes('flare')) known.sources.push('flare');
  if (circle.radius < known.radius) Object.assign(known, circle);
}

function flareCircle(world: World, s: FlareSighting): { center: Vec; radius: number } {
  if (s.at) return { center: { ...s.at }, radius: DETECT.fuzz.base + dist(s.at, s.launcher.pos) };
  return { center: jittered(world, s.launcher, DETECT.fuzz.base), radius: DETECT.fuzz.base };
}

function trackingSources(world: World, observer: Vehicle, v: Vehicle): Contact['sources'] {
  return [...(hearsBeacon(world, observer, v) ? ['beacon' as const] : []), ...(isMarkedFor(world, observer, v) ? ['mark' as const] : [])];
}

function isMarkedFor(world: World, observer: Vehicle, v: Vehicle): boolean {
  return observer.id === world.player.vehicleId && world.player.marked.some((m) => m.vehicleId === v.id && world.turn <= m.until);
}

export function markError(world: World, vehicleId: string): string | null {
  if (!hasPerk(world, 'spotter')) return 'Marking a truck needs the spotter perk';
  if (!playerCanAct(world)) return 'The player cannot act now';
  const v = world.vehicles.find((x) => x.id === vehicleId && x.id !== world.player.vehicleId);
  if (!v) return `No other truck ${vehicleId} to mark`;
  return playerSees(world, v.pos) ? null : `The player does not see ${vehicleId}`;
}

export function markVehicle(world: World, vehicleId: string): World {
  const error = markError(world, vehicleId);
  if (error) throw new Error(error);
  return update(world, (w) => {
    const others = w.player.marked.filter((m) => m.vehicleId !== vehicleId);
    w.player.marked = [...others, { vehicleId, until: w.turn + PERK_NUMBERS.spotter.turns }];
  });
}

export function contactDifficulty(world: World, observer: Vehicle, contact: Contact): number {
  const v = world.vehicles.find((x) => x.id === contact.vehicleId);
  if (!v) throw new Error(`Contact with unknown vehicle ${contact.vehicleId}`);
  const shares = contact.sources.map((source) => channelShare(world, observer, v, source));
  return Math.min(1, ...shares);
}

function channelShare(world: World, observer: Vehicle, v: Vehicle, source: Contact['sources'][number]): number {
  if (source === 'mark' || source === 'flare') return 0;
  if (source === 'dust') {
    const cloud = newestCloud(cloudsSeenBy(world, observer), v.id);
    if (!cloud) throw new Error(`Dust contact on ${v.id} has no seen cloud`);
    return reachShare(dist(observer.pos, cloud.pos), cloud.range, source);
  }
  return reachShare(dist(observer.pos, v.pos), sourceReach(world, observer, v, source), source);
}

function sourceReach(world: World, observer: Vehicle, v: Vehicle, source: Exclude<Contact['sources'][number], 'dust' | 'mark' | 'flare'>): number {
  switch (source) {
    case 'sound': return hearingRange(world, observer, v);
    case 'radio': return scannerRange(world, observer);
    case 'beacon': return BEACON.range;
  }
}

function reachShare(distance: number, reach: number, source: string): number {
  if (!(reach > 0)) throw new Error(`A ${source} contact has reach ${reach}`);
  return distance / reach;
}

export function hearsBeacon(world: World, observer: Vehicle, v: Vehicle): boolean {
  return world.player.beacon && v.id === world.player.vehicleId && dist(observer.pos, v.pos) <= BEACON.range;
}

function contactCircle(world: World, observer: Vehicle, v: Vehicle, sources: Contact['sources'], d: number, dust: DustCloud | null): { center: Vec; radius: number } {
  if (sources.length === 1 && dust) return { center: { ...dust.pos }, radius: DETECT.fuzz.base + dist(dust.pos, v.pos) };
  const fix = 1 - skillEffect(world, observer, 'perception', 'contactFix');
  const sensed = (DETECT.fuzz.base + (sources.includes('radio') || sources.includes('mark') ? DETECT.fuzz.radioPerTile : DETECT.fuzz.perTile) * d) * fix;
  const radius = sources.includes('beacon') ? Math.min(BEACON.radius, sensed) : sensed;
  return { center: jittered(world, v, radius), radius };
}

function jittered(world: World, v: Vehicle, radius: number): Vec {
  const key = idKey(v.id);
  const angle = hashRandom(world.seed, world.turn, key, 1) * Math.PI * 2;
  const frac = hashRandom(world.seed, world.turn, key, 2);
  return { x: v.pos.x + Math.cos(angle) * frac * radius, y: v.pos.y + Math.sin(angle) * frac * radius };
}

export function advanceDust(world: World): void {
  const D = DETECT.dust;
  for (const c of world.dustClouds) {
    const key = idKey(c.id);
    const a = hashRandom(world.seed, world.turn, key, 4) * Math.PI * 2;
    const push = hashRandom(world.seed, world.turn, key, 5) * D.wander;
    c.vel = { x: c.vel.x + Math.cos(a) * push, y: c.vel.y + Math.sin(a) * push };
    c.pos = { x: c.pos.x + c.vel.x, y: c.pos.y + c.vel.y };
    c.age++;
  }
  world.dustClouds = world.dustClouds.filter((c) => c.age < D.lifetime);
  for (const v of world.vehicles) {
    const range = dustRange(world, v);
    if (range <= 0) continue;
    const back = { x: -Math.cos(v.heading) * D.backDrift, y: -Math.sin(v.heading) * D.backDrift };
    world.dustClouds.push({
      id: `dust-${v.id}-${world.turn}`, source: v.id, pos: dustSpawn(v),
      vel: { x: back.x + WEATHER.wind.x * D.windDrift, y: back.y + WEATHER.wind.y * D.windDrift }, age: 0, range,
      ...(raisesScreen(world, v) ? { screen: true as const } : {}),
    });
  }
}

function raisesScreen(world: World, v: Vehicle): boolean {
  return vehicleHasPerk(world, v, 'dustScreen') && v.speed >= vehicleStats(world, v).maxSpeed * PERK_NUMBERS.dustScreen.topShare;
}

export function cloudsSeenBy(world: World, observer: Vehicle): DustCloud[] {
  const sight = sightTo(world, observer);
  return world.dustClouds.filter((c) => {
    if (c.source === observer.id) return false;
    const d = dist(observer.pos, c.pos);
    if (d <= sight(c.pos) && canVehicleSee(world, observer, c.pos)) return true;
    return seesRisenCloud(world, observer, c, d);
  });
}

function seesRisenCloud(world: World, observer: Vehicle, c: DustCloud, d: number): boolean {
  if (c.age < DETECT.dust.riseTurns || d > c.range || isCheapMeeting(world, observer.pos, c.pos)) return false;
  return dustVisible(world, observer.pos, c.pos, c.age);
}

function newestCloud(clouds: DustCloud[], vehicleId: string): DustCloud | null {
  let best: DustCloud | null = null;
  for (const c of clouds) if (c.source === vehicleId && (!best || c.age < best.age)) best = c;
  return best;
}

function dustSpawn(v: Vehicle): Vec {
  if (v.trail.length < 2) throw new Error(`${v.id} moved without a trail`);
  const p = v.trail[Math.floor((v.trail.length - 1) * (1 - DETECT.dust.spawnBack))];
  return { x: p.x, y: p.y };
}
