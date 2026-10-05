// A bot's player commands: Orders runs them one after another and keeps their events, and upgradeGear is the town
// upgrade routine every bot shares. In a garage it buys what src/sim/gear-choice.ts picks for the bot's job, the part
// that adds most to it within the budget, and mounts it. The parts on offer are the shop's stock and the spares the bot
// holds, which cost nothing. A better chassis comes only when no part gains. A chassis counts by its value, or its top
// speed for a bot that wants speed.

import { chassisDef, PLAYER_CHASSIS } from '../../data/chassis';
import { shopDef } from '../../data/market';
import { partDef, type PartKind } from '../../data/parts';
import { playerVehicle } from '../damage';
import { buyChassis, buyStockPart, chassisTradeIn, partTradePrice, sellPart } from '../economy';
import { type Spot, goodsCount, mountedItems } from '../grid';
import { installSpot, moveItem, spareParts, storePart, takeFromStorage } from '../inventory';
import { shopAt, shopState } from '../market';
import { getUpkeepReserve } from '../npc-decisions';
import { bestPlan, gearBudget, gearPlans, probe, type Offer } from './gear';
import type { GearJob } from '../../data/npcs';
import type { GameEvent, GridItem, PartInstance, Vehicle, World } from '../types';
import { isJunk } from '../wear';

// Where money goes and comes from. Each money-moving command names its key; money the turn moves by itself is
// 'contracts' for contract rewards and penalties and 'fees' for tow, patch and escort pay.
export const LEDGER_KEYS = ['fuel', 'supplies', 'repairs', 'gear', 'goodsBought', 'goodsSold', 'lootSales', 'contracts', 'fees', 'other'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];
export type Ledger = Record<LedgerKey, number>;

export const emptyLedger = (): Ledger => Object.fromEntries(LEDGER_KEYS.map((k) => [k, 0])) as Ledger;

// The world after the bot's commands, every event those commands raised, and the money each moved.
export type BotTurn = { world: World; events: GameEvent[]; ledger: Ledger };

export class Orders {
  readonly events: GameEvent[] = [];
  readonly ledger = emptyLedger();
  // A bot that repairs in the field strips its spare parts into the parts good instead of selling them, to patch
  // parts on the road between garages.
  fieldRepair = false;
  constructor(public world: World) {}

  // A command that moves money names where it goes: a purchase counts as spending, a sale as income.
  run(command: (w: World) => World, key: LedgerKey = 'other'): void {
    const before = this.world.player.money;
    this.world = command(this.world);
    this.ledger[key] += this.world.player.money - before;
    this.events.push(...this.world.events);
  }

  get me(): Vehicle {
    return playerVehicle(this.world);
  }
}

// skip names part kinds a bot leaves alone. job picks parts that help it fight or earn. budgetJob lets a driver that
// trades and hunts reserve trading capital while buying fighting gear. A chassis kept avoids paying the swap spread.
export type UpgradeStyle = { skip: readonly PartKind[]; chassis: 'value' | 'speed' | 'keep'; job: GearJob; budgetJob?: GearJob };

type PartItem = Extract<GridItem, { kind: 'part' }>;
type Option = { gain: number; cost: number; take: (o: Orders) => void };
// A part the bot could mount, what it costs, and how it reaches the truck or garage storage.
type Candidate = Offer & { acquire: (o: Orders) => void };

export function upgradeGear(o: Orders, style: UpgradeStyle): void {
  for (let option = bestOption(o, style); option; option = bestOption(o, style)) option.take(o);
}

function bestOption(o: Orders, style: UpgradeStyle): Option | null {
  const shop = shopAt(o.world);
  if (!shop || shopDef(shop).kind !== 'garage') return null;
  const budget = gearBudget(o.world, o.me, chooseBudgetJob(style));
  const chassis = strongest(chassisOptions(o, style).filter((option) => option.cost <= budget));
  if (style.chassis === 'speed' && chassis) return chassis;
  const buyer = { job: style.job, skip: style.skip, resale: (part: PartInstance) => partTradePrice(o.world, o.me, part, 'sell') };
  const plan = bestPlan(gearPlans(o.world, o.me, candidates(o, shop), buyer), budget);
  return plan ? { gain: plan.worthGain, cost: plan.cost, take: (orders) => mount(orders, plan.offer, plan.replaces) } : chassis;
}

function chooseBudgetJob(style: UpgradeStyle): GearJob {
  return style.budgetJob ?? style.job;
}

// A bot with no gun mounts the cheapest one the garage sells or it holds as a spare, from money above the upkeep
// reserve. Working capital does not hold it back, since every bot shoots back and the hunter earns only with a gun.
export function rearm(o: Orders): void {
  const shop = shopAt(o.world);
  if (mountedItems(o.me, 'weapon').length > 0 || !shop || shopDef(shop).kind !== 'garage') return;
  const spend = o.world.player.money - getUpkeepReserve(o.me);
  const guns = candidates(o, shop).filter((c) => partDef(c.part.defId).kind === 'weapon' && !isJunk(c.part) && c.price <= spend && installSpot(o.me, probe(c.part)));
  const cheapest = guns.reduce<Candidate | null>((best, c) => (!best || c.price < best.price ? c : best), null);
  if (cheapest) mount(o, cheapest, null);
}

function strongest(options: Option[]): Option | null {
  return options.reduce<Option | null>((best, option) => (!best || option.gain > best.gain ? option : best), null);
}

// ---- Chassis.

// A chassis change moves the cargo through the new grid, and goods may not fit. So the bot changes chassis only empty.
function chassisOptions(o: Orders, style: UpgradeStyle): Option[] {
  if (style.chassis === 'keep' || Object.keys(goodsCount(o.me)).length > 0) return [];
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
