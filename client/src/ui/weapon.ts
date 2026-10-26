/**
 * First-person weapon: the wielded weapon's own Gervais tile, flipped so
 * the hilt sits in the right hand and the blade leans in, drawn as crisp pixels in the
 * lower right of the view.  It swings when the engine reports a melee
 * attack (Angband's "hit"/"miss" message types), shows the launcher
 * recoiling when you fire, bobs as you walk, and dims with the light you
 * carry.  Purely presentational: nothing here affects the game.
 */
import type { EquipSlot, Tile } from '@thang/protocol';
import type { TileAtlas } from '../sprites/atlas.ts';
import { h } from './dom.ts';

/** How long a shot keeps the launcher in hand before the weapon returns (ms) */
const SHOT_MS = 800;

export class WeaponView {
  readonly el = h('div', { class: 'fp-weapon' });
  private sprite = h('div', { class: 'fp-weapon-sprite' });
  private weapon: Tile | null = null;
  private launcher: Tile | null = null;
  private shooting = 0;
  private shown: Tile | null = null;
  private size = 0;
  private filter = 'brightness(1)';

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

  /** A step */
  bob(): void {
    if (!this.el.classList.contains('swing') && !this.el.classList.contains('recoil')) this.play('bob');
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
  }
}
