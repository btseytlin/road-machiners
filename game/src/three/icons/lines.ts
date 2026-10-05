// The pixel steps of the item icons' line style, on plain masks with no Three.js, so Node tests can check them.
// render.ts draws the passes and calls these to reduce a drawing to an outline, a few long interior lines and stripes.

export type Pixels = { w: number; h: number; data: Uint8ClampedArray };
// One bit per pixel, row by row.
export type Mask = { w: number; h: number; bits: Uint8Array };
// A connected run of mask pixels and its bounds, x1 and y1 exclusive. length is the diagonal of its bounds.
export type Piece = { pixels: number[]; x0: number; y0: number; x1: number; y1: number; length: number };
// Drawn extent in pixels, x1 and y1 exclusive.
export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type Rgba = readonly [number, number, number, number];

export function emptyMask(w: number, h: number): Mask {
  return { w, h, bits: new Uint8Array(w * h) };
}

// Every pixel drawn more than half opaque.
export function solidMask({ w, h, data }: Pixels): Mask {
  const mask = emptyMask(w, h);
  for (let i = 0; i < w * h; i++) mask.bits[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return mask;
}

// Every pixel within half of the silhouette's edge, inside or outside it, so the outline straddles the edge. A shape
// thinner than the band fills solid.
export function edgeBand(solid: Mask, half: number): Mask {
  const on = (x: number, y: number): boolean => isOn(solid, x, y);
  const edge = maskWhere(solid, (x, y) => on(x, y) && !(on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)));
  return thicken(edge, half);
}

// The mask's 8-connected pieces.
export function pieces(mask: Mask): Piece[] {
  const seen = new Uint8Array(mask.w * mask.h);
  const out: Piece[] = [];
  for (let i = 0; i < seen.length; i++) if (mask.bits[i] && !seen[i]) out.push(flood(mask, seen, i));
  return out;
}

// The max longest pieces at least minLen long, longest first.
export function keepLongest(list: readonly Piece[], minLen: number, max: number): Piece[] {
  return list.filter((p) => p.length >= minLen).sort((a, b) => b.length - a.length).slice(0, max);
}

// Whether a piece reads as one line: no more than maxWind pixels per pixel of its length. A straight crease has about
// 1, a rectangle's rim about 3, and a web of short creases more.
export function lineLike(piece: Piece, maxWind: number): boolean {
  return piece.pixels.length <= maxWind * piece.length;
}

export function maskOfPieces(w: number, h: number, list: readonly Piece[]): Mask {
  const mask = emptyMask(w, h);
  setPieces(mask, list, 1);
  return mask;
}

// Every pixel within half of a mask pixel.
export function thicken(mask: Mask, half: number): Mask {
  return grow(mask, discOf(half));
}

// Pixels whose whole disc of radius half lies on the mask, inside the image.
export function erode(mask: Mask, half: number): Mask {
  return shrink(mask, discOf(half));
}

// Every pixel that one of the offsets reaches from a mask pixel.
function grow(mask: Mask, offsets: readonly (readonly [number, number])[]): Mask {
  const out = emptyMask(mask.w, mask.h);
  eachOn(mask, (x, y) => {
    for (const [dx, dy] of offsets) {
      const i = indexAt(out, x + dx, y + dy);
      if (i >= 0) out.bits[i] = 1;
    }
  });
  return out;
}

// Pixels from which every offset lands on the mask, inside the image.
function shrink(mask: Mask, offsets: readonly (readonly [number, number])[]): Mask {
  return maskWhere(mask, (x, y) => isOn(mask, x, y) && offsets.every(([dx, dy]) => isOn(mask, x + dx, y + dy)));
}

// The silhouette without detail smaller than radius: notches and gaps narrower than 2 radius fill, and bumps narrower
// than that drop unless they run at least minLen, like a barrel. Holes and islands shorter than minHole go too. A square
// kernel keeps the square corners of boxy parts.
export function simplify(solid: Mask, radius: number, minLen: number, minHole: number): Mask {
  const { w, h } = solid;
  const [across, down] = squareOf(radius);
  const growSquare = (m: Mask): Mask => grow(grow(m, across), down);
  const shrinkSquare = (m: Mask): Mask => shrink(shrink(m, across), down);
  const closed = shrinkSquare(growSquare(solid));
  const core = growSquare(shrinkSquare(closed));
  const extra = { w, h, bits: closed.bits.map((b, i) => b & (core.bits[i] ^ 1)) };
  const kept = maskOfPieces(w, h, keepLongest(pieces(extra), minLen, Infinity));
  const shape = { w, h, bits: closed.bits.map((b, i) => b & (core.bits[i] | kept.bits[i])) };
  const inside = (p: Piece): boolean => p.x0 > 0 && p.y0 > 0 && p.x1 < w && p.y1 < h;
  setPieces(shape, pieces(shape).filter((p) => p.length < minHole), 0);
  setPieces(shape, pieces({ w, h, bits: shape.bits.map((b) => b ^ 1) }).filter((p) => p.length < minHole && inside(p)), 1);
  return shape;
}

const NEIGHBORS: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// The piece of mask pixels connected to start, marking each in seen.
function flood(mask: Mask, seen: Uint8Array, start: number): Piece {
  const stack = [start];
  const pixels: number[] = [];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop() as number;
    pixels.push(i);
    for (const n of neighborsOn(mask, i)) {
      if (seen[n]) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return pieceOf(mask.w, pixels);
}

function neighborsOn(mask: Mask, i: number): number[] {
  const x = i % mask.w;
  const y = (i - x) / mask.w;
  return NEIGHBORS.map(([dx, dy]) => indexAt(mask, x + dx, y + dy)).filter((n) => n >= 0 && mask.bits[n] === 1);
}

function pieceOf(w: number, pixels: number[]): Piece {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of pixels) {
    const x = i % w;
    const y = (i - x) / w;
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
  }
  return { pixels, x0, y0, x1, y1, length: Math.hypot(x1 - x0, y1 - y0) };
}

function setPieces(mask: Mask, list: readonly Piece[], bit: 0 | 1): void {
  for (const p of list) for (const i of p.pixels) mask.bits[i] = bit;
}

// The offsets within half of a pixel.
function discOf(half: number): [number, number][] {
  const r = Math.floor(half);
  const out: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= half * half) out.push([dx, dy]);
  return out;
}

// A square kernel of the radius as a row and a column, applied one after the other.
function squareOf(radius: number): [[number, number][], [number, number][]] {
  const steps = Array.from({ length: 2 * Math.round(radius) + 1 }, (_, i) => i - Math.round(radius));
  return [steps.map((d) => [d, 0]), steps.map((d) => [0, d])];
}

// The index of x, y on the mask, or -1 off it.
function indexAt({ w, h }: Mask, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
}

function isOn(mask: Mask, x: number, y: number): boolean {
  const i = indexAt(mask, x, y);
  return i >= 0 && mask.bits[i] === 1;
}

function maskWhere(like: Mask, test: (x: number, y: number) => boolean): Mask {
  const out = emptyMask(like.w, like.h);
  for (let y = 0; y < like.h; y++) for (let x = 0; x < like.w; x++) out.bits[y * like.w + x] = test(x, y) ? 1 : 0;
  return out;
}

function eachOn(mask: Mask, visit: (x: number, y: number) => void): void {
  for (let i = 0; i < mask.bits.length; i++) if (mask.bits[i]) visit(i % mask.w, Math.floor(i / mask.w));
}

// Pixels in both masks.
export function clip(mask: Mask, to: Mask): Mask {
  const out = emptyMask(mask.w, mask.h);
  for (let i = 0; i < mask.bits.length; i++) out.bits[i] = mask.bits[i] & to.bits[i];
  return out;
}

// The mask's drawn bounds. Throws on an empty mask.
export function boundsOf({ w, h, bits }: Mask): Bounds {
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (bits[y * w + x]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
  }
  if (x1 <= x0) throw new Error('The mask is empty');
  return { x0, y0, x1, y1 };
}

// count 45° stripes, rising to the right, each width wide, spaced evenly across box and clipped to solid.
export function stripes(solid: Mask, box: Bounds, count: number, width: number): Mask {
  const { w, h } = solid;
  const out = emptyMask(w, h);
  // A stripe rising to the right holds x + y constant, since y grows downward.
  const from = box.x0 + box.y0;
  const span = box.x1 + box.y1 - from;
  const at = Array.from({ length: count }, (_, k) => from + (span * (k + 1)) / (count + 1));
  const half = (width * Math.SQRT2) / 2; // a perpendicular width of width is this far along x + y
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = y * w + x;
      if (solid.bits[i] && at.some((d) => Math.abs(x + y - d) <= half)) out.bits[i] = 1;
    }
  }
  return out;
}

// How many pixels are neither fully transparent nor exactly one of the allowed colors.
export function styleMisses({ data }: Pixels, allowed: readonly Rgba[]): number {
  let misses = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    if (!allowed.some((c) => c[0] === data[i] && c[1] === data[i + 1] && c[2] === data[i + 2] && c[3] === data[i + 3])) misses++;
  }
  return misses;
}
