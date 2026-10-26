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
import { DungeonMesh, type DungeonBuildContext } from './dungeon-mesh.ts';
import { EntityLayer } from './entities.ts';
import { EffectsLayer } from './effects.ts';
import { textureQuality, type TileAtlas } from '../sprites/atlas.ts';

export interface RenderSettings {
  /** Screen pixels per rendered pixel: 1 = full resolution (default), 2-6 = optional retro look */
  pixelScale: number;
  fov: number;
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
    this.scene.background = new THREE.Color(!outdoors ? 0x000000 : daytime ? 0x8fb6dc : 0x1c2230);
  }

  /** Animation speed (1 = normal); slowed for debugging and screenshot capture */
  timeScale = 1;

  /** Daylight in the town (Angband's day/night cycle) */
  daytime = false;

  /** The engine's light radius sizes the torch */
  setTorchRadius(radius: number): void {
    this.dungeon.light.uniforms.torchRadius.value = radius;
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
