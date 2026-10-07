import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardServer } from './server';
import type { SnapshotCollector, Snapshot } from './snapshot';

const servers: DashboardServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function startServer(options: { refreshMs?: number; padding?: string } = {}) {
  mkdirSync('tmp', { recursive: true });
  const assets = mkdtempSync(resolve('tmp/dashboard-http-'));
  dirs.push(assets);
  writeFileSync(join(assets, 'index.html'), '<h1>Factory</h1>');
  writeFileSync(join(assets, 'secret.txt'), 'PRIVATE');
  let refreshes = 0;
  const collector = {
    refreshLocal: async () => { refreshes++; }, refreshGithub: async () => undefined,
    getSnapshot: () => ({ generatedAt: '2026-01-01', operations: { status: 'ok', value: { jobs: [] } }, padding: options.padding }) as unknown as Snapshot,
  } as unknown as SnapshotCollector;
  const server = new DashboardServer(collector, assets, { refreshMs: options.refreshMs ?? 60_000, githubRefreshMs: 60_000 });
  servers.push(server);
  const address = await server.start({ port: 0, socket: null });
  return { url: `http://127.0.0.1:${address}`, getRefreshes: () => refreshes };
}
describe('public dashboard HTTP', () => {
  it('serves assets and snapshots with restrictive browser headers', async () => {
    const { url } = await startServer();
    const page = await fetch(`${url}/factory/`);
    expect(await page.text()).toContain('Factory');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const chart = await fetch(`${url}/factory/chart.js`);
    expect(chart.status).toBe(200);
    expect(chart.headers.get('content-type')).toContain('javascript');
    const snapshot = await fetch(`${url}/factory/api/snapshot`);
    const data = await snapshot.json() as Snapshot;
    expect(data.operations.value?.jobs).toEqual([]);
  });
  it('rejects mutations, unknown assets, and traversal without leaking files', async () => {
    const { url } = await startServer();
    expect((await fetch(`${url}/factory/api/snapshot`, { method: 'POST' })).status).toBe(405);
    for (const path of ['secret.txt', '%2e%2e%2fsecret.txt', '.env', 'src/server.ts']) {
      const response = await fetch(`${url}/factory/${path}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('PRIVATE');
    }
  });
  it('keeps sending large snapshots after a write reports backpressure', async () => {
    const { url } = await startServer({ refreshMs: 50, padding: 'x'.repeat(128_000) });
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 1500);
    try {
      const response = await fetch(`${url}/factory/api/events`, { signal: abort.signal });
      const reader = response.body!.getReader();
      let received = '';
      while (received.split('event: snapshot').length < 3) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Dashboard stream closed before its second snapshot');
        received += new TextDecoder().decode(chunk.value);
      }
      expect(received.split('event: snapshot').length - 1).toBeGreaterThanOrEqual(2);
    } finally {
      clearTimeout(deadline);
      abort.abort();
    }
  });
  it('shares collection and gives every new stream a fresh snapshot', async () => {
    const { url, getRefreshes } = await startServer();
    for (let i = 0; i < 2; i++) {
      const abort = new AbortController();
      const response = await fetch(`${url}/factory/api/events`, { signal: abort.signal });
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      expect(new TextDecoder().decode(chunk.value)).toContain('event: snapshot');
      abort.abort();
      await reader.cancel().catch(() => undefined);
    }
    expect(getRefreshes()).toBe(1);
  });
});
