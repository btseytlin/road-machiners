import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { Run, RunResult } from './types';

// Runs a program without a shell and collects its output. With logPath, output also streams to that file.
export const realRun: Run = (cmd, args, opts = {}) => new Promise((done, fail) => {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
  const log = opts.logPath ? createWriteStream(opts.logPath, { flags: 'a' }) : null;
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; log?.write(chunk); opts.onStdout?.(chunk.toString()); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; log?.write(chunk); });
  child.on('error', fail);
  // The log is flushed before the result, so a caller can read the end of it at once.
  child.on('close', (code) => {
    const result = { code: code ?? 1, stdout, stderr };
    if (log) log.end(() => done(result));
    else done(result);
  });
  if (opts.input !== undefined) child.stdin.end(opts.input);
  else child.stdin.end();
});

// Throws with the command's own error text when it failed.
export function must(result: RunResult, what: string): string {
  if (result.code !== 0) throw new Error(`${what} failed with exit ${result.code}: ${(result.stderr || result.stdout).trim().slice(-2000)}`);
  return result.stdout;
}
