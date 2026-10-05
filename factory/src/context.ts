import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config';
import { dockerContainer } from './container';
import { realRun } from './exec';
import { JOB_CPUS_ENV, JOB_ID_ENV } from './jobs';
import { ghClient } from './github';
import { hostRepo } from './repo';
import { botClient } from './telegram';
import type { Ctx } from './types';

// Builds the real context from the environment. Missing config stops here, before any action.
export function realContext(env: Record<string, string | undefined>): Ctx {
  const cfg = loadConfig(env);
  const stateDir = join(cfg.home, 'state');
  mkdirSync(stateDir, { recursive: true });
  return {
    cfg,
    run: realRun,
    github: ghClient(realRun, cfg),
    telegram: botClient(cfg.telegramToken, fetch),
    container: dockerContainer(realRun, cfg, env[JOB_ID_ENV] ?? null, env[JOB_CPUS_ENV] ?? null),
    repo: hostRepo(realRun, cfg),
    statePath: join(stateDir, 'state.json'),
    now: () => new Date(),
    log: (stage, issue, msg) => console.log(`${new Date().toISOString()} [${stage}${issue === null ? '' : ` #${issue}`}] ${msg}`),
  };
}
