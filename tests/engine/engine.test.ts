/**
 * Integration tests against the real Angband engine (no mocked state).
 * Run with: npm run test:engine   (requires npm run build:engine first)
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIR_OFFSETS, type Direction, type StateMessage } from '@thang/protocol';
import { REPO_ROOT } from '../../bridge/src/engine.ts';
import { Session, isPassable, isWall, stopAll } from './harness.ts';

afterEach(stopAll);

test('engine builds, starts and identifies itself', async () => {
  const s = new Session();
  await s.start();
  const h = s.hello!;
  assert.equal(h.protocol, 1);
  assert.match(h.engine, /Angband 4\.2/);
  assert.equal(h.tileset.cellWidth, 32);
  assert.match(h.tileset.url, /gervais\/32x32\.png$/);
  assert.ok(h.races.includes('Dwarf') && h.classes.includes('Mage'));
  const granite = h.features.find((f) => f?.name === 'granite wall')!;
  assert.ok(granite.flags.includes('wall'));
  assert.equal(s.state!.phase, 'menu');
  await s.stop();
});

test('new game creates an authentic character in the town', async () => {
  const s = new Session();
  await s.start();
  const st = await s.newGame('Dwarf', 'Warrior', 'Durin');
  assert.equal(st.phase, 'game');
  assert.equal(st.player!.race, 'Dwarf');
  assert.equal(st.player!.class, 'Warrior');
  assert.equal(st.player!.depth, 0);
  assert.ok(st.player!.maxHp > 0 && st.player!.hp === st.player!.maxHp);
  assert.ok(st.map!.full && st.map!.cells.length > 0);
  assert.ok(st.inventory!.length > 0, 'starting kit present');
  await s.stop();
});

test('movement updates the authoritative position and advances game time', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  const before = { ...s.player, turn: s.state!.turn! };
  const dir = s.findDir((f, x, y) => isPassable(f) && !s.monsterAt(x, y));
  assert.ok(dir, 'some adjacent passable grid');
  const m = (await s.command({ action: 'walk', dir })) as StateMessage;
  const [dx, dy] = DIR_OFFSETS[dir];
  assert.equal(m.player!.x, before.x + dx);
  assert.equal(m.player!.y, before.y + dy);
  assert.ok(m.turn! > before.turn, 'game turn advanced');
  await s.stop();
});

test('walls block movement and cost no time', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  // Walk until a wall is adjacent
  for (let i = 0; i < 40 && !s.findDir(isWall); i++) {
    const d = s.findDir((f, x, y) => isPassable(f) && !s.monsterAt(x, y))!;
    await s.command({ action: 'walk', dir: d });
  }
  const dir = s.findDir(isWall);
  assert.ok(dir, 'found a wall');
  const before = { x: s.player.x, y: s.player.y, turn: s.state!.turn };
  const m = (await s.command({ action: 'walk', dir })) as StateMessage;
  assert.equal(m.player!.x, before.x);
  assert.equal(m.player!.y, before.y);
  assert.equal(m.turn, before.turn, 'bumping a known wall takes no game time');
  assert.ok(m.messages.some((x) => /wall/i.test(x.text)), 'native wall message');
  await s.stop();
});

test('free actions and resyncs never advance the simulation', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  const turn = s.state!.turn;
  // Camera rotation is client-only; these are the engine-side free actions
  await s.command({ action: 'target_clear' });
  await s.command({ action: 'target_closest' });
  s.send({ type: 'hello' });
  await s.next('state');
  await s.request({ type: 'query', what: 'item', item: 'inven:0' });
  await s.command({ action: 'feeling' });
  assert.equal(s.state!.turn, turn);
  await s.stop();
});

test('descending stairs generates a new level with only local knowledge', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  assert.equal(s.player.terrain, 'down staircase', 'new characters start on the stairs');
  const m = (await s.command({ action: 'go_down' })) as StateMessage;
  assert.equal(m.player!.depth, 1);
  assert.ok(m.map!.full, 'new level resets the client map');
  const total = m.map!.width * m.map!.height;
  // Fog of war: only what the player has seen is sent
  assert.ok(m.map!.cells.length < total / 10, `sent ${m.map!.cells.length} of ${total} grids`);
  for (const [, , f] of m.map!.cells) {
    assert.notEqual(s.feature(f)?.name, 'secret door', 'secret doors are never revealed');
  }
  await s.stop();
});

test('only known terrain, visible monsters and known objects reach the client', async () => {
  const s = new Session({ seed: 99 });
  await s.start();
  await s.newGame();
  await s.command({ action: 'go_down' });
  for (let i = 0; i < 60; i++) {
    const r = await s.command({ action: 'explore' });
    if (r.type !== 'state') break;
    const st = r;
    for (const mon of st.monsters ?? []) {
      // Every exported monster must be on a grid the player knows, or sensed
      assert.ok(mon.inView || mon.status !== undefined);
    }
    for (const o of st.objects ?? []) {
      assert.ok(s.map.has(`${o.x},${o.y}`), 'objects only on known grids');
    }
    if ((st.monsters ?? []).some((m) => m.inView)) break;
  }
  const cells = s.history.flatMap((m) => (m.type === 'state' ? m.map?.cells ?? [] : []));
  const hiddenTypes = cells.filter(([, , f]) => s.feature(f)?.name === 'secret door');
  assert.equal(hiddenTypes.length, 0);
  // Opt-in silhouettes: only on unknown grids, mimics applied (no secret doors)
  for (const [, , f, , , , dark] of cells) {
    if (!dark) continue;
    assert.equal(f, 0, 'silhouettes only for unknown grids');
    assert.notEqual(s.feature(dark)?.name, 'secret door');
  }
  await s.stop();
});

test('monster and player tiles come from the Gervais pref file', async () => {
  const prf = readFileSync(resolve(REPO_ROOT, 'engine/upstream/lib/tiles/gervais/graf-dvg.prf'), 'utf8');
  const tiles = new Map<string, [number, number]>();
  for (const line of prf.split('\n')) {
    const m = /^monster:([^:]+):0x([0-9A-Fa-f]+):0x([0-9A-Fa-f]+)/.exec(line);
    if (m && !tiles.has(m[1].toLowerCase())) tiles.set(m[1].toLowerCase(), [parseInt(m[2], 16) & 0x7f, parseInt(m[3], 16) & 0x7f]);
  }
  const s = new Session({ seed: 7 });
  await s.start();
  await s.newGame('Human', 'Warrior');
  // The player icon depends on race/class conditionals in xtra-dvg.prf
  assert.deepEqual(s.hello!.playerTile, [3, 7]);
  let checked = 0;
  for (let i = 0; i < 30 && checked === 0; i++) {
    for (const mon of s.state!.monsters ?? []) {
      if (!mon.race) continue;
      const expected = tiles.get(mon.race.toLowerCase());
      if (expected) {
        assert.deepEqual(mon.tile, expected, `tile for ${mon.race}`);
        checked++;
      }
    }
    if (!checked) await s.command({ action: 'hold' });
  }
  assert.ok(checked > 0, 'saw at least one town monster');
  for (const it of s.state!.inventory!) {
    assert.ok(it.tile && it.tile[0] < 30 && it.tile[1] < 128, `${it.name} has an atlas tile`);
  }
  await s.stop();
});

test('native melee combat resolves in the engine', async () => {
  const s = new Session({ seed: 4242 });
  await s.start();
  await s.newGame('Half-Troll', 'Warrior');
  let fought = false;
  for (let step = 0; step < 300 && !fought; step++) {
    const p = s.player;
    const mons = (s.state!.monsters ?? []).filter((m) => m.inView);
    if (!mons.length) {
      await s.command({ action: 'hold' });
      continue;
    }
    const t = mons.reduce((a, b) => (Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)) ? a : b));
    const dx = Math.sign(t.x - p.x), dy = Math.sign(t.y - p.y);
    const dir = Number(Object.entries(DIR_OFFSETS).find(([, o]) => o[0] === dx && o[1] === dy)![0]) as Direction;
    const turn = s.state!.turn!;
    const r = await s.command({ action: 'walk', dir });
    if (r.type === 'state' && r.messages.some((m) => /You (hit|miss|have slain|bite|smite)/i.test(m.text))) {
      fought = true;
      assert.ok(r.turn! > turn, 'attacking uses game time');
    }
  }
  assert.ok(fought, 'engaged a monster in melee');
  await s.stop();
});

test('item prompts come from the engine and are validated', async () => {
  const s = new Session();
  await s.start();
  await s.newGame('Dwarf', 'Warrior');
  const prompt = await s.commandExpectPrompt({ action: 'quaff' });
  assert.equal(prompt.kind, 'item');
  if (prompt.kind !== 'item') return;
  assert.ok(prompt.items.length > 0 && prompt.items.every((i) => i.tval === 'potion'));
  // An item not offered is refused
  s.send({ type: 'answer', id: prompt.id, value: 'equip:0' });
  const err = await s.next('error');
  assert.equal(err.type === 'error' && err.code, 'bad_answer');
  await s.next('state');
  // A real answer quaffs the potion
  const potion = s.state!.inventory!.find((i) => i.tval === 'potion')!;
  const prompt2 = await s.commandExpectPrompt({ action: 'quaff' });
  const turn = s.state!.turn!;
  s.send({ type: 'answer', id: prompt2.id, value: potion.handle });
  const after = (await s.next('state')) as StateMessage;
  assert.ok(after.turn! > turn);
  const count = (st: StateMessage) => st.inventory!.filter((i) => i.tval === 'potion').reduce((n, i) => n + i.number, 0);
  assert.equal(count(after), potion.number - 1 + (s.history.length ? 0 : 0));
  await s.stop();
});

test('drop and pick up go through native commands', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  const dir = s.findDir((f, x, y) => isPassable(f) && !f.flags.includes('stair') && !f.flags.includes('shop') && !s.monsterAt(x, y))!;
  await s.command({ action: 'walk', dir });
  const item = s.state!.inventory![0];
  await s.command({ action: 'drop', item: item.handle, quantity: 1 });
  assert.equal(s.state!.floor!.length, 1, 'item now on the floor');
  await s.command({ action: 'pickup', item: 'floor:0' });
  assert.equal(s.state!.floor!.length, 0, 'picked back up');
  assert.ok(s.state!.inventory!.some((i) => i.name === item.name || i.name.includes(item.name.split(' ').pop()!)));
  await s.stop();
});

test('engine errors are reported without disrupting the game', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  const turn = s.state!.turn;
  s.send('this is not json');
  assert.equal(((await s.next('error')) as { code: string }).code, 'bad_json');
  s.send({ type: 'command', action: 'fly' } as never);
  assert.equal(((await s.next('error')) as { code: string }).code, 'command_rejected');
  s.send({ type: 'answer', id: 1, value: true });
  assert.equal(((await s.next('error')) as { code: string }).code, 'no_prompt');
  s.send({ type: 'command', action: 'walk', dir: 42 } as never);
  assert.equal(((await s.next('error')) as { code: string }).code, 'command_rejected');
  await s.command({ action: 'target_clear' });
  assert.equal(s.state!.turn, turn);
  assert.equal(s.state!.phase, 'game');
  await s.stop();
});

test('state stays consistent under rapid repeated input', async () => {
  const s = new Session();
  await s.start();
  await s.newGame();
  const dir = s.findDir((f, x, y) => isPassable(f) && !s.monsterAt(x, y))!;
  const opposite = (10 - dir) as Direction;
  const N = 40;
  for (let i = 0; i < N; i++) s.send({ type: 'command', action: 'walk', dir: i % 2 ? opposite : dir });
  const states: StateMessage[] = [];
  while (states.length < N) {
    const m = await s.next('state', 'prompt');
    assert.equal(m.type, 'state', 'no unexpected prompts');
    states.push(m as StateMessage);
  }
  for (let i = 1; i < states.length; i++) {
    assert.ok(states[i].seq > states[i - 1].seq, 'sequence strictly increases');
    const a = states[i - 1].player!, b = states[i].player!;
    assert.ok(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1, 'at most one grid per command');
    assert.ok(states[i].turn! >= states[i - 1].turn!, 'time never runs backwards');
  }
  await s.stop();
});

test('save and reload restore the same game', async () => {
  const a = new Session({ save: 'persist' });
  await a.start();
  await a.newGame('Elf', 'Mage', 'Galadhon');
  const dir = a.findDir((f, x, y) => isPassable(f) && !a.monsterAt(x, y))!;
  await a.command({ action: 'walk', dir });
  const before = { x: a.player.x, y: a.player.y, turn: a.state!.turn, hp: a.player.hp, inv: a.state!.inventory!.length };
  const saved = await a.request({ type: 'save' });
  assert.ok(saved.type === 'saved' && saved.ok);
  await a.stop(false);

  const b = new Session({ save: 'persist', dataDir: a.dataDir });
  await b.start();
  assert.ok(b.hello!.saveExists);
  b.send({ type: 'load_game' });
  await b.next('hello');
  const st = (await b.next('state')) as StateMessage;
  assert.equal(st.player!.name, 'Galadhon');
  assert.equal(st.player!.x, before.x);
  assert.equal(st.player!.y, before.y);
  assert.equal(st.turn, before.turn);
  assert.equal(st.player!.hp, before.hp);
  assert.equal(st.inventory!.length, before.inv);
  await b.stop();
});

test('closing stdin saves the game (abnormal client termination)', async () => {
  const a = new Session({ save: 'eof' });
  await a.start();
  await a.newGame('Hobbit', 'Rogue', 'Bilbo');
  const dir = a.findDir((f, x, y) => isPassable(f) && !a.monsterAt(x, y))!;
  await a.command({ action: 'walk', dir });
  const pos = { x: a.player.x, y: a.player.y };
  await a.stop(false);
  const b = new Session({ save: 'eof', dataDir: a.dataDir });
  await b.start();
  b.send({ type: 'load_game' });
  await b.next('hello');
  const st = (await b.next('state')) as StateMessage;
  assert.deepEqual({ x: st.player!.x, y: st.player!.y }, pos);
  await b.stop();
});

test('character death follows the native flow and a new game can start', async () => {
  // Deterministic with this seed: a hobbit mage who never eats or rests
  const s = new Session({ seed: 31337, save: 'doomed' });
  await s.start();
  await s.newGame('Hobbit', 'Mage', 'Frodo');
  const step = (dx: number, dy: number) =>
    Number(Object.entries(DIR_OFFSETS).find(([, o]) => o[0] === Math.sign(dx) && o[1] === Math.sign(dy))![0]) as Direction;
  for (let n = 0; n < 3000 && s.state!.phase === 'game'; n++) {
    const p = s.player;
    const seen = (s.state!.monsters ?? []).filter((m) => m.inView);
    let r;
    if (seen.length) {
      r = await s.command({ action: 'walk', dir: step(seen[0].x - p.x, seen[0].y - p.y) });
      if (r.type === 'state' && r.turn === s.state!.turn) r = await s.command({ action: 'hold' });
    } else if (p.terrain === 'down staircase') {
      r = await s.command({ action: 'go_down' });
    } else {
      r = await s.command({ action: 'navigate_down' });
      if (r.type === 'state' && r.messages.some((m) => /Something|No known path/i.test(m.text))) r = await s.command({ action: 'explore' });
      if (r.type === 'state' && r.messages.some((m) => /No apparent path/i.test(m.text))) r = await s.command({ action: 'hold' });
    }
    if (r.type === 'prompt') {
      s.send({ type: 'cancel', id: r.id });
      await s.next('state');
    }
  }
  const st = s.state!;
  assert.equal(st.phase, 'dead');
  assert.ok(st.player!.dead && st.player!.diedFrom, 'died_from recorded');
  // No more commands for the dead
  s.send({ type: 'command', action: 'walk', dir: 2 });
  assert.equal((await s.next('error', 'state')).type, 'error');
  // The dead savefile cannot be resumed
  s.send({ type: 'load_game' });
  const err = await s.next('error');
  assert.equal(err.type === 'error' && err.code, 'character_dead');
  // But a new character can start in the same process
  const ng = await s.newGame('Human', 'Warrior', 'Again');
  assert.equal(ng.phase, 'game');
  assert.equal(ng.player!.name, 'Again');
  assert.equal(ng.player!.depth, 0);
  await s.stop();
});

test('returning to the title saves, and the game can be continued', async () => {
  const s = new Session({ save: 'title' });
  await s.start();
  await s.newGame('Dwarf', 'Priest', 'Thrain');
  const dir = s.findDir((f, x, y) => isPassable(f) && !s.monsterAt(x, y))!;
  await s.command({ action: 'walk', dir });
  const before = { x: s.player.x, y: s.player.y, turn: s.state!.turn };
  s.send({ type: 'close_game' });
  const hello = await s.next('hello');
  assert.ok(hello.type === 'hello' && hello.saveExists);
  const menu = (await s.next('state')) as StateMessage;
  assert.equal(menu.phase, 'menu');
  assert.equal(menu.player, undefined, 'no character data at the title');
  // Game commands are refused at the title
  s.send({ type: 'command', action: 'walk', dir });
  assert.equal(((await s.next('error')) as { code: string }).code, 'command_rejected');
  s.send({ type: 'load_game' });
  await s.next('hello');
  const st = (await s.next('state')) as StateMessage;
  assert.equal(st.phase, 'game');
  assert.equal(st.player!.name, 'Thrain');
  assert.deepEqual({ x: st.player!.x, y: st.player!.y, turn: st.turn }, before);
  assert.ok(st.map!.full);
  await s.stop();
});

test('stock subwindows (lists, recall, character sheet) come from Angband', async () => {
  const s = new Session({ seed: 7 });
  await s.start();
  await s.newGame('Human', 'Warrior', 'Tester');
  const text = (p: { lines: unknown[][] } | null | undefined) =>
    (p?.lines ?? []).map((l) => l.map((seg) => (typeof (seg as unknown[])[0] === 'string' ? (seg as [string])[0] : '#')).join('')).join('\n');
  const first = s.history.filter((m): m is StateMessage => m.type === 'state').pop()!;
  assert.ok(first.panels?.monsterList, 'monster list sent with the first game state');
  const visible = (first.monsters ?? []).filter((m) => m.inView);
  assert.match(text(first.panels!.monsterList), new RegExp(`You can see ${visible.length} monster`));
  assert.match(text(first.panels!.itemList), /object/);
  // Tile glyphs survive as atlas coordinates
  assert.ok(first.panels!.monsterList!.lines.some((l) => l.some((seg) => Array.isArray(seg[0]))));

  // Targeting tracks the monster, so its recall appears (and only changed panels are re-sent)
  const r = (await s.command({ action: 'target_closest' })) as StateMessage;
  assert.ok(r.panels?.monsterRecall?.title, 'recall for the targeted monster');
  assert.match(text(r.panels!.monsterRecall), /town/i);
  const r2 = (await s.command({ action: 'target_closest' })) as StateMessage;
  assert.equal(r2.panels?.monsterRecall, undefined, 'unchanged recall is not re-sent');

  // Character sheet pages drawn by display_player()
  s.send({ type: 'query', what: 'character', page: 0 });
  const c0 = await s.next('screen');
  assert.ok(c0.type === 'screen' && /Tester/.test(text(c0)) && /Saving Throw/.test(text(c0)));
  s.send({ type: 'query', what: 'character', page: 1 });
  const c1 = await s.next('screen');
  assert.ok(c1.type === 'screen' && /Acid:/.test(text(c1)) && /pFear:/.test(text(c1)));
  await s.stop();
});
