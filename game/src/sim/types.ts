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
import type { NoteId } from "../data/locals";
import type { UtilityEffectType } from "../data/parts";
import type { QuestValue } from "../data/quests";

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
  gun?: GunState;
  charge?: ChargeState;
  wear: number;
  rebuilt?: true;
};

export type GunState = { cooldown: number; ammo: number; reloadWork: number };

export type ChargeState = { reload: number; armed?: true };

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

export type Aim = "body" | string;
export type WeaponOrder = { targetId: string; aim: Aim };
export type UtilityOrder =
  | { kind: 'self' }
  | { kind: 'point'; pos: Vec };

export type Pose = { x: number; y: number; heading: number };

export type MoveOrder =
  | { kind: "through"; dest: Vec; pace?: number }
  | { kind: "stopAt"; dest: Vec }
  | { kind: "brake" };

export type SalvageStock = {
  id: string;
  pos: Vec;
  radius: number;
  goods: Record<string, number>;
  parts: PartInstance[];
  fuel?: number;
  supplies?: number;
  pile?: Pile;
  emptySince?: number;
  hidden: HiddenLoot;
};

export type HiddenLoot = { goods: Record<string, number>; parts: PartInstance[]; fuel: number; supplies: number };

export type PileClaim = { by: string; until: number; warned: string[] };
export type Pile = { until: number; fromPlayer: boolean; basis: Record<string, number>; claim?: PileClaim };

export type RefitMove = {
  itemId: string;
  from: { x: number; y: number; rot: 0 | 1 };
  to: { x: number; y: number; rot: 0 | 1 };
};

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

export type Job =
  | {
      kind: "repair";
      partId: string;
      parts: number;
      turnsLeft: number;
      total: number;
      auto?: true;
    }
  | { kind: "search"; stockId: string; turnsLeft: number; total: number }
  | { kind: "strip"; partId: string; turnsLeft: number; total: number }
  | { kind: "weld"; turnsLeft: number; total: number }
  | RefitJob;

export type Contact = {
  vehicleId: string;
  center: Vec;
  radius: number;
  sources: ("sound" | "dust" | "radio" | "beacon" | "mark" | "flare")[];
  loudness: number | null;
};

export type DustCloud = {
  id: string;
  source: string;
  pos: Vec;
  vel: Vec;
  age: number;
  range: number;
  screen?: true;
};

export type SmokeCloud = { id: string; source: string; pos: Vec; r: number; turnsLeft: number };
export type GroundField = { id: string; kind: 'caltrops' | 'oil'; source: string; pos: Vec; r: number; turnsLeft: number; hit: string[] };
export type Flare = { id: string; source: string; pos: Vec; r: number; turnsLeft: number };
export type HarpoonLine = { id: string; from: string; fromPart: string; to: string; toPart: string; length: number; turnsLeft: number };

export type WeatherEvent =
  | {
      id: string;
      kind: "storm";
      pos: Vec;
      radius: number;
      vel: Vec;
      turnsLeft: number;
      born: number;
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
  load?: { good: string };
  perceived?: number;
  worn?: { turn: number; condition: number };
  demands?: boolean;
  until?: number;
  watchUntil?: number;
};

export type NpcBrain = {
    templateId: string;
    driver: string;
    traits: TraitId[];
    goals: NpcActivity[];
    noticed: Record<string, number>;
    tracks: Record<string, Track>;
    hurt: number;
    fullAt?: number;
    unfit?: string[];
    attackers: Record<string, boolean>;
    goal: Vec | null;
    home: Vec;
    stepIndex: number;
    lastPos?: Vec;
    stalled?: number;
    stuck?: number;
    progress?: { key: string; since: number };
    recovery?: number;
    recoveryGoal?: Vec;
    ramChoice?: string;
    ramTarget?: string;
    fightTurn?: 1 | -1;
    targetSeen?: { id: string; turn: number; pos: Vec; heading: number; speed: number };
    whim?: { kind: 'keep' | 'rush' | 'halt' | 'veer'; until: number; angle: number };
    farRoute?: { dest: Vec; points: Vec[]; offRoad: boolean };
    memories: Memory[];
};

export type TrackChoice = 'keep' | 'fight' | 'flee' | 'investigate';
export type Track = { at: Vec; turn: number; sighted: boolean; seenSince: number | null; choice: TrackChoice | null; chosenInSight: boolean };

export type MemoryFact = { kind: 'prices'; shop: string; pressure: Record<string, number> };
export type Memory = { turn: number; fact: MemoryFact };

export type Vehicle = {
  id: string;
  name: string;
  faction: Faction;
  chassisId: string;
  items: GridItem[];
  pos: Vec;
  heading: number;
  speed: number;
  stormExposure: Record<string, number>;
  strandedTurns?: number;
  stalledUntil?: number;
  order: MoveOrder | null;
  direct: boolean;
  weaponOrders: Record<string, WeaponOrder>;
  utilityOrders: Record<string, UtilityOrder>;
  shutDown?: { from: number; until: number };
  trail: Pose[];
  brain: NpcBrain | null;
  resources: DriverResources | null;
  lastHitBy: string | null;
  job: Job | null;
  defeat?: Defeat;
};

export type Defeat = { phase: 'out' | 'retreat'; turns: number; unseen: number; foes: string[]; gaveUp: boolean };

export type LandmarkLook = Exclude<PropKind, "rock">;

export type Hulk = { chassisId: string; yaw: number };

export type Obstacle =
  // Only kill wrecks and story wrecks have a hulk. Map, road and convoy wrecks, and kill wrecks from saves before format 2.10, show the
  // generic wreck.
  | { id: string; pos: Vec; r: number; kind: "rock" | "wreck" | "building" | "water" | "site"; hulk?: Hulk }
  | { id: string; pos: Vec; r: number; kind: "landmark"; look: LandmarkLook; yaw: number };

export type BrokenProp = { obstacle: Obstacle; turn: number };

export type StateKindId = 'feud' | 'backedOff' | 'tow' | 'turnedDown' | 'towPromise' | 'answering' | 'patch' | 'truce' | 'grievance' | 'plea' | 'trade' | 'revenge' | 'escort' | 'strayFire' | 'aid' | 'combat';
export type StateEnding = 'expired' | 'fulfilled' | 'broken';
export type Plea = 'truce' | 'mercy';
export type StateData =
  | { kind: 'tow'; site: string; fee: number; waived: number; hitched: boolean }
  | { kind: 'feud'; robbery: boolean }
  | { kind: 'towPromise'; site: string; fee: number }
  | { kind: 'plea'; plea: Plea; answered: boolean }
  | { kind: 'escort'; site: string | null; fee: number }
  | { kind: 'patch'; deal: PatchDeal; parts: number; partIds: string[]; price: number; work: number; workLeft: number }
  | { kind: 'strayFire'; damage: number }
  | { kind: 'aid'; giver: 'player' | 'npc'; fuel: number; supplies: number; price: number; free: boolean; agreed: boolean; started: boolean; work: number; workLeft: number }
  | { kind: 'none' };
export type NpcState = {
  id: string;
  kind: StateKindId;
  holder: string;
  other: string;
  turnsLeft: number | null;
  born: number;
  data: StateData;
};

export type CallVar =
  | { kind: "town"; id: string }
  | { kind: "site"; id: string }
  | { kind: "money"; amount: number }
  | { kind: "distance"; tiles: number }
  | { kind: "bearing"; rad: number }
  | { kind: "count"; n: number; unit: string }
  | { kind: "deal"; deal: PatchDeal; patcher: "player" | "npc"; price: number; parts: number; turns: number }
  | { kind: "aid"; fuel: number; supplies: number }
  | { kind: "prices"; town: string; goods: { good: string; buy: number; sell: number }[] }
  | { kind: "tip"; tip: { shop: string; good: string; dear: boolean } | null }
  | { kind: "answer"; option: string };
export type CallVars = Record<string, CallVar>;

export type Repeat = { count: number; turn: number };

export type Call = { with: string; topic: TopicId | null; node: string; vars: CallVars; line: { text: string; vars: CallVars } };

export type QuestVars = Record<string, QuestValue>;
export type QuestSession = { quest: string; checkpoint: string; seed: number };
export type QuestLine = { text: string; tags: string[] };
export type QuestLive = { ink: string; lines: QuestLine[]; choices: string[] };
export type QuestState = { world: QuestVars; local: Record<string, QuestVars>; session: QuestSession | null; live: QuestLive | null };
export type TopicOutcome = "agreed" | "refused" | "done";

export type Player = {
  vehicleId: string;
  money: number;
  xp: number;
  ranks: Record<SkillId, number>;
  xpToday: Record<SkillId, number>;
  xpDay: number;
  repeats: Record<string, Repeat>;
  xpBySource: Record<XpSource, number>;
  perks: PerkId[];
  health: number;
  fuel: number;
  supplies: number;
  autoFire: boolean;
  autoRepair: boolean;
  townPatched: boolean;
  engineHeat: number;
  overdrive: boolean;
  headlights: boolean;
  discovered: string[];
  scavenged: string[];
  storage: PartInstance[];
  contracts: Contract[];
  costBasis: Record<string, number>;
  knockouts: number;
  state: "active" | "knockedOut" | "dead";
  knockoutTurns: number;
  god: boolean;
  fullLog: boolean;
  frozen: boolean;
  beacon: boolean;
  call: Call | null;
  talked: Record<string, Partial<Record<TopicId, TopicOutcome>>>;
  quests: QuestState;
  explored: Uint8Array;
  visible: number[];
  contacts: Contact[];
  clouds: string[];
  marked: { vehicleId: string; until: number }[];
  rumored: string[];
  notes: { id: NoteId; turn: number }[];
  hostilesSeen: string[];
};

export type ShotRound = {
  hit: boolean;
  crit: boolean;
  offset: number;
  struck: string | null;
  hits: PartHit[];
  blast: VehicleHits[];
  burst: Vec | null;
};
export type VehicleHits = { vehicle: string; hits: PartHit[] };

export type GameEvent =
  | { t: 'activity'; vehicle: string; previous: NpcActivity['kind'] | null; activity: NpcActivity['kind'] | null; reason: string }
  | { t: 'stall'; vehicle: string; goal: NpcActivity['kind'] | null; reason: string }
  | { t: 'collision'; a: string; b: string; hitsA: PartHit[]; hitsB: PartHit[] }
  | { t: 'empty'; vehicle: string; weapon: string }
  | { t: 'shot'; shooter: string; weapon: string; target: string; aim: Aim; chance: number; damageChance: number; side: Side; rounds: ShotRound[] }
  | { t: 'partDisabled'; vehicle: string; part: string }
  | { t: 'cargoSpilled'; vehicle: string; part: string; pile: string; units: number }
  | { t: 'destroyed'; vehicle: string; by: string }
  | { t: 'npcKnockout'; vehicle: string; by: string }
  | { t: 'npcWake'; vehicle: string }
  | { t: 'arrived'; vehicle: string }
  | { t: 'spawn'; vehicle: string }
  | { t: 'despawn'; vehicle: string }
  | { t: 'hostile'; vehicle: string; against: string }
  | { t: 'practice'; source: XpSource; amount: number; difficulty: number | null; target: string; xp: number }
  | { t: 'skillUp'; skill: SkillId; level: number }
  | { t: 'money'; amount: number; reason: string }
  | { t: 'contract'; contract: Contract; outcome: 'accepted' | 'expiring' | 'fulfilled' | 'done' | 'failed' | 'lapsed' }
  | { t: 'discover'; location: string }
  | { t: 'note'; id: NoteId } // the player wrote a rumor or clue into the journal
  | { t: 'supply'; what: string; text: string }
  | { t: 'death' }
  | { t: 'knockout' }
  | { t: 'wake' }
  | { t: 'scrapPatch'; fuel: number }
  | { t: 'townPatch' }
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
  | { t: 'searched'; stock: string }
  | { t: 'weather'; event: WeatherEvent; outcome: 'started' | 'ended' }
  | { t: 'say'; speaker: string; text: string; vars: CallVars }
  | { t: 'call'; with: string; outcome: 'opened' | 'ended' }
  | { t: 'honk'; vehicle: string }
  | { t: 'aidStarted'; giver: string; receiver: string }
  | { t: 'patch'; patcher: string; client: string; outcome: 'started' | 'lapsed' | 'broken' }
  | { t: 'patch'; patcher: string; client: string; outcome: 'done'; price: number }
  | { t: 'aid'; giver: string; receiver: string; fuel: number; supplies: number; paid: number }
  | { t: 'plea'; from: string; to: string; plea: Plea; accepted: boolean | null }
  | { t: 'info'; text: string; debug?: true }
  | { t: 'utility'; vehicle: string; part: string; effect: UtilityEffectType | 'claymore'; point: Vec | null }
  | { t: 'lineTorn'; line: string; vehicle: string; part: string; damage: number }
  | { t: 'pulse'; vehicle: string; pos: Vec; hit: string[] }
  | { t: 'claymore'; vehicle: string; part: string; other: string; pos: Vec; hits: PartHit[]; selfHits: PartHit[] }
  | { t: 'claymoreCookOff'; vehicle: string; part: string; pos: Vec; hits: PartHit[] }
  | { t: 'caltrops'; vehicle: string; field: string; source: string; hits: PartHit[] }
  | { t: 'found'; vehicle: string; stock: string; goods: Record<string, number>; parts: string[]; fuel: number; supplies: number };

export type GameModeId = 'roaming';
export type WorldSettings = { damage: number; fuelUse: number; supplyUse: number };
export type WorldSetup = { mode: GameModeId; settings: WorldSettings };

export type Crater = { id: string; pos: Vec; radius: number; turn: number };

export type World = {
  seed: number;
  rngState: number;
  marketRng: Rng;
  nameRng: Rng;
  turn: number;
  size: number;
  nextId: number;
  vehicles: Vehicle[];
  obstacles: Obstacle[];
  broken: BrokenProp[];
  craters: Crater[];
  salvage: SalvageStock[];
  shops: Record<string, ShopState>;
  terrain: Terrain;
  mapHash: string;
  setup: WorldSetup;
  player: Player;
  events: GameEvent[];
  removed: Vehicle[];
  spawnTimer: Record<string, number>;
  weather: WeatherEvent[];
  dustClouds: DustCloud[];
  states: NpcState[];
  smoke: SmokeCloud[];
  fields: GroundField[];
  flares: Flare[];
  lines: HarpoonLine[];
  searchRng: Rng;
};
