/**
 * First-person weapon: the wielded weapon's own Gervais tile, flipped so
 * the hilt sits in the right hand and the blade leans in, drawn as crisp pixels in the
 * lower right of the view.  It swings when the engine reports a melee
 * attack (Angband's "hit"/"miss" message types) and when you dig (Angband
 * digs with the wielded weapon), shows the launcher recoiling when you
 * fire, bobs as you walk, and dims with the light you carry.  Each tile is
 * measured so its hilt end runs off the bottom-right corner, whatever the
 * item's size and position within its tile.  Purely presentational.
 */
import type { EquipSlot, Tile } from '@thang/protocol';
import type { TileAtlas } from '../sprites/atlas.ts';
import { h } from './dom.ts';

/** How long a shot keeps the launcher in hand before the weapon returns (ms) */
const SHOT_MS = 800;
/** Swings per dig command, and the time between them (ms) */
const DIG_SWINGS = 3;
const DIG_EVERY_MS = 320;
/** How much of the item runs off the bottom of the screen */
const OVERHANG = 0.18;

/** Opaque extent of a tile, in tile pixels (inclusive) */
interface Extent { left: number; top: number; right: number; bottom: number }

export class WeaponView {
  readonly el = h('div', { class: 'fp-weapon' });
  private sprite = h('div', { class: 'fp-weapon-sprite' });
  private weapon: Tile | null = null;
  private launcher: Tile | null = null;
  private shooting = 0;
  private shown: Tile | null = null;
  private size = 0;
  private filter = 'brightness(1)';
  private extents = new Map<string, Extent>();
  private digTimers: number[] = [];

  constructor(private atlas: () => TileAtlas | null) {
    this.el.append(this.sprite);
    window.addEventListener('resize', () => this.render(true));
  }

  /** Read the weapon and launcher from the equipment */
  setEquipment(equipment: EquipSlot[]): void {
    this.weapon = equipment.find((e) => e.slot === 'weapon')?.item?.tile ?? null;
    this.launcher = equipment.find((e) => e.slot === 'shooting')?.item?.tile ?? null;
    this.render();
  }

  /** Brightness follows the player's own light (dim without one) */
  setLight(radius: number, unlight: boolean): void {
    const b = radius > 0 ? Math.min(1, 0.75 + radius * 0.1) : unlight ? 0.55 : 0.32;
    this.filter = `brightness(${b.toFixed(2)})`;
    this.sprite.style.filter = this.filter;
  }

  /** A melee swing */
  swing(): void {
    if (this.shooting) return;
    this.play('swing');
  }

  /** Firing: raise the launcher (if any) and recoil */
  shoot(): void {
    if (!this.launcher) return;
    clearTimeout(this.shooting);
    this.shooting = window.setTimeout(() => {
      this.shooting = 0;
      this.render();
    }, SHOT_MS);
    this.render();
    this.play('recoil');
  }

  /** Digging: a few swings, as the engine repeats the tunnel command */
  dig(): void {
    for (const t of this.digTimers) clearTimeout(t);
    this.digTimers = [];
    for (let i = 0; i < DIG_SWINGS; i++) {
      this.digTimers.push(window.setTimeout(() => this.swing(), i * DIG_EVERY_MS));
    }
  }

  /** A step */
  bob(): void {
    if (!this.el.classList.contains('swing') && !this.el.classList.contains('recoil')) this.play('bob');
  }

  /**
   * Position the element so the item's hilt end (its top in the tile, its
   * bottom once flipped) hangs off the bottom of the view and its right
   * edge sits near the right edge.
   */
  private seat(atlas: TileAtlas, tile: Tile, size: number) {
    const e = this.extent(atlas, tile);
    const cell = atlas.cellW;
    const px = size / cell;
    const itemH = e.bottom - e.top + 1;
    // Flipped vertically: the empty rows above the item end up below it
    const below = e.top * px;
    const right = (cell - 1 - e.right) * px;
    this.el.style.bottom = `${-(below + itemH * OVERHANG * px)}px`;
    this.el.style.right = `${Math.round(window.innerWidth * 0.03 - right)}px`;
    // Swing about the hand: the item's flipped bottom-right corner
    this.el.style.transformOrigin = `${((e.right + 1) / cell) * 100}% ${((cell - e.top) / cell) * 100}%`;
  }

  private extent(atlas: TileAtlas, tile: Tile): Extent {
    const key = `${tile[0]},${tile[1]}`;
    let e = this.extents.get(key);
    if (e) return e;
    e = { left: 0, top: 0, right: atlas.cellW - 1, bottom: atlas.cellH - 1 };
    const canvas = atlas.canvas(tile);
    if (canvas) {
      const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let l = width, t = height, r = -1, b = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] < 16) continue;
          if (x < l) l = x;
          if (x > r) r = x;
          if (y < t) t = y;
          if (y > b) b = y;
        }
      }
      if (r >= 0) e = { left: l, top: t, right: r, bottom: b };
    }
    this.extents.set(key, e);
    return e;
  }

  private play(anim: 'swing' | 'recoil' | 'bob') {
    this.el.classList.remove('swing', 'recoil', 'bob');
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add(anim);
  }

  private render(resized = false) {
    const atlas = this.atlas();
    const tile = this.shooting ? this.launcher : this.weapon;
    if (!atlas?.loaded) {
      // Draw once the tile sheet has loaded (setEquipment is called again)
      this.shown = null;
      return;
    }
    // Whole multiples of the 32px tile, about 60% of the view's height
    // (the item itself fills only part of its tile)
    const size = 32 * Math.max(4, Math.min(20, Math.round((window.innerHeight * 0.6) / 32)));
    if (!resized && tile === this.shown && size === this.size) return;
    this.shown = tile;
    this.size = size;
    this.sprite.setAttribute('style', tile ? `${atlas.css(tile, size)};filter:${this.filter}` : 'display:none');
    this.el.classList.toggle('empty', !tile);
    if (tile) this.seat(atlas, tile, size);
  }
}
