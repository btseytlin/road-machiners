import { execFile } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { promisify } from 'node:util';
import { readContainerResources, type ContainerResource } from './resources';

const runFile = promisify(execFile);
export type Capacity = { used: number; total: number; free: number };
export type CpuCounters = { total: number; idle: number };
export type Gpu = { index: number; name: string; utilization: number; memory: Capacity };
export type Reading<T> = { value: T | null; at: string | null; status: 'ok' | 'unavailable'; error: string | null };
export type HostLoad = { cpu: Reading<number>; ram: Reading<Capacity>; gpu: Reading<Gpu[]>; ssd: Reading<Capacity & { reserved: number }>; containers?: Reading<ContainerResource[]> };

function requireRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error('Invalid host measurement');
  return value;
}
export function computeCpuUsage(previous: CpuCounters | null, current: CpuCounters): number | null {
  if (previous === null) return null;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  if (total <= 0) throw new Error('CPU counters did not advance');
  return requireRange(100 * (1 - idle / total), 0, 100);
}
function readCpuCounters(): CpuCounters {
  const cores = cpus();
  if (!cores.length) throw new Error('CPU counters unavailable');
  return cores.reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}
export function parseMemory(text: string): Capacity {
  const read = (key: string): number => {
    const match = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(text);
    if (!match) throw new Error(`Missing ${key}`);
    return Number(match[1]) * 1024;
  };
  const total = read('MemTotal');
  const free = requireRange(read('MemAvailable'), 0, total);
  return { total, free, used: total - free };
}
function parseGpuRow(line: string): Gpu {
  const fields = line.split(',').map((field) => field.trim());
  if (fields.length !== 5 || fields.some((field) => field === '')) throw new Error('Invalid GPU reading');
  const [index, name, utilization, used, total] = fields;
  const memoryTotal = requireRange(Number(total), 1, Number.MAX_SAFE_INTEGER) * 1048576;
  const memoryUsed = requireRange(Number(used) * 1048576, 0, memoryTotal);
  return { index: requireRange(Number(index), 0, Number.MAX_SAFE_INTEGER), name, utilization: requireRange(Number(utilization), 0, 100), memory: { total: memoryTotal, used: memoryUsed, free: memoryTotal - memoryUsed } };
}
export function parseGpu(text: string): Gpu[] {
  if (!text.trim()) throw new Error('No NVIDIA GPUs reported');
  return text.trim().split('\n').map(parseGpuRow);
}
export function computeStorage(stat: { bsize: number; blocks: number; bfree: number; bavail: number }): Capacity & { reserved: number } {
  const total = requireRange(stat.bsize * stat.blocks, 1, Number.MAX_SAFE_INTEGER);
  const allFree = requireRange(stat.bsize * stat.bfree, 0, total);
  const free = requireRange(stat.bsize * stat.bavail, 0, allFree);
  return { total, used: total - allFree, free, reserved: allFree - free };
}
async function readSafely<T>(name: string, read: () => Promise<T | null>): Promise<Reading<T>> {
  try {
    const value = await read();
    if (value === null) return { value: null, status: 'unavailable', at: null, error: `${name}: awaiting sample` };
    return { value, status: 'ok', at: new Date().toISOString(), error: null };
  } catch (error) {
    console.error(`Dashboard ${name}:`, error);
    return { value: null, status: 'unavailable', at: null, error: `${name}: unavailable` };
  }
}

export class HostSampler {
  private previous: CpuCounters | null = null;
  constructor(private readonly home: string, private readonly timeoutMs: number) {}
  private sampleCpu(): number | null {
    const current = readCpuCounters();
    const previous = this.previous;
    this.previous = current;
    return computeCpuUsage(previous, current);
  }
  private async readRam(): Promise<Capacity> {
    if (platform() === 'linux') return parseMemory(await readFile('/proc/meminfo', 'utf8'));
    const total = totalmem();
    const free = freemem();
    return { total, free, used: total - free };
  }
  async sample(): Promise<HostLoad> {
    const [cpu, ram, gpu, ssd, containers] = await Promise.all([
      readSafely('CPU', async () => this.sampleCpu()),
      readSafely('RAM', () => this.readRam()),
      readSafely('GPU', async () => parseGpu((await runFile('nvidia-smi', ['--query-gpu=index,name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: this.timeoutMs })).stdout)),
      readSafely('SSD', async () => computeStorage(await statfs(this.home))),
      readSafely('Containers', () => readContainerResources(this.timeoutMs)),
    ]);
    return { cpu, ram, gpu, ssd, containers };
  }
}
