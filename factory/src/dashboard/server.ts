import { readFile, chmod } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBadge } from './badges';
import type { SnapshotCollector } from './snapshot';

const CHART_BUNDLE = fileURLToPath(new URL('../../node_modules/chart.js/dist/chart.umd.min.js', import.meta.url));

const ASSETS: Record<string, [string, string]> = {
  '/factory/': ['index.html', 'text/html; charset=utf-8'],
  '/factory/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'],
  '/factory/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'],
  '/factory/chart.js': [CHART_BUNDLE, 'text/javascript; charset=utf-8'],
  '/factory/fonts/barlow.woff2': ['fonts/barlow.woff2', 'font/woff2'],
  '/factory/fonts/barlow-bold.woff2': ['fonts/barlow-bold.woff2', 'font/woff2'],
  '/factory/fonts/plex.woff2': ['fonts/plex.woff2', 'font/woff2'],
};
const BADGE_PREFIX = '/factory/api/badges/';
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
};
export class DashboardServer {
  private readonly server = createServer((request, response) => { void this.handle(request, response); });
  private readonly clients = new Set<ServerResponse>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly busy = { local: false, github: false };
  private stopped = false;
  constructor(private readonly collector: SnapshotCollector, private readonly assets: string, private readonly intervals: { refreshMs: number; githubRefreshMs: number }) {}
  async start(listener: { port: number | null; socket: string | null }): Promise<number> {
    await this.refresh('local');
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      const listen = () => { this.server.off('error', reject); resolve(); };
      if (listener.socket !== null) this.server.listen(listener.socket, listen);
      else this.server.listen(listener.port!, '127.0.0.1', listen);
    });
    if (listener.socket !== null) await chmod(listener.socket, 0o666);
    this.timers = [
      setInterval(() => { this.broadcast(); void this.refresh('local'); }, this.intervals.refreshMs),
      setInterval(() => { void this.refresh('github'); }, this.intervals.githubRefreshMs),
    ];
    void this.refresh('github');
    const address = this.server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }
  private async refresh(source: 'local' | 'github'): Promise<void> {
    if (this.busy[source] || this.stopped) return;
    this.busy[source] = true;
    try {
      if (source === 'local') await this.collector.refreshLocal();
      else await this.collector.refreshGithub();
      this.broadcast();
    } catch (error) { console.error('Dashboard refresh failed:', error); }
    finally { this.busy[source] = false; }
  }
  private broadcast(): void {
    const event = `event: snapshot\ndata: ${JSON.stringify(this.collector.getSnapshot())}\n\n`;
    for (const client of this.clients) {
      if (client.writableLength > 0) continue;
      client.write(event);
    }
  }
  private openStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-accel-buffering': 'no', connection: 'keep-alive' });
    response.write(`retry: ${this.intervals.refreshMs}\nevent: snapshot\ndata: ${JSON.stringify(this.collector.getSnapshot())}\n\n`);
    this.clients.add(response);
    request.on('close', () => this.clients.delete(response));
    response.on('close', () => this.clients.delete(response));
    response.on('error', () => { this.clients.delete(response); response.destroy(); });
  }
  private sendJson(response: ServerResponse, value: unknown): void {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(key, value);
    try { await this.route(request, response); }
    catch (error) {
      console.error('Dashboard request failed:', error);
      if (response.headersSent) return void response.destroy();
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Dashboard unavailable');
    }
  }
  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { allow: 'GET, HEAD' });
      return void response.end('Read-only dashboard');
    }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/factory') { response.writeHead(308, { location: '/factory/' }); return void response.end(); }
    if (path.startsWith(BADGE_PREFIX)) return this.sendBadge(path.slice(BADGE_PREFIX.length), response);
    return this.servePath(path, request, response);
  }
  private async servePath(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (path === '/factory/health') return this.sendJson(response, { status: 'ok' });
    if (path === '/factory/api/snapshot') return this.sendJson(response, this.collector.getSnapshot());
    if (path === '/factory/api/events' && request.method === 'GET') return this.openStream(request, response);
    const asset = ASSETS[path];
    if (!asset) { response.writeHead(404); return void response.end('Not found'); }
    const content = await readFile(resolve(this.assets, asset[0]));
    response.writeHead(200, { 'content-type': asset[1] });
    response.end(content);
  }
  private sendBadge(name: string, response: ServerResponse): void {
    const badge = buildBadge(name, this.collector.getSnapshot());
    if (badge === null) { response.writeHead(404); return void response.end('Not found'); }
    this.sendJson(response, badge);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server.closeAllConnections();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }
}
