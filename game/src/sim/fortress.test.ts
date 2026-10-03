// The baked fortress pieces of the real map: where they stand, what they block, and what is left of the site circle.

import { describe, expect, it } from 'vitest';
import { FORTRESS, FORTRESS_SITES } from '../data/fortress';
import { REGION } from '../data/region';
import { TEST_MAP } from '../test/map';
import { FORT_MODELS, FORT_PROPS, fortressPieces } from './fortress';
import { PROP_KINDS } from './terrain';
import type { Obstacle } from './types';
import { isDriveObstacle, isBakedObstacle, mapObstacles, propBoxes, propPose } from './mapgen';
import { isFree } from './spawn';
import { canUseSite, isFortress, siteGates, sitePads } from './sites';
import { discoverSites } from './locations';
import { refreshVision } from './vision';
import { cloneWorld } from './world';
import { playerVehicle } from './damage';
import { newWorld } from './world';
import { START_KITS } from '../data/start';
import { dist } from './vec';

const SITES = [...REGION.towns, ...REGION.locations];
const FORT_SITES = SITES.filter(isFortress);
const world = newWorld(1337, START_KITS.standard, TEST_MAP);

// The corners of a posed box's ground outline.
function corners(b: { center: { x: number; y: number }; axis: { x: number; y: number }; half: { x: number; y: number } }) {
  return [-1, 1].flatMap((i) => [-1, 1].map((j) => ({ x: b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * j, y: b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * j })));
}

// The baked pieces of one site: the landmarks of its style's kinds that stand inside its circle.
function piecesOf(site: (typeof SITES)[number], piece?: 'gate' | 'wall'): Extract<Obstacle, { kind: 'landmark' }>[] {
  const kinds = Object.values(FORT_PROPS[FORTRESS_SITES[site.id].style]);
  return mapObstacles(TEST_MAP).filter((o): o is Extract<Obstacle, { kind: 'landmark' }> => o.kind === 'landmark' && kinds.includes(o.look) && dist(o.pos, site.pos) <= site.radius && (!piece || FORT_MODELS.get(o.look)?.piece === piece));
}

// A gatehouse's flat outer face is a chord, so its corners stand a little past the circle that its middle touches.
function sag(radius: number, o: object): number {
  return 'look' in o && FORT_MODELS.get(o.look as never)?.piece === 'gate' ? Math.hypot(radius, FORTRESS.gate.width / 2) - radius : 0;
}

describe('fort prop kinds', () => {
  it('names one model per kind, and every kind is a map prop kind (IV14)', () => {
    const kinds = Object.values(FORT_PROPS).flatMap((styles) => Object.values(styles));
    expect(new Set(kinds).size).toBe(15);
    for (const kind of kinds) expect(PROP_KINDS).toContain(kind);
    expect(new Set([...FORT_MODELS.values()].map((m) => m.model)).size).toBe(15);
  });

  it('gives each fortress site the models of its style', () => {
    for (const site of FORT_SITES) {
      const style = FORTRESS_SITES[site.id].style;
      const name = style === 'shipMetal' ? 'ship' : style;
      const pieces = piecesOf(site);
      expect(pieces.length, site.id).toBe(fortressPieces(site).length);
      for (const o of pieces) expect(FORT_MODELS.get(o.look)!.model, `${site.id} ${o.id}`).toMatch(new RegExp(`^fort_${name}_`));
    }
  });
});

describe('fortress obstacles', () => {
  it('has the ten inhabited sites as fortresses', () => {
    expect(FORT_SITES.map((s) => s.id).sort()).toEqual(Object.keys(FORTRESS_SITES).sort());
    expect(FORT_SITES).toHaveLength(10);
  });

  it('keeps no site circle and no town building ring for a fortress site (IV2)', () => {
    const ids = world.obstacles.map((o) => o.id);
    for (const s of FORT_SITES) expect(ids).not.toContain(`site-${s.id}`);
    expect(ids.some((id) => id.startsWith('bld-bowl-') || id.startsWith('bld-nose-'))).toBe(false);
  });

  it('keeps the circle of every abandoned site (IV7)', () => {
    const abandoned = SITES.filter((s) => !isFortress(s) && !('kind' in s && s.kind === 'territory'));
    expect(abandoned.length).toBeGreaterThan(0);
    for (const s of abandoned) expect(world.obstacles.find((o) => o.id === `site-${s.id}`)?.kind).toBe('site');
  });

  it('knows every fortress piece as a baked drive obstacle', () => {
    const pieces = mapObstacles(TEST_MAP).filter((o) => o.kind === 'landmark' && o.look.startsWith('fort'));
    expect(pieces.length).toBeGreaterThan(300);
    for (const o of pieces) {
      expect(isBakedObstacle(o)).toBe(true);
      expect(isDriveObstacle(o)).toBe(true);
    }
  });

  it('puts every posed box inside its site circle (IV1)', () => {
    for (const site of FORT_SITES) {
      const own = piecesOf(site);
      expect(own.length, site.id).toBe(fortressPieces(site).length);
      for (const o of own) for (const b of propBoxes(o)) for (const c of corners(b)) expect(dist(c, site.pos), `${site.id} ${o.id}`).toBeLessThanOrEqual(site.radius + 0.05 + sag(site.radius, o));
    }
  });

  it('lays each gatehouse model with its outer face on a road gate (IV1)', () => {
    for (const site of FORT_SITES) {
      const gates = siteGates(site);
      const houses = piecesOf(site, 'gate');
      expect(houses).toHaveLength(gates.length);
      for (const gate of gates) {
        const at = houses.find((o) => {
          const pose = propPose(o);
          return Math.abs(dist(pose.pos, gate) - FORTRESS.gateFlare) < 0.01;
        });
        expect(at, `${site.id} gate at ${gate.x},${gate.y}`).toBeDefined();
      }
    }
  });

  it('stretches a wall along its length, so its boxes span the section', () => {
    const walls = mapObstacles(TEST_MAP).filter((o) => o.kind === 'landmark' && FORT_MODELS.get(o.look)?.piece === 'wall');
    expect(walls.length).toBeGreaterThan(100);
    for (const o of walls) {
      const pose = propPose(o);
      expect(pose.scale.x).toBeCloseTo((o.r * 2) / FORTRESS.wallLength, 6);
      expect(pose.scale.y).toBe(1);
      const axis = { x: Math.cos(pose.yaw), y: Math.sin(pose.yaw) };
      const along = propBoxes(o).flatMap((b) => corners(b).map((c) => (c.x - pose.pos.x) * axis.x + (c.y - pose.pos.y) * axis.y));
      // Scrap wall coils and sheet teeth reach a little past the section ends, which only deepens the joints.
      expect(Math.abs(Math.max(...along) - Math.min(...along) - o.r * 2)).toBeLessThan(0.1);
    }
  });
});

describe('fortress ground', () => {
  it('is never free inside a fortress site circle (IV5)', () => {
    for (const s of FORT_SITES) {
      expect(isFree(world, s.pos, 0.5, null), `${s.id} center`).toBe(false);
      expect(isFree(world, { x: s.pos.x + s.radius - 1.5, y: s.pos.y }, 0.5, null), `${s.id} edge`).toBe(false);
    }
  });

  it('leaves every pad clear of the pieces (IV6)', () => {
    const pieces = mapObstacles(TEST_MAP).filter((o) => o.kind === 'landmark' && o.look.startsWith('fort'));
    const boxes = pieces.flatMap((o) => propBoxes(o));
    const { length, width } = REGION.sites.pad;
    for (const s of FORT_SITES) {
      for (const pad of sitePads(s)) {
        const out = { x: (pad.x - s.pos.x) / dist(pad, s.pos), y: (pad.y - s.pos.y) / dist(pad, s.pos) };
        // Sample the whole rectangle: length runs out from the gate, width along the site edge.
        for (let i = 0; i <= 10; i++) {
          for (let j = 0; j <= 14; j++) {
            const u = (i / 10 - 0.5) * length;
            const v = (j / 14 - 0.5) * width;
            const p = { x: pad.x + out.x * u - out.y * v, y: pad.y + out.y * u + out.x * v };
            const hit = boxes.some((b) => Math.abs((p.x - b.center.x) * b.axis.x + (p.y - b.center.y) * b.axis.y) < b.half.x && Math.abs(-(p.x - b.center.x) * b.axis.y + (p.y - b.center.y) * b.axis.x) < b.half.y);
            expect(hit, `${s.id} pad at ${u.toFixed(1)}, ${v.toFixed(1)}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('fortress pads', () => {
  it('lets a truck on any pad use the site and discover it (IV6, IV10)', () => {
    for (const s of FORT_SITES) {
      for (const pad of sitePads(s)) {
        const w = cloneWorld(world);
        playerVehicle(w).pos = { ...pad };
        expect(canUseSite(pad, s), s.id).toBe(true);
        refreshVision(w);
        discoverSites(w);
        expect(w.player.discovered, s.id).toContain(s.id);
      }
    }
  });
});
