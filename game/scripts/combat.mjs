// Runs the combat harness (src/test/combat-harness.ts) and writes its report to tmp/combat/.
// Usage: npm run combat -- --a merc,merc:snowball --b buggy,buggy:buggy@heavy,buggy+buggy --seeds 1-5
//   [--gap 8] [--orbit 6] [--turns 40] [--arena 15] [--set RULES.leadError=3 --set PARTS.mg.spread=4] [--trace] [--out tmp/combat]
// --a and --b list lineups for the two sides, and every lineup of a fights every lineup of b on every seed. A comma
// separates lineups, and + joins trucks in one lineup. A truck is driver:gear. The driver is an NPC template, whose
// brain drives the truck, or a scripted style that steers the player truck: stand, orbit, charge or kite. The gear is a
// start kit, an NPC template's rolled loadout as template or template@level, or gun/armor+ram on a hauler, with bare
// for no armor. A driver without gear takes its own template's loadout. Hold the driver and vary the gear to tune
// gear; hold the gear and vary the driver to tune behavior.
// --arena <tiles> rings the fight with rocks at that radius, so no driver can run and fights go to a knockout.
// --set changes one balance number for this run. --trace prints one line per turn.
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatReport, parseLineup, runFight, setNumber, turnLine } from '../src/test/combat-harness.ts';
import { initPhysics } from '../src/phys/drive.ts';

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function argsOf(name) {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}

function positiveInt(name, fallback) {
  const n = Number(argOf(name, fallback));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got "${argOf(name, fallback)}"`);
  return n;
}

function parseSeeds(text) {
  const range = /^(\d+)-(\d+)$/.exec(text);
  const seeds = range ? Array.from({ length: +range[2] - +range[1] + 1 }, (_, i) => +range[1] + i) : text.split(',').map(Number);
  for (const s of seeds) if (!Number.isInteger(s)) throw new Error(`--seeds must be a list like 1,2,3 or a range like 1-20, got "${text}"`);
  return seeds;
}

const trace = process.argv.includes('--trace');
const sets = argsOf('set');
for (const s of sets) setNumber(s);
const sideA = argOf('a', 'merc').split(',').map(parseLineup);
const sideB = argOf('b', 'buggy,gunwagon').split(',').map(parseLineup);
const seeds = parseSeeds(argOf('seeds', '1-5'));
const arena = argOf('arena', null);
const base = { gap: positiveInt('gap', '8'), orbit: positiveInt('orbit', '6'), maxTurns: positiveInt('turns', '40'), arena: arena === null ? null : positiveInt('arena') };

await initPhysics();
console.log(`Running ${sideA.length} x ${sideB.length} lineups x ${seeds.length} seeds...`);
const reports = [];
const fights = sideA.flatMap((a) => sideB.flatMap((b) => seeds.map((seed) => ({ ...base, a, b, seed }))));
const label = (f) => `${f.a.map((t) => t.label).join('+')} vs ${f.b.map((t) => t.label).join('+')} s${f.seed}`;
for (const f of fights) reports.push(runFight(f, trace ? (w, t) => console.log(`${label(f)} ${turnLine(w, t)}`) : undefined));

const out = argOf('out', 'tmp/combat');
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/fights.json`, JSON.stringify(reports, null, 2));
const markdown = formatReport(reports, sets);
writeFileSync(`${out}/report.md`, markdown);
console.log(markdown);
