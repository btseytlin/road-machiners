// The save format and the steps that carry an old save to it. A save loads only in its own major format. Within
// it, load runs every step from the save's minor format on, so the minor format is the number of steps.

import { CORES_2_1, CORES_2_2, LAYOUTS_2_2 } from './save-layouts-2-2';

// A saved world as raw JSON. Steps read it without game types, since those change after a step is written.
export type SavedJson = Record<string, unknown>;

// Bump for a change old saves cannot follow, and empty MIGRATIONS with it. Boot then carries the player's progression over into a new world, since the save screen handles every save that cannot load. A new map needs no bump.
export const SAVE_MAJOR = 2;

// Step 1 to 2: the chassis grids follow the cab, transmission and tank rules. Cores move, and what stood on their new
// cells moves to the nearest free deck spot. Parts are 1x1 unless listed here, a copy of the sizes at format 2.1
// since the parts table changes later.
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

// The money value of each good at format 2.1.
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

// The nearest spot from the item's anchor where every cell is free deck, by distance, then row, then column. The
// item's own turn comes first at each anchor.
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

// The marked cells of the new layout of a chassis.
function markedCells(layout: readonly string[], mark: string): Set<string> {
  return new Set(layout.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === mark ? [key({ x, y })] : []))));
}

// Each old core item paired with its copy on the new cells, wearing the new part id. The wheels never moved.
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

// What the player gets for an item that has no spot: the part into storage, the good as cash. Others get nothing.
function refund(item: Item, player: Player | null): void {
  if (!player) return;
  if (item.part) player.storage.push(item.part);
  else player.money += GOOD_VALUES_2_1[item.good ?? ''] ?? 0;
}

// Where a displaced item goes: a deck spot, else a refund, else nowhere.
function rehome(item: Item, free: Set<string>, player: Player | null): Item | null {
  const spot = nearestSpot(item, free);
  if (!spot) {
    refund(item, player);
    return null;
  }
  for (const c of cellsAt(item, spot)) free.delete(key(c));
  return { ...item, ...spot };
}

// A vehicle of a known chassis gets its cores on their new cells. Non-core items that lie on a core cell move to a
// free deck spot. What has no spot goes to the player's storage or becomes cash, or is dropped for anyone else.
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

// Only a refit is tied to the old cells; other jobs do not touch the grid.
function withoutRefit(job: unknown): unknown {
  return (job as SavedJson | null)?.kind === 'refit' ? null : job;
}

// Step 3 to 4: a frozen copy of the explored packer, a base64 bitset with the least significant bit first.
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

// A saved defeat gave up when its driver lay out with a working cab, the rule the game used before it saved the fact.
function withGaveUp_6_7(vehicle: SavedJson): SavedJson {
  const defeat = vehicle.defeat as SavedJson | undefined;
  if (!defeat) return vehicle;
  const cab = (vehicle.items as Item[]).find((item) => CAB_IDS_6_7.includes(item.part?.defId ?? ''));
  return { ...vehicle, defeat: { ...defeat, gaveUp: defeat.phase === 'out' && ((cab?.part?.hp as number | undefined) ?? 0) > 0 } };
}

// The Fallen Sun became a territory with no stock of its own: its loot lies in baked spots. A search of the old stock
// ends with it.
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

// Old Orchard became a territory with no stock of its own: its loot lies in baked spots. A search of the old stock
// ends with it. The step repeats the 7 to 8 one, since a committed step is never edited.
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

// Total XP a skill needed for each level at format 2.9; index is the level.
const XP_TO_REACH_9_10 = [0, 200, 600, 1200, 2000, 3000];

// Step 9 to 10: each skill's old level becomes the same rank, and the XP past it goes to the shared pool. A level cost
// what its rank costs now, so no earned XP is lost. Also read by the rescue of saves from before format 2.10.
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

// A driver's last town became a memory of the prices it saw there, kept like any memory from now on. The saved
// pressure stands in for what it saw, and the saved turn for when.
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

// Step 13 to 14: money becomes integer cents of M, and 1 M is the price of 5 L of fuel. The old fuel unit of 5 L cost
// 3 money, so every money number grows by 100 / 3. Balances, rewards, fees and prices round to a cent. Cost bases and
// the money a profit, free tow or aid practice counted are averages or XP inputs, so they scale exactly.
export const CENTS_PER_MONEY_13_14 = 100 / 3;
const MONEY_PRACTICE_13_14 = ['profit', 'freeTow', 'aid'];

function scaled_13_14(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Saved ${what} is ${String(value)}, not a number`);
  return value * CENTS_PER_MONEY_13_14;
}

function cents_13_14(value: unknown, what: string): number {
  return Math.round(scaled_13_14(value, what));
}

function scaledRecord_13_14(record: SavedJson, what: string): SavedJson {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, scaled_13_14(v, `${what} ${k}`)]));
}

function contractCents_13_14(c: SavedJson): SavedJson {
  return { ...c, reward: cents_13_14(c.reward, `contract ${String(c.id)} reward`) };
}

function callVarsCents_13_14(vars: SavedJson): SavedJson {
  const centsVar = (v: SavedJson): SavedJson => {
    if (v.kind === 'money') return { ...v, amount: cents_13_14(v.amount, 'call money') };
    if (v.kind === 'deal') return { ...v, price: cents_13_14(v.price, 'call deal price') };
    if (v.kind === 'prices') {
      const goods = (v.goods as SavedJson[]).map((g) => ({ ...g, buy: cents_13_14(g.buy, 'call buy price'), sell: cents_13_14(g.sell, 'call sell price') }));
      return { ...v, goods };
    }
    return v;
  };
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, centsVar(v as SavedJson)]));
}

function callCents_13_14(call: SavedJson): SavedJson {
  const line = call.line as SavedJson;
  return { ...call, vars: callVarsCents_13_14(call.vars as SavedJson), line: { ...line, vars: callVarsCents_13_14(line.vars as SavedJson) } };
}

function stateCents_13_14(state: SavedJson): SavedJson {
  const data = state.data as SavedJson;
  const what = `${String(data.kind)} state ${String(state.id)}`;
  if (data.kind === 'tow') return { ...state, data: { ...data, fee: cents_13_14(data.fee, `${what} fee`), waived: cents_13_14(data.waived, `${what} waived fee`) } };
  if (data.kind === 'towPromise' || data.kind === 'escort') return { ...state, data: { ...data, fee: cents_13_14(data.fee, `${what} fee`) } };
  if (data.kind === 'patch' || data.kind === 'aid') return { ...state, data: { ...data, price: cents_13_14(data.price, `${what} price`) } };
  return state;
}

function feeCents_13_14(e: SavedJson): SavedJson {
  return { ...e, fee: cents_13_14(e.fee, `${String(e.t)} fee`) };
}

const EVENT_CENTS_13_14: Record<string, (e: SavedJson) => SavedJson> = {
  money: (e) => ({ ...e, amount: cents_13_14(e.amount, 'money event') }),
  practice: (e) => (MONEY_PRACTICE_13_14.includes(e.source as string) ? { ...e, amount: scaled_13_14(e.amount, `${String(e.source)} practice`) } : e),
  contract: (e) => ({ ...e, contract: contractCents_13_14(e.contract as SavedJson) }),
  towOffer: feeCents_13_14,
  towDone: feeCents_13_14,
  escortPaid: feeCents_13_14,
  escortHired: feeCents_13_14,
  aid: (e) => ({ ...e, paid: cents_13_14(e.paid, 'aid paid') }),
  stateEnded: (e) => ({ ...e, state: stateCents_13_14(e.state as SavedJson) }),
  say: (e) => ({ ...e, vars: callVarsCents_13_14(e.vars as SavedJson) }),
};

function eventCents_13_14(e: SavedJson): SavedJson {
  const convert = EVENT_CENTS_13_14[e.t as string];
  return convert ? convert(e) : e;
}

function vehicleCents_13_14(v: SavedJson): SavedJson {
  const resources = v.resources as SavedJson | null;
  if (!resources) return v;
  return { ...v, resources: { ...resources, money: cents_13_14(resources.money, `vehicle ${String(v.id)} money`) } };
}

function withCents_13_14(world: SavedJson): SavedJson {
  const player = world.player as SavedJson;
  const call = player.call as SavedJson | null;
  return {
    ...world,
    player: {
      ...player,
      money: cents_13_14(player.money, 'player money'),
      costBasis: scaledRecord_13_14(player.costBasis as SavedJson, 'cost basis'),
      contracts: (player.contracts as SavedJson[]).map(contractCents_13_14),
      call: call ? callCents_13_14(call) : null,
    },
    shops: Object.fromEntries(
      Object.entries(world.shops as Record<string, SavedJson>).map(([id, shop]) => [id, { ...shop, contracts: (shop.contracts as SavedJson[]).map(contractCents_13_14) }]),
    ),
    vehicles: (world.vehicles as SavedJson[]).map(vehicleCents_13_14),
    removed: (world.removed as SavedJson[]).map(vehicleCents_13_14),
    salvage: (world.salvage as SavedJson[]).map((stock) => {
      const pile = stock.pile as SavedJson | undefined;
      return pile ? { ...stock, pile: { ...pile, basis: scaledRecord_13_14(pile.basis as SavedJson, `pile ${String(stock.id)} basis`) } } : stock;
    }),
    states: (world.states as SavedJson[]).map(stateCents_13_14),
    events: (world.events as SavedJson[]).map(eventCents_13_14),
  };
}

// MIGRATIONS[n] turns a saved world of minor format n into minor format n + 1. A step is pure and imports no sim
// or data code, and a committed step is never edited.
export const MIGRATIONS: readonly ((world: SavedJson) => SavedJson)[] = [
  // 0 to 1: the player gets townPatched, as a new game does.
  (world) => ({ ...world, player: { ...(world.player as SavedJson), townPatched: false } }),
  // 1 to 2: chassis grids follow the cab, transmission and tank rules; cores move, and what stood on their new cells
  // moves to a free deck spot or the garage.
  (world) => {
    const player = { ...(world.player as Player), storage: [...(world.player as Player).storage] };
    const vehicles = (world.vehicles as SavedJson[]).map((v) => relayVehicle(v, v.id === player.vehicleId ? player : null));
    const removed = (world.removed as SavedJson[]).map((v) => relayVehicle(v, null));
    return { ...world, player, vehicles, removed };
  },
  // 2 to 3: the new aid XP source starts at 0, as in a new game.
  (world) => {
    const player = world.player as SavedJson;
    return { ...world, player: { ...player, xpBySource: { ...(player.xpBySource as SavedJson), aid: 0 } } };
  },
  // 3 to 4: player.explored becomes a base64 bitset.
  (world) => {
    const player = world.player as SavedJson;
    return { ...world, player: { ...player, explored: packExplored_3_4(player.explored as unknown[]) } };
  },
  // 4 to 5: a contract gets the turns it has left as its window, so no deadline or reward changes. A haul is no rush.
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
  // 5 to 6: an aid deal waits for the player's [E] handover, one turn of work.
  (world) => {
    const handover = (s: SavedJson): SavedJson => {
      const data = s.data as SavedJson;
      return data.kind === 'aid' ? { ...s, data: { ...data, started: false, work: HANDOVER_TURNS_5_6, workLeft: HANDOVER_TURNS_5_6 } } : s;
    };
    return { ...world, states: (world.states as SavedJson[]).map(handover) };
  },
  // 6 to 7: a defeat records whether its driver gave up, where it used to be read from the cab.
  (world) => ({
    ...world,
    vehicles: (world.vehicles as SavedJson[]).map(withGaveUp_6_7),
    removed: (world.removed as SavedJson[]).map(withGaveUp_6_7),
  }),
  // 7 to 8: the Fallen Sun is a territory, so its site stock goes.
  withoutRetiredStock_7_8,
  // 8 to 9: Old Orchard is a territory, so its site stock goes.
  withoutRetiredStock_8_9,
  // 9 to 10: XP goes to one pool and levels become bought ranks.
  (world) => {
    const { skills, ...player } = world.player as SavedJson;
    return { ...world, player: { ...player, ...pooledSkills_9_10(skills as Record<string, number>) } };
  },
  // 10 to 11: a kill wreck may record its chassis as a hulk; older kill wrecks stay generic.
  (world) => world,
  // 11 to 12: a driver's last town becomes a memory of its prices.
  withMemories_11_12,
  // 12 to 13: the player gets the headlight switch, off as in a new game.
  (world) => ({ ...world, player: { ...(world.player as SavedJson), headlights: false } }),
  // 13 to 14: money becomes integer cents of M, 1 M per 5 L of fuel.
  withCents_13_14,
];

export const SAVE_FORMAT = { major: SAVE_MAJOR, minor: MIGRATIONS.length } as const;
