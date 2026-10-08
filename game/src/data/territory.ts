// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.
//

import type { PropKind } from '../sim/terrain';
import type { LandmarkLook } from '../sim/types';
import type { Vec } from '../sim/vec';
import { GLASS_FLATS_ENDS, onOrchardRoad, REGION } from './region';
import type { DeckSpec, DeckStation } from './terrain';

export { onOrchardRoad };

export type SpotTable = 'landmark' | 'hullScrap' | 'roadWreck' | 'farmStores' | 'armyStores' | 'engineScrap' | 'cityStores';
// Loot spots that are wrecks, so their prompts keep wreck wording. Every other loot spot is a plain place.
export const WRECK_LOOKS: readonly PropKind[] = ['armyTruck', 'shipCache', 'hullCache', 'tank'];
export type Hazard = {
  radius: number;
  healthPerTurn: number;
  floor: number;
};
export type HullPiece = { look: LandmarkLook; at: Vec; yaw: number; r: number; sink?: number };
export type Cache = { at: Vec };
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
export type Patch = { at: Vec; radius: number; debris: DebrisRule[]; spots: number };
export type RimRocks = { from: number; to: number; out: [number, number]; count: number; size: [number, number] };
export type WreckDeck = { id: string; line: DeckStation[]; width: number; look: 'ship_wing_deck' | 'ship_flap' };
export type Reactor = { look: PropKind; at: Vec; radius: number; hazard: Hazard | null };
export type FarmRules = {
  spine: { from: Vec; to: Vec; band: number };
  debris: DebrisRule[];
  grounds: [number, number];
  roads: FarmRoad[];
  buildings: BuildingGroup[];
  pads: Pad[];
  canals: Track[];
  groves: GroveRule;
  blocks: GroveBlock[];
  runs: Run[];
  emplacements: Emplacement[];
  clutter: ClutterRule[];
};
export type FarmRoad = { points: Vec[]; width: number; surface: 'oldRoad' | 'track'; grade?: number };
export type BuildingGroup = {
  look: PropKind;
  table: SpotTable;
  turnJitter: number;
  shift: number;
  poses: { at: Vec; r: number; turn: number; shoulder: boolean }[];
};
export type Pad = { at: Vec; size: Vec; turn: number };
export type Track = { points: Vec[]; width: number };
export type GroveRule = {
  look: PropKind;
  rowGap: number;
  treeGap: number;
  jitter: number;
  missing: number;
  radius: number;
  maxTrees: number;
  keep: number;
  strays: number;
};
export type GroveBlock = { at: Vec; size: Vec; rows: 'along' | 'across'; turn: number };
export type Run = {
  look: PropKind;
  points: Vec[];
  segment: number;
  broken: number;
  jitter: { turn: number; shift: number };
  knocked: { share: number; turn: number; shift: number };
};
export type Emplacement = { at: Vec; face: number; arcs: 1 | 2 | 3; traps: number };
export type ClutterRule = { look: PropKind; count: number; radius: [number, number]; near: PropKind[]; reach: number };
export type WreckRules = {
  pieces: HullPiece[];
  caches: Cache[];
  cacheLook: PropKind;
  cacheTable: SpotTable;
  cacheRadius: number;
  patches: Patch[];
  spotLook: PropKind;
  spotTable: SpotTable;
  spotRadius: [number, number];
  buildings: BuildingGroup[];
  seatEase: number;
  rimRocks: RimRocks | null;
  scree: { from: number; to: number } | null;
  roads: FarmRoad[];
  spurs: FarmRoad[];
  spurFade: number;
  decks: WreckDeck[];
  landing: number;
};
export type GlassRules = {
  cell: number;
  cover: [number, number];
  clear: number;
  spires: DebrisRule;
};
export type TerritoryRules = {
  seed: number;
  wreck: WreckRules | null;
  farm: FarmRules | null;
  glass: GlassRules | null;
  spotGap: number;
  debrisGap: number;
  reactor: Reactor | null;
  relief: number | null;
};

const DENSE: DebrisRule[] = [
  { look: 'hullChunk', count: 1, radius: [1, 1.6] },
  { look: 'carWreck', count: 1, radius: [0.6, 0.8] },
  { look: 'junk', count: 2, radius: [0.5, 0.8] },
];
const LIGHT: DebrisRule[] = [{ look: 'hullChunk', count: 1, radius: [1, 1.6] }];

const RING = 3;
const LANE = 2.5;
function dirt(width: number, points: (Vec | [number, number])[]): FarmRoad {
  return { points: points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)), width, surface: 'track' };
}

const FURROW_HEAD: Vec = { x: -15, y: 56 };
const FURROW_TAIL: Vec = { x: -26.4, y: 98.5 };
const FURROW_LENGTH = Math.hypot(FURROW_TAIL.x - FURROW_HEAD.x, FURROW_TAIL.y - FURROW_HEAD.y);
const FURROW_AXIS: Vec = { x: (FURROW_TAIL.x - FURROW_HEAD.x) / FURROW_LENGTH, y: (FURROW_TAIL.y - FURROW_HEAD.y) / FURROW_LENGTH };
export function inFurrow(s: number, lat: number): Vec {
  return { x: FURROW_HEAD.x + FURROW_AXIS.x * s - FURROW_AXIS.y * lat, y: FURROW_HEAD.y + FURROW_AXIS.y * s + FURROW_AXIS.x * lat };
}
const WING = { up: 15, span: 24, down: 46, ease: 49, end: 56, tail: 59 };
const WING_EASE_RISE = 1.2;
const PIER_SINK = 2.6;
const ACROSS_FURROW = Math.atan2(FURROW_AXIS.y, FURROW_AXIS.x) - Math.PI / 2;

const ALONG = 0;
const ACROSS = Math.PI / 2;
const AT = onOrchardRoad;
const pose = (s: number, c: number, r: number, turn: number) => ({ at: onOrchardRoad(s, c), r, turn, shoulder: false });
const FENCE = { look: 'fence' as const, segment: 1, broken: 0.3, jitter: { turn: 0.12, shift: 0.15 }, knocked: { share: 0.05, turn: 0.6, shift: 0.3 } };
const BARRIER = { look: 'barrier' as const, segment: 1, broken: 0.35, jitter: { turn: 0.25, shift: 0.3 }, knocked: { share: 0.15, turn: 0.8, shift: 0.6 } };
export const PERIMETER = { look: 'barrier' as const, segment: 1, broken: 0.45, jitter: { turn: 0.25, shift: 0.3 }, knocked: { share: 0.2, turn: 1.2, shift: 1.2 } };
export const EMPLACEMENT = {
  arcStep: 1,
  arcRadius: 0.5,
  turnJitter: 0.15,
  shift: 0.2,
  trapAhead: [2.5, 4] as [number, number],
  trapSpread: 2.5,
  trapGap: 1.5,
  behindClear: 2,
  trapRadius: 0.25,
};
const NORTH = 0;
const EAST = Math.PI / 2;
const SOUTH = Math.PI;
const WEST = -Math.PI / 2;
const NORTH_EAST = Math.PI / 4;
const NORTH_WEST = -Math.PI / 4;
const SOUTH_WEST = (-3 * Math.PI) / 4;
function dig(s: number, c: number, face: number, arcs: Emplacement['arcs'], traps: number): Emplacement {
  return { at: AT(s, c), face, arcs, traps };
}
function block(s0: number, s1: number, c0: number, c1: number, rows: GroveBlock['rows'], turn: number): GroveBlock {
  return { at: AT((s0 + s1) / 2, (c0 + c1) / 2), size: { x: s1 - s0, y: Math.abs(c1 - c0) }, rows, turn };
}

const NOZZLE_R = 3.25;
const FRAME_R = 3.75;
const COMPOUND_R = 2.45;
const TOWER_R = 0.6;
const ALONG_X = 0;
const ALONG_Y = Math.PI / 2;
const SPREAD = Math.sqrt(5);
const wide = (x: number, y: number): Vec => ({ x: x * SPREAD, y: y * SPREAD });
const compound = (x: number, y: number, turn: number) => ({ at: wide(x, y), r: COMPOUND_R, turn, shoulder: false });
const tower = (cx: number, cy: number, x: number, y: number, yaw: number): HullPiece => {
  const c = wide(cx, cy);
  return { look: 'watchtower', at: { x: c.x + x - cx, y: c.y + y - cy }, yaw, r: TOWER_R };
};
const RUINS: DebrisRule[] = [
  { look: 'scrapWall', count: 2, radius: [0.85, 1] },
  { look: 'junk', count: 1, radius: [0.5, 0.8] },
];
const ENGINE_DEBRIS: DebrisRule[] = [
  { look: 'hullChunk', count: 2, radius: [0.8, 1.2] },
  { look: 'scrapWall', count: 1, radius: [0.85, 1] },
];
const CROSSROADS: Vec = { x: 2.5, y: 0.5 };
const townRoad = (width: number, points: (Vec | [number, number])[]): FarmRoad =>
  dirt(width, points.map((p) => (Array.isArray(p) ? wide(p[0], p[1]) : p)));

export const TERRITORIES: Record<string, TerritoryRules> = {
  'fallen-sun': {
    seed: 0,
    wreck: {
      pieces: [
        { look: 'shipBow', at: { x: 18, y: -22.9 }, yaw: -1.481, r: 16.5 },
        { look: 'shipHub', at: { x: -0.8, y: 1.4 }, yaw: -0.356, r: 6 },
        { look: 'shipCage', at: { x: 4.4, y: 22.9 }, yaw: -1.61, r: 12.5 },
        { look: 'hullShard', at: { x: 1, y: -13 }, yaw: 0.9, r: 1.6 },
        { look: 'hullShard', at: { x: 17, y: 1.5 }, yaw: 2.4, r: 1.6 },
        { look: 'hullShell', at: { x: -21.1, y: 5.1 }, yaw: -0.2, r: 6 },
        { look: 'hullShell', at: { x: -13.8, y: -7.9 }, yaw: -0.3, r: 4 },
        { look: 'hullTower', at: { x: -13, y: -18.6 }, yaw: -0.785, r: 1.6 },
        { look: 'hullGantry', at: { x: -24, y: -18.5 }, yaw: 0.133, r: 5.5 },
        { look: 'shack', at: { x: -29, y: -10.5 }, yaw: 0.4, r: 2 },
        { look: 'shack', at: { x: -13.05, y: -26.6 }, yaw: -0.8, r: 1.2 },
        { look: 'shack', at: { x: -15.4, y: -28.9 }, yaw: -0.6, r: 1.2 },
        { look: 'shack', at: { x: -13.6, y: 23.2 }, yaw: 0.6, r: 2.5 },
        { look: 'hullDrum', at: { x: -8.7, y: -36.6 }, yaw: -1.834, r: 5 },
        { look: 'hullDrum', at: { x: 30.5, y: -27 }, yaw: 0.3, r: 2.5 },
        { look: 'hullDrum', at: { x: 33, y: 5 }, yaw: -0.325, r: 8 },
        { look: 'hullShard', at: { x: 27.5, y: 30.5 }, yaw: 0.4, r: 3.5 },
        { look: 'hullShard', at: { x: -11.9, y: 38.7 }, yaw: 2.1, r: 3.5 },
        { look: 'hullShard', at: { x: 32, y: -19.5 }, yaw: -1, r: 3.5 },
        { look: 'hullDrum', at: inFurrow(30.5, 0), yaw: ACROSS_FURROW, r: 6, sink: PIER_SINK },
        { look: 'hullDrum', at: inFurrow(39.5, 0), yaw: ACROSS_FURROW, r: 6, sink: PIER_SINK },
      ],
      caches: [
        { at: { x: 5.9, y: 26.9 } },
        { at: { x: 5.6, y: 20.9 } },
        { at: { x: -21.1, y: 5.1 } },
        { at: { x: -13.8, y: -7.9 } },
        { at: { x: -8.7, y: -1 } },
        { at: { x: 17.5, y: -3.2 } },
        { at: { x: -10.5, y: -22 } },
        { at: { x: 30.8, y: 11 } },
        { at: { x: 10.2, y: 2.1 } },
      ],
      cacheLook: 'hullCache',
      cacheTable: 'landmark',
      cacheRadius: 0.7,
      patches: [
        { at: { x: -6.5, y: 32.4 }, radius: 10, debris: DENSE, spots: 3 },
        { at: { x: 14, y: 30 }, radius: 9, debris: DENSE, spots: 2 },
        { at: { x: 19.5, y: 19.5 }, radius: 8.5, debris: DENSE, spots: 2 },
        { at: inFurrow(8, -5.2), radius: 8, debris: LIGHT, spots: 2 },
        { at: inFurrow(8, 5.2), radius: 8, debris: LIGHT, spots: 2 },
        { at: { x: 28, y: -11 }, radius: 6, debris: LIGHT, spots: 1 },
        { at: { x: -6.4, y: -13.7 }, radius: 7, debris: LIGHT, spots: 1 },
        { at: { x: 2, y: -27 }, radius: 7, debris: LIGHT, spots: 0 },
        { at: { x: -31.9, y: 11.3 }, radius: 9, debris: [{ look: 'hullChunk', count: 6, radius: [0.5, 1] }], spots: 2 },
      ],
      spotLook: 'shipCache',
      spotTable: 'hullScrap',
      spotRadius: [0.6, 0.8],
      buildings: [],
      seatEase: 3,
      rimRocks: { from: 1, to: 10, out: [0.5, 6], count: 28, size: [2.5, 4] },
      scree: { from: 20, to: 2 },
      roads: [
        dirt(RING, [[-40.7, 13.2], [-38.1, 19.5], [-35.8, 22.7], [-33.4, 27.4], [-30.3, 31], [-25.3, 35.8], [-19, 39.9], [-16.7, 42.7], [-15.6, 43.2], [-12.1, 43.6], [-10.2, 42.9], [-8.6, 42.9], [-3.8, 45.2]]),
        dirt(RING, [[-3.8, 45.2], [-0.8, 40.1]]),
        dirt(RING, [[-0.8, 40.1], [1.8, 39.1], [3.7, 38.9], [14.9, 39.6], [17.5, 39.3], [19.3, 38.6], [24.4, 35.5], [26.2, 35.6], [29.6, 36.4], [31.2, 36.2]]),
        dirt(RING, [[31.2, 36.2], [32.5, 33.7], [32.4, 29.2], [32.9, 27.6], [39.1, 20.1], [40, 18.9], [47.3, 9.7], [48, 7.4], [48.2, 1.6]]),
        dirt(RING, [[48.2, 1.6], [48.1, -4.1], [47.4, -6.3], [43.3, -11.8], [38.1, -16.4]]),
        dirt(RING, [[38.1, -16.4], [40.8, -17.9], [45, -21.1]]),
        dirt(RING, [[45, -21.1], [42, -25.9], [40.4, -29.4]]),
        dirt(RING, [[40.4, -29.4], [30.9, -33.9], [26.1, -37.2], [25.2, -38.4], [23.8, -41.3], [22.7, -42], [18.9, -43]]),
        dirt(RING, [[18.9, -43], [16, -41.9], [14.5, -40.7], [10.8, -33.6]]),
        dirt(RING, [[10.8, -33.6], [5.5, -35.6], [1.6, -36.2], [-0.1, -35.7], [-0.8, -35], [-1.8, -33]]),
        dirt(RING, [[-1.8, -33], [-2.3, -31.2], [-3, -30.1], [-4.2, -29.4], [-7.9, -28.5]]),
        dirt(RING, [[-7.9, -28.5], [-10.8, -28.8], [-13, -30.8], [-13.5, -33.5]]),
        dirt(RING, [[-13.5, -33.5], [-19.3, -29.3]]),
        dirt(RING, [[-19.3, -29.3], [-23, -28.7], [-25.3, -27.5], [-26.5, -26.4], [-28.4, -23.8], [-31.4, -22.1], [-32.2, -20.7], [-32.5, -19.2]]),
        dirt(RING, [[-32.5, -19.2], [-32.9, -17.3], [-34.3, -13.9], [-34.5, -11.9], [-34.3, -9.9], [-33, -6.2], [-35, 0.2]]),
        dirt(RING, [[-35, 0.2], [-37.6, 1.5], [-41.3, 3.9], [-42, 4.9], [-42.1, 6.6]]),
        dirt(RING, [[-42.1, 6.6], [-41.6, 10.2], [-40.7, 13.2]]),
        dirt(LANE, [[-33, -6.2], [-29.3, -5.6], [-26.5, -6.4], [-24, -8.8], [-22.5, -11.4]]),
        dirt(LANE, [[-32.5, -19.2], [-31.6, -16.9], [-29.9, -16], [-27.1, -15.4], [-22.5, -11.4]]),
        dirt(LANE, [[-22.5, -11.4], [-21.5, -12.7], [-20.1, -13.4], [-14.6, -13.5], [-9.3, -15.4], [-8.9, -15.1], [-7.7, -15.2]]),
        dirt(LANE, [[-19.3, -29.3], [-17.6, -27.2], [-16.5, -24.5], [-15.1, -23.1], [-10, -24.3], [-7.5, -22.8], [-3.1, -21.1]]),
        dirt(LANE, [[-7.9, -28.5], [-3.1, -21.1]]),
        dirt(LANE, [[-7.7, -15.2], [-5.6, -17], [-3.1, -21.1]]),
        dirt(LANE, [[-3.1, -21.1], [1.1, -23.6], [2.9, -25.6]]),
        dirt(LANE, [[2.9, -25.6], [-1.8, -33]]),
        dirt(LANE, [[2.9, -25.6], [8.6, -21.1]]),
        dirt(LANE, [[8.6, -21.1], [9.4, -23.9], [10.8, -29.5], [11.1, -31.5], [10.8, -33.6]]),
        dirt(LANE, [[-7.7, -15.2], [-2.5, -8.5], [-1.1, -8], [0.5, -7.9], [4.1, -7], [7.8, -7.3]]),
        dirt(LANE, [[7.8, -7.3], [7.2, -12.2], [8.6, -21.1]]),
        dirt(LANE, [[20.5, -3.5], [20.2, -3.3], [23.2, -4], [25.2, -5], [26.9, -6.3], [28.5, -8.6], [29.9, -12.1], [31.1, -13.4], [38.1, -16.4]]),
        dirt(LANE, [[-14.6, 2.7], [-12.7, 2.3], [-11.5, 1.5], [-11.7, -1.9], [-11, -2.8], [-7.8, -3.9], [-6.1, -6.2], [-2.5, -8.5]]),
        dirt(LANE, [[-14.6, 2.7], [-11, 4.5], [-10.5, 8.5], [-10.8, 11.8]]),
        dirt(LANE, [[-27.1, 21.1], [-24.2, 19.8], [-17.1, 14.2], [-10.8, 11.8]]),
        dirt(LANE, [[-10.8, 11.8], [-9.6, 19.7], [-8.7, 22.9], [-8.9, 24.2], [-11.3, 28.9]]),
        dirt(LANE, [[-27.1, 21.1], [-20.2, 25.7], [-11.3, 28.9], [-7.8, 31.1], [-4.7, 33.7], [-2.4, 36.8], [-0.8, 40.1]]),
        dirt(LANE, [[-35.8, 22.7], [-32.8, 22.4], [-27.1, 21.1]]),
        dirt(LANE, [[-27.1, 21.1], [-29, 15.5], [-29.2, 9.5], [-30.2, 4], [-35, 0.2]]),
        dirt(LANE, [[-43.1, 0], [-42.1, 6.6]]),
        dirt(LANE, [[18.2, 9.2], [22.9, 11.9], [25.2, 13.7], [29.2, 14.5], [33.6, 16.2], [39.1, 20.1]]),
        dirt(LANE, [[18.2, 9.2], [20, 7], [21.2, 3.5], [20.5, -3.5]]),
        dirt(LANE, [[18.2, 9.2], [14, 13], [12.8, 20], [12.8, 27], [16.5, 30.5], [21, 31.3]]),
        dirt(LANE, [[21, 31.3], [24.4, 35.5]]),
        dirt(LANE, [[-10.8, 11.8], [-5.5, 15], [-4.3, 22], [-4.3, 30], [-3, 36], [-0.8, 40.1]]),
        dirt(LANE, [[18.2, 9.2], [13.5, 5.8], [8.5, 6.8]]),
        dirt(LANE, [[-3.8, 45.2], inFurrow(-6, 0), inFurrow(WING.up, 0)]),
        dirt(LANE, [[-3.8, 45.2], inFurrow(-8, -10.25), inFurrow(WING.down, -10.25), inFurrow(WING.end - 1, -6), inFurrow(WING.tail, 0)]),
        dirt(LANE, [[-19, 39.9], inFurrow(-8, 10.25), inFurrow(WING.down, 10.25), inFurrow(WING.end - 1, 6), inFurrow(WING.tail, 0)]),
        dirt(LANE, [inFurrow(WING.tail, 0), inFurrow(WING.end, 0)]),
      ],
      spurs: [
        dirt(LANE, [[-1.8, -33], [-1.5, -38.5], [-2.2, -45], [-4.3, -53.5]]),
        dirt(LANE, [inFurrow(WING.end - 1, -6), [-13, 105], [-3, 102], [2, 100.5]]),
        dirt(LANE, [[-30.3, 31], [-33, 37], [-33, 44], [-32.8, 52]]),
        dirt(LANE, [[14.9, 39.6], [19.5, 58]]),
        dirt(LANE, [[40, 18.9], [45.5, 25], [51, 30.5], [54.5, 33.5]]),
      ],
      spurFade: 5,
      decks: [
        { id: 'fallen-sun-flap-sw', line: [{ at: { x: -32.9, y: 26 }, rise: 0 }, { at: { x: -28.5, y: 28.4 }, rise: 0.35 }], width: 3, look: 'ship_flap' },
        { id: 'fallen-sun-flap-se', line: [{ at: { x: 32.6, y: 23 }, rise: 0 }, { at: { x: 35.7, y: 19.1 }, rise: 0.35 }], width: 3, look: 'ship_flap' },
        { id: 'fallen-sun-flap-furrow-e', line: [{ at: inFurrow(0, -10.25), rise: 0 }, { at: inFurrow(5, -10.25), rise: 0.35 }], width: 3, look: 'ship_flap' },
        { id: 'fallen-sun-flap-furrow-w', line: [{ at: inFurrow(0, 10.25), rise: 0 }, { at: inFurrow(5, 10.25), rise: 0.35 }], width: 3, look: 'ship_flap' },
        {
          id: 'fallen-sun-wing',
          line: [
            { at: inFurrow(WING.up, 0), rise: 0 },
            { at: inFurrow(WING.span, 0), rise: 1.5 },
            { at: inFurrow(WING.down, 0), rise: 1.5 },
            { at: inFurrow(WING.ease, 0), rise: WING_EASE_RISE },
            { at: inFurrow(WING.end, 0), rise: 0 },
          ],
          width: 8,
          look: 'ship_wing_deck',
        },
      ],
      landing: 12,
    },
    farm: null,
    glass: null,
    spotGap: 6,
    debrisGap: 1.5,
    relief: null,
    reactor: {
      look: 'reactor',
      at: { x: 19.4, y: -25.3 },
      radius: 1.5,
      hazard: {
        radius: 8,
        healthPerTurn: 5,
        floor: 30,
      },
    },
  },
  orchard: {
    seed: 1,
    wreck: null,
    farm: {
      spine: { from: AT(-30, 0), to: AT(44, 0), band: 30 },
      debris: [
        { look: 'junk', count: 3, radius: [0.8, 1.2] },
        { look: 'carWreck', count: 4, radius: [0.6, 0.8] },
      ],
      grounds: [0.3, 1],
      roads: [
        { points: [AT(-32, 0), AT(46, 0), AT(52, 6), AT(58, 6.5), AT(72, 7.5)], width: 3, surface: 'oldRoad' },
        { points: [AT(6, 18), AT(4, 9), AT(1, -3), AT(-6, -6), AT(-8, -11), AT(-8, -15), AT(-3, -20), AT(4, -21), AT(4, -31.9)], width: 3, surface: 'track' },
        { points: [AT(-6, 1.5), AT(-10, 9), AT(-13, 21), AT(-22, 25), AT(-30, 22), AT(-35.4, 14)], width: 3, surface: 'track' },
        { points: [AT(20, -1.5), AT(19, -10), AT(21, -31), AT(40, -33), AT(31, -37)], width: 3, surface: 'track' },
        { points: [AT(60, 6.6), AT(61, 22), AT(59, 40.6)], width: 2.5, surface: 'track' },
        { points: [AT(6, 18), AT(10.75, 22), AT(10.75, 31)], width: 2, surface: 'track' },
        { points: [AT(40, -33), AT(45.5, -33)], width: 2, surface: 'track' },
        { points: [AT(42, 1), AT(39, 5.5), AT(36, 7), AT(33.5, 10)], width: 2, surface: 'track', grade: 0.25 },
      ],
      buildings: [
        { look: 'farmhouse', table: 'landmark', turnJitter: 0.06, shift: 0.3, poses: [pose(12, 14, 4, ACROSS)] },
        { look: 'barn', table: 'farmStores', turnJitter: 0.06, shift: 0.3, poses: [pose(-12, 29.5, 3.7, ACROSS), pose(-6, 30.5, 2.2, ACROSS), pose(54.5, 32, 3.7, ALONG)] },
        { look: 'quonset', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(25, -13, 3.2, ACROSS), pose(30, -19, 3.2, ACROSS), pose(34, -26, 3.2, ACROSS), pose(51, -27, 3.2, ALONG)] },
        { look: 'bunker', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(0, -10, 3.9, ALONG)] },
        { look: 'guardPost', table: 'armyStores', turnJitter: 0.06, shift: 0.3, poses: [pose(-25.5, -6.5, 1.1, ALONG), pose(8, -28, 1.1, ACROSS), pose(30.5, -29, 1.1, ALONG), pose(68, 11.5, 1.1, ALONG), pose(-14.5, 12, 1.1, ALONG)] },
        {
          look: 'armyTruck',
          table: 'roadWreck',
          turnJitter: 0.45,
          shift: 0.5,
          poses: [
            ...[-26, -22, -18].flatMap((s) => [14.5, 19].map((c) => pose(s, c, 1.1, ALONG))),
            { at: AT(-20, -1.5), r: 1.1, turn: ALONG, shoulder: true },
            { at: AT(16, 1.5), r: 1.1, turn: Math.PI, shoulder: true },
            { at: AT(29, -32.5), r: 1.1, turn: ALONG, shoulder: true },
            { at: AT(-28, 18.5), r: 1.1, turn: 0.6, shoulder: true },
          ],
        },
        { look: 'armyCache', table: 'armyStores', turnJitter: 0.3, shift: 0.3, poses: [pose(32.5, 7.5, 0.9, ALONG), pose(24, -5.5, 0.9, ACROSS), pose(21, -34, 0.9, ALONG), pose(43, 5.5, 0.9, ALONG)] },
      ],
      pads: [
        { at: AT(-22, 16), size: { x: 12, y: 10 }, turn: ALONG },
      ],
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
      groves: { look: 'deadTree', rowGap: 3, treeGap: 1.5, jitter: 0.3, missing: 0.12, radius: 0.35, maxTrees: 750, keep: 0.7, strays: 180 },
      blocks: [
        block(20.2, 26.2, 4.6, 16.5, 'across', 0.02),
        block(12.8, 21, 21, 32, 'along', -0.03),
        block(-0.5, 8.2, 21, 31.5, 'along', 0.02),
        block(-7.5, 1.5, 10, 19.5, 'across', -0.02),
        block(-33, -16.5, 4.6, 7.6, 'along', 0.01),
        block(-29, -19.5, 28.5, 32.5, 'along', -0.02),
        block(8, 16.4, -5, -20, 'across', 0.02),
        block(33, 45, -4.6, -9, 'along', -0.02),
        block(44, 55, -4.6, -13.5, 'across', 0.05),
        block(41, 56, -16.5, -22, 'along', 0.04),
        block(-23.5, -12.3, -6.6, -22.3, 'across', -0.02),
        block(-8, 1.5, -23.5, -29.3, 'along', 0.06),
        block(40, 50.5, 14.3, 33.5, 'along', 0.03),
        block(64.5, 70.6, 15.5, 39, 'across', -0.03),
        block(52.8, 57.8, 12.5, 23, 'along', 0.05),
      ],
      runs: [
        { ...FENCE, points: [AT(-25, -9.5), AT(-25, -23)] },
        { ...FENCE, points: [AT(71.6, 11), AT(71.6, 39)] },
        { ...FENCE, points: [AT(-1, 32.75), AT(8.7, 32.75)] },
        { ...FENCE, points: [AT(12.8, 33), AT(21, 33)] },
        { ...FENCE, points: [AT(44, -14.5), AT(55, -14.5)] },
        { ...FENCE, points: [AT(7, -21), AT(16.4, -21)] },
        { ...FENCE, points: [AT(-29, 33.4), AT(-19.5, 33.4)] },
        { ...BARRIER, points: [AT(-8, 2.25), AT(8, 2.25)] },
        { ...BARRIER, points: [AT(-8, -2.25), AT(8, -2.25)] },
        { ...BARRIER, points: [AT(-31, 2.25), AT(-28, 2.25)] },
        { ...BARRIER, points: [AT(-28, -2.25), AT(-25, -2.25)] },
        { ...BARRIER, points: [AT(-25, 2.25), AT(-22, 2.25)] },
        { ...BARRIER, points: [AT(27.5, -8.5), AT(32.5, -8.5)] },
        { ...BARRIER, points: [AT(36.2, -9.5), AT(37, -20.5)] },
        { ...BARRIER, points: [AT(16.8, -11), AT(17.9, -22)] },
        { ...BARRIER, points: [AT(2.3, -22.5), AT(2.3, -30)] },
        { ...BARRIER, points: [AT(-11.8, -7), AT(-11.8, -21)] },
        { ...BARRIER, points: [AT(59, 9), AT(59, 22)] },
        { ...BARRIER, points: [AT(57, 4.4), AT(62, 4.6)] },
        { ...PERIMETER, points: [AT(-25.5, -11), AT(-25.5, -15), AT(-24.5, -20)] },
        { ...PERIMETER, points: [AT(-22, -23.8), AT(-19.5, -25.5), AT(-16, -26.2)] },
        { ...PERIMETER, points: [AT(-33.8, 8.5), AT(-33.5, 11.5)] },
        { ...PERIMETER, points: [AT(69, 16), AT(69, 26)] },
        { ...PERIMETER, points: [AT(69, 30), AT(69, 39)] },
      ],
      emplacements: [
        dig(-27, -14, NORTH, 2, 0),
        dig(-19, -27, SOUTH_WEST, 1, 1),
        dig(-13, -26.5, NORTH, 2, 3),
        dig(-9, -5, NORTH, 3, 1),
        dig(-12, 5, SOUTH, 2, 1),
        dig(-4, 5, WEST, 3, 3),
        dig(6, 5, NORTH, 3, 3),
        dig(1, 7, NORTH, 3, 0),
        dig(3, -18, NORTH_WEST, 2, 1),
        dig(-1, -18, NORTH, 1, 0),
        dig(-9, -18, EAST, 1, 1),
        dig(18, 8, NORTH, 2, 0),
        dig(8, -23, WEST, 2, 1),
        dig(14, -28, NORTH_EAST, 3, 3),
        dig(15, -23, NORTH_EAST, 2, 2),
        dig(12, -33, EAST, 2, 0),
        dig(31, -6, NORTH, 1, 0),
        dig(23, -24, NORTH_EAST, 2, 2),
        dig(41, -30, NORTH, 3, 2),
        dig(42, -25, SOUTH_WEST, 2, 0),
        dig(50, -41, WEST, 3, 3),
        dig(44, -39, NORTH_EAST, 2, 1),
        dig(-10, 20, NORTH, 2, 1),
        dig(53, 1, NORTH_EAST, 2, 2),
        dig(48, 7, NORTH_EAST, 2, 0),
        dig(38, 9, NORTH, 3, 1),
        dig(35, 12, EAST, 2, 0),
        dig(-28, 4.6, SOUTH, 2, 0),
        dig(24, 21, EAST, 3, 1),
        dig(31, 23, NORTH, 3, 0),
        dig(38, 23, NORTH, 3, 0),
        dig(70, 41, NORTH, 1, 0),
      ],
      clutter: [
        { look: 'drums', count: 6, radius: [0.4, 0.48], near: ['armyTruck', 'quonset'], reach: 4 },
        { look: 'woodpile', count: 8, radius: [0.6, 0.7], near: ['barn', 'farmhouse'], reach: 4 },
        { look: 'junk', count: 10, radius: [0.8, 1.1], near: ['barn', 'armyTruck', 'farmhouse'], reach: 5 },
        { look: 'barrier', count: 10, radius: [0.5, 0.5], near: ['quonset', 'guardPost', 'bunker'], reach: 4 },
      ],
    },
    glass: null,
    spotGap: 6,
    debrisGap: 3,
    reactor: null,
    relief: 0.1,
  },
  'glass-flats': {
    seed: 2,
    wreck: {
      pieces: [
        { look: 'engineNozzle', at: { x: -3.5, y: -0.4 }, yaw: -0.27, r: NOZZLE_R },
        { look: 'engineFrame', at: { x: -1.5, y: -8.5 }, yaw: -0.75, r: FRAME_R },
        { look: 'watchtower', at: { x: -5.5, y: -11 }, yaw: 0.1, r: TOWER_R },
        tower(-10.5, 0.5, -14.5, 3.5, -0.2),
        tower(-9, 9.8, -12.5, 7.3, 0.3),
        tower(-13.3, -8.8, -15, -4.8, 0),
        tower(2.1, -18, -1.6, -15.5, 0.15),
        tower(11.5, -8.5, 8.8, -12.5, -0.1),
        tower(12, 2.5, 8.4, 4.9, 0.2),
        tower(2.2, 10.8, -0.8, 13.9, -0.15),
      ],
      caches: [
        { at: { x: -1.6, y: -0.9 } },
        { at: { x: -1.5, y: -8.5 } },
        { at: { x: -6.2, y: -4.6 } },
      ],
      cacheLook: 'hullCache',
      cacheTable: 'engineScrap',
      cacheRadius: 0.7,
      patches: [
        { at: wide(18, -27), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(26, -3), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(1, 22), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(-20, 19), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(-19, -12), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(30, -17), radius: 8, debris: RUINS, spots: 1 },
        { at: wide(9, -36), radius: 8, debris: RUINS, spots: 1 },
        { at: { x: -5, y: -15 }, radius: 4.5, debris: ENGINE_DEBRIS, spots: 0 },
      ],
      spotLook: 'deadTruck',
      spotTable: 'roadWreck',
      spotRadius: [0.6, 0.8],
      buildings: [
        {
          look: 'ruinCompound',
          table: 'cityStores',
          turnJitter: 0.06,
          shift: 0.3,
          poses: [
            compound(-9, 9.8, ALONG_Y),
            compound(-10.5, 0.5, ALONG_X),
            compound(-3.5, 10.5, ALONG_X),
            compound(-13.3, -8.8, ALONG_Y),
            compound(2.1, -18, ALONG_X),
            compound(11.5, -8.5, ALONG_Y),
            compound(12, 2.5, ALONG_X),
            compound(2.2, 10.8, ALONG_Y),
            compound(-23, 2, ALONG_Y),
            compound(4, -26.3, ALONG_X),
            compound(-10.5, 20, ALONG_Y),
          ],
        },
      ],
      seatEase: 3,
      rimRocks: null,
      scree: null,
      roads: [
        townRoad(LANE, [CROSSROADS, [0, 5], [-10, 5.5], [-16.5, 5]]),
        townRoad(LANE, [CROSSROADS, [5, -6], [6.5, -12], [7, -21.5]]),
        townRoad(LANE, [CROSSROADS, [9, -2], [16, -5]]),
        townRoad(LANE, [CROSSROADS, [6.5, 7], [6.5, 16.6]]),
        townRoad(RING, [[16, -5], [16.5, -9], [13, -18.5], [7, -21.5], [-5, -20.5], [-12, -17], [-17.5, -11.5], [-19, -2], [-16.5, 5], [-13.5, 13], [-5, 17.5], [3.5, 18], [11, 14.5], [17.4, 10], [17.2, 4], [16, -5]]),
        townRoad(LANE, [[-12, -17], { x: -8.5, y: -10 }, { x: -8.5, y: -5.5 }]),
        townRoad(LANE, [GLASS_FLATS_ENDS[0], [11, 14.5]]),
        townRoad(LANE, [GLASS_FLATS_ENDS[1], [13, -18.5]]),
      ],
      spurs: [dirt(LANE, [wide(-13.5, 13), [-60, 40], [-82, 55]])],
      spurFade: 5,
      decks: [],
      landing: 0,
    },
    farm: null,
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

function fallenSunCentre(): Vec {
  const site = REGION.locations.find((l) => l.id === 'fallen-sun');
  if (!site) throw new Error('The Fallen Sun location is missing from REGION');
  return site.pos;
}

export const FALLEN_SUN_DECKS: (DeckSpec & Pick<WreckDeck, 'look'>)[] = fallenSunWreck().decks.map((d) => {
  const c = fallenSunCentre();
  const line = d.line.map((s) => ({ at: { x: c.x + s.at.x, y: c.y + s.at.y }, rise: s.rise }));
  return { id: d.id, line, width: d.width, look: d.look, cut: null, skirt: true };
});
