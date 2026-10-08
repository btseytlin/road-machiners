// How much detail the sim spends on a meeting. Near the player, trucks play by the full rules: props and hills block
// sight, dust shows through hills, shade cools. A meeting between two trucks both out of the player's live range
// plays by cheap rules, since nobody watches it: sight is a radius, and heat is the open-sun value.

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

export function inLiveRange(w: World, p: Vec): boolean {
  return !headless && dist(p, playerVehicle(w).pos) <= TERRAIN.vision.radius + PERF.liveMargin;
}

export function isCheapMeeting(w: World, a: Vec, b: Vec): boolean {
  return headless || (!inLiveRange(w, a) && !inLiveRange(w, b));
}
