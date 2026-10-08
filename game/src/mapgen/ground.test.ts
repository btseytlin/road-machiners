import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { GEOLOGY, TERRAIN, type TerrainTypeId } from '../data/terrain';
import { ROAD_INDEX } from '../sim/road-index';
import { TYPE_IDS } from '../sim/terrain';
import { groundLayer, newDraft, type MapDraft } from './bake';

const SEED = 1337;
const G = GEOLOGY.ground;

const SMALL = 16;

function typeAt(d: MapDraft, x: number, y: number): TerrainTypeId {
  return TYPE_IDS[d.types[y * d.size + x]];
}

function cornersOf(d: MapDraft, x: number, y: number): number[] {
  const n = d.size + 1;
  return [y * n + x, y * n + x + 1, (y + 1) * n + x, (y + 1) * n + x + 1];
}

function setTile(mask: Float32Array | Uint8Array, d: MapDraft, x: number, y: number, value: number): void {
  for (const k of cornersOf(d, x, y)) mask[k] = value;
}

function tilt(d: MapDraft, slope: number): void {
  const n = d.size + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d.heights[j * n + i] = i * slope;
}

describe('ground types from geology marks', () => {
  it('lays loose sand where sand lies deep and not where it lies thin', () => {
    const d = newDraft(SMALL);
    setTile(d.sand, d, 3, 3, G.looseSand * 1.5);
    setTile(d.sand, d, 8, 8, G.looseSand * 0.5);

    groundLayer(SEED, d);

    expect(typeAt(d, 3, 3)).toBe('sand');
    expect(typeAt(d, 8, 8)).not.toBe('sand');
  });

  it('lays sand on a gentle wash bed and gravel on a steep one', () => {
    const gentle = newDraft(SMALL);
    tilt(gentle, G.gravelSlope / 2);
    setTile(gentle.flow, gentle, 5, 5, G.washFlow * 2);
    const steep = newDraft(SMALL);
    tilt(steep, G.gravelSlope * 2);
    setTile(steep.flow, steep, 5, 5, G.washFlow * 2);

    groundLayer(SEED, gentle);
    groundLayer(SEED, steep);

    expect(typeAt(gentle, 5, 5)).toBe('sand');
    expect(typeAt(steep, 5, 5)).toBe('gravel');
  });

  it('leaves ground with little flow off the wash beds', () => {
    const d = newDraft(SMALL);
    tilt(d, G.gravelSlope * 2);
    setTile(d.flow, d, 5, 5, G.washFlow / 2);

    groundLayer(SEED, d);

    expect(['gravel', 'sand']).not.toContain(typeAt(d, 5, 5));
  });

  it('lays scree where soil slumped', () => {
    const d = newDraft(SMALL);
    setTile(d.slumped, d, 6, 2, 1);

    groundLayer(SEED, d);

    expect(typeAt(d, 6, 2)).toBe('scree');
    expect(typeAt(d, 10, 2)).not.toBe('scree');
  });

  it('dries a shallow pond to salt crust and a deep one to mud', () => {
    const d = newDraft(SMALL);
    const n = SMALL + 1;
    for (let j = 4; j <= 11; j++) for (let i = 4; i <= 11; i++) d.heights[j * n + i] = -(G.saltDepth * 1.5);
    for (let j = 7; j <= 8; j++) for (let i = 7; i <= 8; i++) d.heights[j * n + i] = -(G.mudDepth + G.lakeDepth) / 2;

    groundLayer(SEED, d);

    expect(typeAt(d, 7, 7)).toBe('mud');
    expect(typeAt(d, 4, 4)).toBe('saltCrust');
    expect(typeAt(d, 13, 13)).not.toBe('saltCrust');
  });

  it('fills only the bottom of a basin deeper than a lake', () => {
    const d = newDraft(SMALL);
    const n = SMALL + 1;
    const fall = (G.lakeDepth * 4) / 8;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d.heights[j * n + i] = -fall * Math.max(0, 8 - Math.max(Math.abs(i - 8), Math.abs(j - 8)));

    groundLayer(SEED, d);

    expect(['mud', 'saltCrust']).toContain(typeAt(d, 8, 8));
    expect(['mud', 'saltCrust']).not.toContain(typeAt(d, 8, 3));
  });

  it('lays no lake on the canyon floor, which drains', () => {
    const d = newDraft(REGION.size);
    const n = REGION.size + 1;
    const at = TERRAIN.features.canyon.path[2];
    for (let j = at.y - 3; j <= at.y + 3; j++) for (let i = at.x - 3; i <= at.x + 3; i++) d.heights[j * n + i] = -G.mudDepth * 2;

    groundLayer(SEED, d);

    expect(['mud', 'saltCrust']).not.toContain(typeAt(d, at.x, at.y));
  });

  it('lays only hardpan and built ground on flat ground with no marks', () => {
    const d = newDraft(REGION.size);

    groundLayer(SEED, d);

    const kinds = new Set(Array.from(d.types, (code) => TYPE_IDS[code]));
    expect([...kinds].sort()).toEqual(['hardpan', 'road']);
  });
});

describe('built ground', () => {
  function marked(): MapDraft {
    const d = newDraft(REGION.size);
    tilt(d, TERRAIN.types.screeSlope * 2);
    d.sand.fill(G.looseSand * 2);
    d.flow.fill(G.washFlow * 2);
    d.slumped.fill(1);
    return d;
  }

  it('keeps roads road under every geology mark', () => {
    const d = groundLayer(SEED, marked());
    const [x, y] = [Math.floor(REGION.roads[0][1].x), Math.floor(REGION.roads[0][1].y)];

    expect(typeAt(d, x, y)).toBe('road');
  });

  it('keeps the Canyon Bridge deck road under every geology mark', () => {
    const bridge = TERRAIN.features.bridge;
    const mid = { x: Math.floor((bridge.from.x + bridge.to.x) / 2), y: Math.floor((bridge.from.y + bridge.to.y) / 2) };
    const d = groundLayer(SEED, marked());

    expect(typeAt(d, mid.x, mid.y)).toBe('road');
  });

  it('keeps town ground off its roads hardpan under every geology mark', () => {
    const town = REGION.towns[0];
    const off = [-0.5, 0.5].flatMap((dx) => [-0.5, 0.5].map((dy) => ({ x: Math.floor(town.pos.x + dx * town.radius), y: Math.floor(town.pos.y + dy * town.radius) })));
    const tile = off.find((t) => ROAD_INDEX.nearestWithin(t.x + 0.5, t.y + 0.5, Infinity) > REGION.roadWidth);
    if (!tile) throw new Error('Every probe tile in the town lies on a road');
    const d = groundLayer(SEED, marked());

    expect(typeAt(d, tile.x, tile.y)).toBe('hardpan');
  });
});
