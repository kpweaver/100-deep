/**
 * Visual effects for projections the engine reports as seen by the player:
 * bolts/beams travel grid by grid, explosions light up their visible grids.
 * Purely cosmetic, played after the authoritative result has arrived.
 */
import * as THREE from 'three';
import type { Effect } from '@thang/protocol';
import type { TileAtlas } from '../sprites/atlas.ts';

interface Flash {
  obj: THREE.Object3D;
  start: number;
  life: number;
  material: THREE.Material & { opacity: number };
}

const STEP_TIME = 0.035;

export class EffectsLayer {
  readonly group = new THREE.Group();
  private flashes: Flash[] = [];
  private time = 0;
  private glowTex: THREE.Texture;
  palette: [number, number, number][] = [];

  constructor(private atlas: TileAtlas) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
    this.glowTex = new THREE.CanvasTexture(c);
    this.glowTex.magFilter = THREE.NearestFilter;
  }

  private color(index: number | undefined): THREE.Color {
    const rgb = index !== undefined ? this.palette[index] : undefined;
    // COLOUR_DARK projections would be invisible; show them as shadowy violet
    if (!rgb || (rgb[0] + rgb[1] + rgb[2]) < 40) return new THREE.Color(0.45, 0.3, 0.6);
    return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  }

  private glow(x: number, y: number, z: number, color: THREE.Color, size: number, delay: number, life: number) {
    const material = new THREE.SpriteMaterial({
      map: this.glowTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    const s = new THREE.Sprite(material);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    this.group.add(s);
    this.flashes.push({ obj: s, start: this.time + delay, life, material });
  }

  play(effects: Effect[]): number {
    let delay = 0;
    for (const e of effects) {
      if (e.kind === 'bolt' || e.kind === 'beam') {
        this.glow(e.x, 0.45, e.y, this.color(e.color), e.kind === 'beam' ? 0.6 : 0.45, delay, e.kind === 'beam' ? 0.4 : 0.12);
        delay += STEP_TIME;
      } else if (e.kind === 'missile') {
        if (e.tile) {
          const tex = this.atlas.texture(e.tile);
          if (tex) {
            const material = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.25, transparent: true, opacity: 0 });
            const s = new THREE.Sprite(material);
            s.position.set(e.x, 0.45, e.y);
            s.scale.setScalar(0.35);
            this.group.add(s);
            this.flashes.push({ obj: s, start: this.time + delay, life: 0.1, material });
          }
        } else {
          this.glow(e.x, 0.45, e.y, new THREE.Color(1, 1, 1), 0.2, delay, 0.1);
        }
        delay += STEP_TIME;
      } else if (e.kind === 'explosion') {
        const col = this.color(e.color);
        for (const [gx, gy, dist] of e.grids) {
          this.glow(gx, 0.4, gy, col, 1.1, delay + dist * 0.05, 0.35);
        }
        delay += 0.05 * (1 + Math.max(0, ...e.grids.map((g) => g[2])));
      }
    }
    return delay;
  }

  tick(dt: number): void {
    this.time += dt;
    this.flashes = this.flashes.filter((f) => {
      const t = (this.time - f.start) / f.life;
      if (t < 0) return true;
      if (t >= 1) {
        this.group.remove(f.obj);
        f.material.dispose();
        return false;
      }
      f.material.opacity = 1 - t;
      return true;
    });
  }
}
