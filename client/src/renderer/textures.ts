/**
 * Procedurally generated low-resolution dungeon surface textures.
 * Deliberately simple and muted so the Gervais sprites stay the focus.
 */
import * as THREE from 'three';
import { configurePixelTexture } from '../sprites/atlas.ts';

const SIZE = 32;

/** Small deterministic PRNG so textures look the same every session */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type RGB = [number, number, number];

function make(draw: (ctx: CanvasRenderingContext2D, r: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  draw(ctx, rng(seed));
  const tex = new THREE.CanvasTexture(c);
  configurePixelTexture(tex);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: RGB, jitter: number, r: () => number) {
  const j = (r() - 0.5) * jitter;
  ctx.fillStyle = `rgb(${clamp(c[0] + j)},${clamp(c[1] + j)},${clamp(c[2] + j)})`;
  ctx.fillRect(x, y, 1, 1);
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Stone blocks with mortar lines */
function blocks(base: RGB, mortar: RGB, rows: number, jitter: number, speck?: RGB) {
  return (ctx: CanvasRenderingContext2D, r: () => number) => {
    const bh = SIZE / rows;
    for (let y = 0; y < SIZE; y++) {
      const row = Math.floor(y / bh);
      const offset = (row % 2) * (SIZE / 4);
      for (let x = 0; x < SIZE; x++) {
        const bx = (x + offset) % (SIZE / 2);
        const isMortar = y % bh === 0 || bx === 0;
        if (isMortar) px(ctx, x, y, mortar, 8, r);
        else if (speck && r() < 0.06) px(ctx, x, y, speck, 20, r);
        else {
          // Per-block tint so blocks read individually
          const tint = ((row * 7 + Math.floor((x + offset) / (SIZE / 2)) * 13) % 5) * 4 - 8;
          px(ctx, x, y, [base[0] + tint, base[1] + tint, base[2] + tint], jitter, r);
        }
      }
    }
  };
}

function noise(base: RGB, jitter: number, speck?: RGB, speckRate = 0.04) {
  return (ctx: CanvasRenderingContext2D, r: () => number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        if (speck && r() < speckRate) px(ctx, x, y, speck, 30, r);
        else px(ctx, x, y, base, jitter, r);
      }
  };
}

function flagstones(base: RGB, line: RGB) {
  return (ctx: CanvasRenderingContext2D, r: () => number) => {
    noise(base, 18)(ctx, r);
    ctx.fillStyle = `rgb(${line.join(',')})`;
    // Irregular stone joints
    ctx.fillRect(0, 0, SIZE, 1);
    ctx.fillRect(0, 0, 1, SIZE);
    ctx.fillRect(0, 15, 17, 1);
    ctx.fillRect(17, 0, 1, 22);
    ctx.fillRect(17, 21, 15, 1);
    ctx.fillRect(9, 15, 1, 17);
  };
}

function planks(base: RGB, dark: RGB) {
  return (ctx: CanvasRenderingContext2D, r: () => number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const edge = x % 8 === 0;
        const grain = Math.sin((y + (x >> 3) * 11) * 0.7) * 6;
        if (edge) px(ctx, x, y, dark, 6, r);
        else px(ctx, x, y, [base[0] + grain, base[1] + grain, base[2] + grain], 10, r);
      }
    // Iron bands and ring
    ctx.fillStyle = 'rgb(40,38,36)';
    ctx.fillRect(0, 6, SIZE, 2);
    ctx.fillRect(0, 24, SIZE, 2);
    ctx.fillStyle = 'rgb(90,86,70)';
    ctx.fillRect(24, 15, 3, 3);
  };
}

function lava() {
  return (ctx: CanvasRenderingContext2D, r: () => number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const v = Math.sin(x * 0.4 + Math.sin(y * 0.3) * 2) + Math.cos(y * 0.35 + x * 0.1);
        const hot = v > 0.6;
        px(ctx, x, y, hot ? [250, 170, 40] : [170, 40, 10], 30, r);
      }
  };
}

export interface SurfaceTextures {
  granite: THREE.Texture;
  permanent: THREE.Texture;
  magma: THREE.Texture;
  quartz: THREE.Texture;
  floor: THREE.Texture;
  townFloor: THREE.Texture;
  ceiling: THREE.Texture;
  door: THREE.Texture;
  lava: THREE.Texture;
  rubble: THREE.Texture;
}

export function createSurfaceTextures(): SurfaceTextures {
  return {
    granite: make(blocks([92, 88, 84], [48, 46, 44], 4, 14), 1),
    permanent: make(blocks([70, 72, 82], [30, 30, 36], 2, 8), 2),
    magma: make(noise([88, 64, 52], 26, [140, 70, 40]), 3),
    quartz: make(noise([150, 146, 140], 20, [220, 220, 210], 0.06), 4),
    floor: make(flagstones([66, 62, 58], [34, 32, 30]), 5),
    townFloor: make(noise([78, 86, 58], 24, [96, 100, 70], 0.1), 6),
    ceiling: make(noise([44, 42, 40], 12), 7),
    door: make(planks([104, 72, 40], [52, 34, 20]), 8),
    lava: make(lava(), 9),
    rubble: make(noise([96, 90, 82], 40, [60, 56, 50], 0.2), 10),
  };
}
