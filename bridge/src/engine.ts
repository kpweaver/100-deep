/**
 * Native engine subprocess wrapper.
 *
 * Spawns the headless Angband executable and exchanges JSON lines with it.
 * Platform/transport concerns live here and in server.ts; nothing in this
 * file knows about game rules.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { ClientMessage, EngineMessage } from '@thang/protocol';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../..');

export interface EngineOptions {
  /** Path to the angband-headless executable */
  binary?: string;
  /** Angband lib directory (gamedata, tiles, ...) */
  libDir?: string;
  /** Writable directory for saves, scores and user files */
  dataDir?: string;
  /** Savefile name */
  save?: string;
  /** Fixed RNG seed (tests only) */
  seed?: number;
  /** Log every engine line to stderr */
  debug?: boolean;
}

export function defaultEngineOptions(): Required<Omit<EngineOptions, 'seed'>> {
  return {
    binary: process.env.THANG_ENGINE ?? resolve(REPO_ROOT, 'build/engine/angband-headless'),
    libDir: process.env.THANG_LIB ?? resolve(REPO_ROOT, 'engine/upstream/lib'),
    dataDir: process.env.THANG_DATA ?? resolve(REPO_ROOT, 'var/data'),
    save: process.env.THANG_SAVE ?? 'hero',
    debug: !!process.env.THANG_DEBUG,
  };
}

export interface EngineEvents {
  message: [EngineMessage, string];
  exit: [number | null, NodeJS.Signals | null];
  stderr: [string];
}

export class Engine extends EventEmitter<EngineEvents> {
  readonly options: Required<Omit<EngineOptions, 'seed'>> & { seed?: number };
  private child: ChildProcess | null = null;
  private stderrTail: string[] = [];

  constructor(options: EngineOptions = {}) {
    super();
    // Explicitly undefined options must not override the defaults
    const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
    this.options = { ...defaultEngineOptions(), ...given };
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** Last lines the engine wrote to stderr (for crash reports) */
  get recentStderr(): string[] {
    return [...this.stderrTail];
  }

  start(): void {
    if (this.child) return;
    const o = this.options;
    if (!existsSync(o.binary)) {
      throw new Error(`Engine binary not found at ${o.binary}; run "npm run build:engine"`);
    }
    mkdirSync(o.dataDir, { recursive: true });
    const args = ['--lib', o.libDir, '--data', o.dataDir, '--save', o.save];
    if (o.seed !== undefined) args.push('--seed', String(o.seed));
    if (o.debug) args.push('--debug');

    const child = spawn(o.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;

    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!line) return;
      let msg: EngineMessage;
      try {
        msg = JSON.parse(line) as EngineMessage;
      } catch {
        this.emit('stderr', `unparseable engine output: ${line.slice(0, 200)}`);
        return;
      }
      this.emit('message', msg, line);
    });

    createInterface({ input: child.stderr! }).on('line', (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 50) this.stderrTail.shift();
      this.emit('stderr', line);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this.emit('exit', code, signal);
    });
    child.stdin!.on('error', () => {
      /* engine died; the exit handler reports it */
    });
  }

  send(msg: ClientMessage | string): boolean {
    if (!this.child?.stdin?.writable) return false;
    const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this.child.stdin.write(line + '\n');
    return true;
  }

  /** Close stdin (the engine saves and exits), killing it if it lingers */
  async stop(timeoutMs = 5000): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((res) => child.once('exit', () => res()));
    child.stdin?.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    await exited;
    clearTimeout(timer);
  }
}
