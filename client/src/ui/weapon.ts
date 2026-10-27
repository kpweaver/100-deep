/**
 * First-person weapon: the wielded weapon's own Gervais tile, posed (per
 * tile: Gervais draws weapons in different orientations) so the hilt sits
 * in the right hand and the blade or head leans in toward the centre, drawn as crisp pixels in the
 * lower right of the view.  It swings when the engine reports a melee
 * attack (Angband's "hit"/"miss" message types) and when you dig (Angband
 * digs with the wielded weapon), shows the launcher recoiling when you
 * fire, bobs as you walk, and dims with the light you carry.  Each tile is
 * measured so its hilt end runs off the bottom-right corner, whatever the
 * item's size and position within its tile.  Casting raises the off hand
 * (art/hands.png, scripts/make-hand-tiles.py), gloved if you wear gloves,
 * glowing in your class's colour.  Purely presentational.
 */
import type { EquipSlot, Tile } from '@thang/protocol';
import type { TileAtlas } from '../sprites/atlas.ts';
import { h } from './dom.ts';

/** How long a shot keeps the launcher in hand before the weapon returns (ms) */
const SHOT_MS = 1050;
/** Swings per dig command, and the time between them (ms) */
const DIG_SWINGS = 3;
const DIG_EVERY_MS = 320;
/** How much of the item runs off the bottom of the screen */
const OVERHANG = 0.18;

/** Opaque extent of a tile, in tile pixels (inclusive) */
interface Extent { left: number; top: number; right: number; bottom: number }

/**
 * How each tile is turned so the hilt ends up bottom-right.  Gervais draws
 * most swords hilt top-right, most hafted weapons, polearms and diggers
 * handle bottom-left, and a few already hilt bottom-right; each has two
 * poses with the hilt in the hand, mirrored along the weapon's length.
 * The pose chosen is the more upright one with the edge, guard or head
 * facing the centre; flails hold the grip with the head dangling toward
 * the centre.
 */
type Pose = 'none' | 'flipX' | 'flipY' | 'rot180' | 'rot90' | 'rotm90' | 'transpose';
const POSE_CSS: Record<Pose, string> = {
  none: 'none',
  flipX: 'scaleX(-1)',
  flipY: 'scaleY(-1)',
  rot180: 'scale(-1, -1)',
  rot90: 'rotate(90deg)',
  rotm90: 'rotate(-90deg)',
  transpose: 'matrix(0, 1, 1, 0, 0, 0)',
};
/** Where a tile pixel (x, y) lands after posing, in an n x n tile */
const POSE_MAP: Record<Pose, (x: number, y: number, n: number) => [number, number]> = {
  none: (x, y) => [x, y],
  flipX: (x, y, n) => [n - 1 - x, y],
  flipY: (x, y, n) => [x, n - 1 - y],
  rot180: (x, y, n) => [n - 1 - x, n - 1 - y],
  rot90: (x, y, n) => [n - 1 - y, x],
  rotm90: (x, y, n) => [y, n - 1 - x],
  transpose: (x, y) => [y, x],
};
/** Weapon and launcher tiles ("row,col" in the Gervais sheet) */
const POSES: Record<string, Pose> = {
  '10,3': 'flipY', // Dagger
  '10,4': 'flipY', // Main Gauche
  '10,5': 'rot90', // Rapier
  '10,8': 'flipY', // Short Sword
  '10,10': 'rot90', // Cutlass
  '10,9': 'rot90', // Tulwar
  '10,11': 'rot90', // Scimitar
  '10,13': 'flipY', // Long Sword
  '10,12': 'flipY', // Broad Sword
  '10,66': 'none', // Bastard Sword
  '10,14': 'rot90', // Katana
  '10,16': 'flipY', // Zweihander
  '10,15': 'flipY', // Executioner's Sword
  '10,17': 'none', // Blade of Chaos
  '10,18': 'rotm90', // Whip
  '10,25': 'rot180', // Ball-and-Chain (held by the chain's end)
  '10,23': 'rotm90', // Morning Star
  '10,22': 'rotm90', // Flail
  '10,26': 'rotm90', // Two-Handed Great Flail
  '10,20': 'flipX', // Mace
  '10,24': 'flipX', // Lead-Filled Mace
  '10,21': 'flipX', // Quarterstaff
  '10,19': 'none', // War Hammer, Maul
  '10,63': 'none', // Great Hammer
  '10,27': 'flipX', // Mace of Disruption
  '10,57': 'flipX', // Throwing Hammer
  '10,28': 'flipX', // Spear
  '10,30': 'flipX', // Awl-Pike
  '10,29': 'flipX', // Trident
  '10,38': 'rotm90', // Halberd
  '10,34': 'flipX', // Pike
  '10,35': 'flipX', // Beaked Axe
  '10,36': 'flipX', // Broad Axe
  '10,33': 'rotm90', // Battle Axe
  '10,39': 'rotm90', // Lochaber Axe
  '10,40': 'flipX', // Great Axe
  '10,102': 'flipX', // Throwing Axe
  '10,41': 'none', // Scythe
  '10,37': 'flipX', // Glaive
  '10,31': 'flipX', // Lance
  '10,42': 'none', // Scythe of Slicing
  '10,32': 'flipX', // Lucerne Hammer
  '10,47': 'flipY', // Sling (curve toward the centre)
  '10,43': 'flipY', // Short Bow (curve toward the centre)
  '10,44': 'flipY', // Long Bow (curve toward the centre)
  '10,45': 'none', // Light Crossbow
  '10,46': 'none', // Heavy Crossbow
  '7,30': 'rotm90', // Shovel
  '7,27': 'flipX', // Pick
  '7,29': 'flipX', // Mattock
  '10,48': 'none', // Mighty Hammer
};
/** How each weapon attacks (default: chop) and each launcher fires */
type Attack = 'chop' | 'thrust' | 'flail' | 'whip';
type Fire = 'bow' | 'crossbow' | 'sling';
const ATTACKS: Record<string, Attack> = {
  '10,3': 'thrust', // Dagger
  '10,4': 'thrust', // Main Gauche
  '10,5': 'thrust', // Rapier
  '10,28': 'thrust', // Spear
  '10,30': 'thrust', // Awl-Pike
  '10,29': 'thrust', // Trident
  '10,34': 'thrust', // Pike
  '10,31': 'thrust', // Lance
  '10,25': 'flail', // Ball-and-Chain
  '10,23': 'flail', // Morning Star
  '10,22': 'flail', // Flail
  '10,26': 'flail', // Two-Handed Great Flail
  '10,18': 'whip', // Whip
};
const FIRES: Record<string, Fire> = {
  '10,47': 'sling',
  '10,43': 'bow', // Short Bow
  '10,44': 'bow', // Long Bow
  '10,45': 'crossbow', // Light Crossbow
  '10,46': 'crossbow', // Heavy Crossbow
};
const ANIMS = ['chop', 'thrust', 'flail', 'whip', 'bow', 'crossbow', 'sling', 'bob', 'lower'].map((a) => `anim-${a}`);

/** The hands sheet (art/hands.png): rows of materials, columns right/left */
const HANDS_URL = 'art/hands.png';
const HAND_ROWS = ['skin', 'leather', 'gauntlets', 'mithral', 'caestus', 'alchemist'];
/** The hand's size relative to the weapon's */
const HAND_SCALE = 0.6;
/** How far below the screen edge the hand's tile is anchored (fraction of its size) */
const HAND_SINK = 0.36;
/** Glove tiles ("row,col" in the Gervais sheet) to hand materials */
const GLOVES: Record<string, string> = {
  '0,25': 'leather', // Set of Leather Gloves
  '0,26': 'gauntlets', // Set of Gauntlets
  '0,28': 'mithral', // Set of Mithral Gauntlets
  '0,29': 'caestus', // Set of Caestus
  '0,77': 'alchemist', // Set of Alchemist's Gloves
};
/** The glow of a cast, by the colour of each class's magic */
const CAST_GLOW: Record<string, string> = {
  Mage: '#6aa8ff', Rogue: '#6aa8ff', Ranger: '#7fe07a', Druid: '#7fe07a',
  Priest: '#ffd75a', Paladin: '#ffd75a', Necromancer: '#b45aff', Blackguard: '#ff5a4a',
};

/** Launchers sit higher than melee weapons, fully in view */
const LAUNCHERS = new Set(['10,43', '10,44', '10,45', '10,46', '10,47']);
const LAUNCHER_OVERHANG = -0.06;
/** Tiles not listed (none expected) are assumed drawn hilt top-right */
const DEFAULT_POSE: Pose = 'flipY';

export class WeaponView {
  readonly el = h('div', { class: 'fp-weapon' });
  /** The off (left) hand, shown while casting */
  readonly hand = h('div', { class: 'fp-hand' });
  private gloves = 'skin';
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
    const g = equipment.find((e) => e.slot === 'hands')?.item?.tile;
    // Unknown gloves (e.g. mining gloves) look like leather
    this.gloves = g ? GLOVES[`${g[0]},${g[1]}`] ?? 'leather' : 'skin';
    this.render();
  }

  /** Brightness follows the player's own light (dim without one) */
  setLight(radius: number, unlight: boolean): void {
    const b = radius > 0 ? Math.min(1, 0.75 + radius * 0.1) : unlight ? 0.55 : 0.32;
    this.filter = `brightness(${b.toFixed(2)})`;
    this.sprite.style.filter = this.filter;
  }

  /** A melee attack, in the weapon's own style */
  swing(): void {
    if (this.shooting) return;
    const t = this.weapon;
    this.play(t ? ATTACKS[`${t[0]},${t[1]}`] ?? 'chop' : 'chop');
  }

  /** Casting: the off hand rises glowing, the weapon hand dips */
  cast(playerClass: string): void {
    // About 60% of the weapon's scale, in whole multiples of the 32px tile
    const size = 32 * Math.max(3, Math.round(((this.size || 32 * 8) / 32) * HAND_SCALE));
    const row = Math.max(0, HAND_ROWS.indexOf(this.gloves));
    const glow = CAST_GLOW[playerClass] ?? '#6aa8ff';
    this.hand.setAttribute('style', [
      `background-image:url(${HANDS_URL})`,
      `background-size:${size * 2}px ${size * HAND_ROWS.length}px`,
      `background-position:${-size}px ${-row * size}px`,
      `width:${size}px`, `height:${size}px`,
      // The tile ends at the wrist: anchor it low enough that the cut edge
      // stays below the screen through the whole gesture (see fp-cast)
      `left:${Math.round(window.innerWidth * 0.06)}px`, `bottom:${-Math.round(size * HAND_SINK)}px`,
      `--glow:${glow}`, `filter:${this.filter} drop-shadow(0 0 ${Math.round(size / 16)}px ${glow})`,
    ].join(';'));
    this.hand.classList.remove('anim-cast');
    void this.hand.offsetWidth;
    this.hand.classList.add('anim-cast');
    if (!this.shooting) this.play('lower');
  }

  /** A chop, whatever the weapon (digging) */
  private chop(): void {
    if (!this.shooting) this.play('chop');
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
    this.play(FIRES[`${this.launcher[0]},${this.launcher[1]}`] ?? 'bow');
  }

  /** Digging: a few swings, as the engine repeats the tunnel command */
  dig(): void {
    for (const t of this.digTimers) clearTimeout(t);
    this.digTimers = [];
    for (let i = 0; i < DIG_SWINGS; i++) {
      this.digTimers.push(window.setTimeout(() => this.chop(), i * DIG_EVERY_MS));
    }
  }

  /** A step (never interrupting an attack) */
  bob(): void {
    if (!ANIMS.some((a) => a !== 'anim-bob' && this.el.classList.contains(a))) this.play('bob');
  }

  /**
   * Position the element so the posed item's hilt end (its bottom-right)
   * hangs off the bottom of the view near the right edge, and swings pivot
   * there.
   */
  private seat(atlas: TileAtlas, tile: Tile, size: number, pose: Pose) {
    const e = this.extent(atlas, tile, pose);
    const cell = atlas.cellW;
    const px = size / cell;
    const itemH = e.bottom - e.top + 1;
    const below = (cell - 1 - e.bottom) * px;
    const right = (cell - 1 - e.right) * px;
    const overhang = LAUNCHERS.has(`${tile[0]},${tile[1]}`) ? LAUNCHER_OVERHANG : OVERHANG;
    this.el.style.bottom = `${-(below + itemH * overhang * px)}px`;
    this.el.style.right = `${Math.round(window.innerWidth * 0.03 - right)}px`;
    this.el.style.transformOrigin = `${((e.right + 1) / cell) * 100}% ${((e.bottom + 1) / cell) * 100}%`;
  }

  /** Opaque extent of a tile after posing */
  private extent(atlas: TileAtlas, tile: Tile, pose: Pose): Extent {
    const key = `${tile[0]},${tile[1]},${pose}`;
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
          const [px, py] = POSE_MAP[pose](x, y, width);
          if (px < l) l = px;
          if (px > r) r = px;
          if (py < t) t = py;
          if (py > b) b = py;
        }
      }
      if (r >= 0) e = { left: l, top: t, right: r, bottom: b };
    }
    this.extents.set(key, e);
    return e;
  }

  private play(anim: Attack | Fire | 'bob' | 'lower') {
    this.el.classList.remove(...ANIMS);
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add(`anim-${anim}`);
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
    const pose = tile ? POSES[`${tile[0]},${tile[1]}`] ?? DEFAULT_POSE : DEFAULT_POSE;
    this.sprite.setAttribute('style', tile
      ? `${atlas.css(tile, size)};filter:${this.filter};transform:${POSE_CSS[pose]}` : 'display:none');
    this.el.classList.toggle('empty', !tile);
    if (tile) this.seat(atlas, tile, size, pose);
  }
}
