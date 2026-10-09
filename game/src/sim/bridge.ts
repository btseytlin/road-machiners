
import { PHYSICS } from '../data/physics';
import { REGION } from '../data/region';
import { TERRAIN, type DeckSpec } from '../data/terrain';
import type { PosedBox } from './mapgen';
import { deckHeight, groundAt, heightAt, type AtlasKey, type Terrain } from './terrain';
import type { Obstacle } from './types';
import { segmentDist, type Vec } from './vec';

export type Deck = Omit<DeckSpec, 'line'> & {
  from: Vec;
  to: Vec;
  axis: Vec;
  length: number;
  stations: { at: Vec; along: number; rise: number }[];
  rails: [Vec, Vec][];
  lips: [Vec, Vec][];
};

export type DeckPoint = { deck: Deck; along: number };

const CUT_REACH = REGION.roadWidth / 2 + TERRAIN.flattenMargin;

const OFF_LINE = 1e-3;

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

export function railOffset(axis: Vec, width: number, side: number): Vec {
  return { x: -axis.y * side * (width / 2), y: axis.x * side * (width / 2) };
}

function decksTouch(a: Deck, b: Deck): boolean {
  const gap = segmentsIntersect(a.from, a.to, b.from, b.to) ? 0 : Math.min(segmentDist(a.from, b.from, b.to), segmentDist(a.to, b.from, b.to), segmentDist(b.from, a.from, a.to), segmentDist(b.to, a.from, a.to));
  return gap <= (a.width + b.width) / 2;
}

export const DECKS: readonly Deck[] = buildDecks(TERRAIN.features.decks);

type RailBox = { deck: Deck; walls: [Vec, Vec][]; minX: number; maxX: number; minY: number; maxY: number };
export type DeckSet = { decks: readonly Deck[]; boxes: readonly RailBox[] };

export function deckSet(decks: readonly Deck[]): DeckSet {
  return { decks, boxes: decks.map(railBox) };
}

function railBox(deck: Deck): RailBox {
  const points = deck.rails.flat();
  return {
    deck,
    walls: [...deck.rails, ...deck.lips],
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

export const ICARUS_DECKS: DeckSet = deckSet(DECKS);
export const NO_DECKS: DeckSet = deckSet([]);

export function decksOf(key: AtlasKey): DeckSet {
  if (key.kind === 'icarus') return ICARUS_DECKS;
  if (key.kind === 'highway') return NO_DECKS;
  throw new Error(`Unknown map kind ${JSON.stringify(key)}`);
}

export function deckById(id: string): Deck {
  const deck = DECKS.find((d) => d.id === id);
  if (!deck) throw new Error(`Unknown deck ${id}`);
  return deck;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function alongOf(deck: Deck, x: number, y: number): number {
  return (x - deck.from.x) * deck.axis.x + (y - deck.from.y) * deck.axis.y;
}

function acrossOf(deck: Deck, x: number, y: number): number {
  return (y - deck.from.y) * deck.axis.x - (x - deck.from.x) * deck.axis.y;
}

export function deckAt(set: DeckSet, x: number, y: number): DeckPoint | null {
  for (const box of set.boxes) if (inBox(box, x, y, BOX_SLACK) && inOutline(box.deck, x, y)) return { deck: box.deck, along: alongOf(box.deck, x, y) };
  return null;
}

function inBox(box: { minX: number; maxX: number; minY: number; maxY: number }, x: number, y: number, slack: number): boolean {
  return x >= box.minX - slack && x <= box.maxX + slack && y >= box.minY - slack && y <= box.maxY + slack;
}

function inOutline(deck: Deck, x: number, y: number): boolean {
  const along = alongOf(deck, x, y);
  return along >= 0 && along <= deck.length && Math.abs(acrossOf(deck, x, y)) <= deck.width / 2;
}

export function underDeck(box: PosedBox, base: number, t: Terrain): boolean {
  const on = deckAt(decksOf(t.atlas), box.center.x, box.center.y);
  if (on === null) return false;
  const corners = [-1, 1].flatMap((i) => [-1, 1].map((j) => ({
    x: box.center.x + box.axis.x * box.half.x * i - box.axis.y * box.half.y * j,
    y: box.center.y + box.axis.y * box.half.x * i + box.axis.x * box.half.y * j,
  })));
  if (!corners.every((c) => inOutline(on.deck, c.x, c.y))) return false;
  return box.z1 < (deckHeight(t, on.deck, on.along) - base) * PHYSICS.metersPerTile;
}

export function propBase(t: Terrain, o: Obstacle): number {
  return o.kind === 'wreck' ? heightAt(t, o.pos.x, o.pos.y) : groundAt(t, o.pos.x, o.pos.y);
}

export function spanAt(set: DeckSet, x: number, y: number, reach: number): DeckPoint | null {
  let best: DeckPoint | null = null;
  let bestAcross = Infinity;
  for (const box of set.boxes) {
    const across = inBox(box, x, y, reach + BOX_SLACK) ? acrossBeside(box.deck, x, y, reach) : null;
    if (across === null || across >= bestAcross) continue;
    best = { deck: box.deck, along: alongOf(box.deck, x, y) };
    bestAcross = across;
  }
  return best;
}

export function deckCenterAt(deck: Deck, x: number, y: number, margin: number): Vec {
  if (margin < 0 || margin >= deck.length / 2) throw new Error(`Deck ${deck.id} has no centre line at margin ${margin}`);
  const along = Math.min(deck.length - margin, Math.max(margin, alongOf(deck, x, y)));
  return { x: deck.from.x + deck.axis.x * along, y: deck.from.y + deck.axis.y * along };
}

export function besideDeck(deck: Deck, p: Vec, reach: number): boolean {
  return acrossBeside(deck, p.x, p.y, reach) !== null;
}

function acrossBeside(deck: Deck, x: number, y: number, reach: number): number | null {
  const along = alongOf(deck, x, y);
  if (along < 0 || along > deck.length) return null;
  const across = Math.abs(acrossOf(deck, x, y));
  return across <= deck.width / 2 + reach ? across : null;
}

export function bridgeCut(set: DeckSet, x: number, y: number): number {
  let most = 0;
  for (const deck of set.decks) if (deck.cut) most = Math.max(most, deckCut(deck, deck.cut, x, y));
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

const BOX_SLACK = 1e-9;


export function nearRail(set: DeckSet, x: number, y: number, reach: number): boolean {
  const p = { x, y };
  return set.boxes.some((box) => {
    if (x <= box.minX - reach || x >= box.maxX + reach || y <= box.minY - reach || y >= box.maxY + reach) return false;
    return box.walls.some(([a, b]) => segmentDist(p, a, b) < reach);
  });
}

export function crossesRail(set: DeckSet, a: Vec, b: Vec, reach: number): boolean {
  return set.boxes.some((box) =>
    Math.max(a.x, b.x) > box.minX - reach && Math.min(a.x, b.x) < box.maxX + reach && Math.max(a.y, b.y) > box.minY - reach && Math.min(a.y, b.y) < box.maxY + reach &&
    box.walls.some(([c, d]) => segmentsIntersect(a, b, c, d) || Math.min(segmentDist(a, c, d), segmentDist(b, c, d), segmentDist(c, a, b), segmentDist(d, a, b)) < reach),
  );
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
