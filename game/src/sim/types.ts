// World state. Plain data only, so it clones and serializes.

import type { PartHit, Side } from "./armor";
import type { TraitId } from "../data/npcs";
import type { PropKind, Terrain } from "./terrain";
import type { Vec } from "./vec";
import type { TopicId } from "../data/dialogue";
import type { DecisionOptions } from "../data/npcs";
import type { Contract, ShopState } from "./market";
import type { Rng } from "./rng";
import type { PerkId } from "../data/skills";

export type PatchDeal = DecisionOptions["patchDeal"];

export type Faction = "player" | "raiders" | "traders" | "scavengers" | "bowl" | "nose" | "couriers" | "roamers" | "vultures" | "convoys" | "mercs";
export type SkillId = "driving" | "perception" | "machining" | "toughness" | "social";
export type XpSource =
  | "roughTiles" | "ram" | "escape"
  | "hit" | "contact" | "discover"
  | "fieldJob" | "patch" | "search"
  | "heat" | "damage" | "knockout"
  | "profit" | "deal" | "call" | "honk" | "contract" | "freeTow" | "aid";

export type PartInstance = {
  id: string;
  defId: string;
  hp: number;
  gun?: GunState; // weapons only
  wear: number; // wear steps from breaking, 0 for pristine. See src/sim/condition.ts.
  rebuilt?: true; // a junk part rebuilt to the last wear step, which cannot be rebuilt again; see src/sim/wear.ts
};

// A weapon's fire state. cooldown counts turns to the next shot. reloadWork counts turns toward a full magazine,
// and firing resets it. See src/sim/combat.ts.
export type GunState = { cooldown: number; ammo: number; reloadWork: number };

// An item in a vehicle's inventory grid. x and y are the top-left cell. rot 1 swaps width and height.
// A part works only while it lies fully on mount cells of its kind. Each good unit takes one cell.
export type GridItem =
  | {
      id: string;
      x: number;
      y: number;
      rot: 0 | 1;
      kind: "part";
      part: PartInstance;
    }
  | {
      id: string;
      x: number;
      y: number;
      rot: 0 | 1;
      kind: "good";
      good: string;
    };

// 'body' aims at the truck as a whole. Otherwise it is the id of a part on the target.
export type Aim = "body" | string;
export type WeaponOrder = { targetId: string; aim: Aim };

export type Pose = { x: number; y: number; heading: number };

// Momentum carries over between turns. A vehicle without an order coasts.
export type MoveOrder =
  | { kind: "through"; dest: Vec; pace?: number } // drive through the point, then coast on; a follower's pace in tiles per turn replaces the throttle zones
  | { kind: "stopAt"; dest: Vec } // brake in time to stop on the point
  | { kind: "brake" }; // slow to a halt where you are

export type SalvageStock = {
  id: string;
  pos: Vec;
  radius: number;
  goods: Record<string, number>;
  parts: PartInstance[];
  fuel?: number; // fuel units that pour into a tank, not the grid
  supplies?: number; // supply units that go to driver stores, not the grid
  pile?: Pile; // loot lying loose on the ground, drawn as a heap. Sites and wrecks draw their own stock.
  emptySince?: number; // turn a daily check first found a road wreck looted; see renewSalvage in src/sim/salvage.ts
};

// A pile is gone at turn `until`. The player's items and other trucks' items never share a pile. A player pile counts
// as searched, and `basis` keeps the average paid per unit of each good on it, so taking them back restores their
// cost. Goods on any other pile cost nothing.
// An NPC that was handed the pile claims it. The claim lapses at turn `until` or when the claimant drops its loot goal
// on the pile, is knocked out or leaves the world. `warned` lists the drivers who agreed to back off.
export type PileClaim = { by: string; until: number; warned: string[] };
export type Pile = { until: number; fromPlayer: boolean; basis: Record<string, number>; claim?: PileClaim };

export type RefitMove = {
  itemId: string;
  from: { x: number; y: number; rot: 0 | 1 };
  to: { x: number; y: number; rot: 0 | 1 };
};

// A part a refit takes onto the grid, from a salvage stock or off a knocked-out truck. itemId is its new grid item.
export type RefitPickup =
  | { from: 'stock'; stockId: string; partId: string; itemId: string; to: RefitMove['to'] }
  | { from: 'truck'; vehicleId: string; partId: string; itemId: string; to: RefitMove['to'] };

export type RefitJob = {
  kind: 'refit';
  moves: RefitMove[];
  pickup: RefitPickup | null;
  turnsLeft: number;
  total: number;
};

// Work that needs the truck parked. Moving above parked speed cancels it, and finished turns are lost.
export type Job =
  | {
      kind: "repair";
      partId: string;
      parts: number;
      turnsLeft: number;
      total: number;
      auto?: true;
    } // parts: the most this job spends. auto: started by auto patch, so any player job replaces it
  | { kind: "search"; stockId: string; turnsLeft: number; total: number }
  | { kind: "strip"; partId: string; turnsLeft: number; total: number }
  | { kind: "weld"; turnsLeft: number; total: number } // the welder perk: scrap metal into a scrap armor part
  | RefitJob;

// A vehicle detected beyond sight. The circle always holds the true position, which it never reveals.
// The circle always holds the vehicle's true position. loudness is how far the engine carries, in tiles,
// when the vehicle is heard; a big engine or a fast truck is louder. Null when it is not heard.
export type Contact = {
  vehicleId: string;
  center: Vec;
  radius: number;
  sources: ("sound" | "dust" | "radio" | "beacon" | "mark")[]; // mark: the spotter perk tracks the vehicle
  loudness: number | null;
};

// A dust cloud a moving vehicle kicked up. It hangs in the world for a while: it rises, drifts back along
// the way its truck came and with the wind, and fades. Once risen it can be seen from beyond sight range.
export type DustCloud = {
  id: string;
  source: string; // vehicle id that raised it
  pos: Vec;
  vel: Vec; // tiles per turn
  age: number; // turns since it was raised
  range: number; // tiles it can be seen from once risen, set by the speed and ground that raised it
  screen?: true; // raised under the dust screen perk, so it blocks sight lines; see src/sim/vision.ts
};

// Weather that changes the rules. Storms are moving areas; heat waves and overcast cover the region.
export type WeatherEvent =
  | {
      id: string;
      kind: "storm";
      pos: Vec;
      radius: number;
      vel: Vec;
      turnsLeft: number;
    }
  | { id: string; kind: "heatwave" | "overcast"; turnsLeft: number };

export type DriverResources = {
  money: number;
  fuel: number;
  supplies: number;
  health: number;
};

export type NpcActivity = {
  kind:
    | 'scavenge' | 'prowl' | 'sell' | 'trade' | 'resupply' | 'raid' | 'fight' | 'flee' | 'wait' | 'investigate' | 'tow' | 'loot' | 'repair' | 'patch'
    | 'meet' | 'retreat' | 'rearm' | 'patrol' | 'travel' | 'explore' | 'haul' | 'follow';
  targetId: string | null;
  destination: Vec | null;
  phase: "travel" | "act";
  reason: string;
  purchase?: { good: string; sellShop: string };
  load?: { good: string }; // the good a haul loads free at its source site
  perceived?: number; // the turn a fight last saw or detected its target
  demands?: boolean; // a fight on the player radios for the cargo before the first shot
  until?: number; // the turn a rearm's fresh gear is ready
};

export type NpcBrain = {
    templateId: string;
    driver: string; // first name and surname, rolled at spawn
    traits: TraitId[]; // base traits of the template plus the extras rolled at spawn
    goals: NpcActivity[]; // goal stack, top last: a long-term goal at the bottom, interruptions above it
    noticed: Record<string, number>; // `<decision>:<vehicle id>` for subjects already decided on, to the turn last perceived
    hurt: number; // part damage taken last turn
    gunnedBy?: string; // the camp whose gate gun shot at this driver last turn, until the driver decides on it
    fullAt?: number; // free cells when a sale would have made room for a loot the hold could not take, until the hold frees more
    unfit?: string[]; // loot the driver reached and found would not fit its truck even after a sale
    // Vehicles that shot at this driver or a nearby visible faction mate, while they stay visible hostiles. The value
    // is true once the driver decided on the latest shots. Attackers may always be fired back at.
    attackers: Record<string, boolean>;
    goal: Vec | null;
    home: Vec;
    stepIndex: number; // route progress for traders and scavengers
    lastPos?: Vec; // position before the last drive attempt
    stalled?: number; // consecutive turns without forward progress
    stuck?: number; // consecutive turns standing still with the goal point out of reach
    progress?: { key: string; since: number }; // what the driver last did and the turn it began; see watchStalls()
    recovery?: number; // turns left backing away from a blockage or driving to a spot that unsticks the driver
    recoveryGoal?: Vec;
    ramChoice?: string; // the fight target this driver chose to ram while its ram chance lasts
    ramTarget?: string; // the fight target this driver drives through this turn
    fightTurn?: 1 | -1; // a circling fighter's direction around its target; see src/sim/ai.ts
    // Where the fight target was, how it faced and how fast it drove when the driver last read it, on `turn`.
    targetSeen?: { id: string; turn: number; pos: Vec; heading: number; speed: number };
    // The fight whim rolled last, held until turn `until`. angle is where around the target a veer drives.
    whim?: { kind: 'keep' | 'rush' | 'halt' | 'veer'; until: number; angle: number };
    farRoute?: { dest: Vec; points: Vec[] }; // route points still ahead while far from the player, for the order's dest
    // Hidden facts the driver saw, oldest first, at most one per subject. Only src/sim/memory.ts writes them.
    memories: Memory[];
};

// A fact a driver saw. Each kind has a subject rule and a lifetime in src/sim/memory.ts.
// prices: a shop's standing pressure for each good it trades, when the driver did business there.
export type MemoryFact = { kind: 'prices'; shop: string; pressure: Record<string, number> };
export type Memory = { turn: number; fact: MemoryFact }; // turn: when the driver saw the fact

export type Vehicle = {
  id: string;
  name: string;
  faction: Faction;
  chassisId: string;
  items: GridItem[]; // inventory grid contents: parts, mounted or spare, and goods
  pos: Vec;
  heading: number; // radians, 0 = +x
  speed: number; // tiles per turn at the end of the last turn
  strandedTurns?: number; // consecutive turns that ended with the truck flipped or lifted off the ground
  stalledUntil?: number; // last turn the engine stays stalled after a ram; see src/sim/crash-contact.ts
  order: MoveOrder | null; // null: coast, keeping speed and heading
  direct: boolean; // drive straight at the order's point instead of routing around obstacles; the player's manual mode
  weaponOrders: Record<string, WeaponOrder>; // key: weapon part id
  trail: Pose[]; // poses through the last turn, for animation
  brain: NpcBrain | null;
  resources: DriverResources | null;
  lastHitBy: string | null; // vehicle id or `guard-<site>` of the last damage source, for kill credit
  job: Job | null;
  defeat?: Defeat; // set from a knockout until an NPC refits at home or the player wakes; see src/sim/defeat.ts
};

// A lost fight. The driver lies 'out' until the trucks that attacked it look away. An NPC then retreats home.
// turns: turns spent out. unseen: turns in a row the retreating truck spent beyond the player's gray vision.
// foes: the vehicles that attacked it before the knockout. gaveUp: true for a driver that gave up to a demand, false
// for a knockout.
export type Defeat = { phase: 'out' | 'retreat'; turns: number; unseen: number; foes: string[]; gaveUp: boolean };

// Every baked prop but a rock is a landmark of its prop kind.
export type LandmarkLook = Exclude<PropKind, "rock">;

// The chassis a dead truck leaves as its wreck. yaw is the truck's heading when it died, in radians from map +x toward +y.
export type Hulk = { chassisId: string; yaw: number };

export type Obstacle =
  // Only a kill wreck has a hulk. Map, road and convoy wrecks, and kill wrecks from saves before format 2.10, show the
  // generic wreck.
  | { id: string; pos: Vec; r: number; kind: "rock" | "wreck" | "building" | "water" | "site"; hulk?: Hulk }
  // yaw is the direction a landmark faces, in radians from map +x toward +y.
  | { id: string; pos: Vec; r: number; kind: "landmark"; look: LandmarkLook; yaw: number };

// A prop a truck broke on `turn`. It keeps the whole obstacle, so it grows back unchanged. See breakProp() in
// src/sim/salvage.ts.
export type BrokenProp = { obstacle: Obstacle; turn: number };

// A timed relation one vehicle holds toward another. src/sim/states.ts owns them.
export type StateKindId = 'feud' | 'backedOff' | 'tow' | 'turnedDown' | 'towPromise' | 'answering' | 'patch' | 'truce' | 'grievance' | 'plea' | 'trade' | 'revenge' | 'escort' | 'strayFire' | 'aid' | 'combat';
export type StateEnding = 'expired' | 'fulfilled' | 'broken';
export type Plea = 'truce' | 'mercy';
// A tow state: the holder tows the other party to the town or camp `site` for `fee`, paid on arrival. `waived` is
// the fee a player tower let go, which pays Social XP on arrival. hitched is false while an offer to the player is open.
// A tow promise: the terms of a tow the holder dropped for danger, which its next offer keeps.
// A feud: robbery is true when the holder started it to rob the other party, so a win sends it to loot.
// An escort: the holder guards the other party to the town or location `site` for `fee`, paid on arrival. A null
// site never arrives, so the escort stands until it breaks.
// A plea: the holder asked the other party for a truce or for mercy. answered is false while the player has not
// answered yet.
// An aid deal: the giver hands the receiver fuel and supplies when both are parked side by side. The holder is always
// the NPC and the other party the player. price is what the NPC pays, 0 when free or for an NPC gift. agreed is false
// while an NPC's unprompted offer waits for the player's answer. started is set by the player's [E]; work and workLeft
// are the handover turns. See src/sim/aid.ts.
export type StateData =
  | { kind: 'tow'; site: string; fee: number; waived: number; hitched: boolean }
  | { kind: 'feud'; robbery: boolean }
  | { kind: 'towPromise'; site: string; fee: number }
  | { kind: 'plea'; plea: Plea; answered: boolean }
  | { kind: 'escort'; site: string | null; fee: number }
  | { kind: 'patch'; deal: PatchDeal; parts: number; partIds: string[]; price: number; work: number; workLeft: number } // holder patches other; partIds are the client parts it lifts, fixed at agreement
  | { kind: 'strayFire'; damage: number } // unintended damage the holder took from the other party
  | { kind: 'aid'; giver: 'player' | 'npc'; fuel: number; supplies: number; price: number; free: boolean; agreed: boolean; started: boolean; work: number; workLeft: number }
  | { kind: 'none' };
export type NpcState = {
  id: string;
  kind: StateKindId;
  holder: string; // vehicle id
  other: string; // vehicle id
  turnsLeft: number | null; // null: no timer
  born: number; // turn it was added; it cannot end in that turn
  data: StateData;
};

// A value a dialogue line shows. The sim keeps raw values, and the UI formats them.
export type CallVar =
  | { kind: "town"; id: string }
  | { kind: "site"; id: string } // a town or a location
  | { kind: "money"; amount: number }
  | { kind: "distance"; tiles: number }
  | { kind: "bearing"; rad: number }
  | { kind: "count"; n: number; unit: string } // shown as "1 part" or "2 parts"
  | { kind: "deal"; deal: PatchDeal; patcher: "player" | "npc"; price: number; parts: number; turns: number }
  | { kind: "aid"; fuel: number; supplies: number } // units of fuel and supplies
  | { kind: "prices"; town: string; goods: { good: string; buy: number; sell: number }[] } // a town's goods prices
  | { kind: "tip"; tip: { shop: string; good: string; dear: boolean } | null } // a trading tip, or none
  | { kind: "answer"; option: string }; // a driver's rolled answer, which picks the next line; never shown
export type CallVars = Record<string, CallVar>;

// An open radio call with the NPC `with`. A null topic means the hub of topics. `line` is what the NPC said
// last, which is the node's line or an answer that kept the call on the hub.
// Earlier practice events on one target: `count` of them as of turn `turn`.
export type Repeat = { count: number; turn: number };

export type Call = { with: string; topic: TopicId | null; node: string; vars: CallVars; line: { text: string; vars: CallVars } };
export type TopicOutcome = "agreed" | "refused" | "done";

export type Player = {
  vehicleId: string;
  money: number;
  xp: number; // unspent XP, earned by any activity; see src/sim/progress.ts
  ranks: Record<SkillId, number>; // bought ranks per skill, from 0 to MAX_RANK
  xpToday: Record<SkillId, number>; // XP per activity family earned on day xpDay, for the daily soft cap
  xpDay: number;
  repeats: Record<string, Repeat>; // "source:target" to the earlier practice on that target; see XP_SOURCES
  xpBySource: Record<XpSource, number>; // lifetime XP per source, for the debug console
  perks: PerkId[]; // picked perks, at most one per pair; see src/sim/progress.ts
  health: number;
  fuel: number;
  supplies: number;
  autoFire: boolean;
  autoRepair: boolean; // patch the most damaged part whenever the truck is parked
  townPatched: boolean; // this visit to a town already got its free critical repair; leaving the town clears it
  engineHeat: number; // 0 cold to 1 overheated; see src/sim/engine-heat.ts
  overdrive: boolean; // engine overdrive: faster and quicker, but heats the engine; see src/sim/engine-heat.ts
  headlights: boolean; // the player's headlight switch; NPC lamps follow the clock, see src/three/render/daylight.ts
  discovered: string[];
  scavenged: string[]; // stocks the player finished searching; their loot can be taken
  storage: PartInstance[]; // spare parts kept in town garages, usable in any town
  contracts: Contract[]; // contracts taken and not yet ended; see src/sim/market.ts
  costBasis: Record<string, number>; // average paid per unit of each good, for trade XP
  knockouts: number;
  state: "active" | "knockedOut" | "dead";
  knockoutTurns: number; // turns spent in the current knockout
  god: boolean; // debug god mode: parts, health, fuel and supplies refill every turn; see src/sim/cheats.ts
  fullLog: boolean; // debug: the log shows events the player cannot see or hear; see src/ui/format.ts
  beacon: boolean; // the emergency beacon calls every vehicle within BEACON.range; see src/sim/tow.ts
  call: Call | null;
  talked: Record<string, Partial<Record<TopicId, TopicOutcome>>>; // NPC id to how each topic with it ended
  explored: Uint8Array; // fog of war: tile y * world.size + x, 1 once seen
  visible: number[]; // tiles the player sees right now, sorted; refreshed by refreshVision
  contacts: Contact[]; // vehicles detected beyond sight; refreshed by refreshVision
  clouds: string[]; // ids of dust clouds the player sees right now; refreshed by refreshVision
  marked: { vehicleId: string; until: number }[]; // trucks the spotter perk tracks, to the last turn of each mark
  rumored: string[]; // salvage stock ids a driver told the player about; see the rumor topic
  hostilesSeen: string[]; // ids of hostile trucks in sight at the end of the last turn, for escapes; see src/sim/escape.ts
};

// One round of a shot. offset is where it crossed the target in meters from its center, across the line
// of fire, positive to the shooter's right. hits lists the parts it damaged, by direct hit or splash.
// hit: the round landed on its target. struck: the truck it landed on, or null for the ground. hits: its direct
// hits on that truck. blast: the part hits its explosion dealt, per truck.
export type ShotRound = {
  hit: boolean;
  crit: boolean;
  offset: number;
  struck: string | null;
  hits: PartHit[];
  blast: VehicleHits[];
};
export type VehicleHits = { vehicle: string; hits: PartHit[] };

export type GameEvent =
  | { t: 'activity'; vehicle: string; previous: NpcActivity['kind'] | null; activity: NpcActivity['kind'] | null; reason: string }
  // A driver made no progress for NPC_BEHAVIOR.stallTurns turns and gave up its goal, null when it had none. Always a bug.
  | { t: 'stall'; vehicle: string; goal: NpcActivity['kind'] | null; reason: string }
  | { t: 'collision'; a: string; b: string; hitsA: PartHit[]; hitsB: PartHit[] } // parts damaged on a and on b; hitsB is empty when b is not a vehicle
  | { t: 'empty'; vehicle: string; weapon: string }
  | { t: 'shot'; shooter: string; weapon: string; target: string; aim: Aim; chance: number; damageChance: number; side: Side; rounds: ShotRound[] }
  | { t: 'guardShot'; site: string; from: Vec; target: string; rounds: ShotRound[] }
  | { t: 'partDisabled'; vehicle: string; part: string }
  | { t: 'destroyed'; vehicle: string; by: string }
  | { t: 'npcKnockout'; vehicle: string; by: string }
  | { t: 'npcWake'; vehicle: string }
  | { t: 'arrived'; vehicle: string }
  | { t: 'spawn'; vehicle: string }
  | { t: 'despawn'; vehicle: string }
  | { t: 'hostile'; vehicle: string; against: string }
  | { t: 'practice'; source: XpSource; amount: number; difficulty: number | null; target: string; xp: number }
  | { t: 'skillUp'; skill: SkillId; level: number } // level is the rank just bought
  | { t: 'money'; amount: number; reason: string }
  | { t: 'contract'; contract: Contract; outcome: 'accepted' | 'expiring' | 'done' | 'failed' | 'lapsed' }
  | { t: 'discover'; location: string }
  | { t: 'supply'; what: string; text: string }
  | { t: 'death' }
  | { t: 'knockout' }
  | { t: 'wake' }
  | { t: 'scrapPatch'; fuel: number } // fuel: units put into an empty tank
  | { t: 'townPatch' } // entering a shop patched worn critical parts for free
  | { t: 'towOffer'; by: string; town: string; fee: number }
  | { t: 'towHitched'; by: string; client: string; site: string }
  | { t: 'towDone'; by: string; client: string; fee: number }
  | { t: 'escortPaid'; by: string; client: string; fee: number }
  | { t: 'escortHired'; by: string; client: string; site: string; fee: number }
  | { t: 'escortRefused'; by: string; client: string }
  | { t: 'towDropped'; by: string; client: string; reason: 'refused' | 'unhitched' | 'danger' | 'stranded' | 'gone' | 'blocked' }
  | { t: 'stateEnded'; state: NpcState; ending: StateEnding }
  | { t: 'job'; vehicle: string; job: Job; outcome: 'started' | 'done' | 'cancelled' }
  | { t: 'breakdown'; vehicle: string; part: string }
  | { t: 'searched'; stock: string } // the player finished searching a stock; its loot can now be taken
  | { t: 'weather'; event: WeatherEvent; outcome: 'started' | 'ended' }
  | { t: 'say'; speaker: string; text: string; vars: CallVars } // speaker is a vehicle id; the player's lines use the player's
  | { t: 'call'; with: string; outcome: 'opened' | 'ended' }
  | { t: 'honk'; vehicle: string }
  | { t: 'aidStarted'; giver: string; receiver: string }
  | { t: 'patch'; patcher: string; client: string; outcome: 'started' | 'lapsed' | 'broken' }
  | { t: 'patch'; patcher: string; client: string; outcome: 'done'; price: number } // money moved from client to patcher
  | { t: 'aid'; giver: string; receiver: string; fuel: number; supplies: number; paid: number } // units moved, money paid
  | { t: 'plea'; from: string; to: string; plea: Plea; accepted: boolean | null } // null while the player has to answer
  | { t: 'info'; text: string; debug?: true }; // a debug line shows only with the full log flag

export type World = {
  seed: number;
  rngState: number;
  marketRng: Rng; // the market's own random stream; see src/sim/market.ts
  nameRng: Rng; // the stream for NPC driver names, so a name roll never shifts other randomness; see src/sim/spawn.ts
  turn: number;
  size: number;
  nextId: number;
  vehicles: Vehicle[];
  obstacles: Obstacle[];
  broken: BrokenProp[]; // props out of obstacles until they grow back; a prop is in one list or the other
  salvage: SalvageStock[];
  shops: Record<string, ShopState>; // shop id -> prices, stock and contract board; see src/sim/market.ts
  terrain: Terrain; // corner heights and tile types, from the baked map file
  mapHash: string; // hash of the map file the world was made on; a save on another map does not load
  player: Player;
  events: GameEvent[]; // events of the last resolved turn or action
  removed: Vehicle[]; // vehicles destroyed or gone this turn, kept for the render
  spawnTimer: Record<string, number>; // template id -> turns until next spawn check
  weather: WeatherEvent[];
  dustClouds: DustCloud[];
  states: NpcState[];
};
