import { addCard } from './card-events';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCommittee, telegramIds } from './committee';
import { applyControl, openRelease, parseControl, queueRemoval, queueShip } from './control';
import { reportFailure } from './fail';
import { markPost } from './post-status';
import { postDraft, publishPost } from './release-post';
import { deny, routeFeedback } from './stages/approval';
import { recordReleaseTask } from './stages/release-common';
import { updateState } from './state';
import { ADHOC_LABEL, RELEASE_TASK_LABEL, type Ctx, type Route } from './types';

const TITLE_LIMIT = 80;
const KINDS = ['approve', 'deny', 'reply', 'answer', 'patch', 'redesign', 'change', 'adhoc', 'ship', 'remove', 'release-task', 'release-draft', 'publish'];
const ROUTES: Route[] = ['answer', 'patch', 'redesign'];
const SILENT_KINDS: InboxCommand['kind'][] = ['adhoc', 'reply', 'answer', 'release-draft'];
const HERMES = 'hermes';
const HERMES_KINDS: InboxCommand['kind'][] = ['adhoc', 'answer', 'patch', 'redesign', 'release-draft'];

export type InboxCommand = {
  kind: 'approve' | 'deny' | 'reply' | Route | 'change' | 'adhoc' | 'ship' | 'remove' | 'release-task' | 'release-draft' | 'publish';
  issue: number | null;
  text: string | null;
  by: string;
  byName: string | null;
  chat: string;
  messageId: number | null;
  postId: number | null;
  image?: string | null;
};

export function inboxDir(home: string): string {
  return join(home, 'inbox');
}

export function parseCommand(raw: string): InboxCommand {
  const data = routeKind(JSON.parse(raw) as Partial<InboxCommand> & { route?: unknown });
  if (!KINDS.includes(String(data.kind))) throw new Error(`Unknown inbox command kind ${data.kind}`);
  if (typeof data.by !== 'string' || typeof data.chat !== 'string') throw new Error('Inbox command lacks by or chat');
  requireMessageId(data.by, data.messageId);
  requirePostId(data.postId);
  return data as InboxCommand;
}

function routeKind(data: Partial<InboxCommand> & { route?: unknown }): Partial<InboxCommand> {
  if ((data.kind as string) !== 'route') return data;
  if (!ROUTES.includes(data.route as Route)) throw new Error(`Unknown route ${String(data.route)}`);
  const { route, ...rest } = data;
  return { ...rest, kind: route as Route };
}

function requireMessageId(by: string, messageId: unknown): void {
  if (typeof messageId === 'number' || (by === HERMES && messageId === null)) return;
  throw new Error('Inbox command lacks messageId');
}

function requirePostId(postId: unknown): void {
  if (typeof postId !== 'number' && postId !== null) throw new Error('Inbox command lacks postId');
}

export async function drainInbox(ctx: Ctx): Promise<void> {
  const dir = inboxDir(ctx.cfg.home);
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (const name of files) await handleFile(ctx, join(dir, name));
}

function isControlFile(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { kind?: unknown } | null)?.kind === 'control';
  } catch {
    return false;
  }
}

async function handleControl(ctx: Ctx, raw: string): Promise<void> {
  let card = '';
  try {
    const command = parseControl(JSON.parse(raw));
    if ('issue' in command) card = `#${command.issue}: `;
    await applyControl(ctx, command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportFailure(ctx, 'control', null, `${card}${message}`, null, []);
  }
}

async function handleFile(ctx: Ctx, path: string): Promise<void> {
  const raw = readFileSync(path, 'utf8');
  rmSync(path);
  await (isControlFile(raw) ? handleControl(ctx, raw) : handleChatCommand(ctx, raw));
}

async function handleChatCommand(ctx: Ctx, raw: string): Promise<void> {
  let command: InboxCommand | null = null;
  try {
    command = parseCommand(raw);
    const answer = await handle(ctx, command);
    await deliver(ctx, command, answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log('tick', command?.issue ?? null, `inbox command failed: ${message}`);
    if (command) await ctx.telegram.sendMessage(command.chat, `That did not work: ${message}`, command.messageId);
  }
}

async function deliver(ctx: Ctx, command: InboxCommand, answer: string): Promise<void> {
  if (SILENT_KINDS.includes(command.kind)) return;
  if (command.postId === null) return void (await ctx.telegram.sendMessage(command.chat, answer, command.messageId));
  try {
    await markPost(ctx, command, senderName(command));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log('tick', command.issue, `post status failed: ${message}`);
    await ctx.telegram.sendMessage(command.chat, `${answer}\nThe post could not show its status: ${message}`, command.messageId);
  }
}


function resolveSender(ctx: Ctx, command: InboxCommand): string {
  if (command.by === HERMES) {
    if (!HERMES_KINDS.includes(command.kind)) throw new Error(`Only committee members can do that. Hermes may only queue a task, route a reply or draft the release post, not ${command.kind}.`);
    return senderName(command);
  }
  const { home, committeeBootstrapTelegram: telegram, committeeBootstrapGithub: github } = ctx.cfg;
  if (!telegramIds(readCommittee(home, { telegram, github })).includes(command.by)) throw new Error('Only committee members can do that.');
  return senderName(command);
}

function senderName(command: InboxCommand): string {
  return command.by === HERMES ? 'Hermes' : command.byName ?? command.by;
}

async function handle(ctx: Ctx, command: InboxCommand): Promise<string> {
  const by = resolveSender(ctx, command);
  if (command.kind === 'adhoc') return queueAdhoc(ctx, command, by);
  if (command.kind === 'change') return queueChange(ctx, requireText(command), by);
  if (command.kind === 'release-task') return openReleaseTask(ctx, command, by);
  if (command.kind === 'release-draft') return postDraft(ctx, requireText(command), command.image);
  if (command.kind === 'publish') return publishPost(ctx, requirePost(command));
  return handleIssueCommand(ctx, command, requireIssue(command), by);
}

type IssueHandler = (ctx: Ctx, command: InboxCommand, issue: number, by: string) => string | Promise<string>;

const ISSUE_HANDLERS: Partial<Record<InboxCommand['kind'], IssueHandler>> = {
  ship: (ctx, _command, issue, by) => queueShip(ctx, issue, by),
  remove: (ctx, command, issue, by) => queueRemoval(ctx, issue, by, requireText(command)),
  reply: (ctx, command, issue) => awaitRoute(ctx, command, issue),
  answer: routed, patch: routed, redesign: routed,
  deny: async (ctx, _command, issue, by) => {
    await deny(ctx, issue, by);
    return `Issue #${issue} is denied and closed.`;
  },
};

async function handleIssueCommand(ctx: Ctx, command: InboxCommand, issue: number, by: string): Promise<string> {
  const handler = ISSUE_HANDLERS[command.kind];
  return handler ? handler(ctx, command, issue, by) : queueApproval(ctx, issue, by);
}

const ROUTE_ANSWERS: Record<Route, (issue: number) => string> = {
  answer: (issue) => `The question on #${issue} is on the issue. The card stays in Approval.`,
  patch: (issue) => `Patch of #${issue} is queued. Sonnet fixes the build, then the factory checks run again.`,
  redesign: (issue) => `Feedback on #${issue} is on the issue. The task goes back to design.`,
};

function awaitRoute(ctx: Ctx, command: InboxCommand, issue: number): string {
  const postId = requirePost(command);
  const reply = { issue, postId, text: requireText(command), at: ctx.now().toISOString() };
  updateState(ctx.statePath, (state) => ({ ...state, unroutedReplies: { ...state.unroutedReplies, [String(command.messageId)]: reply } }));
  return `Reply on #${issue} waits for Hermes to route it.`;
}

async function routed(ctx: Ctx, command: InboxCommand, issue: number, by: string): Promise<string> {
  const route = command.kind as Route;
  const postId = requirePost(command);
  updateState(ctx.statePath, (state) => ({ ...state, unroutedReplies: Object.fromEntries(Object.entries(state.unroutedReplies).filter(([, reply]) => reply.postId !== postId)) }));
  const dropped = await routeFeedback(ctx, issue, by, requireText(command), route, postId);
  return `${ROUTE_ANSWERS[route](issue)}${dropped ? ' The queued approval is dropped.' : ''}`;
}

function requirePost(command: InboxCommand): number {
  if (command.postId === null) throw new Error(`A ${command.kind} command names no post`);
  return command.postId;
}

async function queueApproval(ctx: Ctx, issue: number, by: string): Promise<string> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Approval') throw new Error(`Issue #${issue} is not waiting for approval.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingApprovals: { ...state.pendingApprovals, [String(issue)]: by } }));
  return `Approval of #${issue} is queued. Hardening starts on a coming tick.`;
}

async function queueAdhoc(ctx: Ctx, command: InboxCommand, by: string): Promise<string> {
  const text = requireText(command).trim();
  const title = text.split('\n')[0].trim().slice(0, TITLE_LIMIT);
  const n = await ctx.github.createIssue(title, `${text}\n\nRequested by ${by} in the committee chat.`, [ADHOC_LABEL]);
  await addCard(ctx, n, 'Implementation', 'adhoc');
  const reply = { chat: command.chat, messageId: command.messageId };
  updateState(ctx.statePath, (state) => ({ ...state, adhocReplies: { ...state.adhocReplies, [String(n)]: reply } }));
  return `Queued as #${n}. The report comes as a reply here.`;
}

async function openReleaseTask(ctx: Ctx, command: InboxCommand, by: string): Promise<string> {
  const release = openRelease(ctx);
  const text = requireText(command).trim();
  const title = text.split('\n')[0].trim().slice(0, TITLE_LIMIT);
  const n = await ctx.github.createIssue(title, `${text}\n\nRequested by ${by} in the committee chat as a task of release ${release.day}.`, [RELEASE_TASK_LABEL]);
  recordReleaseTask(ctx, n);
  await addCard(ctx, n, 'Design', 'release-task');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
  return `Opened #${n} as a task of release ${release.day}. A new candidate follows when it is done.`;
}

function queueChange(ctx: Ctx, text: string, by: string): string {
  const id = ctx.now().getTime();
  updateState(ctx.statePath, (state) => ({ ...state, pendingChanges: [...state.pendingChanges, { id, text, by }] }));
  return `Change request ${id} is queued. The factory answers with a pull request.`;
}

function requireIssue(command: InboxCommand): number {
  if (typeof command.issue !== 'number') throw new Error(`A ${command.kind} command needs an issue number.`);
  return command.issue;
}

function requireText(command: InboxCommand): string {
  if (!command.text?.trim()) throw new Error(`A ${command.kind} command needs text.`);
  return command.text;
}
