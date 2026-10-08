// Runs the stuck soak (src/test/stuck-soak.ts) for each seed in its own process, writes tmp/stuck/seed-<n>.txt and
// exits 1 on any stall or error.
// Usage: npm run stuck -- [--seeds 1-3] [--turns 1000]
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

const turns = Number(argOf('turns', '1000'));
if (!Number.isInteger(turns) || turns <= 0) throw new Error(`--turns must be a positive integer, got "${argOf('turns')}"`);
const one = argOf('seed', null);

if (one !== null) {
  const { soak, formatSoak } = await import('../src/test/stuck-soak.ts');
  const report = soak(Number(one), turns);
  writeFileSync(`tmp/stuck/seed-${one}.txt`, formatSoak([report]));
  process.exit(report.stalls.length > 0 || report.error ? 1 : 0);
}

mkdirSync('tmp/stuck', { recursive: true });
const seeds = parseSeeds(argOf('seeds', '1-3'));
const codes = await Promise.all(seeds.map((seed) => new Promise((resolve) => {
  const child = spawn('npx', ['vite-node', 'scripts/stuck.mjs', '--', '--seed', String(seed), '--turns', String(turns)], { stdio: 'inherit' });
  child.on('exit', resolve);
})));
for (const seed of seeds) console.log(`${readFileSync(`tmp/stuck/seed-${seed}.txt`, 'utf8')}\n`);
const failed = codes.some((c) => c !== 0);
console.log(failed ? 'Stuck soak FAILED' : 'Stuck soak clean');
process.exit(failed ? 1 : 0);
