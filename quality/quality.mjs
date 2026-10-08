import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEPARATOR, checkFragmentation, checkGuidance, checkSeparators, collectComponents, inspectSource, isGuidance } from './quality-policy.mjs';

const root = process.cwd();
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const ignoredPattern = /(?:^|\/)(?:node_modules|dist|tmp|\.worktrees|\.pi|\.playtest|\.agents|\.claude)\//;
const typeProjects = ['game', 'factory', 'factory/dashboard'];
const browserPaths = /^factory\/(?:dashboard|src\/dashboard)\//;
const maxBuffer = 64 * 1024 * 1024; // Bounds captured Git and linter output, including the repo-wide baseline.

function runGit(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer });
}

function splitPaths(output) {
  return output.split('\0').filter(Boolean);
}

function readHeadFiles() {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) return splitPaths(runGit('ls-tree', '-rz', '--name-only', 'HEAD'));
  const ref = runGit('symbolic-ref', 'HEAD').trim();
  const missing = spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: root });
  if (missing.status !== 1) throw new Error(result.stderr);
  return [];
}

// The commits a merge in progress brings in. Their code is not new debt, since the gate passed it on their own branch.
function readMergeHeads() {
  const file = path.resolve(root, runGit('rev-parse', '--git-path', 'MERGE_HEAD').trim());
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

function readParents() {
  const head = { ref: 'HEAD', files: readHeadFiles() };
  const merged = readMergeHeads().map(ref => ({ ref, files: splitPaths(runGit('ls-tree', '-rz', '--name-only', ref)) }));
  return [head, ...merged];
}

function selectSources(files) {
  return [...new Set(files)].filter(file => sourcePattern.test(file) && !ignoredPattern.test(file));
}

function readSources(directory, files) {
  return new Map(files.map(file => [file, readFileSync(path.join(directory, file), 'utf8')]));
}

function readGuidance(directory, files) {
  const docs = files.filter(file => isGuidance(file) && !ignoredPattern.test(file));
  return readSources(directory, docs.filter(file => !lstatSync(path.join(directory, file)).isSymbolicLink()));
}

// Text files holding the separator, found by git grep, which skips binary files. Staged mode searches the index.
function readSeparatorFiles(directory, staged) {
  const result = spawnSync('git', ['grep', staged ? '--cached' : '--untracked', '-lzIF', '-e', SEPARATOR], { cwd: root, encoding: 'utf8', maxBuffer });
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || 'git grep failed.');
  const files = splitPaths(result.stdout).filter(file => !ignoredPattern.test(file) && existsSync(path.join(directory, file)));
  return readSources(directory, files);
}

function writeSources(directory, sources) {
  for (const [file, source] of sources) {
    const destination = path.join(directory, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
}

function runLint(directory, files, config) {
  if (!files.length) return [];
  const executable = fileURLToPath(new URL('./bin/oxlint', import.meta.resolve('oxlint/package.json')));
  const result = spawnSync(process.execPath, [executable, '--config', config, '--format', 'json', '--', ...files.map(file => `./${file}`)], { cwd: directory, encoding: 'utf8', maxBuffer });
  return readLintReport(result);
}

function readLintReport(result) {
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Oxlint stopped: ${result.signal}`);
  const report = JSON.parse(result.stdout);
  if (!Array.isArray(report.diagnostics)) throw new Error('Oxlint returned no diagnostics array.');
  if (result.status !== 0 && !report.diagnostics.length) throw new Error(`Oxlint failed without diagnostics. ${result.stderr}`);
  return report.diagnostics;
}

function collectFindings(directory, sources, config) {
  const findings = runLint(directory, [...sources.keys()], config);
  for (const [file, source] of sources) findings.push(...inspectSource(file, source).findings);
  return findings;
}

function describeFinding(finding) {
  const structural = new Set(['eslint(complexity)', 'eslint(max-depth)', 'eslint(max-lines)', 'eslint(max-lines-per-function)']);
  let message = finding.message;
  let size = 0;
  if (structural.has(finding.code)) {
    const match = message.match(/(complexity of |too many lines \(|too deeply \()(\d+)/);
    if (!match) throw new Error(`Unrecognized structural diagnostic: ${message}`);
    size = Number(match[2]);
    message = message.replace(match[0], `${match[1]}<size>`);
  }
  const key = JSON.stringify([finding.filename.replace(/^\.\//, ''), finding.code, message]);
  return { key, size };
}

function findRegressions(current, previous) {
  const remaining = new Map();
  for (const finding of previous) {
    const { key, size } = describeFinding(finding);
    const sizes = remaining.get(key) ?? [];
    sizes.push(size);
    remaining.set(key, sizes.sort((a, b) => a - b));
  }
  return current.filter(finding => {
    const { key, size } = describeFinding(finding);
    const sizes = remaining.get(key) ?? [];
    const index = sizes.findIndex(previousSize => previousSize >= size);
    if (index === -1) return true;
    sizes.splice(index, 1);
    return false;
  });
}

function readParentSources(parent, baseline, config) {
  const sources = new Map(selectSources(parent.files).map(file => [file, runGit('show', `${parent.ref}:${file}`)]));
  mkdirSync(baseline, { recursive: true });
  writeSources(baseline, sources);
  const baselineConfig = path.join(baseline, '.oxlintrc.json');
  copyFileSync(config, baselineConfig);
  return { sources, findings: collectFindings(baseline, sources, baselineConfig) };
}

// A merge passes when each finding and each component is no worse than in one of its parents. A normal commit has HEAD alone.
function checkQuality(directory, baseline, files, parents, staged) {
  const current = readSources(directory, selectSources(files));
  const config = path.join(directory, '.oxlintrc.json');
  const previous = parents.map((parent, index) => readParentSources(parent, path.join(baseline, String(index)), config));
  const currentFindings = collectFindings(directory, current, config);
  const regressions = previous.map(parent => new Set(findRegressions(currentFindings, parent.findings)));
  const findings = currentFindings.filter(finding => regressions.every(set => set.has(finding)));
  const { maxFilesPerKloc, maxGuidanceWords } = JSON.parse(readFileSync(path.join(directory, '.quality.json'), 'utf8'));
  const fragmented = previous.map(parent => checkFragmentation(current, collectComponents(parent.sources), maxFilesPerKloc));
  const failures = fragmented[0].filter(failure => fragmented.every(list => list.some(other => componentOf(other) === componentOf(failure))));
  failures.push(...checkGuidance(readGuidance(directory, files), maxGuidanceWords));
  failures.push(...checkSeparators(readSeparatorFiles(directory, staged)));
  for (const finding of findings) console.error(`${finding.filename}: ${finding.code} ${finding.message}`);
  for (const failure of failures) console.error(failure);
  if (findings.length + failures.length) throw new Error('Quality regressed against HEAD. Fix the code. Do not weaken the checks.');
}

function componentOf(failure) {
  return failure.slice(0, failure.indexOf(':'));
}

// A project with no node_modules of its own, like factory/dashboard, resolves packages from its parent folder.
function linkModules(directory, project) {
  const installed = path.join(root, project, 'node_modules');
  const modules = path.join(directory, project, 'node_modules');
  if (directory !== root && existsSync(installed) && !existsSync(modules)) symlinkSync(installed, modules);
}

function checkTypes(directory) {
  const compiler = fileURLToPath(new URL('./bin/tsc', import.meta.resolve('typescript/package.json')));
  for (const project of typeProjects) {
    linkModules(directory, project);
    const result = spawnSync(process.execPath, [compiler, '--project', path.join(directory, project, 'tsconfig.json')], { cwd: path.join(directory, project), stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Typecheck failed in ${project}.`);
  }
}

// A commit that touches the dashboard or its server side runs the page against fixtures in the Playwright image, so a stale page fails the commit.
// The image tag follows the installed Playwright version. Missing Docker or Playwright fails the commit and never skips the test.
function mount(source, target, readonly) {
  return ['--mount', `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`];
}

// The snapshot holds symlinks to the real node_modules, which dangle inside the container. Each one becomes an empty folder with the real one mounted over it.
function mountModules(directory) {
  return ['game', 'factory'].flatMap(project => {
    const mountPoint = path.join(directory, project, 'node_modules');
    rmSync(mountPoint, { recursive: true, force: true });
    mkdirSync(mountPoint, { recursive: true });
    return mount(path.join(root, project, 'node_modules'), `/work/${project}/node_modules`, true);
  });
}

function readPlaywrightVersion() {
  const manifest = path.join(root, 'game/node_modules/playwright/package.json');
  if (!existsSync(manifest) || !existsSync(path.join(root, 'factory/node_modules'))) throw new Error('The dashboard browser test needs Playwright and the factory packages. Run npm ci in game/ and factory/.');
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

function checkDashboardBrowser(directory) {
  if (!splitPaths(runGit('diff', '--cached', '--name-only', '-z')).some(file => browserPaths.test(file))) return;
  const version = readPlaywrightVersion();
  const evidence = path.join(root, 'tmp/browser-evidence');
  mkdirSync(evidence, { recursive: true });
  const args = ['run', '--rm', '--init', '--network', 'none', '--memory', '2g', '--cpus', '2', '--shm-size', '512m',
    ...mount(directory, '/work', true), ...mountModules(directory), ...mount(evidence, '/evidence', false), '--workdir', '/work',
    `mcr.microsoft.com/playwright:v${version}-noble`, 'node', 'factory/dashboard/browser.test.mjs', '/work/game/node_modules/playwright/index.mjs', '/evidence'];
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer });
  if (result.error) throw new Error(`The dashboard browser test needs Docker: ${result.error.message}`);
  const log = path.join(root, 'tmp/browser-check.log');
  writeFileSync(log, result.stdout + result.stderr);
  if (result.status === 0) return;
  console.error((result.stdout + result.stderr).split('\n').slice(-40).join('\n'));
  throw new Error('The dashboard browser test failed. The full output is in tmp/browser-check.log.');
}

function assertStagedTooling() {
  const changed = splitPaths(runGit('diff', '--name-only', '-z'));
  const tooling = new Set(['.oxlintrc.json', '.quality.json', 'package.json', 'package-lock.json', 'quality/quality.mjs', 'quality/quality-policy.mjs']);
  const unstaged = changed.filter(file => tooling.has(file));
  if (unstaged.length) throw new Error(`Stage or restore quality tooling before committing: ${unstaged.join(', ')}`);
}

function runChecks() {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--staged')) throw new Error('Usage: node quality/quality.mjs [--staged]');
  const staged = args.includes('--staged');
  if (staged) assertStagedTooling();
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const temporary = mkdtempSync(path.join(root, 'tmp/quality-'));
  try {
    checkSnapshot(staged, temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function checkSnapshot(staged, temporary) {
  const directory = staged ? path.join(temporary, 'index') : root;
  if (staged) runGit('checkout-index', '--all', `--prefix=${directory}/`);
  const tracked = splitPaths(runGit('ls-files', '--cached', '-z'));
  const others = staged ? [] : splitPaths(runGit('ls-files', '--others', '--exclude-standard', '-z'));
  const files = [...tracked, ...others].filter(file => existsSync(path.join(directory, file)));
  checkQuality(directory, path.join(temporary, 'parents'), files, readParents(), staged);
  checkTypes(directory);
  if (staged) checkDashboardBrowser(directory);
}

runChecks();
console.log('Quality checks passed.');
