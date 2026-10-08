// The income report: the per-policy tables of income runs, and the gate report the tuning of issue 157 set before
// any run. Every threshold is a named constant here, and no gate is judged on runs of mixed builds.

import { INCOME_KIT, INCOME_SKILL_RANK, type Attempt, type IncomeRun } from './income';
import type { Policy } from './bot';

export function formatIncomeReport(runs: readonly IncomeRun[]): string {
  if (runs.length === 0) throw new Error('No income runs to report');
  const policies = [...new Set(runs.map((r) => r.policy))];
  const seeds = [...new Set(runs.map((r) => r.seed))].sort((a, b) => a - b);
  const lines = [
    '# Income report',
    '',
    `Seeds ${seeds.join(', ')}. Kit ${INCOME_KIT}, every skill at rank ${INCOME_SKILL_RANK}. Every truck travels far, so physics crashes and rams are absent and fight damage may read low.`,
    '',
    '| Policy | Runs | Days | Net per hour | ± SE | Daily p10 | p50 | p90 | Knockouts | Deaths |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...policies.map((p) => summaryRow(p, runs.filter((r) => r.policy === p))),
  ];
  for (const p of policies) lines.push('', ...policySection(p, runs.filter((r) => r.policy === p)));
  return `${lines.join('\n')}\n`;
}

export function netPerHour(run: IncomeRun): number {
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

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('Mean of no values');
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function standardError(xs: readonly number[]): number {
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance / xs.length);
}

function percentile(xs: readonly number[], q: number): number {
  if (xs.length === 0) throw new Error('Percentile of no values');
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1))];
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export const G1_BAND: readonly [number, number] = [1.05, 1.5];
export const G2_FLOOR = 0.85;
export const G3_MIN_ATTEMPTS = 8;
export const G3_MIN_LOSING = 0.3;
export const G4_P90_RATIO = 2;
export const G6_FLOOR = 0.7;
export const G7_RATIO = 1.5;
export const PICK_TARGET = 1.25;

const T80: Record<number, number> = { 1: 3.078, 2: 1.886, 3: 1.638, 4: 1.533, 5: 1.476, 6: 1.44, 7: 1.415, 8: 1.397, 9: 1.383, 10: 1.372, 11: 1.363 };

export type PairedDifference = { seeds: number[]; meanDiff: number; ci80: [number, number]; ratio: number };

export function pairedDifference(robber: readonly IncomeRun[], hauler: readonly IncomeRun[]): PairedDifference {
  sameBuild('G1', [...robber, ...hauler]);
  const seeds = robber.map((r) => r.seed).sort((a, b) => a - b);
  const haulSeeds = hauler.map((r) => r.seed).sort((a, b) => a - b);
  if (seeds.length !== new Set(seeds).size || seeds.join() !== haulSeeds.join()) throw new Error(`Unpaired seeds: robber ${seeds.join()} and hauler ${haulSeeds.join()}`);
  const diffs = seeds.map((s) => netPerHour(runOf(robber, s)) - netPerHour(runOf(hauler, s)));
  const t = T80[diffs.length - 1];
  if (t === undefined) throw new Error(`No 80% t quantile for ${diffs.length} pairs`);
  const meanDiff = mean(diffs);
  const half = t * standardError(diffs);
  return { seeds, meanDiff, ci80: [meanDiff - half, meanDiff + half], ratio: mean(robber.map(netPerHour)) / mean(hauler.map(netPerHour)) };
}

function runOf(runs: readonly IncomeRun[], seed: number): IncomeRun {
  const run = runs.find((r) => r.seed === seed);
  if (!run) throw new Error(`No run on seed ${seed}`);
  return run;
}

function sameBuild(gate: string, runs: readonly IncomeRun[]): void {
  const builds = [...new Set(runs.map((r) => `${r.candidate} at ${r.commit}`))];
  if (builds.length > 1) throw new Error(`${gate} mixes builds: ${builds.join(', ')}`);
}

export type WorldFigures = { V: number; T: number; H: number };

export function worldFigures(runs: readonly IncomeRun[]): WorldFigures {
  const samples = runs.flatMap((r) => r.samples);
  if (samples.length === 0) throw new Error('No world samples');
  const qualifying = samples.map((s) => s.targets.filter((t) => t.qualifies));
  const values = qualifying.flat().map((t) => t.cargoValue);
  return { V: values.length > 0 ? mean(values) : 0, T: mean(qualifying.map((q) => q.length)), H: mean(samples.map((s) => s.haulIndex)) };
}

export type Prediction = WorldFigures & { predictedRatio: number };

export function predictCandidate(runsA: readonly IncomeRun[], runsC: readonly IncomeRun[]): Prediction {
  const a = worldFigures(runsA.filter((r) => r.policy === 'trader'));
  const c = worldFigures(runsC.filter((r) => r.policy === 'trader'));
  if (a.V === 0 || a.T === 0) throw new Error('Candidate A has no target the robber would take');
  const robber = mean(runsA.filter((r) => r.policy === 'robber').map(netPerHour)) * (c.V / a.V) * (c.T / a.T);
  const hauler = mean(runsA.filter((r) => r.policy === 'trader').map(netPerHour)) * (c.H / a.H);
  return { ...c, predictedRatio: robber / hauler };
}

type Gate = { id: string; title: string; pass: boolean | null; lines: string[] };

export function gateReport(runs: readonly IncomeRun[], baseline: readonly IncomeRun[], largestLoad: number): string {
  sameBuild('The gate report', runs);
  sameBuild('The baseline', baseline);
  const of = (p: Policy, rs: readonly IncomeRun[] = runs) => rs.filter((r) => r.policy === p);
  const gates = [gateG1(of('robber'), of('trader')), gateG2(runs, baseline, of), gateG3(of('convoyRobber')), gateG4(of('robber'), of('trader'), largestLoad), gateG5([...of('robber'), ...of('convoyRobber')]), gateG6(runs), gateG7(runs, baseline)];
  const lines = ['# Gate report', '', `Build ${buildOf(runs)}, baseline ${buildOf(baseline)}.`, '', '| Gate | Result |', '| --- | --- |'];
  for (const g of gates) lines.push(`| ${g.id} ${g.title} | ${verdict(g)} |`);
  for (const g of gates) lines.push('', `## ${g.id} ${g.title}: ${verdict(g)}`, '', ...g.lines);
  return `${lines.join('\n')}\n`;
}

function buildOf(runs: readonly IncomeRun[]): string {
  return runs.length > 0 ? `${runs[0].candidate} at ${runs[0].commit}` : 'none';
}

function verdict(g: Gate): string {
  if (g.pass === null) return 'open';
  return g.pass ? 'pass' : 'miss';
}

function gateG1(robber: readonly IncomeRun[], hauler: readonly IncomeRun[]): Gate {
  const title = 'Robbery is modestly best';
  if (robber.length === 0 || hauler.length === 0) return { id: 'G1', title, pass: null, lines: ['No robber or hauler runs.'] };
  const paired = pairedDifference(robber, hauler);
  const [lo, hi] = paired.ci80;
  const lines = [
    ...seedTable(paired.seeds, robber, hauler),
    '',
    rateLine('Robber', paired.seeds, robber),
    rateLine('Hauler', paired.seeds, hauler),
    `- Paired difference over ${paired.seeds.length} seeds: mean ${fmt(paired.meanDiff)}, 80% interval [${fmt(lo)}, ${fmt(hi)}]${lo <= 0 && hi >= 0 ? ', which includes 0' : ''}`,
    `- Ratio of means: ${paired.ratio.toFixed(2)} against [${G1_BAND.join(', ')}]`,
  ];
  return { id: 'G1', title, pass: paired.ratio >= G1_BAND[0] && paired.ratio <= G1_BAND[1], lines };
}

function seedTable(seeds: readonly number[], robber: readonly IncomeRun[], hauler: readonly IncomeRun[]): string[] {
  const rows = seeds.map((s) => {
    const [r, h] = [netPerHour(runOf(robber, s)), netPerHour(runOf(hauler, s))];
    return `| ${s} | ${fmt(r)} | ${fmt(h)} | ${fmt(r - h)} |`;
  });
  return ['| Seed | Robber net/h | Hauler net/h | Difference |', '| --- | --- | --- | --- |', ...rows];
}

function rateLine(name: string, seeds: readonly number[], runs: readonly IncomeRun[]): string {
  const r = seeds.map((s) => netPerHour(runOf(runs, s)));
  return `- ${name}: mean ${fmt(mean(r))}, median ${fmt(percentile(r, 50))}, SE ${r.length > 1 ? fmt(standardError(r)) : 'one run'}`;
}

function gateG2(runs: readonly IncomeRun[], baseline: readonly IncomeRun[], of: (p: Policy, rs?: readonly IncomeRun[]) => IncomeRun[]): Gate {
  const title = 'Legitimate routes stay useful';
  const index = (rs: readonly IncomeRun[], key: 'haulIndex' | 'salvageIndex') => mean(rs.flatMap((r) => r.samples.map((s) => s[key])));
  if (baseline.length === 0) return { id: 'G2', title, pass: null, lines: ['No baseline runs.'] };
  const n = (rs: readonly IncomeRun[]) => rs.reduce((sum, r) => sum + r.samples.length, 0);
  const shares = (['haulIndex', 'salvageIndex'] as const).map((key) => ({ key, build: index(runs, key), base: index(baseline, key) }));
  const lines = shares.map((s) => `- ${s.key}: ${fmt(s.build)} against baseline ${fmt(s.base)}, ${fmt((100 * s.build) / s.base)}% (floor ${100 * G2_FLOOR}%), from ${n(runs)} and ${n(baseline)} samples`);
  for (const p of ['trader', 'scavenger'] as const) {
    const build = of(p).map(netPerHour);
    const base = of(p, baseline).map(netPerHour);
    lines.push(`- ${p} net per hour: ${build.length > 0 ? `${fmt(mean(build))} over ${build.length} runs` : 'no runs'}, baseline ${base.length > 0 ? `${fmt(mean(base))} over ${base.length} runs` : 'no runs'}`);
  }
  return { id: 'G2', title, pass: shares.every((s) => s.build >= G2_FLOOR * s.base), lines };
}

function gateG3(runs: readonly IncomeRun[]): Gate {
  const title = 'Guarded convoys are a real risk';
  const guarded = runs.flatMap((r) => r.attempts).filter((a) => a.kind === 'convoy' && a.guarded);
  const lines = [`- ${guarded.length} guarded convoy attempts over ${runs.length} convoyRobber runs (need ${G3_MIN_ATTEMPTS})`];
  if (guarded.length === 0) return { id: 'G3', title, pass: false, lines };
  const count = (pred: (a: Attempt) => boolean) => guarded.filter(pred).length;
  const losing = count((a) => attemptNet(a) < 0) / guarded.length;
  const net = mean(guarded.map(attemptNet));
  lines.push(
    `- Answers: comply ${count((a) => a.answer === 'comply')}, fight back ${count((a) => a.answer === 'fightBack')}, flee ${count((a) => a.answer === 'flee')}`,
    `- Outcomes: pile ${count((a) => a.outcome === 'pile')}, knockout ${count((a) => a.outcome === 'knockout')}, mercy ${count((a) => a.outcome === 'mercy')}, lost ${count((a) => a.outcome === 'lost')}`,
    `- Mean net per attempt ${fmt(net)}, ${fmt(100 * losing)}% lost money (target: positive mean, at least ${100 * G3_MIN_LOSING}% losing)`,
  );
  return { id: 'G3', title, pass: guarded.length >= G3_MIN_ATTEMPTS && net > 0 && losing >= G3_MIN_LOSING, lines };
}

function gateG4(robber: readonly IncomeRun[], hauler: readonly IncomeRun[], largestLoad: number): Gate {
  const title = 'No outsized jackpots';
  const haulDays = hauler.flatMap((r) => r.daily);
  const robDays = robber.flatMap((r) => r.daily);
  const hauls = robber.flatMap((r) => r.attempts).map((a) => a.goodsValue);
  if (haulDays.length === 0 || robDays.length === 0) return { id: 'G4', title, pass: null, lines: ['No full robber or hauler days.'] };
  const perDay = mean(hauler.map((r) => (r.endWorth - r.startWorth) / r.days));
  const largest = hauls.length > 0 ? Math.max(...hauls) : 0;
  const p90 = [percentile(robDays, 90), percentile(haulDays, 90)];
  const lines = [
    `- Hauler mean net per day: ${fmt(perDay)} over ${hauler.length} runs`,
    `- Most one trader load sells for: ${fmt(largestLoad)}`,
    `- Largest single haul: ${fmt(largest)} over ${hauls.length} attempts`,
    `- Daily p90: robber ${fmt(p90[0])} over ${robDays.length} days, hauler ${fmt(p90[1])} over ${haulDays.length} days (bound ${G4_P90_RATIO}x)`,
  ];
  return { id: 'G4', title, pass: largestLoad <= perDay && largest <= perDay && p90[0] <= G4_P90_RATIO * p90[1], lines };
}

function gateG5(runs: readonly IncomeRun[]): Gate {
  const title = 'Failure costs';
  const lost = runs.flatMap((r) => r.attempts).filter((a) => a.outcome === 'lost');
  if (lost.length === 0) return { id: 'G5', title, pass: null, lines: ['No lost attempts.'] };
  const net = mean(lost.map(attemptNet));
  return { id: 'G5', title, pass: net < 0, lines: [`- ${lost.length} lost attempts over ${runs.length} runs, mean net ${fmt(net)}`] };
}

function gateG6(runs: readonly IncomeRun[]): Gate {
  const title = 'Steady traders';
  const day = (d: number) => runs.flatMap((r) => r.walletsByDay.trader[d] ?? []);
  const [one, two] = [day(1), day(2)];
  if (one.length === 0 || two.length === 0) return { id: 'G6', title, pass: null, lines: ['No trader wallets at the end of day 1 and day 2.'] };
  const [m1, m2] = [percentile(one, 50), percentile(two, 50)];
  const lines = [`- Median trader wallet: day 0 ${fmt(percentile(day(0), 50))}, day 1 ${fmt(m1)} (${one.length} wallets), day 2 ${fmt(m2)} (${two.length} wallets), ${fmt((100 * m2) / m1)}% (floor ${100 * G6_FLOOR}%)`];
  return { id: 'G6', title, pass: m2 >= G6_FLOOR * m1, lines };
}

function gateG7(runs: readonly IncomeRun[], baseline: readonly IncomeRun[]): Gate {
  const title = 'The world stays sane';
  const perDay = (rs: readonly IncomeRun[]) => mean(rs.flatMap((r) => r.npcKnockoutsByDay.map((k, d) => k + r.towsByDay[d])));
  const days = (rs: readonly IncomeRun[]) => rs.reduce((sum, r) => sum + r.npcKnockoutsByDay.length, 0);
  const lines = ['- The stuck run on seeds 1 to 6 is judged outside this report.'];
  if (baseline.length === 0 || days(runs) === 0 || days(baseline) === 0) return { id: 'G7', title, pass: null, lines: [...lines, '- No full days to compare.'] };
  const [build, base] = [perDay(runs), perDay(baseline)];
  lines.push(`- NPC knockouts and tows per day: ${fmt(build)} over ${days(runs)} run-days, baseline ${fmt(base)} over ${days(baseline)} (bound ${G7_RATIO}x)`);
  return { id: 'G7', title, pass: build <= G7_RATIO * base, lines };
}
