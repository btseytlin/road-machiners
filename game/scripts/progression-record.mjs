// Records progression traces: a bot plays each archetype on each seed, and every practice event goes to
// tmp/progression/<archetype>-<seed>.jsonl. The first line holds the run, then one trace line per event. A run the
// player did not survive ends early with a {"end":"death","turn":N} line.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TIME } from '../src/data/time.ts';
import { isArchetype } from '../src/sim/progression/bot.ts';
import { recordTurns } from '../src/sim/progression/record.ts';

const OUT_DIR = 'tmp/progression';
const USAGE = 'Usage: npm run progression:record -- --archetypes <a,b> --seeds <1,2> --turns <n>';

const args = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
if (args.job) recordOne(args.job, args.turns);
else await recordAll(args);

function parseArgs(argv) {
  const flags = readFlags(argv);
  const turns = Number(flags.turns);
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`--turns must be a positive whole number. ${USAGE}`);
  if (flags.job) return { job: parseJob(flags.job), turns };
  return { ...parseRuns(flags), turns };
}

function readFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Bad argument ${name}. ${USAGE}`);
    flags[name.slice(2)] = value;
  }
  return flags;
}

function parseRuns(flags) {
  if (!flags.archetypes || !flags.seeds) throw new Error(`--archetypes and --seeds are required. ${USAGE}`);
  const archetypes = flags.archetypes.split(',');
  for (const a of archetypes) if (!isArchetype(a)) throw new Error(`Unknown archetype ${a}. ${USAGE}`);
  return { archetypes, seeds: flags.seeds.split(',').map(parseSeed) };
}

function parseSeed(text) {
  const seed = Number(text);
  if (!Number.isInteger(seed)) throw new Error(`Seed ${text} is not a whole number`);
  return seed;
}

function parseJob(text) {
  const [archetype, seedText] = text.split(':');
  if (!isArchetype(archetype)) throw new Error(`Unknown archetype in job ${text}`);
  return { archetype, seed: parseSeed(seedText) };
}

async function recordAll({ archetypes, seeds, turns }) {
  const jobs = archetypes.flatMap((archetype) => seeds.map((seed) => ({ archetype, seed })));
  const width = Math.min(jobs.length, availableParallelism());
  console.log(`Recording ${jobs.length} runs of ${turns} turns, ${width} at a time`);
  const failed = [];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: width }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const code = await runChild(job, turns);
      if (code !== 0) failed.push(`${job.archetype}-${job.seed}`);
    }
  }));
  if (failed.length > 0) throw new Error(`Runs failed: ${failed.join(', ')}`);
  console.log(`Wrote ${jobs.length} traces to ${OUT_DIR}/`);
}

function runChild({ archetype, seed }, turns) {
  const viteNode = fileURLToPath(new URL('../node_modules/.bin/vite-node', import.meta.url));
  const script = fileURLToPath(import.meta.url);
  const child = spawn(viteNode, [script, '--', '--job', `${archetype}:${seed}`, '--turns', String(turns)], { stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

function recordOne({ archetype, seed }, turns) {
  const name = `${archetype}-${seed}`;
  const path = `${OUT_DIR}/${name}.jsonl`;
  mkdirSync(OUT_DIR, { recursive: true });
  const fd = openSync(`${path}.part`, 'w');
  const started = Date.now();
  writeSync(fd, `${JSON.stringify({ archetype, seed, turns })}\n`);
  let count = 0;
  let death = null;
  for (const step of recordTurns(seed, archetype, turns)) {
    const { world, lines } = step;
    if (lines.length > 0) writeSync(fd, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
    count += lines.length;
    death = step.death;
    if ((world.turn - 1) % TIME.turnsPerDay === 0) console.log(`${name}: day ${(world.turn - 1) / TIME.turnsPerDay} done, ${count} events`);
  }
  if (death) writeSync(fd, `${JSON.stringify(death)}\n`);
  closeSync(fd);
  renameSync(`${path}.part`, path);
  const ending = death ? `died on turn ${death.turn}` : `${turns} turns`;
  console.log(`${name}: ${ending}, ${count} events in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
