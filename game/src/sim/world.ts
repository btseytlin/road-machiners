// World creation and the turn pipeline. No rendering or physics imports: this runs in Node tests.
// Public functions take a world and return a new one. Inside, a cloned draft is mutated.

import { CHASSIS } from '../data/chassis';
import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { MAX_RANK, PERKS, SKILL_IDS, XP_SOURCES } from '../data/skills';
import { CONDITION } from '../data/wear';
import { RULES } from '../data/rules';
import type { StartKit } from '../data/start';
import { findPart, playerVehicle } from './damage';
import { makePart, makeVehicle, newId } from './factory';
import { gridOf, placementError } from './grid';
import { addGoods } from './inventory';
import { isPerkId, pickedFromPair, skillLevel } from './progress';
import { fitStores } from './resources';
import { generateObstacles, touchesObstacle } from './mapgen';
import type { BakedMap } from './terrain';
import { planNpcOrders } from './ai';
import { assignUtilityOrders } from './npc-utility';
import { applyGodMode, freezeDriving, freezeFire } from './cheats';
import { assignAutoOrders, dropMagazine, fireWeapons, isHostile, noteEngagements, resolveDestroyed, settleAims } from './combat';
import { advanceKnockout, advanceNpcKnockouts, checkDeath, checkKnockout } from './defeat';
import { healPlayer } from './health';
import { discoverSites } from './locations';
import { applyHazards } from './hazard';
import { consumeSupplies, fitAllStores, leakFuel } from './supplies';
import { scrapPatch } from './economy';
import { nameStream, spawnInitial, spawnNpcs } from './spawn';
import { clearPiles, initializeSalvage, renewSalvage } from './salvage';
import { spillDeadRows } from './spill';
import { fadeCraters } from './craters';
import { timed } from '../perf';
import { noteHurt, resolveNpcActivities } from './npc-activities';
import { watchStalls } from './npc-watchdog';
import { advanceStates } from './states';
import { forgetOld } from './memory';
import { checkBeacon, dropStrandedTowers, followTower, isTowed, playerTow } from './tow';
import { endCallIfOut, raiseCalls } from './dialogue';
import { advancePatches } from './patch';
import { advanceAid, readyAid } from './aid';
import type { GridItem, MoveOrder, PartInstance, UtilityOrder, Vehicle, WeaponOrder, World, WorldSettings, WorldSetup, XpSource } from './types';
import { defaultSetup, parseSetup, repairSetup } from './settings';
import { fittingQuestVars, QUESTS, type CarriedQuestVars } from './quests';
import { canOverdrive, vehicleStats } from './stats';
import { playerSees, practiceContacts, refreshVision } from './vision';
import { noteEscape } from './escape';
import { advanceWeather } from './weather';
import { advanceContracts, advanceShops, initializeShops, marketStream, shopNear } from './market';
import { applyWear, carryHp } from './wear';
import { advanceDust } from './detect';
import { searchStream } from './search';
import { cookOffClaymores, settleClaymores } from './claymore';
import { activateUtilities, advanceUtilityEffects, settleShutdowns, tickCharges, utilityOrderError } from './utility';
import { caltropHits } from './hazards';
import { advanceJobs, startAutoRepair } from './jobs';
import { advanceEngineHeat } from './engine-heat';
import { nearestPad } from './sites';
import { openingObstacles, setUpOpening } from './opening';
import { clamp, dist, type Vec } from './vec';

export function seedStreams(seed: number): Pick<World, 'seed' | 'rngState' | 'marketRng' | 'nameRng' | 'searchRng'> {
  if (!Number.isInteger(seed)) throw new Error(`Seed must be an integer, got ${seed}`);
  return { seed, rngState: seed, marketRng: marketStream(seed), nameRng: nameStream(seed), searchRng: searchStream(seed) };
}

export function newWorld(seed: number, kit: StartKit, map: BakedMap, setup: WorldSetup, populate = true, start: { pos: Vec; heading: number } = startPose()): World {
  if (map.terrain.size !== REGION.size)
    throw new Error(`Map size ${map.terrain.size} does not match region size ${REGION.size}`);
  const world: World = {
    ...seedStreams(seed),
    turn: 1,
    size: REGION.size,
    nextId: 0,
    vehicles: [],
    obstacles: [],
    broken: [],
    craters: [],
    salvage: [],
    shops: {},
    terrain: map.terrain,
    mapHash: map.hash,
    setup: parseSetup(setup),
    player: {
      vehicleId: "",
      money: kit.money,
      xp: 0,
      ranks: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 },
      xpToday: { driving: 0, perception: 0, machining: 0, toughness: 0, social: 0 },
      xpDay: 1,
      repeats: {},
      xpBySource: {
        roughTiles: 0, ram: 0, escape: 0,
        hit: 0, contact: 0, discover: 0,
        fieldJob: 0, patch: 0, search: 0,
        heat: 0, damage: 0, knockout: 0,
        profit: 0, deal: 0, call: 0, honk: 0, contract: 0, freeTow: 0, aid: 0,
      },
      perks: [],
      marked: [],
      rumored: [],
      notes: [],
      health: RULES.maxHealth,
      fuel: kit.fuel,
      supplies: kit.supplies,
      autoFire: false,
      autoRepair: kit.autoRepair,
      townPatched: false,
      engineHeat: 0,
      overdrive: false,
      headlights: false,
      discovered: [],
      scavenged: [],
      storage: [],
      contracts: [],
      costBasis: { ...kit.costBasis },
      knockouts: 0,
      state: 'active',
      knockoutTurns: 0,
      beacon: false,
      call: null,
      talked: {},
      quests: { world: {}, local: {}, session: null, live: null },
      god: false,
      fullLog: false,
      frozen: false,
      explored: new Uint8Array(REGION.size * REGION.size),
      visible: [],
      contacts: [],
      clouds: [],
      hostilesSeen: [],
    },
    events: [],
    removed: [],
    spawnTimer: {},
    weather: [],
    dustClouds: [],
    states: [],
    smoke: [],
    fields: [],
    flares: [],
    lines: [],
  };
  world.obstacles = generateObstacles(world, map, openingObstacles(kit.opening, start));
  const truck = makeVehicle(world, {
    name: kit.name,
    faction: "player",
    chassisId: kit.chassis,
    parts: kit.parts.map((defId) => ({ defId, wear: 0 })),
    spares: [],
    cargo: kit.cargo,
    pos: start.pos,
    heading: start.heading,
    brain: null,
  });
  const blocked = world.obstacles.filter(
    (o) => touchesObstacle(o, world.terrain, truck.pos, vehicleStats(world, truck).radius),
  );
  if (blocked.length > 0)
    throw new Error(
      `Player start overlaps ${blocked.map((o) => o.id).join(", ")}`,
    );
  world.vehicles.push(truck);
  world.player.vehicleId = truck.id;
  initializeSalvage(world);
  setUpOpening(world, truck, kit.opening);
  world.player.storage = kit.storage.map((defId) => makePart(world, defId, 0));
  if (populate) spawnInitial(world);
  initializeShops(world);
  refreshVision(world);
  world.events = [];
  return world;
}

export function startPose(): { pos: Vec; heading: number } {
  const { road, distance, offset } = REGION.playerStart;
  const points = REGION.roads[road];
  let left = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = dist(a, b);
    if (left > length) {
      left -= length;
      continue;
    }
    const along = Math.atan2(b.y - a.y, b.x - a.x);
    const t = left / length;
    return {
      pos: { x: a.x + (b.x - a.x) * t - Math.sin(along) * offset, y: a.y + (b.y - a.y) * t + Math.cos(along) * offset },
      heading: along - Math.PI / 2,
    };
  }
  throw new Error(`Player start lies ${distance} tiles along road ${road}, past its end`);
}

export function townStart(): { pos: Vec; heading: number } {
  const from = startPose().pos;
  const town = [...REGION.towns].sort((a, b) => dist(from, a.pos) - dist(from, b.pos))[0];
  const pos = nearestPad(town, from);
  return { pos, heading: Math.atan2(pos.y - town.pos.y, pos.x - town.pos.x) };
}

export function cloneWorld(world: World): World {
  if (!Object.isFrozen(world.terrain)) return structuredClone(world);
  const { terrain, ...state } = world;
  return { ...structuredClone(state), terrain };
}

export function update(world: World, fn: (draft: World) => void): World {
  const draft = cloneWorld(world);
  draft.events = [];
  draft.removed = [];
  fn(draft);
  settleAims(draft);
  settleOverdrive(draft);
  return draft;
}

function settleOverdrive(w: World): void {
  if (!w.player.overdrive || canOverdrive(playerVehicle(w))) return;
  w.player.overdrive = false;
  w.events.push({ t: 'info', text: 'Overdrive cut out: the engine is too worn.' });
}

export function playerCanAct(world: World): boolean {
  return world.player.state === 'active' && !isTowed(world) && !world.player.call;
}

export function requireActivePlayer(world: World): void {
  if (world.player.state !== 'active') throw new Error(`Player is ${world.player.state}`);
  if (isTowed(world)) throw new Error('Player is towed');
  if (world.player.call) throw new Error('A radio call is open');
}

export function autoRuns(world: World): boolean {
  const p = world.player;
  if (p.call) return false;
  if (p.state === 'knockedOut' || isTowed(world)) return true;
  if (readyAid(world)) return false;
  return waitsOnBeacon(world);
}

export function isAtRest(v: Vehicle): boolean {
  return v.speed <= RULES.parkedSpeed && (v.order === null || v.order.kind === 'brake');
}

function waitsOnBeacon(world: World): boolean {
  const p = world.player;
  const me = playerVehicle(world);
  return p.state === 'active' && p.beacon && isAtRest(me) && playerTow(world) === null;
}

export function playerCommand(world: World, fn: (draft: World) => void): World {
  requireActivePlayer(world);
  return update(world, fn);
}

export function setMoveOrder(world: World, order: MoveOrder | null): World {
  return playerCommand(world, (w) => {
    playerVehicle(w).order =
      order && order.kind !== "brake"
        ? {
            kind: order.kind,
            dest: {
              x: clamp(order.dest.x, 0, w.size),
              y: clamp(order.dest.y, 0, w.size),
            },
          }
        : order;
  });
}

export function endTurn(
  world: World,
  move: (w: World) => void,
): World {
  if (world.player.state === 'dead') throw new Error('The player is dead; no more turns run');
  if (world.player.call) throw new Error('A radio call is open; no turn runs until it ends');
  return timed('turn', () => update(world, (w) => {
    w.turn++;
    advanceWeather(w);
    planNpcOrders(w);
    freezeDriving(w);
    move(w);
    if (!shopNear(w)) w.player.townPatched = false;
    followTower(w);
    caltropHits(w);
    applyWear(w);
    spillDeadRows(w);
    advanceEngineHeat(w);
    advanceDust(w);
    advanceUtilityEffects(w);
    clearPiles(w);
    renewSalvage(w);
    fadeCraters(w);
    advanceJobs(w);
    startAutoRepair(w);
    practiceContacts(w, refreshVision(w));
    raiseCalls(w);
    assignAutoOrders(w);
    assignUtilityOrders(w);
    freezeFire(w);
    settleAims(w);
    activateUtilities(w);
    tickCharges(w);
    fireWeapons(w);
    cookOffClaymores(w);
    consumeSupplies(w);
    applyHazards(w);
    spillDeadRows(w);
    scrapPatch(w);
    healPlayer(w);
    leakFuel(w);
    fitAllStores(w);
    applyGodMode(w);
    resolveDestroyed(w);
    dropStrandedTowers(w);
    advanceContracts(w);
    advancePatches(w);
    advanceAid(w);
    advanceStates(w);
    checkBeacon(w);
    forgetOld(w);
    resolveNpcActivities(w);
    noteEngagements(w);
    discoverSites(w);
    checkDeath(w);
    advanceKnockout(w);
    checkKnockout(w);
    advanceNpcKnockouts(w);
    spawnNpcs(w);
    advanceShops(w);
    practiceContacts(w, refreshVision(w));
    noteEscape(w);
    noteHurt(w);
    settleShutdowns(w);
    settleClaymores(w);
    watchStalls(w);
    endCallIfOut(w);
    raiseCalls(w);
  }));
}

export function setWeaponOrder(
  world: World,
  weaponId: string,
  order: WeaponOrder | null,
): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    if (!vehicleStats(w, me).weapons.some((m) => m.part.id === weaponId))
      throw new Error(`Player has no weapon ${weaponId}`);
    if (order === null) {
      delete me.weaponOrders[weaponId];
      return;
    }
    const target = w.vehicles.find((v) => v.id === order.targetId);
    if (!target || target.id === me.id)
      throw new Error(`Bad target ${order.targetId}`);
    if (!playerSees(w, target.pos))
      throw new Error("You cannot see that target");
    if (order.aim !== "body" && !findPart(target, order.aim))
      throw new Error(`Target has no part ${order.aim}`);
    me.weaponOrders[weaponId] = order;
  });
}

export function setUtilityOrder(world: World, partId: string, order: UtilityOrder | null): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    if (order === null) {
      delete me.utilityOrders[partId];
      return;
    }
    const error = utilityOrderError(w, me, partId, order);
    if (error) throw new Error(error);
    me.utilityOrders[partId] = order;
  });
}

export function reloadWeapon(world: World, weaponId: string): World {
  return playerCommand(world, (w) => {
    const mw = vehicleStats(w, playerVehicle(w)).weapons.find((m) => m.part.id === weaponId);
    if (!mw) throw new Error(`Player has no weapon ${weaponId}`);
    dropMagazine(mw.part);
  });
}

export function setDirect(world: World, on: boolean): World {
  return playerCommand(world, (w) => {
    playerVehicle(w).direct = on;
  });
}

export function setAutoRepair(world: World, on: boolean): World {
  return update(world, (w) => {
    w.player.autoRepair = on;
  });
}

export function setOverdrive(world: World, on: boolean): World {
  return update(world, (w) => {
    if (on && !canOverdrive(playerVehicle(w))) {
      throw new Error(`Cannot overdrive: the engine is at or below ${RULES.overdriveMinEngineShare * 100}% of its max HP`);
    }
    w.player.overdrive = on;
  });
}

export function setHeadlights(world: World, on: boolean): World {
  return { ...world, player: { ...world.player, headlights: on } };
}

export function setAutoFire(world: World, on: boolean): World {
  return update(world, (w) => {
    w.player.autoFire = on;
  });
}

export function hostileToPlayer(world: World, v: Vehicle): boolean {
  return isHostile(world, playerVehicle(world), v);
}

export type CarriedPart = { defId: string; wear: number; hp: number; rebuilt: boolean };
export type CarriedItem = ({ kind: 'part'; part: CarriedPart } | { kind: 'good'; good: string }) & { x: number; y: number; rot: 0 | 1 };

export type Carried = {
  seed: number | null;
  money: number | null;
  xp: number | null;
  ranks: Partial<Record<string, number>>;
  xpBySource: Partial<Record<string, number>>;
  perks: string[];
  discovered: string[];
  knockouts: number | null;
  autoFire: boolean | null;
  autoRepair: boolean | null;
  fuel: number | null;
  supplies: number | null;
  costBasis: Record<string, number>;
  truck: { chassisId: string; name: string | null; items: CarriedItem[] } | null;
  storage: CarriedPart[];
  setup: unknown;
  quests: CarriedQuestVars;
};

export type CarryReport = {
  toGarage: string[];
  sold: { good: string; units: number; money: number }[];
  lost: string[];
  settingsReset: (keyof WorldSettings)[];
};

const KNOWN_SITES = new Set([...REGION.towns, ...REGION.locations].map((s) => s.id));

export function carriedWorld(carried: Carried, kit: StartKit, map: BakedMap, freshSeed: () => number): { world: World; report: CarryReport } {
  const { setup, reset } = carriedSetup(carried.setup);
  const report: CarryReport = { toGarage: [], sold: [], lost: [], settingsReset: reset };
  const truckKit = carriedKit(carried, kit, report);
  const world = newWorld(pick(carried.seed, freshSeed()), { ...truckKit, opening: null, autoRepair: true }, map, setup, true, townStart());
  carryPlayer(world, carried);
  carryQuests(world, carried.quests, report);
  carryTruck(world, carried, carried.truck !== null && truckKit !== kit, report);
  world.player.costBasis = heldBasis(playerVehicle(world), carried.costBasis);
  fitStores(world, playerVehicle(world));
  refreshVision(world);
  world.events = [];
  return { world, report };
}

function carriedSetup(setup: unknown): ReturnType<typeof repairSetup> {
  return setup === undefined ? { setup: defaultSetup('roaming'), reset: [] } : repairSetup(setup);
}

function carriedKit(carried: Carried, kit: StartKit, report: CarryReport): StartKit {
  const saved = carried.truck;
  if (!saved) return kit;
  if (!(saved.chassisId in CHASSIS)) {
    report.lost.push(saved.chassisId);
    return kit;
  }
  return { ...kit, chassis: saved.chassisId, name: pick(saved.name, kit.name), parts: [], storage: [], cargo: {}, costBasis: {} };
}

function pick<T>(value: T | null | undefined, fallback: T): T {
  return value === null || value === undefined ? fallback : value;
}

function carryPlayer(world: World, c: Carried): void {
  const p = world.player;
  Object.assign(p, {
    money: pick(c.money, p.money),
    knockouts: pick(c.knockouts, p.knockouts),
    autoFire: pick(c.autoFire, p.autoFire),
    autoRepair: pick(c.autoRepair, p.autoRepair),
    fuel: pick(c.fuel, p.fuel),
    supplies: pick(c.supplies, p.supplies),
    discovered: c.discovered.filter((id) => KNOWN_SITES.has(id)),
  });
  p.xp = Math.max(0, pick(c.xp, 0));
  for (const skill of SKILL_IDS) p.ranks[skill] = Math.min(MAX_RANK, Math.max(0, Math.floor(pick(c.ranks[skill], 0))));
  for (const source of Object.keys(XP_SOURCES) as XpSource[]) p.xpBySource[source] = pick(c.xpBySource[source], 0);
  carryPerks(world, c.perks);
}

function carryQuests(world: World, carried: CarriedQuestVars, report: CarryReport): void {
  const { world: shared, local, lost } = fittingQuestVars(carried, QUESTS);
  world.player.quests = { world: shared, local, session: null, live: null };
  report.lost.push(...lost);
}

function carryPerks(world: World, perks: string[]): void {
  for (const perk of perks.filter(isPerkId)) {
    const { skill, level } = PERKS[perk];
    if (skillLevel(world, skill) >= level && !pickedFromPair(world, perk)) world.player.perks.push(perk);
  }
}

function heldBasis(truck: Vehicle, basis: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(basis).filter(([good]) => truck.items.some((it) => it.kind === 'good' && it.good === good)));
}

function carryTruck(world: World, c: Carried, stay: boolean, report: CarryReport): void {
  const truck = playerVehicle(world);
  const goods: Record<string, number> = {};
  const garage: CarriedPart[] = [...c.storage];
  for (const item of c.truck?.items ?? []) {
    if (item.kind === 'good') goods[item.good] = pick(goods[item.good], 0) + 1;
    else if (!carryPartItem(world, truck, item, stay, report)) garage.push(item.part);
  }
  storeParts(world, garage, report);
  carryGoods(world, truck, goods, stay, report);
}

function carryPartItem(world: World, truck: Vehicle, item: CarriedItem & { kind: 'part' }, stay: boolean, report: CarryReport): boolean {
  const { defId } = item.part;
  if (!isKnownPart(defId)) report.lost.push(defId);
  else if (isCore(defId)) carryCore(world, truck, item.part, stay);
  else if (stay && placePart(world, truck, item)) return true;
  else report.toGarage.push(defId);
  return !isKnownPart(defId) || isCore(defId);
}

function storeParts(world: World, parts: CarriedPart[], report: CarryReport): void {
  const [known, unknown] = [parts.filter((p) => isKnownPart(p.defId)), parts.filter((p) => !isKnownPart(p.defId))];
  report.lost.push(...unknown.map((p) => p.defId));
  world.player.storage.push(...known.filter((p) => !isCore(p.defId)).map((p) => carryPart(world, p)));
}

function isKnownPart(defId: string): boolean {
  try {
    partDef(defId);
    return true;
  } catch {
    return false;
  }
}

function isCore(defId: string): boolean {
  return partDef(defId).kind === 'core';
}

function carryPart(world: World, c: CarriedPart): PartInstance {
  const wear = Math.min(CONDITION.maxWear + 1, Math.max(0, Math.round(c.wear)));
  const part = makePart(world, c.defId, Math.min(wear, CONDITION.maxWear));
  part.wear = wear;
  if (c.rebuilt) part.rebuilt = true;
  carryHp(part, c.hp);
  return part;
}

function carryCore(world: World, truck: Vehicle, c: CarriedPart, stay: boolean): void {
  const core = truck.items.find((it) => it.kind === 'part' && it.part.defId === c.defId);
  if (!stay || core?.kind !== 'part') return;
  const carried = carryPart(world, c);
  core.part.wear = Math.min(carried.wear, CONDITION.maxWear);
  carryHp(core.part, carried.hp);
}

function placePart(world: World, truck: Vehicle, item: CarriedItem & { kind: 'part' }): boolean {
  const placed: GridItem = { id: newId(world, 'i'), kind: 'part', part: carryPart(world, item.part), x: item.x, y: item.y, rot: item.rot };
  if (placementError(gridOf(truck), truck.items, placed, placed.id)) return false;
  truck.items.push(placed);
  return true;
}

function carryGoods(world: World, truck: Vehicle, goods: Record<string, number>, stay: boolean, report: CarryReport): void {
  for (const [good, units] of Object.entries(goods)) {
    if (!(good in GOODS)) report.lost.push(good);
    else sellGoods(world, good, units - (stay ? addGoods(world, truck, good, units) : 0), report);
  }
}

function sellGoods(world: World, good: string, units: number, report: CarryReport): void {
  if (units <= 0) return;
  const money = units * GOODS[good].value;
  world.player.money += money;
  report.sold.push({ good, units, money });
}
