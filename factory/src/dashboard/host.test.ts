import { describe, expect, it } from 'vitest';
import { computeCpuUsage, parseMemory, parseGpu, computeStorage } from './host';

describe('host load', () => {
  it('measures CPU from interval counters rather than lifetime averages', () => {
    expect(computeCpuUsage({ total: 1000, idle: 500 }, { total: 1200, idle: 550 })).toBe(75);
    expect(computeCpuUsage(null, { total: 1200, idle: 550 })).toBeNull();
    expect(() => computeCpuUsage({ total: 1200, idle: 550 }, { total: 1000, idle: 500 })).toThrow();
  });
  it('counts reclaimable Linux memory as available', () => {
    expect(parseMemory('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\n')).toEqual({ total: 1024000, used: 614400, free: 409600 });
    expect(() => parseMemory('MemTotal: 1000 kB')).toThrow('MemAvailable');
  });
  it('reads each NVIDIA GPU, including video memory', () => {
    expect(parseGpu('0, NVIDIA RTX 4090, 73, 6144, 24576\n')).toEqual([{ index: 0, name: 'NVIDIA RTX 4090', utilization: 73, memory: { used: 6144 * 1048576, total: 24576 * 1048576, free: 18432 * 1048576 } }]);
    expect(() => parseGpu('0, NVIDIA, [N/A], 1, 2')).toThrow();
    expect(() => parseGpu('')).toThrow();
  });
  it('measures the factory volume and distinguishes used, available and reserved bytes', () => {
    expect(computeStorage({ bsize: 4096, blocks: 100, bfree: 30, bavail: 25 })).toEqual({ total: 409600, used: 286720, free: 102400, reserved: 20480 });
    expect(() => computeStorage({ bsize: 4096, blocks: 100, bfree: 101, bavail: 25 })).toThrow();
  });
});
