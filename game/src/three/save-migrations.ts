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

// 13 to 14: a patch records the parts it lifts. Old patches were all stranded ones, so they get the client's parts at
// 0 HP. Settling keeps only those that are still patchable and below the target.
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

// Step 15 to 16: a shot round records the ground point where an exploding round burst. A saved round has none, so the
// renderer plays its old miss.
const SHOT_EVENTS_15_16 = ['shot', 'guardShot'];

function withBurst_15_16(event: SavedJson): SavedJson {
  if (!SHOT_EVENTS_15_16.includes(event.t as string)) return event;
  return { ...event, rounds: (event.rounds as SavedJson[]).map((round) => ({ ...round, burst: null })) };
}

// Utility items arrive: every truck gets utility orders, the world gets empty utility effects and the search stream,
// and every stock gets hidden loot. The stream comes from the world seed like a new game's.
const SEARCH_SALT_16_17 = 0x73656172;
const NO_HIDDEN_16_17 = (): SavedJson => ({ goods: {}, parts: [], fuel: 0, supplies: 0 });

function withUtilities_16_17(world: SavedJson): SavedJson {
  const ordered = (v: SavedJson): SavedJson => ({ ...v, utilityOrders: {} });
  return {
    ...world,
    vehicles: (world.vehicles as SavedJson[]).map(ordered),
    removed: (world.removed as SavedJson[]).map(ordered),
    smoke: [],
    fields: [],
    flares: [],
    lines: [],
    searchRng: { rngState: (world.seed as number) ^ SEARCH_SALT_16_17 },
  };
}

// Stocks rolled from loot tables at minor format 9: the sites that hold salvage, the loot spots of territories, whose
// ids are <prop kind>-<n>, and the road wrecks, whose ids are wreck<n>. Truck wrecks (wreck-<vehicle>) and piles lie
// in the open.
const LOOT_SITES_16_17 = new Set(['burnt-convoy', 'podfield', 'canyon-bridge', 'glass-flats', 'south-lock', 'ridge-wrecks', 'broken-wing']);
const LOOT_SPOT_16_17 = /^(farmhouse|barn|quonset|bunker|guardPost|armyTruck|armyCache|deckBay|shipCache)-\d+$/;
const ROAD_WRECK_16_17 = /^wreck\d+$/;

function isRolledStock_16_17(stock: SavedJson): boolean {
  const id = stock.id as string;
  return !stock.pile && (LOOT_SITES_16_17.has(id) || LOOT_SPOT_16_17.test(id) || ROAD_WRECK_16_17.test(id));
}

// A rolled stock the player has not searched hides all its loot, as a new game's does. Other stocks hide nothing.
function withHiddenStock_16_17(world: SavedJson): SavedJson {
  const searched = new Set((world.player as SavedJson).scavenged as string[]);
  const hide = (stock: SavedJson): SavedJson => {
    if (searched.has(stock.id as string) || !isRolledStock_16_17(stock)) return { ...stock, hidden: NO_HIDDEN_16_17() };
    const hidden = { goods: stock.goods, parts: stock.parts, fuel: stock.fuel ?? 0, supplies: stock.supplies ?? 0 };
    return { ...stock, goods: {}, parts: [], fuel: 0, supplies: 0, hidden };
  };
  return { ...world, salvage: (world.salvage as SavedJson[]).map(hide) };
}

// MIGRATIONS[n] turns a saved world of minor format n into minor format n + 1. A step is pure and imports no sim
// or data code, and a committed step is never edited.
// Step 17 to 18: the harpoon is a gun. A harpoon part trades its utility charge for a gun state with a one-round
// magazine: ready with the round loaded, recharging as a reload with the turns it has worked. A standing harpoon order
// becomes the gun's target, and utility events lose their target. Parts sit on trucks, in storage, stocks and shops,
// so every object in the world is walked.
const HARPOON_RELOAD_17_18 = 5;

function asGun_17_18(part: SavedJson): SavedJson {
  const { charge, ...rest } = part;
  const left = (charge as { reload: number }).reload;
  const gun = left > 0 ? { cooldown: 0, ammo: 0, reloadWork: Math.max(0, HARPOON_RELOAD_17_18 - left) } : { cooldown: 0, ammo: 1, reloadWork: 0 };
  return { ...rest, gun };
}

// A vehicle's truck orders, the harpoon's, become weapon orders on the same part.
function withHarpoonTargets_17_18(v: SavedJson): SavedJson {
  const orders = Object.entries(v.utilityOrders as Record<string, SavedJson>);
  const truck = orders.filter(([, o]) => o.kind === 'truck');
  if (truck.length === 0) return v;
  return {
    ...v,
    utilityOrders: Object.fromEntries(orders.filter(([, o]) => o.kind !== 'truck')),
    weaponOrders: { ...(v.weaponOrders as SavedJson), ...Object.fromEntries(truck.map(([id, o]) => [id, { targetId: o.targetId, aim: o.aim }])) },
  };
}

function withoutTarget_17_18(event: SavedJson): SavedJson {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'target'));
}

function objectAsGun_17_18(obj: SavedJson): SavedJson {
  const part = obj.defId === 'harpoon' && 'charge' in obj ? asGun_17_18(obj) : obj;
  const vehicle = 'utilityOrders' in part && 'weaponOrders' in part ? withHarpoonTargets_17_18(part) : part;
  return vehicle.t === 'utility' ? withoutTarget_17_18(vehicle) : vehicle;
}

function harpoonAsGun_17_18(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(harpoonAsGun_17_18);
  if (node === null || typeof node !== 'object') return node;
  return objectAsGun_17_18(Object.fromEntries(Object.entries(node).map(([k, v]) => [k, harpoonAsGun_17_18(v)])));
}

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
  // 13 to 14: a patch records the parts it lifts.
  withPatchParts_13_14,
  // 14 to 15: goals may be a rearm lie-up with an until turn. Old saves hold none, so nothing changes. A defeated
  // driver still on its retreat lies up when it gets home.
  (world) => world,
  // 15 to 16: craters and the burst point of shot rounds. A new game has no craters.
  (world) => ({ ...world, craters: [], events: (world.events as SavedJson[]).map(withBurst_15_16) }),
  // 16 to 17: utility orders and effects, the search stream, and hidden salvage in every unsearched rolled stock.
  (world) => withHiddenStock_16_17(withUtilities_16_17(world)),
  // 17 to 18: NPC trucks carry charged utilities far more often, so a new game holds them in more places. The saved
  // types are the same, so a save keeps its world as it was.
  (world) => world,
  // 18 to 19: the player gets the debug freeze switch, off as in a new game.
  (world) => ({ ...world, player: { ...(world.player as SavedJson), frozen: false } }),
  // 19 to 20: the harpoon is a gun.
  (world) => harpoonAsGun_17_18(world) as SavedJson,
  // 20 to 21: a caltrops event lists the wheel damage it dealt. A saved one gets none, so its log line shows no
  // numbers.
  (world) => ({ ...world, events: (world.events as SavedJson[]).map((e) => (e.t === 'caltrops' ? { ...e, hits: [] } : e)) }),
  // 21 to 22: a claymore event names the ram that went off. A saved one cannot know it, so the last turn's blasts are
  // dropped. Their damage is already on the trucks.
  (world) => ({ ...world, events: (world.events as SavedJson[]).filter((e) => e.t !== 'claymore') }),
];

export const SAVE_FORMAT = { major: SAVE_MAJOR, minor: MIGRATIONS.length } as const;
