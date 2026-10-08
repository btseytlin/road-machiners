import { START_KITS } from "../data/start";
import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { TERRAIN, TERRAIN_TYPES, type DeckSpec, type TerrainTypeId } from "../data/terrain";
import { route } from "./path";
import { PHYSICS } from "../data/physics";
import { buildDecks, deckById } from "./bridge";
import {
  deckSegments,
  deckHeight,
  groundAt,
  heightAt,
  isCliff,
  tileAt,
  tileSlope,
  type Terrain,
} from "./terrain";
import { emptyWorld } from "./testkit";
import { ROAD_INDEX } from "./road-index";
import { dist, polylineDist, type Vec } from "./vec";
import { newWorld } from "./world";
import { siteEdgeCrossings, siteGap } from "./sites";
import type { World } from "./types";
import { TEST_MAP } from "../test/map";
import { FALLEN_SUN_DECKS, TERRITORIES } from "../data/territory";

let startWorld: World | undefined;
function worldOnMap(): World {
  startWorld ??= newWorld(1337, START_KITS.standard, TEST_MAP);
  return startWorld;
}

function flatWith(
  size: number,
  lift: (i: number, j: number) => number,
): Terrain {
  const heights: number[] = [];
  for (let j = 0; j <= size; j++)
    for (let i = 0; i <= size; i++) heights.push(lift(i, j));
  return { size, heights, types: new Array(size * size).fill("hardpan") };
}

describe("road index", () => {
  it("finds the same road distance through the road index as over every road", () => {
    for (const reach of [REGION.roadWidth / 2, REGION.roadWidth / 2 + TERRAIN.flattenMargin]) {
      for (let y = -20.25; y < REGION.size + 20; y += 3.7) {
        for (let x = -20.25; x < REGION.size + 20; x += 3.7) {
          const exact = Math.min(...REGION.roads.map((road) => polylineDist({ x, y }, road)));
          expect(ROAD_INDEX.nearestWithin(x, y, reach)).toBe(exact < reach ? exact : Infinity);
        }
      }
    }
  });
});

describe('terrain variety', () => {
  it('has every type with a bake rule on the baked map, with road/site priority', () => {
    const unruled = ['ash'];
    const ruled = Object.keys(TERRAIN_TYPES).filter((id) => !unruled.includes(id));
    const t = TEST_MAP.terrain;
    expect(new Set(t.types)).toEqual(new Set(ruled));
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const point = { x: x + 0.5, y: y + 0.5 };
      const kind = t.types[y * t.size + x];
      if (ROAD_INDEX.nearestWithin(point.x, point.y, REGION.roadWidth / 2) < REGION.roadWidth / 2) expect(kind).toBe('road');
      else if ([...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')].some((s) => dist(point, s.pos) < s.radius + TERRAIN.types.siteMargin)) expect(kind).toBe('hardpan');
    }
  });

  it('gives each new surface a distinct color', () => {
    const kinds = ['mud', 'gravel', 'saltCrust', 'asphalt', 'ash', 'field'] as TerrainTypeId[];
    expect(new Set(kinds.map((id) => TERRAIN_TYPES[id]?.color)).size).toBe(6);
  });

  it('gives dirty water and toxic pools colors of their own and slows trucks on them like mud', () => {
    const colors = Object.values(TERRAIN_TYPES).map((t) => t.color);

    for (const id of ['dirtyWater', 'toxic'] as TerrainTypeId[]) {
      expect(colors.filter((c) => c === TERRAIN_TYPES[id].color)).toHaveLength(1);
      expect(TERRAIN_TYPES[id].speed).toBe(TERRAIN_TYPES.mud.speed);
    }
  });
});

describe("terrain grid", () => {
  it('has seventeen distinct Icarus destinations with road access', () => {
    const w = worldOnMap();
    expect(w.size).toBe(600);
    expect(w.terrain.heights).toHaveLength(601 * 601);
    expect(REGION.name).toBe('Icarus');
    expect(REGION.towns.map((town) => town.name)).toEqual(['Bowl', 'Nose']);
    expect(REGION.locations.map((site) => site.name)).toEqual([
      'Old Orchard', 'Dustwell', 'The Granary', 'Burnt Convoy', 'Podfield',
      'Canyon Bridge', 'Glass Flats', 'Green Pit', 'South Lock', 'Ridge Wrecks',
      'Pump Station', 'Fallen Sun', 'Salvage Yard', 'Broken Wing', 'Scrapjaw Camp', 'Kiln Camp',
    ]);
    const sites = [...REGION.towns, ...REGION.locations];
    expect(new Set(sites.map((site) => site.id)).size).toBe(18);
    for (const site of sites) {
      expect(site.pos.x).toBeGreaterThan(site.radius);
      expect(site.pos.y).toBeGreaterThan(site.radius);
      expect(site.pos.x).toBeLessThan(w.size - site.radius);
      expect(site.pos.y).toBeLessThan(w.size - site.radius);
      expect(REGION.roads.some((road) => road.some((p) => dist(p, site.pos) <= ('kind' in site && site.kind === 'territory' ? site.radius : 0.01)))).toBe(true);
    }
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) expect(dist(sites[i].pos, sites[j].pos)).toBeGreaterThan(60);
  });

  it('links both towns by northern and southern canyon crossings', () => {
    const connects = (a: string, b: string) => {
      const sites = [...REGION.towns, ...REGION.locations];
      const access = (id: string) => {
        const site = sites.find((s) => s.id === id)!;
        const reach = 'kind' in site && site.kind === 'territory' ? site.radius : 0.01;
        return REGION.roads.find((road) => dist(road.at(-1)!, site.pos) <= reach && road.length === 2)?.[0] ?? site.pos;
      };
      const p = access(a);
      const q = access(b);
      const passes = (road: Vec[], at: Vec) => road.some((point) => dist(point, at) < 0.01);
      return REGION.roads.some((road) => passes(road, p) && (passes(road, q) || REGION.roads.some((other) => passes(other, q) && road.some((point) => passes(other, point)))));
    };
    for (const [a, b] of [
      ['bowl', 'orchard'], ['orchard', 'dustwell'], ['dustwell', 'granary'], ['granary', 'burnt-convoy'],
      ['burnt-convoy', 'podfield'], ['podfield', 'nose'], ['bowl', 'ridge-wrecks'], ['ridge-wrecks', 'south-lock'],
      ['south-lock', 'green-pit'], ['green-pit', 'glass-flats'], ['glass-flats', 'canyon-bridge'], ['canyon-bridge', 'nose'],
      ['orchard', 'pump-station'], ['pump-station', 'salvage-yard'], ['salvage-yard', 'podfield'],
      ['granary', 'pump-station'], ['south-lock', 'pump-station'], ['salvage-yard', 'glass-flats'],
    ]) expect(connects(a, b), `${a} to ${b}`).toBe(true);
  });

  it('puts three dead-end approaches into the Fallen Sun without a road through it', () => {
    const wreck = REGION.locations.find((site) => site.id === 'fallen-sun')!;
    const entering = REGION.roads.filter((road) => road.some((p) => siteGap(wreck, p) < 0));
    expect(entering).toHaveLength(3);
    for (const road of REGION.roads) {
      const firstInside = road.findIndex((p) => siteGap(wreck, p) < 0);
      const outside = firstInside < 0 ? road : road.slice(0, firstInside);
      if (firstInside >= 0) for (const p of road.slice(firstInside)) expect(siteGap(wreck, p)).toBeLessThan(0);
      for (let i = 1; i < outside.length; i++) expect(siteEdgeCrossings(wreck, outside[i - 1], outside[i])).toEqual([]);
    }
  });

  it('enters the Old Orchard by its spur alone, which ends just inside its outline, and keeps the trunk roads outside', () => {
    const orchard = REGION.locations.find((site) => site.id === 'orchard')!;
    const entering = REGION.roads.filter((road) => road.some((p) => siteGap(orchard, p) < 0));
    expect(entering).toHaveLength(1);
    const [spur] = entering;
    expect(spur).toHaveLength(2);
    expect(siteGap(orchard, spur[0])).toBeGreaterThan(0);
    expect(siteGap(orchard, spur[1])).toBeLessThan(0);
    expect(siteGap(orchard, spur[1])).toBeGreaterThan(-0.5);
    expect(REGION.roads.some((road) => road !== spur && road.some((p) => dist(p, spur[0]) < 0.01))).toBe(true);
    for (const road of REGION.roads.filter((r) => r !== spur)) {
      for (let i = 1; i < road.length; i++) {
        const steps = Math.ceil(dist(road[i - 1], road[i]) * 4);
        for (let k = 0; k <= steps; k++) {
          const p = { x: road[i - 1].x + ((road[i].x - road[i - 1].x) * k) / steps, y: road[i - 1].y + ((road[i].y - road[i - 1].y) * k) / steps };
          expect(siteGap(orchard, p)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('paints the Old Orchard dirt roads and tracks as dirt track, which drives like hardpan but shows apart from it', () => {
    const orchard = REGION.locations.find((site) => site.id === 'orchard')!;
    for (const road of TERRITORIES.orchard.farm!.roads.filter((r) => r.surface === 'track')) {
      for (let i = 1; i < road.points.length; i++) {
        const [a, b] = [road.points[i - 1], road.points[i]];
        const mid = { x: orchard.pos.x + (a.x + b.x) / 2, y: orchard.pos.y + (a.y + b.y) / 2 };
        expect(TEST_MAP.terrain.types[tileAt(TEST_MAP.terrain, mid)], `track at ${mid.x},${mid.y}`).toBe('track');
      }
    }
    const { track, hardpan, sand } = TERRAIN_TYPES;
    expect([track.speed, track.wear, track.dust]).toEqual([hardpan.speed, hardpan.wear, hardpan.dust]);
    expect(track.color).not.toBe(hardpan.color);
    expect(track.color).not.toBe(sand.color);
  });

  it('paints the Old Orchard pads as pale concrete, which drives like asphalt', () => {
    const orchard = REGION.locations.find((site) => site.id === 'orchard')!;
    for (const pad of TERRITORIES.orchard.farm!.pads) {
      const mid = { x: orchard.pos.x + pad.at.x, y: orchard.pos.y + pad.at.y };
      expect(TEST_MAP.terrain.types[tileAt(TEST_MAP.terrain, mid)], `pad at ${mid.x},${mid.y}`).toBe('concrete');
    }
    const { concrete, asphalt } = TERRAIN_TYPES;
    expect([concrete.speed, concrete.wear, concrete.dust]).toEqual([asphalt.speed, asphalt.wear, asphalt.dust]);
    for (const shift of [0, 8, 16]) expect((concrete.color >> shift) & 0xff).toBeGreaterThan((asphalt.color >> shift) & 0xff);
  });

  it('paints the Old Orchard canals as canal, which drives like dirty water but shows blue-grey', () => {
    const orchard = REGION.locations.find((site) => site.id === 'orchard')!;
    for (const canal of TERRITORIES.orchard.farm!.canals) {
      const [a, b] = canal.points;
      const mid = { x: orchard.pos.x + (a.x + b.x) / 2, y: orchard.pos.y + (a.y + b.y) / 2 };
      expect(TEST_MAP.terrain.types[tileAt(TEST_MAP.terrain, mid)], `canal at ${mid.x},${mid.y}`).toBe('canal');
    }
    const { canal, dirtyWater } = TERRAIN_TYPES;
    expect([canal.speed, canal.wear, canal.dust]).toEqual([dirtyWater.speed, dirtyWater.wear, dirtyWater.dust]);
    expect(canal.color & 0xff).toBeGreaterThan(canal.color >> 16);
    expect(dirtyWater.color & 0xff).toBeLessThan(dirtyWater.color >> 16);
  });

  it('carves a canyon and a dry river below the surrounding hills', () => {
    const t = TEST_MAP.terrain;
    const canyon = TERRAIN.features.canyon;
    const river = TERRAIN.features.dryRiver;
    const pickMiddle = (line: { x: number; y: number }[]) => line[Math.floor(line.length / 2)];
    const c = pickMiddle(canyon.path);
    const r = { x: (river.path[0].x + river.path[1].x) / 2, y: (river.path[0].y + river.path[1].y) / 2 };
    expect(heightAt(t, c.x, c.y)).toBeLessThan(heightAt(t, c.x + canyon.width + canyon.bank + 3, c.y) - 1);
    expect(heightAt(t, r.x, r.y)).toBeLessThan(heightAt(t, r.x, r.y + river.width + river.bank + 3) - 0.3);
    for (const crater of TERRAIN.features.craters) {
      expect(heightAt(t, crater.center.x, crater.center.y)).toBeLessThan(heightAt(t, crater.center.x + crater.radius + crater.bank, crater.center.y) - 0.5);
    }
  });

  it("neighboring tiles share corners, so height is continuous across edges", () => {
    const t = TEST_MAP.terrain;
    for (const x of [10, 23, 41])
      expect(heightAt(t, x - 1e-9, 20.3)).toBeCloseTo(
        heightAt(t, x + 1e-9, 20.3),
        6,
      );
  });

  it("roads, towns and the player start are drivable on the baked map", () => {
    const w = worldOnMap();
    const t = w.terrain;
    for (const road of REGION.roads)
      for (const p of road) expect(isCliff(t, tileAt(t, p))).toBe(false);
    expect(t.types[tileAt(t, REGION.roads[0][1])]).toBe("road");
    expect(isCliff(t, tileAt(t, w.vehicles[0].pos))).toBe(false);
  });

  it("mountains produce cliff tiles", () => {
    const t = TEST_MAP.terrain;
    expect(t.types.filter((_, i) => isCliff(t, i)).length).toBeGreaterThan(20);
  });

  it("a slope tilts in the direction of the climb", () => {
    const t = flatWith(10, (i) => i * 0.3);
    const p = { x: 5.5, y: 5.5 };
    expect(tileSlope(t, tileAt(t, p)).x).toBeCloseTo(0.3);
  });

  it("routes go around cliffs", () => {
    const w = emptyWorld({ x: 20, y: 30 });
    w.terrain = flatWith(60, (i, j) =>
      i === 26 && j >= 20 && j <= 41 ? 5 : 0,
    );
    const pts = route(w, { x: 20, y: 30 }, { x: 32, y: 30 }, 0.6, []);
    let prev = { x: 20, y: 30 };
    for (const p of pts) {
      for (let k = 0; k <= 40; k++) {
        const q = {
          x: prev.x + ((p.x - prev.x) * k) / 40,
          y: prev.y + ((p.y - prev.y) * k) / 40,
        };
        expect(isCliff(w.terrain, tileAt(w.terrain, q))).toBe(false);
      }
      prev = p;
    }
  });
});

describe("the Broken Wing deck on the baked map", () => {
  const t = TEST_MAP.terrain;
  const W = deckById("broken-wing");
  const on = (along: number, across: number) => ({
    x: W.from.x + W.axis.x * along - W.axis.y * across,
    y: W.from.y + W.axis.y * along + W.axis.x * across,
  });
  const END = 4;
  const thickness = PHYSICS.bridge.deckThickness / PHYSICS.metersPerTile;
  const rails = PHYSICS.bridge.railHeight / PHYSICS.metersPerTile;

  it("gives the deck line as the height everywhere on the outline", () => {
    for (let along = 0; along <= W.length; along += 0.5)
      for (let across = -W.width / 2 + 0.25; across < W.width / 2; across += 0.5) {
        const p = on(along, across);
        expect(heightAt(t, p.x, p.y)).toBeCloseTo(deckHeight(t, W, along), 9);
      }
  });

  it("stands the deck middle at least 4 m over the ground under it", () => {
    const mid = on(W.length / 2, 0);
    expect(heightAt(t, mid.x, mid.y) - groundAt(t, mid.x, mid.y)).toBeGreaterThanOrEqual(4 / PHYSICS.metersPerTile);
  });

  it("keeps the ground under the outline below the deck slab, so no terrain shows through the deck", () => {
    for (let along = 0; along <= W.length; along += 0.5)
      for (let across = -W.width / 2; across <= W.width / 2; across += 0.5) {
        const p = on(along, across);
        const line = deckHeight(t, W, along);
        const ground = groundAt(t, p.x, p.y);
        const inner = along >= END && along <= W.length - END;
        expect(ground, `${along},${across}`).toBeLessThanOrEqual(inner ? line - thickness : line + rails);
      }
  });
});

describe("deck heights", () => {
  const t = TEST_MAP.terrain;

  it("rests both ends of a deck with no rise on the ground, as Canyon Bridge and the Broken Wing deck always did", () => {
    for (const id of ["canyon-bridge", "broken-wing"]) {
      const deck = deckById(id);
      const segments = deckSegments(t, deck);
      expect(segments).toHaveLength(1);
      expect([segments[0].h0, segments[0].h1]).toEqual([groundAt(t, deck.from.x, deck.from.y), groundAt(t, deck.to.x, deck.to.y)]);
    }
  });

  it("raises each end of a deck by its rise over the ground there", () => {
    const flap = deckById(FALLEN_SUN_DECKS[0].id);
    const [{ h0, h1 }] = deckSegments(t, flap);

    expect(h0).toBeCloseTo(groundAt(t, flap.from.x, flap.from.y) + flap.stations[0].rise, 12);
    expect(h1).toBeCloseTo(groundAt(t, flap.to.x, flap.to.y) + flap.stations[1].rise, 12);
    expect(flap.stations[1].rise).toBeGreaterThan(0);
  });

  it("puts the flap's lip, its raised end, at the rise over the ground everywhere across the deck", () => {
    const flap = deckById(FALLEN_SUN_DECKS[0].id);
    const lip = flap.length - 1e-6;
    for (let across = -flap.width / 2 + 0.1; across < flap.width / 2; across += 0.4) {
      const p = { x: flap.from.x + flap.axis.x * lip - flap.axis.y * across, y: flap.from.y + flap.axis.y * lip + flap.axis.x * across };
      expect(heightAt(t, p.x, p.y)).toBeCloseTo(groundAt(t, flap.to.x, flap.to.y) + flap.stations[1].rise, 5);
    }
  });

  const spec: DeckSpec = {
    id: "ridge",
    line: [[100, 0], [108, 1.5], [130, 1.5], [138, 0]].map(([x, rise]) => ({ at: { x, y: 205 }, rise })),
    width: 8,
    cut: null,
    skirt: true,
  };
  const [ridge] = buildDecks([spec]);

  it("stands the deck line at each station on the ground there plus its rise (IV2)", () => {
    for (const s of ridge.stations) expect(deckHeight(t, ridge, s.along)).toBeCloseTo(groundAt(t, s.at.x, s.at.y) + s.rise, 12);
  });

  it("keeps the deck line continuous across each change of grade, and its pieces end to end (IV2)", () => {
    for (const s of ridge.stations.slice(1, -1)) expect(deckHeight(t, ridge, s.along - 1e-9)).toBeCloseTo(deckHeight(t, ridge, s.along + 1e-9), 6);
    const segments = deckSegments(t, ridge);
    expect(segments).toHaveLength(3);
    for (let k = 1; k < segments.length; k++) {
      expect(segments[k].h0).toBe(segments[k - 1].h1);
      expect(segments[k].from).toEqual(segments[k - 1].to);
      expect(segments[k].along).toBeCloseTo(segments[k - 1].along + segments[k - 1].length, 12);
    }
  });

  it("fails loudly on a distance off the deck", () => {
    expect(() => deckHeight(t, ridge, -0.1)).toThrow("Deck ridge has no point -0.1 tiles along it");
    expect(() => deckHeight(t, ridge, ridge.length + 0.1)).toThrow();
  });

  it("gives a tile on the wing the grade of the piece under its centre", () => {
    const wing = deckById("fallen-sun-wing");
    const segments = deckSegments(t, wing);
    let checked = 0;
    for (const seg of segments) {
      const mid = { x: seg.from.x + (wing.axis.x * seg.length) / 2, y: seg.from.y + (wing.axis.y * seg.length) / 2 };
      const tile = tileAt(t, mid);
      const centre = { x: (tile % t.size) + 0.5, y: Math.floor(tile / t.size) + 0.5 };
      const along = (centre.x - wing.from.x) * wing.axis.x + (centre.y - wing.from.y) * wing.axis.y;
      if (along <= seg.along || along >= seg.along + seg.length) continue;
      const grade = (seg.h1 - seg.h0) / seg.length;
      const slope = tileSlope(t, tile);
      expect(slope.x).toBeCloseTo(grade * wing.axis.x, 12);
      expect(slope.y).toBeCloseTo(grade * wing.axis.y, 12);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});

