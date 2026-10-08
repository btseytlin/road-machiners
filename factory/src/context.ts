import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config';
import { dockerContainer } from './container';
import { realRun } from './exec';
import { createObservedRun } from './activity';
import { JOB_CPUS_ENV, JOB_ID_ENV, JOB_TEST_WORKERS_ENV } from './jobs';
import { ghClient } from './github';
import { hostRepo } from './repo';
import { botClient } from './telegram';
import type { Ctx } from './types';

function testWorkersFrom(env: Record<string, string | undefined>): number | null {
  const raw = env[JOB_TEST_WORKERS_ENV];
  if (raw === undefined) return null;
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1) throw new Error(`${JOB_TEST_WORKERS_ENV} must be a whole number of 1 or more, got "${raw}".`);
  return workers;
}

export function realContext(env: Record<string, string | undefined>): Ctx {
  const cfg = loadConfig(env);
  const stateDir = join(cfg.home, 'state');
  mkdirSync(stateDir, { recursive: true });
  const jobId = env[JOB_ID_ENV] ?? null;
  const run = jobId === null ? realRun : createObservedRun(realRun, cfg.home, jobId, cfg.observationHeartbeatMs, cfg.observationMaxEventBytes);
  return {
    cfg,
    run,
    github: ghClient(run, cfg),
    telegram: botClient(cfg.telegramToken, fetch),
    container: dockerContainer(run, cfg, jobId, env[JOB_CPUS_ENV] ?? null, testWorkersFrom(env)),
    repo: hostRepo(run, cfg, jobId),
    statePath: join(stateDir, 'state.json'),
    now: () => new Date(),
    log: (stage, issue, msg) => console.log(`${new Date().toISOString()} [${stage}${issue === null ? '' : ` #${issue}`}] ${msg}`),
  };
}
