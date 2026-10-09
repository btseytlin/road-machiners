import { statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fingerprint, type Input } from './fingerprint';
import { hasPass, passedFingerprints, recordPass } from './store';

export type RunResult = { test: string; passed: boolean; graphFiles: string[]; reads: string[] };

export function selectTests(root: string, cache: string, key: string, tests: string[]): { run: string[]; skipped: string[] } {
  const states = new Map<string, string>();
  const passed = (test: string) => passedFingerprints(cache, test).some((inputs) => hasPass(cache, test, fingerprint(root, key, inputs, states)));
  const skipped = tests.filter(passed);
  return { run: tests.filter((test) => !skipped.includes(test)), skipped };
}

function kindOf(root: string, path: string): Input['kind'] {
  const stat = statSync(join(root, path), { throwIfNoEntry: false });
  if (!stat) return 'missing';
  return stat.isDirectory() ? 'dir' : 'file';
}

export function inputsOf(root: string, test: string, graphFiles: string[], reads: string[]): Input[] | null {
  const paths = new Set<string>([test]);
  for (const file of [...graphFiles, ...reads]) {
    const rel = relative(root, file);
    if (rel.split(sep).includes('node_modules')) continue;
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    paths.add(rel);
  }
  return [...paths].sort().map((path) => ({ path, kind: kindOf(root, path) }));
}

export function recordRun(root: string, cache: string, key: string, results: RunResult[]): number {
  let uncacheable = 0;
  for (const { test, passed, graphFiles, reads } of results) {
    const inputs = inputsOf(root, test, graphFiles, reads);
    if (!inputs) uncacheable++;
    else if (passed) recordPass(cache, test, fingerprint(root, key, inputs), inputs);
  }
  return uncacheable;
}
