import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { partDef, type CoreDef } from '../data/parts';
import BASELINE from './body-baseline.json';
import { bodyOf, cellCenter, cellRect, engineAnchor, lanesAt, restOn, surfaceAt, surfaceSamples } from './body';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { baseGrid } from './grid';

const ids = Object.keys(CHASSIS);
// How far below the cab roof or the model top a part must stand to count as lower.
const CLEAR = 0.15;

const coreCellsOf = (id: string, role: CoreDef['role']) => CHASSIS[id].core.flatMap((c) => {
  const def = partDef(c.defId) as CoreDef;
  if (def.role !== role) return [];
  const w = c.rot === 1 ? def.h : def.w;
  const h = c.rot === 1 ? def.w : def.h;
  return Array.from({ length: w * h }, (_, i) => ({ x: c.x + (i % w), y: c.y + Math.floor(i / w) }));
});
const cellsOf = (id: string, letter: string) => CHASSIS[id].layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === letter ? [{ x, y }] : [])));

describe('body from the base model', () => {
  it('sizes the scout from the bounds of its model boxes', () => {
    const b = bodyOf('scout');
    expect(b.half.x).toBeCloseTo(2.6);
    expect(b.half.z).toBeCloseTo(1.22);
  });

  it('keeps half extents, boxes and wheel mounts of every chassis at the values recorded before the grid split', () => {
    expect(Object.keys(BASELINE).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const was = BASELINE[id as keyof typeof BASELINE];
      const b = bodyOf(id);
      expect(b.half.x, id).toBeCloseTo(was.half.x, 6);
      expect(b.half.y, id).toBeCloseTo(was.half.y, 6);
      expect(b.half.z, id).toBeCloseTo(was.half.z, 6);
      expect(b.wheelX, id).toBeCloseTo(was.wheelX, 6);
      expect(b.wheelZ, id).toBeCloseTo(was.wheelZ, 6);
      expect(b.boxes.length, id).toBe(was.boxes.length);
      b.boxes.forEach((box, i) => {
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(box.at[axis], `${id} box ${i}`).toBeCloseTo(was.boxes[i].at[axis], 6);
          expect(box.half[axis], `${id} box ${i}`).toBeCloseTo(was.boxes[i].half[axis], 6);
        }
      });
    }
  });

  it('keeps every collider box inside the chassis bottom and the roof limit', () => {
    for (const id of ids) {
      const b = bodyOf(id);
      const roof = PHYSICS.truckRoof - (b.wheelRadius + PHYSICS.truck.suspensionRest - b.wheelY);
      expect(b.boxes.length, id).toBeGreaterThan(0);
      for (const box of b.boxes) {
        expect(box.at.y - box.half.y, id).toBeGreaterThanOrEqual(-b.half.y - 1e-9);
        expect(box.at.y + box.half.y, id).toBeLessThanOrEqual(roof + 1e-9);
      }
    }
  });
});

describe('grid projection', () => {
  it('spreads inner cells evenly over the model, no smaller than a little over half a 0.484 by 0.65 m cell and no bigger', () => {
    for (const id of ids) {
      const { w, h } = baseGrid(id);
      const { half } = bodyOf(id);
      const first = cellCenter(id, 1, 1);
      const next = cellCenter(id, 2, 2);
      expect(first.x - next.x, id).toBeCloseTo((2 * half.x) / h, 9);
      expect(next.z - first.z, id).toBeCloseTo((2 * half.z) / (w - 2), 9);
      expect((2 * half.x) / h / PHYSICS.cell.along, id).toBeGreaterThan(0.55);
      expect((2 * half.x) / h / PHYSICS.cell.along, id).toBeLessThan(1.1);
      expect((2 * half.z) / (w - 2) / PHYSICS.cell.across, id).toBeGreaterThan(0.75);
      expect((2 * half.z) / (w - 2) / PHYSICS.cell.across, id).toBeLessThan(1.1);
    }
  });

  it('puts the side armor columns on the side faces and the first and last rows on the nose and tail faces', () => {
    for (const id of ids) {
      const { w, h } = baseGrid(id);
      const { half } = bodyOf(id);
      const left = cellRect(id, [{ x: 0, y: 2 }]);
      expect(left.z0, id).toBeCloseTo(-half.z);
      expect(left.z1, id).toBeCloseTo(-half.z);
      expect(left.x1 - left.x0, id).toBeGreaterThan(0);
      const right = cellRect(id, [{ x: w - 1, y: 2 }]);
      expect(right.z0, id).toBeCloseTo(half.z);
      expect(right.z1, id).toBeCloseTo(half.z);
      const nose = cellRect(id, [{ x: 2, y: 0 }]);
      expect(nose.x0, id).toBeCloseTo(half.x);
      expect(nose.x1, id).toBeCloseTo(half.x);
      expect(nose.z1 - nose.z0, id).toBeGreaterThan(0);
      const tail = cellRect(id, [{ x: 2, y: h - 1 }]);
      expect(tail.x0, id).toBeCloseTo(-half.x);
      expect(tail.x1, id).toBeCloseTo(-half.x);
    }
  });

  it('projects the union of several cells', () => {
    const one = cellRect('scout', [{ x: 2, y: 2 }]);
    const two = cellRect('scout', [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(two.x1).toBeCloseTo(one.x1);
    expect(two.z0).toBeCloseTo(one.z0);
    expect(two.x0).toBeLessThan(one.x0);
    expect(two.z1).toBeGreaterThan(one.z1);
  });

  it('rejects a cell outside the grid', () => {
    expect(() => cellCenter('scout', 7, 0)).toThrow(/outside/);
  });

  it('finds the lanes a stretch of the edge crosses, clamped to the grid', () => {
    const { half } = bodyOf('scout');
    expect(lanesAt('scout', 'column', -0.1, 0.1)).toEqual([3]);
    expect(lanesAt('scout', 'column', -half.z - 1, half.z + 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(lanesAt('scout', 'row', half.x - 0.01, half.x - 0.02)).toEqual([0]);
    expect(lanesAt('scout', 'row', 100, -100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('model surface', () => {
  it('takes the highest point under the whole rect', () => {
    const rect = cellRect('scout', [{ x: 3, y: 1 }, { x: 3, y: 4 }]);
    const parts = [1, 2, 3, 4].map((y) => surfaceAt('scout', cellRect('scout', [{ x: 3, y }])));
    expect(surfaceAt('scout', rect)).toBeCloseTo(Math.max(...parts));
  });

  it('leaves out a wall that stands over a row edge', () => {
    // The scout cab's rear wall and the wagon windshield end just past a row edge, and neither belongs to the row behind.
    expect(surfaceAt('scout', cellRect('scout', [{ x: 3, y: 5 }, { x: 3, y: 6 }]))).toBeLessThan(0.1);
    expect(surfaceAt('wagon', cellRect('wagon', [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 5 }, { x: 3, y: 5 }]))).toBeLessThan(0.7);
  });

  it('reads a rect narrower than a sample cell at its middle', () => {
    const at = cellCenter('scout', 3, 5);
    expect(surfaceAt('scout', { x0: at.x - 0.02, x1: at.x + 0.02, z0: at.z - 0.02, z1: at.z + 0.02 })).toBeLessThan(0.1);
  });

  it('throws when the model has nothing under the rect', () => {
    expect(() => surfaceAt('scout', { x0: 50, x1: 51, z0: 0, z1: 1 })).toThrow(/no surface/);
  });

  it('gives an engine anchor inside the model outline', () => {
    for (const id of ids) {
      const a = engineAnchor(id);
      const { half } = bodyOf(id);
      expect(Math.abs(a.x), id).toBeLessThan(half.x);
      expect(Math.abs(a.z), id).toBeLessThan(half.z);
    }
  });
});

describe('grid and model correspondence', () => {
  it('projects the engine cells into the half of the truck that holds the engine anchor', () => {
    for (const id of ids) {
      const anchor = engineAnchor(id);
      for (const c of cellsOf(id, 'E')) {
        const at = cellCenter(id, c.x, c.y);
        expect(Math.sign(at.x) * Math.sign(anchor.x) >= 0, `${id} engine cell ${c.x},${c.y} is in the wrong half along the truck`).toBe(true);
      }
    }
  });

  it('stands the transmission and the tank of a chassis that shows them below the cab roof and the model top', () => {
    for (const id of ids.filter((chassis) => CHASSIS[chassis].showsCores)) {
      const inner = CHASSIS[id].layout.flatMap((row, y) => [...row].flatMap((ch, x) => ('DEX'.includes(ch) ? [{ x, y }] : [])));
      const top = Math.max(...inner.map((c) => surfaceAt(id, cellRect(id, [c]))));
      const cab = CHASSIS[id].core.map((c) => partDef(c.defId)).find((d): d is CoreDef => d.kind === 'core' && d.role === 'cab')!;
      const cabTop = cab.tall ? surfaceAt(id, cellRect(id, coreCellsOf(id, 'cab'))) : Infinity;
      for (const role of ['transmission', 'tank'] as const) {
        const surface = surfaceAt(id, cellRect(id, coreCellsOf(id, role)));
        expect(surface, `${id} ${role} stands too high`).toBeLessThanOrEqual(Math.min(top, cabTop) - CLEAR);
      }
    }
  });

  it('seats the engine in its hood hole, well below the model top', () => {
    for (const id of ids) {
      const inner = CHASSIS[id].layout.flatMap((row, y) => [...row].flatMap((ch, x) => ('DEX'.includes(ch) ? [{ x, y }] : [])));
      const top = Math.max(...inner.map((c) => surfaceAt(id, cellRect(id, [c]))));
      expect(top - engineAnchor(id).y, id).toBeGreaterThanOrEqual(CLEAR);
    }
  });

  it('projects each wheel core into its corner of the truck', () => {
    for (const id of ids) {
            const wheels = CHASSIS[id].core.filter((c) => c.defId.includes('wheel'));
      expect(wheels.length, id).toBe(4);
      const corners = new Set<string>();
      for (const c of wheels) {
        const at = cellCenter(id, c.x, c.y);
        const corner = `${Math.sign(at.x)},${Math.sign(at.z)}`;
        expect(Math.abs(at.x), `${id} wheel cell ${c.x},${c.y} is at the middle of the truck`).toBeGreaterThan(0.05);
        expect(Math.abs(at.z), `${id} wheel cell ${c.x},${c.y} is at the middle of the truck`).toBeGreaterThan(0.05);
        corners.add(corner);
      }
      expect(corners.size, `${id} wheel cells do not fill four corners`).toBe(4);
    }
  });

  it('projects every inner cell inside the model outline', () => {
    for (const id of ids) {
      const { w, h } = baseGrid(id);
      const { half } = bodyOf(id);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (CHASSIS[id].layout[y][x] === ' ') continue;
          const rect = cellRect(id, [{ x, y }]);
          const inside = rect.x0 >= -half.x - 1e-9 && rect.x1 <= half.x + 1e-9 && rect.z0 >= -half.z - 1e-9 && rect.z1 <= half.z + 1e-9;
          expect(inside, `${id} cell ${x},${y} projects outside the model outline`).toBe(true);
          expect(() => surfaceAt(id, rect), `${id} cell ${x},${y} has no model surface under it`).not.toThrow();
        }
      }
    }
  });
});

describe('resting parts', () => {
  type Map = { cell: number; i0: number; j0: number; top: (number | null)[][] };
  const TOLERANCE = 0.05;
  const SIZES = [[1, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 3], [3, 2]];
  // The height samples fully inside a rect: body x and z of each sample center, and its top in meters.
  const samplesIn = (map: Map, r: { x0: number; x1: number; z0: number; z1: number }) => {
    const range = (lo: number, hi: number) => {
      const first = Math.ceil((lo - 1e-6) / map.cell);
      const last = Math.floor((hi + 1e-6) / map.cell) - 1;
      return Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => first + k);
    };
    return range(r.x0, r.x1).flatMap((i) => range(-r.z1, -r.z0).flatMap((j) => {
      const top = map.top[i - map.i0]?.[j - map.j0];
      return [{ x: (i + 0.5) * map.cell, z: -(j + 0.5) * map.cell, top: typeof top === 'number' ? top / 100 : -Infinity }];
    }));
  };

  it('never cuts into the model and overhangs at most a tenth of its footprint, flat or leaning, on every chassis, cell and size', () => {
    const problems: string[] = [];
    let perched = 0;
    let leaning = 0;
    const floats: number[] = [];
    let total = 0;
    for (const id of Object.keys(CHASSIS)) {
      const map = (TRUCK_SHAPES as Record<string, { heights: Map }>)[`base_${id}`].heights;
      const { w, h } = baseGrid(id);
      for (const [sw, sh] of SIZES) {
        for (let y = 1; y + sh <= h - 1; y++) {
          for (let x = 1; x + sw <= w - 1; x++) {
            const cells = Array.from({ length: sw * sh }, (_, k) => ({ x: x + (k % sw), y: y + Math.floor(k / sw) }));
            const rest = restOn(id, cellRect(id, cells));
            total++;
            if (rest.perched) {
              perched++;
              const px = (rest.rect.x0 + rest.rect.x1) / 2;
              const pz = (rest.rect.z0 + rest.rect.z1) / 2;
              floats.push(Math.max(...samplesIn(map, rest.rect).map((sm) => rest.y + rest.slope.x * (sm.x - px) + rest.slope.z * (sm.z - pz) - sm.top)));
              continue;
            }
            const cx = (rest.rect.x0 + rest.rect.x1) / 2;
            const cz = (rest.rect.z0 + rest.rect.z1) / 2;
            const gaps = samplesIn(map, rest.rect).map((sm) => rest.y + rest.slope.x * (sm.x - cx) + rest.slope.z * (sm.z - cz) - sm.top);
            const label = `${id} ${sw}x${sh} at ${x},${y}`;
            if (gaps.some((g) => g < -TOLERANCE - 1e-9)) problems.push(`${label} cuts into the model`);
            if (gaps.filter((g) => g <= TOLERANCE + 1e-9).length < 0.9 * gaps.length) problems.push(`${label} overhangs more than a tenth of its footprint`);
            if (rest.slope.x !== 0 || rest.slope.z !== 0) leaning++;
          }
        }
      }
    }
        console.log(`resting parts: ${leaning} of ${total} footprints lean on a slope, ${perched} find no rest and are hidden unless always drawn, floating ${[0.1, 0.2, 0.4].map((lim) => `${floats.filter((f) => f > lim).length} more than ${lim} m`).join(', ')}`);
    expect(problems).toEqual([]);
  });
});

describe('surface samples', () => {
  it('lists the samples near a cab roof cell with its surface height, all within the radius', () => {
    const rect = cellRect('scout', [{ x: 3, y: 2 }]);
    const center = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
    const samples = surfaceSamples('scout', center, 0.3);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(Math.hypot(s.x - center.x, s.z - center.z)).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(Math.max(...samples.map((s) => s.y))).toBeCloseTo(surfaceAt('scout', { x0: center.x - 0.3, x1: center.x + 0.3, z0: center.z - 0.3, z1: center.z + 0.3 }), 1);
  });

  it('leaves out samples over air', () => {
    expect(surfaceSamples('scout', { x: 50, z: 50 }, 1)).toEqual([]);
  });
});
