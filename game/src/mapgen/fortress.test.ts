// The fortress bake layer on a flat draft: the Bowl pit, the pieces as props, and Nose's rock and the ground around it.

import { describe, expect, it } from 'vitest';
import { FORTRESS_SITES, NOSE_APRON } from '../data/fortress';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { FORT_MODELS, fortressPieces, insideCurtain, pitDepth } from '../sim/fortress';
import { noseFrame } from '../sim/nose';
import { sitePads } from '../sim/sites';
import { dist, segmentDist } from '../sim/vec';
import { newDraft, typeCode, type MapDraft } from './bake';
import { fortressLayer } from './fortress';

const RIM = 5;
const SAND = typeCode('sand');
const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const pit = FORTRESS_SITES.bowl.pit!;

function flatDraft(): MapDraft {
  const d = newDraft(REGION.size);
  d.heights.fill(RIM);
  d.types.fill(SAND);
  return d;
}

describe('fortress layer', () => {
  const d = fortressLayer(flatDraft());
  const n = d.size + 1;

  it('bakes every fortress site piece as a prop of its style, and Nose its two rock masses', () => {
    const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id in FORTRESS_SITES);
    expect(d.props).toHaveLength(sites.reduce((sum, s) => sum + fortressPieces(s).length, 0) + 2);
    expect(d.props.filter((p) => !FORT_MODELS.has(p.kind)).map((p) => p.kind)).toEqual(['noseRise', 'noseCrag']);
  });

  it('raises the ground around Nose rock, outside its circle and off its roads and pads', () => {
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    const raised: { p: { x: number; y: number }; h: number }[] = [];
    for (let y = Math.floor(nose.pos.y - 70); y <= nose.pos.y + 70; y++) {
      for (let x = Math.floor(nose.pos.x - 70); x <= nose.pos.x + 70; x++) {
        const h = d.heights[y * n + x] - RIM;
        if (h !== 0) raised.push({ p: { x, y }, h });
      }
    }
    expect(Math.max(...raised.map((r) => r.h))).toBeCloseTo(NOSE_APRON.height);
    expect(Math.min(...raised.map((r) => r.h))).toBeGreaterThan(0);
    for (const { p } of raised) expect(dist(p, nose.pos)).toBeGreaterThan(nose.radius);
    const scree = typeCode('scree');
    const up = (x: number, y: number) => d.heights[y * n + x] > RIM;
    for (const { p } of raised) {
      const onMargin = dist({ x: p.x + 0.5, y: p.y + 0.5 }, nose.pos) < nose.radius + TERRAIN.types.siteMargin;
      if (!onMargin && up(p.x, p.y) && up(p.x + 1, p.y) && up(p.x, p.y + 1) && up(p.x + 1, p.y + 1)) expect(d.types[p.y * d.size + p.x], `tile ${p.x},${p.y}`).toBe(scree);
    }
    const roads = REGION.roads.flatMap((road) => road.slice(1).map((b, i) => [road[i], b] as const));
    for (const { p } of raised) {
      expect(Math.min(...roads.map(([a, b]) => segmentDist(p, a, b))) - REGION.roadWidth / 2).toBeGreaterThan(NOSE_APRON.clear);
      for (const pad of sitePads(nose)) expect(dist(p, pad) - REGION.sites.pad.width / 2).toBeGreaterThan(NOSE_APRON.clear);
    }
  });

  it('clears the earlier props Nose rock would bury, and keeps the rest', () => {
    const draft = flatDraft();
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    const { u, v } = noseFrame(nose);
    const buried = { x: nose.pos.x + v.x * 40, y: nose.pos.y + v.y * 40 };
    const open = { x: nose.pos.x - v.x * 40 + u.x, y: nose.pos.y - v.y * 40 + u.y };
    draft.props = [buried, open].map((pos) => ({ kind: 'rock', pos, r: 1, yaw: 0, group: 0, step: 0 }));
    const kept = fortressLayer(draft).props.filter((p) => p.kind === 'rock');
    expect(kept.map((p) => p.pos)).toEqual([open]);
  });

  it('lowers each corner inside the Bowl curtain by its pit depth and no other corner (IV17)', () => {
    const lowered: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = d.heights[j * n + i];
        if (h >= RIM) continue;
        const p = { x: i, y: j };
        expect(insideCurtain(bowl, p, pit.margin), `corner ${i},${j}`).toBe(true);
        expect(h).toBeCloseTo(RIM - pitDepth(bowl, p), 5);
        lowered.push(h);
      }
    }
    expect(Math.min(...lowered)).toBeCloseTo(RIM - pit.terraces * pit.stepHeight, 5);
  });

  it('types flat pit tiles as field and its risers as scree, and leaves the rest', () => {
    const field = typeCode('field');
    const scree = typeCode('scree');
    const counts = { field: 0, scree: 0 };
    for (let y = 0; y < d.size; y++) {
      for (let x = 0; x < d.size; x++) {
        const corners = [d.heights[y * n + x], d.heights[y * n + x + 1], d.heights[(y + 1) * n + x], d.heights[(y + 1) * n + x + 1]];
        const type = d.types[y * d.size + x];
        if (corners.some((h) => h > RIM)) continue;
        if (corners.every((h) => h === RIM)) {
          expect(type, `tile ${x},${y}`).toBe(SAND);
        } else if (corners.every((h) => h === corners[0])) {
          expect(type, `tile ${x},${y}`).toBe(field);
          counts.field++;
        } else {
          expect(type, `tile ${x},${y}`).toBe(scree);
          counts.scree++;
        }
      }
    }
    expect(counts.field).toBeGreaterThan(counts.scree);
    expect(counts.scree).toBeGreaterThan(0);
  });
});
