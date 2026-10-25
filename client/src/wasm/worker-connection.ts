/**
 * Transport for the browser-only build: the engine runs as WebAssembly in a
 * worker (engine-worker.ts) and speaks the same protocol as over the
 * bridge's WebSocket.  Saves are kept in the browser (IndexedDB).
 */
import type { ClientMessage, EngineMessage } from '@thang/protocol';
import type { ConnectionStatus, Transport } from '../protocol/connection.ts';

type Listener = (msg: EngineMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

/**
 * The browser-only build (vite --mode web, see .env.web) runs the engine in
 * the page; ?engine=wasm or ?engine=bridge overrides for testing.
 */
export function useWasmEngine(): boolean {
  const param = new URLSearchParams(location.search).get('engine');
  if (param) return param === 'wasm';
  return import.meta.env.VITE_ENGINE === 'wasm';
}

export class WorkerConnection implements Transport {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private flushes = new Map<number, () => void>();
  private flushId = 0;
  status: ConnectionStatus = 'closed';
  debug = false;

  /** Directory with angband.mjs/.wasm/.data, relative to the page */
  constructor(private engineDir = 'engine/') {}

  connect(): void {
    if (this.worker) return;
    this.setStatus('connecting');
    const worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.kind === 'line') this.dispatchLine(m.line);
      else if (m.kind === 'ready') this.setStatus('open');
      else if (m.kind === 'flushed') {
        this.flushes.get(m.id)?.();
        this.flushes.delete(m.id);
      } else if (m.kind === 'failed') {
        this.dispatch({ type: 'bridge', event: 'engine_failed', message: m.message });
      }
    };
    worker.onerror = (e) => {
      console.error('engine worker', e);
      this.dispatch({ type: 'bridge', event: 'engine_failed', message: 'The game engine could not be loaded.' });
    };
    worker.postMessage({ kind: 'start', baseUrl: new URL(this.engineDir, document.baseURI).href });

    // The engine also autosaves when idle after play (engine-host.ts)
    const autosave = () => this.worker?.postMessage({ kind: 'autosave' });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') autosave();
    });
    window.addEventListener('pagehide', autosave);
  }

  /** The engine keeps running with the page; there is nothing to disconnect */
  close(): void {
    void this.flush();
  }

  send(msg: ClientMessage): boolean {
    if (!this.worker) return false;
    if (this.debug) console.debug('[->engine]', msg);
    if (msg.type === 'shutdown') {
      // Nothing to stop in a browser: make sure the save is stored, then
      // answer like a hosted server would (the game stays at the title)
      this.flush().then(() => this.dispatch({ type: 'bridge', event: 'shutdown_refused' }));
      return true;
    }
    this.worker.postMessage({ kind: 'line', line: JSON.stringify(msg) });
    return true;
  }

  flush(): Promise<void> {
    if (!this.worker) return Promise.resolve();
    const id = ++this.flushId;
    return new Promise((resolve) => {
      this.flushes.set(id, resolve);
      this.worker!.postMessage({ kind: 'flush', id });
    });
  }

  rememberSession(): void {
    /* no sessions: the save lives in this browser */
  }

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  private dispatchLine(line: string) {
    let msg: EngineMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    this.dispatch(msg);
  }

  private dispatch(msg: EngineMessage) {
    if (this.debug) console.debug('[engine->]', msg);
    for (const l of this.listeners) l(msg);
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}
