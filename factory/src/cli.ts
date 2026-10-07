// The factory command line. Usage: npm run factory -- <tick | run <stage> <issue|-> | intake | command>
// Any other command is a Hermes command of ctl.ts. `help` lists them.
import { readEnvFiles } from './config';
import { realContext } from './context';
import { runCtl } from './ctl';
import { writeHealth } from './health';
import { drainInbox } from './inbox';
import { intake } from './intake';
import { runJob } from './job';
import { parseStage } from './jobs';
import { liftEndedPause, pausedReason } from './pause';
import { reportScheduler } from './observability';
import { tick } from './tick';
import { guardTick } from './tick-guard';

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
  return manage(ctx, args);
}

// A refused order is an answer for Hermes, not a crash, so it prints the reason alone and exits nonzero.
async function manage(ctx: ReturnType<typeof realContext>, args: string[]): Promise<void> {
  try {
    await runCtl(ctx, args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Lifts a pause whose process ended, then tells whether the tick must skip.
function paused(ctx: ReturnType<typeof realContext>): boolean {
  const lifted = liftEndedPause(ctx.cfg.home);
  if (lifted !== null) ctx.log('tick', null, `pause lifted, its process ended: ${lifted.replaceAll('\n', ' ')}`);
  const reason = pausedReason(ctx.cfg.home);
  if (reason !== null) ctx.log('tick', null, `paused: ${reason}`);
  return reason !== null;
}

function parseIssue(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`"${value}" is not an issue number or change id.`);
  return number;
}

await main(process.argv.slice(2).filter((arg) => arg !== '--'));
