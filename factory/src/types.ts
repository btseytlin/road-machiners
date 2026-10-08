// Shared types of the game factory. Every module codes against these, so stages, wrappers and tests agree.

// The Status options of the Project board, in board order. Code that checks a column name reads this list.
export const COLUMNS = ['Triage', 'Design', 'Implementation', 'Testing', 'Approval', 'Hardening', 'Merging', 'Done'] as const;
export type Column = typeof COLUMNS[number];

export type CardStage = 'triage' | 'design' | 'implement' | 'verify' | 'harden';
export type ReleaseStage = 'release' | 'playtest' | 'candidate' | 'ship' | 'remove';
export type Stage = CardStage | ReleaseStage | 'checks' | 'approve' | 'merge' | 'feedback' | 'change' | 'adhoc' | 'incident' | 'dev' | 'waste' | 'intake' | 'tick' | 'control';

export type FactoryConfig = {
  observationHeartbeatMs: number;
  observationMaxEventBytes: number;
  repo: string;
  projectOwner: string;
  projectNumber: number;
  githubRetries: number;
  githubRetryBaseSeconds: number;
  githubTimeoutSeconds: number;
  home: string;
  webRoot: string;
  publicUrl: string;
  image: string;
  gpu: boolean;
  oauthToken: string;
  elevenlabsKey: string;
  sfxMaxGenerations: number;
  designModel: string;
  buildModel: string;
  triageModel: string;
  advisorModel: string;
  triageEffort: string;
  designEffort: string;
  tokenPrices: Record<string, TokenPrice>;
  minVotes: number;
  minAgeHours: number;
  needsInfoHours: number;
  committeeBootstrapTelegram: string;
  committeeBootstrapGithub: string;
  telegramToken: string;
  committeeChat: string;
  publicChannel: string;
  triageTimeoutMinutes: number;
  designTimeoutMinutes: number;
  implementTimeoutMinutes: number;
  verifyTimeoutMinutes: number;
  testTimeoutMinutes: number;
  branchTimeoutMinutes: number;
  agentJobMaxMinutes: number;
  replyRouteMinutes: number;
  releaseDays: number;
  playtestTurns: number;
  playtestRuns: number;
  playtestTimeoutMinutes: number;
  mergeTimeoutMinutes: number;
  testingBudgetUsd: number;
  mergingBudgetUsd: number;
  wasteReviewDays: number;
  itchTarget: string | null;
  butlerKey: string | null;
  maxJobsPerDay: number;
  maxJobsPerCard: number;
  triageWorkers: number;
  designWorkers: number;
  implementWorkers: number;
  verifyWorkers: number;
  testWorkers: number;
  minFreeGb: number;
  minAvailableGb: number;
  logDays: number;
  transcriptDays: number;
  testCacheDays: number;
  cpuLight: number;
  cpuImplement: number;
  cpuTest: number;
  vitestWorkersImplement: number;
  vitestWorkersTest: number;
  errorDailyIssues: number;
  errorDiskMb: number;
  errorMapDays: number;
  errorBodyKb: number;
  errorUnzippedMb: number;
  errorIpPerHour: number;
  errorOrigins: string;
};

export type TokenPrice = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };

export type RunOptions = { cwd?: string; env?: Record<string, string>; input?: string; logPath?: string; onStdout?: (chunk: string) => void; timeoutMs?: number };
export type RunResult = { code: number; stdout: string; stderr: string };
export type Run = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

export type Reaction = { login: string; content: string };
export type IssueComment = { login: string; body: string; createdAt: string };

export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  state: 'OPEN' | 'CLOSED';
  author: string;
  thumbsUp: string[];
};

export type Card = { itemId: string; issue: number; column: Column; labels: string[] };

export type JobStage = CardStage | ReleaseStage | 'checks' | 'approve' | 'merge' | 'change' | 'adhoc' | 'incident' | 'dev' | 'waste';
export type Job = { id: string; stage: JobStage; issue: number | null; pid: number; startedAt: string; log: string };

export type Queue = 'branch' | 'triage' | 'design' | 'implement' | 'verify' | 'test';
export const AGENT_QUEUES: Queue[] = ['triage', 'design', 'implement', 'verify'];
export const QUEUE_OF: Record<JobStage, Queue> = {
  triage: 'triage', waste: 'triage', design: 'design', implement: 'implement', adhoc: 'implement', verify: 'verify', harden: 'verify',
  change: 'implement',
  checks: 'test',
  approve: 'branch', merge: 'branch', remove: 'branch', ship: 'branch', release: 'branch', candidate: 'branch', dev: 'branch', incident: 'branch',
  playtest: 'verify',
};
export type Route = 'answer' | 'patch' | 'redesign';
export type Failure = { stage: Stage; issue: number | null; error: string; log: string | null; at: string };
export type ChangeRequest ={ id: number; text: string; by: string };
export type Removal = { issue: number; by: string; text: string };

export type PlaytestState = {
  seed: number;
  runs: number;
  passed: string | null;
  blocked: { sha: string; reason: string } | null;
  notes: string[];
};

export type ReleaseState = {
  issue: number;
  branch: string;
  day: string;
  postId: number | null;
  candidateSha: string | null;
  removed: number[];
  tasks: number[];
  playtest: PlaytestState;
};

export type ReleasePost = {
  issue: number;
  day: string;
  changelog: string;
  screenshot: string;
  postId: number | null;
  draft: string | null;
};

export type FactoryState = {
  jobs: Job[];
  approvalPosts: Record<string, number>;
  lastRelease: string | null;
  release: ReleaseState | null;
  releasePost: ReleasePost | null;
  pendingShip: string | null;
  pendingRemovals: Removal[];
  pendingApprovals: Record<string, string>;
  approvedResolving: Record<string, string>;
  pendingChanges: ChangeRequest[];
  pendingIncidents: number[];
  bundles: Record<string, number[]>;
  lastTickError: string | null;
  failures: Failure[];
  adhocReplies: Record<string, { chat: string; messageId: number | null }>;
  builds: Record<string, string>;
  jobStarts: string[];
  cardStarts: Record<string, string[]>;
  postCaptions: Record<string, string>;
  devBuild: string | null;
  devFailed: string | null;
  devError: string | null;
  interrupted: number[];
  postOnly: number[];
  unroutedReplies: Record<string, UnroutedReply>;
  textPosts: string[];
  lastWasteReview: string | null;
  held: Record<string, Hold>;
};

export type Hold = { by: string; reason: string; at: string; stage: JobStage | null };

export type UnroutedReply = { issue: number; postId: number; text: string; at: string };

export interface GitHub {
  candidates(labels: string[]): Promise<Issue[]>;
  issue(number: number): Promise<Issue>;
  comments(number: number): Promise<IssueComment[]>;
  comment(number: number, body: string): Promise<void>;
  addLabel(number: number, label: string): Promise<void>;
  removeLabel(number: number, label: string): Promise<void>;
  close(number: number, reason: 'completed' | 'not planned'): Promise<void>;
  createIssue(title: string, body: string, labels: string[]): Promise<number>;
  editIssue(number: number, title: string, body: string): Promise<void>;
  cards(): Promise<Card[]>;
  addCard(issue: number, column: Column): Promise<void>;
  move(issue: number, column: Column): Promise<void>;
  openPullRequest(branch: string, base: string, title: string, body: string): Promise<string>;
  createRelease(tag: string, target: string, title: string, notes: string): Promise<void>;
  pullRequestFor(branch: string): Promise<string | null>;
  closePullRequest(branch: string, comment: string): Promise<void>;
  reopen(number: number): Promise<void>;
  findByFingerprint(fingerprint: string): Promise<FingerprintIssue | null>;
  errorIssue(number: number): Promise<FingerprintIssue>;
  mergePullRequest(branch: string): Promise<void>;
}

export type InlineButton = { text: string; data: string };

export type AlbumPhoto = { path: string; caption: string };

export interface Telegram {
  sendMessage(chat: string, text: string, replyTo?: number | null): Promise<number>;
  sendButtons(chat: string, text: string, buttons: InlineButton[][]): Promise<number>;
  sendPhoto(chat: string, pngPath: string, caption: string, buttons?: InlineButton[][]): Promise<number>;
  sendPhotos(chat: string, photos: AlbumPhoto[], replyTo?: number): Promise<number[]>;
  sendDocument(chat: string, path: string, replyTo?: number): Promise<number>;
  editCaption(chat: string, messageId: number, caption: string): Promise<void>;
  editText(chat: string, messageId: number, text: string): Promise<void>;
}

export type AgentSession = { dir: string; id: string; resume: boolean };
export type AgentRun = { clone: string; dir: string; model: string; prompt: string; log: string; openNetwork?: boolean; mediaDir?: string; readOnly?: Record<string, string>; session?: AgentSession; skill?: string; effort?: string; disallowedTools?: string[]; advisor?: string };

export interface Container {
  agent(run: AgentRun): Promise<string>;
  shell(clone: string, script: string, log: string, env?: Record<string, string>, mounts?: Record<string, string>): Promise<void>;
}

export type MergeStep = { branch: string; into: string; message: string };

export interface HostRepo {
  path: string;
  fetch(): Promise<void>;
  createBranch(name: string, from: string): Promise<void>;
  revertIssueMerge(issue: number, branch: string, resolutions?: Resolution[]): Promise<boolean>;
  openConflict(dir: string, conflict: MergeConflictError | RevertConflictError): Promise<void>;
  closeConflict(dir: string, conflict: MergeConflictError | RevertConflictError): Promise<{ resolution: Resolution; diff: string }>;
  deleteBranch(branch: string): Promise<void>;
  prepareWorkClone(branch: string, base: string, dir: string): Promise<void>;
  cloneBranch(branch: string, dir: string): Promise<string>;
  untrackFactoryFiles(dir: string): Promise<string[]>;
  fetchFromWork(dir: string, branch: string): Promise<string>;
  push(commit: string, branch: string): Promise<void>;
  mergeBaseIntoWork(dir: string, base: string): Promise<{ commit: string; conflicts: string[] }>;
  catchUpBase(dir: string, base: string): Promise<{ commit: string | null; conflicts: string[]; kept: string | null }>;
  mergeBranchIntoWork(dir: string, branch: string, message?: string): Promise<{ commit: string | null; conflicts: string[] }>;
  isMerged(base: string, branch: string): Promise<boolean>;
  headHash(branch: string): Promise<string>;
  diff(base: string, branch: string): Promise<string>;
  changedFiles(base: string, branch: string): Promise<string[]>;
  readFile(branch: string, path: string): Promise<string>;
  hasNewCommits(base: string, branch: string): Promise<boolean>;
  merge(steps: MergeStep[], resolutions?: Resolution[]): Promise<void>;
  mergeLog(from: string, to: string): Promise<string[]>;
}

export type Resolution = { base: string; source: string; head: string };

export class MergeConflictError extends Error {
  constructor(readonly step: MergeStep, readonly files: string[], reason: string, readonly base: string, readonly source: string, readonly done: Resolution[] = []) {
    super(`merge of ${step.branch} into ${step.into} failed. Conflicting files: ${files.join(', ')}. ${reason}`);
  }

  get branch(): string {
    return this.step.branch;
  }

  get into(): string {
    return this.step.into;
  }
}

export class RevertConflictError extends Error {
  constructor(readonly issue: number, readonly into: string, readonly files: string[], reason: string, readonly base: string, readonly merge: string) {
    super(`revert of issue #${issue} on ${into} failed. Conflicting files: ${files.join(', ')}. ${reason}`);
  }
}

export type Ctx = {
  cfg: FactoryConfig;
  run: Run;
  github: GitHub;
  telegram: Telegram;
  container: Container;
  repo: HostRepo;
  statePath: string;
  now: () => Date;
  fetch?: typeof fetch;
  log: (stage: Stage, issue: number | null, msg: string) => void;
};

export const GAME_DIR = 'game';
export const FACTORY_DIR = 'factory';
export const BRANCH = (issue: number): string => `factory/issue-${issue}`;
export const TASK_DIR = '.factory-tasks';
export const TASK_FILE = (issue: number): string => `${TASK_DIR}/issue-${issue}.md`;
export const WORK_DIR = (home: string, issue: number): string => `${home}/work/issue-${issue}`;
export const OUT_DIR = '.factory';
export const MEDIA_DIR = '.factory-media';
export const STUCK_LABEL = 'factory-stuck';
export const WONT_DO_LABEL = 'wont-do';
export const MAINTENANCE_LABEL = 'maintenance';
export const RELEASE_LABEL = 'release';
export const RELEASE_TASK_LABEL = 'release-task';
export const isCleanupTask = (labels: string[]): boolean => labels.includes(RELEASE_TASK_LABEL) && labels.includes(MAINTENANCE_LABEL);
export const RELEASE_CANDIDATE_LABEL = 'release-candidate';
export const HOTFIX_LABEL = 'hotfix';
export const ADHOC_LABEL = 'adhoc';
export const WASTE_LABEL = 'factory-review';
export const BUG_LABEL = 'bug';
export const ERROR_REPORT_LABEL = 'error-report';
export const fingerprintLine = (fingerprint: string): string => `Error fingerprint: ${fingerprint}`;
export type FingerprintIssue = { number: number; state: 'OPEN' | 'CLOSED'; stateReason: string | null; closedAt: string | null };
export const BUNDLED_LABEL = 'bundled';
export const CANDIDATE_LABELS = ['feature-request', BUG_LABEL];
export const INCIDENT_LOG = 'docs/incident-log.md';
export const INCIDENT_BRANCH = (issue: number): string => `factory/incident-${issue}`;
export const NEEDS_INFO_LABEL = 'needs-info';
export const FACTORY_MARK = '<!-- roam-factory -->';
export const QUESTIONS_HEADING = '## Questions from the factory';
export const FEEDBACK_HEADING = '## Committee feedback';
export const QUESTION_HEADING = '## Committee question';
export const AGENT_NETWORK = 'roam-factory-agents';
export const PROXY_NAME = 'roam-factory-proxy';
export const PROXY_PORT = 8888;
export const DESIGN_SONNET_LABEL = 'design-sonnet';
export const IMPLEMENTATION_OPUS_LABEL = 'implementation-opus';
export const ROUTING_MARK = 'Model routing from triage:';
export const OPEN_NETWORK_LABEL = 'open-network';
