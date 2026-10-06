import { describe, expect, it } from 'vitest';
import { boundsOf, edgeBand, emptyMask, solidMask, stripes, thicken, type Mask, type Pixels } from './lines';

function count(mask: Mask): number {
  return mask.bits.reduce((n, b) => n + b, 0);
}

function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Mask {
  const mask = emptyMask(w, h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask.bits[y * w + x] = 1;
  return mask;
}

describe('icon masks', () => {
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
      const row = [...s.bits.slice(10 * 40, 11 * 40)].join('');
      expect(row.split(/0+/).filter(Boolean).length, `${n} stripes`).toBe(n);
      expect(s.bits.every((b, i) => !b || shape.bits[i] === 1)).toBe(true);
    }
  });

  it('read a drawing as solid where it is more than half opaque', () => {
    const px: Pixels = { w: 3, h: 1, data: new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 127, 0, 0, 0, 255]) };

    expect([...solidMask(px).bits]).toEqual([1, 0, 1]);
  });

  it('fail on the bounds of an empty mask', () => {
    expect(() => boundsOf(emptyMask(3, 3))).toThrow(/empty/);
  });
});
