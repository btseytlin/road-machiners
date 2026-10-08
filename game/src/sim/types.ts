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
  gun?: GunState;
  wear: number;
  rebuilt?: true;
};

export type GunState = { cooldown: number; ammo: number; reloadWork: number };

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
};

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
  sources: ("sound" | "dust" | "radio" | "beacon" | "mark")[];
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
    | 'meet' | 'retreat' | 'patrol' | 'travel' | 'explore' | 'haul' | 'follow';
  targetId: string | null;
  destination: Vec | null;
  phase: "travel" | "act";
  reason: string;
  purchase?: { good: string; sellShop: string };
  load?: { good: string };
  perceived?: number;
  demands?: boolean;
};

export type NpcBrain = {
    templateId: string;
    driver: string;
    traits: TraitId[];
    goals: NpcActivity[];
    noticed: Record<string, number>;
    hurt: number;
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
    farRoute?: { dest: Vec; points: Vec[] };
    lastTown?: string;
};

export type Vehicle = {
  id: string;
  name: string;
  faction: Faction;
  chassisId: string;
  items: GridItem[];
  pos: Vec;
  heading: number;
  speed: number;
  strandedTurns?: number;
  stalledUntil?: number;
  order: MoveOrder | null;
  direct: boolean;
  weaponOrders: Record<string, WeaponOrder>;
  trail: Pose[];
  brain: NpcBrain | null;
  resources: DriverResources | null;
  lastHitBy: string | null;
  job: Job | null;
  defeat?: Defeat;
};

export type Defeat = { phase: 'out' | 'retreat'; turns: number; unseen: number; foes: string[] };

export type LandmarkLook = Exclude<PropKind, "rock">;

export type Obstacle =
  | { id: string; pos: Vec; r: number; kind: "rock" | "wreck" | "building" | "water" | "site" }
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
  | { kind: 'patch'; deal: PatchDeal; parts: number; price: number; work: number; workLeft: number }
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
  | { kind: "answer"; option: string };
export type CallVars = Record<string, CallVar>;

export type Repeat = { count: number; turn: number };

export type Call = { with: string; topic: TopicId | null; node: string; vars: CallVars; line: { text: string; vars: CallVars } };
export type TopicOutcome = "agreed" | "refused" | "done";

export type Player = {
  vehicleId: string;
  money: number;
  skills: Record<SkillId, number>;
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
  beacon: boolean;
  call: Call | null;
  talked: Record<string, Partial<Record<TopicId, TopicOutcome>>>;
  explored: Uint8Array;
  visible: number[];
  contacts: Contact[];
  clouds: string[];
  marked: { vehicleId: string; until: number }[];
  rumored: string[];
  hostilesSeen: string[];
};

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
  | { t: 'stall'; vehicle: string; goal: NpcActivity['kind'] | null; reason: string }
  | { t: 'collision'; a: string; b: string; hitsA: PartHit[]; hitsB: PartHit[] }
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
  | { t: 'skillUp'; skill: SkillId; level: number }
  | { t: 'money'; amount: number; reason: string }
  | { t: 'contract'; contract: Contract; outcome: 'accepted' | 'expiring' | 'done' | 'failed' | 'lapsed' }
  | { t: 'discover'; location: string }
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
  | { t: 'towDropped'; by: string; client: string; reason: 'refused' | 'unhitched' | 'danger' | 'stranded' | 'gone' }
  | { t: 'stateEnded'; state: NpcState; ending: StateEnding }
  | { t: 'job'; vehicle: string; job: Job; outcome: 'started' | 'done' | 'cancelled' }
  | { t: 'breakdown'; vehicle: string; part: string }
  | { t: 'searched'; stock: string }
  | { t: 'weather'; event: WeatherEvent; outcome: 'started' | 'ended' }
  | { t: 'say'; speaker: string; text: string; vars: CallVars }
  | { t: 'call'; with: string; outcome: 'opened' | 'ended' }
  | { t: 'honk'; vehicle: string }
  | { t: 'aidStarted'; giver: string; receiver: string }
  | { t: 'patch'; patcher: string; client: string; outcome: 'started' | 'done' | 'lapsed' | 'broken' }
  | { t: 'aid'; giver: string; receiver: string; fuel: number; supplies: number; paid: number }
  | { t: 'plea'; from: string; to: string; plea: Plea; accepted: boolean | null }
  | { t: 'info'; text: string; debug?: true };

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
  salvage: SalvageStock[];
  shops: Record<string, ShopState>;
  terrain: Terrain;
  mapHash: string;
  player: Player;
  events: GameEvent[];
  removed: Vehicle[];
  spawnTimer: Record<string, number>;
  weather: WeatherEvent[];
  dustClouds: DustCloud[];
  states: NpcState[];
};
