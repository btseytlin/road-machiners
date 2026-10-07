import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { FactoryConfig, TokenPrice } from './types';

// Git tracks settings.env, so the server runs main's settings. `local` holds secrets and host paths and never leaves its host.
// A key in both would leave one of them dead, so it stops the factory.
export function readEnvFiles(settingsPath: string, localPath: string): Record<string, string> {
  const settings = parseEnv(readFileSync(settingsPath, 'utf8'));
  const local = parseEnv(readFileSync(localPath, 'utf8'));
  const both = Object.keys(settings).filter((key) => key in local);
  if (both.length > 0) throw new Error(`${both.join(', ')} set in both ${settingsPath} and ${localPath}. Keep each key in one file.`);
  return { ...settings, ...local } as Record<string, string>;
}

// Every key is required, except the itch keys. A missing key stops the factory before it touches GitHub or Telegram.
// Only the release uses the itch keys, so without them the release alone fails loud.
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
  triageEffort: 'FACTORY_TRIAGE_EFFORT',
  designEffort: 'FACTORY_DESIGN_EFFORT',
  tokenPrices: 'FACTORY_MODEL_PRICES',
  minVotes: 'FACTORY_MIN_VOTES',
  minAgeHours: 'FACTORY_MIN_AGE_HOURS',
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
  wasteReviewDays: 'FACTORY_WASTE_REVIEW_DAYS',
  itchTarget: 'ITCH_TARGET',
  butlerKey: 'BUTLER_API_KEY',
  maxJobsPerDay: 'FACTORY_MAX_JOBS_PER_DAY',
  maxJobsPerCard: 'FACTORY_MAX_JOBS_PER_CARD',
  triageWorkers: 'FACTORY_TRIAGE_WORKERS',
  designWorkers: 'FACTORY_DESIGN_WORKERS',
  implementWorkers: 'FACTORY_IMPLEMENT_WORKERS',
  verifyWorkers: 'FACTORY_VERIFY_WORKERS',
  testWorkers: 'FACTORY_TEST_WORKERS',
  minFreeGb: 'FACTORY_MIN_FREE_GB',
  minAvailableGb: 'FACTORY_MIN_AVAILABLE_GB',
  logDays: 'FACTORY_LOG_DAYS',
  cpuLight: 'FACTORY_CPU_LIGHT',
  cpuImplement: 'FACTORY_CPU_IMPLEMENT',
  cpuTest: 'FACTORY_CPU_TEST',
  vitestWorkersImplement: 'FACTORY_VITEST_WORKERS_IMPLEMENT',
  vitestWorkersTest: 'FACTORY_VITEST_WORKERS_TEST',
} as const satisfies Record<keyof FactoryConfig, string>;

const RELEASE_ONLY = new Set<keyof FactoryConfig>(['itchTarget', 'butlerKey']);

const NUMBERS = new Set<keyof FactoryConfig>(['observationHeartbeatMs', 'observationMaxEventBytes', 'projectNumber', 'githubRetries', 'githubRetryBaseSeconds', 'githubTimeoutSeconds','sfxMaxGenerations', 'minVotes', 'minAgeHours', 'triageTimeoutMinutes', 'designTimeoutMinutes', 'implementTimeoutMinutes', 'verifyTimeoutMinutes', 'testTimeoutMinutes', 'branchTimeoutMinutes', 'agentJobMaxMinutes', 'replyRouteMinutes', 'releaseDays', 'playtestTurns', 'playtestRuns', 'wasteReviewDays', 'maxJobsPerDay', 'maxJobsPerCard', 'triageWorkers', 'designWorkers', 'implementWorkers', 'verifyWorkers', 'testWorkers', 'minFreeGb', 'minAvailableGb', 'logDays', 'cpuLight', 'cpuImplement', 'cpuTest', 'vitestWorkersImplement', 'vitestWorkersTest']);

export function loadConfig(env: Record<string, string | undefined>): FactoryConfig {
  const missing = Object.entries(KEYS).filter(([field, key]) => !RELEASE_ONLY.has(field as keyof FactoryConfig) && !env[key]?.trim()).map(([, key]) => key);
  if (missing.length) throw new Error(`Factory config is missing ${missing.join(', ')}. See settings.env and .env.example.`);
  const entries = Object.entries(KEYS).map(([field, key]) => [field, read(field as keyof FactoryConfig, key, env[key]?.trim())]);
  const cfg = Object.fromEntries(entries) as FactoryConfig;
  checkCpuShares(cfg);
  checkPrices(cfg);
  return cfg;
}

// Every model the factory picks must have a price, so a run cut off before its result can still be priced.
function checkPrices(cfg: FactoryConfig): void {
  const unpriced = [cfg.designModel, cfg.buildModel].filter((model) => !(model in cfg.tokenPrices));
  if (unpriced.length) throw new Error(`FACTORY_MODEL_PRICES has no price for ${unpriced.join(', ')}.`);
}

const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const;

// "model=input/output/cacheRead/cacheWrite5m/cacheWrite1h", one entry per model, separated by spaces.
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

// The pools split the server, so their shares cannot add up to more than all of it.
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
