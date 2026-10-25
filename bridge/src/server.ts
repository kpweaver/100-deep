/**
 * WebSocket bridge between browser clients and native engine processes.
 *
 *  - Relays JSON lines verbatim in both directions (no game logic here).
 *  - Serves the Gervais tile atlas and, when built, the client.
 *  - Restarts an engine after abnormal termination (it reloads its last
 *    save; the client resynchronises from the fresh hello/state).
 *
 * Modes (see config.ts):
 *  - local:  one game for the machine's user; a new connection replaces the
 *            previous one.  This is what the launcher and `npm run dev` use.
 *  - hosted: every browser gets an anonymous session token (stored by the
 *            client) with its own save directory and engine process.
 *            Engines are capped, idle games are saved and stopped, origins
 *            can be restricted and messages are size- and rate-limited.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync, unwatchFile, watchFile } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BridgeMessage } from '@thang/protocol';
import { defaultEngineOptions, REPO_ROOT, type Engine, type EngineOptions } from './engine.ts';
import { loadConfig, type BridgeConfig, type BridgeMode } from './config.ts';
import { GameSession } from './session.ts';

/** Startup failures with a user-facing message */
export class BridgeError extends Error {
  readonly code: 'port_in_use' | 'engine_missing';
  constructor(code: 'port_in_use' | 'engine_missing', message: string) {
    super(message);
    this.code = code;
  }
}

export interface BridgeOptions {
  mode?: BridgeMode;
  port?: number;
  host?: string;
  /** Local mode: engine overrides (save name, data dir, binary) */
  engine?: EngineOptions;
  /** Directory with the built client (index.html); optional in development */
  clientDir?: string;
  /** Write a JSONL transcript of all traffic to var/logs */
  log?: boolean;
  /** Full config (tests); otherwise read from the environment */
  config?: Partial<BridgeConfig>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

/** Largest client message accepted over the WebSocket */
const MAX_WS_PAYLOAD = 64 * 1024;
const TOKEN_RE = /^[0-9a-f]{32}$/;

/** Resolve a URL path inside root, refusing traversal */
function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function serveFile(res: ServerResponse, file: string, immutable = false): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}

export function startBridge(opts: BridgeOptions = {}) {
  const cfg = loadConfig({
    ...opts.config,
    mode: opts.mode ?? opts.config?.mode,
    port: opts.port ?? opts.config?.port,
    host: opts.host ?? opts.config?.host,
    clientDir: opts.clientDir ?? opts.config?.clientDir,
    log: opts.log || opts.config?.log || undefined,
    dataDir: opts.engine?.dataDir ?? opts.config?.dataDir,
    save: opts.engine?.save ?? opts.config?.save,
  });
  const engineDefaults = { ...defaultEngineOptions(), ...Object.fromEntries(Object.entries(opts.engine ?? {}).filter(([, v]) => v !== undefined)) };
  const tilesDir = resolve(engineDefaults.libDir, 'tiles');
  // Only the Gervais set is used and licensed for this project (CC BY 3.0).
  // Other bundled sets (e.g. Shockbolt) forbid use outside Angband itself.
  const servedTilesets = new Set(['gervais']);
  const logDir = cfg.log ? resolve(REPO_ROOT, 'var/logs') : null;

  const sessions = new Map<string, GameSession>();
  let stopping = false;

  const newSession = (id: string, dataDir: string, save: string) => {
    const s = new GameSession({
      id, dataDir, save, debug: cfg.debug, logDir, msgsPerSecond: cfg.msgsPerSecond,
      binary: engineDefaults.binary, libDir: engineDefaults.libDir,
      onEnd: (sess) => {
        // A hosted session whose engine keeps failing is dropped
        if (cfg.mode === 'hosted') void endSession(sess);
      },
    });
    sessions.set(id, s);
    return s;
  };

  const endSession = async (s: GameSession) => {
    sessions.delete(s.id);
    await s.stop();
  };

  // Local mode: one game, started with the server (the save opens instantly)
  const localSession = cfg.mode === 'local' ? newSession('local', cfg.dataDir, cfg.save) : null;

  const runningEngines = () => [...sessions.values()].filter((s) => s.running).length;

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS);
      res.end();
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({
        ok: true,
        mode: cfg.mode,
        engine: localSession ? localSession.running : undefined,
        sessions: sessions.size,
        engines: runningEngines(),
        capacity: cfg.mode === 'hosted' ? cfg.maxSessions : 1,
      }));
      return;
    }
    if (url.startsWith('/tiles/')) {
      const rel = url.slice('/tiles/'.length);
      const file = servedTilesets.has(rel.split('/')[0]) ? safeJoin(tilesDir, rel) : null;
      if (file && serveFile(res, file)) return;
    } else if (existsSync(cfg.clientDir)) {
      const file = safeJoin(cfg.clientDir, url === '/' ? 'index.html' : url);
      if (file && serveFile(res, file, url.startsWith('/assets/'))) return;
      if (serveFile(res, join(cfg.clientDir, 'index.html'))) return;
    }
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: MAX_WS_PAYLOAD,
    verifyClient: ({ origin }: { origin?: string }) =>
      !cfg.allowedOrigins || (origin !== undefined && cfg.allowedOrigins.includes(origin)),
  });

  const reject = (ws: WebSocket, ev: BridgeMessage, code: number) => {
    ws.send(JSON.stringify(ev));
    ws.close(code, ev.event);
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Socket errors (e.g. an oversized frame) close the socket; without a
    // listener ws would throw and take the whole server down
    ws.on('error', () => ws.terminate());
    if (stopping) return ws.close(1001, 'server stopping');
    if (localSession) {
      console.log('[bridge] client connected');
      localSession.attach(ws);
      ws.on('close', () => { /* local game keeps running for the next connection */ });
      return;
    }

    // Hosted: resume the session named by the token, or create one
    const requested = new URL(req.url ?? '/ws', 'http://x').searchParams.get('session') ?? '';
    let session = TOKEN_RE.test(requested) ? sessions.get(requested) : undefined;
    let id = session?.id ?? (TOKEN_RE.test(requested) ? requested : randomBytes(16).toString('hex'));
    if (!session) {
      if (runningEngines() >= cfg.maxSessions) {
        return reject(ws, {
          type: 'bridge', event: 'busy',
          message: 'The server is full right now. Please try again in a few minutes.',
        }, 1013);
      }
      session = newSession(id, join(cfg.dataDir, 'sessions', id), 'hero');
      try {
        session.start();
      } catch (e) {
        sessions.delete(id);
        return reject(ws, { type: 'bridge', event: 'engine_failed', message: String(e) }, 1011);
      }
    }
    id = session.id;
    // Tell the client which session it has, so it can resume later
    ws.send(JSON.stringify({ type: 'bridge', event: 'session', session: id } satisfies BridgeMessage));
    session.attach(ws);
    const s = session;
    ws.on('close', () => {
      if (stopping || s.client) return;
      // Keep the game warm for reconnects, then save and stop it
      s.idleTimer = setTimeout(() => {
        if (!s.client) void endSession(s);
      }, cfg.idleSeconds * 1000);
    });
  });

  // Claim the port first and only then start engines, so a bridge that
  // cannot listen (e.g. the game is already running) never touches a save.
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const fail = (err: NodeJS.ErrnoException) => {
      if (stopping) return;
      stopping = true;
      rejectReady(err.code === 'EADDRINUSE'
        ? new BridgeError('port_in_use', `Port ${cfg.port} is already in use.`)
        : err);
    };
    http.once('error', fail);
    // ws re-emits the server's errors; without a listener they would crash the process
    wss.on('error', () => {});
    http.listen(cfg.port, cfg.host, () => {
      http.off('error', fail);
      if (localSession) {
        try {
          localSession.start();
        } catch (e) {
          stopping = true;
          http.close();
          rejectReady(new BridgeError('engine_missing', String((e as Error).message)));
          return;
        }
      } else if (!existsSync(engineDefaults.binary)) {
        stopping = true;
        http.close();
        rejectReady(new BridgeError('engine_missing', `Engine binary not found at ${engineDefaults.binary}; run "npm run build:engine"`));
        return;
      }
      const addr = http.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : cfg.port;
      console.log(`[bridge] ${cfg.mode} mode, listening on http://${cfg.host}:${actualPort} (ws: /ws)`);
      watchEngineBinary();
      resolveReady();
    });
  });

  /**
   * When the engine is rebuilt (npm run build:engine), save and restart the
   * running engines so a long-running bridge never talks to a stale engine.
   * Engines save on stdin EOF; clients then reload their save automatically.
   */
  function watchEngineBinary() {
    const binary = engineDefaults.binary;
    let settle: ReturnType<typeof setTimeout> | null = null;
    watchFile(binary, { interval: 2000 }, (cur, prev) => {
      if (stopping || cur.mtimeMs === prev.mtimeMs || cur.size === 0) return;
      // Wait for the linker to finish writing
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        if (stopping) return;
        console.log('[bridge] engine binary changed: saving and restarting engines');
        for (const s of sessions.values()) void s.restart('Engine updated');
      }, 1500);
    });
  }

  return {
    config: cfg,
    /** The local game's engine (local mode only) */
    engine: localSession?.engine as Engine | undefined,
    sessions,
    ready,
    /** Actual port (useful when configured as 0 = any free port) */
    get port(): number {
      const addr = http.address();
      return addr && typeof addr === 'object' ? addr.port : cfg.port;
    },
    host: cfg.host,
    async close() {
      stopping = true;
      unwatchFile(engineDefaults.binary);
      for (const c of wss.clients) c.close(1001, 'server stopping');
      wss.close();
      http.close();
      await Promise.all([...sessions.values()].map((s) => s.stop()));
      sessions.clear();
    },
  };
}
