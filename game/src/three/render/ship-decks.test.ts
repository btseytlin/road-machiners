import { describe, expect, it } from 'vitest';
import { Mesh, Vector3, type Object3D } from 'three';
import { PHYSICS } from '../../data/physics';
import { FALLEN_SUN_DECKS } from '../../data/territory';
import { deckById, type Deck } from '../../sim/bridge';
import { deckHeight, deckSegments, groundAt } from '../../sim/terrain';
import { segmentDist, type Vec } from '../../sim/vec';
import { TEST_MAP } from '../../test/map';
import { loadModels } from './models';
import { buildShipDecks } from './ship-decks';

const S = PHYSICS.metersPerTile;
const t = TEST_MAP.terrain;
const PANEL_DENT = 0.065;

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const decks = buildShipDecks(t);
decks.updateMatrixWorld(true);

function parts(deck: Deck, name: string): Object3D[] {
  const group = decks.getObjectByName(`ship-deck-${deck.id}`);
  if (!group) throw new Error(`No drawn deck ${deck.id}`);
  const found = group.children.filter((o) => o.name === name);
  if (found.length === 0) throw new Error(`Deck ${deck.id} has no ${name}`);
  return found;
}

function part(deck: Deck, name: string): Object3D {
  const [obj] = parts(deck, name);
  return obj;
}

function vertices(obj: Object3D): Vector3[] {
  const out: Vector3[] = [];
  obj.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return out;
}

function overLine(deck: Deck, v: Vector3): { over: number; along: number } {
  const along = (v.x / S - deck.from.x) * deck.axis.x + (v.z / S - deck.from.y) * deck.axis.y;
  const clamped = Math.min(deck.length, Math.max(0, along));
  return { over: v.y - deckHeight(t, deck, clamped) * S, along };
}

describe('Fallen Sun deck models', () => {
  for (const spec of FALLEN_SUN_DECKS) {
    const deck = deckById(spec.id);

    it(`draws one plate of ${deck.id} on each straight piece`, () => {
      expect(parts(deck, 'ship-deck-model')).toHaveLength(deckSegments(t, deck).length);
    });

    it(`keeps every plate of ${deck.id} under its deck line, but for panel dents`, () => {
      for (const plate of parts(deck, 'ship-deck-model')) {
        const worst = Math.max(...vertices(plate).map((v) => overLine(deck, v).over));
        expect(worst).toBeLessThanOrEqual(PANEL_DENT);
      }
    });

    it(`lays the top of each plate of ${deck.id} on its piece's deck line at both ends`, () => {
      const plates = parts(deck, 'ship-deck-model');
      deckSegments(t, deck).forEach((seg, k) => {
        const points = vertices(plates[k]).map((v) => overLine(deck, v));
        const end = seg.length * 0.15;
        const topNear = (lo: number, hi: number) => Math.max(...points.filter((p) => p.along >= lo && p.along <= hi).map((p) => p.over));
        expect(topNear(seg.along, seg.along + end), `${deck.id} piece ${k}`).toBeGreaterThanOrEqual(-0.02);
        expect(topNear(seg.along + seg.length - end, seg.along + seg.length), `${deck.id} piece ${k}`).toBeGreaterThanOrEqual(-0.02);
      });
    });
  }

  it('draws the wing as one group of four plates, one per pair of its five stations', () => {
    const wing = deckById('fallen-sun-wing');
    expect(wing.stations).toHaveLength(5);
    expect(parts(wing, 'ship-deck-model')).toHaveLength(4);
  });
});

describe('Fallen Sun deck skirts', () => {
  function columns(deck: Deck): { at: Vec; low: number; high: number }[] {
    const byPoint = new Map<string, { at: Vec; low: number; high: number }>();
    for (const v of vertices(part(deck, 'ship-deck-skirt'))) {
      const key = `${v.x.toFixed(3)},${v.z.toFixed(3)}`;
      const col = byPoint.get(key) ?? { at: { x: v.x / S, y: v.z / S }, low: Infinity, high: -Infinity };
      col.low = Math.min(col.low, v.y);
      col.high = Math.max(col.high, v.y);
      byPoint.set(key, col);
    }
    return [...byPoint.values()];
  }

  for (const spec of FALLEN_SUN_DECKS) {
    const deck = deckById(spec.id);

    it(`hangs the skirt of ${deck.id} from under the deck top down into the ground`, () => {
      const cols = columns(deck);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) {
        expect(c.low).toBeLessThanOrEqual(groundAt(t, c.at.x, c.at.y) * S);
        expect(overLine(deck, new Vector3(c.at.x * S, c.high, c.at.y * S)).over).toBeLessThanOrEqual(0);
      }
    });

    it(`samples the skirt of ${deck.id} every tile along each rail and lip`, () => {
      const cols = columns(deck);
      const edges = [...(deck.skirt ? deck.rails : []), ...deck.lips];
      expect(edges.length).toBeGreaterThan(0);
      for (const [a, b] of edges) {
        const near = cols.filter((c) => segmentDist(c.at, a, b) < 0.25);
        expect(near.length, `${deck.id} edge`).toBeGreaterThanOrEqual(Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) + 1);
      }
    });
  }

  it('skirts every Fallen Sun deck', () => {
    for (const spec of FALLEN_SUN_DECKS) expect(deckById(spec.id).skirt, spec.id).toBe(true);
  });
});
