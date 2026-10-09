import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { FactoryConfig, TokenPrice } from './types';

export function readEnvFiles(settingsPath: string, localPath: string): Record<string, string> {
  const settings = parseEnv(readFileSync(settingsPath, 'utf8'));
  const local = parseEnv(readFileSync(localPath, 'utf8'));
  const both = Object.keys(settings).filter((key) => key in local);
  if (both.length > 0) throw new Error(`${both.join(', ')} set in both ${settingsPath} and ${localPath}. Keep each key in one file.`);
  return { ...settings, ...local } as Record<string, string>;
}

const KEYS = {
  observationHeartbeatMs: 'FACTORY_OBSERVATION_HEARTBEAT_MS',
  observationMaxEventBytes: 'FACTORY_OBSERVATION_MAX_EVENT_BYTES',
  repo: 'FACTORY_REPO',
  projectOwner: 'FACTORY_PROJECT_OWNER',
  projectNumber: 'FACTORY_PROJECT_NUMBER',
  githubRetries: 'FACTORY_GITHUB_RETRIES',
  githubRetryBaseSeconds: 'FACTORY_GITHUB_RETRY_BASE_SECONDS',
  githubTimeoutSeconds: 'FACTORY_GITHUB_TIMEOUT_SECONDS',
  home: 'FACTORY_HOME',
  webRoot: 'FACTORY_WEB_ROOT',
  publicUrl: 'FACTORY_PUBLIC_URL',
  image: 'FACTORY_IMAGE',
  gpu: 'FACTORY_GPU',
  oauthToken: 'CLAUDE_CODE_OAUTH_TOKEN',
  elevenlabsKey: 'ELEVENLABS_API_KEY',
  sfxMaxGenerations: 'SFX_MAX_GENERATIONS',
  designModel: 'FACTORY_DESIGN_MODEL',
  buildModel: 'FACTORY_BUILD_MODEL',
  triageModel: 'FACTORY_TRIAGE_MODEL',
  advisorModel: 'FACTORY_ADVISOR_MODEL',
  triageEffort: 'FACTORY_TRIAGE_EFFORT',
  designEffort: 'FACTORY_DESIGN_EFFORT',
  tokenPrices: 'FACTORY_MODEL_PRICES',
  minVotes: 'FACTORY_MIN_VOTES',
  minAgeHours: 'FACTORY_MIN_AGE_HOURS',
  needsInfoHours: 'FACTORY_NEEDS_INFO_HOURS',
  committeeBootstrapTelegram: 'FACTORY_COMMITTEE_BOOTSTRAP',
  committeeBootstrapGithub: 'FACTORY_COMMITTEE_BOOTSTRAP_GITHUB',
  telegramToken: 'TELEGRAM_BOT_TOKEN',
  committeeChat: 'FACTORY_COMMITTEE_CHAT',
  publicChannel: 'FACTORY_PUBLIC_CHANNEL',
  triageTimeoutMinutes: 'FACTORY_TRIAGE_TIMEOUT_MINUTES',
  designTimeoutMinutes: 'FACTORY_DESIGN_TIMEOUT_MINUTES',
  implementTimeoutMinutes: 'FACTORY_IMPLEMENT_TIMEOUT_MINUTES',
  verifyTimeoutMinutes: 'FACTORY_VERIFY_TIMEOUT_MINUTES',
  testTimeoutMinutes: 'FACTORY_TEST_TIMEOUT_MINUTES',
  branchTimeoutMinutes: 'FACTORY_BRANCH_TIMEOUT_MINUTES',
  agentJobMaxMinutes: 'FACTORY_JOB_MAX_MINUTES',
  replyRouteMinutes: 'FACTORY_REPLY_ROUTE_MINUTES',
  releaseDays: 'FACTORY_RELEASE_DAYS',
  playtestTurns: 'FACTORY_PLAYTEST_TURNS',
  playtestRuns: 'FACTORY_PLAYTEST_RUNS',
  playtestTimeoutMinutes: 'FACTORY_PLAYTEST_TIMEOUT_MINUTES',
  mergeTimeoutMinutes: 'FACTORY_MERGE_TIMEOUT_MINUTES',
  checksTimeoutMinutes: 'FACTORY_CHECKS_TIMEOUT_MINUTES',
  testingBudgetUsd: 'FACTORY_TESTING_BUDGET_USD',
  mergingBudgetUsd: 'FACTORY_MERGING_BUDGET_USD',
  wasteReviewDays: 'FACTORY_WASTE_REVIEW_DAYS',
  itchTarget: 'ITCH_TARGET',
  butlerKey: 'BUTLER_API_KEY',
  maxJobsPerCard: 'FACTORY_MAX_JOBS_PER_CARD',
  triageWorkers: 'FACTORY_TRIAGE_WORKERS',
  designWorkers: 'FACTORY_DESIGN_WORKERS',
  implementWorkers: 'FACTORY_IMPLEMENT_WORKERS',
  verifyWorkers: 'FACTORY_VERIFY_WORKERS',
  testWorkers: 'FACTORY_TEST_WORKERS',
  minFreeGb: 'FACTORY_MIN_FREE_GB',
  minAvailableGb: 'FACTORY_MIN_AVAILABLE_GB',
  logDays: 'FACTORY_LOG_DAYS',
  transcriptDays: 'FACTORY_TRANSCRIPT_DAYS',
  testCacheDays: 'FACTORY_TEST_CACHE_DAYS',
  cpuLight: 'FACTORY_CPU_LIGHT',
  cpuImplement: 'FACTORY_CPU_IMPLEMENT',
  cpuTest: 'FACTORY_CPU_TEST',
  vitestWorkersImplement: 'FACTORY_VITEST_WORKERS_IMPLEMENT',
  vitestWorkersTest: 'FACTORY_VITEST_WORKERS_TEST',
  errorDailyIssues: 'FACTORY_ERROR_DAILY_ISSUES',
  errorDiskMb: 'FACTORY_ERROR_DISK_MB',
  errorMapDays: 'FACTORY_ERROR_MAP_DAYS',
  errorBodyKb: 'FACTORY_ERROR_BODY_KB',
  errorUnzippedMb: 'FACTORY_ERROR_UNZIPPED_MB',
  errorIpPerHour: 'FACTORY_ERROR_IP_PER_HOUR',
  errorOrigins: 'FACTORY_ERROR_ORIGINS',
} as const satisfies Record<keyof FactoryConfig, string>;

const RELEASE_ONLY = new Set<keyof FactoryConfig>(['itchTarget', 'butlerKey']);

const NUMBERS = new Set<keyof FactoryConfig>(['observationHeartbeatMs', 'observationMaxEventBytes', 'projectNumber', 'githubRetries', 'githubRetryBaseSeconds', 'githubTimeoutSeconds','sfxMaxGenerations', 'minVotes', 'minAgeHours', 'needsInfoHours', 'triageTimeoutMinutes', 'designTimeoutMinutes', 'implementTimeoutMinutes', 'verifyTimeoutMinutes', 'testTimeoutMinutes', 'branchTimeoutMinutes', 'agentJobMaxMinutes', 'replyRouteMinutes', 'releaseDays', 'playtestTurns', 'playtestRuns', 'playtestTimeoutMinutes', 'mergeTimeoutMinutes', 'checksTimeoutMinutes', 'testingBudgetUsd', 'mergingBudgetUsd', 'wasteReviewDays','maxJobsPerCard', 'triageWorkers', 'designWorkers', 'implementWorkers', 'verifyWorkers', 'testWorkers', 'minFreeGb', 'minAvailableGb', 'logDays', 'transcriptDays', 'testCacheDays', 'cpuLight', 'cpuImplement', 'cpuTest', 'vitestWorkersImplement', 'vitestWorkersTest', 'errorDailyIssues', 'errorDiskMb', 'errorMapDays', 'errorBodyKb', 'errorUnzippedMb', 'errorIpPerHour']);

export function loadConfig(env: Record<string, string | undefined>): FactoryConfig {
  const missing = Object.entries(KEYS).filter(([field, key]) => !RELEASE_ONLY.has(field as keyof FactoryConfig) && !env[key]?.trim()).map(([, key]) => key);
  if (missing.length) throw new Error(`Factory config is missing ${missing.join(', ')}. See settings.env and .env.example.`);
  const entries = Object.entries(KEYS).map(([field, key]) => [field, read(field as keyof FactoryConfig, key, env[key]?.trim())]);
  const cfg = Object.fromEntries(entries) as FactoryConfig;
  checkCpuShares(cfg);
  checkPrices(cfg);
  return cfg;
}

function checkPrices(cfg: FactoryConfig): void {
  const unpriced = [cfg.designModel, cfg.buildModel, cfg.triageModel, cfg.advisorModel].filter((model) => !(model in cfg.tokenPrices));
  if (unpriced.length) throw new Error(`FACTORY_MODEL_PRICES has no price for ${unpriced.join(', ')}.`);
}

const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const;

function parsePrices(key: string, raw: string): Record<string, TokenPrice> {
  return Object.fromEntries(raw.split(/\s+/).map((entry) => {
    const [model, rates] = entry.split('=');
    const values = (rates ?? '').split('/').map(Number);
    if (!model || values.length !== PRICE_FIELDS.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error(`${key} entry "${entry}" must be model=input/output/cacheRead/cacheWrite5m/cacheWrite1h in dollars per million tokens.`);
    }
    return [model, Object.fromEntries(PRICE_FIELDS.map((field, index) => [field, values[index]])) as TokenPrice];
  }));
}

function checkCpuShares(cfg: FactoryConfig): void {
  const sum = cfg.cpuLight + cfg.cpuImplement + cfg.cpuTest;
  if (sum > 1) throw new Error(`FACTORY_CPU_LIGHT, FACTORY_CPU_IMPLEMENT and FACTORY_CPU_TEST add up to ${sum}. They split the server's CPUs, so they must add up to 1 or less.`);
}

function read(field: keyof FactoryConfig, key: string, raw: string | undefined): string | number | boolean | Record<string, TokenPrice> | null {
  return raw ? parse(field, key, raw) : null;
}

function parse(field: keyof FactoryConfig, key: string, raw: string): string | number | boolean | Record<string, TokenPrice> {
  if (field === 'gpu') return onOff(key, raw);
  if (field === 'tokenPrices') return parsePrices(key, raw);
  if (!NUMBERS.has(field)) return raw;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number, got "${raw}".`);
  return value;
}

function onOff(key: string, raw: string): boolean {
  if (raw === 'on') return true;
  if (raw === 'off') return false;
  throw new Error(`${key} must be on or off, got "${raw}".`);
}
