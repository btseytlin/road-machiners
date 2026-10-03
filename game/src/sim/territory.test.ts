import { describe, expect, it } from 'vitest';
import { onOrchardRoad, REGION } from '../data/region';
import { ECONOMY, GOODS } from '../data/goods';
import { SALVAGE, type LootTable } from '../data/salvage';
import { TERRITORIES } from '../data/territory';
import { PHYSICS } from '../data/physics';
import { boxDistance, propBoxes, segmentCrossesBox, type PosedBox } from './mapgen';
import { ROAD_INDEX } from './road-index';
import { boxesOverlap } from '../test/boxes';
import { siteGap } from './sites';
import { hazardZones, isLootSpot, reactorPos, spotTable, territoryAt, territoryCaches, territoryEntries, territoryGrounds, territoryPieces, territoryTracks } from './territory';
import type { PropKind } from './terrain';
import type { LandmarkLook, Obstacle } from './types';
import { dist, lerp, type Vec } from './vec';

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
    for (const e of entries) expect(dist(e, fallenSun.pos)).toBeCloseTo(fallenSun.radius, 6);
  });

  it("has three roads into the Fallen Sun, where the level concept's tracks leave the crater", () => {
    const entries = territoryEntries(fallenSun as never);
    const bearings = entries.map((e) => (Math.atan2(e.y - fallenSun.pos.y, e.x - fallenSun.pos.x) * 180) / Math.PI).sort((a, b) => a - b);
    expect(bearings).toHaveLength(3);
    [-16, 37, 166].forEach((want, i) => expect(Math.abs(bearings[i] - want)).toBeLessThan(10));
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
  const trackSegments = territoryTracks(t).flatMap((track) => track.slice(1).map((b, i) => [track[i], b] as const));

  it('keeps every piece centre, cache, track point and patch inside the territory', () => {
    const points = [...pieces.map((p) => p.pos), ...territoryCaches(t), ...territoryTracks(t).flat()];
    for (const p of points) expect(dist(p, fallenSun.pos), `${p.x},${p.y}`).toBeLessThan(fallenSun.radius);
    for (const patch of rules.patches) expect(Math.hypot(patch.at.x, patch.at.y)).toBeLessThan(fallenSun.radius);
  });

  it("keeps caches, tracks, patches and every piece but the reactor's housing out of the hazard", () => {
    for (const p of [...territoryCaches(t), ...territoryTracks(t).flat()]) expect(dist(p, zone.pos), `${p.x},${p.y}`).toBeGreaterThan(zone.radius);
    for (const patch of rules.patches) expect(dist({ x: fallenSun.pos.x + patch.at.x, y: fallenSun.pos.y + patch.at.y }, zone.pos) - patch.radius).toBeGreaterThan(zone.radius);
    pieces.forEach((p, k) => {
      if (k === housing) return;
      for (const b of lowBoxes(k)) expect(boxDistance(b, zone.pos), p.look).toBeGreaterThan(zone.radius);
    });
  });

  it("keeps every piece's low boxes off the roads, the tracks and the other pieces", () => {
    pieces.forEach((p, k) => {
      for (const b of lowBoxes(k)) {
        expect(ROAD_INDEX.nearestWithin(b.center.x, b.center.y, Math.hypot(b.half.x, b.half.y) + REGION.roadWidth / 2), p.look).toBe(Infinity);
        for (const [a, c] of trackSegments) expect(segmentCrossesBox(b, a, c), `${p.look} crosses a track at ${a.x},${a.y}`).toBe(false);
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
