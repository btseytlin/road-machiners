import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../../data/physics';
import { heightAt, type Terrain } from '../../sim/terrain';
import { polylineDist } from '../../sim/vec';
import { rutGeometry, RUT_LIFT } from './crater-tracks';

const S = PHYSICS.metersPerTile;

function rolling(size: number): Terrain {
  const heights: number[] = [];
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) heights.push(0.8 * Math.sin(i / 3) + 0.5 * Math.cos(j / 2));
  return { size, heights, types: [] };
}

describe('crater tracks', () => {
  const t = rolling(32);
  const line = Array.from({ length: 30 }, (_, k) => ({ x: 4 + k * 0.5, y: 6 + Math.sin(k / 4) * 3 }));
  const pos = rutGeometry(t, line).getAttribute('position');

  it('drapes every rut vertex on the ground, lifted a few centimetres', () => {
    expect(pos.count).toBe(line.length * 4);
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      expect(y).toBeCloseTo(heightAt(t, x / S, z / S) * S + RUT_LIFT, 4);
    }
  });

  it('faces every rut up, so the camera above sees it', () => {
    const normals = rutGeometry(t, line).getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0);
  });

  it('lays two ruts beside the line, a wheel track apart', () => {
    for (let i = 0; i < pos.count; i++) {
      const d = polylineDist({ x: pos.getX(i) / S, y: pos.getZ(i) / S }, line);
      expect(d).toBeGreaterThan(0.2);
      expect(d).toBeLessThan(0.7);
    }
  });
});
