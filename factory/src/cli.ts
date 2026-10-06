// The factory command line. Usage: npm run factory -- <tick | run <stage> <issue|-> | intake>
import { readEnvFiles } from './config';
import { realContext } from './context';
import { writeHealth } from './health';
import { drainInbox } from './inbox';
import { intake } from './intake';
import { runJob } from './job';
import { liftEndedPause, pausedReason } from './pause';
import { reportScheduler } from './observability';
import { tick } from './tick';
import { guardTick } from './tick-guard';
import type { JobStage } from './types';

const JOB_STAGES: JobStage[] = ['triage', 'design', 'implement', 'patch', 'verify', 'checks', 'release', 'candidate', 'ship', 'remove', 'approve', 'change', 'adhoc', 'incident', 'dev', 'waste'];

// The process env wins, like loadEnvFile, so a job keeps what its tick passed down.
function loadEnv(): void {
  for (const [key, value] of Object.entries(readEnvFiles('settings.env', '.env'))) process.env[key] ??= value;
}

async function main(args: string[]): Promise<void> {
  loadEnv();
  const ctx = realContext(process.env);
  const codeDir = process.cwd();
  const [command, stage, issue] = args;
  if (command === 'tick') {
    writeHealth(ctx.cfg.home, ctx.cfg.minFreeGb, ctx.cfg.minAvailableGb, ctx.now());
    if (paused(ctx)) {
      reportScheduler(ctx.cfg.home, 'paused', ctx.now());
      return;
    }
    return guardTick(ctx, async () => {
      await drainInbox(ctx);
      await tick(ctx, codeDir);
    });
  }
  if (command === 'intake') return void (await intake(ctx));
  if (command === 'run') return runJob(ctx, parseStage(stage), issue === '-' ? null : parseIssue(issue));
  throw new Error(`Unknown command "${command}". Use tick, run <stage> <issue|->, or intake.`);
}

// Lifts a pause whose process ended, then tells whether the tick must skip.
function paused(ctx: ReturnType<typeof realContext>): boolean {
  const lifted = liftEndedPause(ctx.cfg.home);
  if (lifted !== null) ctx.log('tick', null, `pause lifted, its process ended: ${lifted.replaceAll('\n', ' ')}`);
  const reason = pausedReason(ctx.cfg.home);
  if (reason !== null) ctx.log('tick', null, `paused: ${reason}`);
  return reason !== null;
}

function parseStage(value: string | undefined): JobStage {
  if (!JOB_STAGES.includes(value as JobStage)) throw new Error(`Unknown stage "${value}". Use one of ${JOB_STAGES.join(', ')}.`);
  return value as JobStage;
}

function parseIssue(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`"${value}" is not an issue number or change id.`);
  return number;
}

await main(process.argv.slice(2).filter((arg) => arg !== '--'));
