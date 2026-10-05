import { describe, expect, it } from 'vitest';
import { onOrchardRoad, REGION } from '../data/region';
import { ECONOMY, GOODS } from '../data/goods';
import { SALVAGE, type LootTable } from '../data/salvage';
import { FALLEN_SUN_DECKS, inFurrow, TERRITORIES, type FarmRoad } from '../data/territory';
import { PHYSICS } from '../data/physics';
import { TERRAIN } from '../data/terrain';
import { deckById, type Deck } from './bridge';
import { boxDistance, propBoxes, segmentCrossesBox, type PosedBox } from './mapgen';
import { ROAD_INDEX } from './road-index';
import { boxesOverlap } from '../test/boxes';
import { siteGap } from './sites';
import { hazardZones, isLootSpot, landingStrips, reactorPos, spotTable, territoryAt, territoryCaches, territoryEntries, territoryGrounds, territoryPieces, territoryRoads, type LandingStrip } from './territory';
import type { PropKind } from './terrain';
import type { LandmarkLook, Obstacle } from './types';
import { dist, lerp, polylineDist, type Vec } from './vec';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const orchard = REGION.locations.find((l) => l.id === 'orchard')!;

describe('territory queries', () => {
  it('finds the territory under a point, and none outside', () => {
    expect(territoryAt(fallenSun.pos)?.id).toBe('fallen-sun');
    expect(territoryAt({ x: fallenSun.pos.x + fallenSun.radius + 1, y: fallenSun.pos.y })).toBeNull();
  });

  it('puts every entry on the edge', () => {
    const entries = territoryEntries(fallenSun as never);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(Math.abs(siteGap(fallenSun, e))).toBeLessThan(1e-6);
  });

  it("has three roads into the Fallen Sun, where the level concept's tracks leave the crater", () => {
    const entries = territoryEntries(fallenSun as never);
    const bearings = entries.map((e) => (Math.atan2(e.y - fallenSun.pos.y, e.x - fallenSun.pos.x) * 180) / Math.PI).sort((a, b) => a - b);
    expect(bearings).toHaveLength(3);
    [-27, 37, 166].forEach((want, i) => expect(Math.abs(bearings[i] - want)).toBeLessThan(10));
  });

  it("follows the Fallen Sun's outline: the furrow is inside, and the cliff faces beside the north notch are not", () => {
    if (fallenSun.kind !== 'territory' || !fallenSun.outline) throw new Error('The Fallen Sun has no outline');
    const at = (x: number, y: number) => ({ x: fallenSun.pos.x + x, y: fallenSun.pos.y + y });
    expect(fallenSun.radius).toBeCloseTo(Math.max(...fallenSun.outline.map((p) => Math.hypot(p.x, p.y))), 9);
    // Down the crash furrow, past the old 44-tile circle.
    expect(territoryAt(at(-20, 80))?.id).toBe('fallen-sun');
    expect(territoryAt(at(-29, 108))?.id).toBe('fallen-sun');
    // Out on the east floor, past the old circle.
    expect(territoryAt(at(48, 0))?.id).toBe('fallen-sun');
    // In the north notch, and on the crag faces on either side of it, inside the old circle.
    expect(territoryAt(at(-2, -43.5))?.id).toBe('fallen-sun');
    expect(territoryAt(at(-21.7, -34.8))).toBeNull();
    expect(territoryAt(at(7.5, -42.3))).toBeNull();
    // Beside the furrow, the land stays outside.
    expect(territoryAt(at(0, 80))).toBeNull();
  });

  it('keeps every road out of the hazard', () => {
    for (const zone of hazardZones()) {
      const reach = zone.radius + REGION.roadWidth / 2;
      expect(ROAD_INDEX.nearestWithin(zone.pos.x, zone.pos.y, reach), zone.id).toBe(Infinity);
    }
  });

  it('keeps the hunting grounds out of the hazard', () => {
    const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
    for (const p of territoryGrounds(fallenSun as never)) expect(dist(p, zone.pos)).toBeGreaterThan(zone.radius);
  });

  it('reports the hazard of each territory that has one', () => {
    expect(hazardZones().map((z) => z.id)).toEqual(Object.keys(TERRITORIES).filter((id) => TERRITORIES[id].reactor?.hazard));
  });

  it('knows a loot spot only inside its territory', () => {
    const spot = { id: 'x', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'shipCache', yaw: 0 } as const;
    expect(isLootSpot(spot)).toBe(true);
    expect(isLootSpot({ ...spot, pos: { x: 1, y: 1 } })).toBe(false);
    expect(isLootSpot({ ...spot, look: 'carWreck' })).toBe(false);
  });

  it('rolls a cache from the cache table and a field spot from the spot table', () => {
    const cache = { id: 'hullCache-1', pos: fallenSun.pos, r: 1, kind: 'landmark', look: 'hullCache', yaw: 0 } as const;
    expect(spotTable(cache)).toBe(SALVAGE[TERRITORIES['fallen-sun'].wreck!.cacheTable]);
    expect(spotTable({ ...cache, look: 'shipCache' })).toBe(SALVAGE.hullScrap);
    expect(() => spotTable({ ...cache, pos: { x: 1, y: 1 } })).toThrow(/not a loot spot/);
  });
});

function landmarkAt(look: PropKind, pos: Vec): Obstacle {
  return { id: `${look}-0`, pos, r: 1, kind: 'landmark', look: look as LandmarkLook, yaw: 0 };
}

// What a fresh roll of the table sells for at the middle of every range.
function midValue(table: LootTable): number {
  const mid = ([lo, hi]: [number, number]) => (lo + hi) / 2;
  const goods = Object.entries(table.goods).reduce((sum, [id, range]) => sum + mid(range) * GOODS[id].value, 0);
  return goods + mid(table.parts) * GOODS.parts.value + mid(table.fuel) * ECONOMY.supplyPrice.fuel + mid(table.supplies) * ECONOMY.supplyPrice.supplies;
}

// The summed mid value of every loot spot a territory's rules place.
function territoryValue(id: string): number {
  const { wreck, farm } = TERRITORIES[id];
  const caches = wreck ? wreck.caches.length * midValue(SALVAGE[wreck.cacheTable]) : 0;
  const field = wreck ? wreck.patches.reduce((n, p) => n + p.spots, 0) * midValue(SALVAGE[wreck.spotTable]) : 0;
  const buildings = (farm ? farm.buildings : []).reduce((sum, b) => sum + b.poses.length * midValue(SALVAGE[b.table]), 0);
  return caches + field + buildings;
}

describe('the Old Orchard', () => {
  const farm = TERRITORIES.orchard.farm!;

  it('is a territory with an authored farm and no wreck, reactor or hazard', () => {
    expect(orchard.kind).toBe('territory');
    expect(TERRITORIES.orchard.wreck).toBeNull();
    expect(TERRITORIES.orchard.reactor).toBeNull();
    expect(hazardZones().filter((z) => z.id === 'orchard')).toEqual([]);
    expect(farm.buildings.length).toBeGreaterThan(0);
  });

  it('holds no more loot than the Fallen Sun', () => {
    expect(territoryValue('orchard')).toBeGreaterThan(0);
    expect(territoryValue('orchard')).toBeLessThanOrEqual(territoryValue('fallen-sun'));
  });

  it('rolls each farm building look from one table', () => {
    const looks = farm.buildings.map((b) => b.look);
    expect(new Set(looks).size).toBe(looks.length);
    for (const b of farm.buildings) {
      expect(spotTable(landmarkAt(b.look, orchard.pos)), b.look).toBe(SALVAGE[b.table]);
    }
  });

  it('knows a farm building as a loot spot only inside the orchard', () => {
    for (const b of farm.buildings) {
      expect(isLootSpot(landmarkAt(b.look, orchard.pos)), b.look).toBe(true);
      expect(isLootSpot(landmarkAt(b.look, { x: 1, y: 1 })), b.look).toBe(false);
      expect(isLootSpot(landmarkAt(b.look, fallenSun.pos)), b.look).toBe(false);
    }
  });

  it('is entered by one New World road, the spur, at the south end of its old road', () => {
    const entries = territoryEntries(orchard as never);
    expect(entries).toHaveLength(1);
    expect(dist(entries[0], at(-32, 0))).toBeLessThan(1);
  });
});

// A point s tiles along the orchard's road and c across it, on the map.
function at(s: number, c: number): Vec {
  const p = onOrchardRoad(s, c);
  return { x: orchard.pos.x + p.x, y: orchard.pos.y + p.y };
}

describe("the Old Orchard's outline", () => {
  const poly = orchard.kind === 'territory' && orchard.outline ? orchard.outline.map((p) => ({ x: orchard.pos.x + p.x, y: orchard.pos.y + p.y })) : [];
  const edges = poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as const);
  const spurEnd = REGION.roads.find((road) => dist(road[road.length - 1], at(-32, 0)) < 1)!.at(-1)!;
  // Points every half tile along the outline.
  const rim = edges.flatMap(([a, b]) => Array.from({ length: Math.ceil(dist(a, b) * 2) }, (_, k) => ({ x: lerp(a.x, b.x, k / Math.ceil(dist(a, b) * 2)), y: lerp(a.y, b.y, k / Math.ceil(dist(a, b) * 2)) })));
  // Every tile centre over the outline's bounding box that lies inside it.
  const inside: Vec[] = [];
  for (let y = Math.floor(orchard.pos.y - orchard.radius) + 0.5; y <= orchard.pos.y + orchard.radius; y++) for (let x = Math.floor(orchard.pos.x - orchard.radius) + 0.5; x <= orchard.pos.x + orchard.radius; x++) if (siteGap(orchard, { x, y }) < 0) inside.push({ x, y });

  it('is a simple polygon whose radius is its bounding radius', () => {
    expect(poly.length).toBeGreaterThan(3);
    expect(orchard.radius).toBeCloseTo(Math.max(...poly.map((p) => dist(p, orchard.pos))), 9);
    for (let i = 0; i < edges.length; i++) for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue;
      expect(crosses(edges[i][0], edges[i][1], edges[j][0], edges[j][1]), `edges ${i} and ${j}`).toBe(false);
    }
  });

  it('keeps clear of New World roads except where the spur ends, and outside every other site', () => {
    const others = [...REGION.towns, ...REGION.locations].filter((s) => s.id !== 'orchard');
    for (const p of rim) {
      if (dist(p, spurEnd) > 6) expect(ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth), `${p.x}, ${p.y}`).toBeGreaterThan(REGION.roadWidth / 2 + 1);
      for (const o of others) expect(siteGap(o, p), o.id).toBeGreaterThan(0);
    }
  });

  it('encloses at least 5000 tiles, no more than 60% of them in a circle of the old radius', () => {
    const area = inside.length;
    expect(area).toBeGreaterThanOrEqual(5000);
    let best = 0;
    for (let y = orchard.pos.y - orchard.radius; y <= orchard.pos.y + orchard.radius; y += 2) for (let x = orchard.pos.x - orchard.radius; x <= orchard.pos.x + orchard.radius; x += 2) {
      best = Math.max(best, inside.filter((p) => Math.hypot(p.x - x, p.y - y) < 32).length);
    }
    expect(best / area).toBeLessThanOrEqual(0.6);
  });

  it('holds the north-west pocket, and not ground inside its bounding radius past the outline', () => {
    const pocket = at(60, 30);
    expect(territoryAt(pocket)?.id).toBe('orchard');
    // Past the south-west corner, on the far side of the west ridge.
    const beyond = at(-30, 44);
    expect(dist(beyond, orchard.pos)).toBeLessThan(orchard.radius);
    expect(territoryAt(beyond)).toBeNull();
  });

  it('lets the spur road end just inside it after one crossing', () => {
    expect(siteGap(orchard, spurEnd)).toBeLessThan(0);
    expect(siteGap(orchard, spurEnd)).toBeGreaterThan(-0.1);
  });
});

// Whether segments ab and cd cross.
function crosses(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

describe('the Fallen Sun layout', () => {
  const t = fallenSun as never;
  const rules = TERRITORIES['fallen-sun'].wreck!;
  const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
  const pieces = territoryPieces(t);
  const lowBoxes = (k: number): PosedBox[] => {
    const p = pieces[k];
    return propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
  };
  // The bow holds the reactor in its breach, so it is the one piece the hazard reaches.
  const housing = pieces.findIndex((p) => p.look === 'shipBow');
  const { roads, spurs } = territoryRoads(t);
  const roadSegments = [...roads, ...spurs].flatMap((road) => road.points.slice(1).map((b, i) => [road.points[i], b] as const));

  it('keeps every piece centre, cache and patch inside the territory', () => {
    const points = [...pieces.map((p) => p.pos), ...territoryCaches(t)];
    for (const p of points) expect(siteGap(fallenSun, p), `${p.x},${p.y}`).toBeLessThan(0);
    for (const patch of rules.patches) expect(siteGap(fallenSun, { x: fallenSun.pos.x + patch.at.x, y: fallenSun.pos.y + patch.at.y })).toBeLessThan(0);
  });

  it("keeps caches, patches and every piece but the reactor's housing out of the hazard", () => {
    for (const p of territoryCaches(t)) expect(dist(p, zone.pos), `${p.x},${p.y}`).toBeGreaterThan(zone.radius);
    for (const patch of rules.patches) expect(dist({ x: fallenSun.pos.x + patch.at.x, y: fallenSun.pos.y + patch.at.y }, zone.pos) - patch.radius).toBeGreaterThan(zone.radius);
    pieces.forEach((p, k) => {
      if (k === housing) return;
      for (const b of lowBoxes(k)) expect(boxDistance(b, zone.pos), p.look).toBeGreaterThan(zone.radius);
    });
  });

  it("keeps every piece's low boxes off the roads, the dirt roads and the other pieces", () => {
    pieces.forEach((p, k) => {
      for (const b of lowBoxes(k)) {
        expect(ROAD_INDEX.nearestWithin(b.center.x, b.center.y, Math.hypot(b.half.x, b.half.y) + REGION.roadWidth / 2), p.look).toBe(Infinity);
        for (const [a, c] of roadSegments) expect(segmentCrossesBox(b, a, c), `${p.look} crosses a dirt road at ${a.x},${a.y}`).toBe(false);
        pieces.forEach((_, other) => {
          if (other <= k) return;
          for (const ob of lowBoxes(other)) expect(boxesOverlap(b, ob), `${p.look} and ${pieces[other].look}`).toBe(false);
        });
      }
    });
  });

  it('centres the hazard on the reactor', () => {
    expect(zone.pos).toEqual(reactorPos(t));
  });

  it('has nine caches and fifteen field spots', () => {
    expect(territoryCaches(t)).toHaveLength(9);
    expect(rules.patches.reduce((n, p) => n + p.spots, 0)).toBe(15);
  });

  it('waits for scavengers at the entries and the patch centres', () => {
    const grounds = territoryGrounds(t);
    expect(grounds.slice(0, 3)).toEqual(territoryEntries(t));
    expect(grounds).toHaveLength(3 + rules.patches.length);
  });
});

// Points every quarter tile along a road's centreline.
function along(points: readonly Vec[]): Vec[] {
  const out: Vec[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(dist(points[i - 1], points[i]) * 4));
    for (let k = 1; k <= n; k++) out.push({ x: lerp(points[i - 1].x, points[i].x, k / n), y: lerp(points[i - 1].y, points[i].y, k / n) });
  }
  return out;
}

// A deck's outline or a landing strip as a box on the ground.
function deckBox(deck: Deck): PosedBox {
  return { center: { x: (deck.from.x + deck.to.x) / 2, y: (deck.from.y + deck.to.y) / 2 }, axis: deck.axis, half: { x: deck.length / 2, y: deck.width / 2 }, z0: 0, z1: 1 };
}

function stripBox(s: LandingStrip): PosedBox {
  const length = dist(s.a, s.b);
  const axis = { x: (s.b.x - s.a.x) / length, y: (s.b.y - s.a.y) / length };
  return { center: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, axis, half: { x: length / 2, y: s.width / 2 }, z0: 0, z1: 1 };
}

function corners(b: PosedBox): Vec[] {
  return [-1, 1].flatMap((i) => [-1, 1].map((j) => ({
    x: b.center.x + b.axis.x * b.half.x * i - b.axis.y * b.half.y * j,
    y: b.center.y + b.axis.y * b.half.x * i + b.axis.x * b.half.y * j,
  })));
}

// Tiles from a point to a road's edge, negative on the road.
function toRoad(p: Vec, road: FarmRoad): number {
  return polylineDist(p, road.points) - road.width / 2;
}

describe("the Fallen Sun's dirt roads, wing and flaps", () => {
  const t = fallenSun as never;
  const rules = TERRITORIES['fallen-sun'].wreck!;
  const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
  const pieces = territoryPieces(t);
  const lowBoxes = (k: number): PosedBox[] => {
    const p = pieces[k];
    return propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
  };
  const { roads, spurs } = territoryRoads(t);
  const decks = FALLEN_SUN_DECKS.map((d) => deckById(d.id));
  const wing = decks.filter((d) => d.lips.length === 0);
  const flaps = decks.filter((d) => d.lips.length > 0);
  const strips = landingStrips(t);
  const nearestRoad = (p: Vec) => Math.min(...[...roads, ...spurs].map((road) => toRoad(p, road)));
  const onMap = (p: Vec) => ({ x: fallenSun.pos.x + p.x, y: fallenSun.pos.y + p.y });
  // The piers stand under the wing; the large pieces each get an island of their own.
  const underWing = (p: Vec) => wing.some((d) => segmentDistance(p, d) < d.width / 2);
  const LARGE = new Set(['shipBow', 'shipHub', 'shipCage', 'hullShell', 'hullGantry', 'hullTower']);
  const large = pieces.map((p, k) => k).filter((k) => LARGE.has(pieces[k].look) || (pieces[k].look === 'hullDrum' && pieces[k].r >= 5 && !underWing(pieces[k].pos)));

  it('lays the furrow frame along the furrow in the terrain', () => {
    const [head, tail] = [TERRAIN.features.furrow.path[0], TERRAIN.features.furrow.path.at(-1)!];
    expect(dist(onMap(inFurrow(0, 0)), head)).toBeLessThan(1e-9);
    expect(dist(onMap(inFurrow(dist(head, tail), 0)), tail)).toBeLessThan(1e-9);
  });

  it('lays the wing as one deck that rises from the ground, runs level at 1.5 over the piers and comes down to 0, with no lip (IV1)', () => {
    expect(wing).toHaveLength(1);
    const rises = wing[0].stations.map((st) => st.rise);
    expect(rises[0]).toBe(0);
    expect(rises[1]).toBe(1.5);
    expect(rises[2]).toBe(1.5);
    expect(rises.at(-1)).toBe(0);
    for (let k = 3; k < rises.length; k++) expect(rises[k]).toBeLessThan(rises[k - 1]);
    expect(wing[0].lips).toEqual([]);
  });

  it('lays the wing across two hull piers that stick out past both rails (AS2)', () => {
    const span = wing[0];
    const piers = pieces.map((p, k) => k).filter((k) => underWing(pieces[k].pos));
    expect(piers).toHaveLength(2);
    for (const k of piers) {
      expect(pieces[k].look).toBe('hullDrum');
      const across = lowBoxes(k).flatMap(corners).map((c) => (c.y - span.from.y) * span.axis.x - (c.x - span.from.x) * span.axis.y);
      expect(Math.max(...across)).toBeGreaterThan(span.width / 2 + 1);
      expect(Math.min(...across)).toBeLessThan(-span.width / 2 - 1);
    }
  });

  it('keeps every dirt road and deck inside the outline', () => {
    for (const road of roads) for (const p of along(road.points)) expect(siteGap(fallenSun, p), `${p.x},${p.y}`).toBeLessThan(-road.width / 2);
    for (const deck of decks) for (const c of corners(deckBox(deck))) expect(siteGap(fallenSun, c), deck.id).toBeLessThan(0);
  });

  it('starts every spur on a web road and ends it outside the outline, past its fade', () => {
    expect(spurs.length).toBeGreaterThanOrEqual(5);
    for (const spur of spurs) {
      const start = spur.points[0];
      expect(Math.min(...roads.map((road) => polylineDist(start, road.points))), `${start.x},${start.y}`).toBeLessThan(0.05);
      expect(siteGap(fallenSun, spur.points.at(-1)!)).toBeGreaterThan(rules.spurFade);
    }
  });

  it('keeps every dirt road and landing strip out of the hazard', () => {
    for (const road of [...roads, ...spurs]) for (const p of along(road.points)) expect(dist(p, zone.pos) - road.width / 2, `${p.x},${p.y}`).toBeGreaterThan(zone.radius);
    for (const s of strips) expect(boxDistance(stripBox(s), zone.pos)).toBeGreaterThan(zone.radius);
  });

  it('joins the dirt roads into one web, and each of the three approaches to it (IV11)', () => {
    const touches = (a: FarmRoad, b: FarmRoad) => [a.points[0], a.points.at(-1)!].some((p) => polylineDist(p, b.points) < 0.05);
    const reached = new Set([0]);
    for (let grew = true; grew; ) {
      grew = false;
      roads.forEach((road, i) => {
        if (reached.has(i) || ![...reached].some((j) => touches(road, roads[j]) || touches(roads[j], road))) return;
        reached.add(i);
        grew = true;
      });
    }
    expect(reached.size).toBe(roads.length);
    const ends = REGION.roads.map((road) => road.at(-1)!).filter((p) => siteGap(fallenSun, p) < 0);
    expect(ends).toHaveLength(3);
    for (const end of ends) expect(Math.min(...roads.map((road) => toRoad(end, road))), `${end.x},${end.y}`).toBeLessThan(REGION.roadWidth / 2);
  });

  it('gives every large piece dirt road within 3 tiles on two opposite sides (IV11)', () => {
    expect(large).toHaveLength(9);
    for (const k of large) {
      const p = pieces[k];
      const u = { x: Math.cos(p.yaw), y: Math.sin(p.yaw) };
      const frame = (q: Vec) => ({ along: (q.x - p.pos.x) * u.x + (q.y - p.pos.y) * u.y, across: (q.y - p.pos.y) * u.x - (q.x - p.pos.x) * u.y });
      const box = lowBoxes(k).flatMap(corners).map(frame);
      const [a0, a1] = [Math.min(...box.map((c) => c.along)), Math.max(...box.map((c) => c.along))];
      const [c0, c1] = [Math.min(...box.map((c) => c.across)), Math.max(...box.map((c) => c.across))];
      const sides = new Set<string>();
      for (const road of roads) {
        for (const q of along(road.points)) {
          if (Math.min(...lowBoxes(k).map((b) => boxDistance(b, q))) - road.width / 2 > 3) continue;
          const f = frame(q);
          if (f.along > a1) sides.add('+along');
          if (f.along < a0) sides.add('-along');
          if (f.across > c1) sides.add('+across');
          if (f.across < c0) sides.add('-across');
        }
      }
      expect((sides.has('+along') && sides.has('-along')) || (sides.has('+across') && sides.has('-across')), `${p.look} at ${p.pos.x},${p.pos.y}: ${[...sides]}`).toBe(true);
    }
  });

  it("keeps every dirt road's surface off every piece's low boxes (IV11)", () => {
    pieces.forEach((p, k) => {
      const boxes = lowBoxes(k);
      for (const road of [...roads, ...spurs]) {
        for (const q of along(road.points)) expect(Math.min(...boxes.map((b) => boxDistance(b, q))), `${p.look} at ${q.x},${q.y}`).toBeGreaterThan(road.width / 2);
      }
    });
  });

  it('puts every cache and spot patch within 6 tiles of a dirt road (IV5)', () => {
    for (const c of territoryCaches(t)) expect(nearestRoad(c), `${c.x},${c.y}`).toBeLessThanOrEqual(6);
    for (const patch of rules.patches.filter((p) => p.spots > 0)) expect(nearestRoad(onMap(patch.at)), `${patch.at.x},${patch.at.y}`).toBeLessThanOrEqual(6);
  });

  it('keeps every spur clear of the region roads, the other sites and the map margin (AS10)', () => {
    const clearance = REGION.obstacles.roadClearance;
    const others = [...REGION.towns, ...REGION.locations].filter((s) => s.id !== 'fallen-sun');
    for (const spur of spurs) {
      for (const q of along(spur.points)) {
        expect(ROAD_INDEX.nearestWithin(q.x, q.y, REGION.roadWidth / 2 + clearance + spur.width / 2), `${q.x},${q.y}`).toBe(Infinity);
        for (const site of others) expect(siteGap(site, q), site.id).toBeGreaterThan(clearance + spur.width / 2);
        for (const v of [q.x, q.y]) {
          expect(v).toBeGreaterThan(REGION.obstacles.edgeMargin + clearance);
          expect(v).toBeLessThan(REGION.size - REGION.obstacles.edgeMargin - clearance);
        }
      }
    }
  });

  it('runs a landing strip from each flap lip, clear of the pieces and the other decks, inside the outline', () => {
    expect(flaps.length).toBeGreaterThanOrEqual(4);
    expect(flaps.length).toBeLessThanOrEqual(5);
    expect(strips).toHaveLength(flaps.length);
    expect(rules.landing).toBeGreaterThanOrEqual(12);
    for (const s of strips) {
      expect(dist(s.a, s.b)).toBeCloseTo(rules.landing, 9);
      // Just past the lip, so the strip does not touch its own flap.
      const box = stripBox({ ...s, a: { x: s.a.x + ((s.b.x - s.a.x) / rules.landing) * 0.01, y: s.a.y + ((s.b.y - s.a.y) / rules.landing) * 0.01 } });
      for (const c of corners(box)) expect(siteGap(fallenSun, c)).toBeLessThan(0);
      pieces.forEach((p, k) => {
        for (const b of lowBoxes(k)) expect(boxesOverlap(box, b), `${p.look} on the strip at ${s.a.x},${s.a.y}`).toBe(false);
      });
      for (const deck of decks) expect(boxesOverlap(box, deckBox(deck)), `${deck.id} on the strip at ${s.a.x},${s.a.y}`).toBe(false);
    }
  });
});

// Tiles from a point to a deck's centre line.
function segmentDistance(p: Vec, deck: Deck): number {
  return polylineDist(p, [deck.from, deck.to]);
}
