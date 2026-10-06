import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
export type ContainerResource = { jobId: string | null; service: string; cpu: number; memory: number; readBytes: number; writtenBytes: number };
type Container = { ID: string; Names: string; Labels: string };
type Stats = { ID: string; CPUPerc: string; MemUsage: string; BlockIO: string };
const UNITS: Record<string, number> = { B: 1, kB: 1000, KB: 1000, MB: 1000000, GB: 1000000000, TB: 1000000000000, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
function parseBytes(text: string): number {
  const parts = /^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/.exec(text.trim());
  if (!parts) throw new Error('Invalid container byte measurement');
  return Number(parts[1]) * UNITS[parts[2]];
}
function parseCpu(text: string, cores: number): number {
  if (!/^\d+(?:\.\d+)?%$/.test(text)) throw new Error('Invalid container CPU measurement');
  return Number(text.slice(0, -1)) / cores;
}
function readOwner(container: Container | undefined): Pick<ContainerResource, 'jobId' | 'service'> {
  if (!container) return { jobId: null, service: 'Unattributed container' };
  const label = container.Labels.split(',').find((value) => value.startsWith('factory-job='));
  if (label) return { jobId: label.slice('factory-job='.length), service: 'Factory job' };
  const services: Record<string, string> = { 'factory-hermes': 'Hermes', 'factory-caddy': 'Web server', 'factory-tunnel': 'Public tunnel', 'roam-factory-proxy': 'Agent network proxy' };
  return { jobId: null, service: Object.hasOwn(services, container.Names) ? services[container.Names] : 'Other container' };
}
export function parseContainerResources(containersText: string, statsText: string, cores: number): ContainerResource[] {
  if (!Number.isInteger(cores) || cores <= 0) throw new Error('Invalid host CPU count');
  const containers = containersText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Container);
  const stats = statsText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Stats);
  const rows = stats.map((sample) => {
    const owner = readOwner(containers.find((container) => container.ID === sample.ID));
    const [read, written] = sample.BlockIO.split('/');
    return { ...owner, cpu: parseCpu(sample.CPUPerc, cores), memory: parseBytes(sample.MemUsage.split('/')[0]), readBytes: parseBytes(read), writtenBytes: parseBytes(written) };
  });
  return groupUnattributedContainers(rows);
}
function groupUnattributedContainers(rows: ContainerResource[]): ContainerResource[] {
  const unknown = rows.filter((row) => ['Other container', 'Unattributed container'].includes(row.service));
  if (unknown.length < 2) return rows;
  const group: ContainerResource = { jobId: null, service: `Other containers (${unknown.length})`, cpu: 0, memory: 0, readBytes: 0, writtenBytes: 0 };
  for (const row of unknown) {
    group.cpu += row.cpu;
    group.memory += row.memory;
    group.readBytes += row.readBytes;
    group.writtenBytes += row.writtenBytes;
  }
  return [...rows.filter((row) => !unknown.includes(row)), group];
}
export async function readContainerResources(timeoutMs: number): Promise<ContainerResource[]> {
  const containers = await runFile('docker', ['ps', '--format', '{{json .}}'], { timeout: timeoutMs });
  const stats = await runFile('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeout: timeoutMs });
  return parseContainerResources(containers.stdout, stats.stdout, cpus().length);
}
