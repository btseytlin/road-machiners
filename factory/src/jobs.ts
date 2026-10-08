import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { must } from './exec';
import { QUEUE_OF, type JobStage, type Run } from './types';

const JOB_STAGES = Object.keys(QUEUE_OF) as JobStage[];

export function parseStage(value: string | undefined): JobStage {
  if (!JOB_STAGES.includes(value as JobStage)) throw new Error(`Unknown stage "${value}". Use one of ${JOB_STAGES.join(', ')}.`);
  return value as JobStage;
}

export const JOB_ID_ENV = 'FACTORY_JOB_ID';
export const jobLabel = (id: string): string => `factory-job=${id}`;

export const JOB_CPUS_ENV = 'FACTORY_JOB_CPUS';
export const JOB_TEST_WORKERS_ENV = 'FACTORY_JOB_TEST_WORKERS';

export function spawnJob(args: string[], cwd: string, log: string, id: string, cpus: string, testWorkers: number | null): number {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  try {
    const workers = testWorkers === null ? {} : { [JOB_TEST_WORKERS_ENV]: String(testWorkers) };
    const env = { ...process.env, [JOB_ID_ENV]: id, [JOB_CPUS_ENV]: cpus, ...workers };
    const child = spawn('npm', ['run', '-s', 'factory', '--', 'run', ...args], { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    if (child.pid === undefined) throw new Error('job process did not start');
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function jobContainers(run: Run, id: string): Promise<string[]> {
  const listed = must(await run('docker', ['ps', '-q', '--filter', `label=${jobLabel(id)}`]), 'docker ps');
  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function killJob(run: Run, pid: number, id: string): Promise<void> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await removeJobContainers(run, id);
}

export async function removeJobContainers(run: Run, id: string): Promise<void> {
  for (const container of await jobContainers(run, id)) {
    must(await run('docker', ['rm', '-f', container]), `docker rm ${container}`);
  }
}
