import { describe, expect, it } from 'vitest';
import { boundsOf, edgeBand, emptyMask, erode, keepLongest, lineLike, pieces, simplify, solidMask, stripes, styleMisses, thicken, type Mask, type Pixels } from './lines';

function maskOf(rows: readonly string[]): Mask {
  const mask = emptyMask(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => (mask.bits[y * mask.w + x] = c === '#' ? 1 : 0)));
  return mask;
}

function count(mask: Mask): number {
  return mask.bits.reduce((n, b) => n + b, 0);
}

function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Mask {
  const mask = emptyMask(w, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask.bits[y * w + x] = 1;
  return mask;
}

describe('line style masks', () => {
  it('turn a 1 px bar into one solid line of the set width', () => {
    const bar = rect(20, 20, 10, 2, 11, 18);

    const band = edgeBand(bar, 2);

    const row = [...band.bits.slice(10 * 20, 11 * 20)];
    expect(row.join('')).toBe('00000000111110000000');
  });

  it('ring a large shape with a band on both sides of its edge and leave its middle open', () => {
    const square = rect(30, 30, 5, 5, 25, 25);

    const band = edgeBand(square, 2);

    expect(band.bits[15 * 30 + 3]).toBe(1); // outside the left edge
    expect(band.bits[15 * 30 + 6]).toBe(1); // inside the left edge
    expect(band.bits[15 * 30 + 15]).toBe(0); // the middle
  });

  it('split a mask into connected pieces with their bounds', () => {
    const found = pieces(maskOf(['##...', '.#...', '....#', '....#']));

    expect(found.map((p) => [p.x0, p.y0, p.x1, p.y1, p.pixels.length])).toEqual([
      [0, 0, 2, 2, 3],
      [4, 2, 5, 4, 2],
    ]);
  });

  it('drop pieces shorter than the minimum and keep only the longest', () => {
    const found = pieces(maskOf(['#.##.####.######', '................']));

    const kept = keepLongest(found, 2.5, 2);

    expect(kept.map((p) => p.x1 - p.x0)).toEqual([6, 4]);
  });

  it('thicken a point to a disc', () => {
    const dot = rect(9, 9, 4, 4, 5, 5);

    expect(count(thicken(dot, 1))).toBe(5);
    expect(count(thicken(dot, 2))).toBe(13);
  });

  it('draw the asked number of stripes, all inside the shape', () => {
    const shape = rect(40, 40, 0, 0, 40, 20);
    const box = boundsOf(shape);

    for (const n of [1, 2, 3]) {
      const s = stripes(shape, box, n, 3);
      expect(pieces(s).length, `${n} stripes`).toBe(n);
      expect(s.bits.every((b, i) => !b || shape.bits[i] === 1)).toBe(true);
    }
  });

  it('count every pixel off the allowed colors, but not transparent ones', () => {
    const px: Pixels = { w: 4, h: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 77, 9, 9, 9, 0, 255, 255, 254, 255]) };

    expect(styleMisses(px, [[255, 255, 255, 255], [0, 0, 0, 77]])).toBe(1);
  });

  it('read a drawing as solid where it is more than half opaque', () => {
    const px: Pixels = { w: 3, h: 1, data: new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 127, 0, 0, 0, 255]) };

    expect([...solidMask(px).bits]).toEqual([1, 0, 1]);
  });

  it('fail on the bounds of an empty mask', () => {
    expect(() => boundsOf(emptyMask(3, 3))).toThrow(/empty/);
  });
});

describe('silhouette simplification', () => {
  it('drop a short bump and keep a long thin part, like a barrel', () => {
    const shape = rect(40, 40, 10, 20, 30, 35);
    shape.bits[19 * 40 + 15] = 1; // a 1 px bump on the top edge
    for (let y = 2; y < 20; y++) shape.bits[y * 40 + 25] = 1; // a 1 px barrel, 18 px long

    const simple = simplify(shape, 2.5, 8, 8);

    expect(simple.bits[19 * 40 + 15]).toBe(0);
    expect(simple.bits[5 * 40 + 25]).toBe(1);
  });

  it('fill a notch narrower than the radius', () => {
    const shape = rect(40, 40, 5, 5, 35, 35);
    for (let y = 5; y < 15; y++) shape.bits[y * 40 + 20] = 0; // a 1 px slot into the top edge

    expect(simplify(shape, 2, 8, 8).bits[8 * 40 + 20]).toBe(1);
  });

  it('erode a square by the radius', () => {
    const eroded = erode(rect(10, 10, 2, 2, 8, 8), 1);

    expect(count(eroded)).toBe(16);
  });
});

describe('silhouette simplification of holes and islands', () => {
  it('fill a small hole and drop a small island, and keep a large hole', () => {
    const shape = rect(60, 60, 5, 5, 55, 55);
    for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) shape.bits[y * 60 + x] = 0; // a 3 px hole
    for (let y = 20; y < 45; y++) for (let x = 20; x < 45; x++) shape.bits[y * 60 + x] = 0; // a large hole
    shape.bits[58 * 60 + 58] = 1; // a 1 px island

    const simple = simplify(shape, 0.5, 8, 8);

    expect(simple.bits[11 * 60 + 11]).toBe(1);
    expect(simple.bits[30 * 60 + 30]).toBe(0);
    expect(simple.bits[58 * 60 + 58]).toBe(0);
  });
});

describe('line-like pieces', () => {
  it('take a straight crease and a rim as lines, and a web of creases as not', () => {
    const [straight] = pieces(maskOf(['##########']));
    const [rim] = pieces(maskOf(['#####', '#...#', '#...#', '#####']));
    const [web] = pieces(maskOf(Array.from({ length: 9 }, (_, y) => (y % 2 ? '#.#.#.#.#' : '#########'))));

    expect([lineLike(straight, 3), lineLike(rim, 3), lineLike(web, 3)]).toEqual([true, true, false]);
  });
});
