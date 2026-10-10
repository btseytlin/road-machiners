// Game modes and the world settings a new game can pick. A setting is a multiplier on base numbers in RULES, where 1
// is the standard game. The mode picker lists GAME_MODES, so a new mode is a new row here and a new GameModeId.
// docs/wiki/mechanics/world-settings.md says which rules are settings and why the others stay fixed.

import type { GameModeId, MapKind, ModeRules, WorldSettings } from '../sim/types';
import type { GearLevel } from './npcs';
import type { PropKind } from '../sim/terrain';
import type { TerrainTypeId } from './terrain';

export type GameMode = { rules: ModeRules; kit: string | null; map: MapKind };

const OPEN_WORLD: ModeRules = { traffic: true, looting: true, npcKnockouts: true, playerKnockouts: true, yielding: true, radio: true, rescue: true, roadWrecks: true, run: false };
const RUN: ModeRules = { traffic: false, looting: false, npcKnockouts: true, playerKnockouts: false, yielding: false, radio: false, rescue: false, roadWrecks: false, run: true };

export const GAME_MODES: Record<GameModeId, GameMode> = {
  roaming: { rules: OPEN_WORLD, kit: null, map: 'icarus' },
  furyRoad: { rules: RUN, kit: 'furyRoad', map: 'highway' },
};

export type WorldSettingDef = { default: number; min: number; max: number; step: number };

export const WORLD_SETTINGS: Record<keyof WorldSettings, WorldSettingDef> = {
  damage: { default: 1, min: 0.5, max: 2, step: 0.25 },
  fuelUse: { default: 1, min: 0.5, max: 2, step: 0.25 },
  supplyUse: { default: 1, min: 0.5, max: 2, step: 0.25 },
};

export type WavePlan = { sizes: number[]; level: GearLevel };
export type PoolTier = { upTo: number; weights: Record<string, number> };
export type Curve = { first: number; step: number; max: number };

export const FURY_ROAD = {
  spawnOffsets: [-3, -1, 1, 3, -9, 9, -13, 13],
  outpost: {
    look: 'salvage-yard',
    radius: 6,
    across: 19.5,
    spur: { from: 3, half: 1.5 },
    flat: { back: 6, half: 8, blend: 4 },
  },
  waves: [
    { sizes: [1], level: 'light' },
    { sizes: [1, 1], level: 'light' },
    { sizes: [1, 1], level: 'light' },
    { sizes: [1, 1], level: 'standard' },
    { sizes: [2, 1], level: 'standard' },
    { sizes: [2, 2], level: 'standard' },
    { sizes: [3, 2], level: 'heavy' },
    { sizes: [3, 3, 2], level: 'loaded' },
  ] as WavePlan[],
  pool: [
    { upTo: 2, weights: { buggy: 4, courier: 2, scavenger: 2, roamer: 2, trader: 1 } },
    { upTo: 5, weights: { buggy: 3, courier: 1, scavenger: 2, roamer: 2, trader: 1, gunwagon: 3, vulture: 2, merc: 2, bowlFarmer: 1 } },
    {
      upTo: Number.MAX_SAFE_INTEGER,
      weights: { buggy: 2, courier: 1, scavenger: 1, roamer: 1, trader: 1, gunwagon: 3, vulture: 2, merc: 3, bowlFarmer: 1, noseArmy: 2, convoyGuard: 2, convoy: 1 },
    },
  ] as PoolTier[],
  sides: { ahead: 22, behind: 24, flank: { along: 6, across: 22, step: 3 } },
  pacing: { quiet: 20, near: 30 },
  catchUp: { engageAt: 12 },
  spawnStagger: 3,
  maxAlive: 8,
  spawnRetryTurns: 20,
  pay: { base: { first: 30000, step: 15000, max: 120000 } as Curve, perWreck: { first: 6000, step: 1500, max: 15000 } as Curve },
  stockPerKind: 2,
  trucks: { offers: 3, pool: ['hauler', 'courier', 'van', 'longbed', 'carrier', 'tractor', 'jeep', 'convertible', 'bus', 'loader', 'niva', 'bukhanka', 'lincoln', 'buggy', 'wagon'] },
  goodsMarkup: 1.5,
  maxTries: 400,
};

export type BandRule = { kind: PropKind; count: [number, number]; r: [number, number]; across: [number, number] };
export type GroundBand = { below: number; type: TerrainTypeId };

export const HIGHWAY = {
  version: 3,
  size: 410,
  stride: 310,
  milestoneInset: 50,
  road: {
    lanes: [-3, -1, 1, 3],
    laneWidth: 2,
    asphalt: 5,
    verge: 18,
    badlands: 26,
    flatTo: 15,
    blend: 7,
    ridge: { rise: 3, run: 4 },
    bend: { ends: 60, cells: 2, shift: [16, 36] as [number, number], straightChance: 0.2, maxHeading: 35 },
    profile: { amplitude: 1.5, wavelength: 300, seedOffset: 103 },
    sample: 2,
    paint: { dash: 3, gap: 3, line: 0.2, wear: 0.02, band: 0.3, bandSpread: 0.75, holeInset: 0.75 },
  },
  relief: { amplitude: 2.4, octaves: [{ freq: 1 / 56, amp: 1, seedOffset: 201 }, { freq: 1 / 17, amp: 0.3, seedOffset: 202 }] },
  ground: {
    scale: 1 / 22,
    seedOffset: 301,
    verge: [{ below: 0.32, type: 'sand' }, { below: 1, type: 'hardpan' }] as GroundBand[],
    badlands: [{ below: 0.45, type: 'gravel' }, { below: 0.7, type: 'scrub' }, { below: 1, type: 'scree' }] as GroundBand[],
    ridge: 'scree' as TerrainTypeId,
  },
  chunk: 16,
  chunkEdge: 1.8,
  badlands: [
    { kind: 'rock', count: [3, 6], r: [0.6, 1.5], across: [19.5, 40] },
    { kind: 'crag', count: [0, 2], r: [1.6, 2.4], across: [22, 44] },
    { kind: 'deadTree', count: [0, 2], r: [0.35, 0.35], across: [18.5, 34] },
  ] as BandRule[],
  powerLine: { spacing: 12, across: 14, r: 0.3 },
  billboard: { chance: 0.14, r: 1.6, across: [19.6, 22] as [number, number] },
  ditched: { chance: 0.4, kinds: ['carWreck', 'deadTruck'] as PropKind[], r: [0.6, 0.75] as [number, number], across: [12.8, 16.2] as [number, number], yaw: 25 },
  milestoneClear: { south: 34, north: 24, across: 34 },
  sceneClear: { along: 4, across: 24 },
  propGap: 0.3,
  startLane: 2,
};

export type SceneKind = 'pileup' | 'jackknife' | 'checkpoint' | 'tankline' | 'rockfall' | 'craters' | 'ramp';
export type Range = [number, number];
export type SceneWeights = { upTo: number; weights: Record<SceneKind, number> };

export const HAZARDS = {
  arenaMin: 36,
  clearAfterOutpost: 24,
  clearBeforeOutpost: 30,
  scenes: { first: 3, every: 2, max: 4 },
  lanesCovered: { early: 2, late: 3, upTo: 2 },
  tiers: [
    { upTo: 2, weights: { pileup: 4, rockfall: 3, craters: 3, jackknife: 2, ramp: 2, checkpoint: 1, tankline: 1 } },
    { upTo: 5, weights: { pileup: 3, rockfall: 2, craters: 2, jackknife: 2, ramp: 2, checkpoint: 2, tankline: 2 } },
    { upTo: Number.MAX_SAFE_INTEGER, weights: { pileup: 2, rockfall: 1, craters: 1, jackknife: 2, ramp: 2, checkpoint: 3, tankline: 3 } },
  ] as SceneWeights[],
  pieceR: { carWreck: 0.7, deadTruck: 0.75, drums: 0.44, junk: 0.6, barrier: 0.5, sandbags: 0.6, tankTrap: 0.25, armyTruck: 1.1, tank: 1.2 } as Partial<Record<PropKind, number>>,
  pileup: {
    lanes: [1, 2] as Range,
    vehicles: [3, 6] as Range,
    hulkShare: 0.45,
    hulks: ['bus', 'van', 'courier', 'hauler', 'wagon'],
    cars: ['carWreck', 'deadTruck'] as PropKind[],
    length: [6, 12] as Range,
    yaw: [20, 80] as Range,
    spill: [2, 4] as Range,
    spillKinds: ['drums', 'junk'] as PropKind[],
    spillAhead: [2, 6] as Range,
  },
  jackknife: { lanes: [2, 3] as Range, hulks: ['bus', 'hauler'], yaw: [60, 90] as Range, cars: [1, 2] as Range, carYaw: 15, behind: [2.2, 3.2] as Range },
  checkpoint: { lines: [2, 3] as Range, spacing: 10, inner: 1, barrierStep: 1, lineYaw: 3, sandbags: [1, 2] as Range, behind: 0.9, bagStep: 1.2, traps: [3, 6] as Range, trapFrom: 5.6, trapStep: 0.9, truckAcross: [8.5, 11] as Range, truckYaw: 10 },
  tankline: { lanes: [1, 2] as Range, tankAcross: [8, 12] as Range, tankYaw: 20, traps: [6, 10] as Range, step: [3, 4] as Range },
  rockfall: { crag: { across: [17, 18.5] as Range, r: [1.6, 2.2] as Range }, rocks: [6, 12] as Range, gap: 0.6, reach: 3, r: [0.4, 1.3] as Range, fan: 4 },
  craters: { count: [2, 4] as Range, radius: [1.5, 2.5] as Range, depth: [0.3, 0.5] as Range, spacing: [3.5, 5] as Range, junk: [1, 2] as Range },
  ramp: { width: 3, length: 5, rise: 0.35, craterChance: 0.5, craterGap: 3 },
  passage: 3,
  inflate: 0.5,
  onAsphalt: 1,
  pieceGap: 0.05,
  placeTries: 12,
  maxTries: 60,
  closures: {
    north: { gap: 16, reach: 30, rows: 2, rowGap: 1.4, sandbags: 4, traps: 10, trapsAhead: 2.5 },
    south: { behind: 26, reach: 30, rows: 2, rowGap: 2, yaw: 15, hulkShare: 0.5 },
  },
};
