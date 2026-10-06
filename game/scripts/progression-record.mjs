// Records progression traces: a bot plays each archetype on each seed, and every practice event goes to
// tmp/progression/<archetype>-<seed>.jsonl. The first line holds the run, then one trace line per event and one
// economy row per in-game day. A run the player did not survive ends early with a {"end":"death","turn":N} line.
// Beside each trace, <archetype>-<seed>.turns.jsonl holds one line per turn from src/sim/progression/turn-log.ts: the
// truck's state, the hostiles in sight, the money moved and the events that touch the player. <archetype>-<seed>.world.jsonl
// holds every event of every turn raw, and a snapshot of every truck every ten turns.
// Each run is a child process. A run an error stops ends with {"end":"error","turn":N,"message":...}.
// Usage: npm run progression:record -- --archetypes trader,hunter --seeds 1,2,3 --turns 2000
// The markov archetype also needs --markov-turns <k>, the turns it keeps one goal.
// --out <dir> writes the traces to another directory. --patch <file> imports a module before any sim code loads. The
// module changes data numbers in place, such as DISTANCE_PREMIUM.perTile, so a run with the patch is the B side of an
// A/B test. A value a data file derives from another at load time does not follow the patch, so patch it as well. The
// header line records the patch file.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const patchAt = argv.indexOf('--patch');
if (patchAt >= 0) await import(pathToFileURL(resolve(argv[patchAt + 1])).href);
const { TIME } = await import('../src/data/time.ts');
const { isArchetype } = await import('../src/sim/progression/bot.ts');
const { recordTurns } = await import('../src/sim/progression/record.ts');
const { turnLine, worldLine } = await import('../src/sim/progression/turn-log.ts');

const USAGE = 'Usage: npm run progression:record -- --archetypes <a,b> --seeds <1,2> --turns <n> [--markov-turns <k>] [--tolerate-stalls true] [--kit <id>] [--out <dir>] [--patch <file>]';

const args = parseArgs(argv);
if (args.job) recordOne(args.job, args.turns, args.options, args.place);
else await recordAll(args);

function parseArgs(argv) {
  const flags = readFlags(argv);
  const turns = Number(flags.turns);
  if (!Number.isInteger(turns) || turns <= 0) throw new Error(`--turns must be a positive whole number. ${USAGE}`);
  const options = parseOptions(flags);
  const place = { out: flags.out ?? 'tmp/progression', patch: flags.patch ?? null };
  if (flags.job) return { job: parseJob(flags.job), turns, place, options: requireMarkov([parseJob(flags.job).archetype], options) };
  const runs = parseRuns(flags);
  return { ...runs, turns, place, options: requireMarkov(runs.archetypes, options) };
}

// The markov bot keeps a goal for --markov-turns turns. Every other bot ignores it.
function parseOptions(flags) {
  return { ...parseMarkov(flags), ...parseTolerance(flags), ...parseKit(flags) };
}

// --kit <id> starts every run from that start kit, such as combat, instead of standard.
function parseKit(flags) {
  return flags.kit === undefined ? {} : { kit: flags.kit };
}

function parseMarkov(flags) {
  if (flags['markov-turns'] === undefined) return {};
  const markovTurns = Number(flags['markov-turns']);
  if (!Number.isInteger(markovTurns) || markovTurns <= 0) throw new Error(`--markov-turns must be a positive whole number. ${USAGE}`);
  return { markovTurns };
}

// --tolerate-stalls true counts NPC stalls in the economy rows instead of failing the run.
function parseTolerance(flags) {
  if (flags['tolerate-stalls'] === undefined) return {};
  if (flags['tolerate-stalls'] !== 'true') throw new Error(`--tolerate-stalls takes the value true. ${USAGE}`);
  return { tolerateStalls: true };
}

function requireMarkov(archetypes, options) {
  if (archetypes.includes('markov') && options.markovTurns === undefined) throw new Error(`The markov archetype needs --markov-turns <k>. ${USAGE}`);
  return options;
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

// A job is one run, written as <archetype>:<seed>.
function parseJob(text) {
  const [archetype, seedText] = text.split(':');
  if (!isArchetype(archetype)) throw new Error(`Unknown archetype in job ${text}`);
  return { archetype, seed: parseSeed(seedText) };
}

// Runs go one at a time, so a batch never loads more than one core.
async function recordAll({ archetypes, seeds, turns, options, place }) {
  const jobs = archetypes.flatMap((archetype) => seeds.map((seed) => ({ archetype, seed })));
  console.log(`Recording ${jobs.length} runs of ${turns} turns, one at a time`);
  const failed = [];
  for (const job of jobs) {
    const code = await runChild(job, turns, options, place);
    if (code !== 0) failed.push(`${job.archetype}-${job.seed}`);
  }
  if (failed.length > 0) throw new Error(`Runs failed: ${failed.join(', ')}`);
  console.log(`Wrote ${jobs.length} traces to ${place.out}/`);
}

function runChild({ archetype, seed }, turns, options, place) {
  const viteNode = fileURLToPath(new URL('../node_modules/.bin/vite-node', import.meta.url));
  const script = fileURLToPath(import.meta.url);
  const markov = options.markovTurns === undefined ? [] : ['--markov-turns', String(options.markovTurns)];
  const tolerate = options.tolerateStalls ? ['--tolerate-stalls', 'true'] : [];
  const kit = options.kit === undefined ? [] : ['--kit', options.kit];
  const patch = place.patch === null ? [] : ['--patch', place.patch];
  const child = spawn(viteNode, [script, '--', '--job', `${archetype}:${seed}`, '--turns', String(turns), '--out', place.out, ...patch, ...markov, ...tolerate, ...kit], { stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

// Writes one trace, turn by turn, into a part file that becomes the trace only when the run finishes.
function recordOne({ archetype, seed }, turns, options, place) {
  const name = `${archetype}-${seed}`;
  const path = `${place.out}/${name}.jsonl`;
  mkdirSync(place.out, { recursive: true });
  const turnsPath = `${place.out}/${name}.turns.jsonl`;
  const fd = openSync(`${path}.part`, 'w');
  const turnsFd = openSync(`${turnsPath}.part`, 'w');
  const worldPath = `${place.out}/${name}.world.jsonl`;
  const worldFd = openSync(`${worldPath}.part`, 'w');
  const started = Date.now();
  writeSync(fd, `${JSON.stringify({ archetype, seed, turns, ...options, patch: place.patch })}\n`);
  const progress = { count: 0, end: null, lastTurn: 1 };
  try {
    writeSteps({ fd, turnsFd, worldFd }, name, recordTurns(seed, archetype, turns, options), progress);
  } catch (error) {
    // A bot or rule error ends this run with an error marker, so the batch and the report go on without it.
    console.error(error);
    progress.end = { end: 'error', turn: progress.lastTurn, message: error instanceof Error ? error.message : String(error) };
    process.exitCode = 1;
  }
  const { count, end } = progress;
  // A run the player did not survive ends with the death marker.
  if (end) writeSync(fd, `${JSON.stringify(end)}\n`);
  closeSync(fd);
  closeSync(turnsFd);
  closeSync(worldFd);
  renameSync(`${path}.part`, path);
  renameSync(`${turnsPath}.part`, turnsPath);
  renameSync(`${worldPath}.part`, worldPath);
  const ending = end ? `${end.end === 'death' ? 'died' : 'failed'} on turn ${end.turn}` : `${turns} turns`;
  console.log(`${name}: ${ending}, ${count} events in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

// Writes each step's trace lines and rows as it comes, and keeps the count, the death marker and the last turn in
// progress, so an error part way still leaves them.
function writeSteps({ fd, turnsFd, worldFd }, name, steps, progress) {
  for (const step of steps) {
    const { world, lines, rows } = step;
    const written = [...lines, ...rows];
    if (written.length > 0) writeSync(fd, written.map((line) => `${JSON.stringify(line)}\n`).join(''));
    writeSync(turnsFd, `${JSON.stringify(turnLine(world, step.events, step.ledger))}\n`);
    const all = worldLine(world, step.events);
    if (all) writeSync(worldFd, `${JSON.stringify(all)}\n`);
    progress.count += lines.length;
    progress.end = step.death;
    progress.lastTurn = world.turn;
    if ((world.turn - 1) % TIME.turnsPerDay === 0) console.log(`${name}: day ${(world.turn - 1) / TIME.turnsPerDay} done, ${progress.count} events`);
  }
}
