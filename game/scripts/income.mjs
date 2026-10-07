// Runs the income harness (src/sim/progression/income.ts): one child process per seed and policy, up to --jobs at a
// time. Each child writes <out>/<seed>-<policy>.json, and the parent writes <out>/report.md from all of them. Both go
// through a temp file and a rename, so a killed run leaves no half-written file. A run whose JSON already exists for
// the same build is skipped, so a batch picks up where it stopped.
// Usage: npm run income -- [--seeds 1,2,3 or 1-6] [--days 2] [--policy robber,convoyRobber,trader,scavenger] [--jobs 3]
//   [--candidate A] [--out tmp/income/<candidate>]
// Report only: npm run income -- --report tmp/income/A[,tmp/income/A2] --baseline tmp/income/baseline
// writes the run tables and the gate report to the first directory's report.md.
// A turn takes about half a second, so a day (450 turns) takes about 4 minutes per seed and policy. --days may be
// fractional for a smoke run.
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function parseSeeds(text) {
  const range = /^(\d+)-(\d+)$/.exec(text);
  const seeds = range ? Array.from({ length: +range[2] - +range[1] + 1 }, (_, i) => +range[1] + i) : text.split(',').map(Number);
  for (const s of seeds) if (!Number.isInteger(s)) throw new Error(`--seeds must be a list like 1,2,3 or a range like 1-3, got "${text}"`);
  return seeds;
}

function writeAtomic(path, text) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

// The build a run measures: the last commit that changed game code, outside tests and this harness in
// src/sim/progression/, and a hash of any uncommitted change to it, so a candidate diff left in a worktree reads as its
// own build. A fix to what the harness samples leaves the build the runs measured unchanged.
function buildId() {
  const paths = "src ':(exclude)src/**/*.test.ts' ':(exclude)src/sim/progression/**'";
  const commit = execSync(`git log -1 --format=%h -- ${paths}`, { encoding: 'utf8' }).trim();
  const diff = execSync(`git diff HEAD -- ${paths}`, { encoding: 'utf8' });
  return diff === '' ? commit : `${commit}+${createHash('sha1').update(diff).digest('hex').slice(0, 8)}`;
}

function readRuns(dir) {
  return readdirSync(dir).filter((f) => /^\d+-\w+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
}

const report = argOf('report', null);
if (report !== null) {
  const { formatIncomeReport, gateReport } = await import('../src/sim/progression/income-report.ts');
  const { INCOME_KIT, INCOME_SKILL_RANK, largestTraderLoad } = await import('../src/sim/progression/income.ts');
  const { startWorld } = await import('../src/sim/progression/record.ts');
  const dirs = report.split(',');
  const runs = dirs.flatMap(readRuns);
  const baselineDir = argOf('baseline', null);
  const baseline = baselineDir ? readRuns(baselineDir) : [];
  const load = largestTraderLoad(startWorld(1, INCOME_KIT, INCOME_SKILL_RANK));
  writeAtomic(`${dirs[0]}/report.md`, `${gateReport(runs, baseline, load)}\n${formatIncomeReport(runs)}`);
  console.log(readFileSync(`${dirs[0]}/report.md`, 'utf8'));
  process.exit(0);
}

const days = Number(argOf('days', '2'));
if (!(days > 0)) throw new Error(`--days must be a positive number, got "${argOf('days')}"`);
const candidate = argOf('candidate', 'A');
const out = argOf('out', `tmp/income/${candidate}`);
const one = argOf('seed', null);

if (one !== null) {
  const { playIncome } = await import('../src/sim/progression/income.ts');
  const { isPolicy } = await import('../src/sim/progression/bot.ts');
  const policy = argOf('policy', null);
  if (!policy || !isPolicy(policy)) throw new Error(`Unknown policy "${policy}"`);
  const seed = Number(one);
  const started = Date.now();
  const run = playIncome(seed, policy, days, { candidate, commit: argOf('commit', null) ?? buildId() });
  writeAtomic(`${out}/${seed}-${policy}.json`, JSON.stringify(run));
  console.log(`seed ${seed} ${policy}: ${run.hours.toFixed(1)} in-game hours in ${((Date.now() - started) / 1000).toFixed(0)} s, net ${(run.endWorth - run.startWorth).toFixed(0)}`);
  process.exit(0);
}

const { isPolicy } = await import('../src/sim/progression/bot.ts');
const seeds = parseSeeds(argOf('seeds', '1-6'));
const policies = argOf('policy', 'robber,convoyRobber,trader,scavenger').split(',');
for (const p of policies) if (!isPolicy(p)) throw new Error(`Unknown policy "${p}"`);
const jobs = Number(argOf('jobs', '3'));
if (!Number.isInteger(jobs) || jobs <= 0) throw new Error(`--jobs must be a positive integer, got "${argOf('jobs')}"`);
const commit = buildId();

mkdirSync(out, { recursive: true });
const done = (seed, policy) => {
  const path = `${out}/${seed}-${policy}.json`;
  if (!existsSync(path)) return false;
  const run = JSON.parse(readFileSync(path, 'utf8'));
  if (run.commit !== commit || run.candidate !== candidate || run.days < days) throw new Error(`${path} measured ${run.candidate} at ${run.commit} over ${run.days} days, not ${candidate} at ${commit}; move it away first`);
  return true;
};
const tasks = seeds.flatMap((seed) => policies.map((policy) => ({ seed, policy }))).filter((t) => !done(t.seed, t.policy));
console.log(`${candidate} at ${commit}: ${tasks.length} runs to play into ${out}`);

function runChild({ seed, policy }) {
  return new Promise((resolve) => {
    const args = ['vite-node', 'scripts/income.mjs', '--', '--seed', String(seed), '--policy', policy, '--days', String(days), '--candidate', candidate, '--out', out, '--commit', commit];
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve({ seed, policy, code }));
  });
}

const results = [];
let next = 0;
async function worker() {
  while (next < tasks.length) results.push(await runChild(tasks[next++]));
}
await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker));

const failed = results.filter((r) => r.code !== 0);
for (const f of failed) console.error(`seed ${f.seed} ${f.policy} failed with exit code ${f.code}`);
if (failed.length > 0) process.exit(1);

const { formatIncomeReport } = await import('../src/sim/progression/income-report.ts');
writeAtomic(`${out}/report.md`, formatIncomeReport(readRuns(out)));
console.log(readFileSync(`${out}/report.md`, 'utf8'));
