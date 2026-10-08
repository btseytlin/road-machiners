// Runs the game tests and skips every test file whose imports, disk reads and global inputs already passed.
// Usage: npm run test:cached -- --cache <dir> [test file filters]. Without --cache it runs every file and records nothing.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createVitest } from 'vitest/node';
import { globalKey } from '../src/test/cache/fingerprint';
import { recordRun, selectTests } from '../src/test/cache/select';
import { testId } from '../src/test/cache/store';

const root = process.cwd();

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--');
  const at = args.indexOf('--cache');
  if (at === -1) return { cache: undefined, filters: args };
  const dir = args[at + 1];
  if (!dir || dir.startsWith('--')) throw new Error('--cache needs a folder.');
  return { cache: resolve(dir), filters: args.filter((_, i) => i !== at && i !== at + 1) };
}

function importsOf(project, file) {
  const seen = new Set();
  const stack = [...(project.vite.moduleGraph.getModulesByFile(file) ?? [])];
  while (stack.length) {
    const mod = stack.pop();
    if (!mod.file || seen.has(mod.file)) continue;
    seen.add(mod.file);
    stack.push(...(mod.ssrImportedModules ?? mod.importedModules));
  }
  return [...seen];
}

function readsOf(readsDir, test) {
  const file = join(readsDir, `${testId(test)}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`No recorded disk reads for ${test} at ${file}: ${error.message}`);
  }
}

const { cache, filters } = parseArgs(process.argv.slice(2));
mkdirSync(join(root, 'tmp'), { recursive: true });
const readsDir = mkdtempSync(join(root, 'tmp', 'test-cache-reads-'));
process.env.TEST_CACHE_READS = readsDir;
let failed = false;
const vitest = await createVitest('test', { watch: false });
try {
  vitest.projects[0].config.setupFiles.push(resolve(root, 'src/test/cache/reads-setup.ts'));
  await vitest.init();
  const specs = await vitest.globTestSpecifications(filters);
  const key = globalKey(root, vitest.vite.config.define ?? {}, process.env);
  const relOf = (spec) => relative(root, spec.moduleId);
  const tests = specs.map(relOf);
  const { run, skipped } = cache ? selectTests(root, cache, key, tests) : { run: tests, skipped: [] };
  const selected = specs.filter((spec) => run.includes(relOf(spec)));
  let uncacheable = 0;
  if (selected.length) {
    const { testModules, unhandledErrors } = await vitest.runTestSpecifications(selected);
    failed = unhandledErrors.length > 0 || testModules.some((mod) => mod.state() !== 'passed' && mod.state() !== 'skipped');
    if (cache) {
      const results = testModules.filter((mod) => mod.state() === 'passed').map((mod) => {
        const test = relative(root, mod.moduleId);
        return { test, passed: true, graphFiles: importsOf(mod.project, mod.moduleId), reads: readsOf(readsDir, test) };
      });
      uncacheable = recordRun(root, cache, key, results);
    }
  }
  console.log(`[test-cache] ran ${run.length}, skipped ${skipped.length}, uncacheable ${uncacheable}`);
} finally {
  await vitest.close();
  rmSync(readsDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
