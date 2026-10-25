/**
 * Web Worker that runs the WebAssembly engine, so the game logic never
 * blocks the page.  Messages from the page:
 *   { kind: 'start', baseUrl }   load the engine from baseUrl (angband.mjs)
 *   { kind: 'line', line }       a client->engine protocol line
 *   { kind: 'autosave' }         save quietly now (tab hidden)
 *   { kind: 'flush', id }        persist saves now; replies { kind: 'flushed', id }
 * and to the page: { kind: 'ready' | 'line' | 'failed' | 'flushed' }.
 */
import { EngineHost } from './engine-host.ts';

const post = (m: object) => (self as unknown as Worker).postMessage(m);
const bridge = (event: string, message?: string) =>
  post({ kind: 'line', line: JSON.stringify({ type: 'bridge', event, message }) });

let host: EngineHost | null = null;
let baseUrl = '';
const crashes: number[] = [];

async function boot(restart: boolean) {
  const h = new EngineHost({
    baseUrl,
    persist: true,
    autosaveMs: 5_000,
    emit: (line) => post({ kind: 'line', line }),
    onExit: (reason) => {
      console.error('[engine]', reason);
      if (host !== h) return;
      const now = Date.now();
      crashes.push(now);
      while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
      if (crashes.length > 3) {
        bridge('engine_failed', 'It stopped repeatedly; reload the page to try again.');
        return;
      }
      bridge('engine_exit');
      setTimeout(() => boot(true), 300);
    },
    log: (s) => console.debug('[engine]', s),
  });
  host = h;
  try {
    // Like the bridge: announce the restart, then the fresh engine says hello
    if (restart) bridge('engine_started');
    await h.start();
    post({ kind: 'ready' });
  } catch (e) {
    console.error(e);
    post({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m.kind === 'start') {
    if (host) return;
    baseUrl = m.baseUrl;
    boot(false);
  } else if (m.kind === 'line') host?.send(m.line);
  else if (m.kind === 'autosave') host?.autosave();
  else if (m.kind === 'flush') {
    await host?.flush();
    post({ kind: 'flushed', id: m.id });
  }
};
