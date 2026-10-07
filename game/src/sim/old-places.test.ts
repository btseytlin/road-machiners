import { describe, expect, it } from 'vitest';
import { OLD_PLACE_TYPES } from '../data/salvage';
import { TEST_MAP } from '../test/map';
import { clearOfSites, mapObstacles, propReach } from './mapgen';
import { navLayer } from './nav/layer';
import { makeOldSpotPicks, MAX_RADIUS, oldPlaces, oldSpotOf, oldSpotPicks, oldStockId, offRoad, placeSpot, reachable } from './old-places';
import { territoryAt } from './territory';
import type { PropKind } from './terrain';
import type { Obstacle } from './types';
import type { Vec } from './vec';

const baked = mapObstacles(TEST_MAP);
const layer = navLayer(TEST_MAP.terrain, baked, MAX_RADIUS);

// The first point on a 10-tile grid outside territories and well clear of sites and every baked prop.
function openGround(): Vec {
  for (let y = 50; y < TEST_MAP.terrain.size - 50; y += 10)
    for (let x = 50; x < TEST_MAP.terrain.size - 50; x += 10) {
      const pos = { x, y };
      if (territoryAt(pos) === null && clearOfSites(pos, 30) && offRoad(landmark('ruin', pos, 0)) && baked.every((o) => Math.hypot(o.pos.x - x, o.pos.y - y) > 30)) return pos;
    }
  throw new Error('No open ground on the map');
}

function landmark(look: Exclude<PropKind, 'rock'>, pos: Vec, k: number): Obstacle {
  return { id: `${look}-${90000 + k}`, pos, r: 1, kind: 'landmark', look, yaw: 0 };
}

const at = (o: Vec, dx: number, dy: number): Vec => ({ x: o.x + dx, y: o.y + dy });

describe('old-world places', () => {
  it('types places by what stands in them, and keeps hulks apart from buildings', () => {
    const o = openGround();
    const farm = at(o, -120, 0);
    const hamlet = at(o, -60, 0);
    const props = [
      landmark('silo', farm, 1),
      landmark('ruin', at(farm, 6, 0), 2),
      landmark('ruin', hamlet, 3),
      landmark('ruin', at(hamlet, 5, 0), 4),
      landmark('house', at(hamlet, 0, 5), 5),
      landmark('house', o, 6),
      landmark('tank', at(o, 4, 0), 7),
      landmark('tank', at(o, 8, 0), 8),
      landmark('tank', at(o, 12, 0), 9),
    ].filter((p) => territoryAt(p.pos) === null && clearOfSites(p.pos, p.r));
    expect(props).toHaveLength(9);
    const places = oldPlaces(props).map((p) => ({ type: p.type, ids: p.props.map((q) => q.id).sort() }));
    expect(places).toEqual([
      { type: 'homestead', ids: ['ruin-90002', 'silo-90001'] },
      { type: 'hamlet', ids: ['house-90005', 'ruin-90003', 'ruin-90004'] },
      { type: 'lookout', ids: ['house-90006'] },
      { type: 'hulks', ids: ['tank-90007', 'tank-90008', 'tank-90009'] },
    ]);
  });

  it('skips a building ringed by rocks, so a place with only it gets no spot', () => {
    const o = openGround();
    const house = landmark('house', o, 1);
    const rocks: Obstacle[] = Array.from({ length: 16 }, (_, k) => {
      const a = (k / 16) * 2 * Math.PI;
      return { id: `rock${900000 + k}`, pos: at(o, Math.cos(a) * 6, Math.sin(a) * 6), r: 1.2, kind: 'rock' };
    });
    const open = navLayer(TEST_MAP.terrain, [...baked, house], MAX_RADIUS);
    const ringed = navLayer(TEST_MAP.terrain, [...baked, house, ...rocks], MAX_RADIUS);
    expect(reachable(open, house)).toBe(true);
    expect(reachable(ringed, house)).toBe(false);
    const [lookout] = oldPlaces([house]);
    expect(placeSpot(TEST_MAP, ringed, lookout)).toBeNull();
    expect(placeSpot(TEST_MAP, open, lookout)?.id).toBe(house.id);
  });

  it('never picks a gas station at a road bend', () => {
    const stations = baked.filter((o) => o.kind === 'landmark' && o.look === 'gasStation');
    expect(stations.length).toBeGreaterThan(0);
    for (const s of stations) expect(offRoad(s), s.id).toBe(false);
    expect(oldSpotPicks(TEST_MAP).some((p) => p.propId.startsWith('gasStation-'))).toBe(false);
  });
});

describe('old-world loot spot picks on the committed map', () => {
  const picks = oldSpotPicks(TEST_MAP);

  it('commits the picks the map makes, the same on every read', () => {
    const made = makeOldSpotPicks(TEST_MAP);
    expect(picks, 'old-spots.json is stale. Run npm run old-spots.').toEqual(made);
    expect(makeOldSpotPicks({ ...TEST_MAP, props: TEST_MAP.props.map((p) => ({ ...p, pos: { ...p.pos } })) })).toEqual(made);
    expect(() => oldSpotPicks({ hash: 'another-map' })).toThrow(/npm run old-spots/);
  });

  it('keeps every pick off the roads, outside territories and sites, and reachable', () => {
    const byId = new Map(baked.map((o) => [o.id, o]));
    for (const p of picks) {
      const o = byId.get(p.propId)!;
      expect(o, p.propId).toBeDefined();
      expect(offRoad(o), p.propId).toBe(true);
      expect(territoryAt(o.pos), p.propId).toBeNull();
      expect(clearOfSites(o.pos, o.r), p.propId).toBe(true);
      expect(reachable(layer, o), p.propId).toBe(true);
      expect(p.reach).toBe(propReach(o));
    }
  });

  it('is sparse: some places of every type hold a spot and some do not', () => {
    const places = oldPlaces(baked);
    const picked = new Set(picks.map((p) => p.propId));
    const counts = OLD_PLACE_TYPES.map((type) => {
      const ofType = places.filter((p) => p.type === type);
      const withSpot = ofType.filter((p) => p.props.some((o) => picked.has(o.id))).length;
      return { type, places: ofType.length, withSpot };
    });
    expect(picks.length).toBeGreaterThanOrEqual(6);
    expect(picks.length).toBeLessThanOrEqual(20);
    for (const c of counts) {
      expect(c.withSpot, c.type).toBeGreaterThan(0);
      expect(c.withSpot, c.type).toBeLessThan(c.places);
    }
  });

  it('names the place type in the stock id', () => {
    for (const p of picks) expect(oldSpotOf({ id: oldStockId(p) })).toEqual({ type: p.type, propId: p.propId });
    expect(oldSpotOf({ id: 'ruin-12' })).toBeNull();
    expect(() => oldSpotOf({ id: 'old-castle-ruin-12' })).toThrow(/old place type/);
  });
});
