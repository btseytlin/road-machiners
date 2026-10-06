import { isAbsolute } from 'node:path';

export type DashboardConfig = {
  home: string; repo: string; projectOwner: string; projectNumber: number; publicUrl: string;
  playUrl: string; channelUrl: string | null; publicChannel: string | null; socket: string | null; port: number | null;
  refreshMs: number; githubRefreshMs: number; commandTimeoutMs: number; observationHeartbeatMs: number; tickIntervalMs: number;
  triageWorkers: number; designWorkers: number; implementWorkers: number; verifyWorkers: number; testWorkers: number;
};
function requireValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
function readPositive(env: NodeJS.ProcessEnv, key: string): number {
  const value = Number(requireValue(env, key));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}`);
  return value;
}
function requireMatch(value: string, pattern: RegExp, name: string): string {
  if (!pattern.test(value)) throw new Error(`Invalid ${name}`);
  return value;
}
function readOptional(env: NodeJS.ProcessEnv, key: string): string | null { return env[key]?.trim() || null; }
function readPort(env: NodeJS.ProcessEnv): number | null {
  if (readOptional(env, 'DASHBOARD_PORT') === null) return null;
  const port = readPositive(env, 'DASHBOARD_PORT');
  if (port > 65535) throw new Error('Invalid DASHBOARD_PORT');
  return port;
}
function readListener(env: NodeJS.ProcessEnv): { socket: string | null; port: number | null } {
  const socket = readOptional(env, 'DASHBOARD_SOCKET');
  const port = readPort(env);
  if (Boolean(socket) === Boolean(port)) throw new Error('Set exactly one of DASHBOARD_SOCKET and DASHBOARD_PORT');
  if (socket !== null && !isAbsolute(socket)) throw new Error('DASHBOARD_SOCKET must be absolute');
  return { socket, port };
}
function readPublicUrl(env: NodeJS.ProcessEnv): string {
  const url = new URL(requireValue(env, 'FACTORY_PUBLIC_URL'));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('FACTORY_PUBLIC_URL must be public HTTPS');
  return url.origin;
}
function readChannel(env: NodeJS.ProcessEnv): { channelUrl: string | null; publicChannel: string | null } {
  if (env.DASHBOARD_HIDE_TELEGRAM === '1') {
    if (readOptional(env, 'DASHBOARD_CHANNEL_URL')) throw new Error('DASHBOARD_CHANNEL_URL must be empty while Telegram is hidden');
    return { channelUrl: null, publicChannel: null };
  }
  if (readOptional(env, 'DASHBOARD_HIDE_TELEGRAM')) throw new Error('DASHBOARD_HIDE_TELEGRAM must be 1 or empty');
  const publicChannel = requireValue(env, 'FACTORY_PUBLIC_CHANNEL');
  if (publicChannel === requireValue(env, 'FACTORY_COMMITTEE_CHAT')) throw new Error('Public channel must differ from committee chat');
  return { channelUrl: requireMatch(requireValue(env, 'DASHBOARD_CHANNEL_URL'), /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}$/, 'DASHBOARD_CHANNEL_URL'), publicChannel };
}
export function loadDashboardConfig(env: NodeJS.ProcessEnv): DashboardConfig {
  const target = requireMatch(requireValue(env, 'ITCH_TARGET'), /^[\w-]+\/[\w-]+$/, 'ITCH_TARGET').split('/');
  return {
    home: requireValue(env, 'FACTORY_HOME'),
    repo: requireMatch(requireValue(env, 'FACTORY_REPO'), /^[\w.-]+\/[\w.-]+$/, 'FACTORY_REPO'),
    projectOwner: requireMatch(requireValue(env, 'FACTORY_PROJECT_OWNER'), /^[\w-]+$/, 'FACTORY_PROJECT_OWNER'),
    projectNumber: readPositive(env, 'FACTORY_PROJECT_NUMBER'), publicUrl: readPublicUrl(env),
    playUrl: `https://${target[0]}.itch.io/${target[1]}`,
    ...readChannel(env),
    ...readListener(env), refreshMs: readPositive(env, 'DASHBOARD_REFRESH_MS'), githubRefreshMs: readPositive(env, 'DASHBOARD_GITHUB_REFRESH_MS'),
    commandTimeoutMs: readPositive(env, 'DASHBOARD_COMMAND_TIMEOUT_MS'),
    observationHeartbeatMs: readPositive(env, 'FACTORY_OBSERVATION_HEARTBEAT_MS'), tickIntervalMs: readPositive(env, 'FACTORY_TICK_MINUTES') * 60000,
    triageWorkers: readPositive(env, 'FACTORY_TRIAGE_WORKERS'), designWorkers: readPositive(env, 'FACTORY_DESIGN_WORKERS'),
    implementWorkers: readPositive(env, 'FACTORY_IMPLEMENT_WORKERS'), verifyWorkers: readPositive(env, 'FACTORY_VERIFY_WORKERS'),
    testWorkers: readPositive(env, 'FACTORY_TEST_WORKERS'),
  };
}
