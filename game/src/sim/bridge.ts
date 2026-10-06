// Deck geometry: straight road decks like Canyon Bridge, listed in TERRAIN.features.decks. The map stays
// one level on every deck: inside a deck outline, the deck is the ground, and whatever lies under it is
// out of reach. Both side rails of each deck block driving, so trucks get on and off only over the ends.

import { REGION } from '../data/region';
import { TERRAIN, type DeckSpec } from '../data/terrain';
import { segmentDist, type Vec } from './vec';

// A deck with its derived geometry. axis is the unit vector from the from end to the to end; across is
// axis turned a quarter toward +y. rails holds each rail as a map segment along a deck edge.
export type Deck = DeckSpec & { axis: Vec; length: number; rails: [Vec, Vec][] };

// A point's deck and its distance along that deck from the from end.
export type DeckPoint = { deck: Deck; along: number };

// The road's flattening reaches this far across; a cut clears all of it.
const CUT_REACH = REGION.roadWidth / 2 + TERRAIN.flattenMargin;

function buildDeck(spec: DeckSpec): Deck {
  const length = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y);
  const axis = { x: (spec.to.x - spec.from.x) / length, y: (spec.to.y - spec.from.y) / length };
  const half = spec.width / 2;
  const rails = [-1, 1].map((side): [Vec, Vec] => {
    const off = { x: -axis.y * side * half, y: axis.x * side * half };
    return [{ x: spec.from.x + off.x, y: spec.from.y + off.y }, { x: spec.to.x + off.x, y: spec.to.y + off.y }];
  });
  return { ...spec, axis, length, rails };
}

export const DECKS: readonly Deck[] = TERRAIN.features.decks.map(buildDeck);

// The deck with this id. An unknown id is a bug.
export function deckById(id: string): Deck {
  const deck = DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`Unknown deck ${id}`);
  return deck;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function alongOf(deck: Deck, x: number, y: number): number {
  return (x - deck.from.x) * deck.axis.x + (y - deck.from.y) * deck.axis.y;
}

function acrossOf(deck: Deck, x: number, y: number): number {
  return (y - deck.from.y) * deck.axis.x - (x - deck.from.x) * deck.axis.y;
}

// The deck whose outline holds a map point, with the distance along it, or null off every deck.
export function deckAt(x: number, y: number): DeckPoint | null {
  for (const deck of DECKS) {
    const along = alongOf(deck, x, y);
    if (along >= 0 && along <= deck.length && Math.abs(acrossOf(deck, x, y)) <= deck.width / 2) return { deck, along };
  }
  return null;
}

// For a point between a deck's two ends, however far to the side, that deck and the distance along it,
// or null past the ends of every deck. Of several decks, the nearest across wins.
export function spanAt(x: number, y: number): DeckPoint | null {
  let best: DeckPoint | null = null;
  let bestAcross = Infinity;
  for (const deck of DECKS) {
    const along = alongOf(deck, x, y);
    if (along < 0 || along > deck.length) continue;
    const across = Math.abs(acrossOf(deck, x, y));
    if (across < bestAcross) {
      best = { deck, along };
      bestAcross = across;
    }
  }
  return best;
}

// The point on a deck's centre line at the same distance along as a map point, with along kept at least
// margin from either end. A margin of half a tile diagonal puts the result in a tile whose centre is on
// the deck. A negative margin, or one that leaves no centre line, is a bug.
export function deckCenterAt(deck: Deck, x: number, y: number, margin: number): Vec {
  if (margin < 0 || margin >= deck.length / 2) throw new Error(`Deck ${deck.id} has no centre line at margin ${margin}`);
  const along = Math.min(deck.length - margin, Math.max(margin, alongOf(deck, x, y)));
  return { x: deck.from.x + deck.axis.x * along, y: deck.from.y + deck.axis.y * along };
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

// Bounding box of each deck's rails. Nav layers test every map cell, and nearly all lie far outside them.
const RAIL_BOXES = DECKS.map((deck) => {
  const points = deck.rails.flat();
  return {
    deck,
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
});

// True when a point lies within reach of any deck's rail.
export function nearRail(x: number, y: number, reach: number): boolean {
  const p = { x, y };
  return RAIL_BOXES.some((box) => {
    if (x <= box.minX - reach || x >= box.maxX + reach || y <= box.minY - reach || y >= box.maxY + reach) return false;
    return box.deck.rails.some(([a, b]) => segmentDist(p, a, b) < reach);
  });
}

// True when segment a-b comes within reach of any deck's rail.
export function crossesRail(a: Vec, b: Vec, reach: number): boolean {
  return DECKS.some((deck) =>
    deck.rails.some(([c, d]) => segmentsIntersect(a, b, c, d) || Math.min(segmentDist(a, c, d), segmentDist(b, c, d), segmentDist(c, a, b), segmentDist(d, a, b)) < reach),
  );
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
