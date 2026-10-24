/**
 * 2D map views of the player's knowledge: a compact colour minimap for the
 * HUD and a full tile map (Gervais tiles, as Angband's own map) overlay.
 */
import type { GameState } from '../state/game-state.ts';
import type { Shape } from '../state/features.ts';
import type { TileAtlas } from '../sprites/atlas.ts';

const SHAPE_COLORS: Record<Shape, [string, string]> = {
  // [in view, remembered]
  unknown: ['#000', '#000'],
  floor: ['#6b6457', '#38342f'],
  wall: ['#a39a8c', '#5c564f'],
  door_closed: ['#b27a3c', '#6a4a26'],
  door_open: ['#8d6a45', '#55402a'],
  stair_up: ['#ffffff', '#b0b0b0'],
  stair_down: ['#ffffff', '#b0b0b0'],
  rubble: ['#8a8070', '#4d473f'],
  passable_rubble: ['#7a7060', '#45403a'],
  shop: ['#e0c050', '#8a7630'],
  lava: ['#ff6a10', '#8a3a10'],
};

/** Arrow pointing in the camera's facing direction */
function drawPlayer(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, facing: number) {
  const a = (facing * Math.PI) / 4 - Math.PI / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.fillStyle = '#4cff6a';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.7, r * 0.7);
  ctx.lineTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.7, -r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  cell = 4;
  radiusX = 24;
  radiusY = 18;

  constructor(private state: GameState) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = (this.radiusX * 2 + 1) * this.cell;
    this.canvas.height = (this.radiusY * 2 + 1) * this.cell;
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(facing: number): void {
    const { ctx, cell, radiusX, radiusY } = this;
    const s = this.state;
    const p = s.player;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!p) return;
    const map = s.map;
    for (let dy = -radiusY; dy <= radiusY; dy++) {
      for (let dx = -radiusX; dx <= radiusX; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!map.inBounds(x, y)) continue;
        const i = map.index(x, y);
        const f = map.feat[i];
        if (!f) continue;
        const shape = s.featureClasses[f]?.shape ?? 'unknown';
        ctx.fillStyle = SHAPE_COLORS[shape][map.inView[i] ? 0 : 1];
        ctx.fillRect((dx + radiusX) * cell, (dy + radiusY) * cell, cell, cell);
        if (map.traps.has(i)) {
          ctx.fillStyle = '#e040e0';
          ctx.fillRect((dx + radiusX) * cell + 1, (dy + radiusY) * cell + 1, cell - 2, cell - 2);
        }
      }
    }
    for (const o of s.objects) {
      const dx = o.x - p.x, dy = o.y - p.y;
      if (Math.abs(dx) > radiusX || Math.abs(dy) > radiusY) continue;
      ctx.fillStyle = o.seen ? '#ffd84a' : '#8a7a30';
      ctx.fillRect((dx + radiusX) * cell + 1, (dy + radiusY) * cell + 1, cell - 2, cell - 2);
    }
    for (const m of s.monsters) {
      const dx = m.x - p.x, dy = m.y - p.y;
      if (Math.abs(dx) > radiusX || Math.abs(dy) > radiusY) continue;
      ctx.fillStyle = m.inView ? '#ff3b30' : '#a04040';
      ctx.fillRect((dx + radiusX) * cell, (dy + radiusY) * cell, cell, cell);
    }
    drawPlayer(ctx, (radiusX + 0.5) * cell, (radiusY + 0.5) * cell, cell * 1.4, facing);
  }
}

/** Full level map using the tileset, like Angband's 'M' command */
export class TileMap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  cell = 16;

  constructor(private state: GameState, private atlas: TileAtlas) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tile-map';
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(facing: number): void {
    const s = this.state;
    const map = s.map;
    const img = this.atlas.image;
    const { cell } = this;
    this.canvas.width = map.width * cell;
    this.canvas.height = map.height * cell;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!img) return;
    const cw = this.atlas.cellW, ch = this.atlas.cellH;
    const blit = (tile: [number, number] | null | undefined, x: number, y: number, alpha = 1) => {
      if (!tile) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, tile[1] * cw, tile[0] * ch, cw, ch, x * cell, y * cell, cell, cell);
      ctx.globalAlpha = 1;
    };
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = map.index(x, y);
        const f = map.feat[i];
        if (!f) continue;
        const feat = s.features[f];
        const light = map.light[i];
        blit(feat?.tiles[light] ?? feat?.tiles[0], x, y, map.inView[i] ? 1 : 0.55);
        const trap = map.traps.get(i);
        if (trap) blit(trap, x, y);
      }
    }
    for (const o of s.objects) blit(o.tile, o.x, o.y, o.seen ? 1 : 0.6);
    for (const m of s.monsters) blit(m.tile, m.x, m.y, m.inView ? 1 : 0.5);
    if (s.player) {
      blit(s.hello?.playerTile ?? null, s.player.x, s.player.y);
      ctx.strokeStyle = '#4cff6a';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.player.x * cell, s.player.y * cell, cell, cell);
      drawPlayer(ctx, (s.player.x + 0.5) * cell, (s.player.y - 0.6) * cell, cell * 0.5, facing);
    }
  }
}
