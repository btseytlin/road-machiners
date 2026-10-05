import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { availableGb, healthFile, writeHealth } from './health';

describe('writeHealth', () => {
  it('writes the time, the free space, the available memory and their minimums, and returns them', () => {
    const home = mkdtempSync(join(tmpdir(), 'health-'));
    const now = new Date('2026-01-10T12:00:00Z');
    const health = writeHealth(home, 5, 1, now);
    expect(JSON.parse(readFileSync(healthFile(home), 'utf8'))).toEqual(health);
    expect(health.at).toBe('2026-01-10T12:00:00.000Z');
    expect(health.minFreeGb).toBe(5);
    expect(health.minAvailableGb).toBe(1);
    expect(health.freeGb).toBeGreaterThan(0);
    if (process.platform === 'linux') expect(health.availableGb).toBeGreaterThan(0);
    else expect(health.availableGb).toBeNull();
  });
});

describe('availableGb', () => {
  const meminfo = (text: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), 'meminfo-')), 'meminfo');
    writeFileSync(path, text);
    return path;
  };

  it('reads MemAvailable in GB, not MemFree', () => {
    expect(availableGb('linux', meminfo('MemTotal: 16288000 kB\nMemFree: 240000 kB\nMemAvailable: 9758000 kB\n'))).toBe(9.8);
  });

  it('gives null off Linux, where no memory reading exists', () => {
    expect(availableGb('darwin', '/nonexistent')).toBeNull();
  });

  it('fails loud on a file with no usable MemAvailable line', () => {
    expect(() => availableGb('linux', meminfo('MemTotal: 1 kB\n'))).toThrow('no MemAvailable');
    expect(() => availableGb('linux', meminfo('MemAvailable: 0 kB\n'))).toThrow('bad MemAvailable');
  });
});
