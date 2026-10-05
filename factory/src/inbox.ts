import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCommittee, telegramIds } from './committee';
import { markPost } from './post-status';
import { deny, routeFeedback } from './stages/approval';
import { proposalOf } from './stages/waste';
import { readState, updateState } from './state';
import { recordWaiver, waiverNotice } from './visual-waiver';
import { ADHOC_LABEL, RELEASE_TASK_LABEL, WASTE_LABEL, type Ctx, type ReleaseState, type Route } from './types';

const TITLE_LIMIT = 80;
const KINDS = ['approve', 'deny', 'reply', 'answer', 'patch', 'redesign', 'change', 'adhoc', 'ship', 'remove', 'release-task', 'waste-change', 'waive-visual'];
const ROUTES: Route[] = ['answer', 'patch', 'redesign'];
const SILENT_KINDS: InboxCommand['kind'][] = ['adhoc', 'reply', 'answer'];

// One committee command, written by the Hermes plugin into $FACTORY_HOME/inbox.
// `reply` is a plain reply to an approval post that Hermes still has to route. Hermes's route tool writes kind `route`,
// which parsing turns into the kind of its route, so a member's `patch:` reply and Hermes's patch run the same path.
export type InboxCommand = {
  kind: 'approve' | 'deny' | 'reply' | Route | 'change' | 'adhoc' | 'ship' | 'remove' | 'release-task' | 'waste-change' | 'waive-visual';
  issue: number | null;
  text: string | null;
  by: string; // Telegram user id
  byName: string | null;
  chat: string;
  messageId: number;
  postId: number | null; // the approval or candidate post the command acts on. Null for change and adhoc.
};

export function inboxDir(home: string): string {
  return join(home, 'inbox');
}

export function parseCommand(raw: string): InboxCommand {
  const data = routeKind(JSON.parse(raw) as Partial<InboxCommand> & { route?: unknown });
  if (!KINDS.includes(String(data.kind))) throw new Error(`Unknown inbox command kind ${data.kind}`);
  if (typeof data.by !== 'string' || typeof data.chat !== 'string' || typeof data.messageId !== 'number') throw new Error('Inbox command lacks by, chat or messageId');
  requirePostId(data.postId);
  return data as InboxCommand;
}

function routeKind(data: Partial<InboxCommand> & { route?: unknown }): Partial<InboxCommand> {
  if ((data.kind as string) !== 'route') return data;
  if (!ROUTES.includes(data.route as Route)) throw new Error(`Unknown route ${String(data.route)}`);
  const { route, ...rest } = data;
  return { ...rest, kind: route as Route };
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

async function handleFile(ctx: Ctx, path: string): Promise<void> {
  const raw = readFileSync(path, 'utf8');
  rmSync(path);
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
// A review post is a text message, which has no caption for a status line, so its button press gets a reply too.
async function deliver(ctx: Ctx, command: InboxCommand, answer: string): Promise<void> {
  if (SILENT_KINDS.includes(command.kind)) return;
  if (answersByReply(command)) return void (await ctx.telegram.sendMessage(command.chat, answer, command.messageId));
  try {
    await markPost(ctx, command, command.byName ?? command.by);
  } catch (error) {
    // The command already worked, so a failed status edit is not "That did not work".
    const message = error instanceof Error ? error.message : String(error);
    ctx.log('tick', command.issue, `post status failed: ${message}`);
    await ctx.telegram.sendMessage(command.chat, `${answer}\nThe post could not show its status: ${message}`, command.messageId);
  }
}

function answersByReply(command: InboxCommand): boolean {
  return command.postId === null || command.kind === 'waste-change' || command.kind === 'waive-visual';
}

async function handle(ctx: Ctx, command: InboxCommand): Promise<string> {
  const { home, committeeBootstrapTelegram: telegram, committeeBootstrapGithub: github } = ctx.cfg;
  if (!telegramIds(readCommittee(home, { telegram, github })).includes(command.by)) throw new Error('Only committee members can do that.');
  const by = command.byName ?? command.by;
  if (command.kind === 'adhoc') return queueAdhoc(ctx, command, by);
  if (command.kind === 'change') return queueChange(ctx, requireText(command), by);
  if (command.kind === 'release-task') return openReleaseTask(ctx, command, by);
  return handleIssueCommand(ctx, command, requireIssue(command), by);
}

type IssueHandler = (ctx: Ctx, command: InboxCommand, issue: number, by: string) => string | Promise<string>;

// The commands that act on one issue. Approve is the rest.
const ISSUE_HANDLERS: Partial<Record<InboxCommand['kind'], IssueHandler>> = {
  ship: (ctx, _command, issue, by) => queueShip(ctx, issue, by),
  remove: (ctx, command, issue, by) => queueRemoval(ctx, issue, by, requireText(command)),
  reply: (ctx, command, issue) => awaitRoute(ctx, command, issue),
  answer: routed, patch: routed, redesign: routed,
  'waste-change': (ctx, _command, issue, by) => queueReviewChange(ctx, issue, by),
  'waive-visual': waiveVisual,
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
  const dropped = await routeFeedback(ctx, issue, by, requireText(command), route);
  return `${ROUTE_ANSWERS[route](issue)}${dropped ? ' The queued approval is dropped.' : ''}`;
}

function requirePost(command: InboxCommand): number {
  if (command.postId === null) throw new Error(`A ${command.kind} command names no post`);
  return command.postId;
}

// The one way to post a card with no screenshot. It runs only for a committee member (handle checks that first), and a GitHub comment cannot do it.
// The waiver is the member's, with their reason, on the issue where anyone can audit it. It covers the next approval post of this card and no other issue.
async function waiveVisual(ctx: Ctx, command: InboxCommand, issue: number, by: string): Promise<string> {
  const reason = requireText(command).trim();
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Testing') throw new Error(`Issue #${issue} is not in Testing, so there is no screenshot to waive.`);
  const waiver = recordWaiver(ctx, issue, command.by, command.byName, reason);
  await ctx.github.comment(issue, `Screenshot waiver recorded by the committee.\n\n${waiverNotice(waiver)}\n\nThe factory still runs the tests, typecheck, CPU playtest and build. Its approval post says the screenshot was waived. The waiver covers that one post.`);
  ctx.log('tick', issue, `screenshot waived by ${by}: ${waiver.reason}`);
  return `Screenshot of #${issue} is waived, as recorded on the issue. The checks still run, and the approval post says it has no visual evidence. Hermes clears factory-stuck when the card is held.`;
}

async function queueApproval(ctx: Ctx, issue: number, by: string): Promise<string> {
  const card = (await ctx.github.cards()).find((item) => item.issue === issue);
  if (card?.column !== 'Approval') throw new Error(`Issue #${issue} is not waiting for approval.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingApprovals: { ...state.pendingApprovals, [String(issue)]: by } }));
  return `Approval of #${issue} is queued. The merge into dev starts on a coming tick.`;
}

async function queueAdhoc(ctx: Ctx, command: InboxCommand, by: string): Promise<string> {
  const text = requireText(command).trim();
  const title = text.split('\n')[0].trim().slice(0, TITLE_LIMIT);
  const n = await ctx.github.createIssue(title, `${text}\n\nRequested by ${by} in the committee chat.`, [ADHOC_LABEL]);
  await ctx.github.addCard(n, 'Implementation');
  const reply = { chat: command.chat, messageId: command.messageId };
  updateState(ctx.statePath, (state) => ({ ...state, adhocReplies: { ...state.adhocReplies, [String(n)]: reply } }));
  return `Queued as #${n}. The report comes as a reply here.`;
}

function openRelease(ctx: Ctx): ReleaseState {
  const release = readState(ctx.statePath).release;
  if (release === null) throw new Error('No release is open.');
  return release;
}

// Ship acts on the current candidate post alone (IV1, IV5). The job checks the release tasks (IV3) when it runs.
function queueShip(ctx: Ctx, issue: number, by: string): string {
  const release = openRelease(ctx);
  if (release.issue !== issue) throw new Error(`Issue #${issue} is not the open release, #${release.issue} is.`);
  if (release.postId === null) throw new Error('The release has no current candidate post yet. Wait for the next one.');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: by }));
  return `Ship of release ${release.day} is queued. The merge into main starts on a coming tick.`;
}

function queueRemoval(ctx: Ctx, issue: number, by: string, text: string): string {
  const release = openRelease(ctx);
  if (release.removed.includes(issue)) throw new Error(`Issue #${issue} is already removed from release ${release.day}.`);
  updateState(ctx.statePath, (state) => ({ ...state, pendingRemovals: [...state.pendingRemovals, { issue, by, text }] }));
  return `Removal of #${issue} from release ${release.day} is queued. The revert starts on a coming tick.`;
}

// A reply to the candidate post that is not a command. The old post cannot ship, since the new task must be played first.
async function openReleaseTask(ctx: Ctx, command: InboxCommand, by: string): Promise<string> {
  const release = openRelease(ctx);
  const text = requireText(command).trim();
  const title = text.split('\n')[0].trim().slice(0, TITLE_LIMIT);
  const n = await ctx.github.createIssue(title, `${text}\n\nRequested by ${by} in the committee chat as a task of release ${release.day}.`, [RELEASE_TASK_LABEL]);
  await ctx.github.addCard(n, 'Design');
  updateState(ctx.statePath, (state) => ({ ...state, pendingShip: null, release: state.release && { ...state.release, postId: null } }));
  return `Opened #${n} as a task of release ${release.day}. A new candidate follows when it is done.`;
}

// The button under a waste review post queues the change the review proposed, as if a member sent it with /change.
async function queueReviewChange(ctx: Ctx, issue: number, by: string): Promise<string> {
  const review = await ctx.github.issue(issue);
  if (!review.labels.includes(WASTE_LABEL)) throw new Error(`Issue #${issue} is no factory review.`);
  return queueChange(ctx, `${proposalOf(review.body)}\n\nProposed by the factory review #${issue}.`, by);
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
