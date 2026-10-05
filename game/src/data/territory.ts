// Territories: open ground full of loot spots and debris. The bake places the props, the sim reads the rest.
// A territory is a location of kind "territory" in src/data/region.ts, keyed here by its id.

import type { PropKind } from '../sim/terrain';
import type { Vec } from '../sim/vec';
import { onOrchardRoad } from './region';

export { onOrchardRoad };

export type SpotTable = 'landmark' | 'hullScrap' | 'roadWreck' | 'farmStores' | 'armyStores';
// Loot spots that are wrecks, so their prompts keep wreck wording. Every other loot spot is a plain place.
export const WRECK_LOOKS: readonly PropKind[] = ['armyTruck', 'shipCache', 'deckBay'];
export type DebrisRule = { look: PropKind; count: number; radius: [number, number] };
export type SpotRule = {
  look: PropKind; // the prop kind that is a loot spot
  count: number;
  band: [number, number]; // inner and outer distance from the spine, as shares of spine.band
  radius: [number, number]; // tiles, the prop's footprint
  table: SpotTable; // the SALVAGE table each spot rolls
};
export type Hazard = {
  radius: number; // tiles around the territory centre
  healthPerTurn: number;
  floor: number; // driver health the hazard never takes anyone below
};
// A tilted rectangle of hull a truck drives up. Its low end meets the ground and it climbs evenly to its high end.
export type HullSection = {
  id: string;
  at: Vec; // tiles from the territory centre to the deck's middle
  yaw: number; // radians from map +x toward +y, pointing from the low end to the high end
  length: number; // tiles from the low end to the high end
  width: number; // tiles across
  rise: number; // height units of the high end above the ground at the low end
  ribStep: number | null; // tiles between ribs along the deck, from the low end; null for a deck without ribs
  bays: number[]; // shares of the length from the low end where a loot spot stands
};
// A straight piece of plating standing on its side. It is cover, not a deck.
export type HullWall = {
  at: Vec; // tiles from the territory centre to the wall's middle
  yaw: number; // radians, along the wall
  length: number; // tiles
};
// A wrecked hull: tilted decks with loot bays, ribs over them and walls of plating.
export type HullRules = {
  sections: HullSection[];
  walls: HullWall[];
  ribInset: number; // tiles from a deck side in to a rib leg, so a leg stands on the deck and not on its dropping edge
  bayTable: SpotTable; // the SALVAGE table a loot spot in a deck bay rolls
  bayRadius: number; // tiles, the footprint of a deck bay's loot spot
};
// An authored farm laid out in its road's frame. Every at and point is tiles from the territory centre, written as
// onOrchardRoad(s, c); every turn is radians from the road's heading; every size is tiles along and across the road.
// Authored parts must lie inside the territory's outline. Each group's comment says who put it there and why.
export type FarmRules = {
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
export type TerritoryRules = {
  seed: number; // offset of the territory's own draws, so adding a territory shifts no other's
  // The line the territory lies along, in tiles from the centre; band is the tiles to each side of the line where
  // field spots and debris are drawn.
  spine: { from: Vec; to: Vec; band: number };
  hull: HullRules | null;
  farm: FarmRules | null;
  debris: DebrisRule[];
  spots: SpotRule[]; // field spots, drawn in the band
  grounds: [number, number]; // inner and outer share of spine.band where raiders and vultures wait beside the spine
  spotGap: number; // tiles between the centres of two loot spots
  debrisGap: number; // tiles of open ground kept between debris and every loot spot, so a truck can park beside one
  reactor: { look: PropKind; radius: number } | null; // the prop at the centre
  hazard: Hazard | null;
};

// The Fallen Sun broke its back along one line from the north-west rim to the south-east rim.
const SUN_CRASH = { from: { x: -40, y: -18 }, to: { x: 40, y: 18 } };
const SUN_HEADING = Math.atan2(SUN_CRASH.to.y - SUN_CRASH.from.y, SUN_CRASH.to.x - SUN_CRASH.from.x);

// A point s tiles along the crash line from the centre (toward the south-east) and c tiles across it (toward the
// south-west side), in tiles from the centre.
function onSunLine(s: number, c: number): Vec {
  const [cos, sin] = [Math.cos(SUN_HEADING), Math.sin(SUN_HEADING)];
  return { x: s * cos - c * sin, y: s * sin + c * cos };
}

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
    spine: { ...SUN_CRASH, band: 14 },
    hull: {
      // Read from north-west to south-east. Sections keep 10 tiles from the centre, 2 past the hazard, and leave
      // the floor to the south-west and north-east open for the roads.
      sections: [
        // The bow is nose-up: its broken aft end is buried, its torn bow end is 8 m up over the north-west floor. The
        // floor climbs about 1 unit toward the rim under it, so the rise is 3.
        { id: 'bow', at: onSunLine(-32, -2), yaw: SUN_HEADING + Math.PI, length: 22, width: 9, rise: 3, ribStep: 4, bays: [0.3, 0.6, 0.85] },
        // The forward hull slid off the line to the south-west. It is nearly flat and overlooks the reactor pit.
        { id: 'forward', at: onSunLine(-17, 9.5), yaw: SUN_HEADING, length: 14, width: 8, rise: 0.6, ribStep: 4, bays: [0.3, 0.7] },
        // The aft hull tilts up toward the south-east. The bank climbs up to 2 units under it, so its rise of 3.6 keeps
        // the deck clear of the bank and its high end 5 to 7 m over it. Its bays sit between ribs, since a bay under a
        // rib leaves no way past between the rib legs and the cliff sides.
        { id: 'aft', at: onSunLine(19, -2), yaw: SUN_HEADING, length: 16, width: 8, rise: 3.6, ribStep: 4, bays: [0.375, 0.625] },
        // Two plates thrown off the line, small ramps that climb back toward it: sniper perches. They are 7 tiles wide,
        // so a truck passes the bay in the middle and drives on up to the top.
        { id: 'plate-ne', at: onSunLine(4, -26), yaw: SUN_HEADING + Math.PI / 2, length: 8, width: 7, rise: 1, ribStep: null, bays: [0.6] },
        { id: 'plate-sw', at: onSunLine(-4, 26), yaw: SUN_HEADING - Math.PI / 2, length: 8, width: 7, rise: 1, ribStep: null, bays: [0.6] },
      ],
      // The stern: plating rolled onto its side in a broken wall past the aft hull.
      walls: [
        { at: onSunLine(30, 2), yaw: SUN_HEADING + 0.15, length: 2 },
        { at: onSunLine(32.2, 1.2), yaw: SUN_HEADING - 0.1, length: 2 },
        { at: onSunLine(34.4, 2.2), yaw: SUN_HEADING + 0.2, length: 2 },
        { at: onSunLine(36.6, 1), yaw: SUN_HEADING, length: 2 },
        { at: onSunLine(38.8, 2.4), yaw: SUN_HEADING - 0.15, length: 2 },
        { at: onSunLine(40.8, 1.4), yaw: SUN_HEADING + 0.1, length: 2 },
      ],
      ribInset: 0.5,
      // Deck bays are exposed on high ground, so they roll the rich landmark table, the whole site's stock before.
      bayTable: 'landmark',
      // A bay is a stack of crates the size of a field spot, small enough that a truck drives round it on the deck.
      bayRadius: 0.7,
    },
    farm: null,
    // Debris gives cover, ambush lines and places to hide. Tanks are the stern's thruster housings.
    debris: [
      { look: 'hullChunk', count: 30, radius: [1.2, 2] },
      { look: 'hullRib', count: 8, radius: [0.8, 1.2] },
      { look: 'carWreck', count: 10, radius: [0.6, 0.8] },
      { look: 'tank', count: 3, radius: [1.2, 1.6] },
    ],
    // Field spots roll a scrap-heavy table at road-wreck size. With the 9 deck bays the Fallen Sun keeps 24 spots.
    spots: [{ look: 'shipCache', count: 15, band: [0.3, 1], radius: [0.6, 0.8], table: 'hullScrap' }],
    // Through the band of the field spots, where scavengers come.
    grounds: [0.3, 1],
    spotGap: 6,
    debrisGap: 3,
    reactor: { look: 'reactor', radius: 3 },
    hazard: {
      radius: 8,
      // The starving rule (RULES.starveDamage 5 per turn, floor RULES.starveFloor 30) anchors both numbers: it is the
      // one other non-combat health drain, and it never kills by itself.
      healthPerTurn: 5,
      floor: 30,
    },
  },
  orchard: {
    seed: 1,
    // The old road through the basin. Field spots and debris are drawn along it, and raiders wait beside it.
    spine: { from: AT(-30, 0), to: AT(44, 0), band: 30 },
    hull: null,
    farm: {
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
    // Debris along the road band: loose junk and old car wrecks scavengers stripped and pushed off the roads.
    debris: [
      { look: 'junk', count: 5, radius: [0.8, 1.2] },
      { look: 'carWreck', count: 4, radius: [0.6, 0.8] },
    ],
    // The orchard's caches are authored with its buildings: its groves leave no open band to draw them in.
    spots: [],
    // Beside the old road, between it and the groves' outer rows.
    grounds: [0.3, 1],
    spotGap: 6,
    debrisGap: 3,
    reactor: null,
    hazard: null,
  },
};
