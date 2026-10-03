// The income harness. It plays one policy in the player truck on the mid-game kit, with every skill at level 2,
// through the real turn pipeline with every truck on far travel, and measures what the run earns: net worth per
// in-game hour, a ledger of every money change by reason, per-day net, robbery attempts and NPC wallets. It reads
// prices, repair costs and goals through the sim and keeps no copy of any rule.

import { REGION } from '../../data/region';
import { TIME } from '../../data/time';
import { playerVehicle } from '../damage';
import { getLotTradePrice, partTradePrice, repairCost } from '../economy';
import { goodsCount, isMounted } from '../grid';
import type { GameEvent, PartInstance, Vehicle, World } from '../types';
import type { BotNote, BotTurn, Policy } from './bot';
import { playTurns, startWorld } from './record';

export const INCOME_KIT = 'midgame';
export const INCOME_SKILL_LEVEL = 2;
const HOURS_PER_DAY = 24;

export type TargetKind = 'trader' | 'convoy';

// One demand and what came of it. goodsValue is the sale value of what the bot took while the attempt was the latest
// one. repairSpent is the repair money spent before the next attempt. outcome: pile for a comply, knockout or mercy
// when a refusing driver was knocked out or begged mercy, lost otherwise.
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

// One run. days and hours are what was played, short of the asked days when the player died (death is that turn).
// daily holds the net worth change of each full in-game day. walletsByDay holds the trader and convoy NPC wallets at
// the start and at the end of each full day.
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
};

export function playIncome(seed: number, policy: Policy, days: number): IncomeRun {
  const turns = Math.round(days * TIME.turnsPerDay);
  const start = startWorld(seed, INCOME_KIT, INCOME_SKILL_LEVEL);
  const startWorth = worth(start);
  const ledger: Record<string, number> = {};
  const attempts = new AttemptLog();
  const daily: number[] = [];
  const walletsByDay: Record<TargetKind, number[][]> = { trader: [], convoy: [] };
  sampleWallets(start, walletsByDay);
  let dayStart = startWorth;
  let knockouts = 0;
  let played = 0;
  let last = start;
  for (const { orders, next } of playTurns(start, `seed ${seed} ${policy}`, policy, turns)) {
    for (const entry of orders.money) add(ledger, entry.reason, entry.amount);
    for (const [reason, amount] of pipelineMoney(orders.world, next)) add(ledger, reason, amount);
    attempts.note(orders, next);
    knockouts += next.events.filter((e) => e.t === 'knockout').length;
    played++;
    last = next;
    if (played % TIME.turnsPerDay !== 0) continue;
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
  };
}

// Money plus own goods and spares at the best sale price in any town, less the cost to repair everything.
export function worth(world: World): number {
  const me = playerVehicle(world);
  return world.player.money + saleValue(world, goodsCount(me), spareParts(me)) - repairCost(world);
}

// What these goods and parts sell for: each good as one lot in the town that pays most for it, each part at the
// player's part price.
function saleValue(world: World, goods: Record<string, number>, parts: readonly PartInstance[]): number {
  const me = playerVehicle(world);
  const goodsValue = Object.entries(goods).reduce((sum, [good, n]) => sum + Math.max(...REGION.towns.map((t) => getLotTradePrice(world, me, t.id, good, n, 'sell'))), 0);
  return goodsValue + parts.reduce((sum, part) => sum + partTradePrice(world, me, part, 'sell'), 0);
}

function spareParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [it.part] : []));
}

// Throws unless the ledger sums to the run's money change.
function reconcile(label: string, ledger: Record<string, number>, change: number): void {
  const total = Object.values(ledger).reduce((sum, n) => sum + n, 0);
  if (Math.abs(total - change) > 1e-6) throw new Error(`${label}: the ledger sums to ${total}, but money changed by ${change}`);
}

function add(ledger: Record<string, number>, reason: string, amount: number): void {
  ledger[reason] = (ledger[reason] ?? 0) + amount;
}

// The money the turn pipeline moved for the player, by reason, from the events that pay it. Throws when the events
// do not explain the whole change, so no money moves unnamed.
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

// Tow fees the player earns name the towed driver; the ledger keeps one line for them.
function moneyEvent(e: GameEvent): Paid {
  if (e.t !== 'money') return [];
  return [[e.reason.startsWith('towing ') ? 'towing' : e.reason, e.amount]];
}

function towFee(e: GameEvent, me: string): Paid {
  return e.t === 'towDone' && e.client === me ? [['tow fee', -e.fee]] : [];
}

function escortFee(e: GameEvent, me: string): Paid {
  if (e.t !== 'escortPaid') return [];
  if (e.client === me) return [['escort fee', -e.fee]];
  return e.by === me ? [['escort pay', e.fee]] : [];
}

// The driver always pays the player for aid, whichever way the supplies go.
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

// The attempts of a run. A demand note opens one. Goods taken and repairs paid count toward the latest attempt, and
// a refusing driver knocked out or begging mercy decides its outcome.
class AttemptLog {
  private readonly done: Attempt[] = [];
  private open: Attempt | null = null;

  note(orders: BotTurn, next: World): void {
    for (const note of orders.notes) this.noteBot(orders.world, note);
    for (const entry of orders.money) if (this.open && entry.reason === 'repair') this.open.repairSpent -= entry.amount;
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

// How an event ends a refused demand: the target knocked out, or its plea for mercy granted. Null for other events.
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

// ---- Report.

export function formatIncomeReport(runs: readonly IncomeRun[]): string {
  if (runs.length === 0) throw new Error('No income runs to report');
  const policies = [...new Set(runs.map((r) => r.policy))];
  const seeds = [...new Set(runs.map((r) => r.seed))].sort((a, b) => a - b);
  const lines = [
    '# Income report',
    '',
    `Seeds ${seeds.join(', ')}. Kit ${INCOME_KIT}, every skill at level ${INCOME_SKILL_LEVEL}. Every truck travels far, so physics crashes and rams are absent and fight damage may read low.`,
    '',
    '| Policy | Runs | Days | Net per hour | ± SE | Daily p10 | p50 | p90 | Knockouts | Deaths |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...policies.map((p) => summaryRow(p, runs.filter((r) => r.policy === p))),
  ];
  for (const p of policies) lines.push('', ...policySection(p, runs.filter((r) => r.policy === p)));
  return `${lines.join('\n')}\n`;
}

function netPerHour(run: IncomeRun): number {
  return (run.endWorth - run.startWorth) / run.hours;
}

function summaryRow(policy: Policy, runs: readonly IncomeRun[]): string {
  const rates = runs.map(netPerHour);
  const daily = runs.flatMap((r) => r.daily);
  const tails = daily.length > 0 ? [10, 50, 90].map((q) => fmt(percentile(daily, q))) : ['no full day', '-', '-'];
  const days = runs.reduce((sum, r) => sum + r.days, 0);
  const deaths = runs.filter((r) => r.death !== null).length;
  const knockouts = runs.reduce((sum, r) => sum + r.knockouts, 0);
  return `| ${policy} | ${runs.length} | ${fmt(days)} | ${fmt(mean(rates))} | ${rates.length > 1 ? fmt(standardError(rates)) : 'one run'} | ${tails.join(' | ')} | ${knockouts} | ${deaths} |`;
}

function policySection(policy: Policy, runs: readonly IncomeRun[]): string[] {
  const lines = [`## ${policy}`, '', 'Ledger, mean per run:', ''];
  const reasons = [...new Set(runs.flatMap((r) => Object.keys(r.ledger)))].sort();
  for (const reason of reasons) lines.push(`- ${reason}: ${fmt(mean(runs.map((r) => r.ledger[reason] ?? 0)))}`);
  if (reasons.length === 0) lines.push('- no money moved');
  const attempts = runs.flatMap((r) => r.attempts);
  if (policy === 'robber' || policy === 'convoyRobber') lines.push('', ...attemptSection(attempts));
  lines.push('', ...walletSection(runs));
  return lines;
}

type AttemptGroup = 'trader' | 'guarded convoy' | 'unguarded convoy';

function groupOf(a: Attempt): AttemptGroup {
  if (a.kind === 'trader') return 'trader';
  return a.guarded ? 'guarded convoy' : 'unguarded convoy';
}

function attemptNet(a: Attempt): number {
  return a.goodsValue - a.repairSpent;
}

function attemptSection(attempts: readonly Attempt[]): string[] {
  if (attempts.length === 0) return ['No attempts.'];
  const lines = ['| Target | Attempts | Comply | Fight back | Flee | Pile | Knockout | Mercy | Lost | Mean net per attempt |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const group of ['trader', 'guarded convoy', 'unguarded convoy'] as const) {
    const of = attempts.filter((a) => groupOf(a) === group);
    if (of.length === 0) continue;
    const count = (pred: (a: Attempt) => boolean) => of.filter(pred).length;
    const answers = (['comply', 'fightBack', 'flee'] as const).map((x) => count((a) => a.answer === x));
    const outcomes = (['pile', 'knockout', 'mercy', 'lost'] as const).map((x) => count((a) => a.outcome === x));
    lines.push(`| ${group} | ${of.length} | ${answers.join(' | ')} | ${outcomes.join(' | ')} | ${fmt(mean(of.map(attemptNet)))} |`);
  }
  const losing = attempts.filter((a) => attemptNet(a) < 0).length;
  const hauls = attempts.map((a) => a.goodsValue);
  const total = hauls.reduce((sum, n) => sum + n, 0);
  const failed = attempts.filter((a) => a.outcome === 'lost');
  lines.push(
    '',
    `- Attempts that lost money: ${fmt((100 * losing) / attempts.length)}%`,
    `- Largest haul: ${fmt(Math.max(...hauls))}, ${total > 0 ? `${fmt((100 * Math.max(...hauls)) / total)}% of all robbery takings` : 'no takings'}`,
    `- Mean net of lost attempts: ${failed.length > 0 ? fmt(mean(failed.map(attemptNet))) : 'none lost'}`,
  );
  return lines;
}

function walletSection(runs: readonly IncomeRun[]): string[] {
  const lines = ['NPC wallets by day, p10 / p50 / p90 over all runs (day 0 is the start):', ''];
  for (const kind of ['trader', 'convoy'] as const) {
    const days = Math.max(...runs.map((r) => r.walletsByDay[kind].length));
    const cells = Array.from({ length: days }, (_, d) => {
      const pool = runs.flatMap((r) => r.walletsByDay[kind][d] ?? []);
      return pool.length > 0 ? `day ${d}: ${[10, 50, 90].map((q) => fmt(percentile(pool, q))).join(' / ')}` : `day ${d}: none alive`;
    });
    lines.push(`- ${kind}: ${cells.join('; ')}`);
  }
  return lines;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('Mean of no values');
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function standardError(xs: readonly number[]): number {
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance / xs.length);
}

// The nearest-rank percentile.
function percentile(xs: readonly number[], q: number): number {
  if (xs.length === 0) throw new Error('Percentile of no values');
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1))];
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
