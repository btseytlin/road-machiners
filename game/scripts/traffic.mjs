// Runs the traffic speed harness (src/test/traffic-speed.ts) for each seed in its own process. Writes
// tmp/traffic/<layer>-seed-<n>.json per seed and the merged report tmp/traffic/<layer>.md, and prints the report.
// Usage: npm run traffic -- [--seeds 1-3] [--turns 300] [--layer physics|far]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

const layer = argOf('layer', 'physics');
if (layer !== 'physics' && layer !== 'far') throw new Error(`--layer must be physics or far, got "${layer}"`);
const turns = Number(argOf('turns', '300'));
if (!Number.isInteger(turns) || turns <= 0) throw new Error(`--turns must be a positive integer, got "${argOf('turns')}"`);
const one = argOf('seed', null);
const seedFile = (seed) => `tmp/traffic/${layer}-seed-${seed}.json`;

if (one !== null) {
  if (layer === 'physics') {
    const { PERF } = await import('../src/data/perf.ts');
    const { PHYSICS } = await import('../src/data/physics.ts');
    PERF.liveMargin = 1e6;
    PHYSICS.propLiveMargin = 1e6;
  }
  const { recordTraffic } = await import('../src/test/traffic-speed.ts');
  writeFileSync(seedFile(one), JSON.stringify(await recordTraffic(Number(one), turns, layer)));
  process.exit(0);
}

mkdirSync('tmp/traffic', { recursive: true });
const seeds = parseSeeds(argOf('seeds', '1-3'));
const codes = await Promise.all(seeds.map((seed) => new Promise((resolve) => {
  const child = spawn('npx', ['vite-node', 'scripts/traffic.mjs', '--', '--seed', String(seed), '--turns', String(turns), '--layer', layer], { stdio: 'inherit' });
  child.on('exit', resolve);
})));
if (codes.some((c) => c !== 0)) throw new Error(`a traffic seed failed: exit codes ${codes.join(', ')}`);
const { summarize, formatTraffic } = await import('../src/test/traffic-speed.ts');
const report = formatTraffic([summarize(seeds.map((seed) => JSON.parse(readFileSync(seedFile(seed), 'utf8'))))]);
writeFileSync(`tmp/traffic/${layer}.md`, `${report}\n`);
console.log(report);
