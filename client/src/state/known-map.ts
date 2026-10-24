/**
 * The player's knowledge of the current level, exactly as sent by the
 * engine.  The engine only ever sends known grids, so this structure cannot
 * contain hidden terrain.
 */
import type { MapUpdate, Tile } from '@thang/protocol';

export class KnownMap {
  width = 0;
  height = 0;
  feat = new Int16Array(0);
  light = new Uint8Array(0);
  inView = new Uint8Array(0);
  traps = new Map<number, Tile>();
  /** Incremented on every change, so consumers can cheaply detect updates */
  version = 0;
  /** Incremented when the map was replaced (new level / resync) */
  generation = 0;

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  featAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.feat[this.index(x, y)] : 0;
  }

  isKnown(x: number, y: number): boolean {
    return this.featAt(x, y) !== 0;
  }

  isInView(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.inView[this.index(x, y)] === 1;
  }

  /** Apply an engine map update; returns true if anything changed */
  apply(update: MapUpdate): boolean {
    if (update.full || update.width !== this.width || update.height !== this.height) {
      this.width = update.width;
      this.height = update.height;
      const n = update.width * update.height;
      this.feat = new Int16Array(n);
      this.light = new Uint8Array(n);
      this.inView = new Uint8Array(n);
      this.traps.clear();
      this.generation++;
    }
    for (const [x, y, f, light, view, trap] of update.cells) {
      if (!this.inBounds(x, y)) continue;
      const i = this.index(x, y);
      this.feat[i] = f;
      this.light[i] = light;
      this.inView[i] = view;
      if (trap) this.traps.set(i, trap);
      else this.traps.delete(i);
    }
    if (update.full || update.cells.length) {
      this.version++;
      return true;
    }
    return false;
  }
}
