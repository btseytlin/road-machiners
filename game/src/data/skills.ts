// Character skills. Activity earns XP into one shared pool, and the player spends it on ranks of any skill. Each rank
// adds `perLevel` of every effect in SKILL_EFFECTS. XP numbers are starting values for the progression simulator to tune.

import type { Archetype } from '../sim/progression/bot';
import type { SkillId, XpSource } from '../sim/types';
import { TIME } from './time';

export const SKILL_IDS: readonly SkillId[] = ['driving', 'perception', 'machining', 'toughness', 'social'];

// Fraction each level adds to an effect. Every reader names its effect, so a missing key fails typecheck.
const EFFECTS = {
  driving: {
    turnRate: 0.1,
    crashDamage: 0.1,
    roughSpeed: 0.1,
    crawl: 0.1,
  },
  perception: {
    spread: 0.05,
    sight: 0.04,
    hearing: 0.08,
    contactFix: 0.08,
  },
  machining: {
    repair: 0.1,
    fieldCap: 0.04,
    refit: 0.08,
    search: 0.08,
    engineHeat: 0.08,
  },
  toughness: {
    supplies: 0.12,
    maxHealth: 0.06,
    cabShare: 0.08,
    heatDrain: 0.08,
  },
  social: {
    priceSpread: 0.02,
    towFee: 0.06,
    patchPrice: 0.06,
    robberyDanger: 0.08,
  },
} as const satisfies Record<SkillId, Record<string, number>>;

export type SkillEffect<S extends SkillId> = keyof (typeof EFFECTS)[S] & string;
export const SKILL_EFFECTS: { [S in SkillId]: Record<SkillEffect<S>, number> } = EFFECTS;

export const RANK_COSTS: readonly number[] = [200, 400, 600, 800, 1000];
export const MAX_RANK = RANK_COSTS.length;

export type XpSourceDef = { skill: SkillId; weight: number; scaled: boolean; repeat: number };

export const XP_SOURCES: Record<XpSource, XpSourceDef> = {
  roughTiles: { skill: 'driving', weight: 0.5, scaled: true, repeat: 0.9 },
  ram: { skill: 'driving', weight: 0.25, scaled: true, repeat: 0.7 },
  escape: { skill: 'driving', weight: 8, scaled: true, repeat: 0.25 },
  hit: { skill: 'perception', weight: 6, scaled: true, repeat: 0.95 },
  contact: { skill: 'perception', weight: 0.25, scaled: true, repeat: 0.5 },
  discover: { skill: 'perception', weight: 10, scaled: false, repeat: 0 },
  fieldJob: { skill: 'machining', weight: 0.75, scaled: false, repeat: 0.7 },
  patch: { skill: 'machining', weight: 75, scaled: false, repeat: 0.5 },
  search: { skill: 'machining', weight: 80, scaled: false, repeat: 0 },
  heat: { skill: 'toughness', weight: 0.3, scaled: true, repeat: 0.9 },
  damage: { skill: 'toughness', weight: 1.5, scaled: false, repeat: 0.95 },
  knockout: { skill: 'toughness', weight: 100, scaled: false, repeat: 0.5 },
  profit: { skill: 'social', weight: 0.024, scaled: false, repeat: 0.8 },
  deal: { skill: 'social', weight: 30, scaled: false, repeat: 0.5 },
  call: { skill: 'social', weight: 8, scaled: false, repeat: 0 },
  honk: { skill: 'social', weight: 2, scaled: false, repeat: 0 },
  contract: { skill: 'social', weight: 1, scaled: false, repeat: 0.8 },
  freeTow: { skill: 'social', weight: 0.024, scaled: false, repeat: 0.5 },
  aid: { skill: 'social', weight: 0.024, scaled: false, repeat: 0.5 },
};

export const XP_RULES = {
  easy: 0.25,
  hard: 2,
  dailyCap: 150,
  overCap: 0.1,
  repeatHalfLife: 200,
  forgetBelow: 0.01,
  regionTiles: 16,
};

// Perks. At each perk rank of a skill the player picks one perk from its pair, for good. A perk changes a rule the
// player can see in play. Its name and its player-facing rule line live in src/text/

export type PerkId =
  | 'rammer' | 'coldRunning' | 'steadyAim' | 'dustScreen'
  | 'readDriver' | 'spotter' | 'cargoEye' | 'nightEyes'
  | 'welder' | 'cannibal' | 'rebuild' | 'roadMechanic'
  | 'desertRat' | 'stormRider' | 'fightThrough' | 'longHaul'
  | 'marketEars' | 'rumorMill' | 'paidTruce' | 'bountyTalk';

export const PERK_LEVELS = [2, 4] as const;
export type PerkLevel = (typeof PERK_LEVELS)[number];

export type PerkDef = { skill: SkillId; level: PerkLevel };

export const PERKS: Record<PerkId, PerkDef> = {
  rammer: { skill: 'driving', level: 2, },
  coldRunning: { skill: 'driving', level: 2, },
  steadyAim: { skill: 'driving', level: 4, },
  dustScreen: { skill: 'driving', level: 4, },
  readDriver: { skill: 'perception', level: 2, },
  spotter: { skill: 'perception', level: 2, },
  cargoEye: { skill: 'perception', level: 4, },
  nightEyes: { skill: 'perception', level: 4, },
  welder: { skill: 'machining', level: 2, },
  cannibal: { skill: 'machining', level: 2, },
  rebuild: { skill: 'machining', level: 4, },
  roadMechanic: { skill: 'machining', level: 4, },
  desertRat: { skill: 'toughness', level: 2, },
  stormRider: { skill: 'toughness', level: 2, },
  fightThrough: { skill: 'toughness', level: 4, },
  longHaul: { skill: 'toughness', level: 4, },
  marketEars: { skill: 'social', level: 2, },
  rumorMill: { skill: 'social', level: 2, },
  paidTruce: { skill: 'social', level: 4, },
  bountyTalk: { skill: 'social', level: 4, },
};

export const PERK_IDS = Object.keys(PERKS) as PerkId[];

export const PERK_NUMBERS = {
  rammer: { stallTurns: 1 },
  coldRunning: { speedShare: 0.5 },
  dustScreen: {
    topShare: 0.9,
    radius: 2,
  },
  spotter: { turns: TIME.turnsPerDay },
  welder: {
    scrap: 3,
    turns: 3,
    part: 'scrapSheet',
  },
  cannibal: { turns: 1 },
  roadMechanic: { price: 2 },
  desertRat: { sunShare: 0.62 },
  fightThrough: { health: 0.5 },
  rumorMill: { radius: 60 },
  paidTruce: { share: 0.1 },
} as const;

export const MAIN_SKILL: Record<Archetype, SkillId | null> = {
  trader: 'social',
  scavenger: 'machining',
  hunter: 'perception',
  fastTrader: 'driving',
  hauler: 'social',
  climber: 'social',
  markov: null,
};

export const TARGET_DAYS = {
  main: { 2: 4, 4: 16, 5: 30 },
  off: { 2: 10 },
} as const satisfies Record<'main' | 'off', Partial<Record<number, number>>>;

export const TARGET_TOLERANCE = 0.3;
