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
import { GLASS_FLATS_ENDS, onOrchardRoad, REGION } from './region';
import type { DeckSpec, DeckStation } from './terrain';

export { onOrchardRoad };

export type SpotTable = 'landmark' | 'hullScrap' | 'roadWreck' | 'farmStores' | 'armyStores' | 'engineScrap' | 'cityStores';
// Loot spots that are wrecks, so their prompts keep wreck wording. Every other loot spot is a plain place.
export const WRECK_LOOKS: readonly PropKind[] = ['armyTruck', 'shipCache', 'hullCache'];
export type Hazard = {
  radius: number; // tiles around the reactor
  healthPerTurn: number;
  floor: number; // driver health the hazard never takes anyone below
};
// One authored wreck piece. r is its placement radius in tiles: the model scales evenly from its reference radius
// to r, so r is half the piece's length along its yaw for the long hull pieces.
// sink, when set, is height units the piece's seat lies under the ground at its centre, so it lies half buried in a
// pit of its own; a piece without one seats at its centre's height.
export type HullPiece = { look: LandmarkLook; at: Vec; yaw: number; r: number; sink?: number };
export type Cache = { at: Vec };
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
// A circle of drawn filler: debris and field spots picked inside it from the map seed.
export type Patch = { at: Vec; radius: number; debris: DebrisRule[]; spots: number };
// Rim rocks, chunks of crater wall drawn on the bank of the territory's basin: along its floor vertices from..to,
// wrapping past the last, and out[0] to out[1] tiles out from the floor edge. size is a rock's radius in tiles.
export type RimRocks = { from: number; to: number; out: [number, number]; count: number; size: [number, number] };
// A deck of a wreck in tiles from the territory centre: a straight span width tiles wide, through the stations of its
// line (DeckStation in src/data/terrain.ts). look is the model the view stretches over each straight piece.
// FALLEN_SUN_DECKS lists them on the map, src/sim/bridge.ts gives their geometry.
export type WreckDeck = { id: string; line: DeckStation[]; width: number; look: 'ship_wing_deck' | 'ship_flap' };
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
  emplacements: Emplacement[];
  clutter: ClutterRule[];
};
// A polyline of road, width in tiles. An oldRoad is cracked asphalt; a track is pale packed dirt. grade, when set, is the
// steepest height change per tile the bake grades along it. A farm road without one holds TERRAIN.roadGrade; a wreck's dirt
// road is not graded.
export type FarmRoad = { points: Vec[]; width: number; surface: 'oldRoad' | 'track'; grade?: number };
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
// A share knocked of the segments was shoved out of line: each turns by up to knocked.turn radians and shifts by up to
// knocked.shift tiles more.
export type Run = {
  look: PropKind;
  points: Vec[];
  segment: number;
  broken: number;
  jitter: { turn: number; shift: number };
  knocked: { share: number; turn: number; shift: number };
};
// A sandbag position a guard dug facing a threat: arcs sandbag arcs side by side across the face direction, their
// convex fronts toward it, and traps steel hedgehogs out ahead on the approach. at is the middle of the arcs; face is
// radians from the road's heading.
export type Emplacement = { at: Vec; face: number; arcs: 1 | 2 | 3; traps: number };
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
  // Authored loot spots of several looks, each group rolling its own table, placed as a farm's buildings are. A
  // building must keep clear of every piece's boxes.
  buildings: BuildingGroup[];
  seatEase: number; // tiles over which the ground levelled under a piece eases back to the crater relief
  // Rim rocks on the bank of the basin centred on the territory, or null for a wreck with no basin under it.
  rimRocks: RimRocks | null;
  // Floor vertex indices of the territory's basin, from..to, wrapping past the last vertex. The bank of that arc is
  // painted red-brown scree.
  scree: { from: number; to: number } | null;
  // Dirt roads, surface 'track': the web inside the outline, and the spurs that leave it. A spur starts on a web road,
  // crosses the outline and ends on open land outside, where its last spurFade tiles fade out.
  roads: FarmRoad[];
  spurs: FarmRoad[];
  spurFade: number;
  decks: WreckDeck[];
  landing: number; // tiles of landing strip past a deck's lip, kept clear of props and other decks
};
// Fused glass: ground marked glass where value noise passes the cover share, and spire props drawn standing on it.
// src/mapgen/glass.ts bakes it after the wreck or farm.
export type GlassRules = {
  cell: number; // tiles per cell of the noise lattice, so the size of one glass field
  cover: [number, number]; // the share of open tiles that turn to glass at the centre and at the edge, linear between
  clear: number; // tiles of sand kept round every piece, building and cache: the yards stay unglazed
  spires: DebrisRule; // impassable glass, drawn wholly on glass tiles
};
// A territory is a wreck or a farm, either with fused glass.
export type TerritoryRules = {
  seed: number; // offset of the territory's own draws, so adding a territory shifts no other's
  wreck: WreckRules | null;
  farm: FarmRules | null;
  glass: GlassRules | null;
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  reactor: Reactor | null;
  // Most height units the ground under a drawn prop's or farm decoration's footprint may lie off its seat at its
  // centre, so none floats on a slope, or null for no limit.
  relief: number | null;
};

// Debris of the dense field in the concept's lower half, thinned to the second reference's sparse scrap: islands of
// clean sand with a plate, a wrecked truck and a junk pile or two.
const DENSE: DebrisRule[] = [
  { look: 'hullChunk', count: 1, radius: [1, 1.6] },
  { look: 'carWreck', count: 1, radius: [0.6, 0.8] },
  { look: 'junk', count: 2, radius: [0.5, 0.8] },
];
// The sparse scatter of the concept's upper half: one plate.
const LIGHT: DebrisRule[] = [{ look: 'hullChunk', count: 1, radius: [1, 1.6] }];

// Dirt road widths in tiles, from the second reference: its roads are 25-32 px wide where the cage's 25 tiles span
// 280 px. The outer ring is the widest.
const RING = 3;
const LANE = 2.5;
// A dirt road through points in tiles from the territory centre.
function dirt(width: number, points: (Vec | [number, number])[]): FarmRoad {
  return { points: points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)), width, surface: 'track' };
}

// The crash furrow's frame (inferred, as no reference shows it): the axis of TERRAIN.features.furrow in
// src/data/terrain.ts, in tiles from the Fallen Sun's centre. s runs down the furrow from its head, lat across it
// toward its west side.
const FURROW_HEAD: Vec = { x: -15, y: 56 };
const FURROW_TAIL: Vec = { x: -26.4, y: 98.5 };
const FURROW_LENGTH = Math.hypot(FURROW_TAIL.x - FURROW_HEAD.x, FURROW_TAIL.y - FURROW_HEAD.y);
const FURROW_AXIS: Vec = { x: (FURROW_TAIL.x - FURROW_HEAD.x) / FURROW_LENGTH, y: (FURROW_TAIL.y - FURROW_HEAD.y) / FURROW_LENGTH };
export function inFurrow(s: number, lat: number): Vec {
  return { x: FURROW_HEAD.x + FURROW_AXIS.x * s - FURROW_AXIS.y * lat, y: FURROW_HEAD.y + FURROW_AXIS.y * s + FURROW_AXIS.x * lat };
}
// The wing along the furrow's axis (inferred), in tiles down the furrow: the up-ramp's foot, the span's two ends, the
// down-ramp's top and foot, and the tail junction where the lanes meet past it. The span ends at 46, just past the
// piers' pits. The way down eases over the crest to 49, then runs to its foot at 56, so a truck coming off the span
// does not fly off the crest: off a 7-tile ramp straight from the span it took air there and landed hard.
const WING = { up: 15, span: 24, down: 46, ease: 49, end: 56, tail: 59 };
// Height units the way down stands over the floor where its easing part meets its ramp.
const WING_EASE_RISE = 1.2;
// Height units a pier's seat lies under the furrow floor, so the r 6 drum's 15.8 m stands 0.4 to 1 m under the deck
// line, 6 m over the floor.
const PIER_SINK = 2.6;
// A yaw that lies across the furrow.
const ACROSS_FURROW = Math.atan2(FURROW_AXIS.y, FURROW_AXIS.x) - Math.PI / 2;

const ALONG = 0; // a turn that keeps a building's front along the road, toward its north end
const ACROSS = Math.PI / 2; // a turn that sets a building's front across the road, toward map east: the road for a building on its west side
const AT = onOrchardRoad; // short for the many authored points below
const pose = (s: number, c: number, r: number, turn: number) => ({ at: onOrchardRoad(s, c), r, turn, shoulder: false });
// Fences around the grove blocks: old wood, a third of it fallen, every post leaning its own way, and a few panels
// pushed over out of line by a truck or the wind.
const FENCE = { look: 'fence' as const, segment: 1, broken: 0.3, jitter: { turn: 0.12, shift: 0.15 }, knocked: { share: 0.05, turn: 0.6, shift: 0.3 } };
// Concrete road barriers the army dragged into place: a third gone, each one shoved askew, some rammed out of line.
const BARRIER = { look: 'barrier' as const, segment: 1, broken: 0.35, jitter: { turn: 0.25, shift: 0.3 }, knocked: { share: 0.15, turn: 0.8, shift: 0.6 } };
// The army's perimeter line of barriers inside the orchard's edge, long since breached: nearly half gone and a fifth
// rammed or dragged well out of line, so it reads as a broken wall, never a maze.
export const PERIMETER = { look: 'barrier' as const, segment: 1, broken: 0.45, jitter: { turn: 0.25, shift: 0.3 }, knocked: { share: 0.2, turn: 1.2, shift: 1.2 } };
// How an emplacement stands its arcs and traps.
export const EMPLACEMENT = {
  arcStep: 1, // tiles between neighbouring arcs across the face: the 5 m arc model overlaps its neighbour at 4 m, so they read as one wall
  arcRadius: 0.5, // tiles, an arc's footprint for clearances, as the sandbag run segments had
  turnJitter: 0.15, // radians each arc turns off the face either way, so the bags were piled by hand
  shift: 0.2, // tiles each arc strays each way, small enough that neighbours still meet
  trapAhead: [2.5, 4] as [number, number], // tiles out ahead of the arcs where hedgehogs stand: in the guards' field of fire, past their own cover
  trapSpread: 2.5, // tiles to each side of the face line the hedgehogs spread over, about the approach road's width
  trapGap: 1.5, // tiles between a hedgehog's centre and every other hedgehog's and arc's, so each stands alone
  behindClear: 2, // tiles a hedgehog keeps from an arc it lies behind, so none stands in the guards' own position
  trapRadius: 0.25, // tiles, a hedgehog's footprint: the 1 m model at scale 1
};
// Faces of an emplacement, turns from the road's heading: up the road, across it toward map east, down it and toward
// map west, and between them.
const NORTH = 0;
const EAST = Math.PI / 2;
const SOUTH = Math.PI;
const WEST = -Math.PI / 2;
const NORTH_EAST = Math.PI / 4;
const NORTH_WEST = -Math.PI / 4;
const SOUTH_WEST = (-3 * Math.PI) / 4;
// An emplacement at (s, c) facing face, with arcs sandbag arcs and traps tank traps.
function dig(s: number, c: number, face: number, arcs: Emplacement['arcs'], traps: number): Emplacement {
  return { at: AT(s, c), face, arcs, traps };
}
// A grove block over s0..s1 along the road and c0..c1 across it.
function block(s0: number, s1: number, c0: number, c1: number, rows: GroveBlock['rows'], turn: number): GroveBlock {
  return { at: AT((s0 + s1) / 2, (c0 + c1) / 2), size: { x: s1 - s0, y: Math.abs(c1 - c0) }, rows, turn };
}

// Glass Flats is laid out from docs/concepts/glass-flats-game-style-issue-112.jpg, a 1280 x 720 gameplay concept at the
// game camera, 40 px per tile along screen x and half that along screen y. Positions are tiles from the centre, the
// crossroads ground before the engine mouth at concept pixel (640, 300) (map +x east, +y south):
// dx = (px - 640) / 40, du = (300 - py) / 20, tiles = ((dx - du) / √2, (-dx - du) / √2).
// Each comment names the concept pixels of a thing's foot; a departure from them says why. The models were built at
// their measured sizes (tmp/models/common.md): the nozzle 26 m long, the frame 30 m, a compound 16 x 11 m, a tower 3.4 m
// square, a spire cluster 10 m and a wall 7.6 m, so each r is its model's reference radius and draws at scale 1.
const NOZZLE_R = 3.25;
const FRAME_R = 3.75;
const COMPOUND_R = 2.45;
const TOWER_R = 0.6;
// Compounds stand square to the map as in the concept: ALONG_X turns a compound's long side along map x, ALONG_Y along
// map y. A ruin has settled a little, and its spot lies a little off its authored place.
const ALONG_X = 0;
const ALONG_Y = Math.PI / 2;
// The town is spread √5 times wider round the centre than the concept draws it, so Glass Flats covers five times the
// concept's ground and its roads, ruins, towers and patches stand far apart across wide glass fields. Every position
// below is in the concept's tiles and goes through wide, except the engine's: its pieces, its caches, the crossroads
// before its mouth and the nook by its west feet keep the concept's shape.
const SPREAD = Math.sqrt(5);
const wide = (x: number, y: number): Vec => ({ x: x * SPREAD, y: y * SPREAD });
const compound = (x: number, y: number, turn: number) => ({ at: wide(x, y), r: COMPOUND_R, turn, shoulder: false });
// A tower at concept tiles (x, y) beside the compound at (cx, cy) keeps its offset from that compound, so it stays at
// the compound's corner.
const tower = (cx: number, cy: number, x: number, y: number, yaw: number): HullPiece => {
  const c = wide(cx, cy);
  return { look: 'watchtower', at: { x: c.x + x - cx, y: c.y + y - cy }, yaw, r: TOWER_R };
};
// The loose broken walls and junk of an outer patch, round its one dead truck.
const RUINS: DebrisRule[] = [
  { look: 'scrapWall', count: 2, radius: [0.85, 1] },
  { look: 'junk', count: 1, radius: [0.5, 0.8] },
];
// Hull chunks and a wall by the engine.
const ENGINE_DEBRIS: DebrisRule[] = [
  { look: 'hullChunk', count: 2, radius: [0.8, 1.2] },
  { look: 'scrapWall', count: 1, radius: [0.85, 1] },
];
// The crossroads before the engine mouth, where the four inner roads meet: concept pixels (697, 342).
const CROSSROADS: Vec = { x: 2.5, y: 0.5 };
// A dirt road of the spread town: a point given as [x, y] is in concept tiles and goes through wide, a Vec stays.
const townRoad = (width: number, points: (Vec | [number, number])[]): FarmRoad =>
  dirt(width, points.map((p) => (Array.isArray(p) ? wide(p[0], p[1]) : p)));

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
        // Cage, the open ribcage tube: south end (300,430) to north end (465,335), axis north to south. A 3-tile gap to the hub lets
        // trucks leave its north end.
        { look: 'shipCage', at: { x: 4.4, y: 22.9 }, yaw: -1.61, r: 12.5 },
        // Upright shards along the spine: (578,250), moved 3.5 tiles north along the spine line from (0.4,-9.5) so the
        // second reference's road between it and the hub (690-740 px) fits; and (652,400), moved 10 tiles in along the
        // spine to (17,1.5) because the south-east drum, pulled in from the stretched foreground, took its place.
        { look: 'hullShard', at: { x: 1, y: -13 }, yaw: 0.9, r: 1.6 },
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
        // Huts: the collapsed hut (385,160), moved 4 tiles north-west off the track, and two small huts by the tower
        // (598,140) and (622,132): the first moved half a tile north from (-13.3,-26.1), off the road north of the
        // tower, and the second 3.4 tiles south-west from (-12.6,-28.9), so the outer ring passes between it and the
        // north-east drum and the two huts stand apart, not inside each other. The shed (258,318).
        { look: 'shack', at: { x: -29, y: -10.5 }, yaw: 0.4, r: 2 },
        { look: 'shack', at: { x: -13.05, y: -26.6 }, yaw: -0.8, r: 1.2 },
        { look: 'shack', at: { x: -15.4, y: -28.9 }, yaw: -0.6, r: 1.2 },
        { look: 'shack', at: { x: -13.6, y: 23.2 }, yaw: 0.6, r: 2.5 },
        // Drums: sunk in the north-east wall (690,130)-(755,70); small at the right (918,285), moved 4 tiles out of the
        // hazard and then 1.8 tiles in from (31.5,-28.5), so the outer ring passes outside it; large at the lower right
        // (765,455)-(955,505), 16 tiles long and moved 6 tiles in from (39,1.2) so it stays inside the territory.
        { look: 'hullDrum', at: { x: -8.7, y: -36.6 }, yaw: -1.834, r: 5 },
        { look: 'hullDrum', at: { x: 30.5, y: -27 }, yaw: 0.3, r: 2.5 },
        { look: 'hullDrum', at: { x: 33, y: 5 }, yaw: -0.325, r: 8 },
        // Shard clusters: bottom centre (505,545), moved 2 tiles off the south-east road's end; far left (95,400); and
        // right (885,385), moved 7 tiles north past the east road's end and then 4.5 tiles west from (36.5,-19), off
        // the east entry's lane and the ring's junction there, between the bow and the small drum where the second
        // reference has it.
        { look: 'hullShard', at: { x: 27.5, y: 30.5 }, yaw: 0.4, r: 3.5 },
        { look: 'hullShard', at: { x: -11.9, y: 38.7 }, yaw: 2.1, r: 3.5 },
        { look: 'hullShard', at: { x: 32, y: -19.5 }, yaw: -1, r: 3.5 },
        // The wing's piers (inferred): two big hull drums lying across the crash furrow under the wing's level span,
        // half buried in pits of their own, so their tops come 0.4 to 1 m under the deck and their ends stick out past
        // both rails. Each lies 3 tiles or more inside the span, so its pit never reaches a deck end's ground.
        { look: 'hullDrum', at: inFurrow(30.5, 0), yaw: ACROSS_FURROW, r: 6, sink: PIER_SINK },
        { look: 'hullDrum', at: inFurrow(39.5, 0), yaw: ACROSS_FURROW, r: 6, sink: PIER_SINK },
      ],
      // Inside hull pieces sight is short and an ambush waits at the open ends, so the rich loot lies there.
      caches: [
        // Inside the cage (330,410) and (420,360), moved toward its middle and against its east wall, where the lane
        // between the ribs stays widest beside them.
        { at: { x: 5.9, y: 26.9 } },
        { at: { x: 5.6, y: 20.9 } },
        { at: { x: -21.1, y: 5.1 } }, // inside shell A (325,222)
        { at: { x: -13.8, y: -7.9 } }, // inside shell B (440,215)
        // West of the hub: the concept's (525,300) lies inside the hub. Moved 0.8 tiles east from (-9.5,-1), so its crates
        // stand off the tiles of the road past the hub's west side.
        { at: { x: -8.7, y: -1 } },
        // Past the spine's end at the bow's aft break, outside the hazard (590,320), 2 tiles west of round 3's
        // (19.5,-2.5), off the east lane where it turns south.
        { at: { x: 17.5, y: -3.2 } },
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
        // The lower right (512,445), moved 2 tiles west and north from (21,21), so its centre lies within 6 tiles of
        // the road down the cage's east flank.
        { at: { x: 19.5, y: 19.5 }, radius: 8.5, debris: DENSE, spots: 2 },
        // Moved into the furrow from south of the large drum (633,465) and the lower left (146,301), where the crater
        // flaps' landings now run (inferred): either side of the road to the wing's up-ramp, between it and the flaps'
        // landings, in the band 5 tiles wide that runs 16 tiles down the furrow's head, so two spots fit 6 apart.
        { at: inFurrow(8, -5.2), radius: 8, debris: LIGHT, spots: 2 },
        { at: inFurrow(8, 5.2), radius: 8, debris: LIGHT, spots: 2 },
        // The sparse scatter of the upper half.
        { at: { x: 28, y: -11 }, radius: 6, debris: LIGHT, spots: 1 }, // below the bow (777,345)
        { at: { x: -6.4, y: -13.7 }, radius: 7, debris: LIGHT, spots: 1 }, // the top centre (560,210)
        { at: { x: 2, y: -27 }, radius: 7, debris: LIGHT, spots: 0 }, // below the north-east drum (709,192)
        // The west scree (180,200): pale plate fragments.
        { at: { x: -31.9, y: 11.3 }, radius: 9, debris: [{ look: 'hullChunk', count: 6, radius: [0.5, 1] }], spots: 2 },
      ],
      spotLook: 'shipCache',
      // Field spots roll a scrap-heavy table at road-wreck size. With the 9 caches the Fallen Sun keeps 24 spots.
      spotTable: 'hullScrap',
      spotRadius: [0.6, 0.8],
      buildings: [],
      seatEase: 3,
      // Rock walls along the north rim: the concept's grey crags run from (620,40) to (1000,330), bearings -111° to
      // -41°, and its red-brown hills on the north-west rim from (200,100) to (480,60), bearings -164° to -138°. They
      // stand on the basin's bank from v1 (-160°) round the cliff arc and the notch to v10 (-45°), from the floor's foot
      // up over the cliff tops, so the walls close the crater floor in.
      rimRocks: { from: 1, to: 10, out: [0.5, 6], count: 28, size: [2.5, 4] },
      // The red-brown scree slope of the concept's upper left, from (100,250) to (300,110): the basin's west bank from
      // its south-west vertex at 145° round to the left crag wall at -140°.
      scree: { from: 20, to: 2 },
      // The dirt road web, traced from the second reference through a homography fitted on the round 3 pieces
      // (tmp/issue-81/r5/roads.json), then pushed clear of the pieces' low boxes, the caches and the hazard
      // (tmp/issue-81/r4/layout.md). Each comment names the reference pixels a road was traced through: its first,
      // middle and last. One ring runs inside the outline, which the three approaches join, and inner roads run through
      // the gaps between the large pieces, so each stands on an island with road on two sides or more.
      roads: [
        // ring-w: reference 3 px (150,232) (131,399) (238,522).
        dirt(RING, [[-40.7, 13.2], [-38.1, 19.5], [-35.8, 22.7], [-33.4, 27.4], [-30.3, 31], [-25.3, 35.8], [-19, 39.9], [-16.7, 42.7], [-15.6, 43.2], [-12.1, 43.6], [-10.2, 42.9], [-8.6, 42.9], [-3.8, 45.2]]),
        // ring-sw: reference 3 px (238,522) (271,519) (305,512).
        dirt(RING, [[-3.8, 45.2], [-0.8, 40.1]]),
        // ring-s: reference 3 px (305,512) (438,568) (600,600).
        dirt(RING, [[-0.8, 40.1], [1.8, 39.1], [3.7, 38.9], [14.9, 39.6], [17.5, 39.3], [19.3, 38.6], [24.4, 35.5], [26.2, 35.6], [29.6, 36.4], [31.2, 36.2]]),
        // ring-se: reference 3 px (600,600) (823,575) (1045,553).
        dirt(RING, [[31.2, 36.2], [32.5, 33.7], [32.4, 29.2], [32.9, 27.6], [39.1, 20.1], [40, 18.9], [47.3, 9.7], [48, 7.4], [48.2, 1.6]]),
        // ring-e1: reference 3 px (1045,553) (1078,482) (1080,424).
        dirt(RING, [[48.2, 1.6], [48.1, -4.1], [47.4, -6.3], [43.3, -11.8], [38.1, -16.4]]),
        // ring-e2: reference 3 px (1080,424) (1125,429) (1172,430).
        dirt(RING, [[38.1, -16.4], [40.8, -17.9], [45, -21.1]]),
        // ring-e3: reference 3 px (1172,430) (1188,399) (1205,378).
        dirt(RING, [[45, -21.1], [42, -25.9], [40.4, -29.4]]),
        // ring-e4: reference 3 px (1205,378) (1163,308) (1150,237).
        dirt(RING, [[40.4, -29.4], [30.9, -33.9], [26.1, -37.2], [25.2, -38.4], [23.8, -41.3], [22.7, -42], [18.9, -43]]),
        // ring-ne: reference 3 px (1150,237) (1083,228) (1008,245).
        dirt(RING, [[18.9, -43], [16, -41.9], [14.5, -40.7], [10.8, -33.6]]),
        // ring-n1: reference 3 px (1008,245) (948,192) (900,197).
        dirt(RING, [[10.8, -33.6], [5.5, -35.6], [1.6, -36.2], [-0.1, -35.7], [-0.8, -35], [-1.8, -33]]),
        // ring-n2: reference 3 px (900,197) (859,191) (815,190).
        dirt(RING, [[-1.8, -33], [-2.3, -31.2], [-3, -30.1], [-4.2, -29.4], [-7.9, -28.5]]),
        // ring-n3, bent 1.5 tiles south-west round the foot of the north-east drum: reference 3 px (815,190) (812,170)
        // (810,148).
        dirt(RING, [[-7.9, -28.5], [-10.8, -28.8], [-13, -30.8], [-13.5, -33.5]]),
        // ring-n4: reference 3 px (810,148) (769,146) (725,142).
        dirt(RING, [[-13.5, -33.5], [-19.3, -29.3]]),
        // ring-n5: reference 3 px (725,142) (622,126) (547,143).
        dirt(RING, [[-19.3, -29.3], [-23, -28.7], [-25.3, -27.5], [-26.5, -26.4], [-28.4, -23.8], [-31.4, -22.1], [-32.2, -20.7], [-32.5, -19.2]]),
        // ring-nw: reference 3 px (547,143) (442,159) (345,207).
        dirt(RING, [[-32.5, -19.2], [-32.9, -17.3], [-34.3, -13.9], [-34.5, -11.9], [-34.3, -9.9], [-33, -6.2], [-35, 0.2]]),
        // ring-nw2: reference 3 px (345,207) (268,198) (205,198).
        dirt(RING, [[-35, 0.2], [-37.6, 1.5], [-41.3, 3.9], [-42, 4.9], [-42.1, 6.6]]),
        // ring-nw3: reference 3 px (205,198) (168,225) (150,232).
        dirt(RING, [[-42.1, 6.6], [-41.6, 10.2], [-40.7, 13.2]]),
        // hut-s: reference 3 px (415,187) (472,213) (548,207).
        dirt(LANE, [[-33, -6.2], [-29.3, -5.6], [-26.5, -6.4], [-24, -8.8], [-22.5, -11.4]]),
        // gantry-w: reference 3 px (547,143) (546,175) (548,207).
        dirt(LANE, [[-32.5, -19.2], [-31.6, -16.9], [-29.9, -16], [-27.1, -15.4], [-22.5, -11.4]]),
        // tower-s: reference 3 px (548,207) (627,228) (703,250).
        dirt(LANE, [[-22.5, -11.4], [-21.5, -12.7], [-20.1, -13.4], [-14.6, -13.5], [-9.3, -15.4], [-8.9, -15.1], [-7.7, -15.2]]),
        // tower-e: reference 3 px (725,142) (749,203) (790,243).
        dirt(LANE, [[-19.3, -29.3], [-17.6, -27.2], [-16.5, -24.5], [-15.1, -23.1], [-10, -24.3], [-7.5, -22.8], [-3.1, -21.1]]),
        // islet-n: reference 3 px (815,190) (797,229) (790,243).
        dirt(LANE, [[-7.9, -28.5], [-3.1, -21.1]]),
        // h-s: reference 3 px (703,250) (746,251) (790,243).
        dirt(LANE, [[-7.7, -15.2], [-5.6, -17], [-3.1, -21.1]]),
        // s-j6: reference 3 px (790,243) (835,249) (877,248).
        dirt(LANE, [[-3.1, -21.1], [1.1, -23.6], [2.9, -25.6]]),
        // j6-j8: reference 3 px (877,248) (891,224) (900,197).
        dirt(LANE, [[2.9, -25.6], [-1.8, -33]]),
        // j6-r: reference 3 px (877,248) (881,270) (885,290).
        dirt(LANE, [[2.9, -25.6], [8.6, -21.1]]),
        // bow-n, 0.2 tiles west of the trace to keep out of the hazard: reference 3 px (885,290) (959,273) (1008,245).
        dirt(LANE, [[8.6, -21.1], [9.4, -23.9], [10.8, -29.5], [11.1, -31.5], [10.8, -33.6]]),
        // spike-w: reference 3 px (703,250) (717,336) (775,352).
        dirt(LANE, [[-7.7, -15.2], [-2.5, -8.5], [-1.1, -8], [0.5, -7.9], [4.1, -7], [7.8, -7.3]]),
        // spine-n: reference 3 px (775,352) (824,313) (885,290).
        dirt(LANE, [[7.8, -7.3], [7.2, -12.2], [8.6, -21.1]]),
        // bow-s: reference 3 px (800,400) (940,420) (1080,424).
        dirt(LANE, [[20.5, -3.5], [20.2, -3.3], [23.2, -4], [25.2, -5], [26.9, -6.3], [28.5, -8.6], [29.9, -12.1], [31.1, -13.4], [38.1, -16.4]]),
        // hub-n: reference 3 px (497,300) (590,299) (690,300).
        dirt(LANE, [[-14.6, 2.7], [-12.7, 2.3], [-11.5, 1.5], [-11.7, -1.9], [-11, -2.8], [-7.8, -3.9], [-6.1, -6.2], [-2.5, -8.5]]),
        // shellA-e: bent east to run 2.8 tiles off the hub's west side (IV11); reference 3 px (497,300) (482,329)
        // (452,354).
        dirt(LANE, [[-14.6, 2.7], [-11, 4.5], [-10.5, 8.5], [-10.8, 11.8]]),
        // shellA-s: reference 3 px (238,330) (350,337) (452,354).
        dirt(LANE, [[-27.1, 21.1], [-24.2, 19.8], [-17.1, 14.2], [-10.8, 11.8]]),
        // shed-e: reference 3 px (452,354) (388,396) (308,425).
        dirt(LANE, [[-10.8, 11.8], [-9.6, 19.7], [-8.7, 22.9], [-8.9, 24.2], [-11.3, 28.9]]),
        // shed-w: reference 3 px (238,330) (308,425) (305,512).
        dirt(LANE, [[-27.1, 21.1], [-20.2, 25.7], [-11.3, 28.9], [-7.8, 31.1], [-4.7, 33.7], [-2.4, 36.8], [-0.8, 40.1]]),
        // d-e: reference 3 px (150,302) (205,320) (238,330).
        dirt(LANE, [[-35.8, 22.7], [-32.8, 22.4], [-27.1, 21.1]]),
        // e-f: bent east to run 3 tiles off shell A's west end (IV11); reference 3 px (238,330) (273,253) (345,207).
        dirt(LANE, [[-27.1, 21.1], [-29, 15.5], [-29.2, 9.5], [-30.2, 4], [-35, 0.2]]),
        // a-b: reference 3 px (183,128) (194,165) (205,198).
        dirt(LANE, [[-43.1, 0], [-42.1, 6.6]]),
        // v-ring: reference 3 px (712,455) (763,522) (790,578).
        dirt(LANE, [[18.2, 9.2], [22.9, 11.9], [25.2, 13.7], [29.2, 14.5], [33.6, 16.2], [39.1, 20.1]]),
        // v-bs: rerouted east of the spine shard (17,1.5); reference 3 px (712,455) (751,420) (800,400).
        dirt(LANE, [[18.2, 9.2], [20, 7], [21.2, 3.5], [20.5, -3.5]]),
        // shardS-w: bent west to run 2.7 tiles off the cage's east flank (IV11, IV5 for the cage caches); reference 3
        // px (712,455) (604,475) (555,557).
        dirt(LANE, [[18.2, 9.2], [14, 13], [12.8, 20], [12.8, 27], [16.5, 30.5], [21, 31.3]]),
        // sc-ring: reference 3 px (555,557) (548,571) (548,587).
        dirt(LANE, [[21, 31.3], [24.4, 35.5]]),
        // cage-w: new: down the cage's west flank, 2.9 tiles off it (IV11; reference 3 has the cage on an island of its
        // own) (inferred).
        dirt(LANE, [[-10.8, 11.8], [-5.5, 15], [-4.3, 22], [-4.3, 30], [-3, 36], [-0.8, 40.1]]),
        // hub-s: new stub between the spine and the cage's north end, to the hub's south side and the spine cache
        // (IV11, IV5) (inferred).
        dirt(LANE, [[18.2, 9.2], [13.5, 5.8], [8.5, 6.8]]),
        // The furrow (inferred: no reference shows it). Lanes down both sides of the wing at 10.25 tiles off its axis,
        // past the piers' seats, each over a flap at the furrow's head; a road onto each end of the wing.
        // From the ring's south-west junction (238,522) down the basin bank to the furrow's head, and on to the wing's
        // up-ramp.
        dirt(LANE, [[-3.8, 45.2], inFurrow(-6, 0), inFurrow(WING.up, 0)]),
        // The east lane: from the same junction, over flap-furrow-e and down its landing, past the span to the tail.
        dirt(LANE, [[-3.8, 45.2], inFurrow(-8, -10.25), inFurrow(WING.down, -10.25), inFurrow(WING.end - 1, -6), inFurrow(WING.tail, 0)]),
        // The west lane: from the ring at (-19,39.9), over flap-furrow-w, past the span to the tail.
        dirt(LANE, [[-19, 39.9], inFurrow(-8, 10.25), inFurrow(WING.down, 10.25), inFurrow(WING.end - 1, 6), inFurrow(WING.tail, 0)]),
        // From the tail onto the wing's down-ramp.
        dirt(LANE, [inFurrow(WING.tail, 0), inFurrow(WING.end, 0)]),
      ],
      // Spurs out past the edge into the wasteland, as the second reference's roads run out of its frame (inferred
      // ends). Each keeps clear of the region roads and the other sites.
      spurs: [
        // North through the cliff notch, east of the north-east drum: the reference's road out of its top at 935-945
        // px. It ends 8 tiles out.
        dirt(LANE, [[-1.8, -33], [-1.5, -38.5], [-2.2, -45], [-4.3, -53.5]]),
        // Out of the furrow's tail, east off the east lane over the low ground north of the Kiln road, since the land
        // past the tail climbs over a grade of 0.2.
        dirt(LANE, [inFurrow(WING.end - 1, -6), [-13, 105], [-3, 102], [2, 100.5]]),
        // South-west off the ring, up the 22-tile bank along the foot of the south-west hill, which climbs too steeply
        // across it: the reference's road out of its left edge at y 590.
        dirt(LANE, [[-30.3, 31], [-33, 37], [-33, 44], [-32.8, 52]]),
        // South off the ring over the 28-tile bank: the reference's road out of its bottom at x 620.
        dirt(LANE, [[14.9, 39.6], [19.5, 58]]),
        // South-east off the ring between the south-east road and the east hill: the reference's road out of its bottom
        // right corner.
        dirt(LANE, [[40, 18.9], [45.5, 25], [51, 30.5], [54.5, 33.5]]),
      ],
      spurFade: 5,
      // The wing and the flaps (inferred: neither reference shows them).
      decks: [
        // Flaps, wing flaps propped up as jump ramps: 5 tiles long and 3 wide, rising from the ground to 0.35 height
        // units (1.4 m) at the lip. A standard truck leaving one at road speed flies about 4 tiles and lands upright,
        // its wheels losing less than a breakdown takes; at 0.45 the landing costs more than that
        // (src/phys/props.test.ts).
        // Inside the south-west ring, launching east-north-east along it toward the cage.
        { id: 'fallen-sun-flap-sw', line: [{ at: { x: -32.9, y: 26 }, rise: 0 }, { at: { x: -28.5, y: 28.4 }, rise: 0.35 }], width: 3, look: 'ship_flap' },
        // Inside the south-east ring, launching north-east along it toward the east hill.
        { id: 'fallen-sun-flap-se', line: [{ at: { x: 32.6, y: 23 }, rise: 0 }, { at: { x: 35.7, y: 19.1 }, rise: 0.35 }], width: 3, look: 'ship_flap' },
        // On the furrow's two lanes at its head, launching down the furrow beside the wing's up-ramp.
        { id: 'fallen-sun-flap-furrow-e', line: [{ at: inFurrow(0, -10.25), rise: 0 }, { at: inFurrow(5, -10.25), rise: 0.35 }], width: 3, look: 'ship_flap' },
        { id: 'fallen-sun-flap-furrow-w', line: [{ at: inFurrow(0, 10.25), rise: 0 }, { at: inFurrow(5, 10.25), rise: 0.35 }], width: 3, look: 'ship_flap' },
        // The torn wing lying along the furrow, one deck 8 tiles wide: an up-ramp from the ground to 1.5 units (6 m)
        // over 9 tiles, a level span over the two piers, and a way down over 10 that eases over its crest. The furrow
        // floor rises gently toward its tail, so both ramps climb under a grade of 0.2 on the baked map, which a loaded
        // hauler still climbs.
        {
          id: 'fallen-sun-wing',
          line: [
            { at: inFurrow(WING.up, 0), rise: 0 }, // the up-ramp's foot, on the ground
            { at: inFurrow(WING.span, 0), rise: 1.5 }, // the up-ramp's top, where the level span starts
            { at: inFurrow(WING.down, 0), rise: 1.5 }, // the span's end, just past the piers' pits
            { at: inFurrow(WING.ease, 0), rise: WING_EASE_RISE }, // the way down's easing over the crest ends
            { at: inFurrow(WING.end, 0), rise: 0 }, // the way down's foot, on the ground
          ],
          width: 8,
          look: 'ship_wing_deck',
        },
      ],
      // A landing strip runs 12 tiles past each lip: the truck lands about 4 tiles out and rolls on.
      landing: 12,
    },
    farm: null,
    glass: null,
    spotGap: 6,
    debrisGap: 1.5,
    relief: null,
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
      // Debris along the road band: loose junk and old car wrecks scavengers stripped and pushed off the roads. Junk is
      // 3, down from 5: the emplacements, traps and barriers leave the orchard too little open ground for more.
      debris: [
        { look: 'junk', count: 3, radius: [0.8, 1.2] },
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
        // R4, the depot road: from the highway at s 20 along the hangars' south and east sides to the depot track, then
        // back down out of the east edge beside the trunk road. Its last point moved from (47, -41) to (31, -37): the
        // bank up to the trunk road there climbs at 0.27 a tile, and at (31, -37) the ground meets it level.
        { points: [AT(20, -1.5), AT(19, -10), AT(21, -31), AT(40, -33), AT(31, -37)], width: 3, surface: 'track' },
        // R5, the north field road: from the highway west through the north-west pocket, out of its west edge.
        { points: [AT(60, 6.6), AT(61, 22), AT(59, 40.6)], width: 2.5, surface: 'track' },
        // Narrow tracks the farmhands and the army wore: from the farmhouse yard into the north-west groves, and
        // from the depot road to the depot hangar.
        { points: [AT(6, 18), AT(10.75, 22), AT(10.75, 31)], width: 2, surface: 'track' },
        { points: [AT(40, -33), AT(45.5, -33)], width: 2, surface: 'track' },
        // The army's dozer track from the highway cutting up onto the north ridge's crest and its gun shelf. It leaves
        // the highway at (42, 1), south of the gap's crate stack, and not at (50, 4.5): from there it ran along the
        // ridge's west scarp at (45, 8), where its bank cut a cliff beside the stack. Its next points moved from (45, 8)
        // and (38, 8.5) to (39, 5.5) and (36, 7), up the crest over the cutting and off the shelf's north scarp, where
        // its bank cut a cliff beside the shelf's stack.
        { points: [AT(42, 1), AT(39, 5.5), AT(36, 7), AT(33.5, 10)], width: 2, surface: 'track', grade: 0.25 },
      ],
      buildings: [
        // The ruined two-storey farmhouse above the road at the middle, its long side and yard toward the road. The
        // farmer built it square to the road; the ruin has settled a little.
        { look: 'farmhouse', table: 'landmark', turnJitter: 0.06, shift: 0.3, poses: [pose(12, 14, 4, ACROSS)] },
        // The gabled barn far left above the road and its shed beside it, door gables to the road, and the old
        // barn of the north-west pocket's fields. The old barn moved from (53.5, 35) to (54.5, 32), off the slope
        // under the west ridge where its levelled pad cut a cliff.
        { look: 'barn', table: 'farmStores', turnJitter: 0.06, shift: 0.3, poses: [pose(-12, 29.5, 3.7, ACROSS), pose(-6, 30.5, 2.2, ACROSS), pose(54.5, 32, 3.7, ALONG)] },
        // The army's hangars: three side by side on packed dirt right of centre, ends to the road, and one at the
        // north-east depot. Their levelled pads cut cliffs on the slopes, so the first moved from (26, -12) to
        // (25, -13) and the depot's from (51, -33) to (51, -27), up the bank beside the depot track's end, with the
        // grove block to its north trimmed to make room.
        { look: 'quonset', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(25, -13, 3.2, ACROSS), pose(30, -19, 3.2, ACROSS), pose(34, -26, 3.2, ACROSS), pose(51, -27, 3.2, ALONG)] },
        // The sandbagged blockhouse below the road, commanding the crossroads.
        { look: 'bunker', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(0, -10, 3.9, ALONG)] },
        // Guard huts where roads enter: the south entry, the crossroad's and the depot road's east exits, the
        // highway's north exit, and the motor pool's gate on the south-west road. The depot road's hut moved from
        // (37, -36), on the bank the road used to climb, to (30.5, -29), across the road from its new exit. The north
        // exit's levelled pad cut a cliff, so it moved from (67, 10.5) to (68, 11.5).
        { look: 'guardPost', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(-25.5, -6.5, 1.1, ALONG), pose(8, -28, 1.1, ACROSS), pose(30.5, -29, 1.1, ALONG), pose(68, 11.5, 1.1, ALONG), pose(-14.5, 12, 1.1, ALONG)] },
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
            // A truck broken down on the depot road, and one run off the south-west road. The first moved from
            // (30, -33.5) to (29, -32.5) when the road's exit came past it, and the second from (-31.5, 24) to
            // (-28, 18.5), off the road's bank, where its levelled pad cut a cliff.
            { at: AT(29, -32.5), r: 1.1, turn: ALONG, shoulder: true },
            { at: AT(-28, 18.5), r: 1.1, turn: 0.6, shoulder: true },
          ],
        },
        // Crate stacks the army left where a truck could load them: dug in on the ridge shelf over the highway, by
        // the hangars' checkpoint, by the depot road at the east edge, and beside the highway in the north gap. The
        // shelf's stack moved from (32, 11) to (32.5, 7.5), down off the shelf's edge where its levelled pad cut a cliff.
        { look: 'armyCache', table: 'armyStores', turnJitter: 0.3, shift: 0.3, poses: [pose(32.5, 7.5, 0.9, ALONG), pose(24, -5.5, 0.9, ACROSS), pose(21, -34, 0.9, ALONG), pose(43, 5.5, 0.9, ALONG)] },
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
        // Its outer edge was trimmed from c -26 to c -22, so the depot hangar's parking gap leaves it its trees.
        block(41, 56, -16.5, -22, 'along', 0.04),
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
        // Barriers the army dragged along both shoulders of the highway at the crossroads, from s -8 to 8, and at the
        // south entry, from s -32 to -22, staggered so a truck must weave between them. Where a road joins, its marks
        // break the line.
        { ...BARRIER, points: [AT(-8, 2.25), AT(8, 2.25)] },
        { ...BARRIER, points: [AT(-8, -2.25), AT(8, -2.25)] },
        { ...BARRIER, points: [AT(-31, 2.25), AT(-28, 2.25)] },
        { ...BARRIER, points: [AT(-28, -2.25), AT(-25, -2.25)] },
        { ...BARRIER, points: [AT(-25, 2.25), AT(-22, 2.25)] },
        // A broken ring round the hangars' aprons: along their west side and across their north side, open to the
        // depot road on the south and east and toward the depot to the north-east.
        { ...BARRIER, points: [AT(27.5, -8.5), AT(32.5, -8.5)] },
        { ...BARRIER, points: [AT(36.2, -9.5), AT(37, -20.5)] },
        // Checkpoint lines along the depot road's south shoulder, the crossroad's east leg, the canal south of the
        // blockhouse, the north-west pocket's field road and the highway's east shoulder in the north cutting.
        { ...BARRIER, points: [AT(16.8, -11), AT(17.9, -22)] },
        { ...BARRIER, points: [AT(2.3, -22.5), AT(2.3, -30)] },
        { ...BARRIER, points: [AT(-11.8, -7), AT(-11.8, -21)] },
        { ...BARRIER, points: [AT(59, 9), AT(59, 22)] },
        { ...BARRIER, points: [AT(57, 4.4), AT(62, 4.6)] },
        // The army's perimeter, 2-3 tiles inside the outline. Each side breaks into lines with gaps of 3 tiles or more,
        // and every line stops short of a road, where a guard post or emplacements mark the gate. The east side runs
        // from the south-east corner to the depot: it leaves the grove block by the east edge, the crossroad's exit and
        // the depot road, which runs along the edge from s 20 to 40, open, and stands again past the bank by the depot.
        { ...PERIMETER, points: [AT(-25.5, -11), AT(-25.5, -15), AT(-24.5, -20)] },
        { ...PERIMETER, points: [AT(-22, -23.8), AT(-19.5, -25.5), AT(-16, -26.2)] },
        // The south side, short of the south-west road's exit. It leaves the ground between the old road's entry and the
        // south end of the grove block west of it open, the motor pool's way in from the entry.
        { ...PERIMETER, points: [AT(-33.8, 8.5), AT(-33.5, 11.5)] },
        // Across the north-west pocket's north end, west of the north gap's guard post, between two rows of trees.
        { ...PERIMETER, points: [AT(69, 16), AT(69, 26)] },
        { ...PERIMETER, points: [AT(69, 30), AT(69, 39)] },
      ],
      // Sandbag positions the guards dug facing the ways a threat comes, with steel hedgehogs out on the approach. Each
      // is dig(s, c, face, arcs, traps).
      emplacements: [
        // The south entry and the south-east corner: by the guard post, and on the open strip up the east edge, with
        // hedgehogs on its open ground.
        dig(-27, -14, NORTH, 2, 0),
        dig(-19, -27, SOUTH_WEST, 1, 1),
        dig(-13, -26.5, NORTH, 2, 3),
        // The crossroads round the blockhouse and the old road north of it: along the old road and the crossroads loop,
        // with hedgehogs on the open shoulders.
        dig(-9, -5, NORTH, 3, 1),
        dig(-12, 5, SOUTH, 2, 1),
        dig(-4, 5, WEST, 3, 3),
        dig(6, 5, NORTH, 3, 3),
        dig(1, 7, NORTH, 3, 0),
        dig(3, -18, NORTH_WEST, 2, 1),
        dig(-1, -18, NORTH, 1, 0),
        dig(-9, -18, EAST, 1, 1),
        dig(18, 8, NORTH, 2, 0),
        // The east exits: the crossroad's by its guard post and the open ground between it and the depot road.
        dig(8, -23, WEST, 2, 1),
        dig(14, -28, NORTH_EAST, 3, 3),
        dig(15, -23, NORTH_EAST, 2, 2),
        dig(12, -33, EAST, 2, 0),
        // The hangar yard: toward the old road, across the aprons and toward the depot road's north leg.
        dig(31, -6, NORTH, 1, 0),
        dig(23, -24, NORTH_EAST, 2, 2),
        dig(41, -30, NORTH, 3, 2),
        dig(42, -25, SOUTH_WEST, 2, 0),
        // The depot: on the strip past the bank by the east edge.
        dig(50, -41, WEST, 3, 3),
        dig(44, -39, NORTH_EAST, 2, 1),
        // The motor pool, toward the south-west road. Its south side stays open: it is the pool's way in from the entry.
        dig(-10, 20, NORTH, 2, 1),
        // The north gap: below the highway's cutting, facing up it.
        dig(53, 1, NORTH_EAST, 2, 2),
        dig(48, 7, NORTH_EAST, 2, 0),
        // The ridge shelf over the highway, by its crate stack.
        dig(38, 9, NORTH, 3, 1),
        dig(35, 12, EAST, 2, 0),
        // The south gate, on the old road's west shoulder facing down it. Was (32, 15) on the ridge shelf, where no arc
        // found ground. It keeps this place in the list, so the draws of the positions after it stay the same.
        dig(-28, 4.6, SOUTH, 2, 0),
        // The groves west of the old road and the north-west pocket's far corner.
        dig(24, 21, EAST, 3, 1),
        dig(31, 23, NORTH, 3, 0),
        dig(38, 23, NORTH, 3, 0),
        dig(70, 41, NORTH, 1, 0),
      ],
      clutter: [
        // Fuel drums the drivers and mechanics left by the trucks and hangars. 6, down from 12, so both baked seeds (7
        // and the map's) find room for every grove tree and debris piece after the emplacements went in.
        { look: 'drums', count: 6, radius: [0.4, 0.48], near: ['armyTruck', 'quonset'], reach: 4 },
        // Lumber the farmhands stacked by the barns and the farmhouse for repairs that never came.
        { look: 'woodpile', count: 8, radius: [0.6, 0.7], near: ['barn', 'farmhouse'], reach: 4 },
        // Junk thrown out of the barns, the trucks and the house as they were stripped.
        { look: 'junk', count: 10, radius: [0.8, 1.1], near: ['barn', 'armyTruck', 'farmhouse'], reach: 5 },
        // Barriers pulled aside from the hangars, checkpoints and the blockhouse. 10, up from 8, for the army's many more
        // barriers.
        { look: 'barrier', count: 10, radius: [0.5, 0.5], near: ['quonset', 'guardPost', 'bunker'], reach: 4 },
      ],
    },
    glass: null,
    spotGap: 6,
    debrisGap: 3,
    reactor: null,
    relief: 0.1,
  },  // Glass Flats: a crashed ship's engine half buried in a glass desert, with the roofless compounds of a New World
  // town round it. The nozzle and the frame are pieces; the compounds are buildings, each a loot spot; the caches lie in
  // the engine; dead trucks lie in the outer patches; fused glass covers the open ground.
  'glass-flats': {
    seed: 2,
    wreck: {
      pieces: [
        // The hollow ribbed nozzle (420,165)-(697,300): its axis's ground line runs (455,218) to (650,273), so its
        // centre stands at (552,245) and its mouth opens toward the crossroads at the concept's lower right. Its yaw is
        // the measured -0.27 (tmp/models/engine_nozzle/asset-brief.md).
        { look: 'engineNozzle', at: { x: -3.5, y: -0.4 }, yaw: -0.27, r: NOZZLE_R },
        // The collapsed frame, feet at (685,130) and (995,205) round a footprint centre at (838,159), yawed -0.75 so its
        // arches span its length as in the concept (tmp/models/engine_frame/asset-brief.md).
        { look: 'engineFrame', at: { x: -1.5, y: -8.5 }, yaw: -0.75, r: FRAME_R },
        // Watchtowers at the concept's eight: one by the engine, the rest each at a corner of its compound, off the roads.
        { look: 'watchtower', at: { x: -5.5, y: -11 }, yaw: 0.1, r: TOWER_R }, // (796,67), moved 4.5 tiles north-east from (615,75), by the frame's west end
        tower(-10.5, 0.5, -14.5, 3.5, -0.2), // (187,116), moved from (115,175) to the back compound's south-west corner
        tower(-9, 9.8, -12.5, 7.3, 0.3), // (79,232), moved from (255,200) to compound A's north-west corner
        tower(-13.3, -8.8, -15, -4.8, 0), // (349,36), moved from (440,120) to the top-left compound's south corner
        tower(2.1, -18, -1.6, -15.5, 0.15), // (994,78), moved from (1100,100) off the north compound to its corner
        tower(11.5, -8.5, 8.8, -12.5, -0.1), // (1242,248), moved from (1005,250) to the east compound's north-west corner
        tower(12, 2.5, 8.4, 4.9, 0.2), // (739,488), moved from (925,370) to compound B's south-west corner
        tower(2.2, 10.8, -0.8, 13.9, -0.15), // (224,492), moved from (640,550) to the south compound's corner
      ],
      // The rich loot lies in the engine, where sight is short.
      caches: [
        // Just inside the nozzle's mouth, 2 tiles in from its centre along its axis, where a truck drives in (665,277).
        { at: { x: -1.6, y: -0.9 } },
        // Under the frame's arches, at its middle between the feet (838,159).
        { at: { x: -1.5, y: -8.5 } },
        // Beside the frame's west feet, in the nook between them and the nozzle's back, at the north-west lane's end
        // (inferred).
        { at: { x: -6.2, y: -4.6 } },
      ],
      cacheLook: 'hullCache',
      // Engine caches roll engine scrap: batteries and engine parts.
      cacheTable: 'engineScrap',
      cacheRadius: 0.7,
      patches: [
        // Outer patches, each with a dead truck and broken walls, inferred from the setting image's ruins and vehicles
        // out to the edge: north-east, east, south, south-west and north-west, then two in the wide north-east, east
        // of S2's lane and north under the cliffs.
        { at: wide(18, -27), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(26, -3), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(1, 22), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(-20, 19), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(-19, -12), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(30, -17), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(9, -36), radius: 8, debris: RUINS, spots: 1 },
        // One inner patch by the engine (inferred: the concept's loose plates and walls round the engine pieces), north
        // of the frame's west end.
        { at: { x: -5, y: -15 }, radius: 4.5, debris: ENGINE_DEBRIS, spots: 0 },
      ],
      spotLook: 'deadTruck',
      spotTable: 'roadWreck',
      spotRadius: [0.6, 0.8],
      buildings: [
        {
          look: 'ruinCompound',
          // A compound's yard and block: textiles, water, meds and scrap the townsfolk left.
          table: 'cityStores',
          turnJitter: 0.06,
          shift: 0.3,
          poses: [
            // A, the compound with the tarp (290,290), moved 4.7 tiles south-west from (-6.5,5.8) across the west road.
            compound(-9, 9.8, ALONG_Y),
            // Behind the nozzle (380,175), moved 1.5 tiles west from (-9,0.2) off the nozzle's back, toward the west road.
            compound(-10.5, 0.5, ALONG_X),
            // In front of the nozzle (545,295): the concept's (-1.9,1.5) lies on the nozzle, so it stands 9 tiles south
            // across the west road.
            compound(-3.5, 10.5, ALONG_X),
            // Top left (400,40), moved 4 tiles south from (-13.4,-4.9) between the ring road and the north-west lane, onto
            // flat ground.
            compound(-13.3, -8.8, ALONG_Y),
            // Top right (1110,120): the concept's (1.9,-14.7) touches the frame's east feet, so it stands 3.3 tiles north,
            // off the north road and the bumps there.
            compound(2.1, -18, ALONG_X),
            // Right of the frame (1000,260), moved 6.6 tiles east from (4.9,-7.8) off the frame's feet and the north road.
            compound(11.5, -8.5, ALONG_Y),
            // B (940,430), moved 3.7 tiles south-east from (9.9,-0.7) across the east road, clear of the pit's steep sides
            // at (10-12, 6-8).
            compound(12, 2.5, ALONG_X),
            // Bottom centre (700,510), moved 7 tiles south-west from (8.5,6.4) off the pit's steep sides, west of the south
            // road.
            compound(2.2, 10.8, ALONG_Y),
            // Three outer compounds past the ring road, inferred from the setting image's ruins out to the edge: west,
            // north and south-west, where the south-east edge leaves no room and the south has a cliff.
            compound(-23, 2, ALONG_Y),
            compound(4, -26.3, ALONG_X),
            compound(-10.5, 20, ALONG_Y),
          ],
        },
      ],
      seatEase: 3,
      // No basin lies under Glass Flats: its ground is open flats.
      rimRocks: null,
      scree: null,
      // The dirt road web (inferred where the concept's tracks leave its frame): a ring road round the core, four roads
      // from the crossroads before the engine mouth out to the ring, a lane to the frame's west feet, and a lane from
      // each approach's end to the ring.
      roads: [
        // The four roads from the crossroads: west past the nozzle's south side between it and compound A, the concept's
        // track along (144,136)-(560,352); north between the nozzle's mouth and the frame's east feet; east, the
        // concept's track to the right edge; and south.
        townRoad(LANE, [CROSSROADS, [0, 5], [-10, 5.5], [-16.5, 5]]),
        townRoad(LANE, [CROSSROADS, [5, -6], [6.5, -12], [7, -21.5]]),
        townRoad(LANE, [CROSSROADS, [9, -2], [16, -5]]),
        townRoad(LANE, [CROSSROADS, [6.5, 7], [6.5, 16.6]]),
        // The ring road, clockwise from the east, about 36 to 47 tiles out.
        townRoad(RING, [[16, -5], [16.5, -9], [13, -18.5], [7, -21.5], [-5, -20.5], [-12, -17], [-17.5, -11.5], [-19, -2], [-16.5, 5], [-13.5, 13], [-5, 17.5], [3.5, 18], [11, 14.5], [17.4, 10], [17.2, 4], [16, -5]]),
        // The north-west lane, from the ring between the north-west compound and the frame to the nook by the frame's
        // west feet, where the third cache lies.
        townRoad(LANE, [[-12, -17], { x: -8.5, y: -10 }, { x: -8.5, y: -5.5 }]),
        // From S1's end at the south-east edge in to the ring's south-east corner.
        townRoad(LANE, [GLASS_FLATS_ENDS[0], [11, 14.5]]),
        // From S2's end at the north-east edge, south of the north-east patch, to the ring's north-east corner.
        townRoad(LANE, [GLASS_FLATS_ENDS[1], [13, -18.5]]),
      ],
      // A spur out past the edge into the wasteland, as the setting image's tracks leave outward (inferred), in tiles
      // from the centre: south-west into the scrub between Kiln Camp and Green Pit, so raiders have a way in.
      spurs: [dirt(LANE, [wide(-13.5, 13), [-60, 40], [-82, 55]])],
      spurFade: 5,
      decks: [],
      landing: 0,
    },
    farm: null,
    // Glass covers about two fifths of the territory, five times the glass of the territory before it was spread. The
    // cover share is highest at the centre, where the tracks and the clear yards round the compounds and the engine
    // leave less open ground. Cells of 6 tiles give fields as wide as the concept's. Spires of 0.6 to 1.2 tiles stand
    // big and small as its pyramids do; 85 put 8 in the zoom-1 core view before the spread, so 425 keep that density.
    glass: { cell: 6, cover: [0.55, 0.45], clear: 1, spires: { look: 'glassSpire', count: 425, radius: [0.6, 1.2] } },
    spotGap: 6,
    debrisGap: 1.5,
    reactor: null,
    relief: null,
  },
};

function fallenSunWreck(): WreckRules {
  const wreck = TERRITORIES['fallen-sun'].wreck;
  if (!wreck) throw new Error('The Fallen Sun has no wreck rules');
  return wreck;
}

// The Fallen Sun's centre in map tiles, where its location stands.
function fallenSunCentre(): Vec {
  const site = REGION.locations.find((l) => l.id === 'fallen-sun');
  if (!site) throw new Error('The Fallen Sun location is missing from REGION');
  return site.pos;
}

// The Fallen Sun's decks in map tiles, listed in TERRAIN.features.decks after the road decks, each with its look. Each
// is skirted, so nothing drives in under a raised end, and none cuts the ground.
export const FALLEN_SUN_DECKS: (DeckSpec & Pick<WreckDeck, 'look'>)[] = fallenSunWreck().decks.map((d) => {
  const c = fallenSunCentre();
  const line = d.line.map((s) => ({ at: { x: c.x + s.at.x, y: c.y + s.at.y }, rise: s.rise }));
  return { id: d.id, line, width: d.width, look: d.look, cut: null, skirt: true };
});
