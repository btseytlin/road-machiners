// The income harness. It plays one policy in the player truck on the mid-game kit, with every skill at rank 2,
// through the real turn pipeline with every truck on far travel, and measures what the run earns: net worth per
// in-game hour, a ledger of every money change by reason, per-day net, robbery attempts and NPC wallets. It reads

import { REGION } from '../../data/region';
import { TIME } from '../../data/time';
import { playerVehicle } from '../damage';
import { getLotTradePrice, partTradePrice, repairCost } from '../economy';
import { goodsCount, isMounted } from '../grid';
import type { GameEvent, GoalReason, MoneyReason, PartInstance, Vehicle, World } from '../types';
import { getTradePrice } from '../economy';
import { isDefeated } from '../defeat';
import { npcProfile } from '../npc-decisions';
import { escortsOf } from '../tow';
import { SHOPS } from '../../data/market';
import { haulMarginAt, wouldRob, type Policy } from './bot';
import { LEDGER_KEYS, type BotNote, type BotTurn } from './orders';
import { playTurns, startWorld } from './record';

export const INCOME_KIT = 'midgame';
export const INCOME_SKILL_RANK = 2;
const INCOME_BOT = { noGear: true };
const HOURS_PER_DAY = 24;
export const SAMPLE_TURNS = 30;
export const INDEX_SPEND = 2000;
export const INDEX_ROOM = 20;

export type TargetKind = 'trader' | 'convoy';

export type Attempt = {
  turn: number;
  target: string;
  kind: TargetKind;
  guarded: boolean;
  answer: 'comply' | 'fightBack' | 'flee';
  outcome: 'pile' | 'knockout' | 'mercy' | 'lost';
  goodsValue: number;
  repairSpent: number;
};

export type TargetSample = { kind: TargetKind; guarded: boolean; qualifies: boolean; cargoValue: number; wallet: number; boughtGoods: number };

export type WorldSample = { turn: number; haulIndex: number; salvageIndex: number; targets: TargetSample[] };

export type IncomeRun = {
  seed: number;
  policy: Policy;
  days: number;
  hours: number;
  startWorth: number;
  endWorth: number;
  ledger: Record<string, number>;
  daily: number[];
  attempts: Attempt[];
  knockouts: number;
  death: number | null;
  walletsByDay: Record<TargetKind, number[][]>;
  samples: WorldSample[];
  npcKnockoutsByDay: number[];
  towsByDay: number[];
  candidate: string;
  commit: string;
};

export type RunLabel = { candidate: string; commit: string };

export function playIncome(seed: number, policy: Policy, days: number, label: RunLabel): IncomeRun {
  const turns = Math.round(days * TIME.turnsPerDay);
  const start = startWorld(seed, INCOME_KIT, INCOME_SKILL_RANK);
  const startWorth = worth(start);
  const ledger: Record<string, number> = {};
  const attempts = new AttemptLog();
  const daily: number[] = [];
  const walletsByDay: Record<TargetKind, number[][]> = { trader: [], convoy: [] };
  sampleWallets(start, walletsByDay);
  const samples = [sampleWorld(start)];
  const npcKnockoutsByDay: number[] = [];
  const towsByDay: number[] = [];
  let dayKnockouts = 0;
  let dayTows = 0;
  let dayStart = startWorth;
  let knockouts = 0;
  let played = 0;
  let last = start;
  for (const { orders, next } of playTurns(start, `seed ${seed} ${policy}`, policy, turns, INCOME_BOT)) {
    addCommands(ledger, orders);
    for (const [reason, amount] of pipelineMoney(orders.world, next)) add(ledger, reason, amount);
    attempts.note(orders, next);
    knockouts += next.events.filter((e) => e.t === 'knockout').length;
    dayKnockouts += next.events.filter((e) => e.t === 'npcKnockout').length;
    dayTows += next.events.filter((e) => e.t === 'towHitched').length;
    played++;
    last = next;
    if (played % SAMPLE_TURNS === 0) samples.push(sampleWorld(next));
    if (played % TIME.turnsPerDay !== 0) continue;
    npcKnockoutsByDay.push(dayKnockouts);
    towsByDay.push(dayTows);
    dayKnockouts = 0;
    dayTows = 0;
    daily.push(worth(next) - dayStart);
    dayStart = worth(next);
    sampleWallets(next, walletsByDay);
  }
  reconcile(`seed ${seed} ${policy}`, ledger, last.player.money - start.player.money);
  return {
    seed,
    policy,
    days: played / TIME.turnsPerDay,
    hours: (played * HOURS_PER_DAY) / TIME.turnsPerDay,
    startWorth,
    endWorth: worth(last),
    ledger,
    daily,
    attempts: attempts.close(),
    knockouts,
    death: last.player.state === 'dead' ? last.turn : null,
    walletsByDay,
    samples,
    npcKnockoutsByDay,
    towsByDay,
    ...label,
  };
}

export function sampleWorld(world: World): WorldSample {
  const targets = world.vehicles.flatMap((v) => {
    const kind = templateKind(v);
    return kind && v.resources && !isDefeated(v) ? [targetSample(world, v, kind)] : [];
  });
  return { turn: world.turn, haulIndex: haulMarginAt(world, INDEX_SPEND, INDEX_ROOM), salvageIndex: salvageIndex(world), targets };
}

function templateKind(v: Vehicle): TargetKind | null {
  const id = v.brain?.templateId;
  return id === 'trader' || id === 'convoy' ? id : null;
}

function targetSample(world: World, v: Vehicle, kind: TargetKind): TargetSample {
  const guarded = escortsOf(world, v.id).some((e) => !isDefeated(e));
  const boughtGoods = v.brain!.goals[0]?.reason === DELIVER_REASON ? cargoUnits(v) : 0;
  return { kind, guarded, qualifies: wouldRob(world, v), cargoValue: saleValue(world, goodsCount(v), spareParts(v)), wallet: v.resources!.money, boughtGoods };
}

export function largestTraderLoad(world: World): number {
  const trader = world.vehicles.find((v) => v.brain?.templateId === 'trader');
  if (!trader) throw new Error('No trader to price a load for');
  const me = playerVehicle(world);
  const shops = Object.values(SHOPS);
  const ratios = shops.flatMap((source) => shops.filter((b) => b.id !== source.id).flatMap((buyer) =>
    source.goods.filter((good) => buyer.goods.includes(good)).map((good) => getTradePrice(world, me, buyer.id, good, 'sell') / getTradePrice(world, trader, source.id, good, 'buy'))));
  return npcProfile(trader).tradeStake * Math.max(...ratios);
}

// The goal line of a trader's base goal while it carries the load it bought, from src/sim/npc-activities.ts.
const DELIVER_REASON: GoalReason = 'deliverCargo';

function cargoUnits(v: Vehicle): number {
  return Object.entries(goodsCount(v)).reduce((sum, [good, n]) => sum + (good === 'parts' ? 0 : n), 0);
}

function salvageIndex(world: World): number {
  const me = playerVehicle(world);
  const prices = REGION.towns.flatMap((t) => {
    const shop = SHOPS[t.id];
    if (!shop) throw new Error(`Town ${t.id} has no shop`);
    return shop.goods.map((good) => getTradePrice(world, me, t.id, good, 'sell'));
  });
  return prices.reduce((sum, p) => sum + p, 0) / prices.length;
}

export function worth(world: World): number {
  const me = playerVehicle(world);
  return world.player.money + saleValue(world, goodsCount(me), spareParts(me)) - repairCost(world);
}

function saleValue(world: World, goods: Record<string, number>, parts: readonly PartInstance[]): number {
  const me = playerVehicle(world);
  const goodsValue = Object.entries(goods).reduce((sum, [good, n]) => sum + Math.max(...REGION.towns.map((t) => getLotTradePrice(world, me, t.id, good, n, 'sell'))), 0);
  return goodsValue + parts.reduce((sum, part) => sum + partTradePrice(world, me, part, 'sell'), 0);
}

function spareParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [it.part] : []));
}

function reconcile(label: string, ledger: Record<string, number>, change: number): void {
  const total = Object.values(ledger).reduce((sum, n) => sum + n, 0);
  if (Math.abs(total - change) > 1e-6) throw new Error(`${label}: the ledger sums to ${total}, but money changed by ${change}`);
}

function addCommands(ledger: Record<string, number>, orders: BotTurn): void {
  for (const key of LEDGER_KEYS) if (orders.ledger[key] !== 0) add(ledger, key, orders.ledger[key]);
}

function add(ledger: Record<string, number>, reason: string, amount: number): void {
  ledger[reason] = (ledger[reason] ?? 0) + amount;
}

function pipelineMoney(before: World, after: World): [string, number][] {
  const me = before.player.vehicleId;
  const paid = after.events.flatMap((e) => eventMoney(e, me));
  const change = after.player.money - before.player.money;
  const explained = paid.reduce((sum, [, n]) => sum + n, 0);
  if (Math.abs(explained - change) > 1e-6) throw new Error(`Turn ${before.turn}: the player's money changed by ${change}, but its events explain ${explained}`);
  return paid;
}

type Paid = [string, number][];

function eventMoney(e: GameEvent, me: string): Paid {
  return [moneyEvent, towFee, escortFee, aidPay, patchFee].flatMap((pays) => pays(e, me));
}

// The ledger line of each money reason. Tow fees the player earns from any driver share one line.
const LEDGER_LINES: Record<MoneyReason['kind'], string> = { contract: 'contract', failedHaul: 'failed haul contract', towing: 'towing' };

function moneyEvent(e: GameEvent): Paid {
  if (e.t !== 'money') return [];
  return [[LEDGER_LINES[e.reason.kind], e.amount]];
}

function towFee(e: GameEvent, me: string): Paid {
  return e.t === 'towDone' && e.client === me ? [['tow fee', -e.fee]] : [];
}

function escortFee(e: GameEvent, me: string): Paid {
  if (e.t !== 'escortPaid') return [];
  if (e.client === me) return [['escort fee', -e.fee]];
  return e.by === me ? [['escort pay', e.fee]] : [];
}

function aidPay(e: GameEvent, me: string): Paid {
  return e.t === 'aid' && (e.giver === me || e.receiver === me) ? [['aid', e.paid]] : [];
}

function patchFee(e: GameEvent, me: string): Paid {
  if (e.t !== 'stateEnded' || e.ending !== 'fulfilled' || e.state.data.kind !== 'patch') return [];
  if (e.state.other === me) return [['patch fee', -e.state.data.price]];
  return e.state.holder === me ? [['patch pay', e.state.data.price]] : [];
}

function sampleWallets(world: World, wallets: Record<TargetKind, number[][]>): void {
  for (const kind of ['trader', 'convoy'] as const) {
    wallets[kind].push(world.vehicles.flatMap((v) => (v.brain?.templateId === kind && v.resources ? [v.resources.money] : [])));
  }
}

class AttemptLog {
  private readonly done: Attempt[] = [];
  private open: Attempt | null = null;

  note(orders: BotTurn, next: World): void {
    for (const note of orders.notes) this.noteBot(orders.world, note);
    if (this.open) this.open.repairSpent -= orders.ledger.repairs;
    for (const e of [...orders.events, ...next.events]) this.noteEvent(e, orders.world.player.vehicleId);
  }

  close(): Attempt[] {
    if (this.open) this.done.push(this.open);
    this.open = null;
    return this.done;
  }

  private noteBot(world: World, note: BotNote): void {
    if (note.kind === 'demand') {
      this.close();
      this.open = { turn: world.turn, target: note.target, kind: targetKind(world, note.target), guarded: note.guarded, answer: note.answer, outcome: note.answer === 'comply' ? 'pile' : 'lost', goodsValue: 0, repairSpent: 0 };
    } else if (this.open) {
      this.open.goodsValue += saleValue(world, note.goods, note.parts);
    }
  }

  private noteEvent(e: GameEvent, me: string): void {
    const open = this.open;
    if (open?.outcome === 'lost') open.outcome = refusalEnd(e, open.target, me) ?? 'lost';
  }
}

function refusalEnd(e: GameEvent, target: string, me: string): Attempt['outcome'] | null {
  if (e.t === 'npcKnockout' && e.vehicle === target) return 'knockout';
  return e.t === 'plea' && grantedMercy(e, target, me) ? 'mercy' : null;
}

function grantedMercy(e: Extract<GameEvent, { t: 'plea' }>, target: string, me: string): boolean {
  return e.from === target && e.to === me && e.plea === 'mercy' && e.accepted === true;
}

function targetKind(world: World, id: string): TargetKind {
  const v = world.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`Robbery target ${id} is gone`);
  if (v.faction === 'traders') return 'trader';
  if (v.faction === 'convoys') return 'convoy';
  throw new Error(`Robbery target ${id} is of faction ${v.faction}`);
}

