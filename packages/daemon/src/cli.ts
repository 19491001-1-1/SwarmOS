import { DaemonClient } from './daemonClient.js';
import { DAEMON_VERSION } from './daemonClient.js';

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const serverUrl = getArg('--server-url') ?? 'http://localhost:3000';
const apiKey = getArg('--api-key') ?? 'dev-machine-key';

if (args.includes('--version') || args.includes('-v')) {
  console.log(DAEMON_VERSION);
  process.exit(0);
}

console.log(`[daemon] Starting version=${DAEMON_VERSION} server=${serverUrl}`);

const client = new DaemonClient({ serverUrl, apiKey });
client.connect();

process.on('SIGINT', () => {
  console.log('[daemon] Shutting down...');
  client.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  client.disconnect();
  process.exit(0);
});
