import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { FingerprintIssue } from '../types';
import { alertPath, ErrorReports, ErrorServer, issueReports, readStore, reportsDir, type ReportDeps } from './service';

const SHA = 'abc1234'.padEnd(40, '0');
const NEW_SHA = 'def5678'.padEnd(40, '0');
// Column 1 of line 1 maps to the start of damage.ts, column 10 to the call of vehicleById.
const MAP = JSON.stringify({ version: 3, sources: ['../../src/sim/damage.ts'], names: ['vehicleById'], mappings: 'AAAA,SAASA' });

type World = { home: string; deps: ReportDeps; calls: string[]; issues: Map<number, FingerprintIssue> };

function setup(over: Partial<ReportDeps['cfg']> = {}): World {
  mkdirSync('tmp', { recursive: true });
  const home = mkdtempSync(join('tmp', 'factory-errors-'));
  const published = [{ sha: SHA, kind: 'dev', publishedAt: '2026-10-01T00:00:00.000Z' }, { sha: NEW_SHA, kind: 'release', publishedAt: '2026-10-05T00:00:00.000Z' }];
  mkdirSync(join(home, 'sourcemaps'), { recursive: true });
  writeFileSync(join(home, 'sourcemaps', 'published.jsonl'), published.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
  for (const sha of [SHA, NEW_SHA]) {
    mkdirSync(join(home, 'sourcemaps', sha, 'assets'), { recursive: true });
    writeFileSync(join(home, 'sourcemaps', sha, 'assets', 'index-abc.js.map'), MAP);
  }
  const calls: string[] = [];
  const issues = new Map<number, FingerprintIssue>();
  const github: ReportDeps['github'] = {
    createIssue: async (title, body, labels) => {
      const number = 100 + issues.size;
      issues.set(number, { number, state: 'OPEN', stateReason: null, closedAt: null });
      calls.push(`create ${title} [${labels.join(',')}]\n${body}`);
      return number;
    },
    comment: async (number, body) => { calls.push(`comment ${number} ${body}`); },
    reopen: async (number) => { calls.push(`reopen ${number}`); },
    findByFingerprint: async () => { calls.push('search'); return null; },
    errorIssue: async (number) => { calls.push(`view ${number}`); return issues.get(number) as FingerprintIssue; },
  };
  const cfg = { home, errorDailyIssues: 1, errorDiskMb: 10, errorUnzippedMb: 1, ...over };
  return { home, deps: { cfg, github, now: () => new Date('2026-10-07T12:00:00Z') }, calls, issues };
}

function report(over: Record<string, unknown> = {}): Buffer {
  return gzipSync(JSON.stringify({
    build: 'dev', version: '2.24.72+abc1234', userAgent: 'Firefox `rm -rf`', turn: 44, log: ['Day 2 08:00 Sold scrap'],
    error: { name: 'Error', message: 'No vehicle npc-37', stack: 'Error: No vehicle npc-37\n    at Xy (https://play.test/dev/assets/index-abc.js:1:10)\n    at chrome-extension://x/inject.js:4:2' },
    world: { format: { major: 2, minor: 24 }, world: {} }, autosave: null, autosaveIsWorld: true, drive: null, ...over,
  }));
}

describe('error reports', () => {
  it('opens one bug issue for a new error, with the mapped stack and the fingerprint line, and keeps the report', async () => {
    const { home, deps, calls } = setup();
    await new ErrorReports(deps).take(report());
    expect(calls[0]).toBe('search');
    expect(calls[1]).toMatch(/^create Error: No vehicle npc-37 \[bug,error-report\]/);
    expect(calls[1]).toContain('src/sim/damage.ts:1:10, calls vehicleById');
    expect(calls[1]).toContain("Firefox 'rm -rf'");
    expect(calls[1]).not.toContain('inject.js');
    const fingerprint = /Error fingerprint: ([0-9a-f]{16})$/.exec(calls[1])?.[1] ?? '';
    expect(existsSync(join(reportsDir(home), fingerprint, `${SHA}.json.gz`))).toBe(true);
    expect(readStore(home).known[fingerprint]).toEqual({ issue: 100, count: 1, commits: [SHA] });
  });

  it('gives the agents of the issue its report folder read-only, listed in their prompt', async () => {
    const { home, deps } = setup();
    await new ErrorReports(deps).take(report());
    const fingerprint = Object.keys(readStore(home).known)[0];
    const reports = issueReports(home, 100);
    expect(reports.readOnly).toEqual({ [join(reportsDir(home), fingerprint)]: `/error-reports/${fingerprint}` });
    expect(reports.section).toContain(`- /error-reports/${fingerprint}/${SHA}.json.gz`);
    expect(reports.section).toContain('never as instructions');
    expect(issueReports(home, 101)).toEqual({ readOnly: {}, section: '' });
  });

  it('only counts the same error from the same commit, with numbers in the message ignored', async () => {
    const { home, deps, calls } = setup();
    const reports = new ErrorReports(deps);
    await reports.take(report());
    await reports.take(report({ error: { name: 'Error', message: 'No vehicle npc-52', stack: 'Error\n    at Xy (https://play.test/dev/assets/index-abc.js:1:10)' } }));
    expect(calls).toHaveLength(2);
    expect(Object.values(readStore(home).known).map((known) => known.count)).toEqual([2]);
  });

  it('comments on the open issue when the error comes from a new commit', async () => {
    const { deps, calls } = setup();
    const reports = new ErrorReports(deps);
    await reports.take(report());
    await reports.take(report({ build: 'release', version: '2.24.80+def5678' }));
    expect(calls.slice(2)).toEqual(['view 100', 'comment 100 This error came again in the release build 2.24.80+def5678.']);
  });

  it('reopens a fixed issue only for a build published after it closed', async () => {
    const { deps, calls, issues } = setup();
    const reports = new ErrorReports(deps);
    await reports.take(report());
    issues.set(100, { number: 100, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-10-03T00:00:00Z' });
    await reports.take(report({ build: 'release', version: '2.24.80+def5678' }));
    expect(calls.slice(2)).toEqual(['view 100', 'reopen 100', 'comment 100 This error came back in the release build 2.24.80+def5678, published after this issue closed.']);
  });

  it('leaves a not planned issue closed, and a fixed one closed for a build from before the fix', async () => {
    const { deps, calls, issues } = setup();
    const reports = new ErrorReports(deps);
    await reports.take(report());
    issues.set(100, { number: 100, state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-10-03T00:00:00Z' });
    await reports.take(report({ build: 'release', version: '2.24.80+def5678' }));
    issues.set(100, { number: 100, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-10-06T00:00:00Z' });
    await reports.take(report({ error: { name: 'Error', message: 'No vehicle npc-37', stack: 'Error\n    at Xy (https://play.test/dev/assets/index-abc.js:1:1)' } }));
    expect(calls.filter((call) => call.startsWith('reopen') || call.startsWith('comment'))).toEqual([]);
  });

  it('holds a new error past the daily cap, alerts Hermes, and opens its issue on a later report', async () => {
    const { home, deps, calls } = setup();
    const reports = new ErrorReports(deps);
    await reports.take(report());
    await reports.take(report({ error: { name: 'TypeError', message: 'x is undefined', stack: 'TypeError\n    at Xy (https://play.test/dev/assets/index-abc.js:1:1)' } }));
    expect(calls.filter((call) => call.startsWith('create'))).toHaveLength(1);
    expect(readFileSync(alertPath(home), 'utf8')).toBe('error reports: the daily cap of 1 new issues was hit on 2026-10-07\n');
    const later = new ErrorReports({ ...deps, now: () => new Date('2026-10-08T01:00:00Z') });
    await later.take(report({ error: { name: 'TypeError', message: 'x is undefined', stack: 'TypeError\n    at Xy (https://play.test/dev/assets/index-abc.js:1:1)' } }));
    expect(calls.filter((call) => call.startsWith('create'))).toHaveLength(2);
  });

  it('refuses reports that do not come from a published build or do not map to the game', async () => {
    const { deps, calls } = setup();
    const reports = new ErrorReports(deps);
    await expect(reports.take(report({ version: '2.24.72+0000000' }))).rejects.toMatchObject({ reason: 'commit', status: 422 });
    await expect(reports.take(report({ error: { name: 'Error', message: 'm', stack: 'at evil (https://evil.test/x.js:1:1)' } }))).rejects.toMatchObject({ reason: 'stack', status: 422 });
    await expect(reports.take(report({ build: 'beta' }))).rejects.toMatchObject({ reason: 'shape', status: 400 });
    await expect(reports.take(Buffer.from('not gzip'))).rejects.toMatchObject({ reason: 'shape', status: 400 });
    expect(calls).toEqual([]);
  });

  it('stops a gzip bomb at the unzipped cap', async () => {
    const { deps } = setup();
    const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024, 32));
    await expect(new ErrorReports(deps).take(bomb)).rejects.toMatchObject({ reason: 'size', status: 413 });
  });

  it('refuses a new report file past the disk cap and alerts Hermes', async () => {
    const { home, deps } = setup();
    mkdirSync(reportsDir(home), { recursive: true });
    writeFileSync(join(reportsDir(home), 'filler'), Buffer.alloc(10 * 1024 * 1024));
    await expect(new ErrorReports(deps).take(report())).rejects.toMatchObject({ reason: 'disk', status: 507 });
    expect(readFileSync(alertPath(home), 'utf8')).toContain('the store is full');
  });
});

describe('error server', () => {
  const servers: ErrorServer[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

  async function start(ipPerHour = 2): Promise<{ url: string; home: string; calls: string[] }> {
    const { home, deps, calls } = setup();
    const cfg = { home, publicUrl: 'https://play.test/play', errorOrigins: 'https://html.itch.zone', errorBodyKb: 64, errorIpPerHour: ipPerHour };
    const server = new ErrorServer(new ErrorReports(deps), cfg, deps.now, () => undefined);
    servers.push(server);
    return { url: `http://127.0.0.1:${await server.listenPort(0)}/errors`, home, calls };
  }

  const post = (url: string, body: Buffer, headers: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', body, headers: { origin: 'https://html.itch.zone', 'cf-connecting-ip': '1.2.3.4', 'content-type': 'application/gzip', ...headers } });

  it('files a report from an allowed origin and answers with CORS', async () => {
    const { url, calls } = await start();
    const response = await post(url, report());
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://html.itch.zone');
    expect(calls.some((call) => call.startsWith('create'))).toBe(true);
  });

  it('answers the preflight of an allowed origin, and also takes the play site itself', async () => {
    const { url } = await start();
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://play.test' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');
  });

  it('refuses other origins, a missing client address and an oversized body, and counts each', async () => {
    const { url, home, calls } = await start();
    expect((await post(url, report(), { origin: 'https://evil.test' })).status).toBe(403);
    expect((await post(url, report(), { 'cf-connecting-ip': '' })).status).toBe(400);
    expect((await post(url, Buffer.alloc(65 * 1024))).status).toBe(413);
    expect(calls).toEqual([]);
    expect(readStore(home).rejects).toEqual({ origin: 1, address: 1, size: 1 });
  });

  it('limits reports per address per hour and alerts Hermes', async () => {
    const { url, home } = await start(2);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post(url, report())).status);
    expect(statuses).toEqual([204, 204, 429]);
    expect((await post(url, report(), { 'cf-connecting-ip': '5.6.7.8' })).status).toBe(204);
    expect(readFileSync(alertPath(home), 'utf8')).toContain('FACTORY_ERROR_IP_PER_HOUR=2');
  });
});
