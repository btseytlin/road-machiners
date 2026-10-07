// Tuning numbers for NPC drivers: behavior limits, upkeep, hunting grounds and names. Re-exported by src/data/npcs.ts.

import { RULES } from './rules';
import { TERRAIN } from './terrain';
import { TIME } from './time';
import type { MemoryFact } from '../sim/types';

export const NPC_BEHAVIOR = {
  // Turns a driver may go without progress before it gives up its top goal. Progress is a new tile, a job turn or a
  // new top goal. A crawling truck changes tile every turn, and every timed deal lapses in 60 turns or less, so 100
  // turns without progress is always a bug. See watchStalls() in src/sim/npc-activities.ts.
  stallTurns: 100,
  // Tiles a stalled driver out of the player's sight may jump to get clear of whatever holds it. 20 tiles is about
  // six turns of driving, enough to leave a pad, a pocket between props or a jam of trucks, and well inside the
  // 80 tiles of gray vision, so the driver stays in the same area.
  stallJump: 20,
  // Escort fee per tile of straight distance from the client to its destination. Bowl and Nose lie about 520 tiles
  // apart. A trader load of about 8 units earns about 50 a unit there, so about 400. 0.15 a tile makes that escort
  // cost about 78, a fifth of the load's profit.
  escortFeePerTile: 0.15,
  // Decline weight times this when the merc is weak. A decline weight of 1 against take 3 then wins about 7 to 1.
  weakDecline: 20,
  // A leader waits while an escort lags farther than this many tiles behind. A truck cruises about 3.4 tiles a
  // turn on a road, so 12 tiles is three to four turns of driving, still well inside sight.
  escortWaitGap: 12,
  // Tiles from a town gate a patrol drives out to: the gate guns' range plus four sight radii, about 90 tiles. A
  // patrol covers the roads well past the guns, about a sixth of the way to the other town.
  patrolRadius: RULES.guards.range + TERRAIN.vision.radius * 4,
  // Tiles along a road between two patrol stops. Close enough that stops spread over every approach.
  patrolSpacing: 4,
  // Tiles a follower keeps to the side of its leader past both radii: the yield distance plus one, so it rides
  // outside the collision check of src/sim/ai.ts.
  followGap: RULES.yieldDistance + 1,
  // A driver whose cab, whole truck or own health is at 30% is weak. Recovery to half prevents fight/flee oscillation.
  fleeCondition: 0.3,
  // Fight driving; see src/sim/ai.ts. A fighter scores `angles` points around its target's next spot. Each
  // point gets arcWeight × the share of its gun damage that bears from there, minus threatWeight × the share of the
  // target's gun damage that bears on it and gets past the armor on the side it shows each gun, minus rangeWeight × how far off its range the point is as a share of it,
  // minus travelWeight × the drive past one turn at top speed as a share of that speed. A circling fighter adds
  // circleWeight × how far ahead around the target the point lies, as a share of a quarter turn, and never drives
  // slower than circlePace tiles a turn. Every fighter subtracts rammedWeight × the ram value of the target's ram at
  // that point, and one that rams readily adds ramWeight × the ram value of its own ram from there. A fighter rolls
  // fightWhim every whimTurns turns.
  fight: { angles: 16, arcWeight: 2, threatWeight: 2, rangeWeight: 1, travelWeight: 1, circleWeight: 1, rammedWeight: 2, ramWeight: 2, circlePace: 3, whimTurns: 4 },
  // One driver in three the player knocks out holds a grudge. See the revenge state.
  revengeChance: 0.33,
  recoverCondition: 0.5,
  // An enemy is a threat when its perceived danger beats the driver's own times this and its boldness.
  threatRatio: 1,
  // A sighting misjudges a truck's danger by up to a quarter either way, rolled once per sighting. Damage shows,
  // but only roughly.
  dangerSpread: 0.25,
  // Flee weight times this against a threat, and again when the cab or driver is at the flee condition.
  // 20 makes an outgunned raider run about two times in three, and an outgunned scavenger nearly always.
  threatFlee: 20,
  weakFlee: 20,
  // Damage taken last turn, as a share of cab max HP, that adds the base weight to flee when attacked.
  hurtFullFlee: 0.1,
  // A shot that did no damage gives flee this much of its base weight when attacked.
  missFlee: 0.5,
  // Fight and fight back times this when the hostile's local group looks no stronger than the driver's own. A
  // driver busy with work gets it only when attacked, so it defends but does not start fights.
  manageableFight: 5,
  // Keep times this when a driver busy with work and not weak sees or hears a hostile that is not aimed at it or
  // at a nearby faction mate. A scavenger at work then keeps on about 99 times in 100 beside an equal hostile, and
  // about 94 times in 100 beside one it judges a threat.
  keepWork: 400,
  // Turns a noticed subject stays remembered after it was last perceived. A heard engine drops out for a turn or
  // two when the truck slows or crosses behind the listener, and 3 turns bridges that without a fresh roll.
  noticeMemory: 3,
  // Turns a fighter hunts a target it lost from sight, counted from the last turn it saw it or picked up its sound
  // or dust. A truck cruises about 3.4 tiles a turn on a road, so 6 turns carry the hunter about 20 tiles, one sight
  // radius past the last point. A player who goes quiet behind a hill gets away, and a noisy one stays hunted.
  fightSearchTurns: 6,
  // Investigate weight times this when the cab or a driving part is at or below the recover condition. A raider's
  // investigate weight of 12 drops to 0.12, so a crippled raider closes in on a contact 1 to 4 times in 100.
  crippledInvestigate: 0.01,
  // Keep weight times this when a raider watching from its post hears prey beyond sight. A raider's 1 : 10.8 : 3 for
  // keep, investigate and flee becomes 30 : 10.8 : 3, so it lies low about 2 times in 3 and lets the prey come on.
  watchKeep: 30,
  // Resume weight times this when a raider with sale cargo comes back to its raid or patrol after an interruption,
  // like looting a robbed truck. Resume 9 x 0.01 against new 1 resumes about 1 time in 12, so the raider mostly drops
  // the hunt and takes the cargo to a camp, or scrap and parts to the Salvage Yard, as an empty stack does.
  lootedResume: 0.01,
  // A ram is worth its expected net damage: what the crash model says it takes off the target minus what it takes off
  // the rammer, each part counted by partWeight, times the chance it connects. It competes with the rammer's guns over
  // the same turns, at gunWeight per point of gun damage that gets past the armor. The ram's share of the two is the
  // ram value, from 0 to 1. A ram that nets nothing, or leaves the rammer below the flee condition, is worth 0.
  ram: {
    // Value of one hit point lost, by the part that loses it. The cab, wheels, engine and guns decide a fight. Armor
    // and ram bars exist to be hit.
    partWeight: { cab: 4, wheel: 2, transmission: 2, tank: 1, engine: 3, weapon: 3, armor: 0.25, scanner: 1, store: 1, cargo: 1 },
    gunWeight: 1,
    // Ram weight is the ram value times this, so a ram worth as much as the guns, a value of 0.5, weighs 0.15 times the
    // base weight and is chosen about 1 time in 2. Against an equal truck this gives a ram in about 1 fight in 8 without
    // a ram bar and 1 in 3 with one.
    valueScale: 0.3,
    // Ram weight when the ram is worth nothing. A ram weight of 9 drops to 0.009, about 1%.
    riskyRam: 0.001,
    // The chance a ram connects is 1 / (1 + sway), where sway is the sideways distance the target can open before the
    // impact, as a share of the width of the path. The rammer closes at its impact speed, so each tile of gap costs
    // 1 / impact turns. The target can move out at its speed times (dodge + how far its heading is off the ram line, as a
    // sine). A parked or stranded target never moves, so it is hit for sure. A truck at 6 tiles a turn, 12 tiles off, 
    // crossing the line, has a sway of about 5 and connects about 1 time in 6.
    dodge: 0.3,
  },
  // Salvage in sight weighs 10 times a known site out of sight.
  visibleSalvage: 10,
  // A robber mostly picks targets weaker than itself, away from town guards. Rob weight times this when the
  // target looks as strong as the robber times its boldness or stronger. A scumbag's rob weight of 0.5 drops to
  // 0.0075, so it robs at about 2%, not 34%.
  robStronger: 0.015,
  // Rob weight times this when the robber or target is within guard range of a town gate. Same drop as above.
  robNearGuards: 0.015,
  // What the target's cargo is worth to a robber or raider: goods and spare parts, not mounted gear. At or below
  // `poor` the weight is times `poorMul`, at or above `rich` it is unchanged, and between them it rises
  // geometrically so the chance climbs evenly. Rob: a scumbag's 0.45 falls to the 1% floor up to 150 in cargo,
  // robs about 5% at 300, 13% at 400 and 31% from 500. Raid: a raider's fight of 45 against manageable prey is
  // about 4% against an empty truck, 13% against the start cargo (78), 50% at 200 and 96% from 400. A revenge
  // grudge skips it.
  lootAppeal: {
    rob: { poor: 150, rich: 500, poorMul: 0.02 },
    raid: { poor: 0, rich: 400, poorMul: 0.002 },
  },
  // Fight weight at a new hostile times this near town guards. A raider's fight weight of 50 against manageable
  // prey drops to 0.05, about 3%. Guards never lower fight back.
  fightNearGuards: 0.001,
  // Tow weight falls when the stranded truck can crawl to a town gate. At limp speed, about 1 tile a turn, 15
  // tiles is a crawl of 15 turns, under two hours of the day. Within it, a tow weight of 9 drops to 0.18 against
  // keep 1, so about one passing driver in six offers. From there the factor rises in a straight line to 1 at 60
  // tiles, a crawl of most of a morning.
  towNearTown: { factor: 0.02, crawl: 15, far: 60 },
  // Retaliate weight times this after a crash with a faction mate. Four in five raiders then forgive a mate.
  mateRetaliate: 0.1,
  // Truce weight times this when the foe's local group is a threat. A trader's truce weight of 2.5 rises to 12.5
  // against keep 8, so about three hurt turns in five bring an offer.
  threatTruce: 5,
  // Beg weight times this when the driver is weak. A weight of 0.1 rises to 4 against keep 8.
  weakBeg: 40,
  // Accept weight times this when the pleading foe's group is a threat or the answering driver is weak.
  threatAccept: 5,
  // Refuse weight times this when the driver is robbing the pleading foe and neither faces a threat nor is weak.
  // A robber that holds up a foe with cargo names its price instead (holdsUp), so this covers the rest: prey with
  // no cargo, or a stranded or on-duty robber.
  // A raider hunting a truck with loot counts as robbing it. A scumbag's 2 to 1 for accept becomes 2 to 20, so a
  // confident robber takes a truce about one time in ten. A raider's 2 to 3 becomes 2 to 60, about one in twenty.
  robberRefuse: 20,
  // Truce weight times this when a hurt driver is not weak and its foe is no threat, so it is winning. A trader's
  // truce weight of 2.5 drops to 0.025 against keep 8, and every driver then offers at about the 1% floor.
  winningTruce: 0.01,
  // Comply weight times this when the player's local group is a threat. It then beats fight back and flee by far.
  threatComply: 20,
  // Comply weight times this when the driver's escort is in sight and awake. A threatened or warned-off driver then
  // hands over its cargo a tenth as often, so a demand on a guarded convoy mostly starts a fight with its guard.
  guardedComply: 0.1,
};

export const NPC_UPKEEP = {
  repairParts: 2, // two field patches, kept out of sale cargo
  shadeSearchRadius: 6, // a short local detour, rather than a journey while damaged
  // A driver heads for fuel once its tank holds less than this many times the fuel it thinks the way to its
  // nearest pump takes. It judges the straight line at the heat where it stands, so a winding road, a hotter noon
  // or a detour after it turns back can drain the tank on the way.
  fuelReserve: 1.5,
  // Each driver misjudges by its own fixed share, up to this much either way. A careless trader runs dry now
  // and then, and a careful one never does.
  fuelSense: 0.35,
  lowSupplies: RULES.lowFuelThreshold,
  // Reserve one full tank and supply load before buying trade cargo.
  reserveLoads: 1,
  // A driver sells fuel and supplies to the player only above this share of its caps.
  tradeReserve: 0.5,
};

// Fuel and supply aid between the player and NPCs, see src/sim/aid.ts. A truck is low on a supply at or below
// RULES.lowFuelThreshold of its cap, where its speed halves.
export const AID = {
  // A low driver asks the player for enough of each low supply to reach this share of its cap, the same small share it
  // gives. Fuel is also capped by the driver's pump reserve.
  fillShare: 0.25,
  // A giving driver hands over this share of the player's cap per low supply, only from stock above
  // NPC_UPKEEP.tradeReserve. A small gift, enough to reach a pump.
  giftShare: 0.25,
  // A driver offers aid unprompted only to a player whose truck is below this share of its body condition...
  poorCondition: 0.5,
  // ...and worth at most this much. That covers the start scout, worth about 3600 new, and worn tier 1 trucks, not
  // geared tier 2 and 3 trucks like the combat start kit's hauler, worth about 6000.
  poorValue: 4000,
  // Turns both trucks stay parked side by side after the player presses [E] before the goods move.
  handoverTurns: 1,
};

// Raiders look for prey on lonely road stretches and at the pads of salvage sites, where scavengers stop. Each raider
// hunts only the grounds nearest its own camp, and only those outside lawman reach. Vultures prowl all of them.
export const HUNT = {
  roadSpacing: 60, // tiles along a road between two hunting points: three sight radii, so views do not overlap
  // Tiles from any site edge to a road hunting point: two sight radii. Prey there has left a town or site
  // behind and is alone on the road.
  siteDistance: 40,
  // Tiles from any lawman town gate within which a raider never hunts: the farthest lawman patrol stop plus its sight.
  lawReach: NPC_BEHAVIOR.patrolRadius + TERRAIN.vision.radius,
  // A hunting raider's route cost per road tile; open ground costs 1 / terrain speed, without the off-road cost. So
  // hardpan 1.11, gravel 1.18, scrub and field 1.25 beat the road, sand 1.43 nearly ties it, and crossing a road
  // costs only its width. It stays at 1 or more, so the A* estimate stays as tight as for a plain route.
  roadShun: 1.5,
  // A raider whose top goal is one of these routes off the road; see src/sim/hunt-style.ts.
  offRoadGoals: ['raid', 'patrol', 'investigate'] as const,
  // Watch posts; see src/sim/watch-posts.ts. A post lies at least postRoadGap tiles from a road's edge, where a
  // parked raider is out of the way of traffic but a road in sight. A ground that is no post itself tries points
  // on each ring, in tiles around it, at postBearings even bearings, and keeps the first that qualifies. Every ring
  // lies inside the 20-tile sight radius, so the post sees its ground.
  postRoadGap: 6,
  postRings: [10, 14, 7],
  postBearings: 16,
  // Tiles along a road between two stops of a raider patrol around its camp, before they move to their posts.
  patrolPostSpacing: 20,
  // Turns a raid watches from its post, parked and silent. It stays under NPC_BEHAVIOR.stallTurns, so a watching
  // raider never stalls.
  watchTurns: 40,
};

// Driver memories; see src/sim/memory.ts. Each kind's lifetime in turns is explicit. One game day is the default:
// long enough to tell of a town on the road away from it, short enough that the facts still hold.
export const MEMORY = {
  turns: { prices: TIME.turnsPerDay } satisfies Record<MemoryFact['kind'], number>,
};

// Trade tips; see tradeTip() in src/sim/dialogue-rules.ts. A remembered price at least this share off a good's value
// is worth telling. At rest every good a shop makes sits at 0.75 of value, and a good far from its maker climbs past
// 1.2.
export const TRADE_TIP = { share: 0.2 };

// Name pools for NPC drivers. Each driver gets one first name and one surname at spawn.
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
