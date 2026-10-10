
import { CRATER } from '../data/rules';
import { PHYSICS } from '../data/physics';
import { TERRAIN_TYPES } from '../data/terrain';
import { TIME } from '../data/time';
import { atlasOf } from './atlas';
import { deckAt } from './bridge';
import { canVanish } from './salvage';
import { tileAt } from './terrain';
import type { Crater, World } from './types';
import { dist, type Vec } from './vec';

const M = PHYSICS.metersPerTile;

export function digCrater(world: World, pos: Vec, radius: number): void {
  if (deckAt(atlasOf(world.terrain).decks, pos.x, pos.y) !== null) return;
  if (!TERRAIN_TYPES[world.terrain.types[tileAt(world.terrain, pos)]].craters) return;
  const host = world.craters.find((c) => dist(c.pos, pos) * M < c.radius);
  const merged: Crater = { id: freeId(world), pos: host ? host.pos : { ...pos }, radius, turn: world.turn };
  for (let c = overlapping(world, merged); c; c = overlapping(world, merged)) {
    merged.radius = Math.max(merged.radius, c.radius);
    world.craters = world.craters.filter((x) => x !== c);
  }
  world.craters.push(merged);
}

function overlapping(world: World, crater: Crater): Crater | undefined {
  return world.craters.find((c) => dist(c.pos, crater.pos) * M < Math.max(c.radius, crater.radius));
}

function freeId(world: World): string {
  const taken = new Set(world.craters.map((c) => c.id));
  let k = 0;
  while (taken.has(`crater-${world.turn}-${k}`)) k++;
  return `crater-${world.turn}-${k}`;
}

export function fadeCraters(world: World): void {
  const due = CRATER.days * TIME.turnsPerDay;
  world.craters = world.craters.filter((c) => world.turn - c.turn < due || !canVanish(world, c.pos, craterReach(c)));
}

export function craterReach(c: Crater): number {
  return (c.radius * (1 + CRATER.rimWidthRatio / 2)) / M;
}

export function craterRimPoints(c: Crater): Vec[] {
  return Array.from({ length: CRATER.rimSegments }, (_, k) => {
    const a = (2 * Math.PI * k) / CRATER.rimSegments;
    const h = Math.sin(c.pos.x * 12.9898 + c.pos.y * 78.233 + k * 37.719) * 43758.5453;
    const r = (c.radius / M) * (1 - CRATER.rimJitter * (h - Math.floor(h)));
    return { x: c.pos.x + Math.cos(a) * r, y: c.pos.y + Math.sin(a) * r };
  });
}
