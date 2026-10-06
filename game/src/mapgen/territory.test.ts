import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { PHYSICS } from '../data/physics';
import { ORCHARD_HEADING, REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { FALLEN_SUN_DECKS, onOrchardRoad, TERRITORIES, type TerritoryRules } from '../data/territory';
import { deckAt, deckById } from '../sim/bridge';
import { boxDistance, onDeck, propBoxes, propPose, propReach, type PosedBox } from '../sim/mapgen';
import { CELL, navLayer } from '../sim/nav/layer';
import { siteGap } from '../sim/sites';
import { route } from '../sim/path';
import { ROAD_INDEX } from '../sim/road-index';
import { hazardZones, isLootSpot, landingStrips, reactorPos, territoryAt, territoryCaches, territoryEntries, territoryOfStock, territoryPieces, territoryRoads, type BakedPiece, type LandingStrip } from '../sim/territory';
import { groundAt, isCliff, type BakedProp, type Terrain } from '../sim/terrain';
import { newWorld } from '../sim/world';
import { angleDiff, dist, lerp, segmentDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { newDraft, tileSteepness, type MapDraft } from './bake';
import { fillFarm } from './farm';
import { BUILT_CANAL, BUILT_GLASS, BUILT_PAD, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, ruleRng, tileCenter, tileOf, tilesWithin } from './oldworld';
import { territoryLayer } from './territory';
import { budget } from '../test/budget';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const t = fallenSun as never;
const rules = TERRITORIES['fallen-sun'].wreck!;
const reactor = TERRITORIES['fallen-sun'].reactor!;
const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
const pieces = territoryPieces(t);
const inside = TEST_MAP.props.filter((p) => siteGap(fallenSun, p.pos) < 0);
const DEBRIS_LOOKS = new Set<string>(rules.patches.flatMap((p) => p.debris.map((d) => d.look)));

// A draft over the whole region with rolling ground, so the seat levels ground both below and above a piece's centre.
function rollingDraft(): MapDraft {
  const d = newDraft(REGION.size);
  const w = d.size + 1;
  for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) d.heights[j * w + i] = 0.6 * Math.sin(i / 9) + 0.4 * Math.cos(j / 7);
  return d;
}

function terrainOf(size: number, heights: ArrayLike<number>): Terrain {
  return { size, heights: Array.from(heights), types: [] };
}

function lowBoxes(p: BakedPiece, k: number) {
  return propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
}

// Map corners under any of a piece's low boxes.
function cornersUnder(p: BakedPiece, k: number): Vec[] {
  const boxes = lowBoxes(p, k);
  const reach = Math.max(...boxes.map((b) => dist(b.center, p.pos) + Math.hypot(b.half.x, b.half.y)));
  const out: Vec[] = [];
  for (let j = Math.floor(p.pos.y - reach); j <= p.pos.y + reach; j++) {
    for (let i = Math.floor(p.pos.x - reach); i <= p.pos.x + reach; i++) if (boxes.some((b) => boxDistance(b, { x: i, y: j }) === 0)) out.push({ x: i, y: j });
  }
  return out;
}

// Drawn props: debris and field spots, by their looks, off the authored pieces.
function drawnProps(): BakedProp[] {
  return inside.filter((p) => (DEBRIS_LOOKS.has(p.kind) || p.kind === rules.spotLook) && !pieces.some((q) => q.look === p.kind && dist(q.pos, p.pos) < 1e-3));
}

describe('the territory layer', () => {
  it('places the same props and heights for the same seed', () => {
    const run = () => territoryLayer(7, rollingDraft());
    const [a, b] = [run(), run()];
    expect(a.props).toEqual(b.props);
    expect(a.heights).toEqual(b.heights);
    expect(a.props).not.toEqual(territoryLayer(8, rollingDraft()).props);
  });

  it('bakes the Fallen Sun as it would alone', () => {
    const alone = REGION.locations.filter((l) => l.kind !== 'territory' || l.id === 'fallen-sun');
    const all = REGION.locations.splice(0, REGION.locations.length, ...alone);
    let solo: MapDraft;
    try {
      solo = territoryLayer(7, rollingDraft());
    } finally {
      REGION.locations.splice(0, REGION.locations.length, ...all);
    }
    const full = territoryLayer(7, rollingDraft());
    const ofSun = (props: readonly BakedProp[]) => props.filter((p) => siteGap(fallenSun, p.pos) < 0);
    expect(ofSun(full.props).length).toBeGreaterThan(0);
    expect(ofSun(full.props)).toEqual(ofSun(solo.props));
    // Other territories seat their own pieces inside their outlines; every other corner keeps the Fallen Sun's heights.
    const others = REGION.locations.filter((l) => l.kind === 'territory' && l.id !== 'fallen-sun');
    const w = full.size + 1;
    const outsideOthers = (heights: Float32Array) => Array.from(heights).filter((_, k) => others.every((o) => siteGap(o, { x: k % w, y: Math.floor(k / w) }) >= 0));
    expect(outsideOthers(full.heights)).toEqual(outsideOthers(solo.heights));
  });

  it("levels the ground under every piece's low boxes to the height at its centre, less its sink", () => {
    const before = rollingDraft();
    const ground = terrainOf(before.size, before.heights);
    const after = territoryLayer(7, rollingDraft());
    const w = before.size + 1;
    pieces.forEach((p, k) => {
      const centre = groundAt(ground, p.pos.x, p.pos.y) - p.sink;
      const corners = cornersUnder(p, k);
      expect(corners.length, p.look).toBeGreaterThan(0);
      for (const c of corners) expect(after.heights[c.y * w + c.x], `${p.look} ${c.x},${c.y}`).toBeCloseTo(centre, 6);
    });
    // Far from every piece the relief is untouched.
    const far = { x: Math.round(fallenSun.pos.x - 40), y: Math.round(fallenSun.pos.y - 30) };
    expect(after.heights[far.y * w + far.x]).toBe(before.heights[far.y * w + far.x]);
  });

  it("digs a sunk piece's pit no wider than its low boxes and the seat ease", () => {
    const before = rollingDraft();
    const after = territoryLayer(7, rollingDraft());
    const w = before.size + 1;
    const sunk = pieces.map((p, k) => ({ p, k })).filter(({ p }) => p.sink > 0);
    expect(sunk).toHaveLength(2);
    const gapTo = (k: number, c: Vec) => Math.min(...lowBoxes(pieces[k], k).map((b) => boxDistance(b, c)));
    for (const { p, k } of sunk) {
      const reach = Math.max(...lowBoxes(p, k).map((b) => dist(b.center, p.pos) + Math.hypot(b.half.x, b.half.y))) + rules.seatEase + 2;
      for (let j = Math.floor(p.pos.y - reach); j <= p.pos.y + reach; j++) {
        for (let i = Math.floor(p.pos.x - reach); i <= p.pos.x + reach; i++) {
          if (pieces.some((_, n) => gapTo(n, { x: i, y: j }) < rules.seatEase)) continue;
          expect(after.heights[j * w + i], `${i},${j}`).toBe(before.heights[j * w + i]);
        }
      }
    }
  });

  it('keeps the seat in the baked map, to the map file rounding', () => {
    const terrain = TEST_MAP.terrain;
    pieces.forEach((p, k) => {
      const centre = groundAt(terrain, p.pos.x, p.pos.y);
      for (const c of cornersUnder(p, k)) expect(Math.abs(terrain.heights[c.y * (terrain.size + 1) + c.x] - centre), `${p.look} ${c.x},${c.y}`).toBeLessThanOrEqual(2 / MAPGEN.heightScale);
    });
  });

  it('bakes every authored piece, the reactor, nine caches and fifteen field spots', () => {
    for (const p of pieces) expect(TEST_MAP.props.filter((o) => o.kind === p.look && dist(o.pos, p.pos) < 1e-3), p.look).toHaveLength(1);
    expect(inside.filter((p) => p.kind === reactor.look)).toHaveLength(1);
    expect(dist(inside.find((p) => p.kind === reactor.look)!.pos, reactorPos(t))).toBeLessThan(1e-3);
    expect(inside.filter((p) => p.kind === rules.cacheLook)).toHaveLength(9);
    expect(inside.filter((p) => p.kind === rules.spotLook)).toHaveLength(15);
    expect(TEST_MAP.props.filter((p) => p.kind === 'rimRock')).toHaveLength(rules.rimRocks!.count);
  });

  it('gives each cache and field spot one stock after world creation', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && territoryAt(o.pos)?.id === 'fallen-sun');
    expect(spots).toHaveLength(24);
    for (const o of spots) expect(w.salvage.filter((s) => s.id === o.id), o.id).toHaveLength(1);
    expect(w.salvage.filter((s) => territoryOfStock(s)?.id === 'fallen-sun')).toHaveLength(24);
  });

  it("keeps every drawn prop off the roads, the pieces' boxes and the hazard", () => {
    const boxes = pieces.flatMap((p, k) => propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }));
    const drawn = drawnProps();
    expect(drawn).toHaveLength(rules.patches.reduce((n, p) => n + p.spots + p.debris.reduce((m, d) => m + d.count, 0), 0));
    for (const p of drawn) {
      const reach = REGION.roadWidth / 2 + p.r;
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, reach), p.kind).toBe(Infinity);
      for (const b of boxes) expect(boxDistance(b, p.pos), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(p.r);
      expect(dist(p.pos, zone.pos) - p.r, p.kind).toBeGreaterThan(zone.radius);
    }
  });

  it('keeps every loot spot apart and outside the hazard', () => {
    const spots = inside.filter((p) => p.kind === rules.spotLook || p.kind === rules.cacheLook);
    spots.forEach((a, i) => {
      expect(dist(a.pos, zone.pos), a.kind).toBeGreaterThan(zone.radius + a.r);
      for (const b of spots.slice(i + 1)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(TERRITORIES['fallen-sun'].spotGap);
    });
  });

  it('keeps every prop but the reactor and its housing out of the hazard', () => {
    const housing = pieces.find((p) => p.look === 'shipBow')!;
    const others = inside.filter((p) => p.kind !== reactor.look && !(p.kind === housing.look && dist(p.pos, housing.pos) < 1e-3));
    for (const p of others) expect(dist(p.pos, zone.pos), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(zone.radius);
  });

  it('lets a truck drive from each road to the side of every cache and field spot', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && siteGap(fallenSun, o.pos) < 0);
    const reach = (o: (typeof spots)[number]) => (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
    for (const entry of territoryEntries(t)) {
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), `${spot.id} from ${entry.x},${entry.y}`).toBeLessThanOrEqual(reach(spot));
      }
    }
  });

  it('lets a truck drive through the cage from end to end', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const cage = pieces.find((p) => p.look === 'shipCage')!;
    const along = { x: Math.cos(cage.yaw), y: Math.sin(cage.yaw) };
    // Points 2 tiles past each open end, on the axis.
    const end = (side: number): Vec => ({ x: cage.pos.x + along.x * (cage.r + 2) * side, y: cage.pos.y + along.y * (cage.r + 2) * side });
    const path = [end(-1), ...route(w, end(-1), end(1), 0.6, [])];
    expect(dist(path.at(-1)!, end(1))).toBeLessThan(1);
    // The route stays inside the tube: never farther from the axis than its walls.
    const offAxis = (p: Vec) => Math.abs((p.x - cage.pos.x) * along.y - (p.y - cage.pos.y) * along.x);
    const alongAxis = (p: Vec) => (p.x - cage.pos.x) * along.x + (p.y - cage.pos.y) * along.y;
    const samples = path.slice(1).flatMap((b, i) => Array.from({ length: 20 }, (_, k) => ({ x: path[i].x + ((b.x - path[i].x) * k) / 20, y: path[i].y + ((b.y - path[i].y) * k) / 20 })));
    const insideTube = samples.filter((p) => Math.abs(alongAxis(p)) < cage.r * 0.8);
    expect(insideTube.length).toBeGreaterThan(0);
    for (const p of insideTube) expect(offAxis(p)).toBeLessThan(3.5);
  });
});

describe("the Fallen Sun's dirt roads, decks and lanes on the baked map", () => {
  const terrain = TEST_MAP.terrain;
  const { roads, spurs } = territoryRoads(t);
  const web = [...roads, ...spurs];
  const strips = landingStrips(t);
  const pieceAt = (p: BakedProp) => pieces.some((q) => q.look === p.kind && dist(q.pos, p.pos) < 1e-3);
  const onRegionRoad = (c: Vec) => ROAD_INDEX.nearestWithin(c.x, c.y, REGION.roadWidth / 2) < REGION.roadWidth / 2;

  // Tiles whose centre lies within a road's half width of its centreline: the tiles the bake marks.
  function roadTiles(road: { points: Vec[]; width: number }): number[] {
    const out = new Set<number>();
    for (let k = 1; k < road.points.length; k++) {
      const [a, b] = [road.points[k - 1], road.points[k]];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const tile of tilesWithin(terrain.size, mid, dist(a, b) / 2 + road.width)) {
        const c = { x: (tile % terrain.size) + 0.5, y: Math.floor(tile / terrain.size) + 0.5 };
        if (segmentDist(c, a, b) <= road.width / 2) out.add(tile);
      }
    }
    return [...out];
  }
  const dirtTiles = new Set(web.flatMap(roadTiles));

  // The tiles a circle overlaps, as the bake's mark test reads them.
  function touched(pos: Vec, r: number): number[] {
    const out: number[] = [];
    for (let y = Math.floor(pos.y - r); y <= Math.floor(pos.y + r); y++) {
      for (let x = Math.floor(pos.x - r); x <= Math.floor(pos.x + r); x++) {
        const near = { x: Math.min(Math.max(pos.x, x), x + 1), y: Math.min(Math.max(pos.y, y), y + 1) };
        if (dist(near, pos) < r || (x === Math.floor(pos.x) && y === Math.floor(pos.y))) out.push(y * terrain.size + x);
      }
    }
    return out;
  }

  it('marks every dirt road and spur tile as track, where no region road or deck makes it road (IV9)', () => {
    for (const road of web) {
      for (const tile of roadTiles(road)) {
        const c = { x: (tile % terrain.size) + 0.5, y: Math.floor(tile / terrain.size) + 0.5 };
        const want = deckAt(c.x, c.y) !== null || onRegionRoad(c) ? 'road' : 'track';
        expect(terrain.types[tile], `${c.x},${c.y}`).toBe(want);
      }
    }
  });

  it('lays no dirt road or spur tile on a cliff, and climbs at most 0.2 height units per tile along each road (IV9)', () => {
    for (const road of web) {
      for (const tile of roadTiles(road)) expect(isCliff(terrain, tile), `cliff at ${tile % terrain.size},${Math.floor(tile / terrain.size)}`).toBe(false);
      const points = along(road.points, 1);
      for (let k = 1; k < points.length; k++) {
        const [a, b] = [points[k - 1], points[k]];
        const grade = Math.abs(groundAt(terrain, b.x, b.y) - groundAt(terrain, a.x, a.y)) / dist(a, b);
        expect(grade, `grade at ${a.x.toFixed(1)},${a.y.toFixed(1)}`).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('keeps each landing strip off cliffs, under half the cliff slope, and clear of props and decks (IV9)', () => {
    for (const s of strips) {
      const box = stripBox(s);
      for (const tile of tilesWithin(terrain.size, box.center, Math.hypot(box.half.x, box.half.y) + 1)) {
        const c = { x: (tile % terrain.size) + 0.5, y: Math.floor(tile / terrain.size) + 0.5 };
        if (boxDistance(box, c) > 0) continue;
        expect(tileSteepness(terrain.heights, terrain.size, tile), `strip at ${c.x},${c.y}`).toBeLessThan(TERRAIN.drive.maxSlope / 2);
      }
      // The pieces' low boxes keep off the strips by the layout (src/sim/territory.test.ts); every other prop by its circle.
      for (const p of TEST_MAP.props.filter((o) => !pieceAt(o))) expect(boxDistance(box, p.pos), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(p.r);
      // Just past the lip, so the strip does not count its own flap.
      for (let k = 0.25; k <= dist(s.a, s.b); k += 0.5) {
        for (let c = -s.width / 2; c <= s.width / 2; c += 0.5) {
          const at = { x: s.a.x + box.axis.x * k - box.axis.y * c, y: s.a.y + box.axis.y * k + box.axis.x * c };
          expect(deckAt(at.x, at.y)?.deck.id ?? null, `a deck on the strip at ${at.x},${at.y}`).toBeNull();
        }
      }
    }
  });

  it('keeps every prop but the pieces and the reactor off the dirt road tiles, the decks and the landing strips (IV12)', () => {
    const near = TEST_MAP.props.filter((p) => !pieceAt(p) && p.kind !== reactor.look && dist(p.pos, fallenSun.pos) < fallenSun.radius + 40);
    expect(near.length).toBeGreaterThan(50);
    for (const p of near) {
      const where = `${p.kind} at ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)}`;
      expect(touched(p.pos, p.r).filter((tile) => dirtTiles.has(tile)), where).toEqual([]);
      expect(onDeck(p.pos, p.r), where).toBe(false);
      for (const s of strips) expect(boxDistance(stripBox(s), p.pos), where).toBeGreaterThan(p.r);
    }
  });

  it('lets a truck drive from each road to both ends of the wing and to the run-up of every flap', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const decks = FALLEN_SUN_DECKS.map((d) => deckById(d.id));
    const wing = decks.filter((d) => d.lips.length === 0);
    const flaps = decks.filter((d) => d.lips.length > 0);
    // The wing's feet, where its ramps meet the ground, and a point 3 tiles before each flap's foot.
    const goals = [wing[0].from, wing.at(-1)!.to, ...flaps.map((f) => (f.stations[0].rise === 0 ? { x: f.from.x - f.axis.x * 3, y: f.from.y - f.axis.y * 3 } : { x: f.to.x + f.axis.x * 3, y: f.to.y + f.axis.y * 3 }))];
    for (const entry of territoryEntries(t)) {
      for (const goal of goals) {
        const end = route(w, entry, goal, 0.6, []).at(-1)!;
        expect(dist(end, goal), `${goal.x.toFixed(1)},${goal.y.toFixed(1)} from ${entry.x.toFixed(1)},${entry.y.toFixed(1)}`).toBeLessThanOrEqual(1);
      }
    }
  }, 120_000);

  // IV4: from each entry, a route reaches every free point of a 5-tile grid inside the outline, at most 1.35 times the
  // straight line at the 90th percentile and 1.8 times at worst. Round 3's layout measured 1.68 and 2.87. A free point
  // is open to a standard truck's routes and lies outside every piece's outline on the ground, so the closed pockets
  // inside a hull, like the bow's, are no destination.
  it('routes from each entry to a 5-tile grid of free points without long detours (IV4)', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const layer = navLayer(w.terrain, w.obstacles, 0.6);
    const hulls = pieces.flatMap((p, k) => propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }));
    const free = (p: Vec) => layer.blocked[Math.floor(p.y / CELL) * layer.n + Math.floor(p.x / CELL)] === 0 && hulls.every((b) => boxDistance(b, p) > 0);
    const reach = Math.ceil(fallenSun.radius / 5) * 5;
    const points: Vec[] = [];
    for (let y = -reach; y <= reach; y += 5) for (let x = -reach; x <= reach; x += 5) {
      const p = { x: fallenSun.pos.x + x, y: fallenSun.pos.y + y };
      if (siteGap(fallenSun, p) < 0 && free(p)) points.push(p);
    }
    expect(points.length).toBeGreaterThan(200);
    const ratios: number[] = [];
    const unreached: string[] = [];
    for (const entry of territoryEntries(t)) {
      for (const p of points) {
        const path = [entry, ...route(w, entry, p, 0.6, [])];
        if (dist(path.at(-1)!, p) > 1) unreached.push(`${(p.x - fallenSun.pos.x).toFixed(0)},${(p.y - fallenSun.pos.y).toFixed(0)}`);
        else ratios.push(path.slice(1).reduce((sum, q, k) => sum + dist(path[k], q), 0) / Math.max(1, dist(entry, p)));
      }
    }
    ratios.sort((a, b) => a - b);
    expect(unreached).toEqual([]);
    expect(ratios[Math.floor(ratios.length * 0.9)]).toBeLessThanOrEqual(1.35);
    expect(ratios.at(-1)).toBeLessThanOrEqual(1.8);
  }, 300_000); // about 700 routes over the whole territory: seconds alone, minutes beside the full suite on one core
});

// Points at most step tiles apart along a polyline, its corners included.
function along(points: readonly Vec[], step: number): Vec[] {
  const out: Vec[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(dist(points[i - 1], points[i]) / step));
    for (let k = 1; k <= n; k++) out.push({ x: lerp(points[i - 1].x, points[i].x, k / n), y: lerp(points[i - 1].y, points[i].y, k / n) });
  }
  return out;
}

// A landing strip as a box on the ground.
function stripBox(s: LandingStrip): PosedBox {
  const length = dist(s.a, s.b);
  const axis = { x: (s.b.x - s.a.x) / length, y: (s.b.y - s.a.y) / length };
  return { center: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, axis, half: { x: length / 2, y: s.width / 2 }, z0: 0, z1: 1 };
}

describe('the orchard farm', () => {
  const orchard = REGION.locations.find((l) => l.id === 'orchard') as TerritoryDef;
  const rules = TERRITORIES.orchard;
  const farm = rules.farm!;
  const groves = farm.groves;
  const abs = (at: Vec): Vec => ({ x: orchard.pos.x + at.x, y: orchard.pos.y + at.y });
  // The five main roads come first in the list; the rest are narrow tracks.
  const MAIN_ROADS = 5;

  // A draft over the region with the committed map's heights, so the farm bakes on the orchard's real basin and
  // ridges. Marks and props start empty, as no earlier layer marks or builds inside a territory.
  function groundDraft(): MapDraft {
    const d = newDraft(REGION.size);
    d.heights.set(TEST_MAP.terrain.heights);
    return d;
  }

  // Tiles along a frame turned turn radians off the road toward its north end, and across it toward the map's west,
  // from the centre.
  function frameOf(pos: Vec, turn = 0): { s: number; c: number } {
    const [x, y] = [pos.x - orchard.pos.x, pos.y - orchard.pos.y];
    const yaw = ORCHARD_HEADING + turn;
    return { s: x * Math.cos(yaw) + y * Math.sin(yaw), c: x * Math.sin(yaw) - y * Math.cos(yaw) };
  }

  // The tile under the prop's centre and every tile whose centre its footprint covers.
  function footprint(d: MapDraft, p: BakedProp): number[] {
    return [tileOf(d.size, p.pos), ...tilesWithin(d.size, p.pos, p.r)];
  }

  const baked = territoryLayer(7, groundDraft());
  const props = baked.props.filter((p) => siteGap(orchard, p.pos) < 0);
  const trees = props.filter((p) => p.kind === groves.look);
  const buildingLooks = new Set(farm.buildings.map((b) => b.look));
  const spots = props.filter((p) => buildingLooks.has(p.kind));
  // Clutter shares looks with runs, so a clutter piece is told by its footprint: every run segment is half its
  // segment long.
  const runRadius = new Map(farm.runs.map((run) => [run.look, run.segment / 2]));
  const clutterLooks = new Set(farm.clutter.map((rule) => rule.look));
  const debrisLooks = new Set(farm.debris.map((rule) => rule.look));
  const loose = props.filter((p) => (clutterLooks.has(p.kind) || debrisLooks.has(p.kind)) && !(runRadius.has(p.kind) && p.r === runRadius.get(p.kind)));
  const segments = props.filter((p) => runRadius.has(p.kind) && p.r === runRadius.get(p.kind));

  it('marks the same tiles as before the road marks moved to ./marks', () => {
    // Counts and a hash of every marked tile's index and code, taken from the farm's own road marks before the move.
    const counts: Record<number, number> = {};
    let hash = 0;
    baked.built.forEach((code, tile) => {
      if (code === 0 || siteGap(orchard, { x: (tile % baked.size) + 0.5, y: Math.floor(tile / baked.size) + 0.5 }) >= 0) return;
      counts[code] = (counts[code] ?? 0) + 1;
      hash = (hash * 31 + tile * 7 + code) >>> 0;
    });
    expect(counts).toEqual({ [BUILT_OLD_ROAD]: 321, [BUILT_FIELD]: 1484, [BUILT_TRACK]: 632, [BUILT_CANAL]: 321, [BUILT_PAD]: 119 });
    expect(hash).toBe(2377274311);
  });

  it('bakes the same farm for the same seed', () => {
    const again = territoryLayer(7, groundDraft());
    expect(again.props).toEqual(baked.props);
    expect(again.built).toEqual(baked.built);
  });

  it('stands one building near each authored pose, turned with the road and jittered within its group', () => {
    for (const group of farm.buildings) {
      expect(props.filter((p) => p.kind === group.look), group.look).toHaveLength(group.poses.length);
      for (const pose of group.poses) {
        const found = props.filter((p) => p.kind === group.look && dist(p.pos, abs(pose.at)) <= group.shift * Math.SQRT2 + 1e-9);
        expect(found, `${group.look} at ${pose.at.x},${pose.at.y}`).toHaveLength(1);
        expect(found[0].r).toBe(pose.r);
        expect(Math.abs(angleDiff(ORCHARD_HEADING + pose.turn, found[0].yaw))).toBeLessThanOrEqual(group.turnJitter + 1e-9);
      }
    }
  });

  it('lays five roads out of the orchard, each ending on its edge, and marks them', () => {
    expect(farm.roads.slice(0, MAIN_ROADS).map((r) => r.surface)).toEqual(['oldRoad', 'track', 'track', 'track', 'track']);
    const ends = farm.roads.slice(0, MAIN_ROADS).map((road) => abs(road.points.at(-1)!));
    for (const end of ends) expect(Math.abs(siteGap(orchard, end)), `${end.x},${end.y}`).toBeLessThanOrEqual(1);
    // They leave in five directions, at least 20 tiles apart.
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) expect(dist(ends[i], ends[j])).toBeGreaterThan(20);
    // The old road begins where the spur ends.
    const [entry] = territoryEntries(orchard);
    expect(dist(abs(farm.roads[0].points[0]), entry)).toBeLessThan(1);
    for (const road of farm.roads) {
      const code = road.surface === 'oldRoad' ? BUILT_OLD_ROAD : BUILT_TRACK;
      for (let k = 1; k < road.points.length; k++) {
        for (const t of [0.25, 0.5, 0.75]) {
          const p = { x: lerp(abs(road.points[k - 1]).x, abs(road.points[k]).x, t), y: lerp(abs(road.points[k - 1]).y, abs(road.points[k]).y, t) };
          const onNewRoad = ROAD_INDEX.nearestWithin(p.x, p.y, REGION.roadWidth / 2) < REGION.roadWidth / 2;
          const built = baked.built[tileOf(baked.size, p)];
          // An earlier road keeps a tile where two cross.
          expect(onNewRoad || built === code || built === BUILT_OLD_ROAD || built === BUILT_TRACK, `road at ${p.x},${p.y}`).toBe(true);
          if (!onNewRoad && road === farm.roads[0]) expect(built, `old road at ${p.x},${p.y}`).toBe(BUILT_OLD_ROAD);
        }
      }
    }
  });

  it('marks the pads as concrete, the canals as canal and the blocks as field', () => {
    const at = (p: Vec) => baked.built[tileOf(baked.size, abs(p))];
    for (const pad of farm.pads) expect(at(pad.at)).toBe(BUILT_PAD);
    for (const canal of farm.canals) expect(at({ x: (canal.points[0].x + canal.points[1].x) / 2, y: (canal.points[0].y + canal.points[1].y) / 2 })).toBe(BUILT_CANAL);
    for (const block of farm.blocks) {
      const centre = frameOf(abs(block.at), block.turn);
      const inside = tilesWithin(baked.size, abs(block.at), Math.hypot(block.size.x, block.size.y) / 2).filter((tile) => {
        const f = frameOf({ x: (tile % baked.size) + 0.5, y: Math.floor(tile / baked.size) + 0.5 }, block.turn);
        return Math.abs(f.s - centre.s) <= block.size.x / 2 && Math.abs(f.c - centre.c) <= block.size.y / 2;
      });
      const field = inside.filter((tile) => baked.built[tile] === BUILT_FIELD);
      expect(field.length, `block at ${centre.s},${centre.c}`).toBeGreaterThanOrEqual(inside.length * 0.8);
    }
  });

  it('digs at least 14 canals, at least 300 tiles in all', () => {
    expect(farm.canals.length).toBeGreaterThanOrEqual(14);
    expect(baked.built.filter((b) => b === BUILT_CANAL).length).toBeGreaterThanOrEqual(300);
  });

  it('keeps everything drawn inside the outline, off roads, tracks, canals and cliffs, and clear of every spot', () => {
    for (const p of [...loose, ...trees, ...segments]) {
      const where = `${p.kind} at ${p.pos.x},${p.pos.y}`;
      expect(siteGap(orchard, p.pos), where).toBeLessThan(-p.r);
      if (!segments.includes(p)) for (const tile of footprint(baked, p)) expect([BUILT_OLD_ROAD, BUILT_TRACK, BUILT_CANAL, BUILT_PAD], where).not.toContain(baked.built[tile]);
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, REGION.roadWidth / 2 + p.r), where).toBe(Infinity);
      expect(tileSteepness(baked.heights, baked.size, tileOf(baked.size, p.pos)), where).toBeLessThanOrEqual(TERRAIN.drive.maxSlope);
    }
    // Loose pieces and trees keep the debris gap from every spot's edge, so a truck can park beside one.
    for (const p of [...loose, ...trees]) {
      for (const spot of spots) expect(dist(p.pos, spot.pos), `${p.kind} at ${p.pos.x},${p.pos.y} by ${spot.kind}`).toBeGreaterThanOrEqual(spot.r + p.r + rules.debrisGap);
    }
    // Run segments lie along their lines, so their ends are tested against roads, tracks and canals.
    for (const seg of segments) {
      // The ends are taken a hair inside, since a segment's end may meet a marked tile's edge exactly.
      for (const o of [-seg.r * 0.99, 0, seg.r * 0.99]) {
        const p = { x: seg.pos.x + Math.cos(seg.yaw) * o, y: seg.pos.y + Math.sin(seg.yaw) * o };
        expect([BUILT_OLD_ROAD, BUILT_TRACK, BUILT_CANAL, BUILT_PAD], `${seg.kind} at ${p.x},${p.y}`).not.toContain(baked.built[tileOf(baked.size, p)]);
      }
    }
  });

  it('plants 500 trees or more in blocks and strays, within the cap', () => {
    expect(trees.length).toBeGreaterThanOrEqual(500);
    expect(trees.length).toBeLessThanOrEqual(groves.maxTrees);
    // Every block holds trees in its rows. The bake itself throws on a block that keeps under groves.keep of the
    // trees it plans; the test below moves one onto bad ground.
    for (const block of farm.blocks) {
      const centre = frameOf(abs(block.at), block.turn);
      const mine = trees.map((t) => frameOf(t.pos, block.turn)).filter((f) => Math.abs(f.s - centre.s) <= block.size.x / 2 + groves.jitter && Math.abs(f.c - centre.c) <= block.size.y / 2 + groves.jitter);
      expect(mine.length, `block at ${centre.s},${centre.c}`).toBeGreaterThan(0);
    }
  });

  it('throws on a block whose ground rejects too many of its trees', () => {
    const moved = structuredClone(rules);
    // Over the old road and its canals, where no tree may stand.
    moved.farm!.blocks[0] = { at: onOrchardRoad(-15, 0), size: { x: 10, y: 6 }, rows: 'along', turn: 0 };
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, 1))).toThrow(/keeps/);
  });

  it('leaves a lane between rows wider than the widest truck under the tree crowns', () => {
    // The widest chassis is 0.8 tiles in radius; a lane keeps half a tile to spare.
    const lane = 2 * 0.8 + 0.5;
    for (const block of farm.blocks) {
      const yaw = ORCHARD_HEADING + block.turn;
      const across = block.rows === 'along' ? { x: Math.sin(yaw), y: -Math.cos(yaw) } : { x: Math.cos(yaw), y: Math.sin(yaw) };
      const rowOffset = (p: Vec) => (p.x - orchard.pos.x - block.at.x) * across.x + (p.y - orchard.pos.y - block.at.y) * across.y;
      const rowSpan = block.rows === 'along' ? block.size.y : block.size.x;
      const rows = Math.floor(rowSpan / groves.rowGap) + 1;
      // Each tree's low boxes, as an interval across the rows.
      const spans = trees
        .map((t) => ({ t, k: Math.round(rowOffset(t.pos) / groves.rowGap + (rows - 1) / 2) }))
        .filter(({ t, k }) => k >= 0 && k < rows && Math.abs(rowOffset(t.pos) - (k - (rows - 1) / 2) * groves.rowGap) < 1e-6)
        .map(({ t, k }) => {
          const low = propBoxes({ id: `tree-${t.pos.x}`, kind: 'landmark', look: 'deadTree', pos: t.pos, r: t.r, yaw: t.yaw }).filter((b) => b.z0 < PHYSICS.truckClearance);
          const ext = low.map((b) => Math.abs(b.axis.x * across.x + b.axis.y * across.y) * b.half.x + Math.abs(b.axis.y * across.x - b.axis.x * across.y) * b.half.y);
          const mids = low.map((b) => (b.center.x - orchard.pos.x - block.at.x) * across.x + (b.center.y - orchard.pos.y - block.at.y) * across.y);
          return { k, lo: Math.min(...mids.map((m, i) => m - ext[i])), hi: Math.max(...mids.map((m, i) => m + ext[i])) };
        });
      for (let k = 1; k < rows; k++) {
        const below = spans.filter((s) => s.k === k - 1);
        const above = spans.filter((s) => s.k === k);
        if (below.length === 0 || above.length === 0) continue;
        expect(Math.min(...above.map((s) => s.lo)) - Math.max(...below.map((s) => s.hi)), `block at ${block.at.x},${block.at.y} rows ${k - 1}-${k}`).toBeGreaterThanOrEqual(lane);
      }
    }
  });

  it('never stands three run or clutter pieces of one look in a straight line at one turn', () => {
    const turnOf = (yaw: number) => ((yaw % Math.PI) + Math.PI) % Math.PI;
    for (const look of new Set([...runRadius.keys(), ...clutterLooks])) {
      const all = props.filter((p) => p.kind === look);
      for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) for (let c = b + 1; c < all.length; c++) {
        const [p, q, r] = [all[a], all[b], all[c]];
        const sameTurn = [[p, q], [p, r], [q, r]].every(([u, v]) => Math.abs(angleDiff(turnOf(u.yaw) * 2, turnOf(v.yaw) * 2)) / 2 <= 0.02);
        if (!sameTurn) continue;
        const line = Math.min(...[[p, q, r], [p, r, q], [q, r, p]].map(([u, v, w]) => Math.abs((v.pos.x - u.pos.x) * (w.pos.y - u.pos.y) - (v.pos.y - u.pos.y) * (w.pos.x - u.pos.x)) / dist(u.pos, v.pos)));
        expect(line, `${look} at ${p.pos.x},${p.pos.y}, ${q.pos.x},${q.pos.y} and ${r.pos.x},${r.pos.y}`).toBeGreaterThan(0.1);
      }
    }
  });

  it('scatters clutter round the buildings it belongs to', () => {
    const pieces = loose.filter((p) => clutterLooks.has(p.kind) && !debrisLooks.has(p.kind));
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      const rule = farm.clutter.find((r) => r.look === p.kind)!;
      const near = spots.filter((s) => rule.near.includes(s.kind));
      const gap = Math.min(...near.map((s) => dist(p.pos, s.pos) - s.r - p.r));
      expect(gap, `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeLessThanOrEqual(rules.debrisGap + rule.reach + REGION.obstacles.gap + 1e-9);
    }
  });

  it('draws each fence and barrier segment at the size of its model', () => {
    for (const look of ['fence', 'barrier'] as const) {
      const pieces = segments.filter((p) => p.kind === look);
      expect(pieces.length, look).toBeGreaterThan(0);
      for (const p of pieces) {
        const pose = propPose({ id: `${look}-test`, pos: p.pos, r: p.r, kind: 'landmark', look, yaw: p.yaw });
        expect(pose.scale.x, `${look} at ${p.pos.x},${p.pos.y}`).toBeCloseTo(1, 6);
      }
    }
  });

  it('lets a truck drive from the spur road to the side of every orchard spot and to the outer end of each road', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const found = w.obstacles.filter((o) => isLootSpot(o) && siteGap(orchard, o.pos) < 0);
    expect(found.length).toBe(farm.buildings.reduce((n, b) => n + b.poses.length, 0));
    const reach = (o: (typeof found)[number]) => (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
    const [entry] = territoryEntries(orchard);
    for (const spot of found) {
      const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
      expect(dist(end, spot.pos), spot.id).toBeLessThanOrEqual(reach(spot));
    }
    for (const road of farm.roads.slice(0, MAIN_ROADS)) {
      const goal = abs(road.points.at(-1)!);
      const end = route(w, entry, goal, 0.6, []).at(-1)!;
      expect(dist(end, goal), `road end at ${goal.x},${goal.y}`).toBeLessThanOrEqual(1);
    }
  }, budget(120_000));

  it('throws on a building off the outline', () => {
    const moved = structuredClone(rules);
    moved.farm!.buildings[0].poses[0].at = onOrchardRoad(-30, 40);
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, 1))).toThrow(/outside/);
  });
});

describe('a third territory', () => {
  // A test-only wreck on open ground between Bowl and Kiln Camp, where no region road runs within 32 tiles and no site
  // within 40. It has no basin under it, so no rim rocks, and holds a piece, a building group, a cache, a patch, a dirt
  // road and fused glass.
  const flats: TerritoryDef = { id: 'test-flats', name: 'Test Flats', kind: 'territory', pos: { x: 200, y: 380 }, radius: 22, outline: null };
  function flatsRules(): TerritoryRules {
    return {
      seed: 2,
      wreck: {
        pieces: [{ look: 'hullDrum', at: { x: -9, y: -4 }, yaw: 0, r: 3 }],
        buildings: [{ look: 'barn', table: 'farmStores', turnJitter: 0.06, shift: 0.3, poses: [{ at: { x: 7, y: -7 }, r: 2.5, turn: 0, shoulder: false }] }],
        caches: [{ at: { x: 0, y: 9 } }],
        cacheLook: 'hullCache',
        cacheTable: 'landmark',
        cacheRadius: 0.7,
        patches: [{ at: { x: 9, y: 9 }, radius: 5, debris: [{ look: 'junk', count: 2, radius: [0.5, 0.8] }], spots: 1 }],
        spotLook: 'shipCache',
        spotTable: 'hullScrap',
        spotRadius: [0.6, 0.8],
        seatEase: 3,
        rimRocks: null,
        scree: null,
        roads: [{ points: [{ x: -20, y: 3 }, { x: 20, y: 3 }], width: 2.5, surface: 'track' }],
        spurs: [],
        spurFade: 5,
        decks: [],
        landing: 0,
      },
      farm: null,
      glass: { cell: 6, cover: [0.25, 0.55], clear: 1.5, spires: { look: 'hullShard', count: 4, radius: [0.8, 1.1] } },
      spotGap: 6,
      debrisGap: 1.5,
      reactor: null,
    };
  }

  // Bakes the territory layer with the test territory added to REGION and TERRITORIES, then takes it out again.
  function withFlats(rules: TerritoryRules, draft: () => MapDraft): MapDraft {
    REGION.locations.push(flats);
    TERRITORIES[flats.id] = rules;
    try {
      return territoryLayer(7, draft());
    } finally {
      REGION.locations.splice(REGION.locations.indexOf(flats), 1);
      delete TERRITORIES[flats.id];
    }
  }

  const outside = (p: Vec): boolean => siteGap(flats, p) >= 0;

  it('bakes the Fallen Sun and the orchard as without it (IV1)', () => {
    const without = territoryLayer(7, rollingDraft());

    const withIt = withFlats(flatsRules(), rollingDraft);

    expect(withIt.props.filter((p) => outside(p.pos))).toEqual(without.props);
    const tilesOutside = (d: MapDraft) => Array.from(d.built).filter((_, tile) => outside(tileCenter(d.size, tile)));
    expect(tilesOutside(withIt)).toEqual(tilesOutside(without));
  });

  it('bakes a wreck with no basin and no rim rocks, with its piece, building, cache, field spot and glass', () => {
    const d = withFlats(flatsRules(), rollingDraft);

    const inside = d.props.filter((p) => !outside(p.pos));
    const kinds = new Set(inside.map((p) => p.kind));
    for (const kind of ['hullDrum', 'barn', 'hullCache', 'shipCache', 'junk', 'hullShard']) expect(kinds.has(kind as BakedProp['kind']), kind).toBe(true);
    expect(kinds.has('rimRock')).toBe(false);
    expect(tilesWithin(d.size, flats.pos, flats.radius).some((tile) => d.built[tile] === BUILT_GLASS)).toBe(true);
  });

  it('keeps the field spots the spot gap from the buildings', () => {
    const rules = flatsRules();
    const d = withFlats(rules, rollingDraft);

    const [barn] = d.props.filter((p) => p.kind === 'barn' && !outside(p.pos));
    const spots = d.props.filter((p) => p.kind === 'shipCache' && !outside(p.pos));
    for (const s of spots) expect(dist(s.pos, barn.pos)).toBeGreaterThanOrEqual(rules.spotGap);
  });

  it('throws on a building that touches a piece (IV10)', () => {
    const rules = flatsRules();
    rules.wreck!.buildings[0].poses[0].at = { x: -9, y: -6 };

    expect(() => withFlats(rules, rollingDraft)).toThrow(/touches a wreck piece/);
  });
});

describe('Glass Flats on the baked map', () => {
  const flats = REGION.locations.find((l) => l.id === 'glass-flats')!;
  const gt = flats as never;
  const flatsRules = TERRITORIES['glass-flats'];
  const wreck = flatsRules.wreck!;
  const glass = flatsRules.glass!;
  const terrain = TEST_MAP.terrain;
  const flatsPieces = territoryPieces(gt);
  const props = TEST_MAP.props.filter((p) => siteGap(flats, p.pos) < 0);
  const isPiece = (p: BakedProp) => flatsPieces.some((q) => q.look === p.kind && dist(q.pos, p.pos) < 1e-3);
  const tileOfPoint = (c: Vec) => Math.floor(c.y) * terrain.size + Math.floor(c.x);
  const typeAt = (c: Vec) => terrain.types[tileOfPoint(c)];
  // Every tile centre inside the outline.
  const insideTiles: Vec[] = [];
  for (let y = Math.floor(flats.pos.y - flats.radius); y <= flats.pos.y + flats.radius; y++) {
    for (let x = Math.floor(flats.pos.x - flats.radius); x <= flats.pos.x + flats.radius; x++) if (siteGap(flats, { x: x + 0.5, y: y + 0.5 }) < 0) insideTiles.push({ x: x + 0.5, y: y + 0.5 });
  }
  // The tiles a circle overlaps, as the bake's mark test reads them.
  function touched(pos: Vec, r: number): Vec[] {
    const out: Vec[] = [];
    for (let y = Math.floor(pos.y - r); y <= Math.floor(pos.y + r); y++) {
      for (let x = Math.floor(pos.x - r); x <= Math.floor(pos.x + r); x++) {
        const near = { x: Math.min(Math.max(pos.x, x), x + 1), y: Math.min(Math.max(pos.y, y), y + 1) };
        if (dist(near, pos) < r || (x === Math.floor(pos.x) && y === Math.floor(pos.y))) out.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    return out;
  }
  const kept = () => {
    const looks = new Set<string>(wreck.buildings.map((b) => b.look));
    return props.filter((p) => isPiece(p) || p.kind === wreck.cacheLook || looks.has(p.kind));
  };

  it('bakes every authored piece, compound and cache', () => {
    for (const p of flatsPieces) expect(props.filter((o) => isPiece(o) && o.kind === p.look && dist(o.pos, p.pos) < 1e-3), `${p.look} at ${p.pos.x},${p.pos.y}`).toHaveLength(1);
    const poses = wreck.buildings.flatMap((b) => b.poses.map((pose) => ({ look: b.look, at: { x: flats.pos.x + pose.at.x, y: flats.pos.y + pose.at.y } })));
    for (const pose of poses) expect(props.filter((o) => o.kind === pose.look && dist(o.pos, pose.at) < 0.5), `${pose.look} at ${pose.at.x},${pose.at.y}`).toHaveLength(1);
    const caches = props.filter((o) => o.kind === wreck.cacheLook);
    expect(caches).toHaveLength(wreck.caches.length);
    for (const c of territoryCaches(gt)) expect(caches.filter((o) => dist(o.pos, c) < 1e-3), `cache at ${c.x},${c.y}`).toHaveLength(1);
  });

  it('gives each of its 19 loot spots one stock after world creation (IV5)', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && territoryAt(o.pos)?.id === 'glass-flats');
    expect(spots).toHaveLength(19);
    for (const o of spots) expect(w.salvage.filter((s) => s.id === o.id), o.id).toHaveLength(1);
    expect(w.salvage.filter((s) => territoryOfStock(s)?.id === 'glass-flats')).toHaveLength(19);
  });

  it('marks every dirt road and spur centreline tile as track, or road where a region road crosses it', () => {
    const { roads, spurs } = territoryRoads(gt);
    for (const road of [...roads, ...spurs]) {
      for (const p of along(road.points, 0.5)) expect(['track', 'road'], `${p.x.toFixed(1)},${p.y.toFixed(1)}`).toContain(typeAt(p));
    }
  });

  it("keeps every prop but the pieces off the dirt road, spur and region road tiles, and the pieces' low boxes off the roads (IV4)", () => {
    const { roads, spurs } = territoryRoads(gt);
    const web = [...roads, ...spurs];
    for (const p of props.filter((o) => !isPiece(o))) {
      const where = `${p.kind} at ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)}`;
      expect(touched(p.pos, p.r).filter((c) => ['track', 'road'].includes(typeAt(c))), where).toEqual([]);
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, REGION.roadWidth / 2 + p.r), where).toBe(Infinity);
    }
    flatsPieces.forEach((p, k) => {
      for (const b of lowBoxes(p, k)) for (const road of web) for (const q of along(road.points, 0.25)) expect(boxDistance(b, q), `${p.look} at ${q.x},${q.y}`).toBeGreaterThan(road.width / 2);
    });
  });

  it('stands every spire wholly on glass, keeps glass out of the yards round the pieces, compounds and caches, and no boulder on glass (IV4)', () => {
    const spires = props.filter((p) => p.kind === glass.spires.look);
    expect(spires).toHaveLength(glass.spires.count);
    for (const s of spires) for (const c of touched(s.pos, s.r)) expect(typeAt(c), `spire at ${s.pos.x.toFixed(1)},${s.pos.y.toFixed(1)}`).toBe('glass');
    const yards = kept();
    expect(yards.length).toBe(flatsPieces.length + wreck.caches.length + 11);
    for (const c of insideTiles.filter((p) => typeAt(p) === 'glass')) {
      for (const o of yards) expect(dist(o.pos, c), `glass at ${c.x},${c.y} by ${o.kind}`).toBeGreaterThan(o.r + glass.clear);
    }
    for (const rock of props.filter((p) => p.kind === 'rock')) for (const c of touched(rock.pos, rock.r)) expect(typeAt(c), `rock at ${rock.pos.x},${rock.pos.y}`).not.toBe('glass');
  });

  it('covers between a fifth and a half of its ground with glass', () => {
    const share = insideTiles.filter((p) => typeAt(p) === 'glass').length / insideTiles.length;
    expect(share).toBeGreaterThanOrEqual(0.2);
    expect(share).toBeLessThanOrEqual(0.5);
  });

  it('lets a truck drive from each road to the side of every loot spot, the cache in the nozzle mouth included (IV3)', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && siteGap(flats, o.pos) < 0);
    const nozzle = flatsPieces.find((p) => p.look === 'engineNozzle')!;
    const mouth = spots.find((o) => o.kind === 'landmark' && o.look === wreck.cacheLook && dist(o.pos, nozzle.pos) < nozzle.r);
    expect(mouth).toBeDefined();
    const reach = (o: (typeof spots)[number]) => (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
    const entries = territoryEntries(gt);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), `${spot.id} from ${entry.x},${entry.y}`).toBeLessThanOrEqual(reach(spot));
      }
    }
  }, 120_000);
});
