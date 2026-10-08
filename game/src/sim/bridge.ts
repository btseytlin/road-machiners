// Canyon Bridge geometry. The map stays one level: inside the deck outline, the deck is the ground,
// and the canyon under it is out of reach. Both side rails block driving, so trucks get on and off
// only over the two ends.

import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { segmentDist, type Vec } from './vec';

const B = TERRAIN.features.bridge;
export const BRIDGE_LENGTH = Math.hypot(B.to.x - B.from.x, B.to.y - B.from.y);
export const BRIDGE_AXIS: Vec = { x: (B.to.x - B.from.x) / BRIDGE_LENGTH, y: (B.to.y - B.from.y) / BRIDGE_LENGTH };
const HALF_WIDTH = B.width / 2;
const CUT_REACH = REGION.roadWidth / 2 + TERRAIN.flattenMargin;

export const BRIDGE_RAILS: [Vec, Vec][] = [-1, 1].map((side) => {
  const off = { x: -BRIDGE_AXIS.y * side * HALF_WIDTH, y: BRIDGE_AXIS.x * side * HALF_WIDTH };
  return [{ x: B.from.x + off.x, y: B.from.y + off.y }, { x: B.to.x + off.x, y: B.to.y + off.y }];
});

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function along(x: number, y: number): number {
  return (x - B.from.x) * BRIDGE_AXIS.x + (y - B.from.y) * BRIDGE_AXIS.y;
}

function across(x: number, y: number): number {
  return (y - B.from.y) * BRIDGE_AXIS.x - (x - B.from.x) * BRIDGE_AXIS.y;
}

export function deckAlong(x: number, y: number): number | null {
  const a = spanAlong(x, y);
  if (a === null || Math.abs(across(x, y)) > HALF_WIDTH) return null;
  return a;
}

export function spanAlong(x: number, y: number): number | null {
  const a = along(x, y);
  return a < 0 || a > BRIDGE_LENGTH ? null : a;
}

export function bridgeCut(x: number, y: number): number {
  const a = along(x, y);
  const into = Math.min(a, BRIDGE_LENGTH - a) - B.abutment;
  if (into <= 0) return 0;
  const side = Math.abs(across(x, y)) - CUT_REACH;
  if (side >= B.ramp) return 0;
  return smooth(Math.min(1, into / B.ramp)) * (side <= 0 ? 1 : 1 - smooth(side / B.ramp));
}

const RAILS_BOX = {
  minX: Math.min(...BRIDGE_RAILS.flat().map((p) => p.x)),
  maxX: Math.max(...BRIDGE_RAILS.flat().map((p) => p.x)),
  minY: Math.min(...BRIDGE_RAILS.flat().map((p) => p.y)),
  maxY: Math.max(...BRIDGE_RAILS.flat().map((p) => p.y)),
};

export function nearRail(x: number, y: number, reach: number): boolean {
  if (x <= RAILS_BOX.minX - reach || x >= RAILS_BOX.maxX + reach || y <= RAILS_BOX.minY - reach || y >= RAILS_BOX.maxY + reach) return false;
  const p = { x, y };
  return BRIDGE_RAILS.some(([a, b]) => segmentDist(p, a, b) < reach);
}

export function crossesRail(a: Vec, b: Vec, reach: number): boolean {
  return BRIDGE_RAILS.some(([c, d]) => segmentsIntersect(a, b, c, d) || Math.min(segmentDist(a, c, d), segmentDist(b, c, d), segmentDist(c, a, b), segmentDist(d, a, b)) < reach);
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
