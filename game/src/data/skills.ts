// Character skills. Activity earns XP into one shared pool, and the player spends it on ranks of any skill. Each rank
// adds `perLevel` of every effect in SKILL_EFFECTS. XP numbers are starting values for the progression simulator to tune.

import type { Archetype } from '../sim/progression/bot';
import type { SkillId, XpSource } from '../sim/types';
import { TIME } from './time';

export const SKILL_IDS: readonly SkillId[] = ['driving', 'perception', 'machining', 'toughness', 'social'];

export const SKILL_INFO: Record<SkillId, { name: string; grows: string }> = {
  driving: { name: 'Driving', grows: 'rough ground, rams, escapes' },
  perception: { name: 'Perception', grows: 'hits, contacts, discoveries' },
  machining: { name: 'Machining', grows: 'field jobs, patches, searches' },
  toughness: { name: 'Toughness', grows: 'heat, damage taken, knockouts' },
  social: { name: 'Social', grows: 'trade profit, deals, contracts, radio' },
};

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

export type PerkId =
  | 'rammer' | 'coldRunning' | 'steadyAim' | 'dustScreen'
  | 'readDriver' | 'spotter' | 'cargoEye' | 'nightEyes'
  | 'welder' | 'cannibal' | 'rebuild' | 'roadMechanic'
  | 'desertRat' | 'stormRider' | 'fightThrough' | 'longHaul'
  | 'marketEars' | 'rumorMill' | 'paidTruce' | 'bountyTalk';

export const PERK_LEVELS = [2, 4] as const;
export type PerkLevel = (typeof PERK_LEVELS)[number];

export type PerkDef = { skill: SkillId; level: PerkLevel; name: string; rule: string };

export const PERKS: Record<PerkId, PerkDef> = {
  rammer: { skill: 'driving', level: 2, name: 'Rammer', rule: 'A ram on a hostile truck stalls its engine for one turn.' },
  coldRunning: { skill: 'driving', level: 2, name: 'Cold running', rule: 'Below half speed, your engine is heard only inside sight.' },
  steadyAim: { skill: 'driving', level: 4, name: 'Steady aim', rule: 'Your own speed adds no scatter to your shots.' },
  dustScreen: { skill: 'driving', level: 4, name: 'Dust screen', rule: 'At top speed on dusty ground, your dust blocks sight like a hill.' },
  readDriver: { skill: 'perception', level: 2, name: 'Read the driver', rule: 'You see the traits of other drivers.' },
  spotter: { skill: 'perception', level: 2, name: 'Spotter', rule: 'Mark a seen truck, and it stays tracked for a day.' },
  cargoEye: { skill: 'perception', level: 4, name: 'Cargo eye', rule: 'You see the goods and spare parts in any seen truck.' },
  nightEyes: { skill: 'perception', level: 4, name: 'Night eyes', rule: 'Night does not halve your sight.' },
  welder: { skill: 'machining', level: 2, name: 'Welder', rule: 'A field job turns 3 scrap metal into a scrap armor sheet.' },
  cannibal: { skill: 'machining', level: 2, name: 'Cannibal', rule: 'Taking a part from a wreck or a knocked-out truck takes one turn.' },
  rebuild: { skill: 'machining', level: 4, name: 'Rebuild', rule: 'A town garage can repair a junk part to its last wear step, once per part.' },
  roadMechanic: { skill: 'machining', level: 4, name: 'Road mechanic', rule: 'Drivers pay double for the patches you do.' },
  desertRat: { skill: 'toughness', level: 2, name: 'Desert rat', rule: 'Noon sun heats your engine like morning sun.' },
  stormRider: { skill: 'toughness', level: 2, name: 'Storm rider', rule: 'Dust storms do not cut your sight or aim.' },
  fightThrough: { skill: 'toughness', level: 4, name: 'Fight through', rule: 'A broken cab, or a hit on a cab below half, does not knock you out while health is above half.' },
  longHaul: { skill: 'toughness', level: 4, name: 'Long haul', rule: 'You heal while driving, not only while parked.' },
  marketEars: { skill: 'social', level: 2, name: 'Market ears', rule: 'A trader you call tells you the prices of the last town it left, as they were then.' },
  rumorMill: { skill: 'social', level: 2, name: 'Rumor mill', rule: 'A driver you call marks a wreck or site it passed.' },
  paidTruce: { skill: 'social', level: 4, name: 'Paid truce', rule: 'You can pay a hostile driver to end its feud with you.' },
  bountyTalk: { skill: 'social', level: 4, name: 'Bounty talk', rule: 'A raider that gives up to you counts for bounty contracts.' },
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
