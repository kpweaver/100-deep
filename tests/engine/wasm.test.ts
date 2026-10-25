/**
 * The WebAssembly build of the engine (the itch.io / browser-only version),
 * driven through the same host code as the browser worker.
 * Run with: npm run test:wasm   (requires npm run build:web first)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineMessage, StateMessage } from '@thang/protocol';
import { REPO_ROOT } from '../../bridge/src/engine.ts';
import { EngineHost } from '../../client/src/wasm/engine-host.ts';

const WASM_DIR = join(REPO_ROOT, 'build/wasm');
const built = existsSync(join(WASM_DIR, 'angband.mjs'));

class WasmSession {
  host: EngineHost;
  history: EngineMessage[] = [];
  private waiters: (() => void)[] = [];

  constructor(autosaveMs = 0) {
    this.host = new EngineHost({
      baseUrl: WASM_DIR,
      persist: false,
      autosaveMs,
      seed: 4321,
      emit: (line) => {
        this.history.push(JSON.parse(line));
        for (const w of this.waiters.splice(0)) w();
      },
      onExit: (reason) => assert.fail(`engine exited: ${reason}`),
    });
  }

  send(msg: object) {
    this.host.send(JSON.stringify(msg));
  }

  /** Next message of a type, after `from` messages already seen */
  async next<T extends EngineMessage['type']>(type: T, from = this.history.length, ms = 10_000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const m = this.history.slice(from).find((x) => x.type === type);
      if (m) return m as Extract<EngineMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }
}

test('wasm engine boots, creates a character and plays', { skip: !built && 'run npm run build:web first' }, async () => {
  const s = new WasmSession();
  await s.host.start();
  const hello = await s.next('hello', 0);
  assert.match(hello.engine, /Angband 4\.2/);
  assert.equal(hello.savefile, '/data/save/hero');
  assert.equal((await s.next('state', 0)).phase, 'menu');

  let mark = s.history.length;
  s.send({ type: 'new_game', name: 'Wasm', race: 'Dwarf', class: 'Priest', quick: true });
  const st: StateMessage = await s.next('state', mark);
  assert.equal(st.phase, 'game');
  assert.equal(st.player!.race, 'Dwarf');
  assert.ok(st.map!.full && st.map!.cells.length > 0);

  // A turn passes when walking (into a wall or not, the engine answers)
  mark = s.history.length;
  s.send({ type: 'command', action: 'hold' });
  assert.equal((await s.next('state', mark)).phase, 'game');

  mark = s.history.length;
  s.send({ type: 'save' });
  assert.equal((await s.next('saved', mark)).ok, true);
});

test('wasm idle autosave is quiet', { skip: !built && 'run npm run build:web first' }, async () => {
  const s = new WasmSession(50);
  await s.host.start();
  await s.next('state', 0);
  const mark = s.history.length;
  s.send({ type: 'new_game', name: 'Quiet', race: 'Human', class: 'Warrior', quick: true });
  await s.next('state', mark);
  // Idle delay is 1 s; give it time, then the save must exist with no note shown
  await new Promise((r) => setTimeout(r, 1600));
  assert.ok(!s.history.slice(mark).some((m) => m.type === 'saved' || m.type === 'error'));
  const after = s.history.length;
  s.send({ type: 'load_game' });
  // The autosaved character loads (the title "Continue" path)
  assert.equal((await s.next('state', after)).phase, 'game');
});
