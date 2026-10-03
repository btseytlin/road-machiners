import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { PHYSICS } from '../data/physics';
import { ORCHARD_HEADING, REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { onOrchardRoad, TERRITORIES } from '../data/territory';
import { boxDistance, propBoxes, propPose, propReach } from '../sim/mapgen';
import { siteGap } from '../sim/sites';
import { route } from '../sim/path';
import { ROAD_INDEX } from '../sim/road-index';
import { hazardZones, isLootSpot, reactorPos, territoryAt, territoryEntries, territoryOfStock, territoryPieces, territoryTracks, type BakedPiece } from '../sim/territory';
import { groundAt, type BakedProp, type Terrain } from '../sim/terrain';
import { newWorld } from '../sim/world';
import { angleDiff, dist, lerp, polylineDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { newDraft, tileSteepness, type MapDraft } from './bake';
import { fillFarm } from './farm';
import { BUILT_CANAL, BUILT_PAD, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, ruleRng, tileOf, tilesWithin } from './oldworld';
import { territoryLayer } from './territory';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const t = fallenSun as never;
const rules = TERRITORIES['fallen-sun'].wreck!;
const reactor = TERRITORIES['fallen-sun'].reactor!;
const zone = hazardZones().find((z) => z.id === 'fallen-sun')!;
const pieces = territoryPieces(t);
const inside = TEST_MAP.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
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
    const ofSun = (props: readonly BakedProp[]) => props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
    expect(ofSun(full.props).length).toBeGreaterThan(0);
    expect(ofSun(full.props)).toEqual(ofSun(solo.props));
    expect(full.heights).toEqual(solo.heights);
  });

  it("levels the ground under every piece's low boxes to the height at its centre", () => {
    const before = rollingDraft();
    const ground = terrainOf(before.size, before.heights);
    const after = territoryLayer(7, rollingDraft());
    const w = before.size + 1;
    pieces.forEach((p, k) => {
      const centre = groundAt(ground, p.pos.x, p.pos.y);
      const corners = cornersUnder(p, k);
      expect(corners.length, p.look).toBeGreaterThan(0);
      for (const c of corners) expect(after.heights[c.y * w + c.x], `${p.look} ${c.x},${c.y}`).toBeCloseTo(centre, 6);
    });
    // Far from every piece the relief is untouched.
    const far = { x: Math.round(fallenSun.pos.x - 40), y: Math.round(fallenSun.pos.y - 30) };
    expect(after.heights[far.y * w + far.x]).toBe(before.heights[far.y * w + far.x]);
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
    expect(TEST_MAP.props.filter((p) => p.kind === 'rimRock')).toHaveLength(rules.rimRocks.count);
  });

  it('gives each cache and field spot one stock after world creation', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && territoryAt(o.pos)?.id === 'fallen-sun');
    expect(spots).toHaveLength(24);
    for (const o of spots) expect(w.salvage.filter((s) => s.id === o.id), o.id).toHaveLength(1);
    expect(w.salvage.filter((s) => territoryOfStock(s)?.id === 'fallen-sun')).toHaveLength(24);
  });

  it("keeps every drawn prop off the roads, the tracks, the pieces' boxes and the hazard", () => {
    const tracks = territoryTracks(t);
    const boxes = pieces.flatMap((p, k) => propBoxes({ id: `piece-${k}`, pos: p.pos, r: p.r, kind: 'landmark', look: p.look, yaw: p.yaw }));
    const drawn = drawnProps();
    expect(drawn.length).toBeGreaterThan(50);
    for (const p of drawn) {
      const reach = REGION.roadWidth / 2 + p.r;
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, reach), p.kind).toBe(Infinity);
      for (const track of tracks) expect(polylineDist(p.pos, track), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeGreaterThan(p.r);
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
    const spots = w.obstacles.filter((o) => isLootSpot(o) && dist(o.pos, fallenSun.pos) < fallenSun.radius);
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
  }, 120_000);

  it('throws on a building off the outline', () => {
    const moved = structuredClone(rules);
    moved.farm!.buildings[0].poses[0].at = onOrchardRoad(-30, 40);
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, 1))).toThrow(/outside/);
  });
});
