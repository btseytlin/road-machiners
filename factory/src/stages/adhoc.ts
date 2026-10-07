import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTIFACT_DIR, collectArtifacts, holdArtifacts, releaseArtifacts } from '../adhoc-artifacts';
import { roundSession } from '../sessions';
import { readState, updateState } from '../state';
import { transcriptsDir } from '../transcript-archive';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { RESUME_NOTE, agentHome, fillPrompt, isResuming, playtestCommand, prepareOutputs, readOutput, useOpenNetwork } from './common';

// The agent reads the factory's own records here, so it can answer questions about the factory too.
export const FACTORY_STATE_MOUNT = '/factory/state';
export const FACTORY_LOGS_MOUNT = '/factory/logs';
export const FACTORY_LEDGER_MOUNT = '/factory/ledger.jsonl';
export const FACTORY_TRANSCRIPTS_MOUNT = '/factory/transcripts';

// Runs one committee request as a read-only investigation. Nothing is pushed. The report goes back to the chat and the issue.
export async function adhoc(ctx: Ctx, issue: number): Promise<void> {
  const reply = readState(ctx.statePath).adhocReplies[String(issue)];
  if (!reply) throw new Error(`No chat message recorded to answer for ad hoc issue #${issue}`);
  const item = await ctx.github.issue(issue);
  await ctx.repo.fetch();
  const dir = `${ctx.cfg.home}/work/adhoc-${issue}`;
  await prepareClone(ctx, issue, dir);
  const home = agentHome(dir, GAME_DIR);
  prepareOutputs(ctx, issue, home);
  writeFileSync(`${home}/${OUT_DIR}/request.md`, `# Committee request\n\n${item.body}\n`);
  await runAdhocAgent(ctx, issue, dir);
  const report = readOutput(home, 'report.md')?.trim();
  if (!report) throw new Error(`The agent wrote no ${OUT_DIR}/report.md`);
  // Files go to the requesting chat as Telegram documents and nowhere else. They never reach the web root or GitHub.
  // A bad file or a failed upload fails the stage. The report is not sent first, so a retry does not repeat it.
  const files = await deliverable(ctx, issue, home, reply);
  const messageId = await ctx.telegram.sendMessage(reply.chat, report, reply.messageId);
  for (const file of files) {
    try {
      await ctx.telegram.sendDocument(reply.chat, file.path, messageId);
    } catch (error) {
      await tell(ctx, issue, reply, `Could not send the file ${file.name}. It is kept privately on the factory host for a retry.`);
      throw error;
    }
  }
  await ctx.github.comment(issue, report);
  await ctx.github.close(issue, 'completed');
  await ctx.github.move(issue, 'Done');
  updateState(ctx.statePath, (state) => {
    const adhocReplies = { ...state.adhocReplies };
    delete adhocReplies[String(issue)];
    return { ...state, adhocReplies };
  });
  releaseArtifacts(ctx.cfg.home, issue);
  rmSync(dir, { recursive: true, force: true });
  ctx.log('adhoc', issue, `report and ${files.length} files posted, issue closed`);
}

// A resumed agent continues in the clone it left. Any other run starts from a fresh clone of dev.
async function prepareClone(ctx: Ctx, issue: number, dir: string): Promise<void> {
  if (!isResuming(ctx, issue)) rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('dev', 'dev', dir);
}

async function runAdhocAgent(ctx: Ctx, issue: number, dir: string): Promise<void> {
  const log = `${ctx.cfg.home}/logs/issue-${issue}-adhoc.log`;
  const openNetwork = await useOpenNetwork(ctx, 'adhoc', issue);
  const readOnly = { [dirname(ctx.statePath)]: FACTORY_STATE_MOUNT, [`${ctx.cfg.home}/logs`]: FACTORY_LOGS_MOUNT, ...analyticsMounts(ctx.cfg.home) };
  const session = roundSession(ctx.cfg.home, issue, 'adhoc', isResuming(ctx, issue));
  if (session.resume) ctx.log('adhoc', issue, `resuming round adhoc, session ${session.id}`);
  const prompt = session.resume ? RESUME_NOTE : fillPrompt('adhoc', { issue: String(issue), state: FACTORY_STATE_MOUNT, logs: FACTORY_LOGS_MOUNT, ledger: FACTORY_LEDGER_MOUNT, transcripts: FACTORY_TRANSCRIPTS_MOUNT, transcriptDays: String(ctx.cfg.transcriptDays), files: `${OUT_DIR}/${ARTIFACT_DIR}`, playtest: playtestCommand(ctx.cfg) });
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log, openNetwork, readOnly, session });
}

// The ledger and the archived transcripts let the agent analyze what earlier agents did.
// Docker mounts a missing path as a folder owned by root, so both are made first. A fresh host has neither.
function analyticsMounts(home: string): Record<string, string> {
  const ledger = join(home, 'ledger.jsonl');
  appendFileSync(ledger, '');
  mkdirSync(transcriptsDir(home), { recursive: true });
  return { [ledger]: FACTORY_LEDGER_MOUNT, [transcriptsDir(home)]: FACTORY_TRANSCRIPTS_MOUNT };
}

type Reply = { chat: string; messageId: number };

async function deliverable(ctx: Ctx, issue: number, home: string, reply: Reply) {
  let files;
  try {
    files = collectArtifacts(home);
  } catch (error) {
    await tell(ctx, issue, reply, `The task made a file the factory will not send: ${(error as Error).message} Nothing was published.`);
    throw error;
  }
  return holdArtifacts(ctx.cfg.home, issue, files);
}

// Best effort, since the stage already fails with the real error.
async function tell(ctx: Ctx, issue: number, reply: Reply, text: string): Promise<void> {
  try {
    await ctx.telegram.sendMessage(reply.chat, text, reply.messageId);
  } catch {
    ctx.log('adhoc', issue, 'could not tell the chat about a file failure');
  }
}
