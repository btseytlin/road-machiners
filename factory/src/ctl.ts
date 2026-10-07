import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DROP_QUEUES, isGated, resolveActor, writeControl, type ControlAction, type DropQueue } from './control';
import { pauseFile, pausedReason } from './pause';
import { MOVE_TARGETS, cardDrift, cardPosition, releaseDrift, runningJobs, type MoveTarget } from './position';
import { readState, updateState } from './state';
import { STUCK_LABEL, type Card, type Ctx, type FactoryState, type PlaytestState, type ReleaseState } from './types';

// The dashboard refuses a browser agent, so the CLI uses the same agent Hermes' status tool uses.
const SNAPSHOT_AGENT = 'curl/8.0';
// A job log runs to thousands of lines. Fifty lines hold the failing step, and Hermes asks the log path for more.
const LOG_TAIL_LINES = 50;
// Every pause made by `factory pause` starts with this text, so `resume` lifts only its own.
const PAUSE_PREFIX = 'Paused with factory pause:';

type Handler = (ctx: Ctx, args: string[]) => Promise<void> | void;
// Builds the action from the positional arguments, and throws on a bad one.
type Builder = (args: string[]) => ControlAction;

const READ: Record<string, { usage: string; help: string; run: Handler }> = {
  status: { usage: 'status', help: 'print the factory snapshot the dashboard shows', run: status },
  cards: { usage: 'cards', help: 'list every open card with its position and labels', run: cards },
  card: { usage: 'card N', help: 'print one card across every store, and each store that disagrees', run: card },
  jobs: { usage: 'jobs', help: 'list the running jobs', run: jobs },
  queues: { usage: 'queues', help: 'list the pending queues', run: queues },
  release: { usage: 'release', help: 'print the open release', run: release },
  failures: { usage: 'failures', help: 'list the recent failed jobs', run: failures },
  log: { usage: 'log N [stage]', help: 'print the tail of the newest log of a card', run: log },
  audit: { usage: 'audit', help: 'print each drift between stores, and nothing when all agree', run: audit },
  help: { usage: 'help', help: 'list the commands', run: help },
};

const IMMEDIATE: Record<string, { usage: string; help: string; run: Handler }> = {
  retry: { usage: 'retry N [decision]', help: 'remove the stuck label and the failures of a card. On the release tracking card it also lifts a playtest block, gives the playtest its runs back and keeps the decision for its next review', run: retry },
  pause: { usage: 'pause <reason>', help: 'pause the factory', run: pause },
  resume: { usage: 'resume', help: 'remove the pause', run: resume },
};

const WRITE: Record<string, { usage: string; help: string; build: Builder }> = {
  move: { usage: 'move N <to>', help: `put a card in one of ${MOVE_TARGETS.join(', ')}`, build: ([n, to]) => ({ action: 'move', issue: number(n), to: target(to) }) },
  merge: { usage: 'merge N', help: 'merge a card into its base now', build: ([n]) => ({ action: 'merge', issue: number(n) }) },
  ship: { usage: 'ship', help: 'ship the open release now', build: () => ({ action: 'ship' }) },
  cut: { usage: 'cut', help: 'cut a release now', build: () => ({ action: 'cut' }) },
  remove: { usage: 'remove N', help: 'take a feature out of the release', build: ([n]) => ({ action: 'remove', issue: number(n) }) },
  drop: { usage: `drop <${DROP_QUEUES.join('|')}> <id>`, help: 'drop one queued entry', build: ([queue, id]) => dropAction(queue, id) },
  'merge-change': { usage: 'merge-change <id>', help: 'merge a factory change PR into main', build: ([id]) => ({ action: 'merge-change', id: number(id) }) },
};

export async function runCtl(ctx: Ctx, args: string[]): Promise<void> {
  const [command = '', ...rest] = args;
  if (Object.hasOwn(READ, command)) return READ[command].run(ctx, rest);
  if (Object.hasOwn(IMMEDIATE, command)) return IMMEDIATE[command].run(ctx, rest);
  if (Object.hasOwn(WRITE, command)) return writeCommand(ctx, command, rest);
  throw new Error(`Unknown command "${command}". Run "factory help" for the commands.`);
}

function help(): void {
  const rows = [
    ...Object.values(READ).map((row) => [row.usage, row.help]),
    ...Object.values(WRITE).map((row) => [`${row.usage} --by <who> --reason <why>`, `${row.help}. Applies on the next tick.`]),
    ...Object.values(IMMEDIATE).map((row) => [row.usage, row.help]),
  ];
  for (const [usage, text] of rows) console.log(`${usage}: ${text}`);
}

function number(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`"${value}" is not an issue number or id.`);
  return n;
}

function target(value: string | undefined): MoveTarget {
  if (!MOVE_TARGETS.includes(value as MoveTarget)) throw new Error(`Unknown position "${value}". Use one of ${MOVE_TARGETS.join(', ')}.`);
  return value as MoveTarget;
}

function dropAction(queue: string | undefined, id: string | undefined): ControlAction {
  if (!DROP_QUEUES.includes(queue as DropQueue)) throw new Error(`Unknown queue "${queue}". Use one of ${DROP_QUEUES.join(', ')}.`);
  return { action: 'drop', queue: queue as DropQueue, id: queue === 'ship' && id === undefined ? null : number(id) };
}

// Takes `--name value` out of the arguments. Returns the value and the rest.
function takeFlag(args: string[], name: string): { value: string; rest: string[] } {
  const at = args.indexOf(name);
  const value = args[at + 1];
  if (at < 0 || value === undefined || value.startsWith('--')) throw new Error(`Missing ${name}. Every write command needs --by and --reason.`);
  return { value, rest: args.filter((_, i) => i !== at && i !== at + 1) };
}

function writeCommand(ctx: Ctx, name: string, args: string[]): void {
  const by = takeFlag(args, '--by');
  const reason = takeFlag(by.rest, '--reason');
  const command = { ...WRITE[name].build(reason.rest), by: by.value, reason: reason.value };
  // Checked here to fail at once, and again by the tick, which resolves the same --by text.
  resolveActor(ctx, command.by, isGated(ctx, command));
  const path = writeControl(ctx.cfg.home, command, ctx.now());
  console.log(`Wrote ${path}. It applies on the next tick.`);
  const paused = pausedReason(ctx.cfg.home);
  if (paused !== null) console.log(`The factory is paused: ${paused}. The order applies when the pause is lifted.`);
}

async function status(ctx: Ctx): Promise<void> {
  const url = `${ctx.cfg.publicUrl}/factory/api/snapshot`;
  const response = await (ctx.fetch ?? fetch)(url, { headers: { Accept: 'application/json', 'User-Agent': SNAPSHOT_AGENT } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  console.log(JSON.stringify(await response.json(), null, 2));
}

async function cards(ctx: Ctx): Promise<void> {
  const state = readState(ctx.statePath);
  for (const card of await ctx.github.cards()) console.log(`#${card.issue} ${cardPosition(card, state)} ${card.column} [${card.labels.join(', ')}]`);
}

async function findCard(ctx: Ctx, value: string | undefined): Promise<Card> {
  const issue = number(value);
  const card = (await ctx.github.cards()).find((row) => row.issue === issue);
  if (card === undefined) throw new Error(`No card for #${issue} on the board.`);
  return card;
}

async function card(ctx: Ctx, args: string[]): Promise<void> {
  const found = await findCard(ctx, args[0]);
  const state = readState(ctx.statePath);
  for (const line of [...cardFacts(found, state), ...cardDrift(found, state).map((row) => `drift: ${row}`), ...jobNote(found, state)]) console.log(line);
}

// A running job owns its card mid-step, so drift on it may pass in seconds.
function jobNote(found: Card, state: FactoryState): string[] {
  const stages = runningJobs(found, state).map((job) => job.stage);
  return stages.length === 0 ? [] : [`note: a ${stages.join(', ')} job is running, so the drift above may pass in seconds`];
}

// Prints a value, or "none" when a store holds nothing for the card.
const shown = (value: string | undefined): string => (value === undefined || value === '' ? 'none' : value);

function cardFacts(found: Card, state: FactoryState): string[] {
  const key = String(found.issue);
  const posts = Object.entries(state.approvalPosts).filter(([, issue]) => issue === found.issue).map(([id]) => id);
  const running = state.jobs.filter((job) => job.issue === found.issue).map((job) => `${job.stage} since ${job.startedAt}`);
  const own = state.failures.filter((failure) => failure.issue === found.issue).map((failure) => `${failure.stage}: ${failure.error.split('\n')[0]}`);
  return [
    `position: ${cardPosition(found, state)}`,
    `column: ${found.column}`,
    `labels: ${shown(found.labels.join(', '))}`,
    `testPhase: ${shown(state.testPhase[key])}`,
    `patching: ${shown(state.patching[key])}`,
    `approvedResolving: ${shown(state.approvedResolving[key])}`,
    `queued approval: ${shown(state.pendingApprovals[key])}`,
    `open posts: ${shown(posts.join(', '))}`,
    `build: ${shown(state.builds[key])}`,
    `running job: ${shown(running.join(', '))}`,
    `failures: ${shown(own.join(' | '))}`,
  ];
}

// An empty list prints "none", so the reader can tell it from a command that printed nothing by mistake.
function printRows(rows: string[]): void {
  console.log(rows.length === 0 ? 'none' : rows.join('\n'));
}

function jobs(ctx: Ctx): void {
  printRows(readState(ctx.statePath).jobs.map((job) => `${job.stage} ${job.issue === null ? '-' : `#${job.issue}`} pid ${job.pid} since ${job.startedAt} log ${job.log}`));
}

function queues(ctx: Ctx): void {
  const state = readState(ctx.statePath);
  const approvals = Object.entries(state.pendingApprovals).map(([issue, by]) => `#${issue} by ${by}`);
  const removals = state.pendingRemovals.map((row) => `#${row.issue} by ${row.by}`);
  const changes = state.pendingChanges.map((row) => `${row.id} by ${row.by}`);
  console.log(`approval: ${approvals.join(', ') || 'none'}`);
  console.log(`removal: ${removals.join(', ') || 'none'}`);
  console.log(`ship: ${state.pendingShip ?? 'none'}`);
  console.log(`change: ${changes.join(', ') || 'none'}`);
  console.log(`incident: ${state.pendingIncidents.map((issue) => `#${issue}`).join(', ') || 'none'}`);
}

function release(ctx: Ctx): void {
  const state = readState(ctx.statePath);
  console.log(`last release: ${state.lastRelease ?? 'none'}`);
  if (state.release === null) return console.log('open release: none');
  console.log(`open release: #${state.release.issue} branch ${state.release.branch} cut ${state.release.day}`);
  console.log(`candidate post: ${candidatePost(state.release)}`);
  console.log(`removed: ${state.release.removed.map((issue) => `#${issue}`).join(', ') || 'none'}`);
  for (const line of playtestLines(state.release.playtest, ctx.cfg.playtestRuns)) console.log(line);
}

function candidatePost(release: ReleaseState): string {
  if (release.postId === null) return 'none';
  return `${release.postId} of ${release.candidateSha ?? 'no commit'}`;
}

function playtestLines(playtest: PlaytestState, runs: number): string[] {
  const lines = [`playtest: seed ${playtest.seed}, ${playtest.runs} runs, ${playtest.streak} of ${runs} since the last pass, passed ${playtest.passed ?? 'none'}`];
  if (playtest.blocked) lines.push(`playtest blocked at ${playtest.blocked.sha}: ${playtest.blocked.reason}`);
  return [...lines, ...playtest.notes.map((note) => `playtest decision: ${note}`)];
}

function failures(ctx: Ctx): void {
  printRows(readState(ctx.statePath).failures.map((row) => `${row.at} ${row.stage}${row.issue === null ? '' : ` #${row.issue}`}: ${row.error.split('\n')[0]} (log ${row.log ?? 'none'})`));
}

function newestLog(dir: string, issue: number, stage: string | null): string {
  const name = stage ?? '[a-z]+';
  const pattern = new RegExp(`^(${name}-${issue}-.*|issue-${issue}-${stage ?? '.*'})\\.log$`);
  const files = existsSync(dir) ? readdirSync(dir).filter((file) => pattern.test(file)) : [];
  if (files.length === 0) throw new Error(`No log for #${issue}${stage === null ? '' : ` stage ${stage}`} in ${dir}.`);
  const times = new Map(files.map((file) => [file, statSync(join(dir, file)).mtimeMs]));
  return join(dir, files.sort((a, b) => (times.get(b) as number) - (times.get(a) as number))[0]);
}

function log(ctx: Ctx, args: string[]): void {
  const path = newestLog(join(ctx.cfg.home, 'logs'), number(args[0]), args[1] ?? null);
  console.log(`# ${path}`);
  console.log(readFileSync(path, 'utf8').split('\n').slice(-LOG_TAIL_LINES).join('\n'));
}

async function audit(ctx: Ctx): Promise<void> {
  const state = readState(ctx.statePath);
  const board = await ctx.github.cards();
  for (const line of [...board.filter((row) => runningJobs(row, state).length === 0).flatMap((row) => cardDrift(row, state)), ...releaseDrift(state, board)]) console.log(line);
}

async function retry(ctx: Ctx, args: string[]): Promise<void> {
  const issue = number(args[0]);
  const decision = args.slice(1).join(' ').trim();
  await ctx.github.removeLabel(issue, STUCK_LABEL);
  updateState(ctx.statePath, (state: FactoryState) => ({ ...state, failures: state.failures.filter((row) => row.issue !== issue) }));
  console.log(`Removed ${STUCK_LABEL} and the failures of #${issue}. The next tick continues the card.`);
  if (readState(ctx.statePath).release?.issue === issue) console.log(retryPlaytest(ctx, decision));
}

// A member decided on a blocked playtest. The playtest runs again with a fresh budget of runs, and its review reads the decision.
function retryPlaytest(ctx: Ctx, decision: string): string {
  updateState(ctx.statePath, (state: FactoryState) => {
    if (state.release === null) return state;
    const playtest = state.release.playtest;
    const notes = decision === '' ? playtest.notes : [...playtest.notes, decision];
    return { ...state, release: { ...state.release, playtest: { ...playtest, streak: 0, blocked: null, notes } } };
  });
  return `Lifted the playtest block of the release. It plays again with ${ctx.cfg.playtestRuns} runs${decision === '' ? '' : ' and reads the decision'}.`;
}

function pause(ctx: Ctx, args: string[]): void {
  const reason = args.join(' ').trim();
  if (reason === '') throw new Error('pause needs a reason.');
  mkdirSync(ctx.cfg.home, { recursive: true });
  writeFileSync(pauseFile(ctx.cfg.home), `${PAUSE_PREFIX} ${reason}\n`);
  console.log(`Paused: ${reason}`);
}

function resume(ctx: Ctx): void {
  const paused = pausedReason(ctx.cfg.home);
  if (paused !== null && !paused.startsWith(PAUSE_PREFIX)) throw new Error('This pause was written by hand or by a member. Ask the committee before removing it.');
  rmSync(pauseFile(ctx.cfg.home), { force: true });
  console.log('Resumed.');
}
