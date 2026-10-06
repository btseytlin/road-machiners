import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCommittee } from './committee';
import { killJob } from './jobs';
import { appendLedger, recordJob } from './ledger';
import { MOVE_TARGETS, type MoveTarget } from './position';
import { withStatus } from './post-status';
import { clearSessions } from './sessions';
import { readState, updateState } from './state';
import { NEEDS_INFO_LABEL, STUCK_LABEL, type Card, type Column, type Ctx, type FactoryState, type JobStage, type ReleaseState, type TestPhase } from './types';

const DROP_QUEUES = ['approval', 'removal', 'ship', 'change', 'incident'] as const;
type DropQueue = (typeof DROP_QUEUES)[number];

// One order that changes the factory state, written by the `factory` CLI into $FACTORY_HOME/inbox.
export type ControlAction =
  | { action: 'move'; issue: number; to: MoveTarget }
  | { action: 'merge'; issue: number }
  | { action: 'ship' }
  | { action: 'cut' }
  | { action: 'remove'; issue: number }
  | { action: 'drop'; queue: DropQueue; id: number | null }
  | { action: 'merge-change'; id: number };
export type ControlCommand = ControlAction & { by: string; reason: string };

// What an action did: the issue it concerns, if any, and a sentence for the issue comment.
type Outcome = { issue: number | null; text: string };

// Writes by temp file and rename, so the tick never reads half a command. The temp name has no .json ending, so the inbox skips it.
export function writeControl(home: string, command: ControlCommand, now: Date): string {
  const dir = join(home, 'inbox');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${now.getTime()}-control.json`);
  writeFileSync(`${path}.tmp`, JSON.stringify({ kind: 'control', ...command }));
  renameSync(`${path}.tmp`, path);
  return path;
}

type Data = Record<string, unknown>;

function requireText(data: Data, name: string): string {
  const value = data[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`A control command needs a text field "${name}".`);
  return value;
}

function requireNumber(data: Data, name: string): number {
  const value = data[name];
  if (!Number.isInteger(value)) throw new Error(`A ${String(data.action)} command needs a whole number field "${name}".`);
  return value as number;
}

function requireOneOf<T extends string>(data: Data, name: string, allowed: readonly T[]): T {
  const value = data[name];
  if (!allowed.includes(value as T)) throw new Error(`A ${String(data.action)} command needs "${name}" to be one of ${allowed.join(', ')}.`);
  return value as T;
}

function requireDropId(data: Data): number | null {
  if (data.id === null) return null;
  return requireNumber(data, 'id');
}

const SHAPES: { [A in ControlAction['action']]: (data: Data) => Extract<ControlAction, { action: A }> } = {
  move: (data) => ({ action: 'move', issue: requireNumber(data, 'issue'), to: requireOneOf(data, 'to', MOVE_TARGETS) }),
  merge: (data) => ({ action: 'merge', issue: requireNumber(data, 'issue') }),
  ship: () => ({ action: 'ship' }),
  cut: () => ({ action: 'cut' }),
  remove: (data) => ({ action: 'remove', issue: requireNumber(data, 'issue') }),
  drop: (data) => ({ action: 'drop', queue: requireOneOf(data, 'queue', DROP_QUEUES), id: requireDropId(data) }),
  'merge-change': (data) => ({ action: 'merge-change', id: requireNumber(data, 'id') }),
};

export function parseControl(raw: unknown): ControlCommand {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('A control command must be a JSON object.');
  const data = raw as Data;
  const by = requireText(data, 'by');
  const reason = requireText(data, 'reason');
  const name = String(data.action);
  if (!Object.hasOwn(SHAPES, name)) throw new Error(`Unknown control action ${name}`);
  return { ...(SHAPES[name as ControlAction['action']](data) as ControlAction), by, reason };
}

// `hermes` is Hermes's own name for actions it takes on its judgment. Any other actor must be a committee member, by telegram id, GitHub login or name.
export function resolveActor(ctx: Ctx, by: string, gated: boolean): string {
  if (by === 'hermes') {
    if (gated) throw new Error('This action needs a committee member, not Hermes. Pass --by <member>.');
    return 'Hermes';
  }
  const { home, committeeBootstrapTelegram: telegram, committeeBootstrapGithub: github } = ctx.cfg;
  const member = readCommittee(home, { telegram, github }).find((item) => [item.telegram, item.github, item.name].includes(by));
  if (member === undefined) throw new Error(`${by} is no committee member, and only hermes may act without being one.`);
  return member.name ?? member.github ?? member.telegram;
}

// Actions that reach dev, players or the factory code need a member. A merge of a card the committee already approved needs none.
export function isGated(ctx: Ctx, command: ControlCommand): boolean {
  if (command.action === 'ship' || command.action === 'merge-change') return true;
  if (command.action !== 'merge') return false;
  const { approvedResolving, pendingApprovals } = readState(ctx.statePath);
  const key = String(command.issue);
  return !(key in approvedResolving) && !(key in pendingApprovals);
}

type Handlers = { [A in ControlAction['action']]: (ctx: Ctx, command: Extract<ControlCommand, { action: A }>, by: string) => Promise<Outcome> };

const HANDLERS: Handlers = {
  move, merge, ship, cut, remove, drop,
  'merge-change': async (ctx, command) => {
    await ctx.github.mergePullRequest(`factory-change/${command.id}`);
    return { issue: null, text: `Factory change ${command.id} is merged into main. The deploy follows.` };
  },
};

// Runs inside the tick's guard, so no job starts between the checks and the changes. A command that cannot apply throws before it changes anything.
export async function applyControl(ctx: Ctx, command: ControlCommand): Promise<string> {
  const by = resolveActor(ctx, command.by, isGated(ctx, command));
  const handler = HANDLERS[command.action] as (ctx: Ctx, command: ControlCommand, by: string) => Promise<Outcome>;
  const { issue, text } = await handler(ctx, command, by);
  if (issue !== null) await ctx.github.comment(issue, `${text}\n\nOrdered by ${by}. Reason: ${command.reason}`);
  appendLedger(ctx.cfg.home, { kind: 'control', action: command.action, issue, by, reason: command.reason, at: ctx.now().toISOString() });
  return text;
}

// The jobs that belong to a card position. Release, change and incident jobs carry an issue too, but no card position owns them.
// A running merge is not among them, since requireLeavable refuses to move a card while it merges.
const CARD_JOBS: JobStage[] = ['triage', 'design', 'implement', 'adhoc', 'patch', 'verify', 'checks'];
const COLUMN: Record<MoveTarget, Column> = { triage: 'Triage', design: 'Design', implement: 'Implementation', verify: 'Testing', checks: 'Testing', approval: 'Testing', done: 'Done' };
const PHASE: Partial<Record<MoveTarget, TestPhase>> = { checks: 'checks', approval: 'post' };
// A card put back before its build, or finished, no longer holds the approval it had.
const DROPS_APPROVAL: MoveTarget[] = ['triage', 'design', 'implement', 'done'];

async function requireCard(ctx: Ctx, issue: number): Promise<Card> {
  const found = (await ctx.github.cards()).find((card) => card.issue === issue);
  if (found === undefined) throw new Error(`Issue #${issue} is not on the board.`);
  return found;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function cardPosts(state: FactoryState, issue: number): string[] {
  return Object.entries(state.approvalPosts).filter(([, number]) => number === issue).map(([id]) => id);
}

// Checked before a card leaves its position, so a refused order changes nothing.
// A running merge is never killed, since it may stop between its push and its deploy. Hermes repeats the order after the merge.
function requireLeavable(ctx: Ctx, issue: number): void {
  const state = readState(ctx.statePath);
  if (state.jobs.some((job) => job.issue === issue && job.stage === 'approve')) throw new Error(`Issue #${issue} is merging now. Repeat the order after the merge.`);
  const missing = cardPosts(state, issue).find((id) => state.postCaptions[id] === undefined);
  if (missing !== undefined) throw new Error(`No caption is recorded for post ${missing}`);
}

// Edits every open post of the card with the status line, and forgets them.
async function closePosts(ctx: Ctx, issue: number, status: string): Promise<void> {
  const before = readState(ctx.statePath);
  for (const id of cardPosts(before, issue)) {
    const next = withStatus(before.postCaptions[id], status);
    if (before.textPosts.includes(id)) await ctx.telegram.editText(ctx.cfg.committeeChat, Number(id), next);
    else await ctx.telegram.editCaption(ctx.cfg.committeeChat, Number(id), next);
    updateState(ctx.statePath, (state) => ({ ...state, postCaptions: { ...state.postCaptions, [id]: next }, approvalPosts: omitKey(state.approvalPosts, id) }));
  }
}

// The kill comes first, so the dying job cannot write to a store after it is cleared.
async function stopJobs(ctx: Ctx, issue: number): Promise<void> {
  const jobs = readState(ctx.statePath).jobs.filter((job) => job.issue === issue && CARD_JOBS.includes(job.stage));
  for (const job of jobs) {
    await killJob(ctx.run, job.pid, job.id);
    recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), job, 'stopped');
  }
  updateState(ctx.statePath, (state) => ({ ...state, jobs: state.jobs.filter((job) => !jobs.some((stopped) => stopped.id === job.id)) }));
}

// Clears what a position keeps in the state. The failures go too, so Hermes's incident watch does not report the old position.
function clearCardState(ctx: Ctx, issue: number, dropsApproval: boolean): void {
  const key = String(issue);
  updateState(ctx.statePath, (state: FactoryState) => ({
    ...state,
    testPhase: omitKey(state.testPhase, key),
    patching: omitKey(state.patching, key),
    interrupted: state.interrupted.filter((number) => number !== issue),
    pendingApprovals: omitKey(state.pendingApprovals, key),
    approvedResolving: dropsApproval ? omitKey(state.approvedResolving, key) : state.approvedResolving,
    unroutedReplies: Object.fromEntries(Object.entries(state.unroutedReplies).filter(([, reply]) => reply.issue !== issue)),
    failures: state.failures.filter((failure) => failure.issue !== issue),
  }));
  clearSessions(ctx.cfg.home, issue);
}

async function clearFlags(ctx: Ctx, card: Card): Promise<void> {
  for (const label of [STUCK_LABEL, NEEDS_INFO_LABEL]) if (card.labels.includes(label)) await ctx.github.removeLabel(card.issue, label);
}

// Leaves the card with no job, no sub-position and no open post, so the new position starts from clean stores.
async function leavePosition(ctx: Ctx, card: Card, status: string, dropsApproval: boolean): Promise<void> {
  requireLeavable(ctx, card.issue);
  await stopJobs(ctx, card.issue);
  await closePosts(ctx, card.issue, status);
  clearCardState(ctx, card.issue, dropsApproval);
  await clearFlags(ctx, card);
}

async function move(ctx: Ctx, command: Extract<ControlCommand, { action: 'move' }>, by: string): Promise<Outcome> {
  const { issue, to } = command;
  const card = await requireCard(ctx, issue);
  await leavePosition(ctx, card, `↪️ Moved to ${to} by ${by}: ${command.reason}`, DROPS_APPROVAL.includes(to));
  const phase = PHASE[to];
  if (phase !== undefined) updateState(ctx.statePath, (state) => ({ ...state, testPhase: { ...state.testPhase, [String(issue)]: phase } }));
  await ctx.github.move(issue, COLUMN[to]);
  return { issue, text: `Moved to ${to}.` };
}

// The approve job merges at once for a card in Approval that holds an approval, so the merge needs no post and no hardening.
async function merge(ctx: Ctx, command: Extract<ControlCommand, { action: 'merge' }>, by: string): Promise<Outcome> {
  const { issue } = command;
  const card = await requireCard(ctx, issue);
  await leavePosition(ctx, card, `↪️ Merge ordered by ${by}: ${command.reason}`, false);
  const key = String(issue);
  updateState(ctx.statePath, (state) => ({ ...state, approvedResolving: { ...state.approvedResolving, [key]: by }, pendingApprovals: { ...state.pendingApprovals, [key]: by } }));
  await ctx.github.move(issue, 'Approval');
  return { issue, text: 'The merge into its base is queued.' };
}

export function openRelease(ctx: Ctx): ReleaseState {
  const release = readState(ctx.statePath).release;
  if (release === null) throw new Error('No release is open.');
  return release;
}

// Ship acts on the current candidate post alone. The job checks the release tasks when it runs.
export function queueShip(ctx: Ctx, issue: number, by: string): string {
  const release = openRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the open release, #${release.issue} is.`);
  if (release.postId === null) throw new Error('The release has no current candidate post yet. Wait for the next one.');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: by }));
  return `Ship of release ${release.day} is queued. The merge into main starts on a coming tick.`;
}

export function queueRemoval(ctx: Ctx, issue: number, by: string, text: string): string {
  const release = openRelease(ctx);
  if (release.removed.includes(issue)) throw new Error(`Issue #${issue} is already removed from release ${release.day}.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingRemovals: [...state.pendingRemovals, { issue, by, text }] }));
  return `Removal of #${issue} from release ${release.day} is queued. The revert starts on a coming tick.`;
}

async function ship(ctx: Ctx, _command: Extract<ControlCommand, { action: 'ship' }>, by: string): Promise<Outcome> {
  const { issue } = openRelease(ctx);
  return { issue, text: queueShip(ctx, issue, by) };
}

async function remove(ctx: Ctx, command: Extract<ControlCommand, { action: 'remove' }>, by: string): Promise<Outcome> {
  return { issue: command.issue, text: queueRemoval(ctx, command.issue, by, command.reason) };
}

// The release cut is due when lastRelease is empty and no release is open.
async function cut(ctx: Ctx): Promise<Outcome> {
  const release = readState(ctx.statePath).release;
  if (release !== null) throw new Error(`Release ${release.day} is open on #${release.issue}. Ship it before a new cut.`);
  updateState(ctx.statePath, (state) => ({ ...state, lastRelease: null }));
  return { issue: null, text: 'A release cut is due. It starts on a coming tick.' };
}

type Drop = { has: (state: FactoryState, id: number) => boolean; without: (state: FactoryState, id: number) => FactoryState };

const DROPS: Record<DropQueue, Drop> = {
  approval: { has: (state, id) => String(id) in state.pendingApprovals, without: (state, id) => ({ ...state, pendingApprovals: omitKey(state.pendingApprovals, String(id)) }) },
  removal: { has: (state, id) => state.pendingRemovals.some((item) => item.issue === id), without: (state, id) => ({ ...state, pendingRemovals: state.pendingRemovals.filter((item) => item.issue !== id) }) },
  ship: { has: (state) => state.pendingShip !== null, without: (state) => ({ ...state, pendingShip: null }) },
  change: { has: (state, id) => state.pendingChanges.some((item) => item.id === id), without: (state, id) => ({ ...state, pendingChanges: state.pendingChanges.filter((item) => item.id !== id) }) },
  incident: { has: (state, id) => state.pendingIncidents.includes(id), without: (state, id) => ({ ...state, pendingIncidents: state.pendingIncidents.filter((item) => item !== id) }) },
};
// Entries named by an issue number. The others are named by a change id or by nothing.
const ISSUE_QUEUES: DropQueue[] = ['approval', 'removal', 'incident'];

// The ship queue holds one entry and has no id. Its checks ignore the number.
function requireEntryId(queue: DropQueue, id: number | null): number {
  if (id !== null) return id;
  if (queue !== 'ship') throw new Error(`The ${queue} queue needs an id.`);
  return 0;
}

async function drop(ctx: Ctx, command: Extract<ControlCommand, { action: 'drop' }>): Promise<Outcome> {
  const { queue, id } = command;
  const entry = requireEntryId(queue, id);
  const name = `${queue} queue entry${id === null ? '' : ` ${id}`}`;
  if (!DROPS[queue].has(readState(ctx.statePath), entry)) throw new Error(`The ${name} is not there.`);
  updateState(ctx.statePath, (state) => DROPS[queue].without(state, entry));
  return { issue: ISSUE_QUEUES.includes(queue) ? id : null, text: `Dropped the ${name}.` };
}
