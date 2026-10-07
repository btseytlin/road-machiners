// Character skills. Activity earns XP into one shared pool, and the player spends it on ranks of any skill. Each rank
// adds `perLevel` of every effect in SKILL_EFFECTS. XP numbers are starting values for the progression simulator to tune.

import type { Archetype } from '../sim/progression/bot';
import type { SkillId, XpSource } from '../sim/types';
import { TIME } from './time';

export const SKILL_IDS: readonly SkillId[] = ['driving', 'perception', 'machining', 'toughness', 'social'];

// Fraction each level adds to an effect. Every reader names its effect, so a missing key fails typecheck.
const EFFECTS = {
  driving: {
    turnRate: 0.1, // turn rate +10% per level
    crashDamage: 0.1, // crash damage taken -10% per level
    roughSpeed: 0.1, // speed penalty of slow ground -10% per level
    crawl: 0.1, // limp speed of a stranded truck +10% per level
  },
  perception: {
    spread: 0.05, // weapon spread -5% per level
    sight: 0.04, // sight radius +4% per level
    hearing: 0.08, // range engines are heard from +8% per level
    contactFix: 0.08, // contact circle radius -8% per level
  },
  machining: {
    repair: 0.1, // repair turns and parts -10% per level
    fieldCap: 0.04, // field repair cap +4% of max HP per level, up to full HP
    refit: 0.08, // refit turns -8% per level, at least 1
    search: 0.08, // salvage search turns -8% per level, at least 1
    engineHeat: 0.08, // engine heating while driving -8% per level
  },
  toughness: {
    supplies: 0.12, // supplies use -12% per level
    maxHealth: 0.06, // max health +6% per level
    cabShare: 0.08, // health lost from cab damage -8% per level
    heatDrain: 0.08, // extra supplies use from heat -8% per level
  },
  social: {
    priceSpread: 0.02, // trade price spread -2% per level, so level 5 cuts at most half of ECONOMY.spread
    towFee: 0.06, // tow fees -6% per level
    patchPrice: 0.06, // paid patch prices -6% per level
    robberyDanger: 0.08, // danger a robber sees in the truck +8% per level
  },
} as const satisfies Record<SkillId, Record<string, number>>;

export type SkillEffect<S extends SkillId> = keyof (typeof EFFECTS)[S] & string;
export const SKILL_EFFECTS: { [S in SkillId]: Record<SkillEffect<S>, number> } = EFFECTS;

// XP from the pool that buys each rank; index 0 is rank 1. Each rank costs more than the last.
export const RANK_COSTS: readonly number[] = [200, 400, 600, 800, 1000];
export const MAX_RANK = RANK_COSTS.length;

// weight is XP per unit of amount. A scaled source multiplies by the difficulty curve in XP_RULES;
// an unscaled source has no difficulty. Weights aim for about dailyCap XP from one day (300 turns) of the matching
// activity at mid difficulty.
// Every practice event names its target, like a driver, a truck, a pile, a map region or a trade good. `repeat` is
// what each earlier event on the same target multiplies the pay by. The count of earlier events halves every
// XP_RULES.repeatHalfLife turns, so a target pays again slowly with game time. A repeat of 0 pays once per target
// for good. Every source decays, so spamming a target pays a bounded total: 1 / (1 - repeat) events.
// `skill` names the source's activity family, which shares one daily cap. The XP itself goes to the shared pool.
export type XpSourceDef = { skill: SkillId; weight: number; scaled: boolean; repeat: number };

export const XP_SOURCES: Record<XpSource, XpSourceDef> = {
  roughTiles: { skill: 'driving', weight: 0.5, scaled: true, repeat: 0.9 }, // per tile driven off the road, about 4 a turn; target: map region
  ram: { skill: 'driving', weight: 0.25, scaled: true, repeat: 0.7 }, // per HP of crash damage the player's truck deals; target: rammed truck
  escape: { skill: 'driving', weight: 8, scaled: true, repeat: 0.25 }, // per turn every hostile truck seen last turn drops out of sight; target: strongest escaped truck
  hit: { skill: 'perception', weight: 6, scaled: true, repeat: 0.95 }, // per round of the player's that hits; target: shot truck
  contact: { skill: 'perception', weight: 0.25, scaled: true, repeat: 0.5 }, // per truck newly detected beyond sight; target: that truck
  discover: { skill: 'perception', weight: 10, scaled: false, repeat: 0 }, // per place found; target: the place
  fieldJob: { skill: 'machining', weight: 0.75, scaled: false, repeat: 0.7 }, // per turn of a finished repair; target: repaired part
  patch: { skill: 'machining', weight: 75, scaled: false, repeat: 0.5 }, // per finished roadside patch on another truck; target: patched truck
  search: { skill: 'machining', weight: 80, scaled: false, repeat: 0 }, // per first finished search of a stock; target: the stock
  heat: { skill: 'toughness', weight: 0.3, scaled: true, repeat: 0.9 }, // per turn driven in heat above shade; target: map region
  damage: { skill: 'toughness', weight: 1.5, scaled: false, repeat: 0.95 }, // per point of health lost to cab damage; target: the driver
  knockout: { skill: 'toughness', weight: 100, scaled: false, repeat: 0.5 }, // per knockout with a hostile truck in sight; target: the driver
  profit: { skill: 'social', weight: 0.8, scaled: false, repeat: 0.8 }, // per money unit of profit on a sale; target: town and good
  deal: { skill: 'social', weight: 30, scaled: false, repeat: 0.5 }, // per finished patch deal, and per handover or threat that ends agreed; target: the other driver
  call: { skill: 'social', weight: 8, scaled: false, repeat: 0 }, // per topic taken up on a radio call; target: driver and topic
  honk: { skill: 'social', weight: 2, scaled: false, repeat: 0 }, // per driver in sight that honks back; target: that driver
  contract: { skill: 'social', weight: 1, scaled: false, repeat: 0.8 }, // per XP a finished contract names; target: the shop that posted it
  // Per money unit of tow fee the player waives, paid on arrival. The profit weight, so kindness teaches as much as
  // earning that money would. Target: the towed driver.
  freeTow: { skill: 'social', weight: 0.8, scaled: false, repeat: 0.5 },
  // Per money unit of fuel and supplies the player gives free, at the town supply price, paid when they change hands.
  // The profit weight, like freeTow. Target: the driver who got them.
  aid: { skill: 'social', weight: 0.8, scaled: false, repeat: 0.5 },
};

export const XP_RULES = {
  // Difficulty 0 is a sure thing and pays `easy` times the weight; difficulty 1 is a long shot and pays `hard`.
  easy: 0.25,
  hard: 2,
  // XP an activity family earns per in-game day at the full rate. Past it, XP pays `overCap` times as much.
  dailyCap: 150,
  overCap: 0.1,
  // Turns for the count of earlier events on one target to halve: one day.
  repeatHalfLife: 200,
  // A decaying target with fewer earlier events than this is forgotten at the day's first practice.
  forgetBelow: 0.01,
  // Map regions for region targets, in tiles on a side.
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

// Skill ranks that open a pair of perks.
export const PERK_LEVELS = [2, 4] as const;
export type PerkLevel = (typeof PERK_LEVELS)[number];

export type PerkDef = { skill: SkillId; level: PerkLevel };

// Each pair splits its skill into two playstyles. A perk adds an action, breaks a rule or shows hidden information.
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
  rammer: { stallTurns: 1 }, // turns a rammed hostile truck's engine stays stalled
  coldRunning: { speedShare: 0.5 }, // share of top speed below which the engine is heard only inside sight
  dustScreen: {
    topShare: 0.9, // share of top speed that counts as top speed, since fuel and slopes keep a truck just under it
    radius: 2, // tiles from a screening cloud within which it blocks a sight line
  },
  spotter: { turns: TIME.turnsPerDay }, // turns a mark tracks its truck
  welder: {
    scrap: 3, // units of scrap metal one weld spends
    turns: 3, // parked turns of a weld, like installing a part
    part: 'scrapSheet', // the part a weld makes, pristine
  },
  cannibal: { turns: 1 }, // job turns to take one part from a wreck stock or a knocked-out truck
  roadMechanic: { price: 2 }, // paid patch price when the player patches, times this
  desertRat: { sunShare: 0.62 }, // cap on the sun height share that heats the engine: the 9:00 sun, sin(pi * 3 / 14)
  fightThrough: { health: 0.5 }, // share of max health above which a broken cab or a cab knock does not knock the player out
  rumorMill: { radius: 60 }, // tiles around the driver in which it knows a wreck or site
  paidTruce: { share: 0.1 }, // truce price as a share of the driver's truck value
} as const;

// ---- Progression targets, checked by the progression band test and printed by npm run progression:report.
// Edit these days to change the curve, then tune XP_SOURCES until the report passes.

// The skill each archetype mostly practices. The markov bot has none; all its skills count as off skills.
export const MAIN_SKILL: Record<Archetype, SkillId | null> = {
  trader: 'social',
  scavenger: 'machining',
  hunter: 'perception',
  fastTrader: 'driving',
  hauler: 'social',
  climber: 'social',
  markov: null,
};

// In-game day by which a skill reaches a level, keyed by level. A level missing from a table is not checked.
export const TARGET_DAYS = {
  main: { 2: 4, 4: 16, 5: 30 },
  off: { 2: 10 },
} as const satisfies Record<'main' | 'off', Partial<Record<number, number>>>;

// A curve passes when it reaches a level within this share of the target day, either way.
export const TARGET_TOLERANCE = 0.3;
