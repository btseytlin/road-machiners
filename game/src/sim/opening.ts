// The opening of a new game: the player stranded beside one fixed wreck, with a worn truck. The start kit's
// `opening` says what it holds. The wreck is an ordinary stock under the one rulebook, so NPCs may loot it too.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import type { Opening } from '../data/start';
import { makePart } from './factory';
import { mountedParts } from './grid';
import { emptyHidden } from './salvage';
import type { Obstacle, SalvageStock, Vehicle, World } from './types';
import type { Vec } from './vec';
import { setStartHp } from './wear';

// Matches neither the road wreck ids nor the transient wreck prefix, so it never turns over or restocks and stays
// a fixed drive obstacle.
export const OPENING_WRECK_ID = 'opening-wreck';
const OPENING_WRECK_RADIUS = 0.7; // tiles, a mid road wreck

// REGION.playerStart.wreck tiles ahead of the start and to its right.
export function openingWreckSpot(start: { pos: Vec; heading: number }): Vec {
  const { ahead, side } = REGION.playerStart.wreck;
  const cos = Math.cos(start.heading);
  const sin = Math.sin(start.heading);
  // Map y points down, so (-sin, cos) of the heading points to the right of travel.
  return { x: start.pos.x + cos * ahead - sin * side, y: start.pos.y + sin * ahead + cos * side };
}

// The fixed obstacles an opening adds to the map: its wreck, or none for a kit without an opening.
export function openingObstacles(opening: Opening | null, start: { pos: Vec; heading: number }): Obstacle[] {
  return opening ? [{ id: OPENING_WRECK_ID, pos: openingWreckSpot(start), r: OPENING_WRECK_RADIUS, kind: 'wreck' }] : [];
}

// Wears the new player truck to the opening's condition and stocks the opening wreck. Nothing for a kit without an
// opening.
export function setUpOpening(world: World, truck: Vehicle, opening: Opening | null): void {
  if (!opening) return;
  const obstacle = world.obstacles.find((o) => o.id === OPENING_WRECK_ID);
  if (!obstacle) throw new Error('The opening wreck was not placed');
  applyCondition(truck, opening.condition);
  world.salvage.push(openingStock(world, opening, obstacle));
}

// The wreck's fixed stock. No random draws, so a seed rolls the same game around it.
function openingStock(world: World, opening: Opening, obstacle: Obstacle): SalvageStock {
  return {
    id: obstacle.id,
    pos: { ...obstacle.pos },
    radius: obstacle.r * RULES.wreckRadiusScale,
    goods: { ...opening.stock.goods },
    parts: opening.stock.parts.map((defId) => makePart(world, defId, 0)),
    fuel: 0,
    supplies: 0,
    hidden: emptyHidden(),
  };
}

// Lowers each named mounted part of a fresh truck to its HP share.
function applyCondition(v: Vehicle, condition: Record<string, number>): void {
  for (const [defId, share] of Object.entries(condition)) {
    const part = mountedParts(v).find((p) => p.defId === defId);
    if (!part) throw new Error(`Opening condition names ${defId}, which ${v.name} does not mount`);
    setStartHp(part, share);
  }
}

// The opening wreck's stock, or null in a game that did not open beside it.
export function openingStockOf(world: World): SalvageStock | null {
  return world.salvage.find((s) => s.id === OPENING_WRECK_ID) ?? null;
}
