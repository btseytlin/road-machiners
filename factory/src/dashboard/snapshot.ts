import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ghClient } from '../github';
import { must } from '../exec';
import { readState } from '../state';
import { featureMerges, type Feature } from '../stages/release-common';
import { LABELS, type Labels } from './labels';
import { createWorkerKey, readLiveOperations } from './live';
import { ADHOC_LABEL, QUEUE_OF, RELEASE_CANDIDATE_LABEL, RELEASE_TASK_LABEL, STUCK_LABEL } from '../types';
import type { Card, FactoryState, GitHub, Queue, Run, RunResult } from '../types';
import type { AnalyticsRunner, Analytics } from './analytics';
import type { DashboardConfig } from './config';
import type { HostSampler, HostLoad } from './host';

const runFile = promisify(execFile);
export type Source<T> = { value: T | null; at: string | null; status: 'ok' | 'stale' | 'unavailable' };
type PauseReason = 'agent-usage-limit' | 'operator';
export type Operations = ReturnType<typeof buildOperations> & { pauseReason: PauseReason | null };
export type PublicCard = { issue: number; title: string; column: string; blocked: boolean; releaseTask: boolean };
export type DevMerge = { issue: number; createdAt: string; mergedAt: string };
export type GithubSnapshot = { cards: PublicCard[]; features: Feature[]; merges: DevMerge[]; releaseKey: string; provisional: boolean };
export type Snapshot = {
  generatedAt: string; repoUrl: string; playUrl: string; channelUrl: string | null;
  operations: Source<Operations>; github: Source<GithubSnapshot>; analytics: Source<Analytics>; host: Source<HostLoad>;
  live: Source<ReturnType<typeof readLiveOperations>>;
  labels: Labels;
};
export type Commit = { sha: string; parents: { sha: string }[]; commit: { message: string } };
type ComparePage = { total_commits: number; commits: Commit[] };
type PublicIssue = { number: number; title: string; labels: { name: string }[]; pull_request?: unknown };
type MergedIssue = { number: number; createdAt: string; labels: string[]; mergedAt: string | null };

const MERGES_QUERY = `query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){issues(labels:["${RELEASE_CANDIDATE_LABEL}"],states:[OPEN,CLOSED],first:50,after:$endCursor){pageInfo{hasNextPage endCursor}nodes{number createdAt labels(first:20){nodes{name}}timelineItems(first:100,itemTypes:[LABELED_EVENT]){nodes{...on LabeledEvent{createdAt label{name}}}}}}}}`;
const MERGES_JQ = `.data.repository.issues.nodes[]|{number,createdAt,labels:[.labels.nodes[].name],mergedAt:([.timelineItems.nodes[]|select(.label.name=="${RELEASE_CANDIDATE_LABEL}")|.createdAt]|sort|first)}`;

function createSource<T>(): Source<T> { return { value: null, at: null, status: 'unavailable' }; }
function recordFailure<T>(source: Source<T>, name: string, error: unknown): Source<T> {
  console.error(`Dashboard ${name} unavailable:`, error);
  return { ...source, status: source.value === null ? 'unavailable' : 'stale' };
}
function recordSuccess<T>(value: T): Source<T> { return { value, at: new Date().toISOString(), status: 'ok' }; }
function expireSource<T>(source: Source<T>, budgetMs: number): Source<T> {
  if (source.at === null || source.status !== 'ok') return source;
  return Date.now() - Date.parse(source.at) > budgetMs ? { ...source, status: 'stale' } : source;
}
function getPublicIssue(stage: string, issue: number | null): number | null {
  return ['change', 'adhoc'].includes(stage) ? null : issue;
}
export function getReleaseKey(state: FactoryState): string {
  return JSON.stringify({ branch: state.release?.branch ?? 'dev', removed: state.release?.removed ?? [] });
}
function getFactoryStatus(state: FactoryState, paused: boolean): string {
  if (paused) return 'paused';
  if (state.lastTickError !== null) return 'blocked';
  if (state.jobs.length) return 'working';
  if (state.failures.some((failure) => failure.stage !== 'catch-up')) return 'blocked';
  return 'idle';
}
export function buildOperations(state: FactoryState, paused: boolean, config: Pick<DashboardConfig, 'triageWorkers' | 'designWorkers' | 'implementWorkers' | 'verifyWorkers' | 'testWorkers' | 'publicUrl'>) {
  const jobs = state.jobs.map((job) => ({ key: createWorkerKey(job.id), stage: job.stage, issue: getPublicIssue(job.stage, job.issue), startedAt: job.startedAt, queue: QUEUE_OF[job.stage] }));
  const count = (queue: Queue, total: number) => ({ busy: jobs.filter((job) => job.queue === queue).length, total });
  const candidateUrl = state.release?.postId != null ? `${config.publicUrl}/rc/` : null;
  const release = state.release === null ? null : { issue: state.release.issue, day: state.release.day };
  return { status: getFactoryStatus(state, paused), jobs, queues: { branch: count('branch', 1), triage: count('triage', config.triageWorkers), design: count('design', config.designWorkers), implement: count('implement', config.implementWorkers), verify: count('verify', config.verifyWorkers), test: count('test', config.testWorkers) }, release, releaseKey: getReleaseKey(state), candidateUrl };
}
export function selectReleaseFeatures(commits: Commit[], head: string, removed: number[]): Feature[] {
  const index = new Map(commits.map((commit) => [commit.sha, commit]));
  const subjects: string[] = [];
  const seen = new Set<string>();
  let commit = index.get(head);
  while (commit) {
    if (seen.has(commit.sha)) throw new Error('Cycle in commit history');
    seen.add(commit.sha);
    if (commit.parents.length > 1) subjects.push(commit.commit.message.split('\n')[0]);
    commit = index.get(commit.parents[0]?.sha ?? '');
  }
  return featureMerges(subjects).filter((feature) => !removed.includes(feature.issue));
}

export class PublicGitHub {
  private readonly github: GitHub;
  constructor(private readonly config: DashboardConfig, private readonly run: Run) { this.github = ghClient(run, config); }
  private async query(args: string[]): Promise<string> { return must(await this.run('gh', args), 'Dashboard GitHub read'); }
  private async readIssues(): Promise<PublicIssue[]> {
    const output = await this.query(['api', `repos/${this.config.repo}/issues?state=open&per_page=100`, '--paginate', '--jq', '.[] | {number,title,labels,pull_request}']);
    return output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as PublicIssue);
  }
  private async readMerges(): Promise<DevMerge[]> {
    const [owner, name] = this.config.repo.split('/');
    const output = await this.query(['api', 'graphql', '--paginate', '-f', `query=${MERGES_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '--jq', MERGES_JQ]);
    const issues = output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as MergedIssue);
    return issues.filter((issue) => !issue.labels.includes(RELEASE_TASK_LABEL) && !issue.labels.includes(ADHOC_LABEL)).map((issue) => {
      if (issue.mergedAt === null) throw new Error(`Issue ${issue.number} has ${RELEASE_CANDIDATE_LABEL} but no label event`);
      return { issue: issue.number, createdAt: issue.createdAt, mergedAt: issue.mergedAt };
    });
  }
  private async readHead(branch: string): Promise<string> {
    const head = (await this.query(['api', `repos/${this.config.repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha'])).trim();
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid GitHub head');
    return head;
  }
  private async readFeatures(state: FactoryState): Promise<Feature[]> {
    const branch = state.release?.branch ?? 'dev';
    const [head, base] = await Promise.all([this.readHead(branch), this.readHead('main')]);
    const commits = await this.readComparison(base, head);
    return selectReleaseFeatures(commits, head, state.release?.removed ?? []);
  }
  private async readComparison(base: string, head: string): Promise<Commit[]> {
    const output = await this.query(['api', `repos/${this.config.repo}/compare/${base}...${head}?per_page=100`, '--paginate', '--jq', '{total_commits,commits:[.commits[]|{sha,parents:[.parents[]|{sha}],commit:{message:.commit.message}}]}']);
    const pages = output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as ComparePage);
    const commits = pages.flatMap((page) => page.commits);
    if (!pages.length || commits.length !== pages[0].total_commits) throw new Error('Incomplete GitHub comparison');
    return commits;
  }
  async read(state: FactoryState): Promise<GithubSnapshot> {
    const visibility = (await this.query(['api', `repos/${this.config.repo}`, '--jq', '.visibility'])).trim();
    if (visibility !== 'public') throw new Error('Dashboard requires a public repository');
    const [cards, issues, features, merges] = await Promise.all([this.github.cards(), this.readIssues(), this.readFeatures(state), this.readMerges()]);
    return { cards: selectPublicCards(cards, issues), features, merges, releaseKey: getReleaseKey(state), provisional: state.release === null };
  }
}

function selectPublicCards(cards: Card[], issues: PublicIssue[]): PublicCard[] {
  const byNumber = new Map(issues.filter((issue) => !issue.pull_request).map((issue) => [issue.number, issue]));
  const publicCards: PublicCard[] = [];
  for (const card of cards) {
    const issue = byNumber.get(card.issue);
    if (!issue || card.column === 'Done' || card.labels.includes(ADHOC_LABEL)) continue;
    if (issue.labels.some((label) => label.name === ADHOC_LABEL)) continue;
    publicCards.push({ issue: card.issue, title: issue.title, column: card.column, blocked: card.labels.includes(STUCK_LABEL), releaseTask: card.labels.includes(RELEASE_TASK_LABEL) });
  }
  return publicCards;
}

export function createGithubRun(timeoutMs: number, env: NodeJS.ProcessEnv): Run {
  return async (command, args): Promise<RunResult> => {
    if (command !== 'gh') throw new Error('Dashboard only runs GitHub reads');
    try {
      const { stdout, stderr } = await runFile(command, args, { timeout: timeoutMs, env });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as { code: unknown; stdout: unknown; stderr: unknown };
      if (typeof failed.code !== 'number' || typeof failed.stdout !== 'string' || typeof failed.stderr !== 'string') throw error;
      return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
    }
  };
}

function readPauseReason(home: string): PauseReason | null {
  let note: string;
  try { note = readFileSync(join(home, 'paused'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return /^Hermes: Claude weekly usage limit(?:[;.\n]|$)/i.test(note) ? 'agent-usage-limit' : 'operator';
}
function projectHostResources(host: HostLoad): HostLoad {
  if (!host.containers?.value) return host;
  const value = host.containers.value.map((row) => ({ ...row, jobId: row.jobId === null ? null : createWorkerKey(row.jobId) }));
  return { ...host, containers: { ...host.containers, value } };
}

export class SnapshotCollector {
  private state: FactoryState | null = null;
  private operations = createSource<Operations>();
  private github = createSource<GithubSnapshot>();
  private analytics = createSource<Analytics>();
  private host = createSource<HostLoad>();
  private live = createSource<ReturnType<typeof readLiveOperations>>();
  constructor(private readonly config: DashboardConfig, private readonly publicGithub: PublicGitHub, private readonly hostSampler: HostSampler, private readonly analyticsRunner: AnalyticsRunner) {}
  private refreshState(): void {
    try {
      const path = join(this.config.home, 'state', 'state.json');
      if (!existsSync(path)) throw new Error('Factory state missing');
      this.state = readState(path);
      const pauseReason = readPauseReason(this.config.home);
      this.operations = recordSuccess({ ...buildOperations(this.state, pauseReason !== null, this.config), pauseReason });
    } catch (error) { this.operations = recordFailure(this.operations, 'state', error); }
  }
  private async refreshAnalytics(): Promise<void> {
    try {
      const panels = await this.analyticsRunner.read(join(this.config.home, 'ledger.jsonl'), new Date(), this.config.tickIntervalMs * 3);
      this.analytics = recordSuccess(panels);
    } catch (error) { this.analytics = recordFailure(this.analytics, 'analytics', error); }
  }
  private refreshLive(): void {
    if (this.state === null) return;
    try { this.live = recordSuccess(readLiveOperations(this.config.home, this.state, new Date(), this.config.observationHeartbeatMs, this.config.tickIntervalMs)); }
    catch (error) { this.live = recordFailure(this.live, 'observations', error); }
  }
  async refreshLocal(): Promise<void> {
    this.refreshState();
    this.refreshLive();
    await this.refreshAnalytics();
    try { this.host = recordSuccess(projectHostResources(await this.hostSampler.sample())); }
    catch (error) { this.host = recordFailure(this.host, 'host', error); }
  }
  async refreshGithub(): Promise<void> {
    if (this.state === null) return;
    try { this.github = recordSuccess(await this.publicGithub.read(this.state)); }
    catch (error) { this.github = recordFailure(this.github, 'GitHub', error); }
  }
  getSnapshot(): Snapshot {
    const localBudget = this.config.refreshMs + this.config.commandTimeoutMs;
    return {
      generatedAt: new Date().toISOString(), repoUrl: `https://github.com/${this.config.repo}`, playUrl: this.config.playUrl, channelUrl: this.config.channelUrl,
      live: expireSource(this.live, localBudget), operations: expireSource(this.operations, localBudget), analytics: expireSource(this.analytics, localBudget), host: expireSource(this.host, localBudget),
      github: expireSource(this.github, this.config.githubRefreshMs + this.config.commandTimeoutMs),
      labels: LABELS,
    };
  }
}
