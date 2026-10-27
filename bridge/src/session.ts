/**
 * One game: an engine process, its save directory and (at most) one
 * connected client.  Transport only: messages are validated for shape and
 * rate, then relayed verbatim; the engine validates everything game-related.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import type { BridgeMessage } from '@thang/protocol';
import { Engine } from './engine.ts';

/** Client message types the engine understands ('quit' stays server-side) */
const CLIENT_TYPES = new Set([
  'hello', 'ping', 'new_game', 'load_game', 'command', 'answer', 'cancel',
  'save', 'close_game', 'options', 'query', 'birth_roll',
]);

export interface SessionOptions {
  id: string;
  /** Engine executable and Angband lib directory */
  binary: string;
  libDir: string;
  dataDir: string;
  save: string;
  debug: boolean;
  /** Relay Angband debug commands (local development only) */
  cheats?: boolean;
  /** Directory for traffic transcripts, or null for none */
  logDir: string | null;
  msgsPerSecond: number;
  /** Called when the engine keeps crashing or the session ends */
  onEnd?: (s: GameSession) => void;
  /** Local mode only: the player chose "quit" (save and stop the server) */
  onShutdownRequest?: () => void;
}

export class GameSession {
  readonly id: string;
  readonly engine: Engine;
  client: WebSocket | null = null;
  lastActive = Date.now();
  private crashes: number[] = [];
  private stopping = false;
  private restarting = false;
  private transcript: WriteStream | null = null;
  private tokens: number;
  private lastRefill = Date.now();
  private warnedRate = false;
  idleTimer: ReturnType<typeof setTimeout> | null = null;
  private opts: SessionOptions;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.id = opts.id;
    mkdirSync(opts.dataDir, { recursive: true });
    this.engine = new Engine({
      binary: opts.binary, libDir: opts.libDir, dataDir: opts.dataDir, save: opts.save, debug: opts.debug,
    });
    this.tokens = opts.msgsPerSecond * 2;
    if (opts.logDir) {
      mkdirSync(opts.logDir, { recursive: true });
      const file = join(opts.logDir, `session-${opts.id.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
      this.transcript = createWriteStream(file);
    }

    this.engine.on('message', (_m, line) => {
      this.log('out', line);
      this.toClient(line);
    });
    this.engine.on('stderr', (line) => {
      if (opts.debug) process.stderr.write(`[engine ${this.id.slice(0, 6)}] ${line}\n`);
    });
    this.engine.on('exit', (code, signal) => this.onExit(code, signal));
  }

  get running(): boolean {
    return this.engine.running;
  }

  start(): void {
    this.engine.start();
  }

  private log(dir: 'in' | 'out' | 'bridge', line: string) {
    this.transcript?.write(`{"t":${Date.now()},"dir":"${dir}","msg":${line}}\n`);
  }

  private toClient(line: string) {
    const c = this.client;
    if (c && c.readyState === c.OPEN) c.send(line);
  }

  event(ev: BridgeMessage): void {
    const line = JSON.stringify(ev);
    this.log('bridge', line);
    this.toClient(line);
  }

  /** Attach a client; an existing one is told it was replaced */
  attach(ws: WebSocket): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.client && this.client !== ws) {
      this.client.send(JSON.stringify({ type: 'bridge', event: 'replaced' } satisfies BridgeMessage));
      this.client.close(4000, 'replaced');
    }
    this.client = ws;
    this.lastActive = Date.now();
    ws.on('message', (data, isBinary) => {
      if (ws !== this.client || isBinary) return;
      this.fromClient(data.toString());
    });
    ws.on('close', () => {
      if (this.client === ws) this.client = null;
    });
    // A fresh client needs the full picture
    this.engine.send({ type: 'hello' });
  }

  private allow(): boolean {
    const now = Date.now();
    const rate = this.opts.msgsPerSecond;
    this.tokens = Math.min(rate * 2, this.tokens + ((now - this.lastRefill) / 1000) * rate);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  fromClient(line: string): void {
    this.lastActive = Date.now();
    if (!this.allow()) {
      if (!this.warnedRate) {
        this.warnedRate = true;
        this.event({ type: 'bridge', event: 'rate_limited', message: 'Too many messages; some were dropped.' });
      }
      return;
    }
    this.warnedRate = false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const type = (parsed as { type?: unknown } | null)?.type;
    if (type === 'shutdown') {
      // Handled here, never relayed: only local games may stop the server
      if (this.opts.onShutdownRequest) this.opts.onShutdownRequest();
      else this.event({ type: 'bridge', event: 'shutdown_refused' });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof type !== 'string'
      || !(CLIENT_TYPES.has(type) || (type === 'debug' && this.opts.cheats))) return;
    const compact = JSON.stringify(parsed);
    this.log('in', compact);
    if (!this.engine.send(compact)) {
      this.event({ type: 'bridge', event: 'engine_exit', code: null, signal: null, message: 'Engine not running' });
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null) {
    if (this.stopping || this.restarting) return;
    console.error(`[bridge] engine ${this.id.slice(0, 8)} exited (code=${code}, signal=${signal})`);
    for (const l of this.engine.recentStderr.slice(-10)) console.error(`  ${l}`);
    this.event({ type: 'bridge', event: 'engine_exit', code, signal });
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 60_000);
    this.crashes.push(now);
    if (this.crashes.length > 5) {
      this.event({ type: 'bridge', event: 'engine_failed', message: 'The engine keeps exiting; see the server log.' });
      this.opts.onEnd?.(this);
      return;
    }
    setTimeout(() => {
      if (this.stopping) return;
      try {
        this.engine.start();
        this.event({ type: 'bridge', event: 'engine_started' });
      } catch (e) {
        this.event({ type: 'bridge', event: 'engine_failed', message: String(e) });
      }
    }, 500 * this.crashes.length);
  }

  /** Save and restart the engine (e.g. after an engine rebuild) */
  async restart(reason: string): Promise<void> {
    if (this.stopping || !this.engine.running) return;
    this.restarting = true;
    await this.engine.stop();
    this.restarting = false;
    if (this.stopping) return;
    try {
      this.engine.start();
      this.event({ type: 'bridge', event: 'engine_started', message: reason });
    } catch (e) {
      this.event({ type: 'bridge', event: 'engine_failed', message: String(e) });
    }
  }

  /** Save (engine saves on EOF) and end the session */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.client?.close(1001, 'server stopping');
    await this.engine.stop();
    this.transcript?.end();
  }
}
