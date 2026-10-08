// Runs the combat harness (src/test/combat-harness.ts) and writes its report to tmp/combat/.
// Usage: npm run combat -- --kit standard --enemies buggy,gunwagon,buggy+buggy --policy all --seeds 1-20
//   [--guns mg,shotgun --armor plates] [--levels poor,loaded] [--foe-gun mg --foe-armor plates --foe-ram plowRam]
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatReport, POLICIES, runFight, setNumber, turnLine } from '../src/test/combat-harness.ts';
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
const policyArg = argOf('policy', 'all');
const policies = policyArg === 'all' ? POLICIES : policyArg.split(',');
for (const p of policies) if (!POLICIES.includes(p)) throw new Error(`Unknown policy "${p}". Known: ${POLICIES.join(', ')}`);
const lineups = argOf('enemies', 'buggy,gunwagon').split(',').map((l) => l.split('+'));
const seeds = parseSeeds(argOf('seeds', '1-10'));
const armor = argOf('armor', null);
const mes = argOf('guns', null)?.split(',').map((gun) => ({ gun, armor })) ?? [null];
const foeGun = argOf('foe-gun', null);
const foe = foeGun ? { gun: foeGun, armor: argOf('foe-armor', null), ram: argOf('foe-ram', undefined) } : null;
const levels = argOf('levels', null)?.split(',') ?? [null];
const base = { kit: argOf('kit', 'standard'), gap: positiveInt('gap', '8'), orbit: positiveInt('orbit', '6'), maxTurns: positiveInt('turns', '40') };

await initPhysics();
console.log(`Running ${mes.length} guns x ${lineups.length} lineups x ${levels.length} levels x ${policies.length} policies x ${seeds.length} seeds...`);
const reports = [];
const fights = mes.flatMap((me) => lineups.flatMap((enemies) => levels.flatMap((level) => policies.flatMap((policy) => seeds.map((seed) => ({ ...base, me, enemies, level, foe, policy, seed }))))));
const label = (f) => `${f.me?.gun ?? 'kit'} ${f.enemies.join('+')} ${f.level ?? 'rolled'} ${f.policy} s${f.seed}`;
for (const f of fights) reports.push(runFight(f, trace ? (w, t) => console.log(`${label(f)} ${turnLine(w, t)}`) : undefined));

const out = argOf('out', 'tmp/combat');
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/fights.json`, JSON.stringify(reports, null, 2));
const markdown = formatReport(reports, sets);
writeFileSync(`${out}/report.md`, markdown);
console.log(markdown);
