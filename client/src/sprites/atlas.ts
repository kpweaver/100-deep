/**
 * Tile atlas loader for Angband tilesets (David Gervais' 32x32 by default).
 *
 * Tile coordinates are never hardcoded on the client: the engine resolves
 * every terrain/monster/object to an atlas [row, col] using Angband's own
 * graphics pref files (graf-dvg.prf etc.) and sends those coordinates.
 */
import * as THREE from 'three';
import type { HelloMessage, Tile } from '@thang/protocol';

export class TileAtlas {
  readonly url: string;
  readonly cellW: number;
  readonly cellH: number;
  image: HTMLImageElement | null = null;
  cols = 0;
  rows = 0;
  private base: THREE.Texture | null = null;
  private cache = new Map<string, THREE.Texture>();
  /** Per-tile canvases for 2D use (minimap, UI icons) */
  private canvases = new Map<string, HTMLCanvasElement>();

  constructor(tileset: HelloMessage['tileset']) {
    this.url = '/' + tileset.url.replace(/^\/+/, '');
    this.cellW = tileset.cellWidth;
    this.cellH = tileset.cellHeight;
  }

  async load(): Promise<void> {
    const img = new Image();
    img.decoding = 'async';
    img.src = this.url;
    await img.decode();
    this.image = img;
    this.cols = Math.floor(img.naturalWidth / this.cellW);
    this.rows = Math.floor(img.naturalHeight / this.cellH);
    const tex = new THREE.Texture(img);
    configurePixelTexture(tex);
    tex.needsUpdate = true;
    this.base = tex;
  }

  get loaded(): boolean {
    return this.base !== null;
  }

  /** UV rectangle of a tile: [offsetX, offsetY, repeatX, repeatY] (flipY convention) */
  uvRect(tile: Tile): [number, number, number, number] {
    const [row, col] = tile;
    const rx = 1 / this.cols;
    const ry = 1 / this.rows;
    return [col * rx, 1 - (row + 1) * ry, rx, ry];
  }

  /** A texture showing one tile; clones share the GPU image */
  texture(tile: Tile): THREE.Texture | null {
    if (!this.base) return null;
    const key = `${tile[0]},${tile[1]}`;
    let tex = this.cache.get(key);
    if (!tex) {
      tex = this.base.clone();
      const [ox, oy, rx, ry] = this.uvRect(tile);
      tex.offset.set(ox, oy);
      tex.repeat.set(rx, ry);
      tex.needsUpdate = true;
      this.cache.set(key, tex);
    }
    return tex;
  }

  /** A small canvas with the tile, for 2D drawing */
  canvas(tile: Tile): HTMLCanvasElement | null {
    if (!this.image) return null;
    const key = `${tile[0]},${tile[1]}`;
    let c = this.canvases.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.cellW;
      c.height = this.cellH;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.image, tile[1] * this.cellW, tile[0] * this.cellH,
        this.cellW, this.cellH, 0, 0, this.cellW, this.cellH);
      this.canvases.set(key, c);
    }
    return c;
  }

  /** Inline CSS for a tile icon of the given on-screen size */
  css(tile: Tile | null, size: number): string {
    if (!tile || !this.cols) return '';
    const scale = size / this.cellW;
    return [
      `background-image:url(${this.url})`,
      `background-position:${-tile[1] * this.cellW * scale}px ${-tile[0] * this.cellH * scale}px`,
      `background-size:${this.cols * this.cellW * scale}px ${this.rows * this.cellH * scale}px`,
      `width:${size}px`,
      `height:${size}px`,
    ].join(';');
  }
}

export function configurePixelTexture(tex: THREE.Texture): void {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
}
