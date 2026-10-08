import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCommittee } from './committee';
import { holdCard, releaseHold } from './hold';
import { killJob } from './jobs';
import { appendLedger, recordJob } from './ledger';
import { CARD_JOBS, MOVE_TARGETS, isMerging, type MoveTarget } from './position';
import { withStatus } from './post-status';
import { dropReplyMedia } from './reply-media';
import { clearSessions } from './sessions';
import { readState, updateState } from './state';
import { agentHome, workDir } from './stages/common';
import { closeCard } from './stages/approval';
import { moveCard, type CardStep } from './card-events';
import { BRANCH, GAME_DIR, NEEDS_INFO_LABEL, RELEASE_LABEL, STUCK_LABEL, TASK_FILE, isCleanupTask, type Card, type Column, type Ctx, type FactoryState, type ReleaseState } from './types';

export const DROP_QUEUES = ['approval', 'removal', 'ship', 'change', 'incident'] as const;
export type DropQueue = (typeof DROP_QUEUES)[number];

export type ControlAction =
  | { action: 'move'; issue: number; to: MoveTarget }
  | { action: 'merge'; issue: number }
  | { action: 'ship' }
  | { action: 'cut' }
  | { action: 'remove'; issue: number }
  | { action: 'drop'; queue: DropQueue; id: number | null }
  | { action: 'merge-change'; id: number }
  | { action: 'hold'; issue: number }
  | { action: 'unhold'; issue: number };
export type ControlCommand = ControlAction & { by: string; reason: string };

type Outcome = { issue: number | null; text: string };

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
  hold: (data) => ({ action: 'hold', issue: requireNumber(data, 'issue') }),
  unhold: (data) => ({ action: 'unhold', issue: requireNumber(data, 'issue') }),
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

export function isGated(ctx: Ctx, command: ControlCommand): boolean {
  if (command.action === 'ship' || command.action === 'remove' || command.action === 'merge-change') return true;
  if (!approves(command)) return false;
  const { approvedResolving, pendingApprovals } = readState(ctx.statePath);
  const key = String(command.issue);
  return !(key in approvedResolving) && !(key in pendingApprovals);
}

function approves(command: ControlCommand): command is Extract<ControlCommand, { action: 'merge' | 'move' }> {
  return command.action === 'merge' || (command.action === 'move' && APPROVES.includes(command.to));
}

type Handlers = { [A in ControlAction['action']]: (ctx: Ctx, command: Extract<ControlCommand, { action: A }>, by: string) => Promise<Outcome> };

const HANDLERS: Handlers = {
  move, merge, ship, cut, remove, drop,
  'merge-change': async (ctx, command) => {
    await ctx.github.mergePullRequest(`factory-change/${command.id}`);
    return { issue: null, text: `Factory change ${command.id} is merged into main. The deploy follows.` };
  },
  hold: async (ctx, command, by) => ({ issue: command.issue, text: await holdCard(ctx, command.issue, by, command.reason) }),
  unhold: async (ctx, command) => ({ issue: command.issue, text: releaseHold(ctx, command.issue) }),
};

export async function applyControl(ctx: Ctx, command: ControlCommand): Promise<string> {
  const by = resolveActor(ctx, command.by, isGated(ctx, command));
  const handler = HANDLERS[command.action] as (ctx: Ctx, command: ControlCommand, by: string) => Promise<Outcome>;
  const { issue, text } = await handler(ctx, command, by);
  if (issue !== null) await ctx.github.comment(issue, `${text}\n\nOrdered by ${by}. Reason: ${command.reason}`);
  appendLedger(ctx.cfg.home, { kind: 'control', action: command.action, issue, by, reason: command.reason, at: ctx.now().toISOString() });
  return text;
}

const COLUMN: Record<MoveTarget, Column> = { triage: 'Triage', design: 'Design', implement: 'Implementation', verify: 'Testing', approval: 'Testing', harden: 'Hardening', merging: 'Merging', done: 'Done' };
const DROPS_APPROVAL: MoveTarget[] = ['triage', 'design', 'implement', 'verify', 'approval', 'done'];
const APPROVES: MoveTarget[] = ['harden', 'merging'];

function isApproved(state: FactoryState, card: Card): boolean {
  return String(card.issue) in state.approvedResolving || isCleanupTask(card.labels);
}

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

function requireLeavable(ctx: Ctx, card: Card): void {
  const { issue } = card;
  const state = readState(ctx.statePath);
  if (isMerging(state, card)) throw new Error(`Issue #${issue} is merging now. Repeat the order after the merge.`);
  const missing = cardPosts(state, issue).find((id) => state.postCaptions[id] === undefined);
  if (missing !== undefined) throw new Error(`No caption is recorded for post ${missing}`);
}

async function closePosts(ctx: Ctx, issue: number, status: string): Promise<void> {
  const before = readState(ctx.statePath);
  for (const id of cardPosts(before, issue)) {
    const next = withStatus(before.postCaptions[id], status);
    if (before.textPosts.includes(id)) await ctx.telegram.editText(ctx.cfg.committeeChat, Number(id), next);
    else await ctx.telegram.editCaption(ctx.cfg.committeeChat, Number(id), next);
    updateState(ctx.statePath, (state) => ({ ...state, postCaptions: { ...state.postCaptions, [id]: next }, approvalPosts: omitKey(state.approvalPosts, id) }));
    dropReplyMedia(ctx.cfg.home, [Number(id)]);
  }
}

async function stopJobs(ctx: Ctx, issue: number): Promise<void> {
  const jobs = readState(ctx.statePath).jobs.filter((job) => job.issue === issue && CARD_JOBS.includes(job.stage));
  for (const job of jobs) {
    await killJob(ctx.run, job.pid, job.id);
    recordJob(ctx.cfg.home, ctx.cfg.tokenPrices, ctx.now(), job, 'stopped');
  }
  updateState(ctx.statePath, (state) => ({ ...state, jobs: state.jobs.filter((job) => !jobs.some((stopped) => stopped.id === job.id)) }));
}

function clearCardState(state: FactoryState, issue: number, dropsApproval: boolean): FactoryState {
  const key = String(issue);
  return {
    ...state,
    postOnly: state.postOnly.filter((number) => number !== issue),
    interrupted: state.interrupted.filter((number) => number !== issue),
    pendingApprovals: omitKey(state.pendingApprovals, key),
    approvedResolving: dropsApproval ? omitKey(state.approvedResolving, key) : state.approvedResolving,
    unroutedReplies: Object.fromEntries(Object.entries(state.unroutedReplies).filter(([, reply]) => reply.issue !== issue)),
    failures: state.failures.filter((failure) => failure.issue !== issue),
  };
}

async function clearFlags(ctx: Ctx, card: Card): Promise<void> {
  for (const label of [STUCK_LABEL, NEEDS_INFO_LABEL]) if (card.labels.includes(label)) await ctx.github.removeLabel(card.issue, label);
}

async function requireBranch(ctx: Ctx, issue: number): Promise<void> {
  await ctx.repo.fetch();
  try {
    await ctx.repo.headHash(BRANCH(issue));
  } catch (error) {
    throw new Error(`Issue #${issue} has no branch ${BRANCH(issue)} on GitHub (${(error as Error).message}); move it to design, which creates the branch.`);
  }
}

async function requireTaskFile(ctx: Ctx, issue: number): Promise<void> {
  const path = join(agentHome(workDir(ctx, issue), GAME_DIR), TASK_FILE(issue));
  if (!existsSync(path)) throw new Error(`Issue #${issue} has no task file ${path}; move it to design, which writes the task.`);
}

type Need = (ctx: Ctx, issue: number) => Promise<void>;
const NEEDS: Partial<Record<MoveTarget, Need[]>> = {
  implement: [requireTaskFile],
  verify: [requireBranch],
  approval: [requireBranch],
  harden: [requireBranch],
  merging: [requireBranch],
};

async function requireWorkCard(ctx: Ctx, issue: number): Promise<Card> {
  const found = await requireCard(ctx, issue);
  if (found.labels.includes(RELEASE_LABEL)) throw new Error(`Issue #${issue} is the release tracking card. The release flow owns it.`);
  return found;
}

type Relocation = { column: Column; step: CardStep; status: string; dropsApproval: boolean; enter: (state: FactoryState) => FactoryState };

async function relocate(ctx: Ctx, card: Card, needs: Need[], plan: Relocation): Promise<void> {
  const { issue } = card;
  requireLeavable(ctx, card);
  for (const need of needs) await need(ctx, issue);
  await stopJobs(ctx, issue);
  await moveCard(ctx, issue, plan.column, plan.step);
  updateState(ctx.statePath, (state) => plan.enter(clearCardState(state, issue, plan.dropsApproval)));
  clearSessions(ctx.cfg.home, issue);
  await closePosts(ctx, issue, plan.status);
  await clearFlags(ctx, card);
}

async function move(ctx: Ctx, command: Extract<ControlCommand, { action: 'move' }>, by: string): Promise<Outcome> {
  const { issue, to } = command;
  const card = await requireWorkCard(ctx, issue);
  const key = String(issue);
  await relocate(ctx, card, NEEDS[to] ?? [], {
    column: COLUMN[to],
    step: to === 'done' ? 'dropped' : 'moved',
    status: `↪️ Moved to ${to} by ${by}: ${command.reason}`,
    dropsApproval: DROPS_APPROVAL.includes(to),
    enter: (state) => {
      const posted = to === 'approval' ? { ...state, postOnly: [...state.postOnly, issue] } : state;
      const kept = { ...posted, held: keptHold(posted.held, key, to) };
      return APPROVES.includes(to) && !isApproved(kept, card) ? { ...kept, approvedResolving: { ...kept.approvedResolving, [key]: by } } : kept;
    },
  });
  if (to === 'done') await closeCard(ctx, issue, `Dropped by ${by}: ${command.reason}`, 'dropped');
  return { issue, text: `Moved to ${to}.` };
}

function keptHold(held: FactoryState['held'], key: string, to: MoveTarget): FactoryState['held'] {
  if (!(key in held)) return held;
  return to === 'done' ? omitKey(held, key) : { ...held, [key]: { ...held[key], stage: null } };
}

async function merge(ctx: Ctx, command: Extract<ControlCommand, { action: 'merge' }>, by: string): Promise<Outcome> {
  const { issue } = command;
  const card = await requireWorkCard(ctx, issue);
  const key = String(issue);
  await relocate(ctx, card, [requireBranch], {
    column: 'Merging',
    step: 'merge-ordered',
    status: `↪️ Merge ordered by ${by}: ${command.reason}`,
    dropsApproval: false,
    enter: (state) => ({ ...state, approvedResolving: { ...state.approvedResolving, [key]: by } }),
  });
  return { issue, text: 'The card joins the merge queue.' };
}

export function openRelease(ctx: Ctx): ReleaseState {
  const release = readState(ctx.statePath).release;
  if (release === null) throw new Error('No release is open.');
  return release;
}

export function queueShip(ctx: Ctx, issue: number, by: string): string {
  const release = openRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the open release, #${release.issue} is.`);
  if (release.postId === null) throw new Error('The release has no current candidate post yet. Wait for the next one.');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: by }));
  return `Ship of release ${release.day} is queued. The merge into main starts on a coming tick.`;
}

export function queueRemoval(ctx: Ctx, issue: number, by: string, text: string, finishRemoved = false): string {
  const release = openRelease(ctx);
  if (release.removed.includes(issue) && !finishRemoved) throw new Error(`Issue #${issue} is already removed from release ${release.day}.`);
  if (readState(ctx.statePath).pendingRemovals.some((item) => item.issue === issue)) throw new Error(`A removal of #${issue} is already queued.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingRemovals: [...state.pendingRemovals, { issue, by, text }] }));
  return `Removal of #${issue} from release ${release.day} is queued. The revert starts on a coming tick.`;
}

async function ship(ctx: Ctx, _command: Extract<ControlCommand, { action: 'ship' }>, by: string): Promise<Outcome> {
  const { issue } = openRelease(ctx);
  return { issue, text: queueShip(ctx, issue, by) };
}

async function remove(ctx: Ctx, command: Extract<ControlCommand, { action: 'remove' }>, by: string): Promise<Outcome> {
  return { issue: command.issue, text: queueRemoval(ctx, command.issue, by, command.reason, true) };
}

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
const ISSUE_QUEUES: DropQueue[] = ['approval', 'removal', 'incident'];

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
