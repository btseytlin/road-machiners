// Tuning numbers for NPC drivers: behavior limits, upkeep, hunting grounds and names. Re-exported by src/data/npcs.ts.

import { RULES } from './rules';
import { TERRAIN } from './terrain';
import { TIME } from './time';
import type { MemoryFact } from '../sim/types';

export const NPC_UTILITY = {
  dropReach: 10,
  sproutCab: 0.5,
};
const LAW_GATE_REACH = 12;

export const NPC_BEHAVIOR = {
  stallTurns: 100,
  stallJump: 20,
  escortFeePerTile: 5,
  weakDecline: 20,
  escortWaitGap: 12,
  lawGateReach: LAW_GATE_REACH,
  patrolRadius: LAW_GATE_REACH + TERRAIN.vision.radius * 4,
  patrolSpacing: 4,
  followGap: RULES.yieldDistance + 1,
  fleeCondition: 0.3,
  fight: { angles: 16, rings: [0.25, 0.5, 0.75, 1], arcWeight: 2, threatWeight: 2, travelWeight: 1, circleWeight: 1, rammedWeight: 2, ramWeight: 2, circlePace: 3, whimTurns: 4 },
  revengeChance: 0.33,
  recoverCondition: 0.5,
  threatRatio: 1,
  dangerSpread: 0.25,
  threatFlee: 20,
  weakFlee: 20,
  trappedFlee: 0.2,
  hurtFullFlee: 0.1,
  missFlee: 0.5,
  manageableFight: 5,
  keepWork: 400,
  noticeMemory: 3,
  fleeMemory: 30,
  fightSearchTurns: 6,
  fleeCalmTurns: 6,
  fightStallTurns: 20,
  fightWearShare: 0.05,
  crippledInvestigate: 0.01,
  watchKeep: 30,
  lootedResume: 0.01,
  ram: {
    partWeight: { cab: 4, wheel: 2, transmission: 2, tank: 1, engine: 3, weapon: 3, armor: 0.25, scanner: 1, store: 1, cargo: 1, utility: 1 },
    gunWeight: 1,
    valueScale: 0.3,
    riskyRam: 0.001,
    dodge: 0.3,
  },
  visibleSalvage: 10,
  robStronger: 0.015,
  robNearGuards: 0.015,
  lootAppeal: {
    rob: { poor: 5000, rich: 16667, poorMul: 0.02 },
    raid: { poor: 0, rich: 13333, poorMul: 0.002 },
  },
  fightNearGuards: 0.001,
  towNearTown: { factor: 0.02, crawl: 15, far: 60 },
  mateRetaliate: 0.1,
  threatTruce: 5,
  weakBeg: 40,
  threatAccept: 5,
  robberRefuse: 20,
  winningTruce: 0.01,
  threatComply: 20,
  guardedComply: 0.1,
};

export const NPC_UPKEEP = {
  repairParts: 2,
  shadeSearchRadius: 6,
  fuelReserve: 1.5,
  fuelSense: 0.35,
  lowSupplies: RULES.lowFuelThreshold,
  reserveLoads: 1,
  tradeReserve: 0.5,
};

export const AID = {
  fillShare: 0.25,
  giftShare: 0.25,
  poorCondition: 0.5,
  poorValue: 133333,
  handoverTurns: 1,
};

export const HUNT = {
  roadSpacing: 60,
  siteDistance: 40,
  lawReach: NPC_BEHAVIOR.patrolRadius + TERRAIN.vision.radius,
  offRoadGoals: ['raid', 'patrol', 'investigate'] as const,
  postRoadGap: 6,
  postRings: [10, 14, 7],
  postBearings: 16,
  patrolPostSpacing: 20,
  watchTurns: 40,
};

export const MEMORY = {
  turns: { prices: TIME.turnsPerDay } satisfies Record<MemoryFact['kind'], number>,
};

export const TRADE_TIP = { share: 0.2 };

export const FIRST_NAMES: readonly string[] = [
  'Abe', 'Ada', 'Anya', 'Arlo', 'Bea', 'Bo', 'Boris', 'Cal', 'Cass', 'Clem', 'Dace', 'Dmitri', 'Dora', 'Earl',
  'Edda', 'Elias', 'Faye', 'Fenn', 'Gus', 'Hank', 'Hester', 'Ida', 'Igor', 'Ivy', 'Jed', 'Jonah', 'Juno', 'Kat',
  'Lev', 'Lorna', 'Lupe', 'Mack', 'Mae', 'Mira', 'Nell', 'Nico', 'Oleg', 'Opal', 'Pike', 'Pru', 'Quill', 'Raya',
  'Rook', 'Ruth', 'Sal', 'Sasha', 'Silas', 'Tam', 'Tess', 'Ugo', 'Vera', 'Vic', 'Wade', 'Wren', 'Yuri', 'Zeke',
  'Zoya',
];

export const SURNAMES: readonly string[] = [
  'Ash', 'Baines', 'Barrow', 'Boyle', 'Brandt', 'Cobb', 'Crane', 'Culver', 'Dawes', 'Drummond', 'Dust', 'Fisk',
  'Flint', 'Gage', 'Garza', 'Grell', 'Harrow', 'Hatch', 'Holt', 'Irons', 'Jarvis', 'Kane', 'Kessler', 'Kovac',
  'Lark', 'Lowry', 'Marsh', 'Mercer', 'Morozov', 'Nash', 'Oakes', 'Orlov', 'Pell', 'Quarry', 'Radek', 'Reyes',
  'Rusk', 'Salt', 'Sokol', 'Stroud', 'Tallow', 'Thorne', 'Tulloch', 'Vance', 'Volkov', 'Wick', 'Yates', 'Zane',
];
