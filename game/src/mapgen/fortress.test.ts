// The fortress bake layer on a flat draft: the Bowl pit and the pieces as props.

import { describe, expect, it } from 'vitest';
import { FORTRESS_SITES } from '../data/fortress';
import { REGION } from '../data/region';
import { FORT_MODELS, fortressPieces, insideCurtain, pitDepth } from '../sim/fortress';
import { noseFrame } from '../sim/nose';
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

  it('clears the earlier props Nose rock would bury, and keeps the rest', () => {
    const draft = flatDraft();
    const nose = REGION.towns.find((t) => t.id === 'nose')!;
    const { u, v } = noseFrame(nose);
    // 40 tiles back from the center lies under the mountain. 40 tiles toward the south gate is open sand.
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
        if (h === RIM) continue;
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
