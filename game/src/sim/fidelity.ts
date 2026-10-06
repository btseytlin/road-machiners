// How much detail the sim spends on a meeting. Near the player, trucks play by the full rules: props and hills block
// sight, dust shows through hills, shade cools. A meeting between two trucks both out of the player's live range
// plays by cheap rules, since nobody watches it: sight is a radius, and heat is the open-sun value.
// Headless mode is a process-level switch for the progression recorder. It counts every truck as far, the player's
// included. It is never saved on the World, so a save keeps its shape.

import { PERF } from '../data/perf';
import { TERRAIN } from '../data/terrain';
import { playerVehicle } from './damage';
import type { World } from './types';
import { dist, type Vec } from './vec';

let headless = false;

export function setHeadless(on: boolean): void {
  headless = on;
}

export function isHeadless(): boolean {
  return headless;
}

// Whether a point lies inside the player's live range: its sight radius plus the margin where NPCs keep physics bodies.
export function inLiveRange(w: World, p: Vec): boolean {
  return !headless && dist(p, playerVehicle(w).pos) <= TERRAIN.vision.radius + PERF.liveMargin;
}

// Whether a meeting at these two points plays by the cheap rules: neither point lies in the player's live range.
export function isCheapMeeting(w: World, a: Vec, b: Vec): boolean {
  return headless || (!inLiveRange(w, a) && !inLiveRange(w, b));
}
