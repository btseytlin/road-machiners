// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.
//
// The Fallen Sun is laid out from the committee's level concept (issue 81), an isometric painting close to the game
// camera. Positions are measured in its pixels and converted to tiles from the crater centre (map +x east, +y south):
// dx = px - 510, du = (283 - py) / 0.53, k = 50 / 485 tiles per pixel, tiles = k * ((dx - du) / √2, (-dx - du) / √2).
// The concept's foreground is stretched, so points past 32 tiles ease in toward 43 tiles. Each comment names the
// concept pixels; a departure from them says why.

import type { PropKind } from '../sim/terrain';
import type { LandmarkLook } from '../sim/types';
import type { Vec } from '../sim/vec';
import { onOrchardRoad } from './region';

export { onOrchardRoad };

export type SpotTable = 'landmark' | 'hullScrap' | 'roadWreck' | 'farmStores' | 'armyStores';
export type Hazard = {
  radius: number; // tiles around the reactor
  healthPerTurn: number;
  floor: number; // driver health the hazard never takes anyone below
};
// One authored wreck piece. r is its placement radius in tiles: the model scales evenly from its reference radius
// to r, so r is half the piece's length along its yaw for the long hull pieces.
export type HullPiece = { look: LandmarkLook; at: Vec; yaw: number; r: number };
export type Cache = { at: Vec };
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
// A circle of drawn filler: debris and field spots picked inside it from the map seed.
export type Patch = { at: Vec; radius: number; debris: DebrisRule[]; spots: number };
// Rim rocks, chunks of crater wall drawn on an arc of the crater bank. Bearings in radians from map +x toward +y, distances in tiles.
export type RimRocks = { from: number; to: number; radius: [number, number]; count: number; size: [number, number] };
// A twin-rut dirt track on the crater floor, a polyline in tiles from the centre. It is only drawn.
export type Ruts = Vec[];
// The reactor prop. Its position is also the hazard's centre.
export type Reactor = { look: PropKind; at: Vec; radius: number; hazard: Hazard | null };
// An authored farm laid out in its road's frame. Every at and point is tiles from the territory centre, written as
// onOrchardRoad(s, c); every turn is radians from the road's heading; every size is tiles along and across the road.
// Authored parts must lie inside the territory's outline. Each group's comment says who put it there and why.
export type FarmRules = {
  // The old road the farm lies along, in tiles from the centre; band is the tiles to each side of it where debris is
  // drawn.
  spine: { from: Vec; to: Vec; band: number };
  debris: DebrisRule[]; // drawn in the band
  grounds: [number, number]; // inner and outer share of spine.band where raiders and vultures wait beside the spine
  roads: FarmRoad[]; // the old asphalt road, the dirt roads and the narrow tracks, marked in list order
  buildings: BuildingGroup[];
  pads: Pad[]; // concrete ground
  canals: Track[]; // blue-grey irrigation canals
  groves: GroveRule;
  blocks: GroveBlock[];
  runs: Run[];
  clutter: ClutterRule[];
};
// A polyline of road, width in tiles. An oldRoad is cracked asphalt; a track is pale packed dirt.
export type FarmRoad = { points: Vec[]; width: number; surface: 'oldRoad' | 'track' };
// Loot spots of one look, all rolling one table. shoulder lets a pose touch the old road. Each pose turns by up to
// turnJitter radians and shifts by up to shift tiles each way, drawn from the territory's seed.
export type BuildingGroup = {
  look: PropKind;
  table: SpotTable;
  turnJitter: number;
  shift: number;
  poses: { at: Vec; r: number; turn: number; shoulder: boolean }[];
};
export type Pad = { at: Vec; size: Vec; turn: number };
export type Track = { points: Vec[]; width: number }; // a polyline, width in tiles
// How trees stand in every grove block.
export type GroveRule = {
  look: PropKind;
  rowGap: number; // tiles between rows
  treeGap: number; // tiles between trees in a row
  jitter: number; // tiles a tree may stray from its grid point
  missing: number; // share of grid points left empty
  radius: number; // tiles, a tree's footprint
  maxTrees: number;
  keep: number; // share of a block's planned trees, its grid points not left empty, that must stand, or the bake throws
  strays: number; // single trees drawn on open field between the blocks, so groves fray at their edges
};
// at is the middle; rows run along or across the block, which turns turn radians off the road's frame.
export type GroveBlock = { at: Vec; size: Vec; rows: 'along' | 'across'; turn: number };
// Segment props segment tiles long along a polyline. A share broken of the segments is gone, each left segment turns
// by up to jitter.turn radians and shifts by up to jitter.shift tiles, and segments on roads, tracks or canals drop.
export type Run = { look: PropKind; points: Vec[]; segment: number; broken: number; jitter: { turn: number; shift: number } };
// Loose pieces of one look, count of them, each beside a random building of a look in near, from the debris gap past
// its footprint to reach tiles further out, at a random turn. radius is the piece's footprint in tiles.
export type ClutterRule = { look: PropKind; count: number; radius: [number, number]; near: PropKind[]; reach: number };
// A wrecked ship's crater: authored hull pieces and caches, and filler drawn in patches.
export type WreckRules = {
  pieces: HullPiece[];
  caches: Cache[]; // rich loot spots, mostly inside or beside pieces
  cacheLook: PropKind;
  cacheTable: SpotTable; // the SALVAGE table a cache rolls
  cacheRadius: number; // tiles, a cache's footprint
  patches: Patch[];
  spotLook: PropKind; // the prop kind of a field spot drawn in a patch
  spotTable: SpotTable;
  spotRadius: [number, number]; // tiles, a field spot's footprint
  seatEase: number; // tiles over which the ground levelled under a piece eases back to the crater relief
  rimRocks: RimRocks;
  scree: { at: Vec; radius: number } | null; // tiles from the centre; the ground there is painted red-brown scree
  tracks: Ruts[];
};
// A territory is a wreck or a farm.
export type TerritoryRules = {
  seed: number; // offset of the territory's own draws, so adding a territory shifts no other's
  wreck: WreckRules | null;
  farm: FarmRules | null;
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  reactor: Reactor | null;
};

const DEG = Math.PI / 180;

// Debris of the dense field in the concept's lower half: plates, wrecked trucks, junk piles and girders.
const DENSE: DebrisRule[] = [
  { look: 'hullChunk', count: 4, radius: [1, 1.6] },
  { look: 'hullGantry', count: 1, radius: [0.8, 1.1] },
  { look: 'carWreck', count: 3, radius: [0.6, 0.8] },
  { look: 'junk', count: 4, radius: [0.5, 0.8] },
];
// The sparse scatter of the concept's upper half.
const LIGHT: DebrisRule[] = [
  { look: 'hullChunk', count: 2, radius: [1, 1.6] },
  { look: 'carWreck', count: 1, radius: [0.6, 0.8] },
];

const ALONG = 0; // a turn that keeps a building's front along the road, toward its north end
const ACROSS = Math.PI / 2; // a turn that sets a building's front across the road, toward map east: the road for a building on its west side
const AT = onOrchardRoad; // short for the many authored points below
const pose = (s: number, c: number, r: number, turn: number) => ({ at: onOrchardRoad(s, c), r, turn, shoulder: false });
// Fences around the grove blocks: old wood, a third of it fallen, every post leaning its own way.
const FENCE = { look: 'fence' as const, segment: 1, broken: 0.3, jitter: { turn: 0.12, shift: 0.15 } };
// Concrete road barriers the army dragged into place: a third gone, each one shoved askew.
const BARRIER = { look: 'barrier' as const, segment: 1, broken: 0.35, jitter: { turn: 0.25, shift: 0.3 } };
// The sandbag L a guard built at a post: a front of bags 2 tiles out toward its road, which lies in the direction
// (ds, dc), and a leg round the corner back along the post's side, clear of its hut. The post stands at (s, c).
function sandbagL(s: number, c: number, ds: number, dc: number): Run {
  const [fs, fc] = [s + ds * 2, c + dc * 2];
  const [ps, pc] = [-dc * 1.8, ds * 1.8];
  return {
    look: 'sandbags',
    points: [AT(fs - ps, fc - pc), AT(fs + ps, fc + pc), AT(fs + ps - ds * 2, fc + pc - dc * 2)],
    segment: 1,
    broken: 0,
    jitter: { turn: 0.2, shift: 0.1 },
  };
}
// A grove block over s0..s1 along the road and c0..c1 across it.
function block(s0: number, s1: number, c0: number, c1: number, rows: GroveBlock['rows'], turn: number): GroveBlock {
  return { at: AT((s0 + s1) / 2, (c0 + c1) / 2), size: { x: s1 - s0, y: Math.abs(c1 - c0) }, rows, turn };
}

export const TERRITORIES: Record<string, TerritoryRules> = {
  'fallen-sun': {
    seed: 0,
    wreck: {
      pieces: [
        // The ship line, from the lower-left of the centre to the upper right.
        // Bow: aft break (655,325) to nose (905,215), 9 tiles across, moved 1.5 tiles toward its nose so the hub's spine
        // stops short of its aft break. The nose lies against the north rim.
        { look: 'shipBow', at: { x: 18, y: -22.9 }, yaw: -1.481, r: 16.5 },
        // Hub with its ring: (495,285), 12 tiles across. Its spine stub points at the bow's aft break.
        { look: 'shipHub', at: { x: -0.8, y: 1.4 }, yaw: -0.356, r: 6 },
        // Ribcage tube: south end (300,430) to north end (465,335), axis north to south. A 3-tile gap to the hub lets
        // trucks leave its north end.
        { look: 'shipCage', at: { x: 4.4, y: 22.9 }, yaw: -1.61, r: 12.5 },
        // Upright shards along the spine: (578,250); and (652,400), moved 10 tiles in along the spine to (17,1.5)
        // because the south-east drum, pulled in from the stretched foreground, took its place.
        { look: 'hullShard', at: { x: 0.4, y: -9.5 }, yaw: 0.9, r: 1.6 },
        { look: 'hullShard', at: { x: 17, y: 1.5 }, yaw: 2.4, r: 1.6 },
        // Arch shells left of the hub: A (275,222)-(385,228); B (400,212)-(472,214), moved 2 tiles along its axis and 2 north so
        // a truck fits between the two. Both turn 25° toward east, so their dark open ends face the camera as in the
        // concept's perspective.
        { look: 'hullShell', at: { x: -21.1, y: 5.1 }, yaw: -0.2, r: 6 },
        { look: 'hullShell', at: { x: -13.8, y: -7.9 }, yaw: -0.3, r: 4 },
        // Top centre: the tilted tower slab (548,168) and the lattice gantry (445,112)-(512,158), moved 1.5 tiles west
        // off the tower.
        { look: 'hullTower', at: { x: -13, y: -18.6 }, yaw: -0.785, r: 1.6 },
        { look: 'hullGantry', at: { x: -24, y: -18.5 }, yaw: 0.133, r: 5.5 },
        // Huts: the collapsed hut (385,160), moved 4 tiles north-west off the track, and two small huts by the tower (598,140) and (622,132). The shed (258,318).
        { look: 'shack', at: { x: -29, y: -10.5 }, yaw: 0.4, r: 2 },
        { look: 'shack', at: { x: -13.3, y: -26.1 }, yaw: -0.8, r: 1.2 },
        { look: 'shack', at: { x: -12.6, y: -28.9 }, yaw: -0.6, r: 1.2 },
        { look: 'shack', at: { x: -13.6, y: 23.2 }, yaw: 0.6, r: 2.5 },
        // Drums: sunk in the north-east wall (690,130)-(755,70); small at the right (918,285), moved 4 tiles out of the
        // hazard; large at the lower right (765,455)-(955,505), 16 tiles long and moved 6 tiles in from
        // (39,1.2) so it stays inside the territory.
        { look: 'hullDrum', at: { x: -8.7, y: -36.6 }, yaw: -1.834, r: 5 },
        { look: 'hullDrum', at: { x: 31.5, y: -28.5 }, yaw: 0.3, r: 2.5 },
        { look: 'hullDrum', at: { x: 33, y: 5 }, yaw: -0.325, r: 8 },
        // Shard clusters: bottom centre (505,545), moved 2 tiles off the south-east road's end; far left (95,400); and
        // right (885,385), moved 7 tiles north to (36.5,-19), past the east road's end.
        { look: 'hullShard', at: { x: 27.5, y: 30.5 }, yaw: 0.4, r: 3.5 },
        { look: 'hullShard', at: { x: -11.9, y: 38.7 }, yaw: 2.1, r: 3.5 },
        { look: 'hullShard', at: { x: 36.5, y: -19 }, yaw: -1, r: 3.5 },
      ],
      // Inside hull pieces sight is short and an ambush waits at the open ends, so the rich loot lies there.
      caches: [
        // Inside the cage (330,410) and (420,360), moved toward its middle and against its east wall, where the lane
        // between the ribs stays widest beside them.
        { at: { x: 5.9, y: 26.9 } },
        { at: { x: 5.6, y: 20.9 } },
        { at: { x: -21.1, y: 5.1 } }, // inside shell A (325,222)
        { at: { x: -13.8, y: -7.9 } }, // inside shell B (440,215)
        { at: { x: -9.5, y: -1 } }, // west of the hub; the concept's (525,300) lies inside the hub
        { at: { x: 19.5, y: -2.5 } }, // past the spine's end at the bow's aft break, outside the hazard (590,320)
        { at: { x: -10.5, y: -22 } }, // behind the tower (560,185)
        { at: { x: 30.8, y: 11 } }, // on the south side of the south-east drum (760,470)
        { at: { x: 10.2, y: 2.1 } }, // beside the spine (590,320)
      ],
      cacheLook: 'hullCache',
      // Caches roll the rich landmark table, the whole site's stock before territories.
      cacheTable: 'landmark',
      // A cache is a stack of crates the size of a field spot, small enough that a truck drives round it inside a hull.
      cacheRadius: 0.7,
      patches: [
        // The dense field of the concept's lower half.
        { at: { x: -6.5, y: 32.4 }, radius: 10, debris: DENSE, spots: 3 }, // west of the cage (180,400)
        { at: { x: 14, y: 30 }, radius: 9, debris: DENSE, spots: 2 }, // the bottom centre (400,480)
        { at: { x: 21, y: 21 }, radius: 8.5, debris: DENSE, spots: 2 }, // the lower right (512,445)
        { at: { x: 34, y: 16 }, radius: 7, debris: LIGHT, spots: 2 }, // south of the large drum (633,465)
        { at: { x: -24, y: 29 }, radius: 7, debris: LIGHT, spots: 2 }, // the lower left (146,301)
        // The sparse scatter of the upper half.
        { at: { x: 28, y: -11 }, radius: 6, debris: LIGHT, spots: 1 }, // below the bow (777,345)
        { at: { x: -6.4, y: -13.7 }, radius: 7, debris: LIGHT, spots: 1 }, // the top centre (560,210)
        { at: { x: 2, y: -27 }, radius: 7, debris: LIGHT, spots: 0 }, // below the north-east drum (709,192)
        // The west scree (180,200): pale plate fragments.
        { at: { x: -31.9, y: 11.3 }, radius: 9, debris: [{ look: 'hullChunk', count: 12, radius: [0.5, 1] }], spots: 2 },
      ],
      spotLook: 'shipCache',
      // Field spots roll a scrap-heavy table at road-wreck size. With the 9 caches the Fallen Sun keeps 24 spots.
      spotTable: 'hullScrap',
      spotRadius: [0.6, 0.8],
      seatEase: 3,
      // Rock walls along the north rim: the concept's grey crags run from (620,40) to (1000,330), bearings -111° to
      // -41°, and its red-brown hills on the north-west rim from (200,100) to (480,60), bearings -164° to -138°. Their
      // feet stand 37 to 45 tiles out, as at (700,120) and (950,300), so the walls close the crater floor in.
      rimRocks: { from: -170 * DEG, to: -35 * DEG, radius: [40, 46], count: 28, size: [2.5, 4] },
      // The red-brown scree slope of the concept's upper left, from (100,250) to (300,110).
      scree: { at: { x: -38, y: 6 }, radius: 16 },
      // Twin-rut tracks traced from the concept, bent round the pieces. Each starts or ends at a road end or another
      // track.
      tracks: [
        // From the west road's end north of the shells to the tower and huts: (150,185) (260,172) (395,182) (610,160)
        [{ x: -38.5, y: 9.6 }, { x: -34.3, y: 8 }, { x: -32, y: 2 }, { x: -28, y: -4 }, { x: -23, y: -10 }, { x: -17, y: -12.5 }, { x: -10.5, y: -13.5 }, { x: -7.5, y: -18 }, { x: -8, y: -24 }],
        // Down the west side past the shed to the cage's south end: (205,190) (175,265) (230,335) (330,385)
        [{ x: -34.3, y: 8 }, { x: -31.9, y: 14.8 }, { x: -26.7, y: 21.7 }, { x: -21, y: 25.7 }, { x: -13.3, y: 28.5 }, { x: -6, y: 31 }, { x: 0, y: 36 }, { x: 4.8, y: 37.5 }],
        // Under the shells to the hub: (175,265) (320,262) (450,250)
        [{ x: -26.7, y: 21.7 }, { x: -22.8, y: 16.5 }, { x: -16.7, y: 11 }, { x: -10, y: 7.5 }],
        // A loop round the shed: (330,262) (340,300) (290,345)
        [{ x: -16.7, y: 11 }, { x: -10.5, y: 14.5 }, { x: -8, y: 19 }, { x: -8.5, y: 25 }, { x: -13.3, y: 28.5 }],
        // From the cage's south end to the south-east road's end: (390,395) (500,450) (590,520)
        [{ x: 4.8, y: 37.5 }, { x: 10, y: 39 }, { x: 17, y: 37.5 }, { x: 22.5, y: 32 }, { x: 25, y: 26 }, { x: 31.9, y: 24.1 }],
        // North past the south-east drum and the spine's end to the east road's end: (680,420) (800,380) (985,425)
        [{ x: 31.9, y: 24.1 }, { x: 29, y: 17 }, { x: 24, y: 12 }, { x: 22, y: 4 }, { x: 27, y: -4 }, { x: 33, y: -8 }, { x: 38.5, y: -11 }],
        // Between the hub and the cage's north end to the spine: (600,300) (700,360)
        [{ x: 22, y: 4 }, { x: 13, y: 5.5 }, { x: 7, y: 8.8 }, { x: 0, y: 9.3 }, { x: -5, y: 9 }, { x: -10, y: 7.5 }],
        // Along the bow's south flank toward the small drum: (850,345) (935,300)
        [{ x: 33, y: -8 }, { x: 32, y: -15 }, { x: 31.5, y: -21 }],
        // North of the hub from the tower to the bow's aft break
        [{ x: -10.5, y: -13.5 }, { x: -4, y: -12.5 }, { x: 4, y: -12 }, { x: 10, y: -9.5 }],
      ],
    },
    farm: null,
    spotGap: 6,
    debrisGap: 1.5,
    // The core glows in the breach on the bow's near flank (800,278). It stands where the bow model's breach is, 10 m
    // forward of the bow's centre and 5 m toward that flank, 2 tiles from the concept point.
    reactor: {
      look: 'reactor',
      at: { x: 19.4, y: -25.3 },
      radius: 1.5,
      hazard: {
        radius: 8,
        // The starving rule (RULES.starveDamage 5 per turn, floor RULES.starveFloor 30) anchors both numbers: it is the
        // one other non-combat health drain, and it never kills by itself.
        healthPerTurn: 5,
        floor: 30,
      },
    },
  },
  orchard: {
    seed: 1,
    wreck: null,
    farm: {
      // The old road through the basin. Debris is drawn along it, and raiders wait beside it.
      spine: { from: AT(-30, 0), to: AT(44, 0), band: 30 },
      // Debris along the road band: loose junk and old car wrecks scavengers stripped and pushed off the roads.
      debris: [
        { look: 'junk', count: 5, radius: [0.8, 1.2] },
        { look: 'carWreck', count: 4, radius: [0.6, 0.8] },
      ],
      // Beside the old road, between it and the groves' outer rows.
      grounds: [0.3, 1],
      // Read with docs/concepts/old-orchard-issue-111.jpg: s runs up the old road from the crossroads, c across it
      // toward the map's west, the image's up. Positions are the concept's, stretched about 1.3, then fitted to the
      // basin: the west ridge closes it at c 34, the north ridge stands at s 26-37 west of the road, the north-west
      // pocket lies at s 38-72, c 12-42, and the north-east ground at s 38-56 east of the road.
      roads: [
        // R1, the old highway: straight up the basin from the spur's end, then through the gap between the north
        // ridge's cliffs at c 3-4 and 9-11 (s 48-56) and out of the north edge.
        { points: [AT(-32, 0), AT(46, 0), AT(52, 6), AT(58, 6.5), AT(72, 7.5)], width: 3, surface: 'oldRoad' },
        // R2, the crossroad: the concept's curving main dirt road, from the farmhouse yard over the highway, round the
        // blockhouse's west and south sides and out of the east edge beside the trunk road, where trucks drive on
        // and off it.
        { points: [AT(6, 18), AT(4, 9), AT(1, -3), AT(-6, -6), AT(-8, -11), AT(-8, -15), AT(-3, -20), AT(4, -21), AT(4, -31.9)], width: 3, surface: 'track' },
        // R3, the south-west road: past the motor pool and the barn, down the west side and out of the south edge
        // toward the old asphalt road at map (100, 326).
        { points: [AT(-6, 1.5), AT(-10, 9), AT(-13, 21), AT(-22, 25), AT(-30, 22), AT(-35.4, 14)], width: 3, surface: 'track' },
        // R4, the depot road: from the highway at s 20 along the hangars' south and east sides, through the
        // north-east ground and out of the east edge beside the trunk road.
        { points: [AT(20, -1.5), AT(19, -10), AT(21, -31), AT(40, -33), AT(47, -41)], width: 3, surface: 'track' },
        // R5, the north field road: from the highway west through the north-west pocket, out of its west edge.
        { points: [AT(60, 6.6), AT(61, 22), AT(59, 40.6)], width: 2.5, surface: 'track' },
        // Narrow tracks the farmhands and the army wore: from the farmhouse yard into the north-west groves, and
        // from the depot road to the depot hangar.
        { points: [AT(6, 18), AT(10.75, 22), AT(10.75, 31)], width: 2, surface: 'track' },
        { points: [AT(40, -33), AT(45.5, -33)], width: 2, surface: 'track' },
      ],
      buildings: [
        // The ruined two-storey farmhouse above the road at the middle, its long side and yard toward the road. The
        // farmer built it square to the road; the ruin has settled a little.
        { look: 'farmhouse', table: 'landmark', turnJitter: 0.06, shift: 0.3, poses: [pose(12, 14, 4, ACROSS)] },
        // The gabled barn far left above the road and its shed beside it, door gables to the road, and the old
        // barn of the north-west pocket's fields.
        { look: 'barn', table: 'farmStores', turnJitter: 0.06, shift: 0.3, poses: [pose(-12, 29.5, 3.7, ACROSS), pose(-6, 30.5, 2.2, ACROSS), pose(53.5, 35, 3.7, ALONG)] },
        // The army's hangars: three side by side on packed dirt right of centre, ends to the road, and one at the
        // north-east depot.
        { look: 'quonset', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(26, -12, 3.2, ACROSS), pose(30, -19, 3.2, ACROSS), pose(34, -26, 3.2, ACROSS), pose(51, -33, 3.2, ALONG)] },
        // The sandbagged blockhouse below the road, commanding the crossroads.
        { look: 'bunker', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(0, -10, 3.9, ALONG)] },
        // Guard huts where roads enter: the south entry, the crossroad's and the depot road's east exits, the
        // highway's north exit, and the motor pool's gate on the south-west road.
        { look: 'guardPost', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(-25.5, -6.5, 1.1, ALONG), pose(8, -28, 1.1, ACROSS), pose(37, -36, 1.1, ALONG), pose(67, 10.5, 1.1, ALONG), pose(-14.5, 12, 1.1, ALONG)] },
        {
          look: 'armyTruck',
          table: 'roadWreck',
          // Drivers parked them in a hurry and never came back, so they stand at uneven angles.
          turnJitter: 0.45,
          shift: 0.5,
          poses: [
            // The motor pool: two rows of three on its pad.
            ...[-26, -22, -18].flatMap((s) => [14.5, 19].map((c) => pose(s, c, 1.1, ALONG))),
            // The derelict jeep on the lower-left shoulder of the highway, and the army truck on the upper-right one.
            { at: AT(-20, -1.5), r: 1.1, turn: ALONG, shoulder: true },
            { at: AT(16, 1.5), r: 1.1, turn: Math.PI, shoulder: true },
            // A truck broken down on the depot road, and one run off the south-west road.
            { at: AT(30, -33.5), r: 1.1, turn: ALONG, shoulder: true },
            { at: AT(-31.5, 24), r: 1.1, turn: 0.6, shoulder: true },
          ],
        },
        // Crate stacks the army left where a truck could load them: dug in on the ridge shelf over the highway, by
        // the hangars' checkpoint, by the depot road at the east edge, and beside the highway in the north gap.
        { look: 'armyCache', table: 'armyStores', turnJitter: 0.3, shift: 0.3, poses: [pose(32, 11, 0.9, ALONG), pose(24, -5.5, 0.9, ACROSS), pose(21, -34, 0.9, ALONG), pose(43, 5.5, 0.9, ALONG)] },
      ],
      pads: [
        // The concrete motor pool under the army trucks, beside the south-west road. The hangars stand on packed dirt,
        // as in the concept: an apron under them read as a dark slab bigger than the farmhouse yard.
        { at: AT(-22, 16), size: { x: 12, y: 10 }, turn: ALONG },
      ],
      // Blue-grey irrigation canals: a wide one beside each side of the highway, broken where roads cross, and
      // feeders along the block edges that carried the water into the rows.
      canals: [
        { points: [AT(-22, 2.75), AT(-9, 2.75)], width: 1.75 },
        { points: [AT(5.5, 2.75), AT(13, 2.75)], width: 1.75 },
        { points: [AT(19.5, 2.75), AT(46, 2.75)], width: 1.75 },
        { points: [AT(-17.5, -2.75), AT(-1, -2.75)], width: 1.75 },
        { points: [AT(9, -2.75), AT(18, -2.75)], width: 1.75 },
        { points: [AT(22.5, -2.75), AT(46, -2.75)], width: 1.75 },
        { points: [AT(-10.75, -5), AT(-10.75, -23)], width: 1 },
        { points: [AT(5.5, -4.5), AT(5.5, -20)], width: 1 },
        { points: [AT(-2.75, 21), AT(-2.75, 27)], width: 1 },
        { points: [AT(63.25, 11), AT(63.25, 39)], width: 1 },
        { points: [AT(55.75, -4.5), AT(55.75, -13.5)], width: 1 },
        { points: [AT(-29, 9.5), AT(-13, 9.5)], width: 1 },
        { points: [AT(13, 20.25), AT(21, 20.25)], width: 1 },
        { points: [AT(-24, -23.75), AT(-12.5, -23.75)], width: 1 },
        { points: [AT(40, 12.6), AT(50.5, 12.6)], width: 1 },
        { points: [AT(38.75, -10), AT(38.75, -28)], width: 1 },
      ],
      // treeGap and strays hold the tree count over the bake test's floor of 500. The fewest over map seeds 1-30 is
      // 517, so a new road, canal or building in the groves needs the count checked again.
      groves: { look: 'deadTree', rowGap: 3, treeGap: 1.5, jitter: 0.3, missing: 0.12, radius: 0.35, maxTrees: 750, keep: 0.7, strays: 180 },
      // Blocks of dead orchard trees planted in rows on both sides of the road and in the north grounds, each over
      // s0..s1 along the road and c0..c1 across it. Each was planted a little off the road's line.
      blocks: [
        // North of the farmhouse, between the highway and the north ridge.
        block(20.2, 26.2, 4.6, 16.5, 'across', 0.02),
        // Up the west side under the ridge, north of the grove track.
        block(12.8, 21, 21, 32, 'along', -0.03),
        // The big block upper left, west of the farmhouse, south of the grove track.
        block(-0.5, 8.2, 21, 31.5, 'along', 0.02),
        // The small block left of the farmhouse, between the crossroad and the south-west road.
        block(-7.5, 1.5, 10, 19.5, 'across', -0.02),
        // Between the highway and the motor pool.
        block(-33, -16.5, 4.6, 7.6, 'along', 0.01),
        // West of the south-west road, under the ridge.
        block(-29, -19.5, 28.5, 32.5, 'along', -0.02),
        // Right of the blockhouse, below the road.
        block(8, 16.4, -5, -20, 'across', 0.02),
        // Between the highway and the hangars.
        block(33, 45, -4.6, -9, 'along', -0.02),
        // The north-east ground, east of the highway.
        block(44, 55, -4.6, -13.5, 'across', 0.05),
        block(41, 56, -16.5, -26, 'along', 0.04),
        // The big block lower left, below the road.
        block(-23.5, -12.3, -6.6, -22.3, 'across', -0.02),
        // Below the crossroad's east leg, by the east edge.
        block(-8, 1.5, -23.5, -29.3, 'along', 0.06),
        // The north-west pocket: below its field road, above it, and between the highway and its barn.
        block(40, 50.5, 14.3, 33.5, 'along', 0.03),
        block(64.5, 70.6, 15.5, 39, 'across', -0.03),
        block(52.8, 57.8, 12.5, 23, 'along', 0.05),
      ],
      runs: [
        // Wooden fences the farmer kept round the outer edges of the blocks.
        { ...FENCE, points: [AT(-25, -9.5), AT(-25, -23)] },
        { ...FENCE, points: [AT(71.6, 11), AT(71.6, 39)] },
        { ...FENCE, points: [AT(-1, 32.75), AT(8.7, 32.75)] },
        { ...FENCE, points: [AT(12.8, 33), AT(21, 33)] },
        { ...FENCE, points: [AT(44, -14.5), AT(55, -14.5)] },
        { ...FENCE, points: [AT(7, -21), AT(16.4, -21)] },
        { ...FENCE, points: [AT(-29, 33.4), AT(-19.5, 33.4)] },
        // Barriers the army dragged along both shoulders of the highway at the crossroads, and at the south entry,
        // staggered so a truck must weave between them.
        { ...BARRIER, points: [AT(-5, 2.25), AT(-0.5, 2.25)] },
        { ...BARRIER, points: [AT(3.5, -2.25), AT(8.5, -2.25)] },
        { ...BARRIER, points: [AT(-30, 2.25), AT(-27, 2.25)] },
        { ...BARRIER, points: [AT(-27, -2.25), AT(-24, -2.25)] },
        // A sandbag L at each guard hut, toward its road.
        sandbagL(-25.5, -6.5, 0, 1),
        sandbagL(8, -28, -1, 0),
        sandbagL(37, -36, 0, 1),
        sandbagL(67, 10.5, 0, -1),
        sandbagL(-14.5, 12, 1, 0),
      ],
      clutter: [
        // Fuel drums the drivers and mechanics left by the trucks and hangars.
        { look: 'drums', count: 12, radius: [0.4, 0.48], near: ['armyTruck', 'quonset'], reach: 4 },
        // Lumber the farmhands stacked by the barns and the farmhouse for repairs that never came.
        { look: 'woodpile', count: 8, radius: [0.6, 0.7], near: ['barn', 'farmhouse'], reach: 4 },
        // Junk thrown out of the barns, the trucks and the house as they were stripped.
        { look: 'junk', count: 10, radius: [0.8, 1.1], near: ['barn', 'armyTruck', 'farmhouse'], reach: 5 },
        // Loose sandbags left over from the guards' walls.
        { look: 'sandbags', count: 10, radius: [0.5, 0.5], near: ['guardPost', 'bunker'], reach: 3 },
        // Barriers pulled aside from the hangars and checkpoints.
        { look: 'barrier', count: 8, radius: [0.5, 0.5], near: ['quonset', 'guardPost'], reach: 4 },
      ],
    },
    spotGap: 6,
    debrisGap: 3,
    reactor: null,
  },
};
