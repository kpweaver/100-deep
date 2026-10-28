/**
 * Isolated client unit tests.  These use small hand-written messages only
 * to exercise client data structures; engine behaviour is covered by the
 * native integration tests in tests/engine.
 */
import { describe, expect, it } from 'vitest';
import type { FeatureInfo, HelloMessage, StateMessage } from '@thang/protocol';
import { FACING_TO_DIR, dirFromOffset } from '@thang/protocol';
import { KnownMap } from '../src/state/known-map.ts';
import { classifyFeature } from '../src/state/features.ts';
import { GameState } from '../src/state/game-state.ts';
import { firstStepToward } from '../src/state/pathing.ts';
import { GridCamera } from '../src/camera/grid-camera.ts';
import { HeadingFollower } from '../src/camera/heading.ts';
import { glyphStyleFromId, promptsFor } from '../src/input/actions.ts';
import { bindKey, bindPad, defaultBindings, keyIdFromLabel, keyLabel, keysFor, loadBindings, padLabel, padTable } from '../src/input/bindings.ts';
import { TileAtlas } from '../src/sprites/atlas.ts';
import { sliceAt } from '../src/ui/wheel.ts';
import { parseLabel } from '../src/ui/glyphs.ts';

const feat = (idx: number, name: string, flags: string[]): FeatureInfo => ({ idx, name, flags, tiles: [] });

describe('KnownMap', () => {
  it('applies full and delta updates', () => {
    const m = new KnownMap();
    m.apply({ width: 4, height: 3, full: true, cells: [[1, 1, 21, 2, 0, null]] });
    expect(m.featAt(1, 1)).toBe(21);
    expect(m.isKnown(0, 0)).toBe(false);
    const gen = m.generation;
    expect(m.apply({ width: 4, height: 3, full: false, cells: [[2, 1, 1, 0, 1, [5, 6]]] })).toBe(true);
    expect(m.generation).toBe(gen);
    expect(m.isInView(2, 1)).toBe(true);
    expect(m.traps.get(m.index(2, 1))).toEqual([5, 6]);
    // Feature 0 forgets a grid (e.g. amnesia)
    m.apply({ width: 4, height: 3, full: false, cells: [[1, 1, 0, 0, 0, null]] });
    expect(m.isKnown(1, 1)).toBe(false);
    // Full update discards everything
    m.apply({ width: 4, height: 3, full: true, cells: [] });
    expect(m.featAt(2, 1)).toBe(0);
    expect(m.traps.size).toBe(0);
  });

  it('keeps dark silhouettes separate from known terrain', () => {
    const m = new KnownMap();
    m.apply({ width: 4, height: 3, full: true, cells: [[2, 1, 0, 0, 0, null, 21]] });
    expect(m.isKnown(2, 1)).toBe(false);
    expect(m.dark[m.index(2, 1)]).toBe(21);
    // Once seen, the grid is known and the silhouette goes away
    m.apply({ width: 4, height: 3, full: false, cells: [[2, 1, 21, 0, 1, null, 0]] });
    expect(m.isKnown(2, 1)).toBe(true);
    expect(m.dark[m.index(2, 1)]).toBe(0);
  });

  it('ignores out-of-bounds cells', () => {
    const m = new KnownMap();
    m.apply({ width: 2, height: 2, full: true, cells: [[5, 5, 1, 0, 1, null]] });
    expect(m.featAt(5, 5)).toBe(0);
  });
});

describe('feature classification', () => {
  it('maps Angband terrain flags to shapes', () => {
    expect(classifyFeature(feat(21, 'granite wall', ['wall', 'rock', 'granite'])).shape).toBe('wall');
    expect(classifyFeature(feat(2, 'closed door', ['door', 'door_closed'])).shape).toBe('door_closed');
    expect(classifyFeature(feat(3, 'open door', ['los', 'passable', 'door'])).shape).toBe('door_open');
    expect(classifyFeature(feat(6, 'down staircase', ['passable', 'stair', 'downstair'])).shape).toBe('stair_down');
    expect(classifyFeature(feat(16, 'pile of rubble', ['rock'])).shape).toBe('rubble');
    expect(classifyFeature(feat(24, 'passable rubble', ['rock', 'passable'])).shape).toBe('passable_rubble');
    expect(classifyFeature(feat(23, 'lava', ['passable', 'fiery'])).shape).toBe('lava');
    expect(classifyFeature(feat(22, 'permanent wall', ['permanent', 'wall'])).material).toBe('permanent');
    expect(classifyFeature(feat(19, 'magma with treasure', ['wall', 'magma', 'gold'])).treasure).toBe(true);
    // A secret door (never sent by the engine) would still look like a wall
    expect(classifyFeature(feat(15, 'secret door', ['wall', 'rock', 'door'])).shape).toBe('wall');
    expect(classifyFeature(null).shape).toBe('unknown');
  });
});

describe('GridCamera', () => {
  it('turning is local and changes only facing', () => {
    const cam = new GridCamera();
    cam.instant = true;
    cam.teleport(10, 5);
    cam.turn(1);
    expect(cam.facing).toBe(1);
    expect([cam.gridX, cam.gridY]).toEqual([10, 5]);
    cam.turn(-2);
    expect(cam.facing).toBe(7);
  });

  it('maps relative moves onto keypad directions', () => {
    const cam = new GridCamera();
    expect(cam.relativeDir(0)).toBe(8); // facing north: forward
    expect(cam.relativeDir(2)).toBe(6); // strafe right = east
    expect(cam.relativeDir(4)).toBe(2); // back = south
    cam.instant = true;
    cam.turn(3); // face south-east
    expect(cam.relativeDir(0)).toBe(3);
    expect(cam.relativeDir(6)).toBe(9); // strafe left = north-east
  });

  it('faces absolute directions by the shortest turn', () => {
    const cam = new GridCamera();
    cam.instant = true;
    cam.face(4);
    expect(FACING_TO_DIR[cam.facing]).toBe(4);
  });

  it('curves diagonal steps around a wall corner instead of clipping it', () => {
    // Step (0,0) -> (1,1) with a wall at (1,0): its corner (0.5, 0.5) is
    // exactly the midpoint of a straight path
    const cam = new GridCamera();
    cam.teleport(0, 0);
    cam.moveTo(1, 1, { via: [0, 1] });
    let minCorner = Infinity;
    for (let i = 0; i < 40 && cam.busy; i++) {
      cam.tick(0.01);
      const { x, z } = cam.camera.position;
      minCorner = Math.min(minCorner, Math.hypot(x - 0.5, z - 0.5));
      const insideWall = x > 0.5 && x < 1.5 && z > -0.5 && z < 0.5;
      expect(insideWall).toBe(false);
    }
    expect(minCorner).toBeGreaterThan(0.3);
    expect(cam.camera.position.x).toBeCloseTo(1);
    expect(cam.camera.position.z).toBeCloseTo(1);
  });

  it('snaps when squeezing diagonally between two walls', () => {
    const cam = new GridCamera();
    cam.teleport(0, 0);
    cam.moveTo(1, 1, { snap: true });
    expect(cam.busy).toBe(false);
    expect([cam.camera.position.x, cam.camera.position.z]).toEqual([1, 1]);
    cam.moveTo(2, 1);
    expect(cam.busy).toBe(true); // ordinary steps still animate
  });

  it('snaps long moves instead of interpolating through walls', () => {
    const cam = new GridCamera();
    cam.teleport(0, 0);
    cam.moveTo(10, 0);
    expect(cam.busy).toBe(false);
    expect(cam.camera.position.x).toBe(10);
  });
});

describe('protocol helpers', () => {
  it('converts offsets to directions', () => {
    expect(dirFromOffset(1, -1)).toBe(9);
    expect(dirFromOffset(-3, 0)).toBe(4);
    expect(dirFromOffset(0, 0)).toBe(5);
  });
});

describe('TileAtlas', () => {
  it('computes UVs for atlas cells', () => {
    const atlas = new TileAtlas({ id: 3, name: 'g', url: 'tiles/gervais/32x32.png', cellWidth: 32, cellHeight: 32 });
    atlas.cols = 128;
    atlas.rows = 30;
    const [ox, oy, rx, ry] = atlas.uvRect([0, 0]);
    expect(ox).toBe(0);
    expect(rx).toBeCloseTo(1 / 128);
    expect(oy + ry).toBeCloseTo(1); // row 0 is at the top of the image
    // Relative to the page, so the game also works from a sub-path (itch.io)
    expect(atlas.url).toBe('tiles/gervais/32x32.png');
  });
});

describe('GameState', () => {
  const hello: HelloMessage = {
    type: 'hello', protocol: 1, engine: 'Angband 4.2.6', savefile: 'x', saveExists: false,
    races: [], classes: [], options: [],
    tileset: { id: 3, name: 'g', url: 't', cellWidth: 32, cellHeight: 32 },
    features: [null, feat(1, 'open floor', ['passable', 'floor'])], playerTile: null, palette: [],
  };
  const state = (seq: number, x: number): StateMessage => ({
    type: 'state', seq, phase: 'game', turn: seq * 10, levelId: 1,
    player: { x, y: 1, depth: 1 } as StateMessage['player'],
    map: { width: 5, height: 5, full: seq === 1, cells: [[x, 1, 1, 0, 1, null]] },
    monsters: [], objects: [], messages: [{ text: `step ${seq}`, type: 0 }], effects: [],
  });

  it('applies states in order and reports movement', () => {
    const gs = new GameState();
    gs.applyHello(hello);
    const changes: unknown[] = [];
    gs.subscribe((c) => changes.push(c));
    gs.applyState(state(1, 1));
    gs.applyState(state(2, 2));
    expect(gs.player!.x).toBe(2);
    expect((changes[1] as { moved?: object }).moved).toEqual({ fromX: 1, fromY: 1 });
    // A stale/duplicate state is ignored
    gs.applyState(state(2, 4));
    expect(gs.player!.x).toBe(2);
    expect(gs.log.map((l) => l.text)).toEqual(['step 1', 'step 2']);
  });

  it('a new state supersedes a pending prompt', () => {
    const gs = new GameState();
    gs.applyHello(hello);
    gs.applyState(state(1, 1));
    gs.applyPrompt({ type: 'prompt', id: 1, kind: 'confirm', prompt: 'Sure?' });
    expect(gs.prompt).not.toBeNull();
    gs.applyState(state(2, 1));
    expect(gs.prompt).toBeNull();
  });

  it('sequence numbers restart after a hello (engine restart)', () => {
    const gs = new GameState();
    gs.applyHello(hello);
    gs.applyState(state(5, 1));
    gs.applyHello(hello);
    gs.applyState(state(1, 3));
    expect(gs.player!.x).toBe(3);
  });
});

describe('HeadingFollower (auto-explore facing)', () => {
  const run = (steps: [number, number][], start = 0) => {
    const f = new HeadingFollower();
    let facing = start;
    const facings: number[] = [];
    for (const [dx, dy] of steps) {
      facing = (((facing + f.step(dx, dy, facing)) % 8) + 8) % 8;
      facings.push(facing);
    }
    return facings;
  };

  it('keeps facing steady through a diagonal zig-zag', () => {
    // NE, SE, NE, SE ... along an eastward corridor, already facing east
    const zigzag = Array.from({ length: 10 }, (_, i) => (i % 2 ? [1, 1] : [1, -1]) as [number, number]);
    expect(new Set(run(zigzag, 2))).toEqual(new Set([2]));
  });

  it('turns at a corner on the first step round it (no strafing)', () => {
    const path: [number, number][] = [[1, 0], [1, 0], [1, 0], [0, 1], [0, 1], [0, 1]];
    expect(run(path, 2)).toEqual([2, 2, 2, 4, 4, 4]);
    // And the other way, round a left-hand corner
    expect(run([[-1, 0], [-1, 0], [0, -1], [0, -1]], 6)).toEqual([6, 6, 0, 0]);
  });

  it('faces a long diagonal after one step of it', () => {
    expect(run([[1, 0], [1, -1], [1, -1], [1, -1]], 2)).toEqual([2, 2, 1, 1]);
    expect(run([[-1, 0], [-1, -1], [-1, -1]], 6)).toEqual([6, 6, 7]);
  });

  it('faces the diagonal of a staircase of straight steps', () => {
    expect(run([[1, 0], [0, -1], [1, 0], [0, -1], [1, 0]], 2).slice(2)).toEqual([1, 1, 1]);
  });

  it('turns around at once when doubling back', () => {
    const f = new HeadingFollower();
    expect(f.step(0, 1, 0)).toBe(4); // facing north, step south: reverse now
  });

  it('ignores a single 45-degree jog', () => {
    const f = new HeadingFollower();
    expect(f.step(1, 0, 2)).toBe(0);
    expect(f.step(1, -1, 2)).toBe(0);
    expect(f.step(1, 0, 2)).toBe(0);
  });
});

describe('controller button labels', () => {
  it('detects controller families from Gamepad API ids', () => {
    expect(glyphStyleFromId('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(glyphStyleFromId('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(glyphStyleFromId('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)')).toBe('xbox');
    expect(glyphStyleFromId('Some Generic Pad')).toBe('xbox');
  });

  it('relabels prompts by button position', () => {
    const ps = promptsFor('gamepad', 'playstation');
    expect(ps.confirm).toBe('✕');
    expect(ps.back).toBe('○');
    expect(ps.rest).toBe('Hold △');
    expect(ps.tabs).toBe('L1/R1');
    // Action wheels: LT aims (hold: combat wheel), RB fires, L3 examines, Select lists every command
    expect(ps.aim).toBe('L2');
    expect(ps.combatWheel).toBe('Hold L2');
    expect(ps.fire).toBe('R1');
    expect(ps.look).toBe('L3');
    expect(ps.commands).toBe('Share');
    const nin = promptsFor('gamepad', 'nintendo');
    expect(nin.confirm).toBe('B'); // bottom button is labelled B on Nintendo pads
    expect(nin.attack).toBe('ZR');
    expect(promptsFor('keyboard', 'playstation').confirm).toBe('Enter');
  });
});

describe('bindings', () => {
  it('defaults to Angband keys, with WASD as a preset', () => {
    const a = defaultBindings();
    expect(a.keys.q).toBe('cmd:quaff');
    expect(a.keys.m).toBe('spells');
    expect(a.keys.l).toBe('look');
    expect(a.keys['*']).toBe('aim');
    expect(a.keys.Enter).toBe('commands');
    expect(a.keys.ArrowUp).toBe('moveForward');
    const w = defaultBindings('wasd');
    expect(w.keys.w).toBe('moveForward');
    expect(w.keys.q).toBe('turnLeft');
    expect(w.keys.r).toBe('cmd:read');
  });

  it('swaps when a key or button is already taken', () => {
    const b = defaultBindings();
    expect(bindKey(b, 'cmd:quaff', 'r')).toBe('cmd:read');
    expect(b.keys.r).toBe('cmd:quaff');
    expect(b.keys.q).toBe('cmd:read');
    expect(keysFor(b, 'spells')).toEqual(['m', 'b']);
    expect(keysFor(b, 'cmd:pickup')).toEqual(['p', 'g']);
    bindKey(b, 'spells', 'Ctrl+k');
    expect(keysFor(b, 'spells')).toEqual(['Ctrl+k']);
    // Controller: explore onto RT swaps with melee
    expect(bindPad(b, 'explore', { button: 7 })).toBe('attack');
    expect(b.pad.attack).toEqual({ button: 2 });
    const t = padTable(b);
    expect(t.get(3)).toEqual({ tap: 'wait', hold: 'rest' });
    expect(t.get(6)).toEqual({ tap: 'aim', hold: 'combatWheel' });
    expect(t.get(4)).toEqual({ tap: 'inventory', hold: 'gearWheel' });
    expect(t.get(0)).toEqual({ tap: 'interact', hold: 'contextMenu' });
  });

  it('labels keys and buttons, and survives bad saved data', () => {
    expect(keyLabel('Shift+ArrowUp')).toBe('Shift+↑');
    expect(keyLabel('Numpad5')).toBe('Num 5');
    expect(padLabel({ button: 4, hold: true }, 'playstation')).toBe('Hold L1');
    expect(loadBindings(null).keys.q).toBe('cmd:quaff');
    expect(loadBindings({ version: 9 }).preset).toBe('angband');
  });

  it('moves saved controls onto the wheel layout, keeping rebound keys', () => {
    // Saved before the wheels: Orbrun-style buttons, h as the engine's fire-at-nearest
    const old = { version: 1, preset: 'angband', keys: { ...defaultBindings().keys, h: 'cmd:fire_at_nearest', k: 'cmd:quaff' }, pad: { attack: { button: 7 }, explore: { button: 6 }, wait: { button: 4 } } };
    const b = loadBindings(old);
    expect(b.padLayout).toBe(2);
    expect(b.pad.fire).toEqual({ button: 5 });
    expect(b.pad.explore).toEqual({ button: 2 });
    expect(b.keys.h).toBe('fire');
    expect(b.keys.k).toBe('cmd:quaff');
    // Rebound buttons on the new layout are kept
    const mine = defaultBindings();
    bindPad(mine, 'fire', { button: 4 });
    expect(loadBindings(JSON.parse(JSON.stringify(mine))).pad.fire).toEqual({ button: 4 });
  });
});

describe('action wheel', () => {
  it('picks the slice a stick points at, clockwise from the top', () => {
    expect(sliceAt(0, -1)).toBe(0);
    expect(sliceAt(0.7, -0.7)).toBe(1);
    expect(sliceAt(1, 0.1)).toBe(2);
    expect(sliceAt(0, 1)).toBe(4);
    expect(sliceAt(-1, 0)).toBe(6);
    expect(sliceAt(-0.7, -0.7)).toBe(7);
  });
});

describe('firstStepToward', () => {
  // # wall, . floor; P player, M monster
  const grid = (rows: string[]) => {
    let from = { x: 0, y: 0 }, to = { x: 0, y: 0 };
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === 'P') from = { x, y };
      if (c === 'M') to = { x, y };
    }));
    const walkable = (x: number, y: number) => rows[y]?.[x] !== undefined && rows[y][x] !== '#';
    return { from, to, walkable };
  };

  it('steps straight when nothing is in the way', () => {
    const g = grid(['P...M']);
    expect(firstStepToward(g.from, g.to, g.walkable)).toBe(6);
  });

  it('goes round a wall instead of into it', () => {
    const g = grid([
      '#######',
      '#P#...#',
      '#.#.#M#',
      '#...#.#',
      '#######',
    ]);
    // The diagonal toward the monster is a wall: the only way is down
    expect(firstStepToward(g.from, g.to, g.walkable)).toBe(2);
  });

  it('gives up when there is no known way', () => {
    const g = grid(['P#M']);
    expect(firstStepToward(g.from, g.to, g.walkable)).toBeNull();
  });
});

describe('controller glyphs', () => {
  it('turns button labels into glyph pieces, and leaves keys alone', () => {
    expect(parseLabel('Hold LT', 'xbox')).toEqual(['Hold', ['trigger', 'LT', undefined]]);
    expect(parseLabel('A', 'xbox')).toEqual([['face', 'A', 'green']]);
    expect(parseLabel('LB/RB', 'xbox')).toEqual([['bumper', 'LB', undefined], '/', ['bumper', 'RB', undefined]]);
    expect(parseLabel('D-pad ↑/↓', 'xbox')).toEqual([['dpad', ''], '↑', '/', '↓']);
    expect(parseLabel('L↑', 'xbox')).toEqual([['stick', 'L'], '↑']);
    expect(parseLabel('✕', 'playstation')).toEqual([['face', '✕', 'ps-blue']]);
    expect(parseLabel('ZR', 'nintendo')).toEqual([['trigger', 'ZR', undefined]]);
    expect(parseLabel('Enter', 'xbox')).toBeNull();
    expect(parseLabel('Shift+Enter', 'xbox')).toBeNull();
    expect(parseLabel('Hold', 'xbox')).toBeNull();
  });
});

describe('touch: tapped key prompts', () => {
  it('turns prompt labels back into keys', () => {
    expect(keyIdFromLabel('Esc')).toBe('Escape');
    expect(keyIdFromLabel('Esc / B')).toBe('Escape');
    expect(keyIdFromLabel('Shift+Enter')).toBe('Shift+Enter');
    expect(keyIdFromLabel('Space/-')).toBe('Space');
    expect(keyIdFromLabel('+')).toBe('+');
    expect(keyIdFromLabel('/')).toBe('/');
    expect(keyIdFromLabel('↑')).toBe('ArrowUp');
    expect(keyIdFromLabel('Shift+↑')).toBe('Shift+ArrowUp');
    expect(keyIdFromLabel('Num 5')).toBe('Numpad5');
  });

  it('round-trips every default key label', () => {
    for (const id of Object.keys(defaultBindings().keys)) {
      if (id.startsWith('NumpadEnter')) continue;
      expect(keyIdFromLabel(keyLabel(id))).toBe(id);
    }
  });

  it('refuses labels that name several keys or none', () => {
    expect(keyIdFromLabel('↑↓←→')).toBeNull();
    expect(keyIdFromLabel('Arrows')).toBeNull();
  });

  it('shows keyboard labels on touch', () => {
    expect(promptsFor('touch', 'xbox').back).toBe('Esc');
  });
});
