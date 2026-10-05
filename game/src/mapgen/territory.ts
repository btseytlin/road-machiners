// Territory layer: hull decks, ribs, deck bays, walls, the reactor, a farm's layout (./farm), field spots and debris
// inside each territory, placed by the rules in TERRITORIES. It runs after the new-world layer, so ground rules read
// these props, the stamped deck heights and the farm's marks. Decks, ribs, bays, walls and farms are authored; field
// spots and debris are drawn along the spine from the map seed and the territory's own seed offset, on open ground
// off the decks, roads, pads and tracks.

import { REGION, type TerritoryDef } from '../data/region';
import { TERRITORIES, type HullRules, type TerritoryRules } from '../data/territory';
import { TERRAIN } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { randRange, type Rng } from '../sim/rng';
import { bayPoints, DECK_BAY, deckAlongAt, deckGap, deckPlane, hullDecks, isTerritory, ribPoses, type HullDeck } from '../sim/territory';
import { siteGap } from '../sim/sites';
import { groundAt, type BakedProp } from '../sim/terrain';
import { dist, type Vec } from '../sim/vec';
import { footprintRelief, tileSteepness, type MapDraft } from './bake';
import { fillFarm, touchesMarks } from './farm';
import { BUILT_HULL } from './newworld';
import { prop, ruleRng, tileOf } from './oldworld';

export const TERRITORY_SEED_OFFSET = 9100; // one block of offsets per territory, so a new territory shifts no other
// Draws for one prop before the layer gives up: the orchard's groves leave little open band. The Fallen Sun's
// draws succeed early, so its bake does not depend on this number.
const TRIES = 1000;
const REACTOR_MARGIN = 2; // tiles between the hazard's edge and any prop
const DEBRIS_BAND: [number, number] = [0, 1.5]; // debris spills half a band past the field spots, toward the rim
const DECK_EDGE = 1; // tiles beside a deck where its side drops to the floor; drawn props keep clear of it

export function territoryLayer(seed: number, d: MapDraft): MapDraft {
  for (const t of REGION.locations.filter(isTerritory)) {
    const rules = TERRITORIES[t.id];
    fill(d, t, rules, ruleRng(seed, TERRITORY_SEED_OFFSET + rules.seed));
  }
  return d;
}

type Ground = { d: MapDraft; t: TerritoryDef; rules: TerritoryRules; rng: Rng; free: (pos: Vec, r: number) => boolean };

function fill(d: MapDraft, t: TerritoryDef, rules: TerritoryRules, rng: Rng): void {
  const decks = hullDecks().filter((deck) => deck.territory === t.id);
  if (rules.hull) stampDecks(d, decks);
  if (rules.reactor) d.props.push(prop(rules.reactor.look, { ...t.pos }, rules.reactor.radius, 0));
  const bays = rules.hull ? placeHull(d, t, rules.hull, decks) : [];
  const hazard = rules.hazard ? rules.hazard.radius + REACTOR_MARGIN : 0;
  // Inside the territory, outside the hazard and off every deck and its dropping edge.
  const free = (pos: Vec, r: number): boolean => {
    return siteGap(t, pos) < -r && dist(pos, t.pos) > hazard + r && decks.every((deck) => deckGap(deck, pos) > r + DECK_EDGE);
  };
  const g: Ground = { d, t, rules, rng, free };
  // A farm's buildings are spots, so drawn spots keep the spot gap from them, and they keep the debris gap from its
  // trees and runs, so a truck can still park beside one.
  const before = d.props.length;
  const buildings = rules.farm ? fillFarm(d, t, rules, rules.farm, rng) : [];
  const dressing = d.props.slice(before).filter((p) => !buildings.includes(p));
  placeDebris(g, placeSpots(g, [...bays, ...buildings], dressing));
}

// Ribs over the decks, a loot spot in each bay and the walls. Returns the bays.
function placeHull(d: MapDraft, t: TerritoryDef, hull: HullRules, decks: readonly HullDeck[]): BakedProp[] {
  for (const deck of decks) for (const rib of ribPoses(deck)) d.props.push(prop('hullRib', rib.pos, rib.r, rib.yaw));
  const bays = decks.flatMap((deck) => bayPoints(deck).map((p) => prop(DECK_BAY, p, hull.bayRadius, deck.section.yaw)));
  d.props.push(...bays);
  for (const wall of hull.walls) d.props.push(prop('hullWall', { x: t.pos.x + wall.at.x, y: t.pos.y + wall.at.y }, wall.length / 2, wall.yaw));
  return bays;
}

// Each deck's corners rise to its plane over the ground at its low end, wherever the ground lies lower, and its
// tiles are marked as hull plating. Heights are read before any deck is stamped, so the decks never stack.
function stampDecks(d: MapDraft, decks: readonly HullDeck[]): void {
  const ground = { size: d.size, heights: Array.from(d.heights), types: [] };
  for (const deck of decks) stampDeck(d, deck, groundAt(ground, deck.low.x, deck.low.y));
}

function stampDeck(d: MapDraft, deck: HullDeck, low: number): void {
  const xs = deck.corners.map((c) => c.x);
  const ys = deck.corners.map((c) => c.y);
  const [i0, i1] = [Math.max(0, Math.floor(Math.min(...xs))), Math.min(d.size, Math.ceil(Math.max(...xs)))];
  const [j0, j1] = [Math.max(0, Math.floor(Math.min(...ys))), Math.min(d.size, Math.ceil(Math.max(...ys)))];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      raiseCorner(d, deck, low, i, j);
      markHullTile(d, deck, i, j);
    }
  }
}

function raiseCorner(d: MapDraft, deck: HullDeck, low: number, i: number, j: number): void {
  const along = deckAlongAt(deck, { x: i, y: j });
  const k = j * (d.size + 1) + i;
  if (along !== null) d.heights[k] = Math.max(d.heights[k], deckPlane(deck, low, along));
}

// A tile is plating when its centre lies on the deck.
function markHullTile(d: MapDraft, deck: HullDeck, x: number, y: number): void {
  if (x < d.size && y < d.size && deckAlongAt(deck, { x: x + 0.5, y: y + 0.5 }) !== null) d.built[y * d.size + x] = BUILT_HULL;
}

// Spots go first, so debris never boxes one in. Field spots keep the spot gap from the authored spots too: deck bays
// and farm buildings. They keep the debris gap from the authored dressing around them.
function placeSpots(g: Ground, authored: readonly BakedProp[], dressing: readonly BakedProp[]): BakedProp[] {
  const spots: BakedProp[] = [...authored];
  for (const rule of g.rules.spots) {
    const apart = (pos: Vec, r: number): boolean =>
      g.free(pos, r) && spots.every((o) => dist(o.pos, pos) >= g.rules.spotGap) && clearOf(g.d.props, pos, r, 0) && clearOf(dressing, pos, r, g.rules.debrisGap);
    for (let i = 0; i < rule.count; i++) {
      const p = draw(g, rule.look, () => bandPoint(g, rule.band), rule.radius, apart);
      spots.push(p);
      g.d.props.push(p);
    }
  }
  return spots;
}

function placeDebris(g: Ground, spots: BakedProp[]): void {
  for (const rule of g.rules.debris) {
    const open = (pos: Vec, r: number): boolean => g.free(pos, r) && clearOf(g.d.props, pos, r, 0) && clearOf(spots, pos, r, g.rules.debrisGap);
    for (let i = 0; i < rule.count; i++) g.d.props.push(draw(g, rule.look, () => bandPoint(g, DEBRIS_BAND), rule.radius, open));
  }
}

// The first drawn prop at a picked point that stands on open ground and passes ok. Fails loudly: a territory that
// cannot hold its props is a data problem, not something to place fewer of.
function draw(g: Ground, look: BakedProp['kind'], pick: () => Vec, radius: [number, number], ok: (pos: Vec, r: number) => boolean): BakedProp {
  for (let k = 0; k < TRIES; k++) {
    const pos = pick();
    const r = randRange(g.rng, radius[0], radius[1]);
    const yaw = randRange(g.rng, 0, Math.PI * 2);
    const p = prop(look, pos, r, yaw);
    if (!standable(g.d, p, g.rules.relief) || !ok(pos, r)) continue;
    return p;
  }
  throw new Error(`Territory ${g.t.id} has no room for a ${look}`);
}

// A point along the spine, to either side of it between shares of the band.
function bandPoint({ t, rules, rng }: Ground, band: [number, number]): Vec {
  const { from, to } = rules.spine;
  const share = randRange(rng, 0, 1);
  const off = rules.spine.band * randRange(rng, band[0], band[1]) * (randRange(rng, 0, 1) < 0.5 ? -1 : 1);
  const length = dist(from, to);
  return {
    x: t.pos.x + from.x + (to.x - from.x) * share - ((to.y - from.y) / length) * off,
    y: t.pos.y + from.y + (to.y - from.y) * share + ((to.x - from.x) / length) * off,
  };
}

// Inside the map margin, off every road, off a farm's old road, pads and tracks, and off cliffs. With a relief limit,
// also on ground that lies no farther than it off the prop's seat under its footprint.
function standable(d: MapDraft, p: BakedProp, relief: number | null): boolean {
  const { pos, r } = p;
  if (Math.min(pos.x, pos.y, d.size - pos.x, d.size - pos.y) < REGION.obstacles.edgeMargin + r) return false;
  const reach = REGION.roadWidth / 2 + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, reach) < reach) return false;
  if (touchesMarks(d, pos, r)) return false;
  if (tileSteepness(d.heights, d.size, tileOf(d.size, pos)) > TERRAIN.drive.maxSlope) return false;
  return relief === null || footprintRelief(d.heights, d.size, p, false) <= relief;
}

// Whether no prop of the list stands within gap tiles of a circle at pos with radius r.
function clearOf(props: readonly BakedProp[], pos: Vec, r: number, gap: number): boolean {
  return props.every((o) => dist(o.pos, pos) >= o.r + r + REGION.obstacles.gap + gap);
}
