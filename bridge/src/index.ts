/**
 * Bridge entry point:
 *   node bridge/src/index.ts [--port N] [--save NAME] [--log] [--open]
 *
 * --open opens the game in the default browser once it is ready.  If the
 * game is already running on the port, --open just opens it instead.
 */
import { spawn } from 'node:child_process';
import { BridgeError, startBridge } from './server.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const openBrowser = process.argv.includes('--open');

function open(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {
    console.log(`[bridge] open ${url} in your browser`);
  }).unref();
}

/** Is a Thangorodrim bridge already answering on this address? */
async function alreadyRunning(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await r.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

const bridge = startBridge({
  port: arg('--port') ? Number(arg('--port')) : undefined,
  engine: { save: arg('--save') },
  log: process.argv.includes('--log'),
});
const url = `http://${bridge.host}:${bridge.port}`;

try {
  await bridge.ready;
  console.log(`[bridge] play at ${url}  (Ctrl+C saves and quits)`);
  if (openBrowser) open(url);
} catch (e) {
  if (e instanceof BridgeError && e.code === 'port_in_use') {
    if (await alreadyRunning(url)) {
      console.log(`[bridge] Thangorodrim is already running at ${url}`);
      if (openBrowser) {
        open(url);
        process.exit(0);
      }
      console.error('[bridge] stop the other instance first (Ctrl+C in its terminal), or use --port to pick another port.');
    } else {
      console.error(`[bridge] ${e.message}`);
      console.error(`[bridge] another program is using port ${bridge.port}; set THANG_PORT or pass --port to use a different one.`);
    }
  } else {
    console.error(`[bridge] ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[bridge] saving and shutting down...');
  await bridge.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Closing the Terminal window sends SIGHUP: save like the stock game does
process.on('SIGHUP', shutdown);
