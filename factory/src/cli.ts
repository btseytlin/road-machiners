// The factory command line. Usage: npm run factory -- <tick | run <stage> <issue|-> | intake | waive-fps <issue> <member> <reason>>
import { readEnvFiles } from './config';
import { realContext } from './context';
import { writeHealth } from './health';
import { grantFpsWaiver } from './fps-waiver';
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
  const [command] = args;
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
  if (Object.hasOwn(COMMANDS, command)) return COMMANDS[command](ctx, args.slice(1));
  throw new Error(`Unknown command "${command}". Use tick, run <stage> <issue|->, intake, or waive-fps <issue> <member> <reason>.`);
}

type Context = ReturnType<typeof realContext>;

// The commands besides the tick, each with the words after its name. Hermes runs waive-fps on a member's explicit word, as docs/operations.md says.
const COMMANDS: Record<string, (ctx: Context, args: string[]) => Promise<void>> = {
  intake: async (ctx) => void (await intake(ctx)),
  run: (ctx, [stage, issue]) => runJob(ctx, parseStage(stage), issue === '-' ? null : parseIssue(issue)),
  'waive-fps': async (ctx, [issue, member = '', ...reason]) => console.log(await grantFpsWaiver(ctx, parseIssue(issue), member, reason.join(' '))),
};

// Lifts a pause whose process ended, then tells whether the tick must skip.
function paused(ctx: Context): boolean {
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
