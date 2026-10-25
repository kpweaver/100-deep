/**
 * Local WebSocket bridge between the browser client and the native engine.
 *
 *  - Relays JSON lines verbatim in both directions (no game logic here).
 *  - Serves the Angband tile atlases (lib/tiles) and, when built, the client.
 *  - Restarts the engine after abnormal termination; the engine reloads the
 *    last save, and the client resynchronises from the fresh hello/state.
 *  - One active client at a time; a new connection replaces the old one.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, createWriteStream, unwatchFile, watchFile, type WriteStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BridgeMessage } from '@thang/protocol';
import { Engine, REPO_ROOT, type EngineOptions } from './engine.ts';

/** Startup failures with a user-facing message */
export class BridgeError extends Error {
  readonly code: 'port_in_use' | 'engine_missing';
  constructor(code: 'port_in_use' | 'engine_missing', message: string) {
    super(message);
    this.code = code;
  }
}

export interface BridgeOptions {
  port?: number;
  host?: string;
  engine?: EngineOptions;
  /** Directory with the built client (index.html); optional in development */
  clientDir?: string;
  /** Write a JSONL transcript of all traffic to var/logs */
  log?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** Resolve a URL path inside root, refusing traversal */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function serveFile(res: ServerResponse, file: string): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}

export function startBridge(opts: BridgeOptions = {}) {
  const port = opts.port ?? Number(process.env.THANG_PORT ?? 8787);
  const host = opts.host ?? '127.0.0.1';
  const engine = new Engine(opts.engine);
  const tilesDir = resolve(engine.options.libDir, 'tiles');
  // Only the Gervais set is used and licensed for this project (CC BY 3.0).
  // Other bundled sets (e.g. Shockbolt) forbid use outside Angband itself.
  const servedTilesets = new Set(['gervais']);
  const clientDir = opts.clientDir ?? resolve(REPO_ROOT, 'client/dist');

  let active: WebSocket | null = null;
  let crashes: number[] = [];
  let stopping = false;
  let transcript: WriteStream | null = null;

  if (opts.log || process.env.THANG_DEBUG) {
    const dir = resolve(REPO_ROOT, 'var/logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    transcript = createWriteStream(file);
    console.log(`[bridge] logging traffic to ${file}`);
  }
  const log = (dir: 'in' | 'out' | 'bridge', line: string) => {
    transcript?.write(`{"t":${Date.now()},"dir":"${dir}","msg":${line}}\n`);
  };

  const toClient = (line: string) => {
    if (active && active.readyState === active.OPEN) active.send(line);
  };
  const bridgeEvent = (ev: BridgeMessage) => {
    const line = JSON.stringify(ev);
    log('bridge', line);
    toClient(line);
  };

  engine.on('message', (_msg, line) => {
    log('out', line);
    toClient(line);
  });
  engine.on('stderr', (line) => {
    if (engine.options.debug) process.stderr.write(`[engine] ${line}\n`);
  });
  let upgrading = false;
  engine.on('exit', (code, signal) => {
    if (stopping || upgrading) return;
    console.error(`[bridge] engine exited (code=${code}, signal=${signal})`);
    for (const l of engine.recentStderr.slice(-10)) console.error(`  ${l}`);
    bridgeEvent({ type: 'bridge', event: 'engine_exit', code, signal });

    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 60_000);
    crashes.push(now);
    if (crashes.length > 5) {
      bridgeEvent({
        type: 'bridge',
        event: 'engine_failed',
        message: 'The engine keeps exiting; see the bridge console for details.',
      });
      return;
    }
    setTimeout(() => {
      if (stopping) return;
      try {
        engine.start();
        bridgeEvent({ type: 'bridge', event: 'engine_started' });
      } catch (e) {
        bridgeEvent({ type: 'bridge', event: 'engine_failed', message: String(e) });
      }
    }, 500 * crashes.length);
  });

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, engine: engine.running }));
      return;
    }
    if (url.startsWith('/tiles/')) {
      const rel = url.slice('/tiles/'.length);
      const file = servedTilesets.has(rel.split('/')[0]) ? safeJoin(tilesDir, rel) : null;
      if (file && serveFile(res, file)) return;
    } else if (existsSync(clientDir)) {
      const file = safeJoin(clientDir, url === '/' ? 'index.html' : url);
      if (file && serveFile(res, file)) return;
      if (serveFile(res, join(clientDir, 'index.html'))) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (ws) => {
    if (active && active !== ws) {
      active.send(JSON.stringify({ type: 'bridge', event: 'replaced' } satisfies BridgeMessage));
      active.close(4000, 'replaced');
    }
    active = ws;
    console.log('[bridge] client connected');

    ws.on('message', (data) => {
      if (ws !== active) return;
      const line = data.toString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') return;
      const compact = JSON.stringify(parsed);
      log('in', compact);
      if (!engine.send(compact)) {
        bridgeEvent({ type: 'bridge', event: 'engine_exit', code: null, signal: null, message: 'Engine not running' });
      }
    });
    ws.on('close', () => {
      if (active === ws) active = null;
    });

    // A fresh client needs the full picture: ask the engine to resync
    engine.send({ type: 'hello' });
  });

  // Claim the port first and only then start the engine, so a bridge that
  // cannot listen (e.g. the game is already running) never touches the save.
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const fail = (err: NodeJS.ErrnoException) => {
      if (stopping) return;
      stopping = true;
      rejectReady(err.code === 'EADDRINUSE'
        ? new BridgeError('port_in_use', `Port ${port} is already in use.`)
        : err);
    };
    http.once('error', fail);
    // ws re-emits the server's errors; without a listener they would crash the process
    wss.on('error', () => {});
    http.listen(port, host, () => {
      http.off('error', fail);
      try {
        engine.start();
      } catch (e) {
        stopping = true;
        http.close();
        rejectReady(new BridgeError('engine_missing', String((e as Error).message)));
        return;
      }
      console.log(`[bridge] listening on http://${host}:${port} (ws: /ws)`);
      watchEngineBinary();
      resolveReady();
    });
  });

  /**
   * When the engine is rebuilt (npm run build:engine), save and restart it
   * so a long-running bridge never talks to a stale engine.  The engine
   * saves on stdin EOF; the client then reloads the save automatically.
   */
  function watchEngineBinary() {
    const binary = engine.options.binary;
    let settle: ReturnType<typeof setTimeout> | null = null;
    watchFile(binary, { interval: 2000 }, (cur, prev) => {
      if (stopping || cur.mtimeMs === prev.mtimeMs || cur.size === 0) return;
      // Wait for the linker to finish writing
      if (settle) clearTimeout(settle);
      settle = setTimeout(async () => {
        settle = null;
        if (stopping) return;
        console.log('[bridge] engine binary changed: saving and restarting the engine');
        upgrading = true;
        await engine.stop();
        upgrading = false;
        if (stopping) return;
        try {
          engine.start();
          bridgeEvent({ type: 'bridge', event: 'engine_started', message: 'Engine updated' });
        } catch (e) {
          bridgeEvent({ type: 'bridge', event: 'engine_failed', message: String(e) });
        }
      }, 1500);
    });
  }

  return {
    engine,
    ready,
    port,
    host,
    async close() {
      stopping = true;
      unwatchFile(engine.options.binary);
      for (const c of wss.clients) c.close();
      wss.close();
      http.close();
      await engine.stop();
      transcript?.end();
    },
  };
}
