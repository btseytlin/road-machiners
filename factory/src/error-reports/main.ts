import { loadConfig, readEnvFiles } from '../config';
import { realRun } from '../exec';
import { ghClient } from '../github';
import { ErrorReports, ErrorServer } from './service';

// The error service runs beside the tick as its own systemd unit, on the unix socket in ERROR_SOCKET that Caddy serves at /errors.
async function startErrorService(): Promise<void> {
  const socket = process.env.ERROR_SOCKET;
  if (!socket) throw new Error('ERROR_SOCKET is not set. The systemd unit sets it.');
  const cfg = loadConfig({ ...readEnvFiles('settings.env', '.env'), ...process.env });
  const now = () => new Date();
  const reports = new ErrorReports({ cfg, github: ghClient(realRun, cfg), now });
  const server = new ErrorServer(reports, cfg, now, (line) => console.error(line));
  await server.listen(socket);
  console.log(`Error service listening on ${socket}`);
  const stop = () => { void server.close().then(() => process.exit(0)); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

await startErrorService();
