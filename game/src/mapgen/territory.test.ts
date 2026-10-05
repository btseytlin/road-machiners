import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../data/goods';
import { ORCHARD_HEADING, REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { MAPGEN, TERRAIN } from '../data/terrain';
import { onOrchardRoad, TERRITORIES } from '../data/territory';
import { bayPoints, deckAlongAt, deckPlane, hullDecks, isLootSpot, ribPoses, territoryEntries, type HullDeck } from '../sim/territory';
import { propBoxes, propPose, propReach } from '../sim/mapgen';
import { PHYSICS } from '../data/physics';
import { siteGap } from '../sim/sites';
import { route } from '../sim/path';
import { ROAD_INDEX } from '../sim/road-index';
import { groundAt, heightAt, isCliff, tileAt, type BakedProp, type Terrain } from '../sim/terrain';
import { newWorld } from '../sim/world';
import { angleDiff, dist, lerp, segmentDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { footprintRelief, groundForTerritories, newDraft, tileSteepness, type MapDraft } from './bake';
import { fillFarm, newRoadHold } from './farm';
import { BUILT_CANAL, BUILT_PAD, BUILT_TRACK } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, ruleRng, tileOf, tilesWithin } from './oldworld';
import { TERRITORY_SEED_OFFSET, territoryLayer } from './territory';

const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;

// The committed map's heights before the territory layer, baked once: the orchard grades its own ground, so the
// committed heights cannot stand in for them.
let groundHeights: Float32Array | undefined;
function territoryGround(): Float32Array {
  groundHeights ??= groundForTerritories(MAPGEN.seed).heights;
  return groundHeights;
}
const rules = TERRITORIES['fallen-sun'];
const hull = rules.hull!;
const decks = hullDecks().filter((d) => d.territory === 'fallen-sun');
const inside = TEST_MAP.props.filter((p) => dist(p.pos, fallenSun.pos) < fallenSun.radius);
const bayCount = hull.sections.reduce((n, s) => n + s.bays.length, 0);
const fieldCount = rules.spots.reduce((n, s) => n + s.count, 0);

// A draft over the whole region with rolling ground, so decks meet ground both below and above their plane.
function rollingDraft(): MapDraft {
  const d = newDraft(REGION.size);
  const w = d.size + 1;
  for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) d.heights[j * w + i] = 0.6 * Math.sin(i / 9) + 0.4 * Math.cos(j / 7);
  return d;
}

function terrainOf(size: number, heights: ArrayLike<number>): Terrain {
  return { size, heights: Array.from(heights), types: [] };
}

function pointAlong(deck: HullDeck, share: number): Vec {
  return { x: lerp(deck.low.x, deck.high.x, share), y: lerp(deck.low.y, deck.high.y, share) };
}

// Tiles from pos to the nearest point of the deck's footprint, 0 inside it.
function gapToDeck(deck: HullDeck, pos: Vec): number {
  const mid = pointAlong(deck, 0.5);
  const yaw = deck.section.yaw;
  const a = (pos.x - mid.x) * Math.cos(yaw) + (pos.y - mid.y) * Math.sin(yaw);
  const c = -(pos.x - mid.x) * Math.sin(yaw) + (pos.y - mid.y) * Math.cos(yaw);
  return Math.hypot(Math.max(0, Math.abs(a) - deck.section.length / 2), Math.max(0, Math.abs(c) - deck.section.width / 2));
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
    // The orchard grades its own ground, so heights are compared over the Fallen Sun's.
    const w = full.size + 1;
    const sunCorners = Array.from(full.heights.keys()).filter((k) => dist({ x: k % w, y: Math.floor(k / w) }, fallenSun.pos) < fallenSun.radius + 1);
    expect(sunCorners.map((k) => full.heights[k])).toEqual(sunCorners.map((k) => solo.heights[k]));
  });

  it('raises every corner on a deck to the higher of the ground and the deck plane, and leaves the rest alone', () => {
    const before = rollingDraft();
    const ground = terrainOf(before.size, before.heights);
    const after = territoryLayer(7, rollingDraft());
    const w = before.size + 1;
    const r = fallenSun.radius + 1;
    let onDeck = 0;
    let raised = 0;
    for (let j = Math.floor(fallenSun.pos.y - r); j <= fallenSun.pos.y + r; j++) {
      for (let i = Math.floor(fallenSun.pos.x - r); i <= fallenSun.pos.x + r; i++) {
        const k = j * w + i;
        const deck = decks.find((dk) => deckAlongAt(dk, { x: i, y: j }) !== null);
        if (!deck) {
          expect(after.heights[k], `${i},${j}`).toBe(before.heights[k]);
          continue;
        }
        const plane = deckPlane(deck, groundAt(ground, deck.low.x, deck.low.y), deckAlongAt(deck, { x: i, y: j })!);
        expect(after.heights[k], `${deck.section.id} ${i},${j}`).toBeCloseTo(Math.max(before.heights[k], plane), 5);
        onDeck++;
        if (after.heights[k] > before.heights[k]) raised++;
      }
    }
    expect(onDeck).toBeGreaterThan(100);
    expect(raised).toBeGreaterThan(onDeck / 2);
  });

  it('bakes the spot, debris, wall and reactor counts the data asks for', () => {
    for (const rule of [...rules.spots, ...rules.debris]) {
      expect(inside.filter((p) => p.kind === rule.look).length, rule.look).toBeGreaterThanOrEqual(rule.count);
    }
    expect(inside.filter((p) => p.kind === 'hullWall')).toHaveLength(hull.walls.length);
    expect(inside.filter((p) => p.kind === 'deckBay')).toHaveLength(bayCount);
    expect(inside.filter((p) => p.kind === rules.reactor!.look)).toHaveLength(1);
  });

  it('stands one deck bay prop at each bay and one rib at each rib pose', () => {
    const near = (kind: BakedProp['kind'], p: Vec) => TEST_MAP.props.filter((o) => o.kind === kind && dist(o.pos, p) < 1e-3);
    for (const deck of decks) {
      for (const bay of bayPoints(deck)) expect(near('deckBay', bay), deck.section.id).toHaveLength(1);
      for (const rib of ribPoses(deck)) {
        const [found] = near('hullRib', rib.pos);
        expect(found, deck.section.id).toBeDefined();
        expect(found.r).toBeCloseTo(rib.r, 5);
        expect(found.yaw).toBeCloseTo(rib.yaw, 5);
      }
    }
  });

  it('lays hull plating on every deck tile', () => {
    const t = TEST_MAP.terrain;
    for (const deck of decks) {
      for (let s = 0.05; s < 1; s += 0.1) expect(t.types[tileAt(t, pointAlong(deck, s))], `${deck.section.id} at ${s}`).toBe('hull');
    }
  });

  it('drops a deck side to the floor over a cliff where it stands high', () => {
    const t = TEST_MAP.terrain;
    let checked = 0;
    for (const deck of decks) {
      const across = { x: -Math.sin(deck.section.yaw), y: Math.cos(deck.section.yaw) };
      for (const side of [-1, 1]) {
        const top = pointAlong(deck, 0.9);
        const out = deck.section.width / 2 + 1.5;
        const floor = { x: top.x + across.x * out * side, y: top.y + across.y * out * side };
        if (heightAt(t, top.x, top.y) - heightAt(t, floor.x, floor.y) < 2 * TERRAIN.drive.maxSlope) continue;
        const edge = [-1, -0.5, 0, 0.5, 1].map((o) => deck.section.width / 2 + o).map((c) => tileAt(t, { x: top.x + across.x * c * side, y: top.y + across.y * c * side }));
        expect(edge.some((tile) => isCliff(t, tile)), `${deck.section.id} side ${side}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps every field spot and every piece of debris off the decks and the roads', () => {
    // Deck ribs share the hullRib kind with debris ribs, so they are told apart by their authored poses.
    const placed = inside.filter((p) => [...rules.spots, ...rules.debris].some((rule) => rule.look === p.kind));
    const authoredRibs = decks.flatMap((deck) => ribPoses(deck).map((rib) => rib.pos));
    const drawn = placed.filter((p) => !authoredRibs.some((q) => dist(p.pos, q) < 1e-3));
    expect(drawn.length).toBe(placed.length - authoredRibs.length);
    for (const p of drawn) {
      for (const deck of decks) expect(gapToDeck(deck, p.pos), `${p.kind} by ${deck.section.id}`).toBeGreaterThan(p.r);
      const reach = REGION.roadWidth / 2 + p.r;
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, reach), p.kind).toBe(Infinity);
    }
  });

  it('keeps every field spot apart and outside the hazard', () => {
    const spots = inside.filter((p) => rules.spots.some((s) => s.look === p.kind));
    spots.forEach((a, i) => {
      expect(dist(a.pos, fallenSun.pos), a.kind).toBeGreaterThan(rules.hazard!.radius + a.r);
      for (const b of spots.slice(i + 1)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(rules.spotGap);
    });
  });

  it('bakes the Fallen Sun props of the committed map, with no relief limit', () => {
    expect(rules.relief).toBeNull();
    const d = newDraft(REGION.size);
    d.heights.set(territoryGround());
    const drawn = territoryLayer(MAPGEN.seed, d).props.filter((p) => siteGap(fallenSun, p.pos) < 0);
    const committed = inside.filter((p) => siteGap(fallenSun, p.pos) < 0 && p.kind !== 'rock' && p.kind !== 'crag');
    expect(drawn.length).toBe(committed.length);
    drawn.forEach((p, i) => {
      expect(p.kind).toBe(committed[i].kind);
      expect(p.pos.x).toBeCloseTo(committed[i].pos.x, 3);
      expect(p.pos.y).toBeCloseTo(committed[i].pos.y, 3);
      expect(p.r).toBeCloseTo(committed[i].r, 3);
    });
  });

  it('enters the Fallen Sun by three roads', () => {
    expect(territoryEntries(fallenSun as never)).toHaveLength(3);
  });

  it('lets a truck drive from each approach road up every deck and to the side of every spot', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    const spots = w.obstacles.filter((o) => isLootSpot(o) && dist(o.pos, fallenSun.pos) < fallenSun.radius);
    expect(spots.length).toBe(fieldCount + bayCount);
    const reach = (o: (typeof spots)[number]) => (propReach(o) + ECONOMY.useRange) * ECONOMY.interactionScale;
    for (const entry of territoryEntries(fallenSun as never)) {
      // The truck gets up onto the top quarter of each deck, short of the drop at its high end.
      for (const deck of decks) {
        const end = route(w, entry, pointAlong(deck, 1 - 1.5 / deck.section.length), 0.6, []).at(-1)!;
        expect(deckAlongAt(deck, end), `${deck.section.id} from ${entry.x},${entry.y}`).toBeGreaterThanOrEqual(0.75);
      }
      for (const spot of spots) {
        const end = route(w, entry, spot.pos, 0.6, []).at(-1)!;
        expect(dist(end, spot.pos), spot.id).toBeLessThanOrEqual(reach(spot));
      }
    }
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

  // A draft over the region with the map's heights before the territory layer, so the farm bakes on the orchard's real
  // basin and ridges. Marks and props start empty, as no earlier layer marks or builds inside a territory.
  function groundDraft(): MapDraft {
    const d = newDraft(REGION.size);
    d.heights.set(territoryGround());
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
  const spots = props.filter((p) => buildingLooks.has(p.kind) || rules.spots.some((rule) => rule.look === p.kind));
  // Clutter shares looks with runs, so a clutter piece is told by its footprint: every run segment is half its
  // segment long.
  const runRadius = new Map(farm.runs.map((run) => [run.look, run.segment / 2]));
  const clutterLooks = new Set(farm.clutter.map((rule) => rule.look));
  const debrisLooks = new Set(rules.debris.map((rule) => rule.look));
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
    // The orchard's own draws, so every building stands where the bake puts it and the block is what fails.
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, TERRITORY_SEED_OFFSET + rules.seed))).toThrow(/keeps/);
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
    expect(found.length).toBe(farm.buildings.reduce((n, b) => n + b.poses.length, 0) + rules.spots.reduce((n, s) => n + s.count, 0));
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

  it('grades each farm road so its centre line holds its grade', () => {
    const t = terrainOf(baked.size, baked.heights);
    // Near a road of today's world the farm grading fades out, so that road keeps its own grade. Where a farm road
    // meets one, the stretch in the fade blends graded and ungraded ground and may climb to this junction limit.
    const JUNCTION_LIMIT = 0.15;
    const inFade = (p: Vec) => [[0, 0], [1, 0], [0, 1], [1, 1]].some(([i, j]) => newRoadHold({ x: Math.floor(p.x) + i, y: Math.floor(p.y) + j }) > 0);
    for (const road of farm.roads) {
      const points = road.points.map(abs);
      for (let k = 1; k < points.length; k++) {
        const steps = Math.ceil(dist(points[k - 1], points[k]) / 0.5);
        for (let i = 1; i <= steps; i++) {
          const [a, b] = [lerp(0, 1, (i - 1) / steps), lerp(0, 1, i / steps)];
          const p = { x: lerp(points[k - 1].x, points[k].x, a), y: lerp(points[k - 1].y, points[k].y, a) };
          const q = { x: lerp(points[k - 1].x, points[k].x, b), y: lerp(points[k - 1].y, points[k].y, b) };
          const grade = Math.abs(groundAt(t, q.x, q.y) - groundAt(t, p.x, p.y)) / dist(p, q);
          const limit = [p, q].some(inFade) ? JUNCTION_LIMIT : road.grade + 0.01;
          expect(grade, `${road.surface} at ${frameOf(p).s.toFixed(1)},${frameOf(p).c.toFixed(1)}`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it('keeps the surface of every farm road under the cliff slope, though its cuttings may be cliffs', () => {
    for (const road of farm.roads) {
      const points = road.points.map(abs);
      for (let k = 1; k < points.length; k++) {
        const mid = { x: (points[k - 1].x + points[k].x) / 2, y: (points[k - 1].y + points[k].y) / 2 };
        for (const tile of tilesWithin(baked.size, mid, dist(points[k - 1], points[k]) / 2 + road.width)) {
          const c = { x: (tile % baked.size) + 0.5, y: Math.floor(tile / baked.size) + 0.5 };
          if (segmentDist(c, points[k - 1], points[k]) > road.width / 2 || siteGap(orchard, c) >= 0) continue;
          expect(tileSteepness(baked.heights, baked.size, tile), `${road.surface} at ${frameOf(c).s.toFixed(1)},${frameOf(c).c.toFixed(1)}`).toBeLessThanOrEqual(TERRAIN.drive.maxSlope);
        }
      }
    }
  });

  it('levels the ground under every building within the relief limit', () => {
    const buildings = props.filter((p) => buildingLooks.has(p.kind));
    expect(buildings).toHaveLength(farm.buildings.reduce((n, b) => n + b.poses.length, 0));
    for (const p of buildings) expect(footprintRelief(baked.heights, baked.size, p, false), `${p.kind} at ${frameOf(p.pos).s.toFixed(1)},${frameOf(p.pos).c.toFixed(1)}`).toBeLessThanOrEqual(rules.relief!);
  });

  it('keeps run and clutter pieces off ground that lies off their seat past the relief limit', () => {
    for (const p of [...loose.filter((q) => clutterLooks.has(q.kind)), ...segments]) {
      expect(footprintRelief(baked.heights, baked.size, p, segments.includes(p)), `${p.kind} at ${p.pos.x},${p.pos.y}`).toBeLessThanOrEqual(rules.relief!);
    }
  });

  it('throws on a building whose ring cannot level its ground', () => {
    const moved = structuredClone(rules);
    // The depot hangar's first pose, on the slope where its pad cut a cliff.
    moved.farm!.buildings.find((b) => b.look === 'quonset')!.poses[3].at = onOrchardRoad(51, -33);
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, 1))).toThrow(/levels its ground into a cliff/);
  });

  it('throws on a building off the outline', () => {
    const moved = structuredClone(rules);
    moved.farm!.buildings[0].poses[0].at = onOrchardRoad(-30, 40);
    expect(() => fillFarm(groundDraft(), orchard, moved, moved.farm!, ruleRng(7, 1))).toThrow(/outside/);
  });
});
