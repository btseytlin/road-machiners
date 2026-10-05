import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { must } from './exec';
import type { Run } from './types';

// The job process gets its id in this variable, and its containers carry it as a label.
export const JOB_ID_ENV = 'FACTORY_JOB_ID';
export const jobLabel = (id: string): string => `factory-job=${id}`;

// The job process gets the CPUs of its pool in this variable, as a cpuset string, and pins its containers to them.
export const JOB_CPUS_ENV = 'FACTORY_JOB_CPUS';

// Starts `factory run <args>` detached, with output appended to the log. Returns its pid.
export function spawnJob(args: string[], cwd: string, log: string, id: string, cpus: string): number {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  try {
    const env = { ...process.env, [JOB_ID_ENV]: id, [JOB_CPUS_ENV]: cpus };
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
  return listed.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Other jobs run beside this one, so only the containers with its label go.
export async function killJob(run: Run, pid: number, id: string): Promise<void> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await removeJobContainers(run, id);
}

// A dead job's containers may still run, since the docker client's death does not stop them. Its pid may belong to another process by now, so nothing is signaled.
export async function removeJobContainers(run: Run, id: string): Promise<void> {
  for (const container of await jobContainers(run, id)) {
    must(await run('docker', ['rm', '-f', container]), `docker rm ${container}`);
  }
}
