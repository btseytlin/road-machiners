import { describe, expect, it } from 'vitest';
import { loadDashboardConfig } from './config';

const env = {
  FACTORY_HOME: '/data/factory', FACTORY_REPO: 'owner/game', FACTORY_PROJECT_OWNER: 'owner', FACTORY_PROJECT_NUMBER: '1', FACTORY_GITHUB_RETRIES: '3', FACTORY_GITHUB_RETRY_BASE_SECONDS: '15', FACTORY_GITHUB_TIMEOUT_SECONDS: '60',
  FACTORY_PUBLIC_URL: 'https://roam.example', ITCH_TARGET: 'owner/game', FACTORY_TRIAGE_WORKERS: '1', FACTORY_DESIGN_WORKERS: '2', FACTORY_IMPLEMENT_WORKERS: '2', FACTORY_VERIFY_WORKERS: '2', FACTORY_TEST_WORKERS: '2',
  DASHBOARD_PORT: '8787', DASHBOARD_SOCKET: '', DASHBOARD_REFRESH_MS: '2000', DASHBOARD_GITHUB_REFRESH_MS: '60000',
  FACTORY_OBSERVATION_HEARTBEAT_MS: '10000', FACTORY_TICK_MINUTES: '1', DASHBOARD_COMMAND_TIMEOUT_MS: '15000', DASHBOARD_CHANNEL_URL: 'https://t.me/roam_public',
  FACTORY_PUBLIC_CHANNEL: '-1002', FACTORY_COMMITTEE_CHAT: '-1001',
};
describe('dashboard configuration', () => {
  it('requires no operational secrets and returns only dashboard settings', () => {
    const config = loadDashboardConfig({ ...env, TELEGRAM_BOT_TOKEN: 'PRIVATE', CLAUDE_CODE_OAUTH_TOKEN: 'PRIVATE' });
    expect(config.port).toBe(8787);
    expect(config.playUrl).toBe('https://owner.itch.io/game');
    expect(JSON.stringify(config)).not.toContain('PRIVATE');
  });
  it('explicitly hides Telegram when the channel is the private committee chat', () => {
    const hidden = loadDashboardConfig({ ...env, FACTORY_PUBLIC_CHANNEL: '-1001', DASHBOARD_CHANNEL_URL: '', DASHBOARD_HIDE_TELEGRAM: '1' });
    expect(hidden.channelUrl).toBeNull();
    expect(hidden.publicChannel).toBeNull();
    expect(() => loadDashboardConfig({ ...env, FACTORY_PUBLIC_CHANNEL: '-1001' })).toThrow('committee');
    expect(() => loadDashboardConfig({ ...env, DASHBOARD_HIDE_TELEGRAM: '1' })).toThrow('DASHBOARD_CHANNEL_URL');
  });
  it('rejects ambiguous listeners, unsafe public links and invalid intervals', () => {
    expect(() => loadDashboardConfig({ ...env, DASHBOARD_SOCKET: '/run/dashboard.sock' })).toThrow('exactly one');
    expect(() => loadDashboardConfig({ ...env, DASHBOARD_PORT: '' })).toThrow('exactly one');
    expect(() => loadDashboardConfig({ ...env, DASHBOARD_PORT: '65536' })).toThrow('PORT');
    expect(() => loadDashboardConfig({ ...env, DASHBOARD_CHANNEL_URL: 'javascript:alert(1)' })).toThrow('CHANNEL');
    expect(() => loadDashboardConfig({ ...env, FACTORY_PUBLIC_URL: 'https://secret:secret@example.org' })).toThrow('HTTPS');
    expect(() => loadDashboardConfig({ ...env, DASHBOARD_REFRESH_MS: '-1' })).toThrow('REFRESH');
  });
});
