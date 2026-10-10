// The baked fortress pieces of the real map: where they stand, what they block, and what is left of the site circle.

import { describe, expect, it } from 'vitest';
import { FORTRESS, FORTRESS_SITES, FORTRESS_STYLES } from '../data/fortress';
import { REGION } from '../data/region';
import { TEST_MAP } from '../test/map';
import { FORT_MODELS, FORT_PROPS, fortressCore, fortressGates, fortressOutline, fortressPieces, pitDepth } from './fortress';
import { PROP_KINDS } from './terrain';
import type { Obstacle } from './types';
import { boxDistance, isDriveObstacle, isBakedObstacle, mapObstacles, propBoxes, propPose } from './mapgen';
import { isFree } from './spawn';
import { canUseSite, isFortress, sitePads } from './sites';
import { discoverSites } from './locations';
import { refreshVision } from './vision';
import { cloneWorld } from './world';
import { playerVehicle } from './damage';
import { newWorld } from './world';
import { START_KITS } from '../data/start';
import { dist, segmentDist, type Vec } from './vec';
import { defaultSetup } from './settings';

const SITES = [...REGION.towns, ...REGION.locations];
const FORT_SITES = SITES.filter(isFortress);
const world = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));

function corners(b: { center: { x: number; y: number }; axis: { x: number; y: number }; half: { x: number; y: number } }) {
  return [-1, 1].flatMap((i) => [-1, 1].map((j) => ({ x: b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * j, y: b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * j })));
}

function piecesOf(site: (typeof SITES)[number], piece?: 'gate' | 'wall'): Extract<Obstacle, { kind: 'landmark' }>[] {
  const kinds: string[] = Object.values(FORT_PROPS[FORTRESS_SITES[site.id].style]);
  return mapObstacles(TEST_MAP).filter((o): o is Extract<Obstacle, { kind: 'landmark' }> => o.kind === 'landmark' && kinds.includes(o.look) && dist(o.pos, site.pos) <= site.radius && (!piece || FORT_MODELS.get(o.look)?.piece === piece));
}

const styleOf = (site: (typeof SITES)[number]) => FORTRESS_STYLES[FORTRESS_SITES[site.id].style];

function sag(site: (typeof SITES)[number], o: object): number {
  return 'look' in o && FORT_MODELS.get(o.look as never)?.piece === 'gate' ? Math.hypot(site.radius, styleOf(site).gate.width / 2) - site.radius : 0;
}

describe('fort prop kinds', () => {
  it('names one model per kind, and every kind is a map prop kind (IV14)', () => {
    const kinds = Object.values(FORT_PROPS).flatMap((styles) => Object.values(styles));
    expect(new Set(kinds).size).toBe(26);
    for (const kind of kinds) expect(PROP_KINDS).toContain(kind);
    expect(new Set([...FORT_MODELS.values()].map((m) => m.model)).size).toBe(26);
  });

  it('drops the ship barbican kinds (IV23)', () => {
    expect(PROP_KINDS).not.toContain('fortShipBastion');
    expect(PROP_KINDS).not.toContain('fortShipInner');
    expect(Object.keys(FORT_PROPS.shipMetal).sort()).toEqual(['gate', 'tower', 'wall']);
    for (const o of mapObstacles(TEST_MAP)) if (o.kind === 'landmark') expect(['fortShipBastion', 'fortShipInner']).not.toContain(o.look);
  });

  it('gives each style a prop kind for exactly the pieces it builds (IV19)', () => {
    for (const style of Object.keys(FORTRESS_STYLES) as (keyof typeof FORTRESS_STYLES)[]) expect(Object.keys(FORT_PROPS[style]).sort()).toEqual([...FORTRESS_STYLES[style].pieces].sort());
  });

  it('gives each fortress site the models of its style', () => {
    for (const site of FORT_SITES) {
      const style = FORTRESS_SITES[site.id].style;
      const prefix = FORT_MODELS.get(FORT_PROPS[style].wall!)!.model.replace(/wall$/, '');
      const pieces = piecesOf(site);
      expect(pieces.length, site.id).toBe(fortressPieces(site).length);
      for (const o of pieces) expect(FORT_MODELS.get(o.look)!.model, `${site.id} ${o.id}`).toBe(`${prefix}${FORT_MODELS.get(o.look)!.piece}`);
    }
  });
});

describe('fortress obstacles', () => {
  it('has the nine inhabited sites as fortresses', () => {
    expect(FORT_SITES.map((s) => s.id).sort()).toEqual(Object.keys(FORTRESS_SITES).sort());
    expect(FORT_SITES).toHaveLength(9);
  });

  it('keeps no site circle and no town building ring for a fortress site (IV2)', () => {
    const ids = world.obstacles.map((o) => o.id);
    for (const s of FORT_SITES) expect(ids).not.toContain(`site-${s.id}`);
    expect(ids.some((id) => id.startsWith('bld-bowl-') || id.startsWith('bld-nose-'))).toBe(false);
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
      for (const o of own) for (const b of propBoxes(o)) for (const c of corners(b)) expect(dist(c, site.pos), `${site.id} ${o.id}`).toBeLessThanOrEqual(site.radius + 0.05 + sag(site, o));
    }
  });

  it('lays each gatehouse model with its outer face on its gate face (IV1)', () => {
    for (const site of FORT_SITES) {
      const gates = fortressGates(site);
      const houses = piecesOf(site, 'gate');
      expect(houses).toHaveLength(gates.length);
      for (const g of gates) {
        const at = houses.find((o) => Math.abs(dist(propPose(o).pos, g.face) - styleOf(site).gateFlare) < 0.01);
        expect(at, `${site.id} gate at ${g.gate.x},${g.gate.y}`).toBeDefined();
      }
    }
  });

  it('puts a castle gate face on its road gate, and a flush one on the curtain inside it', () => {
    for (const site of FORT_SITES) {
      for (const g of fortressGates(site)) {
        expect(g.out.x * g.out.x + g.out.y * g.out.y).toBeCloseTo(1, 9);
        expect(g.height, site.id).toBe(styleOf(site).gate.height);
        if (styleOf(site).flush) expect(dist(g.gate, site.pos), site.id).toBeGreaterThan(dist(g.face, site.pos));
        else expect(dist(g.face, g.gate), site.id).toBeLessThan(1e-9);
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

  it('leaves the roads out of Nose clear of its rock', () => {
    const nose = FORT_SITES.find((s) => s.id === 'nose')!;
    const rock = mapObstacles(TEST_MAP).filter((o) => o.kind === 'landmark' && (o.look === 'noseRise' || o.look === 'noseCrag'));
    expect(rock).toHaveLength(2);
    const boxes = rock.flatMap((o) => propBoxes(o));
    const reach = Math.max(...rock.map((o) => o.r));
    let checked = 0;
    for (const road of REGION.roads) {
      for (let i = 1; i < road.length; i++) {
        const [a, b] = [road[i - 1], road[i]];
        if (segmentDist(nose.pos, a, b) > reach) continue;
        for (let k = 0; k <= 10; k++) {
          const p = { x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10 };
          if (dist(p, nose.pos) < nose.radius) continue;
          expect(Math.min(...boxes.map((box) => boxDistance(box, p))), `road at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).toBeGreaterThanOrEqual(REGION.roadWidth / 2);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('leaves every pad clear of the pieces and the rock (IV6)', () => {
    const pieces = mapObstacles(TEST_MAP).filter((o) => o.kind === 'landmark' && (o.look.startsWith('fort') || o.look === 'noseRise' || o.look === 'noseCrag'));
    const boxes = pieces.flatMap((o) => propBoxes(o));
    const { length, width } = REGION.sites.pad;
    for (const s of FORT_SITES) {
      for (const pad of sitePads(s)) {
        const out = { x: (pad.x - s.pos.x) / dist(pad, s.pos), y: (pad.y - s.pos.y) / dist(pad, s.pos) };
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

describe('Bowl pit', () => {
  const bowl = SITES.find((s) => s.id === 'bowl')!;
  const pit = FORTRESS_SITES.bowl.pit!;
  const core = fortressCore(bowl);
  const edge = (p: Vec) => Math.min(...core.map((a, i) => segmentDist(p, a, core[(i + 1) % core.length])));
  const inFromGate = (d: number): Vec => {
    const g = fortressGates(bowl)[0];
    return { x: g.face.x - g.out.x * d, y: g.face.y - g.out.y * d };
  };

  it('is level with the rim outside the curtain and within the margin of it', () => {
    expect(pitDepth(bowl, { x: bowl.pos.x + bowl.radius + 3, y: bowl.pos.y })).toBe(0);
    expect(pitDepth(bowl, fortressGates(bowl)[0].gate)).toBe(0);
    expect(pitDepth(bowl, inFromGate(pit.margin - 0.05))).toBe(0);
  });

  it('steps down one terrace per terrace width', () => {
    const first = inFromGate(pit.margin + 0.5);
    const second = inFromGate(pit.margin + pit.terraceWidth + 0.5);
    expect(edge(first)).toBeCloseTo(pit.margin + 0.5, 6);
    expect(pitDepth(bowl, first)).toBe(pit.stepHeight);
    expect(pitDepth(bowl, second)).toBe(2 * pit.stepHeight);
  });

  it('has a flat floor at its full depth', () => {
    const floor = pit.terraces * pit.stepHeight;
    expect(pitDepth(bowl, bowl.pos)).toBe(floor);
    expect(pitDepth(bowl, { x: bowl.pos.x + 3, y: bowl.pos.y - 2 })).toBe(floor);
    for (let x = -30; x <= 30; x += 0.5) for (let y = -30; y <= 30; y += 0.5) expect(pitDepth(bowl, { x: bowl.pos.x + x, y: bowl.pos.y + y })).toBeLessThanOrEqual(floor);
  });

  it('digs inside the main enclosure only, so bastions and forecourts stay at the rim (IV31)', () => {
    expect(core).toHaveLength(6);
    expect(fortressOutline(bowl)).toHaveLength(30);
    for (const piece of fortressPieces(bowl).filter((p) => p.kind === 'tower')) expect(pitDepth(bowl, piece.pos)).toBe(0);
    for (const g of fortressGates(bowl)) expect(pitDepth(bowl, { x: g.face.x + g.out.x * 3, y: g.face.y + g.out.y * 3 })).toBe(0);
  });

  it('throws for a site with no pit', () => {
    const dustwell = SITES.find((s) => s.id === 'dustwell')!;
    expect(() => pitDepth(dustwell, dustwell.pos)).toThrow(/pit/);
  });
});
