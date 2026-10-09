// The save format and the steps that carry an old save to it. A save loads only in its own major format. Within
// it, load runs every step from the save's minor format on, so the minor format is the number of steps.

import { CORES_2_1, CORES_2_2, LAYOUTS_2_2 } from './save-layouts-2-2';

export type SavedJson = Record<string, unknown>;

export const SAVE_MAJOR = 2;

const SIZES_2_1: Record<string, readonly [number, number]> = {
  shotgun: [1, 2],
  longRifle: [1, 2],
  flamer: [1, 2],
  pneumobolter: [2, 2],
  slugCannon: [1, 2],
  heavyMg: [1, 2],
  cannon: [2, 2],
  amRifle: [1, 3],
  autocannon: [2, 2],
  recoilless: [1, 3],
  battleRifle: [1, 3],
  gatling: [2, 2],
  rocketRack: [2, 2],
  sniperCannon: [2, 3],
  grenadeLauncher: [2, 2],
  tankGun: [2, 3],
  flechette: [2, 2],
  stockEngine: [2, 2],
  tunedEngine: [2, 2],
  flatFour: [2, 2],
  workhorseDiesel: [2, 2],
  racingV6: [2, 2],
  heavyDiesel: [2, 2],
  turbine: [2, 2],
  plates: [1, 3],
  cage: [1, 2],
  ram: [3, 1],
  scrapPanels: [1, 2],
  ceramicPlates: [1, 2],
  spacedArmor: [1, 4],
  reinforcedCage: [1, 3],
  plowRam: [3, 1],
  rack: [2, 1],
  trailerBox: [2, 2],
  flatbed: [2, 1],
  lightFrame: [2, 2],
  enclosedFrame: [2, 2],
  heavyFrame: [2, 2],
};

type Cell = { x: number; y: number };
type Item = SavedJson & { x: number; y: number; rot: number; part?: SavedJson & { defId: string }; good?: string };
type Spot = { x: number; y: number; rot: number };
type Player = SavedJson & { vehicleId: string; storage: SavedJson[]; money: number };

const GOOD_VALUES_2_1: Record<string, number> = {
  scrap: 19, salt: 26, meds: 70, grain: 21, textiles: 35, tools: 110, batteries: 76, electronics: 155, parts: 20, fuelDrums: 28, water: 18,
};

const key = (c: Cell) => `${c.x},${c.y}`;

function cellsAt(item: Item, spot: Spot): Cell[] {
  const [w, h] = (item.part && SIZES_2_1[item.part.defId]) || [1, 1];
  const [across, along] = spot.rot === 1 ? [h, w] : [w, h];
  return Array.from({ length: across * along }, (_, i) => ({ x: spot.x + (i % across), y: spot.y + Math.floor(i / across) }));
}

const cellsOf = (item: Item) => cellsAt(item, item);

function nearestSpot(item: Item, free: Set<string>): Spot | null {
  const anchors = [...free].map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }));
  const dist = (c: Cell) => (c.x - item.x) ** 2 + (c.y - item.y) ** 2;
  anchors.sort((p, q) => dist(p) - dist(q) || p.y - q.y || p.x - q.x);
  for (const anchor of anchors) {
    for (const rot of [item.rot, 1 - item.rot]) {
      const spot = { ...anchor, rot };
      if (cellsAt(item, spot).every((c) => free.has(key(c)))) return spot;
    }
  }
  return null;
}

const isWheel = (item: Item) => item.part?.defId.startsWith('wheel') ?? false;

function markedCells(layout: readonly string[], mark: string): Set<string> {
  return new Set(layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === mark ? [key({ x, y })] : []))));
}

function relaidCores(vehicle: SavedJson): Map<Item, Item> {
  const before = CORES_2_1[vehicle.chassisId as string];
  const after = CORES_2_2[vehicle.chassisId as string];
  const moved = new Map<Item, Item>();
  for (const item of vehicle.items as Item[]) {
    const index = before.findIndex((c) => c.defId === item.part?.defId && c.x === item.x && c.y === item.y);
    if (index < 0) continue;
    const next = after[index];
    moved.set(item, { ...item, x: next.x, y: next.y, rot: next.rot, part: { ...item.part!, defId: next.defId } });
  }
  return moved;
}

function refund(item: Item, player: Player | null): void {
  if (!player) return;
  if (item.part) player.storage.push(item.part);
  else player.money += GOOD_VALUES_2_1[item.good ?? ''] ?? 0;
}

function rehome(item: Item, free: Set<string>, player: Player | null): Item | null {
  const spot = nearestSpot(item, free);
  if (!spot) {
    refund(item, player);
    return null;
  }
  for (const c of cellsAt(item, spot)) free.delete(key(c));
  return { ...item, ...spot };
}

function relayVehicle(vehicle: SavedJson, player: Player | null): SavedJson {
  const layout = LAYOUTS_2_2[vehicle.chassisId as string];
  if (!layout) return vehicle;
  const moved = relaidCores(vehicle);
  const built = markedCells(layout, 'X');
  const others = (vehicle.items as Item[]).filter((item) => !moved.has(item));
  const stays = others.filter((item) => isWheel(item) || !cellsOf(item).some((c) => built.has(key(c))));
  const taken = new Set([...stays, ...moved.values()].flatMap((item) => cellsOf(item).map(key)));
  const free = new Set([...markedCells(layout, 'D')].filter((k) => !taken.has(k)));
  const items = (vehicle.items as Item[]).flatMap((item) => moved.get(item) ?? (stays.includes(item) ? [item] : []));
  const homed = others.filter((item) => !stays.includes(item)).map((item) => rehome(item, free, player));
  return { ...vehicle, items: [...items, ...homed.filter((item) => item !== null)], job: withoutRefit(vehicle.job) };
}

function withoutRefit(job: unknown): unknown {
  return (job as SavedJson | null)?.kind === 'refit' ? null : job;
}

function packExplored_3_4(list: unknown[]): string {
  const bytes = new Uint8Array(Math.ceil(list.length / 8));
  list.forEach((value, i) => {
    if (value !== 0 && value !== 1) throw new Error(`Explored tile ${i} is ${String(value)}, not 0 or 1`);
    bytes[i >> 3] |= (value as number) << (i & 7);
  });
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const HANDOVER_TURNS_5_6 = 1;
const CAB_IDS_6_7 = ['cab', 'cabPickup', 'cabHardtop'];

function withGaveUp_6_7(vehicle: SavedJson): SavedJson {
  const defeat = vehicle.defeat as SavedJson | undefined;
  if (!defeat) return vehicle;
  const cab = (vehicle.items as Item[]).find((item) => CAB_IDS_6_7.includes(item.part?.defId ?? ''));
  return { ...vehicle, defeat: { ...defeat, gaveUp: defeat.phase === 'out' && ((cab?.part?.hp as number | undefined) ?? 0) > 0 } };
}

const RETIRED_STOCK_7_8 = 'fallen-sun';

function withoutRetiredStock_7_8(world: SavedJson): SavedJson {
  const idle = (v: SavedJson): SavedJson => ((v.job as SavedJson | null | undefined)?.stockId === RETIRED_STOCK_7_8 ? { ...v, job: null } : v);
  const player = world.player as SavedJson;
  return {
    ...world,
    salvage: (world.salvage as SavedJson[]).filter((stock) => stock.id !== RETIRED_STOCK_7_8),
    player: { ...player, scavenged: (player.scavenged as string[]).filter((id) => id !== RETIRED_STOCK_7_8) },
    vehicles: (world.vehicles as SavedJson[]).map(idle),
  };
}

const RETIRED_STOCK_8_9 = 'orchard';

function withoutRetiredStock_8_9(world: SavedJson): SavedJson {
  const idle = (v: SavedJson): SavedJson => ((v.job as SavedJson | null | undefined)?.stockId === RETIRED_STOCK_8_9 ? { ...v, job: null } : v);
  const player = world.player as SavedJson;
  return {
    ...world,
    salvage: (world.salvage as SavedJson[]).filter((stock) => stock.id !== RETIRED_STOCK_8_9),
    player: { ...player, scavenged: (player.scavenged as string[]).filter((id) => id !== RETIRED_STOCK_8_9) },
    vehicles: (world.vehicles as SavedJson[]).map(idle),
  };
}

const XP_TO_REACH_9_10 = [0, 200, 600, 1200, 2000, 3000];

export function pooledSkills_9_10(skills: Record<string, number>): { xp: number; ranks: Record<string, number> } {
  let xp = 0;
  const ranks: Record<string, number> = {};
  for (const [skill, total] of Object.entries(skills)) {
    let level = 0;
    while (level < XP_TO_REACH_9_10.length - 1 && total >= XP_TO_REACH_9_10[level + 1]) level++;
    ranks[skill] = level;
    xp += total - XP_TO_REACH_9_10[level];
  }
  return { xp, ranks };
}

const STORM_FADE_TURNS_16_17 = 30;

function withStormBorn_16_17(world: SavedJson): SavedJson {
  const born = (world.turn as number) - STORM_FADE_TURNS_16_17;
  const dated = (e: SavedJson): SavedJson => (e.kind === 'storm' ? { ...e, born } : e);
  return { ...world, weather: (world.weather as SavedJson[]).map(dated) };
}

const STORM_EDGE_17_18 = 25;
const STORM_FADE_TURNS_17_18 = 30;

function settledShare_17_18(turn: number, storm: SavedJson, pos: { x: number; y: number }): number {
  const centre = storm.pos as { x: number; y: number };
  const edge = Math.min(1, ((storm.radius as number) - Math.hypot(pos.x - centre.x, pos.y - centre.y)) / STORM_EDGE_17_18);
  if (edge <= 0) return 0;
  const strength = Math.min(1, (turn - (storm.born as number) + 1) / STORM_FADE_TURNS_17_18, (storm.turnsLeft as number) / STORM_FADE_TURNS_17_18);
  return edge * strength;
}

function withStormExposure_17_18(world: SavedJson): SavedJson {
  const storms = (world.weather as SavedJson[]).filter((e) => e.kind === 'storm');
  const exposed = (v: SavedJson): SavedJson => {
    const stormExposure: Record<string, number> = {};
    for (const s of storms) {
      const share = settledShare_17_18(world.turn as number, s, v.pos as { x: number; y: number });
      if (share > 0) stormExposure[s.id as string] = share;
    }
    return { ...v, stormExposure };
  };
  const clear = (v: SavedJson): SavedJson => ({ ...v, stormExposure: {} });
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(exposed), removed: (world.removed as SavedJson[]).map(clear) };
}

function withMemories_11_12(world: SavedJson): SavedJson {
  const shops = world.shops as Record<string, SavedJson>;
  const turn = world.turn as number;
  const remembering = (v: SavedJson): SavedJson => {
    if (!v.brain) return v;
    const { lastTown, ...brain } = v.brain as SavedJson;
    const shop = typeof lastTown === 'string' ? shops[lastTown] : undefined;
    const memories = shop ? [{ turn, fact: { kind: 'prices', shop: lastTown, pressure: { ...(shop.pressure as SavedJson) } } }] : [];
    return { ...v, brain: { ...brain, memories } };
  };
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(remembering), removed: (world.removed as SavedJson[]).map(remembering) };
}

function withPatchParts_13_14(world: SavedJson): SavedJson {
  const vehicles = world.vehicles as SavedJson[];
  const brokenIds = (id: string): string[] => {
    const client = vehicles.find((v) => v.id === id);
    const items = client ? (client.items as SavedJson[]) : [];
    return items.flatMap((item) => (item.kind === 'part' && (item.part as SavedJson).hp === 0 ? [(item.part as SavedJson).id as string] : []));
  };
  const recording = (s: SavedJson): SavedJson => {
    const data = s.data as SavedJson;
    return data.kind === 'patch' ? { ...s, data: { ...data, partIds: brokenIds(s.other as string) } } : s;
  };
  return { ...world, states: (world.states as SavedJson[]).map(recording) };
}

const SHOT_EVENTS_15_16 = ['shot', 'guardShot'];

function withBurst_15_16(event: SavedJson): SavedJson {
  if (!SHOT_EVENTS_15_16.includes(event.t as string)) return event;
  return { ...event, rounds: (event.rounds as SavedJson[]).map((round) => ({ ...round, burst: null })) };
}

function withRouteStyle_18_19(world: SavedJson): SavedJson {
  const styled = (v: SavedJson): SavedJson => {
    const brain = v.brain as SavedJson | null;
    if (!brain?.farRoute) return v;
    return { ...v, brain: { ...brain, farRoute: { ...(brain.farRoute as SavedJson), offRoad: false } } };
  };
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(styled), removed: (world.removed as SavedJson[]).map(styled) };
}

function withoutGuards_19_20(world: SavedJson): SavedJson {
  const uncredited = (v: SavedJson): SavedJson => (typeof v.lastHitBy === 'string' && v.lastHitBy.startsWith('guard-') ? { ...v, lastHitBy: null } : v);
  const unnoted = (v: SavedJson): SavedJson => {
    if (!v.brain) return v;
    const { gunnedBy: _, ...brain } = v.brain as SavedJson;
    return { ...v, brain };
  };
  return {
    ...world,
    events: (world.events as SavedJson[]).filter((e) => e.t !== 'guardShot'),
    vehicles: (world.vehicles as SavedJson[]).map((v) => unnoted(uncredited(v))),
    removed: (world.removed as SavedJson[]).map(uncredited),
  };
}

function withFleePerceived_20_21(world: SavedJson): SavedJson {
  const turn = world.turn as number;
  const goal = (g: SavedJson): SavedJson => (g.kind === 'flee' ? { ...g, perceived: turn } : g);
  const truck = (v: SavedJson): SavedJson => (v.brain ? { ...v, brain: { ...(v.brain as SavedJson), goals: ((v.brain as SavedJson).goals as SavedJson[]).map(goal) } } : v);
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(truck), removed: (world.removed as SavedJson[]).map(truck) };
}

function withFightWorn_21_22(world: SavedJson): SavedJson {
  const turn = world.turn as number;
  const goal = (g: SavedJson): SavedJson => (g.kind === 'fight' ? { ...g, worn: { turn, condition: 1 } } : g);
  const truck = (v: SavedJson): SavedJson => (v.brain ? { ...v, brain: { ...(v.brain as SavedJson), goals: ((v.brain as SavedJson).goals as SavedJson[]).map(goal) } } : v);
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(truck), removed: (world.removed as SavedJson[]).map(truck) };
}

function withTracks_22_23(world: SavedJson): SavedJson {
  const turn = world.turn as number;
  const places = new Map((world.vehicles as SavedJson[]).map((v) => [v.id as string, v.pos as SavedJson]));
  const fromNoticed = (noticed: Record<string, number>): Record<string, SavedJson> => {
    const tracks: Record<string, SavedJson> = {};
    for (const decision of ['contactHeard', 'hostileSeen']) {
      for (const [key, last] of Object.entries(noticed)) {
        const [kind, id] = key.split(':');
        const at = places.get(id);
        const seen = decision === 'hostileSeen';
        if (kind === decision && at) tracks[id] = { at: { ...at }, turn: last, sighted: seen, choice: 'keep', chosenInSight: seen };
      }
    }
    return tracks;
  };
  const fromGoal = (tracks: Record<string, SavedJson>, g: SavedJson): void => {
    const at = places.get(g.targetId as string);
    if ((g.kind === 'fight' || g.kind === 'flee') && at) tracks[g.targetId as string] = { at: { ...at }, turn: (g.perceived as number | undefined) ?? turn, sighted: true, choice: g.kind, chosenInSight: true };
  };
  const untimed = (g: SavedJson): SavedJson => {
    if (g.kind !== 'fight') return g;
    const { perceived: _, ...rest } = g;
    return rest;
  };
  const tracked = (v: SavedJson): SavedJson => {
    if (!v.brain) return v;
    const brain = v.brain as SavedJson;
    const noticed = brain.noticed as Record<string, number>;
    const goals = brain.goals as SavedJson[];
    const tracks = fromNoticed(noticed);
    for (const g of goals) fromGoal(tracks, g);
    const kept = Object.fromEntries(Object.entries(noticed).filter(([key]) => !key.startsWith('hostileSeen:') && !key.startsWith('contactHeard:')));
    return { ...v, brain: { ...brain, noticed: kept, goals: goals.map(untimed), tracks } };
  };
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(tracked), removed: (world.removed as SavedJson[]).map(tracked) };
}

function withSeenSince_23_24(world: SavedJson): SavedJson {
  const truck = (v: SavedJson): SavedJson => {
    if (!v.brain) return v;
    const brain = v.brain as SavedJson;
    const tracks = Object.fromEntries(Object.entries(brain.tracks as Record<string, SavedJson>).map(([id, t]) => [id, { ...t, seenSince: null }]));
    return { ...v, brain: { ...brain, tracks } };
  };
  return { ...world, vehicles: (world.vehicles as SavedJson[]).map(truck), removed: (world.removed as SavedJson[]).map(truck) };
}

const RETIRED_STOCK_27_28 = 'glass-flats';

function withoutRetiredStock_27_28(world: SavedJson): SavedJson {
  const idle = (v: SavedJson): SavedJson => ((v.job as SavedJson | null | undefined)?.stockId === RETIRED_STOCK_27_28 ? { ...v, job: null } : v);
  const player = world.player as SavedJson;
  return {
    ...world,
    salvage: (world.salvage as SavedJson[]).filter((stock) => stock.id !== RETIRED_STOCK_27_28),
    player: { ...player, scavenged: (player.scavenged as string[]).filter((id) => id !== RETIRED_STOCK_27_28) },
    vehicles: (world.vehicles as SavedJson[]).map(idle),
  };
}

const FORTRESS_OBSTACLES_24_25 = new Set(
  ['bowl', 'nose', 'dustwell', 'green-pit', 'pump-station', 'granary', 'salvage-yard', 'south-lock', 'scrapjaw', 'kiln'].map((id) => `site-${id}`),
);

function isGoneObstacle_24_25(o: SavedJson): boolean {
  const id = o.id as string;
  return FORTRESS_OBSTACLES_24_25.has(id) || id.startsWith('bld-bowl-') || id.startsWith('bld-nose-')
    || id === 'pond-dustwell' || id === 'pond-green-pit' || id.startsWith('cw-salvage-yard-');
}

const SEARCH_SALT_25_26 = 0x73656172;
const NO_HIDDEN_25_26 = (): SavedJson => ({ goods: {}, parts: [], fuel: 0, supplies: 0 });

function withUtilities_25_26(world: SavedJson): SavedJson {
  const ordered = (v: SavedJson): SavedJson => ({ ...v, utilityOrders: {} });
  return {
    ...world,
    vehicles: (world.vehicles as SavedJson[]).map(ordered),
    removed: (world.removed as SavedJson[]).map(ordered),
    smoke: [],
    fields: [],
    flares: [],
    lines: [],
    searchRng: { rngState: (world.seed as number) ^ SEARCH_SALT_25_26 },
  };
}

const LOOT_SITES_25_26 = new Set(['burnt-convoy', 'podfield', 'canyon-bridge', 'glass-flats', 'south-lock', 'ridge-wrecks', 'broken-wing']);
const LOOT_SPOT_25_26 = /^(farmhouse|barn|quonset|bunker|guardPost|armyTruck|armyCache|deckBay|shipCache)-\d+$/;
const ROAD_WRECK_25_26 = /^wreck\d+$/;

function isRolledStock_25_26(stock: SavedJson): boolean {
  const id = stock.id as string;
  return !stock.pile && (LOOT_SITES_25_26.has(id) || LOOT_SPOT_25_26.test(id) || ROAD_WRECK_25_26.test(id));
}

function withHiddenStock_25_26(world: SavedJson): SavedJson {
  const searched = new Set((world.player as SavedJson).scavenged as string[]);
  const hide = (stock: SavedJson): SavedJson => {
    if (searched.has(stock.id as string) || !isRolledStock_25_26(stock)) return { ...stock, hidden: NO_HIDDEN_25_26() };
    const hidden = { goods: stock.goods, parts: stock.parts, fuel: stock.fuel ?? 0, supplies: stock.supplies ?? 0 };
    return { ...stock, goods: {}, parts: [], fuel: 0, supplies: 0, hidden };
  };
  return { ...world, salvage: (world.salvage as SavedJson[]).map(hide) };
}

function withFreeze_25_26(world: SavedJson): SavedJson {
  return { ...world, player: { ...(world.player as SavedJson), frozen: false } };
}

function withFulfilledFlag_26_27(world: SavedJson): SavedJson {
  const flagged = (c: SavedJson): SavedJson => (c.kind === 'bounty' ? { ...c, fulfilled: false } : c);
  const player = world.player as SavedJson;
  const shops = Object.fromEntries(
    Object.entries(world.shops as Record<string, SavedJson>).map(([id, shop]) => [id, { ...shop, contracts: (shop.contracts as SavedJson[]).map(flagged) }]),
  );
  return { ...world, player: { ...player, contracts: (player.contracts as SavedJson[]).map(flagged) }, shops };
}

export const CENTS_PER_MONEY_29_30 = 100 / 3;
const MONEY_PRACTICE_29_30 = ['profit', 'freeTow', 'aid'];

function scaled_29_30(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Saved ${what} is ${String(value)}, not a number`);
  return value * CENTS_PER_MONEY_29_30;
}

function cents_29_30(value: unknown, what: string): number {
  return Math.round(scaled_29_30(value, what));
}

function scaledRecord_29_30(record: SavedJson, what: string): SavedJson {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, scaled_29_30(v, `${what} ${k}`)]));
}

function contractCents_29_30(c: SavedJson): SavedJson {
  return { ...c, reward: cents_29_30(c.reward, `contract ${String(c.id)} reward`) };
}

function callVarsCents_29_30(vars: SavedJson): SavedJson {
  const centsVar = (v: SavedJson): SavedJson => {
    if (v.kind === 'money') return { ...v, amount: cents_29_30(v.amount, 'call money') };
    if (v.kind === 'deal') return { ...v, price: cents_29_30(v.price, 'call deal price') };
    if (v.kind === 'prices') {
      const goods = (v.goods as SavedJson[]).map((g) => ({ ...g, buy: cents_29_30(g.buy, 'call buy price'), sell: cents_29_30(g.sell, 'call sell price') }));
      return { ...v, goods };
    }
    return v;
  };
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, centsVar(v as SavedJson)]));
}

function callCents_29_30(call: SavedJson): SavedJson {
  const line = call.line as SavedJson;
  return { ...call, vars: callVarsCents_29_30(call.vars as SavedJson), line: { ...line, vars: callVarsCents_29_30(line.vars as SavedJson) } };
}

function stateCents_29_30(state: SavedJson): SavedJson {
  const data = state.data as SavedJson;
  const what = `${String(data.kind)} state ${String(state.id)}`;
  if (data.kind === 'tow') return { ...state, data: { ...data, fee: cents_29_30(data.fee, `${what} fee`), waived: cents_29_30(data.waived, `${what} waived fee`) } };
  if (data.kind === 'towPromise' || data.kind === 'escort') return { ...state, data: { ...data, fee: cents_29_30(data.fee, `${what} fee`) } };
  if (data.kind === 'patch' || data.kind === 'aid') return { ...state, data: { ...data, price: cents_29_30(data.price, `${what} price`) } };
  return state;
}

function feeCents_29_30(e: SavedJson): SavedJson {
  return { ...e, fee: cents_29_30(e.fee, `${String(e.t)} fee`) };
}

const EVENT_CENTS_29_30: Record<string, (e: SavedJson) => SavedJson> = {
  money: (e) => ({ ...e, amount: cents_29_30(e.amount, 'money event') }),
  practice: (e) => (MONEY_PRACTICE_29_30.includes(e.source as string) ? { ...e, amount: scaled_29_30(e.amount, `${String(e.source)} practice`) } : e),
  contract: (e) => ({ ...e, contract: contractCents_29_30(e.contract as SavedJson) }),
  towOffer: feeCents_29_30,
  towDone: feeCents_29_30,
  escortPaid: feeCents_29_30,
  escortHired: feeCents_29_30,
  aid: (e) => ({ ...e, paid: cents_29_30(e.paid, 'aid paid') }),
  stateEnded: (e) => ({ ...e, state: stateCents_29_30(e.state as SavedJson) }),
  say: (e) => ({ ...e, vars: callVarsCents_29_30(e.vars as SavedJson) }),
};

function eventCents_29_30(e: SavedJson): SavedJson {
  const convert = EVENT_CENTS_29_30[e.t as string];
  return convert ? convert(e) : e;
}

function vehicleCents_29_30(v: SavedJson): SavedJson {
  const resources = v.resources as SavedJson | null;
  if (!resources) return v;
  return { ...v, resources: { ...resources, money: cents_29_30(resources.money, `vehicle ${String(v.id)} money`) } };
}

function withCents_29_30(world: SavedJson): SavedJson {
  const player = world.player as SavedJson;
  const call = player.call as SavedJson | null;
  return {
    ...world,
    player: {
      ...player,
      money: cents_29_30(player.money, 'player money'),
      costBasis: scaledRecord_29_30(player.costBasis as SavedJson, 'cost basis'),
      contracts: (player.contracts as SavedJson[]).map(contractCents_29_30),
      call: call ? callCents_29_30(call) : null,
    },
    shops: Object.fromEntries(
      Object.entries(world.shops as Record<string, SavedJson>).map(([id, shop]) => [id, { ...shop, contracts: (shop.contracts as SavedJson[]).map(contractCents_29_30) }]),
    ),
    vehicles: (world.vehicles as SavedJson[]).map(vehicleCents_29_30),
    removed: (world.removed as SavedJson[]).map(vehicleCents_29_30),
    salvage: (world.salvage as SavedJson[]).map((stock) => {
      const pile = stock.pile as SavedJson | undefined;
      return pile ? { ...stock, pile: { ...pile, basis: scaledRecord_29_30(pile.basis as SavedJson, `pile ${String(stock.id)} basis`) } } : stock;
    }),
    states: (world.states as SavedJson[]).map(stateCents_29_30),
    events: (world.events as SavedJson[]).map(eventCents_29_30),
  };
}

const RETIRED_SITES_36_37 = new Set(['burnt-convoy', 'podfield', 'ridge-wrecks', 'canyon-bridge', 'south-lock', 'broken-wing']);
const OUTPOST_GOODS_36_37: Record<string, string[]> = {
  dustwell: ['water', 'scrap', 'tools', 'meds'],
  'green-pit': ['water', 'grain', 'salt', 'textiles'],
};

function isRetired_36_37(id: unknown): boolean {
  return typeof id === 'string' && RETIRED_SITES_36_37.has(id);
}

function retiredObstacle_36_37(o: SavedJson): boolean {
  const id = o.id as string;
  for (const site of RETIRED_SITES_36_37) if (id === `site-${site}` || id.startsWith(`cw-${site}-`)) return true;
  return false;
}

function jobOnRetired_36_37(job: SavedJson | null | undefined): boolean {
  if (!job) return false;
  if (job.kind === 'search') return isRetired_36_37(job.stockId);
  const pickup = job.pickup as SavedJson | null | undefined;
  return job.kind === 'refit' && pickup?.from === 'stock' && isRetired_36_37(pickup.stockId);
}

function idleVehicle_36_37(v: SavedJson): SavedJson {
  const brain = v.brain as SavedJson | null | undefined;
  const job = jobOnRetired_36_37(v.job as SavedJson | null | undefined) ? { job: null } : {};
  return { ...v, ...job, ...(brain ? { brain: withoutRetiredMemory_36_37(brain) } : {}) };
}

function withOutposts_36_37(shops: Record<string, SavedJson>, turn: unknown): Record<string, SavedJson> {
  const added = Object.entries(OUTPOST_GOODS_36_37)
    .filter(([id]) => !(id in shops))
    .map(([id, goods]) => [id, { contracts: [], pressure: Object.fromEntries(goods.map((good) => [good, 0])), stock: [], restockAt: turn }]);
  return { ...shops, ...Object.fromEntries(added) };
}

function withoutRetiredSites_36_37(world: SavedJson): SavedJson {
  const keep = (id: string) => !isRetired_36_37(id);
  const player = world.player as SavedJson;
  return {
    ...world,
    salvage: (world.salvage as SavedJson[]).filter((stock) => keep(stock.id as string)),
    shops: withOutposts_36_37(world.shops as Record<string, SavedJson>, world.turn),
    obstacles: (world.obstacles as SavedJson[]).filter((o) => !retiredObstacle_36_37(o)),
    player: { ...player, scavenged: (player.scavenged as string[]).filter(keep), discovered: (player.discovered as string[]).filter(keep) },
    vehicles: (world.vehicles as SavedJson[]).map(idleVehicle_36_37),
  };
}

function withoutRetiredMemory_36_37(brain: SavedJson): SavedJson {
  const retired = (key: string) => isRetired_36_37(key) || isRetired_36_37(key.slice(key.indexOf(':') + 1));
  const goals = (brain.goals as SavedJson[]).filter((g) => !isRetired_36_37(g.targetId));
  const memories = (brain.memories as SavedJson[]).filter((m) => !isRetired_36_37((m.fact as SavedJson).stock));
  const noticed = Object.fromEntries(Object.entries(brain.noticed as Record<string, number>).filter(([key]) => !retired(key)));
  const unfit = ((brain.unfit as string[] | undefined) ?? []).filter((id) => !isRetired_36_37(id));
  return { ...brain, goals, memories, noticed, ...('unfit' in brain ? { unfit } : {}) };
}

export const MIGRATIONS: readonly ((world: SavedJson) => SavedJson)[] = [
  (world) => ({ ...world, player: { ...(world.player as SavedJson), townPatched: false } }),
  (world) => {
    const player = { ...(world.player as Player), storage: [...(world.player as Player).storage] };
    const vehicles = (world.vehicles as SavedJson[]).map((v) => relayVehicle(v, v.id === player.vehicleId ? player : null));
    const removed = (world.removed as SavedJson[]).map((v) => relayVehicle(v, null));
    return { ...world, player, vehicles, removed };
  },
  (world) => {
    const player = world.player as SavedJson;
    return { ...world, player: { ...player, xpBySource: { ...(player.xpBySource as SavedJson), aid: 0 } } };
  },
  (world) => {
    const player = world.player as SavedJson;
    return { ...world, player: { ...player, explored: packExplored_3_4(player.explored as unknown[]) } };
  },
  (world) => {
    const turn = world.turn as number;
    const windowed = (c: SavedJson): SavedJson => {
      const window = Math.max(1, (c.deadline as number) - turn);
      return c.kind === 'haul' ? { ...c, window, rush: false } : { ...c, window };
    };
    const player = world.player as SavedJson;
    const shops = Object.fromEntries(
      Object.entries(world.shops as Record<string, SavedJson>).map(([id, shop]) => [id, { ...shop, contracts: (shop.contracts as SavedJson[]).map(windowed) }]),
    );
    return { ...world, player: { ...player, contracts: (player.contracts as SavedJson[]).map(windowed) }, shops };
  },
  (world) => {
    const handover = (s: SavedJson): SavedJson => {
      const data = s.data as SavedJson;
      return data.kind === 'aid' ? { ...s, data: { ...data, started: false, work: HANDOVER_TURNS_5_6, workLeft: HANDOVER_TURNS_5_6 } } : s;
    };
    return { ...world, states: (world.states as SavedJson[]).map(handover) };
  },
  (world) => ({
    ...world,
    vehicles: (world.vehicles as SavedJson[]).map(withGaveUp_6_7),
    removed: (world.removed as SavedJson[]).map(withGaveUp_6_7),
  }),
  withoutRetiredStock_7_8,
  withoutRetiredStock_8_9,
  (world) => {
    const { skills, ...player } = world.player as SavedJson;
    return { ...world, player: { ...player, ...pooledSkills_9_10(skills as Record<string, number>) } };
  },
  (world) => world,
  withMemories_11_12,
  (world) => ({ ...world, player: { ...(world.player as SavedJson), headlights: false } }),
  withPatchParts_13_14,
  (world) => world,
  (world) => ({ ...world, craters: [], events: (world.events as SavedJson[]).map(withBurst_15_16) }),
  withStormBorn_16_17,
  withStormExposure_17_18,
  withRouteStyle_18_19,
  withoutGuards_19_20,
  withFleePerceived_20_21,
  withFightWorn_21_22,
  withTracks_22_23,
  withSeenSince_23_24,
  (world) => ({ ...world, obstacles: (world.obstacles as SavedJson[]).filter((o) => !isGoneObstacle_24_25(o)) }),
  (world) => withFreeze_25_26(withHiddenStock_25_26(withUtilities_25_26(world))),
  withFulfilledFlag_26_27,
  withoutRetiredStock_27_28,
  (world) => ({ ...world, setup: { mode: 'roaming', settings: { damage: 1, fuelUse: 1, supplyUse: 1 } } }),
  withCents_29_30,
  (world) => world,
  (world) => {
    const { events: _events, removed: _removed, ...rest } = world;
    const { visible: _visible, ...player } = world.player as SavedJson;
    const vehicles = (world.vehicles as SavedJson[]).map(({ trail: _trail, ...vehicle }) => vehicle);
    const broken = (world.broken as SavedJson[]).map((b) => ({ id: (b.obstacle as SavedJson).id, turn: b.turn }));
    return { ...rest, player, vehicles, broken };
  },
  (world) => {
    const { contacts: _contacts, clouds: _clouds, ...player } = world.player as SavedJson;
    return { ...world, player };
  },
  (world) => world,
  (world) => world,
  (world) => world,
  withoutRetiredSites_36_37,
];

export const SAVE_FORMAT = { major: SAVE_MAJOR, minor: MIGRATIONS.length } as const;
