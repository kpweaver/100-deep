/**
 * Hosted-mode bridge tests: real bridge, real engines, real WebSockets.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { BridgeConfig } from '../../bridge/src/config.ts';
import { startBridge } from '../../bridge/src/server.ts';

type Bridge = ReturnType<typeof startBridge>;
const open: { bridges: Bridge[]; dirs: string[]; sockets: WebSocket[] } = { bridges: [], dirs: [], sockets: [] };

afterEach(async () => {
  for (const ws of open.sockets.splice(0)) ws.terminate();
  for (const b of open.bridges.splice(0)) await b.close();
  for (const d of open.dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function bridge(config: Partial<BridgeConfig>, onShutdownRequest?: () => void): Promise<Bridge> {
  const dataDir = mkdtempSync(join(tmpdir(), 'thang-bridge-'));
  open.dirs.push(dataDir);
  const b = startBridge({ config: { host: '127.0.0.1', port: 0, dataDir, ...config }, onShutdownRequest });
  open.bridges.push(b);
  await b.ready;
  return b;
}

/** A WebSocket client that records every message */
function client(b: Bridge, query = '', headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}/ws${query}`, { headers });
  open.sockets.push(ws);
  const msgs: any[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    msgs.push(JSON.parse(d.toString()));
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
  const opened = new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });
  return {
    ws, msgs, closed, opened,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    async waitFor(pred: (m: any) => boolean, ms = 15_000): Promise<any> {
      const deadline = Date.now() + ms;
      while (true) {
        const hit = msgs.find(pred);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error('timed out waiting for message');
        await new Promise<void>((res) => { waiters.push(res); setTimeout(res, 200); });
      }
    },
  };
}

async function health(b: Bridge) {
  return (await fetch(`http://127.0.0.1:${b.port}/health`)).json() as Promise<any>;
}

test('each browser gets its own session token, save directory and engine', async () => {
  const b = await bridge({ mode: 'hosted' });
  const a = client(b);
  const c = client(b);
  const sa = await a.waitFor((m) => m.event === 'session');
  const sc = await c.waitFor((m) => m.event === 'session');
  assert.match(sa.session, /^[0-9a-f]{32}$/);
  assert.notEqual(sa.session, sc.session);
  await a.waitFor((m) => m.type === 'state');
  await c.waitFor((m) => m.type === 'state');
  const h = await health(b);
  assert.equal(h.mode, 'hosted');
  assert.equal(h.engines, 2);
  assert.ok(existsSync(join(b.config.dataDir, 'sessions', sa.session)));
});

test('a session token resumes the same game after disconnecting', async () => {
  const b = await bridge({ mode: 'hosted' });
  const a = client(b);
  const { session } = await a.waitFor((m) => m.event === 'session');
  a.send({ type: 'new_game', race: 'Dwarf', class: 'Priest', name: 'Resumer' });
  await a.waitFor((m) => m.type === 'state' && m.phase === 'game');
  a.ws.close();
  await a.closed;
  const again = client(b, `?session=${session}`);
  const s = await again.waitFor((m) => m.event === 'session');
  assert.equal(s.session, session);
  const st = await again.waitFor((m) => m.type === 'state' && m.phase === 'game');
  assert.equal(st.player.name, 'Resumer', 'still the same running game');
  assert.equal((await health(b)).engines, 1);
});

test('capacity limit: extra players are told the server is busy', async () => {
  const b = await bridge({ mode: 'hosted', maxSessions: 1 });
  const a = client(b);
  await a.waitFor((m) => m.type === 'state');
  const c = client(b);
  const busy = await c.waitFor((m) => m.event === 'busy');
  assert.match(busy.message, /full/);
  assert.equal(await c.closed, 1013);
  assert.equal((await health(b)).engines, 1);
});

test('idle games are saved and stopped, and can be resumed later', async () => {
  const b = await bridge({ mode: 'hosted', idleSeconds: 5 });
  const a = client(b);
  const { session } = await a.waitFor((m) => m.event === 'session');
  a.send({ type: 'new_game', race: 'Halfling', class: 'Rogue', name: 'Sleeper' });
  await a.waitFor((m) => m.type === 'state' && m.phase === 'game');
  a.ws.close();
  await a.closed;
  await new Promise((r) => setTimeout(r, 6500));
  assert.equal((await health(b)).engines, 0, 'engine stopped after idling');
  assert.ok(existsSync(join(b.config.dataDir, 'sessions', session, 'save', 'hero')), 'game saved');
  const again = client(b, `?session=${session}`);
  const hello = await again.waitFor((m) => m.type === 'hello');
  assert.equal(hello.saveExists, true);
  again.send({ type: 'load_game' });
  const st = await again.waitFor((m) => m.type === 'state' && m.phase === 'game');
  assert.equal(st.player.name, 'Sleeper');
});

test('bad input is contained: unknown types dropped, oversized messages refused', async () => {
  const b = await bridge({ mode: 'hosted' });
  const a = client(b);
  await a.waitFor((m) => m.type === 'state');
  a.send({ type: 'quit' });          // not a client message type: never reaches the engine
  a.send([1, 2, 3]);                 // not an object
  a.ws.send('{not json');
  a.send({ type: 'ping', id: 7 });
  await a.waitFor((m) => m.type === 'pong' && m.id === 7);
  assert.equal((await health(b)).engines, 1, 'engine still running');
  a.ws.send('x'.repeat(70 * 1024));
  assert.equal(await a.closed, 1009, 'oversized frame closes the socket');
});

test('origin allowlist rejects other sites', async () => {
  const b = await bridge({ mode: 'hosted', allowedOrigins: ['https://play.example'] });
  const bad = client(b, '', { Origin: 'https://evil.example' });
  await assert.rejects(bad.opened);
  const good = client(b, '', { Origin: 'https://play.example' });
  await good.waitFor((m) => m.event === 'session');
});

test('local mode: one game, a new connection replaces the old one', async () => {
  const b = await bridge({ mode: 'local' });
  const a = client(b);
  await a.waitFor((m) => m.type === 'state');
  const c = client(b);
  await c.waitFor((m) => m.type === 'state');
  await a.waitFor((m) => m.event === 'replaced');
  assert.equal(await a.closed, 4000);
  assert.equal((await health(b)).engines, 1);
});

test('quit: local games may stop the server, hosted servers refuse', async () => {
  let asked = 0;
  const local = await bridge({ mode: 'local' }, () => { asked++; });
  const a = client(local);
  await a.waitFor((m) => m.type === 'state');
  a.send({ type: 'shutdown' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(asked, 1, 'local shutdown request reaches the host');

  const hosted = await bridge({ mode: 'hosted' }, () => { asked++; });
  const c = client(hosted);
  await c.waitFor((m) => m.type === 'state');
  c.send({ type: 'shutdown' });
  await c.waitFor((m) => m.event === 'shutdown_refused');
  assert.equal(asked, 1, 'hosted servers never shut down for a client');
});

test('local mode only accepts pages from this machine', async () => {
  const b = await bridge({ mode: 'local' });
  const evil = client(b, '', { Origin: 'https://evil.example' });
  await assert.rejects(evil.opened, 'foreign websites cannot drive a local game');
  const page = client(b, '', { Origin: 'http://localhost:5173' });
  await page.waitFor((m) => m.type === 'state');
});
