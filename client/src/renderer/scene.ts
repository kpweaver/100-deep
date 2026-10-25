/**
 * Three.js scene: low-resolution render target scaled up with nearest
 * filtering, restrained torch lighting and fog.  The renderer only reads the
 * client state mirror and could be replaced without touching the simulation.
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
  private torch = new THREE.PointLight(0xffc887, 2.2, 6, 1.4);
  private ambient = new THREE.AmbientLight(0xb0b0c8, 0.55);
  private clock = new THREE.Clock();
  private time = 0;
  private torchRadius = 2;
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
    this.scene.add(this.dungeon.group, this.entities.group, this.effects.group, this.ambient, this.cam.camera);
    this.cam.camera.add(this.torch);
    this.torch.position.set(0, 0.05, 0);
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

  setOutdoors(outdoors: boolean): void {
    this.outdoors = outdoors;
    if (outdoors) {
      const sky = new THREE.Color(0x1c2230);
      this.scene.background = sky;
      this.scene.fog = new THREE.Fog(sky, 4, 22);
      this.ambient.intensity = 0.9;
    } else {
      this.scene.background = new THREE.Color(0x000000);
      this.scene.fog = new THREE.Fog(0x000000, 1.5, 11);
      this.ambient.intensity = 0.5;
    }
  }

  /** Player light radius from the engine drives the torch */
  setTorchRadius(radius: number): void {
    this.torchRadius = radius;
    this.torch.distance = radius > 0 ? radius + 3 : 0.01;
    this.torch.intensity = radius > 0 ? 1.6 + radius * 0.4 : 0;
  }

  rebuildDungeon(ctx: DungeonBuildContext): void {
    this.dungeon.rebuild(ctx);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta());
      this.time += dt;
      this.onFrame?.(dt);
      this.cam.tick(dt);
      this.entities.tick(dt, this.time);
      this.effects.tick(dt);
      // Gentle torch flicker
      if (this.torchRadius > 0) {
        const flicker = Math.sin(this.time * 9.1) * 0.06 + Math.sin(this.time * 23.7) * 0.04;
        this.torch.intensity = 1.6 + this.torchRadius * 0.4 + flicker;
      }
      this.renderer.render(this.scene, this.cam.camera);
    };
    loop();
  }

  get isOutdoors(): boolean {
    return this.outdoors;
  }
}
