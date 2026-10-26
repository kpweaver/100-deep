/**
 * Bridge configuration from the environment (and CLI overrides).
 *
 *   THANG_MODE              local (default) | hosted
 *   THANG_HOST              bind address (local: 127.0.0.1, hosted: 0.0.0.0)
 *   THANG_PORT              8787
 *   THANG_DATA              writable data root (default var/data)
 *   THANG_SAVE              savefile name in local mode (default hero)
 *   THANG_MAX_SESSIONS      hosted: concurrent engine processes (default 32)
 *   THANG_IDLE_SECONDS      hosted: keep a disconnected game running this long (default 300)
 *   THANG_ALLOWED_ORIGINS   comma-separated Origin allowlist for WebSockets (default: any)
 *   THANG_MSGS_PER_SECOND   per-connection message rate limit (default 30, burst 2x)
 *   THANG_CLIENT_DIR        built client to serve (default client/dist)
 *   THANG_DEBUG             log protocol traffic
 */
import { resolve } from 'node:path';
import { REPO_ROOT } from './engine.ts';

export type BridgeMode = 'local' | 'hosted';

export interface BridgeConfig {
  mode: BridgeMode;
  host: string;
  port: number;
  dataDir: string;
  save: string;
  maxSessions: number;
  idleSeconds: number;
  allowedOrigins: string[] | null;
  msgsPerSecond: number;
  clientDir: string;
  debug: boolean;
  /** Local mode with THANG_CHEATS=1: relay Angband debug commands ('debug') */
  cheats: boolean;
  log: boolean;
}

const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = v === undefined || v === '' ? def : Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function loadConfig(overrides: Partial<BridgeConfig> = {}, env = process.env): BridgeConfig {
  const mode: BridgeMode = (overrides.mode ?? env.THANG_MODE) === 'hosted' ? 'hosted' : 'local';
  const origins = (env.THANG_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cfg: BridgeConfig = {
    mode,
    host: env.THANG_HOST ?? (mode === 'hosted' ? '0.0.0.0' : '127.0.0.1'),
    port: int(env.THANG_PORT, 8787, 0, 65535),
    dataDir: resolve(env.THANG_DATA ?? resolve(REPO_ROOT, 'var/data')),
    save: env.THANG_SAVE ?? 'hero',
    maxSessions: int(env.THANG_MAX_SESSIONS, 32, 1, 10_000),
    idleSeconds: int(env.THANG_IDLE_SECONDS, 300, 5, 86_400),
    allowedOrigins: origins.length ? origins : null,
    msgsPerSecond: int(env.THANG_MSGS_PER_SECOND, 30, 1, 1000),
    clientDir: resolve(env.THANG_CLIENT_DIR ?? resolve(REPO_ROOT, 'client/dist')),
    debug: !!env.THANG_DEBUG,
    cheats: mode === 'local' && env.THANG_CHEATS === '1',
    log: !!env.THANG_DEBUG,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) (cfg as unknown as Record<string, unknown>)[k] = v;
  }
  return cfg;
}
