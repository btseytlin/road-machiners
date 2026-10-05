export type Vec = { x: number; y: number };

export const DEG = Math.PI / 180;

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function bearing(from: Vec, to: Vec): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// Signed smallest angle from a to b, in (-PI, PI].
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Distance from p to segment ab.
export function segmentDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function polylineDist(p: Vec, line: Vec[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, segmentDist(p, line[i], line[i + 1]));
  return best;
}

// Whether p lies inside a simple polygon, by the even-odd rule. Points exactly on an edge may fall either way.
export function pointInPolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Distance from p to the nearest edge of a closed polygon, from inside or outside.
export function polygonEdgeDist(p: Vec, poly: readonly Vec[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segmentDist(p, poly[j], poly[i]));
  return best;
}
