// Runs the income harness (src/sim/progression/income.ts): one child process per seed and policy, up to --jobs at a
// time. Each child writes tmp/income/<seed>-<policy>.json, and the parent writes tmp/income/report.md from all of
// them. Both go through a temp file and a rename, so a killed run leaves no half-written file.
// Usage: npm run income -- [--seeds 1,2,3 or 1-6] [--days 5] [--policy robber,convoyRobber,trader,scavenger] [--jobs 3]
// A turn takes about half a second, so 5 days (2250 turns) take about 20 minutes per seed and policy. --days may be
// fractional for a smoke run.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const OUT = 'tmp/income';

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

const days = Number(argOf('days', '5'));
if (!(days > 0)) throw new Error(`--days must be a positive number, got "${argOf('days')}"`);
const one = argOf('seed', null);

if (one !== null) {
  const { playIncome } = await import('../src/sim/progression/income.ts');
  const { isPolicy } = await import('../src/sim/progression/bot.ts');
  const policy = argOf('policy', null);
  if (!policy || !isPolicy(policy)) throw new Error(`Unknown policy "${policy}"`);
  const seed = Number(one);
  const started = Date.now();
  const run = playIncome(seed, policy, days);
  writeAtomic(`${OUT}/${seed}-${policy}.json`, JSON.stringify(run));
  console.log(`seed ${seed} ${policy}: ${run.hours.toFixed(1)} in-game hours in ${((Date.now() - started) / 1000).toFixed(0)} s, net ${(run.endWorth - run.startWorth).toFixed(0)}`);
  process.exit(0);
}

const { isPolicy } = await import('../src/sim/progression/bot.ts');
const seeds = parseSeeds(argOf('seeds', '1-6'));
const policies = argOf('policy', 'robber,convoyRobber,trader,scavenger').split(',');
for (const p of policies) if (!isPolicy(p)) throw new Error(`Unknown policy "${p}"`);
const jobs = Number(argOf('jobs', '3'));
if (!Number.isInteger(jobs) || jobs <= 0) throw new Error(`--jobs must be a positive integer, got "${argOf('jobs')}"`);

mkdirSync(OUT, { recursive: true });
const tasks = seeds.flatMap((seed) => policies.map((policy) => ({ seed, policy })));

function runChild({ seed, policy }) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['vite-node', 'scripts/income.mjs', '--', '--seed', String(seed), '--policy', policy, '--days', String(days)], { stdio: 'inherit' });
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

const { formatIncomeReport } = await import('../src/sim/progression/income.ts');
const runs = tasks.map(({ seed, policy }) => JSON.parse(readFileSync(`${OUT}/${seed}-${policy}.json`, 'utf8')));
writeAtomic(`${OUT}/report.md`, formatIncomeReport(runs));
console.log(readFileSync(`${OUT}/report.md`, 'utf8'));
