// Terrain: corner heights, tile types, driving costs and fog of war.
// Heights are in height units; one unit rises reliefPx screen pixels. Slopes are height units per tile.

import { PHYSICS } from "./physics";
import { BROKEN_WING, BROKEN_WING_POINT, FALLEN_SUN_POS, MAP_SCALE, REGION, scalePoint } from "./region";
import { FALLEN_SUN_DECKS } from "./territory";
import type { Vec } from "../sim/vec";

export type TerrainTypeId =
  | "road"
  | "hardpan"
  | "sand"
  | "scrub"
  | "scree"
  | "mud"
  | "gravel"
  | "saltCrust"
  | "asphalt"
  | "ash"
  | "field"
  | "dirtyWater"
  | "toxic"
  | "track"
  | "canal"
  | "concrete"
  | "glass";

export type TerrainType = {
  id: TerrainTypeId;
  name: string;
  speed: number;
  wear: number; // multiplies part wear per tile driven
  dust: number; // multiplies the range a moving truck's dust trail is seen from
  color: number;
  craters: boolean; // whether an exploding round leaves a crater here; false on water
  rut: number; // 0..1 darkness of the tire marks a truck leaves here; 0 leaves none
};

// The order is the map file's type codes (TYPE_IDS in src/sim/terrain.ts): a reorder or removal bumps its VERSION.
export const TERRAIN_TYPES: Record<TerrainTypeId, TerrainType> = {
  road: { id: "road", name: "Road", speed: 1, wear: 0.5, dust: 0.3, color: 0xa8865a, craters: true, rut: 0 },
  hardpan: { id: "hardpan", name: "Hardpan", speed: 0.9, wear: 1, dust: 1, color: 0xc8a676, craters: true, rut: 0.5 },
  sand: { id: "sand", name: "Loose sand", speed: 0.7, wear: 1.2, dust: 1.3, color: 0xdcc08c, craters: true, rut: 0.8 },
  scrub: { id: "scrub", name: "Scrub", speed: 0.8, wear: 1.3, dust: 0.7, color: 0xa89a66, craters: true, rut: 0.6 },
  scree: { id: "scree", name: "Scree", speed: 0.55, wear: 2, dust: 0.5, color: 0x9a8a78, craters: true, rut: 0.2 },
  mud: { id: "mud", name: "Mud", speed: 0.45, wear: 1.5, dust: 0.1, color: 0x665044, craters: true, rut: 1 },
  gravel: { id: "gravel", name: "Gravel", speed: 0.85, wear: 1.4, dust: 0.8, color: 0x9e9489, craters: true, rut: 0.3 },
  saltCrust: { id: "saltCrust", name: "Salt crust", speed: 0.95, wear: 0.8, dust: 1.2, color: 0xe0d8ba, craters: true, rut: 0.5 },
  asphalt: { id: "asphalt", name: "Cracked asphalt", speed: 0.98, wear: 0.6, dust: 0.3, color: 0x55565b, craters: true, rut: 0 },
  ash: { id: "ash", name: "Ash", speed: 0.6, wear: 1, dust: 1.6, color: 0x77737a, craters: true, rut: 0.8 },
  // Dead fields: dry furrowed dirt. Furrows slow a truck like scrub and shake it a little more than
  // hardpan, and the tilled dirt throws more dust than hardpan.
  field: { id: "field", name: "Dead field", speed: 0.8, wear: 1.1, dust: 1.4, color: 0x8e6e4a, craters: true, rut: 0.8 },
  // Pools: shallow standing water over a mud bottom, so both drag a truck like mud and raise no dust.
  // Toxic sludge eats at parts more than plain mud. Both wears stay below scree, the roughest ground.
  dirtyWater: { id: "dirtyWater", name: "Dirty water", speed: 0.45, wear: 1.5, dust: 0.1, color: 0x55583a, craters: false, rut: 0 },
  toxic: { id: "toxic", name: "Toxic pool", speed: 0.45, wear: 1.8, dust: 0.1, color: 0x9aa83c, craters: false, rut: 0 },
  // Dirt tracks: hardpan packed pale by wheels, the farm tracks of the Old Orchard. It drives like hardpan and only
  // looks paler than both hardpan and sand, so the tracks read from the camera.
  track: { id: "track", name: "Dirt track", speed: 0.9, wear: 1, dust: 1, color: 0xa88458, craters: true, rut: 0 },
  // Irrigation canals: shallow water in a concrete channel, the Old Orchard's canals. A truck in one drags and wears
  // like dirty water. Its blue-grey shows the concrete and the clear water apart from the olive dirty pools.
  canal: { id: "canal", name: "Irrigation canal", speed: 0.45, wear: 1.5, dust: 0.1, color: 0x5f6f7a, craters: false, rut: 0 },
  // Concrete pads: the poured slabs of the Old Orchard's motor pool. They drive and wear like cracked asphalt, and
  // their pale grey shows the slab apart from the dark road, as in the concept.
  concrete: { id: "concrete", name: "Cracked concrete", speed: 0.98, wear: 0.6, dust: 0.3, color: 0xa39e94, craters: true, rut: 0 },
  // Fused glass: sand melted flat into plates by a crashed ship's engine, at Glass Flats. Smooth plates roll nearly as
  // fast as salt crust and wear parts like it, less than hardpan, with little loose dust. Its pale teal-grey shows
  // the plates apart from the ochre sand and from the darker olive water.
  glass: { id: "glass", name: "Fused glass", speed: 0.95, wear: 0.8, dust: 0.3, color: 0x86ada3, craters: true, rut: 0.1 },
};

// A deck station: a map point on the deck's axis and the deck line's rise there, in height units over the ground.
export type DeckStation = { at: Vec; rise: number };

// A straight deck, one drivable surface. line runs from its from end to its to end through stations on the straight
// line between them, in order: the deck line stands each station's rise over the ground there and runs straight between
// neighbouring stations, so one deck can climb, run level and come down. width is tiles between its two rails. cut,
// when set, removes the road's flattening in the gap under the deck: abutment is tiles of causeway left under each
// deck end, and ramp tiles over which the cut ground falls away. skirt makes the physics rails reach down past the
// lowest ground beside the deck, so trucks on open ground cannot drive in under it. An end raised over the ground is a
// lip a truck drives off and flies from. A deck with a raised station is skirted, and no deck touches another: a
// surface is never split into decks (buildDecks() in src/sim/bridge.ts throws).
export type DeckSpec = {
  id: string;
  line: DeckStation[];
  width: number;
  cut: { abutment: number; ramp: number } | null;
  skirt: boolean;
};

// Canyon Bridge: the road's causeway is cut away under the deck, so the canyon runs below it.
const CANYON_BRIDGE: DeckSpec = {
  id: "canyon-bridge",
  line: [
    { at: scalePoint({ x: 97.9, y: 75.1 }), rise: 0 },
    { at: scalePoint({ x: 101.5, y: 71.5 }), rise: 0 },
  ],
  width: 8, // the widest truck keeps its clearance from both rails
  cut: { abutment: 1, ramp: 1.5 },
  skirt: false,
};

// The Broken Wing deck: the wing's top, with the road on it. The road's flattening stays under it, so the graded
// road dips between the two ramps and the ground cannot rise through the deck. Its skirt is the wing's lattice
// and pylons, so trucks on the ground beside it cannot drive in under it.
const WING_DECK: DeckSpec = {
  id: "broken-wing",
  line: [
    { at: BROKEN_WING_POINT(-BROKEN_WING.deckHalf, 0), rise: 0 },
    { at: BROKEN_WING_POINT(BROKEN_WING.deckHalf, 0), rise: 0 },
  ],
  width: REGION.roadWidth, // as wide as the road, from the concept art: about 4 truck lengths
  cut: null,
  skirt: true,
};

// A raised bowl: a crater with its depth turned to height, cut by the same rule. Roads do not flatten it, and road
// grading turns it into a ramp at the road grade. radius is the flat top's, bank the tiles it falls over, and height
// is in height units, after heightFromElevation() in src/sim/terrain.ts, so a mound is as tall on any ground.
export type Mound = { center: Vec; radius: number; bank: number; height: number };

// Broken Wing's two ramps, one past each deck end.
const WING_MOUNDS: Mound[] = [-1, 1].map((end) => ({
  center: BROKEN_WING_POINT(end * (BROKEN_WING.deckHalf + BROKEN_WING.mound.gap), 0),
  radius: BROKEN_WING.mound.flat,
  bank: BROKEN_WING.mound.bank,
  height: BROKEN_WING.mound.height,
}));

const TRENCH = BROKEN_WING.trench;

// An irregular crater that owns its floor: inside the floor polygon the land is one level, the land at center less
// depth (elevation units; a negative depth lifts the floor over the land there), plus its swells. Across a bank the
// land fades back from that level to its own. floor points are tiles from center. bank (tiles) and rim (height units the lip stands over the land outside) are per
// floor vertex, and blend along each edge between its two vertices. The lip rises with the bank to the rim at the
// bank's top, then falls back to the land over as many tiles again. floorRelief adds swells of up to amplitude height
// units across the floor, fading out over the bank, at frequency cycles per tile. See basin() in src/sim/elevation.ts.
export type Basin = {
  center: Vec;
  floor: Vec[];
  bank: number[];
  rim: number[];
  depth: number;
  floorRelief: { frequency: number; amplitude: number };
};

// The Fallen Sun's basin, traced around the level concept's crater frame and the second reference's crags, gap and east
// hill (tmp/issue-81/r4/layout.md). The floor lies at about -0.2 height units, 2 over the land at the centre, so the
// three approach roads come down to it at their road grade and it lies above GEOLOGY.sandStart.below: a floor under
// that line starts with blown sand, which the wind piles into dune ridges across every dirt road. The land behind the
// crags stands near the floor's level, so a cliff arc's face is mostly its rim: 1.5 x 5 / 3.5 = 2.1 per tile at the
// steepest, far over drive.maxSlope.
const FALLEN_SUN_BASIN: Basin = {
  center: FALLEN_SUN_POS,
  floor: [
    { x: -45.0, y: 0.0 }, // v0 180 deg: the west scree, the concept's red-brown hills (upper left)
    { x: -41.3, y: -15.0 }, // v1 -160: the scree hills, WNW
    { x: -32.2, y: -27.0 }, // v2 -140: the second reference's left crag wall starts, a cliff
    { x: -21.7, y: -34.8 }, // v3 -122: left crag wall
    { x: -11.9, y: -41.3 }, // v4 -106: left crag wall's east end; the NE drum sinks at its foot
    { x: -6.3, y: -44.6 }, // v5 -98: the north notch, the reference's gap between its crags, west side
    { x: 1.6, y: -45.0 }, // v6 -88: the north notch, east side
    { x: 7.5, y: -42.3 }, // v7 -80: the right crag wall
    { x: 15.8, y: -48.5 }, // v8 -72: right crag's south foot, 6 tiles past the bow nose
    { x: 28.6, y: -45.8 }, // v9 -58: the north-east wall behind the bow nose
    { x: 38.9, y: -38.9 }, // v10 -45: the north-east wall behind the small drum
    { x: 45.9, y: -26.5 }, // v11 -30: the east road comes in
    { x: 50.2, y: -8.9 }, // v12 -10: the east hill, the second reference's bottom-right hill
    { x: 50.2, y: 8.9 }, // v13 10: the east hill
    { x: 45.3, y: 21.1 }, // v14 25: ESE, where the hill falls away
    { x: 39.8, y: 33.4 }, // v15 40: the south-east road
    { x: 25.5, y: 44.2 }, // v16 60: the concept's open south-east bottom
    { x: 8.2, y: 46.3 }, // v17 80: the open south
    { x: -8.3, y: 47.3 }, // v18 100: the furrow's mouth
    { x: -23.5, y: 40.7 }, // v19 120: the furrow's mouth, west lip
    { x: -37.7, y: 26.4 }, // v20 145: south-west
    { x: -43.5, y: 11.6 }, // v21 165: where the west road comes in, scree
  ],
  // The cliff arc v2..v4 and v7..v10 is steep, with the notch's long drivable bank between. The east hill's own inner
  // face stays under maxSlope. The east road's bank at v11 is 52 tiles and the south-east road's at v15 is 40, so each
  // road comes down from its own land to the floor at its road grade. The open south banks keep a dirt road under 0.2.
  bank: [12, 10, 4, 3.5, 3.5, 30, 30, 3.5, 3.5, 4, 4, 52, 16, 16, 30, 40, 36, 28, 26, 26, 22, 30],
  rim: [1.0, 1.5, 5.0, 5.5, 5.5, 0, 0, 5.5, 5.5, 5.0, 4.5, 0, 2.0, 2.0, 0.5, 0, 0, 0, 0, 0, 0.5, 0],
  depth: -1.06, // lifts the floor from the land's -2.2 at the centre to -0.2
  // Swells about 16 tiles apart, kept low so a road over them stays under a grade of 0.2.
  floorRelief: { frequency: 1 / 16, amplitude: 0.45 },
};

// A point in tiles from the Fallen Sun's centre, on the map.
function fromFallenSun(p: Vec): Vec {
  return { x: FALLEN_SUN_POS.x + p.x, y: FALLEN_SUN_POS.y + p.y };
}

export const TERRAIN = {
  // Elevation noise: a fractal sum of value-noise octaves. freq is cycles per tile.
  // seedOffset keeps each octave sampling a different part of the hash space.
  octaves: [
    { freq: 1 / (32 * MAP_SCALE), amp: 1.0, seedOffset: 0 },
    { freq: 1 / (14 * MAP_SCALE), amp: 0.7, seedOffset: 1000 },
    { freq: 1 / (5 * MAP_SCALE), amp: 0.38, seedOffset: 2000 },
    { freq: 1 / 7, amp: 0.14, seedOffset: 3000 },
  ],
  // Tiles of falloff from a road edge, town edge or location edge down to zero elevation.
  // Keeps bends and junction approaches drivable without flattening remote landforms.
  flattenMargin: 15,
  // Steepest height change per tile along any road. A loaded hauler still gains speed on 0.2, and
  // blends at junctions add a little across the road.
  roadGrade: 0.12,
  // Steepest height change per tile of a cutting or bank beside a road: below the scree slope.
  bankGrade: 0.3,
  // Tiles beside a territory's farm road over which its grading blends back to the ground, so ridges stay ridges.
  farmGradeMargin: 4,
  // Tiles round a levelled building pad over which the pad blends back to the ground.
  levelMargin: 4,
  // Noise elevation e (about -1..1) becomes height: e * hill, plus (e - mountainFrom) * mountain above
  // mountainFrom. The steep extra term makes mountain faces too steep to drive.
  height: { hill: 2.1, mountainFrom: 0.32, mountain: 11 },
  relief: { broadFrequency: 1 / 65, broadAmplitude: 2.4, ridgeFrequency: 1 / 18, ridgeAmplitude: 1.2 },
  // Fixed landforms shared by elevation and ground paint. Width is the flat channel half-width.
  features: {
    canyon: {
      path: [
        scalePoint({ x: 88, y: 5 }),
        scalePoint({ x: 86, y: 23 }),
        scalePoint({ x: 92, y: 49 }),
        scalePoint({ x: 99, y: 69 }),
        scalePoint({ x: 103, y: 99 }),
      ] as Vec[],
      width: 7,
      bank: 18,
      depth: 2.9,
    },
    // Broken Wing's crash trench, a channel beside the wing, past the reach of the road's flattening.
    trench: {
      path: [BROKEN_WING_POINT(-TRENCH.half, TRENCH.side), BROKEN_WING_POINT(TRENCH.half, TRENCH.side)] as Vec[],
      width: TRENCH.width,
      bank: TRENCH.bank,
      depth: TRENCH.depth,
    },
    // The Fallen Sun's crash furrow (inferred: no reference shows it): gouged from the basin's open south rim toward the
    // south-south-west, 44 tiles long, where the ship came in. It starts 58 tiles out, so its round head stays outside
    // the floor and the south bank dips into it. 12 tiles each side hold the wing and a lane with a flap beside it.
    furrow: {
      path: [{ x: -15.0, y: 56.0 }, { x: -20.7, y: 77.3 }, { x: -26.4, y: 98.5 }].map(fromFallenSun),
      width: 12,
      bank: 12,
      depth: 0.5,
    },
    // Straight decks: the road decks, each between two road points, then the Fallen Sun's. See src/sim/bridge.ts.
    decks: [CANYON_BRIDGE, WING_DECK, ...FALLEN_SUN_DECKS] as readonly DeckSpec[],
    // Broken Wing's hoop: the wing's torn root bent up over the road, a baked prop at its built size. Its feet stand
    // beside the road and its boxes over the road start high, so trucks pass under it. pos and yaw come from
    // BROKEN_WING, and r is the model's bake circle in tiles: 26.5 m.
    wing: {
      pos: BROKEN_WING_POINT(BROKEN_WING.hoopAt, 0),
      r: 26.5 / PHYSICS.metersPerTile,
      yaw: BROKEN_WING.yaw,
    },
    dryRiver: {
      path: [
        scalePoint({ x: 7, y: 75 }),
        scalePoint({ x: 28, y: 80 }),
        scalePoint({ x: 48, y: 87 }),
        scalePoint({ x: 58, y: 91 }),
        scalePoint({ x: 70, y: 98 }),
        scalePoint({ x: 80, y: 111 }),
      ] as Vec[],
      width: 5,
      bank: 20,
      depth: 1.3,
    },
    craters: [
      {
        center: scalePoint({ x: 16, y: 94 }),
        radius: 34,
        bank: 24,
        depth: 1.4,
      },
    ] as { center: Vec; radius: number; bank: number; depth: number }[],
    basins: [FALLEN_SUN_BASIN] as Basin[],
    mounds: WING_MOUNDS,
  },
  reliefPx: 45, // screen pixels per height unit
  // Tile types. Roads and sites first, then old-world and new-world marks, then steep ground and the
  // geology marks in GEOLOGY.ground, then hardpan.
  types: {
    screeSlope: 0.35, // slope from which ground is scree
    siteMargin: 1, // tiles around towns and locations that count as hardpan
  },
  // Driving: grade is the slope along the driving direction.
  drive: {
    maxSlope: 0.6, // tiles steeper than this are cliffs: impassable
  },
  // Light direction in map space for hillshade, upper-left of the screen.
  light: { x: -0.6, y: -0.8 },
  slopeShade: 0.9, // how strongly slope alignment with the light brightens or darkens ground
  vision: {
    radius: 20, // tiles of sight from any vehicle, before weather and night
    eyeHeight: 0.6, // height units above the ground for the viewer and targets, a truck cab at 2.4 m; hills taller than this block sight
    samplesPerTile: 3, // height samples per tile along a sight line
    closeRadius: 3, // tiles around a vehicle seen even behind rocks and hills, since its crew hears and sees over them
    lingerTurns: 2, // turns a vehicle stays drawn, moving, after the player loses sight of it
    grayFactor: 4, // gray vision reaches this many sight radii: ground and buildings show grey, vehicles do not, and nothing shows beyond
  },
  fog: {
    seen: { grey: 0.85, bright: 0.9 }, // explored but not visible now: share of color drained, brightness kept
    unseen: { grey: 1, bright: 0.55 }, // never seen
  },
} as const;

// Geology rules for the map bake. Heights and water are in height units. A slope is height units per
// tile, and a unit and a tile are both 4 m, so a slope is also the tangent of the ground angle.
export type RainRules = {
  steps: number;
  rainPerStep: number;
  focusSquarings: number;
  evaporation: number;
  capacity: number;
  minSlope: number;
  pickupRate: number;
  dropRate: number;
  maxDig: number;
  spreadPasses: number;
  spreadRate: number;
};

export type SlumpRules = {
  steps: number;
  restSlope: number;
  slideShare: number;
};

export type WindRules = {
  direction: number;
  slab: number;
  hop: number;
  depositOnSand: number;
  depositOnBare: number;
  shadowSlope: number;
  shadowReach: number;
  sandSlope: number;
  stepsPerCell: number;
};

// Dune ridges on deep sand. See dunes() in src/mapgen/geology.ts.
export type DuneRules = {
  minSand: number;
  fullSand: number;
  maxSlope: number;
  height: number;
  wavelength: number;
  leeShare: number;
  bend: number;
  bendFrequency: number;
  bendSeedOffset: number;
};

export type SandStart = {
  below: number;
  fade: number;
  depth: number;
};

// Ground types from the geology marks, read per tile from its four corners.
export type GroundRules = {
  washFlow: number;
  gravelSlope: number;
  lakeDepth: number;
  saltDepth: number;
  mudDepth: number;
  looseSand: number;
};

// Boulders on corners at cliff bases and ridge tops.
export type BoulderRules = {
  cliffBase: number;
  ridgeTop: number;
  ridgeCurvature: number;
  radius: [number, number];
  crag: { above: number; radius: [number, number] };
};

export const GEOLOGY: { rain: RainRules; slump: SlumpRules; wind: WindRules; dunes: DuneRules; sandStart: SandStart; ground: GroundRules; boulders: BoulderRules } = {
  rain: {
    steps: 160, // rain passes over the whole map; each pass routes all water to the edge or a pool, so more passes cut deeper
    rainPerStep: 0.01, // units of water falling on every corner per pass, so a gully's water is 0.01 per corner draining into it
    focusSquarings: 3, // water splits between lower neighbors by slope squared this many times, slope^8; mostly down the steepest, so it gathers into gullies
    evaporation: 0.04, // share of water lost at each corner it passes, so a wash dries out about 25 tiles below its sources
    capacity: 4, // soil units carried per unit of water per unit of slope, so steep wet corners cut hardest
    minSlope: 0.02, // slope floor for capacity, so water on near-flats still carries a little soil
    pickupRate: 0.05, // share of the free capacity picked up at each corner; low keeps water hungry, so cuts deepen where water gathers
    dropRate: 0.3, // share of the soil above capacity dropped at each corner, so fans spread over a few tiles below gully mouths
    maxDig: 0.5, // share of the steepest slope down that one corner may dig per pass, so water never digs a pit
    spreadPasses: 2, // passes that spread each rain pass's cuts to side neighbors; gullies come out about 3 to 5 tiles wide
    spreadRate: 0.2, // share of the change difference traded between side neighbors per pass; under 0.25 keeps the spread stable
  },
  slump: {
    steps: 40, // passes over the map; enough for fresh steps to settle into scree slopes
    restSlope: 0.9, // steepest stable slope, about 42 degrees; above cliffs at 0.6, so cliffs stay
    slideShare: 0.5, // share of the excess over the rest slope that slides per pass, so slopes settle smoothly
  },
  wind: {
    direction: 30, // degrees the wind blows toward, 0 = +x on the map, 90 = +y
    slab: 0.06, // units of sand in one slab, 24 cm, the smallest dune step
    hop: 5, // tiles a lifted slab travels before it may land; sets dune spacing with the shadow
    depositOnSand: 0.6, // chance a slab lands on a corner with sand, so sand gathers into ridges
    depositOnBare: 0.4, // chance a slab lands on bare ground, lower so bare ground stays bare
    shadowSlope: 0.03, // units per tile below an upwind crest that count as wind shadow; the Werner 15 degrees in slab steps, so ridges form at this grid size
    shadowReach: 16, // tiles upwind checked for shadow, a few dune spacings
    sandSlope: 0.2, // steepest sand face before it avalanches, 3 slabs per tile; keeps dunes 0.1 to 0.5 units tall on 4 m tiles
    stepsPerCell: 120, // slab lifts per starting sand corner; more steps give longer ridges and carry sand farther downwind
  },
  dunes: {
    minSand: 0.15, // units of sand, 60 cm; thinner sand lies flat
    fullSand: 0.5, // units of sand, 2 m; from here a corner carries a full ridge
    maxSlope: 0.15, // units per tile; on steeper ground sand slides off before it builds ridges
    height: 0.8, // units, 3.2 m; a full ridge hides a whole truck
    wavelength: 14, // tiles from crest to crest, 56 m, a few truck lengths of cover
    leeShare: 0.25, // share of a ridge's length taken by the steep lee face behind the crest
    bend: 6, // tiles a crest line wanders along the wind, so ridges bend and break
    bendFrequency: 1 / 40, // cycles per tile of the crest bend noise
    bendSeedOffset: 6007, // keeps the bend noise apart from other noise from the map seed
  },
  sandStart: {
    below: -1.5, // units; corners lower than this start with sand, since basins collect blown sand; about the lowest tenth of the map
    fade: 1, // units below `below` over which the start sand thickens to full depth
    depth: 0.5, // units of start sand at full depth, 2 m
  },
  ground: {
    washFlow: 40, // water units summed over all rain passes; a corner that carried more is a wash bed, about the wettest twentieth of the map
    gravelSlope: 0.08, // units per tile; a wash bed at least this steep keeps gravel, fast water carries the sand on
    lakeDepth: 0.4, // units, 1.6 m; deepest water a basin holds in this dry climate, so a lake fills only its basin's bottom; above mudDepth
    saltDepth: 0.03, // units, 12 cm; a corner this far under its lake surface dries to salt crust
    mudDepth: 0.25, // units, 1 m; deeper water lasts longer and leaves mud
    looseSand: 0.1, // units of sand, 40 cm; deeper sand is loose sand, shallower sand shows the ground under it
  },
  boulders: {
    cliffBase: 0.3, // chance a corner below a cliff face gets a boulder; boulders break off and roll to the foot
    ridgeTop: 0.05, // chance a ridge-top corner gets a boulder; bare ridges hold weathered rock
    ridgeCurvature: 0.08, // units per tile squared; a corner this far above the middle of two opposite neighbors is a ridge top
    radius: [0.6, 1.6], // tiles of radius, 2.4 to 6.4 m
    crag: {
      above: 12.5, // height units, 50 m; ridge tops this high are about the top tenth of all ridge tops, so only mountain crests carry spires
      radius: [1.6, 2.6], // tiles of radius, 6.4 to 10.4 m; a spire stands out above the boulders around it
    },
  },
};

// Old-world rules for the map bake: what stood here before, placed from terrain, sites and roads. See
// src/mapgen/oldworld.ts. Distances are in tiles of 4 m, heights in units of 4 m, slopes in units per tile.
// Each rule draws its randomness from the map seed and its own seedOffset, so rules never shift each other.
export type SettlementRules = {
  seedOffset: number;
  candidateStep: number;
  count: number;
  spacing: number;
  anchorGap: [number, number];
  jitter: number;
  radius: number;
  roadGap: number;
  flatSlope: number;
  houses: [number, number];
  houseRadius: [number, number];
  intactShare: number;
  farmShare: number;
  towerShare: number;
  towerRadius: number;
  placeTries: number;
};

export type OverlookRules = {
  seedOffset: number;
  step: number;
  reach: number;
  drop: number;
  rise: number;
  directions: number;
  flatSlope: number;
  count: number;
  spacing: number;
  roadGap: number;
  radius: [number, number];
  intactShare: number;
};

export type BendRules = {
  seedOffset: number;
  sample: number;
  reach: number;
  angle: number;
  spacing: number;
  chance: number;
  gap: number;
  radius: [number, number];
  gasShare: number;
};

// The old highway across the dry river. See highway() in src/mapgen/oldworld.ts.
export type HighwayRules = {
  count: number;
  spacing: number;
  maxLength: number;
  bridgeCost: number;
  maxBridge: number;
};

export type OldRoadRules = {
  cell: number;
  maxLink: number;
  maxSlope: number;
  slopeCost: number;
  washCost: number;
  smoothEvery: number;
  sample: number;
  width: number;
  spanRadius: number;
  spanRoadGap: number;
  spanBack: number;
  minBridge: number;
  minDrop: number;
  minGapRatio: number;
  spanGap: number;
  maxBridge: number;
  bridgeCost: number;
  bankBack: number;
};

export type PowerLineRules = {
  seedOffset: number;
  roadShare: number;
  minLength: number;
  spacing: number;
  gap: number;
  radius: number;
  missingShare: number;
};

export type BillboardRules = {
  seedOffset: number;
  approach: number[];
  straightStep: number;
  straightReach: number;
  straightness: number;
  straightChance: number;
  spacing: number;
  gap: number;
  radius: number;
};

export type TankRules = {
  seedOffset: number;
  chance: number;
  along: [number, number];
  group: [number, number];
  spread: number;
  gap: number;
  radius: number;
  placeTries: number;
};

export type FieldRules = {
  seedOffset: number;
  perFarm: [number, number];
  side: [number, number];
  gap: number;
  reach: number;
  flatSlope: number;
  lowRise: number;
  minShare: number;
  tries: number;
};

export const OLD_WORLD: {
  settlements: SettlementRules;
  overlooks: OverlookRules;
  bends: BendRules;
  oldRoads: OldRoadRules;
  highway: HighwayRules;
  powerLines: PowerLineRules;
  billboards: BillboardRules;
  tanks: TankRules;
  fields: FieldRules;
} = {
  settlements: {
    seedOffset: 7001,
    candidateStep: 4, // tiles between candidate spots; finer than the settlement radius, so no flat spot is missed
    count: 14, // old settlements on the map, a little under today's 17 sites, so ruins stay a find, not a carpet
    spacing: 45, // tiles, 180 m, between settlement centers; two never read as one town
    anchorGap: [12, 80], // tiles from a site edge or road junction; people settle near where people still go, but not on top of it
    jitter: 0.5, // share of the score from seeded noise, so the best spots do not always win
    radius: 5, // tiles, 20 m; houses stand within this of the center
    roadGap: 3, // tiles between a settlement's edge and a road edge
    flatSlope: 0.12, // steepest tile under a settlement, about 7 degrees; people built on gentle ground
    houses: [3, 7], // houses per settlement, a hamlet
    houseRadius: [0.9, 1.3], // tiles, like today's town buildings
    intactShare: 0.25, // share of houses that still stand whole; the rest are ruined shells
    farmShare: 0.4, // share of settlements that farmed, with fields and a silo or water tower
    towerShare: 0.5, // share of farms with a water tower instead of a silo
    towerRadius: 1.2, // tiles of footprint for a silo or water tower
    placeTries: 12, // tries to fit each house before it is left out
  },
  overlooks: {
    seedOffset: 7002,
    step: 3, // tiles between checked corners
    reach: 10, // tiles out to where the drop is measured, 40 m
    drop: 2, // units, 8 m; the ground this far below the spot counts as a view
    rise: 0.5, // units, 2 m; ground at reach may stand this far above the spot, so plateau edges with small bumps count as hilltops
    directions: 3, // of 8 compass directions that must drop, so the view is wide, not down one gully
    flatSlope: 0.15, // steepest tile the building stands on
    count: 10, // lone buildings on overlooks
    spacing: 60, // tiles between overlook buildings
    roadGap: 3, // tiles between the footprint and a road edge
    radius: [1, 1.4], // tiles of footprint
    intactShare: 0.4, // share that still stand whole
  },
  bends: {
    seedOffset: 7003,
    sample: 2, // tiles between checked road points
    reach: 8, // tiles back and ahead along the road over which the turn is measured
    angle: 35, // degrees of turn over that stretch that make a sharp bend
    spacing: 40, // tiles between bend buildings
    chance: 0.6, // chance a sharp bend has a building
    gap: 2, // tiles between the footprint and the road edge
    radius: [1, 1.4], // tiles of footprint
    gasShare: 0.4, // share of bend buildings that are gas stations
  },
  oldRoads: {
    cell: 4, // tiles between nodes of the route grid; old roads need no finer line
    maxLink: 120, // tiles, the longest old road from a settlement to its neighbor or to a road of today
    maxSlope: 0.35, // steepest step between nodes; old roads kept to grades below scree
    slopeCost: 6, // cost multiplier 1 + slopeCost * (slope / maxSlope)^2; old roads went around hills
    washCost: 4, // extra cost per tile of a step onto a wash bed, so old roads cross washes only where the way around is long
    smoothEvery: 3, // route nodes per kept point, so the road runs straight between them instead of zigzagging
    sample: 0.5, // tiles between points walked along an old road
    width: 3, // tiles, 12 m, of cracked asphalt
    spanRadius: 1.5, // tiles of footprint of a broken bridge span
    spanRoadGap: 1, // tiles between a span and a road edge
    spanBack: 12, // tiles a span may step back from its bank point to find open, gentle ground
    minBridge: 6, // tiles, 24 m, across a wash where the old road had a bridge; narrower gullies just cut the asphalt
    minDrop: 1, // height units, 4 m, from the lower bank to the wash floor; the broken span model hangs over a drop this deep
    minGapRatio: 0.05, // gap depth per tile of bridge; a gap shallower than 1 in 20 of its length reads as flat ground
    spanGap: 1.5, // height units, 6 m, of gap under a bridge that leaves broken ends standing; shallower ones just wash the road out
    maxBridge: 40, // tiles, 160 m, the longest bridge an old road jumps a gully on
    bridgeCost: 1.5, // cost per tile of a bridge over a road on flat ground; a bridge beats a detour 50% longer
    bankBack: 3, // tiles back from a cut edge where a bank's height is read, past the gully side
  },
  highway: {
    count: 4, // old highways on the map, each with its great broken bridge; rare enough to stay landmarks
    spacing: 80, // tiles, 320 m, between the deepest bridges of two highways, so they spread over the map
    maxLength: 400, // tiles, 1.6 km, the longest highway between two settlements
    bridgeCost: 1.2, // cost per tile of highway bridge over road on flat ground; a little dearer, so the bridge spans only the ravine
    maxBridge: 80, // tiles, 320 m, the longest highway bridge; enough for a wide valley and its banks
  },
  powerLines: {
    seedOffset: 7005,
    roadShare: 0.6, // share of long roads with a power line beside them
    minLength: 60, // tiles; shorter roads are spurs and tracks with no line
    spacing: 14, // tiles, 56 m, between poles
    gap: 1, // tiles between a pole and the road edge
    radius: 0.3, // tiles of pole footprint
    missingShare: 0.15, // share of poles that fell or were taken, left as gaps in the line
  },
  billboards: {
    seedOffset: 7006,
    approach: [25, 50], // tiles past a town edge along each road leaving it
    straightStep: 20, // tiles between checked road points for straights
    straightReach: 30, // tiles back and ahead measured for a straight
    straightness: 0.985, // shortest share of the road length the chord keeps on a straight
    straightChance: 0.3, // chance a straight point gets a billboard, so straights are not lined with them
    spacing: 70, // tiles between billboards
    gap: 1.5, // tiles between the footprint and the road edge
    radius: 1.6, // tiles of footprint, as the old landmark billboards
  },
  tanks: {
    seedOffset: 7007,
    chance: 0.5, // chance an old road leaving a settlement has a group of hulks
    along: [10, 30], // tiles along the old road from the settlement to the group
    group: [2, 4], // hulks per group
    spread: 4, // tiles a hulk lies from the group point, along and beside the road
    gap: 1, // tiles between a hulk and the old road edge
    radius: 1.5, // tiles of footprint, as the old landmark hulks
    placeTries: 6, // tries to fit each hulk before it is left out
  },
  fields: {
    seedOffset: 7008,
    perFarm: [2, 4], // fields per farm
    side: [6, 14], // tiles along each side of a field rectangle, 24 to 56 m
    gap: 2, // tiles between the settlement edge and the nearest field
    reach: 12, // tiles farther out a field may lie
    flatSlope: 0.1, // steepest tile that was ploughed
    lowRise: 0.5, // units, 2 m; fields lie no higher than this above the settlement ground, on the low land
    minShare: 0.6, // share of a rectangle's tiles that must be good ground, or the field goes elsewhere
    tries: 8, // tries to fit each field
  },
};

// Map bake settings: the map seed, the map file and the pictures each bake writes.
// A square close-up picture: its name, its center and its side, in tiles.
export type MapSpot = { name: string; center: Vec; side: number };

// Tiles of ground shown around a site in its close-up.
const SITE_SURROUND = 20;

export const MAPGEN = {
  // Drives heights, ground types and rocks. The world seed drives all other randomness.
  seed: 1337,
  // Map file path, under public/ on disk and at the site root in the browser.
  file: 'maps/icarus.bin',
  // Stored height steps per height unit. Heights are 16-bit integers, so they reach +-32767 / heightScale.
  heightScale: 1000,
  // Pixels per tile in the whole-map picture: 600 tiles give a 1200 px picture.
  overviewPxPerTile: 2,
  closeUpPxPerTile: 8,
  closeUps: [
    ...[...REGION.towns, ...REGION.locations].map((site) => ({ name: site.id, center: site.pos, side: 2 * (site.radius + SITE_SURROUND) })),
    { name: 'bridge', center: { x: (CANYON_BRIDGE.line[0].at.x + CANYON_BRIDGE.line[1].at.x) / 2, y: (CANYON_BRIDGE.line[0].at.y + CANYON_BRIDGE.line[1].at.y) / 2 }, side: 60 },
    // The whole Broken Wing stretch: hoop, ramps, deck, trench and site.
    { name: 'wing', center: BROKEN_WING_POINT(0, -2), side: 120 },
    { name: 'dry-river', center: scalePoint({ x: 48, y: 87 }), side: 120 },
    // The canyon floor, where blown sand gathers most.
    { name: 'canyon', center: { x: 470, y: 240 }, side: 100 },
    // The open ground with the most loose sand outside the canyon.
    { name: 'sand', center: { x: 390, y: 350 }, side: 100 },
  ] as MapSpot[],
};

// New-world rules for the map bake: what squatters and weather made of the old world since, placed from
// terrain, water, sites and old-world props. See src/mapgen/newworld.ts. Distances are in tiles of 4 m,
// heights in units of 4 m, slopes in units per tile. Each rule draws its randomness from the map seed and its
// own seedOffset, so rules never shift each other.
export type PoolRules = {
  minDepth: number;
  maxTiles: number;
  toxicReach: number;
};

export type ScrubRules = {
  seedOffset: number;
  seedFlow: number;
  seedChance: number;
  poolReach: number;
  oasisReach: number;
  steps: number;
  spread: number;
  dryShare: number;
};

export type CampRules = {
  seedOffset: number;
  radius: number;
  siteGap: number;
  roadGap: number;
  flatSlope: number;
  spacing: number;
  tries: number;
  siteChance: number;
  ruinChance: number;
  junctionChance: number;
  junctionReach: number;
  clusterReach: number;
  clusterMin: number;
  shacks: [number, number];
  shackRadius: [number, number];
  junk: [number, number];
  junkRadius: [number, number];
  innerGap: number;
  placeTries: number;
  fenceArc: [number, number];
  fenceMissing: number;
  fenceRoadGap: number;
};

export type FieldFenceRules = {
  seedOffset: number;
  minTiles: number;
  angleStep: number;
  edgeChance: number;
  missingShare: number;
  roadGap: number;
};

export type CarWreckRules = {
  seedOffset: number;
  radius: number;
  roadStep: number;
  roadChance: number;
  shoulder: [number, number];
  skew: number;
  oldRoadChance: number;
  oldRoadGap: number;
  campChance: number;
  campGroup: [number, number];
  campSpread: number;
  washChance: number;
  placeTries: number;
};

export const NEW_WORLD: {
  fenceLength: number;
  pools: PoolRules;
  scrub: ScrubRules;
  camps: CampRules;
  fieldFences: FieldFenceRules;
  carWrecks: CarWreckRules;
} = {
  fenceLength: 1, // tiles, 4 m, of one fence segment; a fence line is a row of them, so it breaks segment by segment
  pools: {
    minDepth: 0.05, // units, 20 cm; a tile with a corner this far under its basin's spill level holds water after rain
    maxTiles: 40, // tiles, 640 m²; larger basins are lakes that dry to mud and salt crust, not pools
    toxicReach: 12, // tiles, 48 m, past the footprint of a gas station, tank hulk or silo that its spills drain into a basin
  },
  scrub: {
    seedOffset: 8002,
    seedFlow: 0.4, // share of the wash flow; a tile beside a bed that carried this much water stays moist
    seedChance: 0.5, // chance a moist tile starts scrub, so the first growth is patchy
    poolReach: 2, // tiles around a pool where scrub starts
    oasisReach: 12, // tiles past an oasis's site clearance where scrub starts
    steps: 6, // growth steps; each lets scrub creep one tile further
    spread: 0.35, // chance per step that scrub takes a flat, moist neighbor tile
    dryShare: 0.15, // share of that chance left on dry ground, so scrub mostly follows the water
  },
  camps: {
    seedOffset: 8003,
    radius: 5, // tiles, 20 m; the fence ring of a camp, with the shacks and junk inside
    siteGap: 2, // tiles between the camp ring and a site's clearance
    roadGap: 2, // tiles between the camp ring and a road edge
    flatSlope: 0.15, // steepest tile under a camp's center
    spacing: 30, // tiles between camp centers, so camps never merge
    tries: 16, // directions tried around a site or junction for open ground
    siteChance: 0.7, // chance a town or oasis has a camp outside it
    ruinChance: 0.5, // chance an old settlement has squatters among its ruins
    junctionChance: 0.5, // chance a road junction has a camp beside it
    junctionReach: 15, // tiles past the nearest camp spot to a junction that a camp may lie, out of the fork between its roads
    clusterReach: 8, // tiles between houses of one old settlement; settlements have a radius of 5
    clusterMin: 3, // houses and ruins that make an old settlement, not a lone building
    shacks: [2, 5], // shacks per camp
    shackRadius: [0.6, 0.9], // tiles of footprint, 5 to 7 m across
    junk: [1, 3], // junk piles of barrels and tires per camp
    junkRadius: [0.35, 0.6], // tiles of footprint
    innerGap: 1.5, // tiles between the shacks and junk and the fence ring
    placeTries: 12, // tries to fit each shack or junk pile before it is left out
    fenceArc: [0.3, 0.65], // share of the ring a camp fences; the rest stays open
    fenceMissing: 0.1, // share of fence segments fallen or taken, left as gaps
    fenceRoadGap: 1, // tiles between a fence segment and a road edge
  },
  fieldFences: {
    seedOffset: 8004,
    minTiles: 12, // tiles; smaller patches of old field are scraps with no fence
    angleStep: 2, // degrees between angles tried to fit a field's rectangle
    edgeChance: 0.5, // chance each edge of a field keeps a fence; one edge always stays open
    missingShare: 0.15, // share of fence segments fallen or taken, left as gaps
    roadGap: 1, // tiles between a fence segment and a road edge
  },
  carWrecks: {
    seedOffset: 8005,
    radius: 0.6, // tiles of footprint, a car 4.5 m long
    roadStep: 25, // tiles between checked road points
    roadChance: 0.25, // chance a road point has a burnt car on its shoulder
    shoulder: [0.5, 2], // tiles between a wreck and the road edge
    skew: 30, // degrees a roadside wreck turns off the road direction at most
    oldRoadChance: 0.005, // chance per tile of old road that a car died there
    oldRoadGap: 1, // tiles between an old-road wreck and a road edge
    campChance: 0.6, // chance a camp has cars dragged in beside it
    campGroup: [1, 3], // cars in a camp group
    campSpread: 4, // tiles past the camp ring a car may lie
    washChance: 0.003, // chance per wash-bed tile that a flood left a car there, nose down
    placeTries: 8, // tries to fit each camp car before it is left out
  },
};
