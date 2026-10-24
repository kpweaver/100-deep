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
import { GridCamera } from '../src/camera/grid-camera.ts';
import { TileAtlas } from '../src/sprites/atlas.ts';

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
    expect(atlas.url).toBe('/tiles/gervais/32x32.png');
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
