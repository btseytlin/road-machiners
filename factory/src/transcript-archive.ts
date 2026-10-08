import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const transcriptsDir = (home: string): string => join(home, 'transcripts');

export function archiveTranscripts(home: string, projects: string): void {
  if (!existsSync(projects)) return;
  const folders = readdirSync(projects, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(projects, entry.name));
  for (const folder of folders) {
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.jsonl'))) {
      const id = basename(file, '.jsonl');
      const target = join(transcriptsDir(home), id);
      cpSync(join(folder, file), join(target, file));
      if (existsSync(join(folder, id))) cpSync(join(folder, id), join(target, id), { recursive: true });
    }
  }
}

export function sweepTranscripts(home: string, now: Date, days: number): string[] {
  const root = transcriptsDir(home);
  if (!existsSync(root)) return [];
  const cutoff = now.getTime() - days * 24 * 3_600_000;
  const removed = readdirSync(root).filter((id) => statSync(join(root, id, `${id}.jsonl`)).mtimeMs < cutoff);
  for (const id of removed) rmSync(join(root, id), { recursive: true, force: true });
  return removed;
}
