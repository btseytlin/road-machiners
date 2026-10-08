// Replays every trace in tmp/progression/ through the current XP rules and prints, per archetype, the in-game day
// each activity family's earned XP covers the cumulative cost of each rank, its XP per day, and each miss against the
// targets in src/data/skills.ts. It adds the wage per turn at each gear tier, the day each tier is first held, and the
import { createReadStream, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { MAX_RANK, SKILL_IDS } from '../src/data/skills.ts';
import { TIME } from '../src/data/time.ts';
import { UNITS } from '../src/data/units.ts';
import { parseRun, replay, targetMisses, WORTH_KEYS } from '../src/sim/progression/replay.ts';
import { LEDGER_KEYS } from '../src/sim/progression/orders.ts';
import { fightTotals, ledgerTotals, TIERS, tierDays, wageByTier } from '../src/sim/progression/record.ts';

const dirs = process.argv.slice(2).filter((a) => a !== '--');
if (dirs.length > 2) throw new Error('Pass one dir to report on, or two to compare');
const inM = (digits) => (cents) => (cents / UNITS.centsPerM).toFixed(digits);

const sides = [];
for (const dir of dirs.length > 0 ? dirs : ['tmp/progression']) sides.push(await readDir(dir));
if (sides.length === 1) printFull(sides[0]);
else printCompare(sides, dirs);

async function readDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.endsWith('.turns.jsonl') && !f.endsWith('.world.jsonl')).sort();
  if (files.length === 0) throw new Error(`No traces in ${dir}/. Run npm run progression:record first.`);
  const runs = [];
  for (const file of files) runs.push(await readRun(`${dir}/${file}`));
  return runs;
}

function namesOf(runs) {
  return [...new Set(runs.map((r) => r.archetype))];
}

function printFull(runs) {
  for (const archetype of namesOf(runs)) printArchetype(archetype, runs.filter((r) => r.archetype === archetype));
  printSummary(runs);
}

function printSummary(runs) {
  const rows = [['bot', 'runs', 'ended early', 'profit/turn M', 'net worth/turn M', 'vs trader', 'last day', 'knockouts', 'gear lost']];
  for (const a of namesOf(runs)) rows.push(summaryRow(runs, a));
  console.log('\nSummary');
  printTable(rows);
}

function printCompare([a, b], [dirA, dirB]) {
  requireSameRuns(a, b);
  console.log(`A is ${dirA}, B is ${dirB}`);
  const rows = [['bot', 'side', 'runs', 'ended early', 'profit/turn M', 'net worth/turn M', 'vs trader', 'last day', 'knockouts', 'gear lost']];
  for (const name of namesOf(a)) {
    const [, ...rowA] = summaryRow(a, name);
    const [, ...rowB] = summaryRow(b, name);
    rows.push([name, 'A', ...rowA], ['', 'B', ...rowB]);
  }
  console.log('');
  printTable(rows);
  const ledger = [['M per day B-A', ...LEDGER_KEYS]];
  for (const name of namesOf(a)) {
    const perDay = (runs) => ledgerPerDay(runs.filter((r) => r.archetype === name && r.rows.length > 0));
    const [pa, pb] = [perDay(a), perDay(b)];
    ledger.push([name, ...LEDGER_KEYS.map((key) => inM(2)(pb[key] - pa[key]))]);
  }
  console.log('');
  printTable(ledger);
  if (sameNetWorth(a, b)) console.log('\nBoth sides end every run on the same net worth. The patch changed nothing these runs read.');
}

function sameNetWorth(a, b) {
  const ends = (runs) => runs.map((r) => `${r.archetype}-${r.seed}:${r.rows.at(-1)?.netWorth}`).sort().join(',');
  return ends(a) === ends(b);
}

function requireSameRuns(a, b) {
  const key = (runs) => runs.map((r) => `${r.archetype}-${r.seed}`).sort().join(',');
  if (key(a) !== key(b)) throw new Error(`The two sides hold different runs: ${key(a)} against ${key(b)}`);
}

function ledgerPerDay(runs) {
  const each = runs.map((r) => {
    const days = r.rows.reduce((sum, row) => sum + row.turns, 0) / TIME.turnsPerDay;
    const totals = ledgerTotals(r.rows);
    return Object.fromEntries(LEDGER_KEYS.map((key) => [key, totals[key] / days]));
  });
  return Object.fromEntries(LEDGER_KEYS.map((key) => [key, median(each.map((e) => e[key]))]));
}

function summaryRow(runs, archetype) {
  const gainsOf = (name) => runs.filter((r) => r.archetype === name && r.rows.length > 1).map(gainPerTurn);
  const gains = gainsOf(archetype);
  const traderGains = gainsOf('trader');
  const trader = traderGains.length ? median(traderGains) : null;
  const group = runs.filter((r) => r.archetype === archetype);
  const early = group.filter((r) => r.death !== null || r.error !== null).length;
  const totals = group.map((r) => fightTotals(r.rows));
  const ends = group.filter((r) => r.rows.length > 0).map((r) => r.rows[r.rows.length - 1]);
  const profits = group.filter((r) => r.rows.length > 1).map(profitPerTurn);
  const ratio = trader > 0 && gains.length ? (median(gains) / trader).toFixed(2) : '-';
  const lastDay = spreadOrDash(ends.map((row) => row.day), String);
  const money = inM(4);
  return [archetype, String(group.length), String(early), spreadOrDash(profits, money), spreadOrDash(gains, money), ratio, lastDay, spread(totals.map((t) => t.knockouts), String), spread(totals.map((t) => t.gearLost), String)];
}

function spreadOrDash(values, format) {
  return values.length ? spread(values, format) : '-';
}

function profitPerTurn(run) {
  const totals = ledgerTotals(run.rows);
  const turns = run.rows.reduce((sum, row) => sum + row.turns, 0);
  return LEDGER_KEYS.filter((key) => key !== 'gear').reduce((sum, key) => sum + totals[key], 0) / turns;
}

function gainPerTurn(run) {
  const first = run.rows[0];
  const last = run.rows[run.rows.length - 1];
  const turns = run.rows.reduce((sum, row) => sum + row.turns, 0);
  return (last.netWorth - first.netWorth) / turns;
}

async function readRun(path) {
  const run = parseRun(await readValues(path), path);
  const curve = replay(run.trace, run.turns);
  return { ...run, curve, misses: targetMisses(curve, run.archetype, run.turns) };
}

async function readValues(path) {
  const values = [];
  for await (const text of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (text) values.push(JSON.parse(text));
  return values;
}

function printArchetype(archetype, group) {
  const seeds = group.map((r) => r.seed).join(', ');
  const days = group.map((r) => Number((r.turns / TIME.turnsPerDay).toFixed(1)));
  console.log(`\n${archetype}: ${group.length} seeds (${seeds}), ${Math.min(...days)} to ${Math.max(...days)} days`);
  printEndings(group);
  printSkills(group);
  printEconomy(group);
}

function printEndings(group) {
  const deaths = group.map((r) => r.death).filter((turn) => turn !== null);
  console.log(deaths.length === 0 ? 'No deaths' : `Died in ${deaths.length} of ${group.length} seeds, on turn ${spread(deaths, String)}`);
  for (const r of group) if (r.error) console.log(`Seed ${r.seed} failed on turn ${r.error.turn}: ${r.error.message.split('\n')[0]}`);
}

function printSkills(group) {
  const levels = Array.from({ length: MAX_RANK }, (_, i) => `R${i + 1}`);
  const rows = [['skill', ...levels.map((l) => `${l} day`), 'XP/day']];
  for (const skill of SKILL_IDS) {
    const curves = group.map((r) => r.curve[skill]);
    const cells = levels.map((_, i) => levelCell(curves.map((c) => c.levels[i]), group.length));
    rows.push([skill, ...cells, spread(curves.map((c) => c.perDay), (n) => n.toFixed(0))]);
  }
  printTable(rows);
  for (const run of group) for (const miss of run.misses) console.log(`  seed ${run.seed}: ${miss}`);
  if (group.every((run) => run.misses.length === 0)) console.log('  all targets met');
}

function printEconomy(group) {
  const withRows = group.filter((r) => r.rows.length > 0);
  if (withRows.length === 0) return console.log('\nNo economy rows in these traces');
  const wages = withRows.map((r) => wageByTier(r.rows));
  const days = withRows.map((r) => tierDays(r.rows));
  const rows = [['gear tier', 'wage/turn M', 'first day']];
  for (const tier of TIERS) rows.push([`tier ${tier}`, spreadOrNone(wages.map((w) => w[tier]), inM(4)), spreadOrNone(days.map((d) => d[tier]), String)]);
  console.log('');
  printTable(rows);
  const ends = [['seed', 'chassis', 'net worth M', 'won', 'knockouts', 'gear lost', 'deaths', 'stalls']];
  for (const r of withRows) {
    const last = r.rows[r.rows.length - 1];
    const totals = fightTotals(r.rows);
    ends.push([String(r.seed), last.chassis, inM(0)(last.netWorth), ...[totals.fightsWon, totals.knockouts, totals.gearLost, totals.deaths, totals.stalls].map(String)]);
  }
  console.log('');
  printTable(ends);
  printNetWorth(withRows);
  printLedger(withRows);
}

function printNetWorth(group) {
  const last = Math.max(...group.map((r) => r.rows[r.rows.length - 1].day));
  const days = [0, 1, 3, 5, 10, 15, 20, 30].filter((d) => d <= last);
  const rows = [['day', ...days.map(String)]];
  const cell = (d, pick) => spreadOrNone(group.map((r) => {
    const row = r.rows.find((x) => x.day === d);
    return row ? pick(row) : null;
  }), inM(0));
  rows.push(['net worth M', ...days.map((d) => cell(d, (row) => row.netWorth))]);
  for (const key of WORTH_KEYS) rows.push([`  ${key}`, ...days.map((d) => cell(d, (row) => row.worth[key]))]);
  console.log('');
  printTable(rows);
}

function printLedger(group) {
  const totals = group.map((r) => ({ days: r.rows.reduce((sum, row) => sum + row.turns, 0) / TIME.turnsPerDay, ledger: ledgerTotals(r.rows) }));
  const rows = [['M per day', ...LEDGER_KEYS]];
  rows.push(['median', ...LEDGER_KEYS.map((key) => spread(totals.map((t) => t.ledger[key] / t.days), inM(2)))]);
  console.log('');
  printTable(rows);
}

function spreadOrNone(values, format) {
  const reached = values.filter((v) => v !== null);
  return reached.length === 0 ? 'never' : `${spread(reached, format)}${reached.length === values.length ? '' : ` [${reached.length}/${values.length}]`}`;
}

function levelCell(turns, seeds) {
  const reached = turns.filter((t) => t !== null);
  if (reached.length === 0) return 'never';
  const cell = spread(reached, (t) => (t / TIME.turnsPerDay).toFixed(1));
  return reached.length === seeds ? cell : `${cell} [${reached.length}/${seeds}]`;
}

function spread(values, format) {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return min === max ? format(median(sorted)) : `${format(median(sorted))} (${format(min)}-${format(max)})`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function printTable(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  for (const row of rows) console.log(row.map((cell, col) => cell.padEnd(widths[col])).join('  '));
}
