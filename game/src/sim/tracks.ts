// Tracks: the trucks a driver senses, and where and when it last saw or heard each. A driver knows a truck it saw
// and now only hears as the same truck. A track also holds the driver's choice on a hostile truck, so it decides on
// a hostile once, whichever sense picks it up.
// Every truck the driver sees or detects gets a track, refreshed each turn it does. A track is forgotten
// NPC_BEHAVIOR.noticeMemory turns after the driver last sensed its truck, or NPC_BEHAVIOR.fleeMemory turns for a
// truck it ran from. A goal on the truck keeps it.

import { NPC_BEHAVIOR } from '../data/npcs';
import type { Contact, Track, TrackChoice, Vehicle, World } from './types';
import type { Vec } from './vec';
import { canVehicleSee } from './vision';

export function trackOf(vehicle: Vehicle, id: string): Track | undefined {
  return tracksOf(vehicle)[id];
}

// Records the driver's choice on a truck at `at`, as sensed now. `inSight` tells whether it chose with the truck in
// sight. A choice made on a sound alone leaves the sighting roll for when the truck comes in sight.
export function chooseOn(world: World, vehicle: Vehicle, id: string, at: Vec, choice: TrackChoice, inSight: boolean): void {
  const known = trackOf(vehicle, id);
  const seenSince = known ? known.seenSince : inSight ? world.turn : null;
  tracksOf(vehicle)[id] = { at: { ...at }, turn: world.turn, sighted: inSight || known?.sighted === true, seenSince, choice, chosenInSight: inSight };
}

// Whether the truck came in sight this turn, after a time out of sight or untracked.
export function comesInSight(world: World, track: Track): boolean {
  return track.seenSince === world.turn;
}

// Where the driver senses a truck now: in sight, else at the center of its contact. Undefined when it senses neither.
export function sensedAt(world: World, vehicle: Vehicle, id: string, contacts: Contact[]): Vec | undefined {
  const other = world.vehicles.find((v) => v.id === id);
  if (other && canVehicleSee(world, vehicle, other.pos)) return other.pos;
  return contacts.find((c) => c.vehicleId === id)?.center;
}

// Tracks every truck the driver sees or detects now, and forgets the ones it has not sensed for their memory.
export function senseTracks(world: World, vehicle: Vehicle, seen: Vehicle[], contacts: Contact[]): void {
  const tracks = tracksOf(vehicle);
  loseSight(tracks, seen);
  for (const v of seen) sense(world, tracks, v.id, v.pos, true);
  for (const c of contacts) sense(world, tracks, c.vehicleId, c.center, false);
  for (const [id, track] of Object.entries(tracks)) {
    if (world.turn - track.turn > memoryOf(track) && !vehicle.brain!.goals.some((g) => g.targetId === id)) delete tracks[id];
  }
}

// A tracked truck out of sight now has no turn it came in sight.
function loseSight(tracks: Record<string, Track>, seen: Vehicle[]): void {
  const inSight = new Set(seen.map((v) => v.id));
  for (const [id, track] of Object.entries(tracks)) {
    if (!inSight.has(id)) track.seenSince = null;
  }
}

function sense(world: World, tracks: Record<string, Track>, id: string, at: Vec, inSight: boolean): void {
  const known = tracks[id];
  if (!known) {
    tracks[id] = { at: { ...at }, turn: world.turn, sighted: inSight, seenSince: inSight ? world.turn : null, choice: null, chosenInSight: false };
    return;
  }
  known.at = { ...at };
  known.turn = world.turn;
  known.sighted ||= inSight;
  if (inSight) known.seenSince ??= world.turn;
}

function memoryOf(track: Track): number {
  return track.choice === 'flee' ? NPC_BEHAVIOR.fleeMemory : NPC_BEHAVIOR.noticeMemory;
}

function tracksOf(vehicle: Vehicle): Record<string, Track> {
  if (!vehicle.brain) throw new Error(`${vehicle.id} has no NPC brain`);
  if (!vehicle.brain.tracks) throw new Error(`${vehicle.id} has no tracks`);
  return vehicle.brain.tracks;
}
