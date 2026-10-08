// A bot's player commands: Orders runs them one after another and keeps their events, and upgradeGear is the shop
// upgrade routine every bot shares. At any shop it buys what ./gear.ts picks for the bot's job, the part
// that adds most to it within the budget, and mounts it. The parts on offer are the shop's stock and the spares the bot

import { chassisDef, PLAYER_CHASSIS } from '../../data/chassis';
import { startKit } from '../../data/start';
import { partDef, PARTS, type PartKind } from '../../data/parts';
import { playerVehicle } from '../damage';
import { buyChassis, buyStockPart, chassisTradeIn, partTradePrice, sellPart } from '../economy';
import { type Spot, goodsCount, mountedItems } from '../grid';
import { installSpot, moveItem, spareParts, storePart, takeFromStorage } from '../inventory';
import { shopAt, shopState } from '../market';
import { townAt } from '../sites';
import { getUpkeepReserve } from '../npc-decisions';
import { bestPlan, gearBudget, gearPlans, probe, type GearJob, type Offer } from './gear';
import type { ThreatAnswer } from '../parley';
import type { GameEvent, GridItem, PartInstance, Vehicle, World } from '../types';
import { isJunk } from '../wear';

export const LEDGER_KEYS = ['fuel', 'supplies', 'repairs', 'gear', 'goodsBought', 'goodsSold', 'lootSales', 'contracts', 'fees', 'other'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];
export type Ledger = Record<LedgerKey, number>;

export const emptyLedger = (): Ledger => Object.fromEntries(LEDGER_KEYS.map((k) => [k, 0])) as Ledger;

export const REPAIR_PARTS = startKit('standard').cargo.parts ?? 0;

export type BotNote =
  | { kind: 'demand'; target: string; answer: ThreatAnswer; guarded: boolean }
  | { kind: 'took'; from: string; goods: Record<string, number>; parts: PartInstance[] };

export type BotTurn = { world: World; events: GameEvent[]; ledger: Ledger; notes: BotNote[] };

export class Orders {
  readonly events: GameEvent[] = [];
  readonly ledger = emptyLedger();
  readonly notes: BotNote[] = [];
  buysGear = true;
  fieldRepair = false;
  constructor(public world: World) {}

  run(command: (w: World) => World, key: LedgerKey = 'other'): void {
    const before = this.world.player.money;
    this.world = command(this.world);
    this.ledger[key] += this.world.player.money - before;
    this.events.push(...this.world.events);
  }

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

export type UpgradeStyle = { skip: readonly PartKind[]; chassis: 'value' | 'speed' | 'keep'; job: GearJob; budgetJob?: GearJob; lootRoom?: number; minSpeed?: number };

export const BIGGEST_PART_CELLS = Math.max(...Object.values(PARTS).map((p) => p.w * p.h));

type PartItem = Extract<GridItem, { kind: 'part' }>;
type Option = { gain: number; cost: number; take: (o: Orders) => void };
type Candidate = Offer & { acquire: (o: Orders) => void };

export function upgradeGear(o: Orders, style: UpgradeStyle): void {
  if (!o.buysGear) return;
  for (let option = bestOption(o, style); option; option = bestOption(o, style)) option.take(o);
}

function bestOption(o: Orders, style: UpgradeStyle): Option | null {
  const shop = shopAt(o.world);
  if (!shop) return null;
  const budget = gearBudget(o.world, o.me, chooseBudgetJob(style));
  const chassis = strongest(chassisOptions(o, style).filter((option) => option.cost <= budget));
  if (style.chassis === 'speed' && chassis) return chassis;
  const buyer = { job: style.job, skip: style.skip, lootRoom: style.lootRoom, minSpeed: style.minSpeed, resale: (part: PartInstance) => partTradePrice(o.world, o.me, part, 'sell') };
  const plan = bestPlan(gearPlans(o.world, o.me, candidates(o, shop), buyer), budget);
  return plan ? { gain: plan.worthGain, cost: plan.cost, take: (orders) => mount(orders, plan.offer, plan.replaces) } : chassis;
}

function chooseBudgetJob(style: UpgradeStyle): GearJob {
  return style.budgetJob ?? style.job;
}

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

function chassisOptions(o: Orders, style: UpgradeStyle): Option[] {
  const load = Object.entries(goodsCount(o.me)).some(([good, n]) => good !== 'parts' || n > REPAIR_PARTS);
  if (style.chassis === 'keep' || !townAt(o.world) || load) return [];
  const current = chassisDef(o.me.chassisId);
  return PLAYER_CHASSIS.filter((id) => id !== current.id).flatMap((id) => {
    const def = chassisDef(id);
    const gain = style.chassis === 'speed' ? def.maxSpeed - current.maxSpeed : def.value - current.value;
    return gain > 0 ? [{ gain, cost: def.value - chassisTradeIn(o.world), take: (orders: Orders) => orders.run((w) => buyChassis(w, id), 'gear') }] : [];
  });
}

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
  const held = o.me.items.find((it): it is PartItem => it.kind === 'part' && it.part.id === c.part.id);
  const spot = installSpot(o.me, held ?? probe(c.part));
  if (!spot) throw new Error(`No mount for the ${partDef(c.part.defId).name}`);
  mountBought(o, c.part.id, spot);
}

export function mountBought(o: Orders, partId: string, spot: Spot): void {
  if (o.world.player.storage.some((p) => p.id === partId)) o.run((w) => takeFromStorage(w, partId, spot));
  else o.run((w) => moveItem(w, itemOf(w, partId), spot));
}

function itemOf(world: World, partId: string): string {
  const item = playerVehicle(world).items.find((it) => it.kind === 'part' && it.part.id === partId);
  if (!item) throw new Error(`Part ${partId} is not on the truck`);
  return item.id;
}
