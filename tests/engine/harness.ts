/**
 * Test harness that drives the real native engine (no mocks).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ClientMessage, EngineMessage, FeatureInfo, HelloMessage, PromptMessage, StateMessage,
} from '@thang/protocol';
import { DIR_OFFSETS, type Direction } from '@thang/protocol';
import { Engine } from '../../bridge/src/engine.ts';

export class Session {
  /** Sessions still running, so failed tests can always clean up */
  static live = new Set<Session>();
  readonly engine: Engine;
  readonly dataDir: string;
  private inbox: EngineMessage[] = [];
  private waiters: (() => void)[] = [];
  hello: HelloMessage | null = null;
  state: StateMessage | null = null;
  /** Known map: "x,y" -> [feature, lighting, inView] */
  map = new Map<string, [number, number, number]>();
  width = 0;
  height = 0;
  /** All messages ever received, for inspection */
  history: EngineMessage[] = [];

  constructor(opts: { seed?: number; dataDir?: string; save?: string } = {}) {
    this.dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'thang-test-'));
    this.engine = new Engine({ dataDir: this.dataDir, seed: opts.seed ?? 1234, save: opts.save ?? 'test' });
    this.engine.on('message', (m) => {
      this.history.push(m);
      this.absorb(m);
      this.inbox.push(m);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  private absorb(m: EngineMessage) {
    if (m.type === 'hello') this.hello = m;
    if (m.type === 'state') {
      this.state = m;
      if (m.map) {
        if (m.map.full) this.map.clear();
        this.width = m.map.width;
        this.height = m.map.height;
        for (const [x, y, f, l, v] of m.map.cells) {
          if (f === 0) this.map.delete(`${x},${y}`);
          else this.map.set(`${x},${y}`, [f, l, v]);
        }
      }
    }
  }

  async start(): Promise<void> {
    Session.live.add(this);
    this.engine.start();
    await this.next('state');
  }

  /** Wait for the next message of one of the given types */
  async next(...types: EngineMessage['type'][]): Promise<EngineMessage> {
    const deadline = Date.now() + 20_000;
    while (true) {
      const i = this.inbox.findIndex((m) => types.includes(m.type));
      if (i >= 0) return this.inbox.splice(0, i + 1).pop()!;
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${types.join('/')}`);
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 1000);
      });
    }
  }

  send(m: ClientMessage | string): void {
    this.engine.send(m);
  }

  /** Send and wait for the resulting state or prompt (or error) */
  async request(m: ClientMessage | string): Promise<EngineMessage> {
    this.inbox = [];
    this.send(m);
    return this.next('state', 'prompt', 'error', 'info', 'saved');
  }

  async command(c: Omit<Extract<ClientMessage, { type: 'command' }>, 'type'>): Promise<EngineMessage> {
    return this.request({ type: 'command', ...c } as ClientMessage);
  }

  /** After a prompt the engine sends a state first; return the prompt */
  async commandExpectPrompt(c: Omit<Extract<ClientMessage, { type: 'command' }>, 'type'>): Promise<PromptMessage> {
    this.inbox = [];
    this.send({ type: 'command', ...c } as ClientMessage);
    return (await this.next('prompt')) as PromptMessage;
  }

  async newGame(race = 'Human', cls = 'Warrior', name = 'Tester'): Promise<StateMessage> {
    this.inbox = [];
    this.send({ type: 'new_game', race, class: cls, name, options: { autoexplore_commands: true } });
    await this.next('hello');
    return (await this.next('state')) as StateMessage;
  }

  feature(idx: number): FeatureInfo {
    return this.hello!.features[idx]!;
  }

  featureAt(x: number, y: number): FeatureInfo | null {
    const c = this.map.get(`${x},${y}`);
    return c ? this.feature(c[0]) : null;
  }

  get player() {
    return this.state!.player!;
  }

  /** First adjacent direction whose known terrain matches */
  findDir(pred: (f: FeatureInfo, x: number, y: number) => boolean): Direction | null {
    const p = this.player;
    for (const d of [8, 6, 2, 4, 9, 3, 1, 7] as Direction[]) {
      const [dx, dy] = DIR_OFFSETS[d];
      const f = this.featureAt(p.x + dx, p.y + dy);
      if (f && pred(f, p.x + dx, p.y + dy)) return d;
    }
    return null;
  }

  monsterAt(x: number, y: number) {
    return this.state?.monsters?.find((m) => m.x === x && m.y === y);
  }

  async stop(cleanup = true): Promise<void> {
    Session.live.delete(this);
    await this.engine.stop();
    if (cleanup) rmSync(this.dataDir, { recursive: true, force: true });
  }
}

export const isPassable = (f: FeatureInfo) => f.flags.includes('passable');
export const isWall = (f: FeatureInfo) => f.flags.includes('wall');

/** Stop every session left running by a failed test */
export async function stopAll(): Promise<void> {
  for (const s of [...Session.live]) await s.stop();
}
