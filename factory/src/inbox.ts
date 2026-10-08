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
// Hermes writes its own orders with this `by`. It may queue a task, route a reply and draft the release post, which are mechanical. The rest is a member's decision.
const HERMES = 'hermes';
const HERMES_KINDS: InboxCommand['kind'][] = ['adhoc', 'answer', 'patch', 'redesign', 'release-draft'];

// One committee command, written by the Hermes plugin into $FACTORY_HOME/inbox.
// `reply` is a plain reply to an approval post that Hermes still has to route. Hermes's route tool writes kind `route`,
// which parsing turns into the kind of its route, so a member's `patch:` reply and Hermes's patch run the same path.
export type InboxCommand = {
  kind: 'approve' | 'deny' | 'reply' | Route | 'change' | 'adhoc' | 'ship' | 'remove' | 'release-task' | 'release-draft' | 'publish';
  issue: number | null;
  text: string | null;
  by: string; // Telegram user id, or `hermes` for an order Hermes gives on its own reading
  byName: string | null;
  chat: string;
  messageId: number | null; // null for an order of Hermes that answers no message
  postId: number | null; // the approval, candidate or release post draft the command acts on. Null for change, adhoc and release-draft.
  image?: string | null; // release-draft only: a picture under the inbox media folder that goes out with the post
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

// Handles every queued command once, oldest first. A bad command is answered and dropped, never retried.
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
    // Not JSON at all. The command path reports it.
    return false;
  }
}

// A control order comes from the `factory` CLI, not from a chat. A failure is a failure record that Hermes's incident watch reports, and the chat hears nothing.
// The failure names the card in its text but carries no issue, so a refused order does not stick the card.
async function handleControl(ctx: Ctx, raw: string): Promise<void> {
  let card = '';
  try {
    const command = parseControl(JSON.parse(raw));
    if ('issue' in command) card = `#${command.issue}: `;
    await applyControl(ctx, command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportFailure(ctx, 'control', null, `${card}${message}`, null);
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

// Each command gets one answer in the chat, never two.
// A command on a post answers with a status line on that post. A reply comes only when that edit fails.
// An ad hoc task, a reply Hermes is routing and an answer have Hermes's own reply already, so the factory adds nothing.
// An answer also keeps the post open with its buttons. Other commands get the answer as a reply.
async function deliver(ctx: Ctx, command: InboxCommand, answer: string): Promise<void> {
  if (SILENT_KINDS.includes(command.kind)) return;
  if (command.postId === null) return void (await ctx.telegram.sendMessage(command.chat, answer, command.messageId));
  try {
    await markPost(ctx, command, senderName(command));
  } catch (error) {
    // The command already worked, so a failed status edit is not "That did not work".
    const message = error instanceof Error ? error.message : String(error);
    ctx.log('tick', command.issue, `post status failed: ${message}`);
    await ctx.telegram.sendMessage(command.chat, `${answer}\nThe post could not show its status: ${message}`, command.messageId);
  }
}


// Hermes acts as itself on the mechanical kinds. Every other command needs a member, by Telegram id.
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

// The commands that act on one issue. Approve is the rest.
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

// Hermes routes the reply later. Until then the state holds it, so a reply that never gets a route becomes a failure.
function awaitRoute(ctx: Ctx, command: InboxCommand, issue: number): string {
  const postId = requirePost(command);
  const reply = { issue, postId, text: requireText(command), at: ctx.now().toISOString() };
  updateState(ctx.statePath, (state) => ({ ...state, unroutedReplies: { ...state.unroutedReplies, [String(command.messageId)]: reply } }));
  return `Reply on #${issue} waits for Hermes to route it.`;
}

// A route settles every reply still waiting on the same post, since Hermes may route after a follow-up message.
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

// A reply to the candidate post that is not a command. The old post cannot ship, since the new task must be played first.
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
