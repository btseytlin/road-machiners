// Plays one progression run and writes its full activity log: every game event, snapshots of the player and every NPC,
// how the run ended and a summary. The release playtest of the factory reads it. See src/sim/progression/activity.ts.
// The log goes to a part file that becomes the log only when the run ends. An in-game error or stall ends the log
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { activityFrom } from '../src/sim/progression/activity.ts';
import { isArchetype } from '../src/sim/progression/bot.ts';
import { startWorld } from '../src/sim/progression/record.ts';

const USAGE = 'Usage: npm run progression:playthrough -- --seed <n> --turns <n> --out <file> [--archetype mixed] [--every 50] [--sha <sha>]';

const options = parseArgs(process.argv.slice(2).filter((a) => a !== '--'));
write(options);

function parseArgs(argv) {
  const flags = readFlags(argv);
  const archetype = flags.archetype ?? 'mixed';
  if (!isArchetype(archetype)) throw new Error(`Unknown archetype ${archetype}. ${USAGE}`);
  if (!flags.out) throw new Error(`--out is required. ${USAGE}`);
  return { seed: whole(flags.seed, 'seed'), turns: positive(flags.turns, 'turns'), every: positive(flags.every ?? '50', 'every'), archetype, sha: flags.sha ?? null, out: flags.out };
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

function whole(text, name) {
  const n = Number(text);
  if (text === undefined || !Number.isInteger(n)) throw new Error(`--${name} must be a whole number. ${USAGE}`);
  return n;
}

function positive(text, name) {
  const n = whole(text, name);
  if (n <= 0) throw new Error(`--${name} must be positive. ${USAGE}`);
  return n;
}

function write({ out, ...run }) {
  mkdirSync(dirname(out), { recursive: true });
  const fd = openSync(`${out}.part`, 'w');
  const started = Date.now();
  let last = null;
  for (const line of activityFrom(startWorld(run.seed), run)) {
    writeSync(fd, `${JSON.stringify(line)}\n`);
    if (line.k === 'end') last = line;
  }
  closeSync(fd);
  renameSync(`${out}.part`, out);
  console.log(`seed ${run.seed} ${run.archetype}: ${last.reason} at turn ${last.turn} in ${((Date.now() - started) / 1000).toFixed(0)} s, log ${out}`);
}
