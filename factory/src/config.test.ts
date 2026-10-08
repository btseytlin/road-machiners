import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, readEnvFiles } from './config';

const FULL = {
  FACTORY_OBSERVATION_HEARTBEAT_MS: '10000', FACTORY_OBSERVATION_MAX_EVENT_BYTES: '1048576',
  FACTORY_REPO: 'o/r', FACTORY_PROJECT_OWNER: 'o', FACTORY_PROJECT_NUMBER: '3', FACTORY_GITHUB_RETRIES: '3', FACTORY_GITHUB_RETRY_BASE_SECONDS: '15', FACTORY_GITHUB_TIMEOUT_SECONDS: '60', FACTORY_HOME: '/h', FACTORY_WEB_ROOT: '/w',
  FACTORY_PUBLIC_URL: 'http://x', FACTORY_IMAGE: 'img', FACTORY_GPU: 'on', CLAUDE_CODE_OAUTH_TOKEN: 't', ELEVENLABS_API_KEY: 'ek', SFX_MAX_GENERATIONS: '6', FACTORY_DESIGN_MODEL: 'opus',
  FACTORY_BUILD_MODEL: 'sonnet', FACTORY_MODEL_PRICES: 'opus=4/20/0.2/5/8 sonnet=2/10/0.2/2.5/4', FACTORY_MIN_VOTES: '5', FACTORY_MIN_AGE_HOURS: '24', FACTORY_NEEDS_INFO_HOURS: '24', FACTORY_COMMITTEE_BOOTSTRAP_GITHUB: 'boss',
  FACTORY_COMMITTEE_BOOTSTRAP: '1', TELEGRAM_BOT_TOKEN: 'bt', FACTORY_COMMITTEE_CHAT: '-1', FACTORY_PUBLIC_CHANNEL: '@c',
  FACTORY_TRIAGE_TIMEOUT_MINUTES: '30', FACTORY_DESIGN_TIMEOUT_MINUTES: '135', FACTORY_IMPLEMENT_TIMEOUT_MINUTES: '330', FACTORY_VERIFY_TIMEOUT_MINUTES: '240',
  FACTORY_TEST_TIMEOUT_MINUTES: '90', FACTORY_BRANCH_TIMEOUT_MINUTES: '60', FACTORY_JOB_MAX_MINUTES: '30', FACTORY_REPLY_ROUTE_MINUTES: '15', FACTORY_RELEASE_DAYS: '7', FACTORY_PLAYTEST_TURNS: '2250', FACTORY_PLAYTEST_RUNS: '4', FACTORY_PLAYTEST_TIMEOUT_MINUTES: '330', FACTORY_MERGE_TIMEOUT_MINUTES: '180', FACTORY_TESTING_BUDGET_USD: '10', FACTORY_MERGING_BUDGET_USD: '5', FACTORY_WASTE_REVIEW_DAYS: '7',
  ITCH_TARGET: 'u/g', BUTLER_API_KEY: 'bk', FACTORY_MAX_JOBS_PER_DAY: '10', FACTORY_MAX_JOBS_PER_CARD: '4',
  FACTORY_TRIAGE_WORKERS: '1', FACTORY_DESIGN_WORKERS: '1', FACTORY_IMPLEMENT_WORKERS: '2', FACTORY_VERIFY_WORKERS: '1', FACTORY_TEST_WORKERS: '1', FACTORY_TRIAGE_EFFORT: 'low', FACTORY_DESIGN_EFFORT: 'medium',
  FACTORY_MIN_FREE_GB: '5', FACTORY_MIN_AVAILABLE_GB: '1', FACTORY_LOG_DAYS: '14', FACTORY_TEST_CACHE_DAYS: '10',FACTORY_CPU_LIGHT: '0.25', FACTORY_CPU_IMPLEMENT: '0.25', FACTORY_CPU_TEST: '0.5', FACTORY_VITEST_WORKERS_IMPLEMENT: '2', FACTORY_VITEST_WORKERS_TEST: '4',
  FACTORY_ERROR_DAILY_ISSUES: '5', FACTORY_ERROR_DISK_MB: '2000', FACTORY_ERROR_MAP_DAYS: '14', FACTORY_ERROR_BODY_KB: '8192', FACTORY_ERROR_UNZIPPED_MB: '64', FACTORY_ERROR_IP_PER_HOUR: '20', FACTORY_ERROR_ORIGINS: 'https://html.itch.zone',
};

describe('loadConfig', () => {
  it('parses numbers and bootstrap member', () => {
    const cfg = loadConfig(FULL);
    expect(cfg.observationHeartbeatMs).toBe(10000);
    expect(cfg.observationMaxEventBytes).toBe(1048576);
    expect(cfg.minVotes).toBe(5);
    expect(cfg.needsInfoHours).toBe(24);
    expect(cfg.committeeBootstrapGithub).toBe('boss');
    expect(cfg.committeeBootstrapTelegram).toBe('1');
    expect(cfg.committeeChat).toBe('-1');
    expect(cfg.maxJobsPerDay).toBe(10);
    expect(cfg.maxJobsPerCard).toBe(4);
    expect(cfg.itchTarget).toBe('u/g');
    expect(cfg.sfxMaxGenerations).toBe(6);
    expect([cfg.triageWorkers, cfg.designWorkers, cfg.implementWorkers, cfg.verifyWorkers, cfg.testWorkers]).toEqual([1, 1, 2, 1, 1]);
    expect(cfg.triageEffort).toBe('low');
    expect(cfg.designEffort).toBe('medium');
    expect([cfg.minFreeGb, cfg.minAvailableGb, cfg.logDays, cfg.testCacheDays]).toEqual([5, 1, 14, 10]);
    expect([cfg.playtestTimeoutMinutes, cfg.mergeTimeoutMinutes]).toEqual([330, 180]);
  });

  it('reads token prices per model and requires one for each model the factory picks', () => {
    expect(loadConfig(FULL).tokenPrices.opus).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 });
    expect(() => loadConfig({ ...FULL, FACTORY_MODEL_PRICES: 'opus=4/20/0.2/5/8' })).toThrow('no price for sonnet');
    expect(() => loadConfig({ ...FULL, FACTORY_MODEL_PRICES: 'opus=4/20/0.2/5 sonnet=2/10/0.2/2.5/4' })).toThrow('entry "opus=4/20/0.2/5"');
  });

  it('requires the needs-info limit', () => {
    expect(() => loadConfig({ ...FULL, FACTORY_NEEDS_INFO_HOURS: '' })).toThrow('FACTORY_NEEDS_INFO_HOURS');
  });

  it('names every missing key', () => {
    expect(() => loadConfig({ ...FULL, FACTORY_REPO: '', TELEGRAM_BOT_TOKEN: undefined })).toThrow('FACTORY_REPO, TELEGRAM_BOT_TOKEN');
  });

  it('requires the cap key but leaves the itch keys to the release', () => {
    expect(() => loadConfig({ ...FULL, FACTORY_MAX_JOBS_PER_DAY: '' })).toThrow('FACTORY_MAX_JOBS_PER_DAY');
    const cfg = loadConfig({ ...FULL, ITCH_TARGET: '', BUTLER_API_KEY: undefined });
    expect([cfg.itchTarget, cfg.butlerKey]).toEqual([null, null]);
  });

  it('ignores FACTORY_MAINTENANCE_HOURS left in an old .env', () => {
    const cfg = loadConfig({ ...FULL, FACTORY_MAINTENANCE_HOURS: 'soon' });
    expect(cfg).not.toHaveProperty('maintenanceHours');
    expect(cfg.releaseDays).toBe(7);
  });

  it('rejects a bad number', () => {
    expect(() => loadConfig({ ...FULL, FACTORY_MIN_VOTES: 'many' })).toThrow('FACTORY_MIN_VOTES');
  });

  it('reads the GPU switch as on or off and rejects anything else', () => {
    expect(loadConfig(FULL).gpu).toBe(true);
    expect(loadConfig({ ...FULL, FACTORY_GPU: 'off' }).gpu).toBe(false);
    expect(() => loadConfig({ ...FULL, FACTORY_GPU: 'yes' })).toThrow('FACTORY_GPU must be on or off');
    expect(() => loadConfig({ ...FULL, FACTORY_GPU: '' })).toThrow('missing FACTORY_GPU');
  });

  it('reads the CPU shares and rejects shares that add up to more than the server', () => {
    const cfg = loadConfig(FULL);
    expect([cfg.cpuLight, cfg.cpuImplement, cfg.cpuTest]).toEqual([0.25, 0.25, 0.5]);
    expect(() => loadConfig({ ...FULL, FACTORY_CPU_TEST: '0.7' })).toThrow('add up to 1.2');
  });
});

describe('readEnvFiles', () => {
  const SECRET = /TOKEN|KEY|SECRET|PASSWORD/;

  function files(settings: string, local: string): [string, string] {
    mkdirSync('tmp', { recursive: true });
    const dir = mkdtempSync(join('tmp', 'factory-config-'));
    writeFileSync(join(dir, 'settings.env'), settings);
    writeFileSync(join(dir, '.env'), local);
    return [join(dir, 'settings.env'), join(dir, '.env')];
  }

  it('joins the two files and stops on a key in both', () => {
    expect(readEnvFiles(...files('A=1\n', 'B=2\n'))).toEqual({ A: '1', B: '2' });
    expect(() => readEnvFiles(...files('A=1\nB=1\n', 'B=2\n'))).toThrow('B set in both');
  });

  it('keeps every secret out of the tracked settings, and with .env.example covers the whole config', () => {
    const settings = readEnvFiles('settings.env', '.env.example');
    const tracked = Object.keys(readEnvFiles('settings.env', files('', '')[1]));
    expect(tracked.filter((key) => SECRET.test(key))).toEqual([]);
    const filled = Object.fromEntries(Object.keys(settings).map((key) => [key, settings[key] || (key === 'FACTORY_GPU' ? 'on' : '1')]));
    expect(() => loadConfig(filled)).not.toThrow();
  });
});
