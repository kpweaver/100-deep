/**
 * WebSocket connection to the bridge, with automatic reconnection.
 * On every (re)connection the bridge asks the engine for a full resync.
 */
import type { ClientMessage, EngineMessage } from '@thang/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

type Listener = (msg: EngineMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

/** How the client reaches an engine: the bridge (WebSocket) or in-page (WebAssembly) */
export interface Transport {
  status: ConnectionStatus;
  debug: boolean;
  connect(): void;
  close(): void;
  send(msg: ClientMessage): boolean;
  onMessage(l: Listener): () => void;
  onStatus(l: StatusListener): () => void;
  rememberSession(token: string): void;
}

export class Connection implements Transport {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  private closedByUser = false;
  status: ConnectionStatus = 'closed';
  debug = false;

  constructor(private url: string) {}

  static defaultUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  /** Hosted servers issue a session token; resume with it on reconnect */
  static readonly SESSION_KEY = 'thang.session';

  private sessionUrl(): string {
    let token: string | null = null;
    try {
      token = localStorage.getItem(Connection.SESSION_KEY);
    } catch {
      /* storage unavailable: the server will issue a new session */
    }
    if (!token || !/^[0-9a-f]{32}$/.test(token)) return this.url;
    return `${this.url}${this.url.includes('?') ? '&' : '?'}session=${token}`;
  }

  rememberSession(token: string): void {
    try {
      localStorage.setItem(Connection.SESSION_KEY, token);
    } catch {
      /* storage unavailable: the game lasts as long as the tab */
    }
  }

  connect(): void {
    this.closedByUser = false;
    this.setStatus('connecting');
    const ws = new WebSocket(this.sessionUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
    };
    ws.onmessage = (ev) => {
      let msg: EngineMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (this.debug) console.debug('[engine->]', msg);
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      if (this.closedByUser || ev.code === 4000) return;
      const delay = Math.min(5000, 250 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (this.debug) console.debug('[->engine]', msg);
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}
