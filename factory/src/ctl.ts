import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DROP_QUEUES, isGated, resolveActor, writeControl, type ControlAction, type DropQueue } from './control';
import { pauseFile, pausedReason } from './pause';
import { repairClone } from './repair-clone';
import { clearStuck } from './stuck';
import { MOVE_TARGETS, cardDrift, cardPosition, holdDrift, releaseDrift, runningJobs, type MoveTarget } from './position';
import { readState, updateState } from './state';
import { editState } from './state-edit';
import { STUCK_LABEL, type Card, type Ctx, type FactoryState, type Hold, type PlaytestState, type ReleasePost, type ReleaseState } from './types';

const SNAPSHOT_AGENT = 'curl/8.0';
const LOG_TAIL_LINES = 50;
const PAUSE_PREFIX = 'Paused with factory pause:';

type Handler = (ctx: Ctx, args: string[]) => Promise<void> | void;
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
  retry: { usage: 'retry N [decision]', help: 'remove the stuck label and the failures of a card. On the release tracking card it also lifts a playtest block, so a new playtest job runs, and keeps the decision for its next review', run: retry },
  pause: { usage: 'pause <reason>', help: 'pause the factory', run: pause },
  resume: { usage: 'resume', help: 'remove the pause', run: resume },
  'set-state': { usage: 'set-state <path> <json>|--delete --by <who> --reason <why>', help: 'set or delete one value of the state file under its lock, like release.postId null, while every job keeps running. Prints the old and the new value', run: setStateCommand },
  'repair-clone': { usage: 'repair-clone N --by <who> --reason <why> [--backup-merge]', help: "replace a card's broken work clone with a fresh clone of its GitHub branch. Needs no running job of the card, and holds the card while it works. The old clone moves whole to $FACTORY_HOME/clone-backups, and only its .factory, .factory-tasks and .factory-media folders are copied over. --backup-merge also takes a clone with an open merge or conflicts. A repair that works also removes the stuck label and the failures of the card, like retry", run: repairCloneCommand },
};

const WRITE: Record<string, { usage: string; help: string; build: Builder }> = {
  move: { usage: 'move N <to>', help: `put a card in one of ${MOVE_TARGETS.join(', ')}`, build: ([n, to]) => ({ action: 'move', issue: number(n), to: target(to) }) },
  merge: { usage: 'merge N', help: 'put a card in the merge queue, past its post and hardening', build: ([n]) => ({ action: 'merge', issue: number(n) }) },
  ship: { usage: 'ship', help: 'ship the open release now', build: () => ({ action: 'ship' }) },
  cut: { usage: 'cut', help: 'cut a release now', build: () => ({ action: 'cut' }) },
  remove: { usage: 'remove N', help: 'take a feature out of the release', build: ([n]) => ({ action: 'remove', issue: number(n) }) },
  drop: { usage: `drop <${DROP_QUEUES.join('|')}> <id>`, help: 'drop one queued entry', build: ([queue, id]) => dropAction(queue, id) },
  'merge-change': { usage: 'merge-change <id>', help: 'merge a factory change PR into main', build: ([id]) => ({ action: 'merge-change', id: number(id) }) },
  'pause-card': { usage: 'pause-card N', help: "hold a card: stop its job, keep its work clone and agent sessions, and start no job on it until resume-card", build: ([n]) => ({ action: 'hold', issue: number(n) }) },
  'resume-card': { usage: 'resume-card N', help: 'lift the hold of a card, so its stage continues in the stopped sessions', build: ([n]) => ({ action: 'unhold', issue: number(n) }) },
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
  resolveActor(ctx, command.by, isGated(ctx, command));
  const path = writeControl(ctx.cfg.home, command, ctx.now());
  console.log(`Wrote ${path}. It applies on the next tick.`);
  const paused = pausedReason(ctx.cfg.home);
  if (paused !== null) console.log(`The factory is paused: ${paused}. The order applies when the pause is lifted.`);
}

async function repairCloneCommand(ctx: Ctx, args: string[]): Promise<void> {
  const by = takeFlag(args, '--by');
  const reason = takeFlag(by.rest, '--reason');
  const backupMerge = reason.rest.includes('--backup-merge');
  const [n, ...extra] = reason.rest.filter((arg) => arg !== '--backup-merge');
  if (extra.length > 0) throw new Error(`Unexpected "${extra.join(' ')}". Usage: ${IMMEDIATE['repair-clone'].usage}`);
  const actor = resolveActor(ctx, by.value, false);
  for (const line of await repairClone(ctx, { issue: number(n), by: actor, reason: reason.value, backupMerge })) console.log(line);
}

function setStateCommand(ctx: Ctx, args: string[]): void {
  const by = takeFlag(args, '--by');
  const reason = takeFlag(by.rest, '--reason');
  const remove = reason.rest.includes('--delete');
  const [path, json, ...extra] = reason.rest.filter((arg) => arg !== '--delete');
  if (path === undefined || (json === undefined) !== remove || extra.length > 0) throw new Error(`Usage: ${IMMEDIATE['set-state'].usage}`);
  const actor = resolveActor(ctx, by.value, false);
  const { before, after } = editState(ctx.statePath, path, remove ? null : json);
  ctx.log('tick', null, `${actor} set ${path} from ${JSON.stringify(before)} to ${JSON.stringify(after)}: ${reason.value}`);
  console.log(`${path}: ${JSON.stringify(before)} -> ${after === undefined ? 'deleted' : JSON.stringify(after)}`);
}

async function status(ctx: Ctx): Promise<void> {
  const url = `${ctx.cfg.publicUrl}/factory/api/snapshot`;
  const response = await (ctx.fetch ?? fetch)(url, { headers: { Accept: 'application/json', 'User-Agent': SNAPSHOT_AGENT } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  const held = Object.entries(readState(ctx.statePath).held).map(([issue, hold]) => ({ issue: Number(issue), ...hold }));
  console.log(JSON.stringify({ ...((await response.json()) as object), held }, null, 2));
}

async function cards(ctx: Ctx): Promise<void> {
  const state = readState(ctx.statePath);
  for (const card of await ctx.github.cards()) {
    const hold = state.held[String(card.issue)];
    console.log(`#${card.issue} ${cardPosition(card, state)} ${card.column} [${card.labels.join(', ')}]${hold === undefined ? '' : ` held by ${hold.by}: ${hold.reason}`}`);
  }
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

function jobNote(found: Card, state: FactoryState): string[] {
  const stages = runningJobs(found, state).map((job) => job.stage);
  return stages.length === 0 ? [] : [`note: a ${stages.join(', ')} job is running, so the drift above may pass in seconds`];
}

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
    `post only: ${state.postOnly.includes(found.issue) ? 'yes' : 'no'}`,
    `approvedResolving: ${shown(state.approvedResolving[key])}`,
    `queued approval: ${shown(state.pendingApprovals[key])}`,
    `open posts: ${shown(posts.join(', '))}`,
    `build: ${shown(state.builds[key])}`,
    `running job: ${shown(running.join(', '))}`,
    `failures: ${shown(own.join(' | '))}`,
    `held: ${holdText(state.held[key])}`,
  ];
}

function holdText(hold: Hold | undefined): string {
  if (hold === undefined) return 'none';
  return `by ${hold.by} since ${hold.at}, ${hold.stage === null ? 'no job stopped' : `stopped ${hold.stage}`}: ${hold.reason}`;
}

function printRows(rows: string[]): void {
  console.log(rows.length === 0 ? 'none' : rows.join('\n'));
}

function jobs(ctx: Ctx): void {
  printRows(readState(ctx.statePath).jobs.map((job) => `${job.stage} ${job.issue === null ? '-' : `#${job.issue}`} pid ${job.pid} since ${job.startedAt} log ${job.log}${job.batch === undefined ? '' : ` batch ${job.batch.map((issue) => `#${issue}`).join(',')}`}`));
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
  console.log(`public post: ${publicPost(state.releasePost)}`);
  if (state.release === null) return console.log('open release: none');
  console.log(`open release: #${state.release.issue} branch ${state.release.branch} cut ${state.release.day}`);
  console.log(`candidate post: ${candidatePost(state.release)}`);
  console.log(`removed: ${state.release.removed.map((issue) => `#${issue}`).join(', ') || 'none'}`);
  console.log(`recorded tasks: ${state.release.tasks.map((issue) => `#${issue}`).join(', ') || 'none'}`);
  for (const line of playtestLines(state.release.playtest, ctx.cfg.playtestRuns)) console.log(line);
}

function publicPost(post: ReleasePost | null): string {
  if (post === null) return 'none due';
  if (post.postId === null) return `release ${post.day} waits for Hermes's draft`;
  return `release ${post.day} draft ${post.postId} waits for Publish`;
}

function candidatePost(release: ReleaseState): string {
  if (release.postId === null) return 'none';
  return `${release.postId} of ${release.candidateSha ?? 'no commit'}`;
}

function playtestLines(playtest: PlaytestState, runs: number): string[] {
  const lines = [`playtest: seed ${playtest.seed}, ${playtest.runs} plays, at most ${runs} per job, passed ${playtest.passed ?? 'none'}`];
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
  for (const line of [...board.filter((row) => runningJobs(row, state).length === 0).flatMap((row) => cardDrift(row, state)), ...releaseDrift(state, board), ...holdDrift(state, board)]) console.log(line);
}

async function retry(ctx: Ctx, args: string[]): Promise<void> {
  const issue = number(args[0]);
  const decision = args.slice(1).join(' ').trim();
  await clearStuck(ctx, issue);
  console.log(`Removed ${STUCK_LABEL} and the failures of #${issue}. The next tick continues the card.`);
  if (readState(ctx.statePath).release?.issue === issue) console.log(retryPlaytest(ctx, decision));
}

function retryPlaytest(ctx: Ctx, decision: string): string {
  updateState(ctx.statePath, (state: FactoryState) => {
    if (state.release === null) return state;
    const playtest = state.release.playtest;
    const notes = decision === '' ? playtest.notes : [...playtest.notes, decision];
    return { ...state, release: { ...state.release, playtest: { ...playtest, blocked: null, notes } } };
  });
  return `Lifted the playtest block of the release. A new playtest job plays up to ${ctx.cfg.playtestRuns} times${decision === '' ? '' : ' and reads the decision'}.`;
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
  if (paused !== null && !paused.startsWith(PAUSE_PREFIX)) throw new Error('This pause was written by hand or by a member. Once its reason is gone, delete the pause file.');
  rmSync(pauseFile(ctx.cfg.home), { force: true });
  console.log('Resumed.');
}
