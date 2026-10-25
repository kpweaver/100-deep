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
  }

  get loaded(): boolean {
    return this.image !== null;
  }

  /** UV rectangle of a tile: [offsetX, offsetY, repeatX, repeatY] (flipY convention) */
  uvRect(tile: Tile): [number, number, number, number] {
    const [row, col] = tile;
    const rx = 1 / this.cols;
    const ry = 1 / this.rows;
    return [col * rx, 1 - (row + 1) * ry, rx, ry];
  }

  /**
   * A texture holding exactly one tile.  Each tile gets its own 32x32
   * texture (rather than a window into the atlas) so mipmaps can be used
   * for clean minification without neighbouring tiles bleeding in.
   */
  texture(tile: Tile): THREE.Texture | null {
    const key = `${tile[0]},${tile[1]}`;
    let tex = this.cache.get(key);
    if (!tex) {
      const canvas = this.canvas(tile);
      if (!canvas) return null;
      tex = tileTexture(canvas);
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

/**
 * Build a mipmapped texture from one tile.  Fully transparent pixels in the
 * sheet carry black colour, which mipmapping would smear into a dark fringe
 * around distant sprites, so opaque colours are first dilated into the
 * transparent area (alpha is left untouched).
 */
function tileTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const rgba = new Uint8ClampedArray(src);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < 8; pass++) {
    const next = known.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!known[j]) continue;
          r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
        }
        if (n) {
          rgba[i * 4] = r / n; rgba[i * 4 + 1] = g / n; rgba[i * 4 + 2] = b / n;
          next[i] = 1;
        }
      }
    }
    known.set(next);
  }
  // DataTexture rows run bottom-up
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  configurePixelTexture(tex);
  tex.needsUpdate = true;
  return tex;
}

/** Filled in by the renderer once the WebGL context exists */
export const textureQuality = { anisotropy: 1 };

/**
 * Pixel-art texture setup: magnified texels stay crisp squares (nearest),
 * minified ones use mipmaps + anisotropic filtering so distant or
 * grazing-angle surfaces stay stable instead of shimmering.
 */
export function configurePixelTexture(tex: THREE.Texture): void {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = textureQuality.anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
}
