/**
 * Runs the WebAssembly build of the engine (build/wasm/angband.mjs): the
 * same unmodified Angband core and protocol adapter as the native binary,
 * speaking the same JSON lines.  Used by the browser worker and by tests
 * under Node.
 *
 * The engine blocks waiting for the next client line; with Asyncify that
 * wait is a promise (Module.thangNextLine), resolved by send().
 *
 * Saves live in /data.  In browsers it is an IndexedDB-backed filesystem
 * (IDBFS), flushed shortly after the engine writes anything, so a save
 * survives closing the tab.
 */

/* Minimal typing of the Emscripten module (see engine/CMakeLists.txt) */
interface EmFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: object, path: string): void;
  syncfs(populate: boolean, cb: (err: unknown) => void): void;
}
interface EmModule {
  FS: EmFS;
  IDBFS?: unknown;
  callMain(args: string[]): unknown;
}
type Factory = (opts: Record<string, unknown>) => Promise<EmModule>;

export interface EngineHostOptions {
  /** URL (or path, under Node) of the directory holding angband.mjs/.wasm/.data */
  baseUrl: string;
  /** Persist /data in IndexedDB (browsers only) */
  persist: boolean;
  /** Called with each engine->client JSON line */
  emit(line: string): void;
  /** The engine stopped (fatal error or crash) */
  onExit(reason: string): void;
  /** Optional engine stderr (debug logging) */
  log?(line: string): void;
  /**
   * Save quietly when the engine has sat idle briefly after play, at most
   * this often (ms).  Browsers can kill the page without warning, so this
   * keeps the stored game within seconds of the screen.  0 disables.
   */
  autosaveMs?: number;
  save?: string;
  seed?: number;
  debug?: boolean;
}

/** How long the engine must wait for input before an idle autosave */
const IDLE_SAVE_DELAY_MS = 1000;

export class EngineHost {
  private inbox: (string | null)[] = [];
  private waiter: ((line: string | null) => void) | null = null;
  private fs: EmFS | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<void> = Promise.resolve();
  private dirty = false;
  private quietSave = 0;
  private played = false;
  private lastSave = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private opts: EngineHostOptions;
  stopped = false;

  constructor(opts: EngineHostOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const base = this.opts.baseUrl.endsWith('/') ? this.opts.baseUrl : this.opts.baseUrl + '/';
    const mod = (await import(/* @vite-ignore */ base + 'angband.mjs')) as { default: Factory };
    const engine = await mod.default({
      locateFile: (p: string) => base + p,
      thangEmit: (line: string) => this.fromEngine(line),
      thangNextLine: () => this.nextLine(),
      print: (s: string) => this.opts.log?.(s),
      printErr: (s: string) => this.opts.log?.(s),
      quit: (status: number, toThrow: unknown) => {
        this.exited(`exit ${status}`);
        throw toThrow;
      },
      onAbort: (what: unknown) => this.exited(`crashed: ${String(what)}`),
    });

    const FS = engine.FS;
    this.fs = FS;
    FS.mkdir('/data');
    if (this.opts.persist && engine.IDBFS && typeof indexedDB !== 'undefined') {
      FS.mount(engine.IDBFS, { autoPersist: false }, '/data');
      await new Promise<void>((resolve, reject) => FS.syncfs(true, (e) => (e ? reject(e) : resolve())));
    }

    const args = ['--lib', '/lib', '--data', '/data', '--save', this.opts.save ?? 'hero'];
    if (this.opts.seed !== undefined) args.push('--seed', String(this.opts.seed));
    if (this.opts.debug) args.push('--debug');
    // Returns as soon as main() first waits for input
    engine.callMain(args);
  }

  /** Send one client->engine message (a JSON line) */
  send(line: string): void {
    if (this.stopped) return;
    this.played = true;
    this.sendRaw(line);
  }

  private sendRaw(line: string): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w(line);
    } else this.inbox.push(line);
  }

  /**
   * Save without the player asking (tab hidden, periodic).  The engine
   * refuses while a prompt is open or at the title; those replies, and the
   * "saved" note, are swallowed.
   */
  autosave(): void {
    if (this.stopped) return;
    this.quietSave++;
    this.played = false;
    this.lastSave = Date.now();
    this.sendRaw('{"type":"save"}');
  }

  /** Write pending save data to IndexedDB now */
  flush(): Promise<void> {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    if (!this.dirty || !this.fs || !this.opts.persist) return this.syncing;
    this.dirty = false;
    const fs = this.fs;
    this.syncing = this.syncing.then(
      () => new Promise<void>((resolve) => fs.syncfs(false, () => resolve())),
    );
    return this.syncing;
  }

  private nextLine(): Promise<string | null> {
    if (this.inbox.length) return Promise.resolve(this.inbox.shift()!);
    // About to block: anything the engine just wrote can be persisted
    this.scheduleFlush();
    this.scheduleIdleSave();
    return new Promise((resolve) => (this.waiter = resolve));
  }

  private fromEngine(line: string): void {
    this.dirty = true;
    if (this.quietSave > 0) {
      if (line.startsWith('{"type":"saved"')) {
        this.quietSave--;
        this.flush();
        return;
      }
      if (line.startsWith('{"type":"error"') && /"code":"(prompt_pending|in_store|no_game)"/.test(line)) {
        this.quietSave--;
        return;
      }
    }
    this.opts.emit(line);
  }

  private scheduleFlush(): void {
    if (!this.opts.persist || !this.dirty || this.syncTimer) return;
    this.syncTimer = setTimeout(() => this.flush(), 500);
  }

  private scheduleIdleSave(): void {
    const every = this.opts.autosaveMs ?? 0;
    if (!every || !this.played || this.idleTimer) return;
    const wait = Math.max(IDLE_SAVE_DELAY_MS, this.lastSave + every - Date.now());
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.autosave();
    }, wait);
  }

  private exited(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.waiter = null;
    this.opts.onExit(reason);
  }
}
