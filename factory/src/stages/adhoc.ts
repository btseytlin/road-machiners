import { moveCard } from '../card-events';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTIFACT_DIR, collectArtifacts, holdArtifacts, releaseArtifacts } from '../adhoc-artifacts';
import { roundSession } from '../sessions';
import { readState, updateState } from '../state';
import { transcriptsDir } from '../transcript-archive';
import { GAME_DIR, OUT_DIR, type Ctx } from '../types';
import { RESUME_NOTE, agentHome, fillPrompt, isResuming, playtestCommand, prepareOutputs, readOutput, useOpenNetwork } from './common';

export const FACTORY_STATE_MOUNT = '/factory/state';
export const FACTORY_LOGS_MOUNT = '/factory/logs';
export const FACTORY_LEDGER_MOUNT = '/factory/ledger.jsonl';
export const FACTORY_TRANSCRIPTS_MOUNT = '/factory/transcripts';

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
  await moveCard(ctx, issue, 'Done', 'reported', 'adhoc');
  updateState(ctx.statePath, (state) => {
    const adhocReplies = { ...state.adhocReplies };
    delete adhocReplies[String(issue)];
    return { ...state, adhocReplies };
  });
  releaseArtifacts(ctx.cfg.home, issue);
  rmSync(dir, { recursive: true, force: true });
  ctx.log('adhoc', issue, `report and ${files.length} files posted, issue closed`);
}

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
  const prompt = session.resume ? RESUME_NOTE : fillPrompt('adhoc', { issue: String(issue), state: FACTORY_STATE_MOUNT, logs: FACTORY_LOGS_MOUNT, ledger: FACTORY_LEDGER_MOUNT, transcripts: FACTORY_TRANSCRIPTS_MOUNT, transcriptDays: String(ctx.cfg.transcriptDays), files: `${OUT_DIR}/${ARTIFACT_DIR}`, playtest: playtestCommand(ctx.cfg, false) });
  await ctx.container.agent({ clone: dir, dir: GAME_DIR, model: ctx.cfg.buildModel, prompt, log, openNetwork, readOnly, session });
}

function analyticsMounts(home: string): Record<string, string> {
  const ledger = join(home, 'ledger.jsonl');
  appendFileSync(ledger, '');
  mkdirSync(transcriptsDir(home), { recursive: true });
  return { [ledger]: FACTORY_LEDGER_MOUNT, [transcriptsDir(home)]: FACTORY_TRANSCRIPTS_MOUNT };
}

type Reply = { chat: string; messageId: number | null };

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

async function tell(ctx: Ctx, issue: number, reply: Reply, text: string): Promise<void> {
  try {
    await ctx.telegram.sendMessage(reply.chat, text, reply.messageId);
  } catch {
    ctx.log('adhoc', issue, 'could not tell the chat about a file failure');
  }
}
