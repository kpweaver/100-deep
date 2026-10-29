/**
 * Three.js scene with old-school lighting:
 *  - Terrain is lit per grid square in discrete steps (grid-light.ts): a
 *    torch around the player sized by the engine's light radius, Angband's
 *    room light, and darkness that swallows distant squares.
 *  - Monsters, objects, traps and effects ignore lights and fog entirely,
 *    so anything Angband says the player can see is always drawn clearly,
 *    however far away or dark the surroundings look.
 * The renderer only reads the client state mirror and could be replaced
 * without touching the simulation.
 */
import * as THREE from 'three';
import { GridCamera } from '../camera/grid-camera.ts';
import { DungeonMesh, WALL_HEIGHT, type DungeonBuildContext } from './dungeon-mesh.ts';
import { EntityLayer } from './entities.ts';
import { EffectsLayer } from './effects.ts';
import { textureQuality, type TileAtlas } from '../sprites/atlas.ts';

export interface RenderSettings {
  /** Screen pixels per rendered pixel: 1 = full resolution (default), 2-6 = optional retro look */
  pixelScale: number;
  fov: number;
}

/**
 * The town sky: a stepped twilight gradient, dark violet overhead to a
 * blood-red horizon (by day) or a faint ember glow (by night).  The camera
 * never pitches, so a screen-space gradient with the horizon at mid-height
 * is enough.
 */
const SKY: Record<'day' | 'night', [number, number, number][]> = {
  day: [[22, 14, 36], [52, 24, 62], [104, 36, 70], [166, 58, 66]],
  night: [[5, 4, 10], [12, 8, 22], [26, 12, 34], [52, 18, 38]],
};
const skyCache = new Map<string, THREE.Texture>();

function skyTexture(kind: 'day' | 'night'): THREE.Texture {
  let t = skyCache.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 64;
  const g = c.getContext('2d')!;
  const stops = SKY[kind];
  const BANDS = 14;
  for (let y = 0; y < 64; y++) {
    // Top of the screen to the horizon (mid-height), in whole bands
    const f = Math.min(1, Math.floor((y / 32) * BANDS) / (BANDS - 1));
    const i = Math.min(stops.length - 2, Math.floor(f * (stops.length - 1)));
    const k = f * (stops.length - 1) - i;
    const [a, b] = [stops[i], stops[i + 1]];
    g.fillStyle = `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(',')})`;
    g.fillRect(0, y, 1, 1);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  skyCache.set(kind, t);
  return t;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: GridCamera;
  readonly dungeon: DungeonMesh;
  readonly entities: EntityLayer;
  readonly effects: EffectsLayer;
  private clock = new THREE.Clock();
  private time = 0;
  private outdoors = false;
  settings: RenderSettings = { pixelScale: 1, fov: 70 };
  onFrame: ((dt: number) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, atlas: TileAtlas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Must be known before any texture is created
    textureQuality.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.dungeon = new DungeonMesh();
    this.cam = new GridCamera(this.settings.fov);
    this.entities = new EntityLayer(atlas);
    this.effects = new EffectsLayer(atlas);
    this.scene.add(this.dungeon.group, this.entities.group, this.effects.group, this.cam.camera);
    this.setOutdoors(false);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * What is under a point of the view (client pixels): the monster sprite
   * there, and the grid the ray first meets: the floor it lands on, or the
   * open grid in front of the wall it hits (a closed door itself).
   */
  pick(clientX: number, clientY: number, blocks: (x: number, y: number) => 'open' | 'door' | 'wall'): { x: number; y: number; monster: number | null } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cam.camera);
    const monster = this.entities.monsterUnder(ray);
    const o = ray.ray.origin, d = ray.ray.direction;
    let last: { x: number; y: number } | null = null;
    for (let t = 0.05; t < 30; t += 0.05) {
      const x = Math.round(o.x + d.x * t), y = Math.round(o.z + d.z * t), h = o.y + d.y * t;
      const b = blocks(x, y);
      if (b === 'door') return { x, y, monster };
      if (b === 'wall') return last && { ...last, monster };
      last = { x, y };
      if (h <= 0 || h >= WALL_HEIGHT) break;
    }
    return last && { ...last, monster };
  }

  setPixelScale(scale: number): void {
    this.settings.pixelScale = Math.max(1, Math.min(6, scale));
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const s = this.settings.pixelScale;
    if (s <= 1) {
      // Full resolution: the only visible pixels are the tiles' own pixel art
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
    } else {
      // Optional retro mode: render small and upscale with nearest filtering
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.max(160, Math.floor(w / s)), Math.max(90, Math.floor(h / s)), false);
    }
    this.canvas.classList.toggle('retro', s > 1);
    this.cam.setAspect(w / h);
  }

  setOutdoors(outdoors: boolean, daytime = false): void {
    this.outdoors = outdoors;
    this.daytime = outdoors && daytime;
    this.dungeon.light.setMode(!outdoors ? 'dungeon' : daytime ? 'day' : 'night');
    this.scene.background = !outdoors ? new THREE.Color(0x000000) : skyTexture(daytime ? 'day' : 'night');
  }

  /** Animation speed (1 = normal); slowed for debugging and screenshot capture */
  timeScale = 1;

  /** Daylight in the town (Angband's day/night cycle) */
  daytime = false;

  /** The player's own light radius (and Unlight) from the engine */
  setTorch(radius: number, unlight: boolean): void {
    this.dungeon.light.setTorch(radius, unlight);
  }

  rebuildDungeon(ctx: DungeonBuildContext): void {
    this.dungeon.rebuild(ctx);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta()) * this.timeScale;
      this.time += dt;
      this.onFrame?.(dt);
      this.cam.tick(dt);
      this.entities.tick(dt, this.time);
      this.effects.tick(dt);
      // The torch is centred on the player's square as the camera moves
      this.dungeon.light.setCentre(this.cam.camera.position.x, this.cam.camera.position.z);
      this.renderer.render(this.scene, this.cam.camera);
    };
    loop();
  }

  get isOutdoors(): boolean {
    return this.outdoors;
  }
}
