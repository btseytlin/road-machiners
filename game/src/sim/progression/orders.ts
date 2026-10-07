// A bot's player commands: Orders runs them one after another and keeps their events, and upgradeGear is the shop
// upgrade routine every bot shares. At any shop it takes the part or chassis that adds the most within its money above
// the upkeep reserve, and mounts it. The parts on offer are the shop's stock and the spares the bot holds, which cost
// nothing. A part replaces the weakest mounted part of its kind when no mount is free. Gains are in money: a part's
// value at its wear and health, a chassis's value, or its top speed for a bot that wants speed.

import { chassisDef, PLAYER_CHASSIS } from '../../data/chassis';
import { startKit } from '../../data/start';
import { partDef, type PartKind } from '../../data/parts';
import { playerVehicle } from '../damage';
import { buyChassis, buyStockPart, chassisTradeIn, partTradePrice, sellPart } from '../economy';
import { freeCells, goodsCount, mountedItems, type Spot } from '../grid';
import { getLayoutError, installSpot, moveItem, spareParts, storePart, takeFromStorage } from '../inventory';
import { shopAt, shopState } from '../market';
import { townAt } from '../sites';
import { getUpkeepReserve } from '../npc-decisions';
import type { ThreatAnswer } from '../parley';
import type { GameEvent, GridItem, PartInstance, Vehicle, World } from '../types';
import { isJunk, maxHp, partValue } from '../wear';

// Where money goes and comes from. Each money-moving command names its key; money the turn moves by itself is
// 'contracts' for contract rewards and penalties and 'fees' for tow, patch and escort pay.
export const LEDGER_KEYS = ['fuel', 'supplies', 'repairs', 'gear', 'goodsBought', 'goodsSold', 'lootSales', 'contracts', 'fees', 'other'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];
export type Ledger = Record<LedgerKey, number>;

export const emptyLedger = (): Ledger => Object.fromEntries(LEDGER_KEYS.map((k) => [k, 0])) as Ledger;

// What the bot did that the events do not say: a demand and the driver's answer, and goods and spares it looted.
export type BotNote =
  | { kind: 'demand'; target: string; answer: ThreatAnswer; guarded: boolean }
  | { kind: 'took'; from: string; goods: Record<string, number>; parts: PartInstance[] };

// The world after the bot's commands, every event those commands raised, the money each moved and the bot's notes.
export type BotTurn = { world: World; events: GameEvent[]; ledger: Ledger; notes: BotNote[] };

export class Orders {
  readonly events: GameEvent[] = [];
  readonly ledger = emptyLedger();
  readonly notes: BotNote[] = [];
  // False for a bot that must not spend on gear, so a run measures its trade alone.
  buysGear = true;
  // A bot that repairs in the field pays the garage only for the built-in parts that keep the truck driving, strips
  // its spare parts into the parts good and spends that on the rest.
  fieldRepair = false;
  constructor(public world: World) {}

  // A command that moves money names where it goes: a purchase counts as spending, a sale as income.
  run(command: (w: World) => World, key: LedgerKey = 'other'): void {
    const before = this.world.player.money;
    this.world = command(this.world);
    this.ledger[key] += this.world.player.money - before;
    this.events.push(...this.world.events);
  }

  // Runs a loot command and notes the goods and spares it brought in from `from`.
  loot(from: string, command: (w: World) => World): void {
    const goods = goodsCount(this.me);
    const spares = new Set(spareParts(this.me).map((p) => p.id));
    this.run(command);
    const gained = Object.entries(goodsCount(this.me)).flatMap(([good, n]) => (n > (goods[good] ?? 0) ? [[good, n - (goods[good] ?? 0)] as const] : []));
    const parts = spareParts(this.me).filter((p) => !spares.has(p.id)).map((p) => structuredClone(p));
    if (gained.length > 0 || parts.length > 0) this.notes.push({ kind: 'took', from, goods: Object.fromEntries(gained), parts });
  }

  get me(): Vehicle {
    return playerVehicle(this.world);
  }
}

// A bot keeps its starting money working as trade capital and buys gear from profit above it, since a bot spent down
// to the upkeep reserve cannot buy a load and starves.
const WORKING_CAPITAL = startKit('standard').money;

// Kinds no bot uses: built-in parts cannot be traded, and no bot reads a scanner.
const NEVER: readonly PartKind[] = ['core', 'scanner'];

// skip names the part kinds a bot also leaves alone. chassis is what a better chassis means to the bot. keepRoom
// marks a bot that lives off its cargo: it takes no part that leaves less room for goods. A bot with chassis keep stays
// on the chassis it has, since every swap pays the shop's spread.
export type UpgradeStyle = { skip: readonly PartKind[]; chassis: 'value' | 'speed' | 'keep'; keepRoom: boolean };

type PartItem = Extract<GridItem, { kind: 'part' }>;
type Option = { gain: number; cost: number; take: (o: Orders) => void };
// A part the bot could mount, what it costs, and how it reaches the truck or garage storage.
type Candidate = { part: PartInstance; price: number; acquire: (o: Orders) => void };

export function upgradeGear(o: Orders, style: UpgradeStyle): void {
  if (!o.buysGear) return;
  for (let option = bestOption(o, style); option; option = bestOption(o, style)) option.take(o);
}

function bestOption(o: Orders, style: UpgradeStyle): Option | null {
  const shop = shopAt(o.world);
  if (!shop) return null;
  const spend = o.world.player.money - getUpkeepReserve(o.me) - WORKING_CAPITAL;
  const chassis = strongest(chassisOptions(o, style).filter((option) => option.cost <= spend));
  if (style.chassis === 'speed' && chassis) return chassis;
  const wanted = (c: Candidate) => !isJunk(c.part) && ![...NEVER, ...style.skip].includes(partDef(c.part.defId).kind);
  const parts = candidates(o, shop).filter(wanted);
  const options = parts.flatMap((c) => partOption(o, c, style.keepRoom)).filter((option) => option.cost <= spend);
  return strongest(chassis ? [chassis, ...options] : options);
}

// A bot with no gun mounts the cheapest one the shop sells or it holds as a spare, from money above the upkeep
// reserve. Working capital does not hold it back, since every bot shoots back and the hunter earns only with a gun.
export function rearm(o: Orders): void {
  if (!o.buysGear) return;
  const shop = shopAt(o.world);
  if (mountedItems(o.me, 'weapon').length > 0 || !shop) return;
  const spend = o.world.player.money - getUpkeepReserve(o.me);
  const guns = candidates(o, shop).filter((c) => partDef(c.part.defId).kind === 'weapon' && !isJunk(c.part) && c.price <= spend && installSpot(o.me, probe(c.part)));
  const cheapest = guns.reduce<Candidate | null>((best, c) => (!best || c.price < best.price ? c : best), null);
  if (cheapest) mount(o, cheapest, null);
}

function strongest(options: Option[]): Option | null {
  return options.reduce<Option | null>((best, option) => (!best || option.gain > best.gain ? option : best), null);
}

// What a part adds: its value at its wear, cut by its damage.
function quality(part: PartInstance): number {
  return partValue(part) * (part.hp / maxHp(part));
}

// ---- Chassis.

// A chassis change moves the cargo through the new grid, and goods may not fit. So the bot changes chassis only empty.
function chassisOptions(o: Orders, style: UpgradeStyle): Option[] {
  // Chassis sell only in a town, as buyChassis() requires.
  if (style.chassis === 'keep' || !townAt(o.world) || Object.keys(goodsCount(o.me)).length > 0) return [];
  const current = chassisDef(o.me.chassisId);
  return PLAYER_CHASSIS.filter((id) => id !== current.id).flatMap((id) => {
    const def = chassisDef(id);
    const gain = style.chassis === 'speed' ? def.maxSpeed - current.maxSpeed : def.value - current.value;
    return gain > 0 ? [{ gain, cost: def.value - chassisTradeIn(o.world), take: (orders: Orders) => orders.run((w) => buyChassis(w, id), 'gear') }] : [];
  });
}

// ---- Parts.

function candidates(o: Orders, shop: string): Candidate[] {
  const stock = shopState(o.world, shop).stock.map((part) => ({ part, price: partTradePrice(o.world, o.me, part, 'buy'), acquire: (orders: Orders) => orders.run((w) => buyStockPart(w, part.id), 'gear') }));
  const spares = [...spareParts(o.me), ...o.world.player.storage].map((part) => ({ part, price: 0, acquire: () => undefined }));
  return [...stock, ...spares];
}

// Mounting the candidate, with the weakest mounted part of its kind sold first when no mount is free. Nothing when
// the part would not mount or adds nothing, or, with keepRoom, when it leaves less room for goods.
function partOption(o: Orders, c: Candidate, keepRoom: boolean): Option[] {
  const fits = (v: Vehicle) => {
    const spot = installSpot(v, probe(c.part));
    return spot !== null && !(keepRoom && roomAfter(v, c.part, spot) < goodsRoom(o.me));
  };
  if (installSpot(o.me, probe(c.part))) return fits(o.me) ? [{ gain: quality(c.part), cost: c.price, take: (orders) => mount(orders, c, null) }] : [];
  const weakest = weakestOfKind(o.me, partDef(c.part.defId).kind);
  if (!canSwap(o.me, c.part, weakest, fits)) return [];
  const resale = partTradePrice(o.world, o.me, weakest.part, 'sell');
  return [{ gain: quality(c.part) - quality(weakest.part), cost: c.price - resale, take: (orders) => mount(orders, c, weakest) }];
}

// Whether the part is better than the weakest mounted part of its kind and the truck holds together without that one.
// Goods stowed on cells the old part provides, such as a cargo rack, would fall off the grid without it.
function canSwap(me: Vehicle, part: PartInstance, weakest: PartItem | null, fits: (v: Vehicle) => boolean): weakest is PartItem {
  if (!weakest || quality(part) <= quality(weakest.part)) return false;
  const items = me.items.filter((it) => it.id !== weakest.id);
  return getLayoutError(me, items) === null && fits({ ...me, items });
}

// The cells goods could use if the truck carried none.
function goodsRoom(v: Vehicle): number {
  return freeCells({ ...v, items: v.items.filter((it) => it.kind === 'part') });
}

// A spare that moves onto the mount frees the cells it held.
function roomAfter(v: Vehicle, part: PartInstance, spot: Spot): number {
  const items = v.items.filter((it) => !(it.kind === 'part' && it.part.id === part.id));
  return goodsRoom({ ...v, items: [...items, { ...probe(part), ...spot }] });
}

function weakestOfKind(v: Vehicle, kind: PartKind): PartItem | null {
  return mountedItems(v, kind).reduce<PartItem | null>((weak, it) => (!weak || quality(it.part) < quality(weak.part) ? it : weak), null);
}

function probe(part: PartInstance): PartItem {
  return { id: 'upgrade-probe', x: 0, y: 0, rot: 0, kind: 'part', part };
}

function mount(o: Orders, c: Candidate, replaced: PartItem | null): void {
  if (replaced) {
    o.run((w) => storePart(w, replaced.id));
    o.run((w) => sellPart(w, replaced.part.id), 'gear');
  }
  c.acquire(o);
  // A part the truck now holds may stand on the mount it is going to, so its own cells count as free.
  const held = o.me.items.find((it): it is PartItem => it.kind === 'part' && it.part.id === c.part.id);
  const spot = installSpot(o.me, held ?? probe(c.part));
  if (!spot) throw new Error(`No mount for the ${partDef(c.part.defId).name}`);
  mountBought(o, c.part.id, spot);
}

// A bought part lands in garage storage or loose in the grid; either way it moves onto the spot.
export function mountBought(o: Orders, partId: string, spot: Spot): void {
  if (o.world.player.storage.some((p) => p.id === partId)) o.run((w) => takeFromStorage(w, partId, spot));
  else o.run((w) => moveItem(w, itemOf(w, partId), spot));
}

function itemOf(world: World, partId: string): string {
  const item = playerVehicle(world).items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item) throw new Error(`Part ${partId} is not on the truck`);
  return item.id;
}
