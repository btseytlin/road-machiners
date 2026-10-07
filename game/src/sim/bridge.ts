// Deck geometry: straight decks like Canyon Bridge, the Broken Wing deck and the Fallen Sun's wing and flaps, listed in
// TERRAIN.features.decks. One drivable surface is one deck, and no deck touches another. The map stays one level on
// every deck: inside a deck outline, the deck is the ground. Each station stands its rise over the ground, and the
// deck line runs straight between neighbouring stations (deckSegments() in terrain.ts). Both side rails of each deck
// block driving, and so does a lip, a raised end: trucks get on and off only over an end on the ground, and a truck
// that drives off a lip flies. Whatever lies under a deck is out of reach:
// a prop box inside a deck outline whose top is under the deck line blocks nothing (underDeck()). A prop stands on the
// land under a deck, but a wreck a truck left on a deck stands on the deck (propBase()).

import { PHYSICS } from '../data/physics';
import { REGION } from '../data/region';
import { TERRAIN, type DeckSpec } from '../data/terrain';
import type { PosedBox } from './mapgen';
import { deckHeight, groundAt, heightAt, type Terrain } from './terrain';
import type { Obstacle } from './types';
import { segmentDist, type Vec } from './vec';

// A deck with its derived geometry. from and to are its first and last stations' points, and axis is the unit vector
// from the from end to the to end; across is axis turned a quarter toward +y. stations holds each station of the spec's
// line in order, with its tiles along the deck from the from end. rails holds each rail as a map segment along a
// deck edge, and lips each lip as a map segment across a deck end, from the end of one rail to the end of the other.
export type Deck = Omit<DeckSpec, 'line'> & {
  from: Vec;
  to: Vec;
  axis: Vec;
  length: number;
  stations: { at: Vec; along: number; rise: number }[];
  rails: [Vec, Vec][];
  lips: [Vec, Vec][];
};

// A point's deck and its distance along that deck from the from end.
export type DeckPoint = { deck: Deck; along: number };

// The road's flattening reaches this far across; a cut clears all of it.
const CUT_REACH = REGION.roadWidth / 2 + TERRAIN.flattenMargin;

// Tiles a station may lie off the straight line between its deck's ends.
const OFF_LINE = 1e-3;

// Decks with their geometry. A raised end is a lip. Fails loudly on a deck with fewer than two stations, a station that
// is not a number, a station off the line between its ends or not past the one before it, a negative rise, a raised
// deck without a skirt, and on two decks whose outlines touch, since one surface split into decks makes every reader
// find the seams.
export function buildDecks(specs: readonly DeckSpec[]): Deck[] {
  const decks = specs.map(buildDeck);
  decks.forEach((a, k) => {
    for (const b of decks.slice(k + 1)) if (decksTouch(a, b)) throw new Error(`Decks ${a.id} and ${b.id} touch: one surface is one deck`);
  });
  return decks;
}

function buildDeck(spec: DeckSpec): Deck {
  const { id, line } = spec;
  if (line.length < 2) throw new Error(`Deck ${id} needs at least two stations`);
  if (line.some((s) => ![s.at.x, s.at.y, s.rise].every(Number.isFinite))) throw new Error(`Deck ${id} has a station that is not a number`);
  if (line.some((s) => s.rise < 0)) throw new Error(`Deck ${id} has a negative rise`);
  if (line.some((s) => s.rise > 0) && !spec.skirt) throw new Error(`Deck ${id} is raised but not skirted`);
  const from = line[0].at;
  const to = line[line.length - 1].at;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const axis = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const stations = line.map((s, k) => {
    const along = k === 0 ? 0 : k === line.length - 1 ? length : (s.at.x - from.x) * axis.x + (s.at.y - from.y) * axis.y;
    if (Math.abs((s.at.y - from.y) * axis.x - (s.at.x - from.x) * axis.y) > OFF_LINE) throw new Error(`Deck ${id} has station ${k} off its line`);
    return { at: s.at, along, rise: s.rise };
  });
  stations.forEach((s, k) => {
    if (k > 0 && s.along <= stations[k - 1].along) throw new Error(`Deck ${id} has station ${k} out of order`);
  });
  const offs = [-1, 1].map((side) => railOffset(axis, spec.width, side));
  const rails = offs.map((off): [Vec, Vec] => [{ x: from.x + off.x, y: from.y + off.y }, { x: to.x + off.x, y: to.y + off.y }]);
  const ends = [stations[0], stations[stations.length - 1]].filter((s) => s.rise > 0).map((s) => s.at);
  const lips = ends.map((end): [Vec, Vec] => [{ x: end.x + offs[0].x, y: end.y + offs[0].y }, { x: end.x + offs[1].x, y: end.y + offs[1].y }]);
  return { id, width: spec.width, cut: spec.cut, skirt: spec.skirt, from, to, axis, length, stations, rails, lips };
}

// The offset in tiles from a deck's axis to its rail on one side: -1 for the rail first in Deck.rails, 1 for the other.
export function railOffset(axis: Vec, width: number, side: number): Vec {
  return { x: -axis.y * side * (width / 2), y: axis.x * side * (width / 2) };
}

// Whether two deck outlines touch or overlap, judged by the capsules round their axes: a deck's outline lies inside
// its capsule, so decks whose capsules part never touch.
function decksTouch(a: Deck, b: Deck): boolean {
  const gap = segmentsIntersect(a.from, a.to, b.from, b.to) ? 0 : Math.min(segmentDist(a.from, b.from, b.to), segmentDist(a.to, b.from, b.to), segmentDist(b.from, a.from, a.to), segmentDist(b.to, a.from, a.to));
  return gap <= (a.width + b.width) / 2;
}

export const DECKS: readonly Deck[] = buildDecks(TERRAIN.features.decks);

// The deck with this id. An unknown id is a bug.
export function deckById(id: string): Deck {
  const deck = DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`Unknown deck ${id}`);
  return deck;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Tiles along a deck from its from end to a map point's foot on the deck axis, negative before it.
export function alongOf(deck: Deck, x: number, y: number): number {
  return (x - deck.from.x) * deck.axis.x + (y - deck.from.y) * deck.axis.y;
}

function acrossOf(deck: Deck, x: number, y: number): number {
  return (y - deck.from.y) * deck.axis.x - (x - deck.from.x) * deck.axis.y;
}

// The deck whose outline holds a map point, with the distance along it, or null off every deck. heightAt() asks
// this for every point, so decks whose bounding box misses the point are skipped first.
export function deckAt(x: number, y: number): DeckPoint | null {
  for (const box of RAIL_BOXES) if (inBox(box, x, y, BOX_SLACK) && inOutline(box.deck, x, y)) return { deck: box.deck, along: alongOf(box.deck, x, y) };
  return null;
}

function inBox(box: { minX: number; maxX: number; minY: number; maxY: number }, x: number, y: number, slack: number): boolean {
  return x >= box.minX - slack && x <= box.maxX + slack && y >= box.minY - slack && y <= box.maxY + slack;
}

function inOutline(deck: Deck, x: number, y: number): boolean {
  const along = alongOf(deck, x, y);
  return along >= 0 && along <= deck.length && Math.abs(acrossOf(deck, x, y)) <= deck.width / 2;
}

// Whether a prop box is out of reach under a deck: its four footprint corners lie inside one deck outline, and its
// top is under the deck line at its centre. base is the height the prop stands on, in height units, and the box's
// z0 and z1 are meters over it.
export function underDeck(box: PosedBox, base: number, t: Terrain): boolean {
  const on = deckAt(box.center.x, box.center.y);
  if (on === null) return false;
  const corners = [-1, 1].flatMap((i) => [-1, 1].map((j) => ({
    x: box.center.x + box.axis.x * box.half.x * i - box.axis.y * box.half.y * j,
    y: box.center.y + box.axis.y * box.half.x * i + box.axis.x * box.half.y * j,
  })));
  if (!corners.every((c) => inOutline(on.deck, c.x, c.y))) return false;
  return box.z1 < (deckHeight(t, on.deck, on.along) - base) * PHYSICS.metersPerTile;
}

// The height a prop stands on, in height units, which its colliders, its view and underDeck() read. A wreck a truck
// left stands where the truck stood, on a deck if it died on one. Every other prop stands on the land, so a hull pier
// under the Fallen Sun's wing stands on the ground below the deck. The bake keeps all other props off decks.
export function propBase(t: Terrain, o: Obstacle): number {
  return o.kind === 'wreck' ? heightAt(t, o.pos.x, o.pos.y) : groundAt(t, o.pos.x, o.pos.y);
}

// For a point between a deck's two ends and at most reach tiles out from its sides, that deck and the distance
// along it, or null away from every deck. Of several decks, the nearest across wins. Marks ask this for every vertex
// every frame, so decks whose bounding box lies farther than reach from the point are skipped first.
export function spanAt(x: number, y: number, reach: number): DeckPoint | null {
  let best: DeckPoint | null = null;
  let bestAcross = Infinity;
  for (const box of RAIL_BOXES) {
    const across = inBox(box, x, y, reach + BOX_SLACK) ? acrossBeside(box.deck, x, y, reach) : null;
    if (across === null || across >= bestAcross) continue;
    best = { deck: box.deck, along: alongOf(box.deck, x, y) };
    bestAcross = across;
  }
  return best;
}

// Whether a map point lies between a deck's two ends and at most reach tiles out from its sides.
export function besideDeck(deck: Deck, p: Vec, reach: number): boolean {
  return acrossBeside(deck, p.x, p.y, reach) !== null;
}

// Tiles from a deck's axis to a map point between its two ends and at most reach tiles out from its sides, or null
// for a point elsewhere.
function acrossBeside(deck: Deck, x: number, y: number, reach: number): number | null {
  const along = alongOf(deck, x, y);
  if (along < 0 || along > deck.length) return null;
  const across = Math.abs(acrossOf(deck, x, y));
  return across <= deck.width / 2 + reach ? across : null;
}

// Share of the road and site flattening removed at a map point: 1 in the gap under a deck with a cut,
// 0 on its abutments and away from every such deck.
export function bridgeCut(x: number, y: number): number {
  let most = 0;
  for (const deck of DECKS) if (deck.cut) most = Math.max(most, deckCut(deck, deck.cut, x, y));
  return most;
}

function deckCut(deck: Deck, cut: { abutment: number; ramp: number }, x: number, y: number): number {
  const a = alongOf(deck, x, y);
  const into = Math.min(a, deck.length - a) - cut.abutment;
  if (into <= 0) return 0;
  const side = Math.abs(acrossOf(deck, x, y)) - CUT_REACH;
  if (side >= cut.ramp) return 0;
  return smooth(Math.min(1, into / cut.ramp)) * (side <= 0 ? 1 : 1 - smooth(side / cut.ramp));
}

// Tiles of rounding slack on a deck's bounding box, so a point on the outline's edge is never skipped.
const BOX_SLACK = 1e-9;

// Each deck's walls, its rails and lips, with the bounding box of its outline, which holds them all. Nav layers test
// every map cell, and nearly all lie far outside them.
const RAIL_BOXES = DECKS.map((deck) => {
  const points = deck.rails.flat();
  return {
    deck,
    walls: [...deck.rails, ...deck.lips],
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
});

// True when a point lies within reach of any deck's rail or lip.
export function nearRail(x: number, y: number, reach: number): boolean {
  const p = { x, y };
  return RAIL_BOXES.some((box) => {
    if (x <= box.minX - reach || x >= box.maxX + reach || y <= box.minY - reach || y >= box.maxY + reach) return false;
    return box.walls.some(([a, b]) => segmentDist(p, a, b) < reach);
  });
}

// True when segment a-b comes within reach of any deck's rail or lip. Route checks ask this for every leg, and nearly
// every leg lies far outside every deck's box.
export function crossesRail(a: Vec, b: Vec, reach: number): boolean {
  return RAIL_BOXES.some((box) =>
    Math.max(a.x, b.x) > box.minX - reach && Math.min(a.x, b.x) < box.maxX + reach && Math.max(a.y, b.y) > box.minY - reach && Math.min(a.y, b.y) < box.maxY + reach &&
    box.walls.some(([c, d]) => segmentsIntersect(a, b, c, d) || Math.min(segmentDist(a, c, d), segmentDist(b, c, d), segmentDist(c, a, b), segmentDist(d, a, b)) < reach),
  );
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
