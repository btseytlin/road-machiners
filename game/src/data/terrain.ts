// Terrain: corner heights, tile types, driving costs and fog of war.
// Heights are in height units; one unit rises reliefPx screen pixels. Slopes are height units per tile.

import { MAP_SCALE, REGION, scalePoint } from "./region";
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
  | "toxic";

export type TerrainType = {
  id: TerrainTypeId;
  name: string;
  speed: number;
  wear: number;
  dust: number;
  color: number;
};

export const TERRAIN_TYPES: Record<TerrainTypeId, TerrainType> = {
  road: { id: "road", name: "Road", speed: 1, wear: 0.5, dust: 0.3, color: 0xa8865a },
  hardpan: { id: "hardpan", name: "Hardpan", speed: 0.9, wear: 1, dust: 1, color: 0xc8a676 },
  sand: { id: "sand", name: "Loose sand", speed: 0.7, wear: 1.2, dust: 1.3, color: 0xdcc08c },
  scrub: { id: "scrub", name: "Scrub", speed: 0.8, wear: 1.3, dust: 0.7, color: 0xa89a66 },
  scree: { id: "scree", name: "Scree", speed: 0.55, wear: 2, dust: 0.5, color: 0x9a8a78 },
  mud: { id: "mud", name: "Mud", speed: 0.45, wear: 1.5, dust: 0.1, color: 0x665044 },
  gravel: { id: "gravel", name: "Gravel", speed: 0.85, wear: 1.4, dust: 0.8, color: 0x9e9489 },
  saltCrust: { id: "saltCrust", name: "Salt crust", speed: 0.95, wear: 0.8, dust: 1.2, color: 0xe0d8ba },
  asphalt: { id: "asphalt", name: "Cracked asphalt", speed: 0.98, wear: 0.6, dust: 0.3, color: 0x55565b },
  ash: { id: "ash", name: "Ash", speed: 0.6, wear: 1, dust: 1.6, color: 0x77737a },
  field: { id: "field", name: "Dead field", speed: 0.8, wear: 1.1, dust: 1.4, color: 0x8e6e4a },
  dirtyWater: { id: "dirtyWater", name: "Dirty water", speed: 0.45, wear: 1.5, dust: 0.1, color: 0x55583a },
  toxic: { id: "toxic", name: "Toxic pool", speed: 0.45, wear: 1.8, dust: 0.1, color: 0x9aa83c },
};

export const TERRAIN = {
  octaves: [
    { freq: 1 / (32 * MAP_SCALE), amp: 1.0, seedOffset: 0 },
    { freq: 1 / (14 * MAP_SCALE), amp: 0.7, seedOffset: 1000 },
    { freq: 1 / (5 * MAP_SCALE), amp: 0.38, seedOffset: 2000 },
    { freq: 1 / 7, amp: 0.14, seedOffset: 3000 },
  ],
  flattenMargin: 15,
  roadGrade: 0.12,
  bankGrade: 0.3,
  height: { hill: 2.1, mountainFrom: 0.32, mountain: 11 },
  relief: { broadFrequency: 1 / 65, broadAmplitude: 2.4, ridgeFrequency: 1 / 18, ridgeAmplitude: 1.2 },
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
    bridge: {
      from: scalePoint({ x: 97.9, y: 75.1 }),
      to: scalePoint({ x: 101.5, y: 71.5 }),
      width: 8,
      abutment: 1,
      ramp: 1.5,
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
      {
        center: scalePoint({ x: 64, y: 54 }),
        radius: 50,
        bank: 20,
        depth: 1.8,
      },
    ] as { center: Vec; radius: number; bank: number; depth: number }[],
  },
  reliefPx: 45,
  types: {
    screeSlope: 0.35,
    siteMargin: 1,
  },
  drive: {
    maxSlope: 0.6,
  },
  light: { x: -0.6, y: -0.8 },
  slopeShade: 0.9,
  vision: {
    radius: 20,
    eyeHeight: 0.6,
    samplesPerTile: 3,
    closeRadius: 3,
    lingerTurns: 2,
    grayFactor: 4,
  },
  fog: {
    seen: { grey: 0.85, bright: 0.9 },
    unseen: { grey: 1, bright: 0.55 },
  },
} as const;

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

export type GroundRules = {
  washFlow: number;
  gravelSlope: number;
  lakeDepth: number;
  saltDepth: number;
  mudDepth: number;
  looseSand: number;
};

export type BoulderRules = {
  cliffBase: number;
  ridgeTop: number;
  ridgeCurvature: number;
  radius: [number, number];
  crag: { above: number; radius: [number, number] };
};

export const GEOLOGY: { rain: RainRules; slump: SlumpRules; wind: WindRules; dunes: DuneRules; sandStart: SandStart; ground: GroundRules; boulders: BoulderRules } = {
  rain: {
    steps: 160,
    rainPerStep: 0.01,
    focusSquarings: 3,
    evaporation: 0.04,
    capacity: 4,
    minSlope: 0.02,
    pickupRate: 0.05,
    dropRate: 0.3,
    maxDig: 0.5,
    spreadPasses: 2,
    spreadRate: 0.2,
  },
  slump: {
    steps: 40,
    restSlope: 0.9,
    slideShare: 0.5,
  },
  wind: {
    direction: 30,
    slab: 0.06,
    hop: 5,
    depositOnSand: 0.6,
    depositOnBare: 0.4,
    shadowSlope: 0.03,
    shadowReach: 16,
    sandSlope: 0.2,
    stepsPerCell: 120,
  },
  dunes: {
    minSand: 0.15,
    fullSand: 0.5,
    maxSlope: 0.15,
    height: 0.8,
    wavelength: 14,
    leeShare: 0.25,
    bend: 6,
    bendFrequency: 1 / 40,
    bendSeedOffset: 6007,
  },
  sandStart: {
    below: -1.5,
    fade: 1,
    depth: 0.5,
  },
  ground: {
    washFlow: 40,
    gravelSlope: 0.08,
    lakeDepth: 0.4,
    saltDepth: 0.03,
    mudDepth: 0.25,
    looseSand: 0.1,
  },
  boulders: {
    cliffBase: 0.3,
    ridgeTop: 0.05,
    ridgeCurvature: 0.08,
    radius: [0.6, 1.6],
    crag: {
      above: 12.5,
      radius: [1.6, 2.6],
    },
  },
};

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
    candidateStep: 4,
    count: 14,
    spacing: 45,
    anchorGap: [12, 80],
    jitter: 0.5,
    radius: 5,
    roadGap: 3,
    flatSlope: 0.12,
    houses: [3, 7],
    houseRadius: [0.9, 1.3],
    intactShare: 0.25,
    farmShare: 0.4,
    towerShare: 0.5,
    towerRadius: 1.2,
    placeTries: 12,
  },
  overlooks: {
    seedOffset: 7002,
    step: 3,
    reach: 10,
    drop: 2,
    rise: 0.5,
    directions: 3,
    flatSlope: 0.15,
    count: 10,
    spacing: 60,
    roadGap: 3,
    radius: [1, 1.4],
    intactShare: 0.4,
  },
  bends: {
    seedOffset: 7003,
    sample: 2,
    reach: 8,
    angle: 35,
    spacing: 40,
    chance: 0.6,
    gap: 2,
    radius: [1, 1.4],
    gasShare: 0.4,
  },
  oldRoads: {
    cell: 4,
    maxLink: 120,
    maxSlope: 0.35,
    slopeCost: 6,
    washCost: 4,
    smoothEvery: 3,
    sample: 0.5,
    width: 3,
    spanRadius: 1.5,
    spanRoadGap: 1,
    spanBack: 12,
    minBridge: 6,
    minDrop: 1,
    minGapRatio: 0.05,
    spanGap: 1.5,
    maxBridge: 40,
    bridgeCost: 1.5,
    bankBack: 3,
  },
  highway: {
    count: 4,
    spacing: 80,
    maxLength: 400,
    bridgeCost: 1.2,
    maxBridge: 80,
  },
  powerLines: {
    seedOffset: 7005,
    roadShare: 0.6,
    minLength: 60,
    spacing: 14,
    gap: 1,
    radius: 0.3,
    missingShare: 0.15,
  },
  billboards: {
    seedOffset: 7006,
    approach: [25, 50],
    straightStep: 20,
    straightReach: 30,
    straightness: 0.985,
    straightChance: 0.3,
    spacing: 70,
    gap: 1.5,
    radius: 1.6,
  },
  tanks: {
    seedOffset: 7007,
    chance: 0.5,
    along: [10, 30],
    group: [2, 4],
    spread: 4,
    gap: 1,
    radius: 1.5,
    placeTries: 6,
  },
  fields: {
    seedOffset: 7008,
    perFarm: [2, 4],
    side: [6, 14],
    gap: 2,
    reach: 12,
    flatSlope: 0.1,
    lowRise: 0.5,
    minShare: 0.6,
    tries: 8,
  },
};

export type MapSpot = { name: string; center: Vec; side: number };

const SITE_SURROUND = 20;

export const MAPGEN = {
  seed: 1337,
  file: 'maps/icarus.bin',
  heightScale: 1000,
  overviewPxPerTile: 2,
  closeUpPxPerTile: 8,
  closeUps: [
    ...[...REGION.towns, ...REGION.locations].map((site) => ({ name: site.id, center: site.pos, side: 2 * (site.radius + SITE_SURROUND) })),
    { name: 'bridge', center: { x: (TERRAIN.features.bridge.from.x + TERRAIN.features.bridge.to.x) / 2, y: (TERRAIN.features.bridge.from.y + TERRAIN.features.bridge.to.y) / 2 }, side: 60 },
    { name: 'dry-river', center: scalePoint({ x: 48, y: 87 }), side: 120 },
    { name: 'canyon', center: { x: 470, y: 240 }, side: 100 },
    { name: 'sand', center: { x: 390, y: 350 }, side: 100 },
  ] as MapSpot[],
};

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
  fenceLength: 1,
  pools: {
    minDepth: 0.05,
    maxTiles: 40,
    toxicReach: 12,
  },
  scrub: {
    seedOffset: 8002,
    seedFlow: 0.4,
    seedChance: 0.5,
    poolReach: 2,
    oasisReach: 12,
    steps: 6,
    spread: 0.35,
    dryShare: 0.15,
  },
  camps: {
    seedOffset: 8003,
    radius: 5,
    siteGap: 2,
    roadGap: 2,
    flatSlope: 0.15,
    spacing: 30,
    tries: 16,
    siteChance: 0.7,
    ruinChance: 0.5,
    junctionChance: 0.5,
    junctionReach: 15,
    clusterReach: 8,
    clusterMin: 3,
    shacks: [2, 5],
    shackRadius: [0.6, 0.9],
    junk: [1, 3],
    junkRadius: [0.35, 0.6],
    innerGap: 1.5,
    placeTries: 12,
    fenceArc: [0.3, 0.65],
    fenceMissing: 0.1,
    fenceRoadGap: 1,
  },
  fieldFences: {
    seedOffset: 8004,
    minTiles: 12,
    angleStep: 2,
    edgeChance: 0.5,
    missingShare: 0.15,
    roadGap: 1,
  },
  carWrecks: {
    seedOffset: 8005,
    radius: 0.6,
    roadStep: 25,
    roadChance: 0.25,
    shoulder: [0.5, 2],
    skew: 30,
    oldRoadChance: 0.005,
    oldRoadGap: 1,
    campChance: 0.6,
    campGroup: [1, 3],
    campSpread: 4,
    washChance: 0.003,
    placeTries: 8,
  },
};
