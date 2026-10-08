import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonEdgeDist } from './vec';

// A 10 by 10 square with one corner at the origin.
const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('polygons', () => {
  it('tells points inside a polygon from points outside it', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 9.9, y: 0.1 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: -0.1, y: 5 }, SQUARE)).toBe(false);
  });

  it('measures the distance to the nearest edge from either side', () => {
    expect(polygonEdgeDist({ x: 5, y: 5 }, SQUARE)).toBeCloseTo(5, 9);
    expect(polygonEdgeDist({ x: 2, y: 5 }, SQUARE)).toBeCloseTo(2, 9);
    expect(polygonEdgeDist({ x: 13, y: 14 }, SQUARE)).toBeCloseTo(5, 9);
  });

  it('works whichever way the polygon winds', () => {
    const reversed = [...SQUARE].reverse();
    expect(pointInPolygon({ x: 5, y: 5 }, reversed)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, reversed)).toBe(false);
  });
});
