import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { readEnvFiles } from '../config';
import { loadDashboardConfig } from './config';
import { HostSampler } from './host';
import { PublicGitHub, SnapshotCollector, createGithubRun } from './snapshot';
import { DashboardServer } from './server';

async function fetchChannelUsername(chat: string, token: string): Promise<string> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat }), signal: AbortSignal.timeout(15_000),
    });
    const reply = await response.json() as { ok: boolean; result?: { username?: string } };
    if (!response.ok || !reply.ok || !reply.result?.username) throw new Error('Channel has no username');
    return reply.result.username;
  } catch { throw new Error('Could not resolve public Telegram channel'); }
}
async function resolveChannelUrl(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.DASHBOARD_CHANNEL_URL?.trim()) return env.DASHBOARD_CHANNEL_URL;
  if (!env.FACTORY_PUBLIC_CHANNEL || !env.TELEGRAM_BOT_TOKEN) throw new Error('Public channel and Telegram token are required');
  return `https://t.me/${await fetchChannelUsername(env.FACTORY_PUBLIC_CHANNEL, env.TELEGRAM_BOT_TOKEN)}`;
}

async function startDashboard(): Promise<void> {
  const factoryEnv = readEnvFiles('settings.env', '.env');
  const dashboardEnv = parseEnv(readFileSync('dashboard/.env', 'utf8'));
  const overlap = Object.keys(dashboardEnv).filter((key) => key in factoryEnv);
  if (overlap.length) throw new Error(`Duplicate dashboard settings: ${overlap.join(', ')}`);
  const env = { ...factoryEnv, ...dashboardEnv, ...process.env };
  env.DASHBOARD_CHANNEL_URL = await resolveChannelUrl(env);
  const config = loadDashboardConfig(env);
  const githubEnv = { PATH: process.env.PATH, HOME: process.env.HOME, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR, GH_TOKEN: env.GH_TOKEN };
  const github = new PublicGitHub(config, createGithubRun(config.commandTimeoutMs, githubEnv));
  const collector = new SnapshotCollector(config, github, new HostSampler(config.home, config.commandTimeoutMs));
  const server = new DashboardServer(collector, fileURLToPath(new URL('../../dashboard', import.meta.url)), config);
  await server.start(config);
  console.log(`Factory dashboard listening on ${config.socket ?? `127.0.0.1:${config.port}`}`);
  const stop = () => { void server.stop().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); }); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

await startDashboard();
