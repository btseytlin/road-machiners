import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { updateState } from '../state';
import { GAME_DIR, INCIDENT_BRANCH, INCIDENT_LOG, type Ctx } from '../types';
import { BASE_BRANCH, agentHome, agentLog, fillPrompt, readOutput, resetOutputs, useOpenNetwork, writeIssueInput } from './common';

type Outcome = { written: false; reason: string } | { written: true; id: string; reason: string };

const INCIDENT_ID = /^R\d+$/;

// Queues an incident job for each issue, once. The next ticks run them in order.
export function queueIncidents(ctx: Ctx, issues: number[]): void {
  if (issues.length === 0) return;
  updateState(ctx.statePath, (state) => ({ ...state, pendingIncidents: [...new Set([...state.pendingIncidents, ...issues])] }));
}

// Judges one shipped bug fix against the bar of the incident log. A written entry is merged into dev and pushed.
export async function runStage(ctx: Ctx, issue: number): Promise<void> {
  const clone = `${ctx.cfg.home}/work/incident-${issue}`;
  rmSync(clone, { recursive: true, force: true });
  await ctx.repo.fetch();
  await ctx.repo.prepareWorkClone(INCIDENT_BRANCH(issue), BASE_BRANCH, clone);
  const home = agentHome(clone, GAME_DIR);
  resetOutputs(home);
  await writeIssueInput(ctx, issue, home);
  const openNetwork = await useOpenNetwork(ctx, 'incident', issue);
  const prompt = fillPrompt('incident', { issue: String(issue), branch: INCIDENT_BRANCH(issue) });
  await ctx.container.agent({ clone, dir: GAME_DIR, model: ctx.cfg.designModel, prompt, log: agentLog(ctx, issue, 'incident'), openNetwork });
  const outcome = parseOutcome(readOutput(home, 'incident.json'));
  if (outcome.written) await land(ctx, issue, clone, outcome.id);
  const note = outcome.written ? `Recorded in the incident log as ${outcome.id}. ${outcome.reason}` : `Not added to the incident log. ${outcome.reason}`;
  await ctx.github.comment(issue, note);
  rmSync(clone, { recursive: true, force: true });
  ctx.log('incident', issue, outcome.written ? `wrote ${outcome.id}` : 'skipped');
}

// The entry reaches dev only as a commit that touches the log alone.
async function land(ctx: Ctx, issue: number, clone: string, id: string): Promise<void> {
  const branch = INCIDENT_BRANCH(issue);
  // The branch never reaches GitHub, so the host clone names it by its head commit.
  const head = await ctx.repo.fetchFromWork(clone, branch);
  const files = await ctx.repo.changedFiles(BASE_BRANCH, head);
  if (files.length !== 1 || files[0] !== INCIDENT_LOG) throw new Error(`The incident agent must commit ${INCIDENT_LOG} alone, but ${branch} changes: ${files.join(', ') || 'nothing'}`);
  if (!readFileSync(join(clone, INCIDENT_LOG), 'utf8').split('\n').includes(`ID: ${id}`)) throw new Error(`${INCIDENT_LOG} on ${branch} has no entry with ID: ${id}`);
  await ctx.repo.fetch();
  // The merge pushes dev in one atomic push, or throws with nothing changed.
  await ctx.repo.merge([{ branch: head, into: BASE_BRANCH, message: `Record incident ${id} from issue #${issue}` }]);
}

function parseOutcome(text: string | null): Outcome {
  if (text === null) throw new Error('The incident stage wrote no .factory/incident.json');
  const data: unknown = JSON.parse(text);
  if (typeof data !== 'object' || data === null) throw new Error('incident.json is not an object');
  const { written, id, reason } = data as Record<string, unknown>;
  if (typeof written !== 'boolean') throw new Error('incident.json needs written as true or false');
  const why = readReason(reason);
  return written ? { written, id: readId(id), reason: why } : { written, reason: why };
}

function readReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('incident.json needs a non-empty reason');
  return value.trim();
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !INCIDENT_ID.test(value)) throw new Error(`incident.json needs an id like R7 for a written entry, got ${String(value)}`);
  return value;
}
