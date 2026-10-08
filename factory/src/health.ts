import { readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs';

export const healthFile = (home: string): string => `${home}/health`;

export type Health = { at: string; freeGb: number; minFreeGb: number; availableGb: number | null; minAvailableGb: number };

export function freeGb(path: string): number {
  const stats = statfsSync(path);
  return Math.round((stats.bavail * stats.bsize) / 1e8) / 10;
}

export function availableGb(platform: string = process.platform, meminfo: string = '/proc/meminfo'): number | null {
  if (platform !== 'linux') return null;
  const kb = memAvailableKb(readFileSync(meminfo, 'utf8'), meminfo);
  return Math.round(kb / 1e5) / 10;
}

function memAvailableKb(text: string, source: string): number {
  const line = text.split('\n').find((row) => row.startsWith('MemAvailable:'));
  if (line === undefined) throw new Error(`${source} has no MemAvailable line.`);
  const kb = Number(line.replace(/\D+/g, ''));
  if (!Number.isInteger(kb) || kb <= 0) throw new Error(`${source} has a bad MemAvailable line "${line}".`);
  return kb;
}

export function writeHealth(home: string, minFreeGb: number, minAvailableGb: number, now: Date): Health {
  const health: Health = { at: now.toISOString(), freeGb: freeGb(home), minFreeGb, availableGb: availableGb(), minAvailableGb };
  const path = healthFile(home);
  writeFileSync(`${path}.new`, `${JSON.stringify(health)}\n`);
  renameSync(`${path}.new`, path);
  return health;
}
