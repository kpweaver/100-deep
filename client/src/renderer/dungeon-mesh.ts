/**
 * Builds low-poly 3D geometry for the *known* part of the level.
 *
 * Angband grid (x, y) maps to world (x, 0, y): one grid = one world unit,
 * grid centres at integer coordinates, +y in Angband (south) = +z in world.
 * Geometry is rebuilt from the KnownMap whenever the engine reports changes;
 * instanced meshes keep this to a handful of draw calls.
 */
import * as THREE from 'three';
import type { Tile } from '@thang/protocol';
import type { FeatureClass, WallMaterial } from '../state/features.ts';
import type { KnownMap } from '../state/known-map.ts';
import type { TileAtlas } from '../sprites/atlas.ts';
import { createSurfaceTextures, type SurfaceTextures } from './textures.ts';

export const WALL_HEIGHT = 1.0;

/** Brightness multipliers baked into instance colours */
const IN_VIEW = new THREE.Color(1, 1, 1);
const REMEMBERED = new THREE.Color(0.28, 0.29, 0.36);
const REMEMBERED_LIT = new THREE.Color(0.42, 0.42, 0.48);

interface Batch {
  mesh: THREE.InstancedMesh;
  used: number;
}

export interface DungeonBuildContext {
  map: KnownMap;
  classes: FeatureClass[];
  /** Feature table tiles, for decals such as stairs */
  featureTiles: (Tile | null)[][];
  atlas: TileAtlas | null;
  outdoors: boolean;
}

export class DungeonMesh {
  readonly group = new THREE.Group();
  private tex: SurfaceTextures;
  private wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1);
  private floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private ceilGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
  private doorGeo = new THREE.BoxGeometry(1, WALL_HEIGHT * 0.92, 0.12);
  private stepGeo = new THREE.BoxGeometry(0.9, 1, 0.22);
  private decalGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
  private rubbleGeo = new THREE.DodecahedronGeometry(0.15, 0);
  private materials = new Map<string, THREE.Material>();
  private batches = new Map<string, Batch>();
  private billboards = new THREE.Group();
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();

  constructor() {
    this.tex = createSurfaceTextures();
    this.group.add(this.billboards);
  }

  private material(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.materials.get(key);
    if (!m) {
      m = make();
      this.materials.set(key, m);
    }
    return m;
  }

  private lambert(key: string, map: THREE.Texture, opts: THREE.MeshLambertMaterialParameters = {}) {
    return this.material(key, () => new THREE.MeshLambertMaterial({ map, ...opts }));
  }

  private wallMaterial(m: WallMaterial, treasure: boolean): THREE.Material {
    const key = `wall:${m}:${treasure}`;
    return this.material(key, () => new THREE.MeshLambertMaterial({
      map: this.tex[m],
      // Treasure veins glint faintly, as their distinct Gervais tiles do
      emissive: treasure ? new THREE.Color(0.25, 0.2, 0.02) : new THREE.Color(0, 0, 0),
    }));
  }

  /** Remove everything (on level change) */
  clear(): void {
    for (const b of this.batches.values()) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    this.batches.clear();
    this.clearBillboards();
  }

  private clearBillboards() {
    for (const c of [...this.billboards.children]) {
      this.billboards.remove(c);
      if (c instanceof THREE.Sprite || c instanceof THREE.Mesh) (c.material as THREE.Material).dispose();
    }
  }

  private beginBatch(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number): Batch {
    let b = this.batches.get(key);
    if (!b || b.mesh.instanceMatrix.count < capacity || b.mesh.material !== mat) {
      if (b) {
        this.group.remove(b.mesh);
        b.mesh.dispose();
      }
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(16, capacity));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      b = { mesh, used: 0 };
      this.batches.set(key, b);
    }
    b.used = 0;
    return b;
  }

  private push(b: Batch, x: number, y: number, z: number, rotY: number, color: THREE.Color, sx = 1, sy = 1, sz = 1) {
    if (b.used >= b.mesh.instanceMatrix.count) return;
    const o = this.tmp;
    o.position.set(x, y, z);
    o.rotation.set(0, rotY, 0);
    o.scale.set(sx, sy, sz);
    o.updateMatrix();
    b.mesh.setMatrixAt(b.used, o.matrix);
    b.mesh.setColorAt(b.used, color);
    b.used++;
  }

  private finish(b: Batch) {
    b.mesh.count = b.used;
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
  }

  rebuild(ctx: DungeonBuildContext): void {
    const { map, classes } = ctx;
    const w = map.width;
    const h = map.height;
    const n = w * h;
    const cls = (x: number, y: number) => classes[map.featAt(x, y)] ?? classes[0];
    const isSolid = (x: number, y: number) => {
      const s = cls(x, y).shape;
      return s === 'wall' || s === 'unknown';
    };

    // Upper bound for each batch is the number of known cells
    let known = 0;
    for (let i = 0; i < n; i++) if (map.feat[i]) known++;

    const batches = {
      granite: this.beginBatch('granite', this.wallGeo, this.wallMaterial('granite', false), known),
      permanent: this.beginBatch('permanent', this.wallGeo, this.wallMaterial('permanent', false), known),
      magma: this.beginBatch('magma', this.wallGeo, this.wallMaterial('magma', false), known),
      quartz: this.beginBatch('quartz', this.wallGeo, this.wallMaterial('quartz', false), known),
      magmaT: this.beginBatch('magmaT', this.wallGeo, this.wallMaterial('magma', true), known),
      quartzT: this.beginBatch('quartzT', this.wallGeo, this.wallMaterial('quartz', true), known),
      floor: this.beginBatch('floor', this.floorGeo,
        ctx.outdoors ? this.lambert('floor:town', this.tex.townFloor) : this.lambert('floor:dungeon', this.tex.floor), known),
      lava: this.beginBatch('lava', this.floorGeo,
        this.lambert('lava', this.tex.lava, { emissive: new THREE.Color(0.6, 0.25, 0.05) }), known),
      ceiling: this.beginBatch('ceiling', this.ceilGeo, this.lambert('ceiling', this.tex.ceiling), ctx.outdoors ? 0 : known),
      door: this.beginBatch('door', this.doorGeo, this.lambert('door', this.tex.door), known),
      step: this.beginBatch('step', this.stepGeo, this.lambert('step', this.tex.granite), known * 3),
      rubble: this.beginBatch('rubble', this.rubbleGeo, this.lambert('rubble', this.tex.rubble), known * 3),
    };
    this.clearBillboards();

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const f = map.feat[i];
        if (!f) continue;
        const c = classes[f] ?? classes[0];
        const inView = map.inView[i] === 1;
        const lit = map.light[i] !== 3;
        const col = inView ? IN_VIEW : lit ? REMEMBERED_LIT : REMEMBERED;

        if (c.shape === 'wall') {
          // Skip walls nobody can see: all four neighbours solid
          if (isSolid(x - 1, y) && isSolid(x + 1, y) && isSolid(x, y - 1) && isSolid(x, y + 1)) continue;
          let b = batches.granite;
          if (c.material === 'permanent') b = batches.permanent;
          else if (c.material === 'magma') b = c.treasure ? batches.magmaT : batches.magma;
          else if (c.material === 'quartz') b = c.treasure ? batches.quartzT : batches.quartz;
          this.push(b, x, WALL_HEIGHT / 2, y, 0, col);
          continue;
        }

        // Everything else stands on a floor
        if (c.shape === 'lava') this.push(batches.lava, x, 0, y, 0, col);
        else this.push(batches.floor, x, 0, y, 0, col);
        if (!ctx.outdoors) this.push(batches.ceiling, x, WALL_HEIGHT, y, 0, col);

        // A door spans the passage: walls on east+west means a N-S passage
        const ewWalls = isSolid(x - 1, y) && isSolid(x + 1, y);
        if (c.shape === 'door_closed') {
          this.push(batches.door, x, WALL_HEIGHT * 0.46, y, ewWalls ? 0 : Math.PI / 2, col);
        } else if (c.shape === 'door_open') {
          // Swung open against one side of the frame
          if (ewWalls) this.push(batches.door, x - 0.44, WALL_HEIGHT * 0.46, y, Math.PI / 2, col, 0.9, 1, 1);
          else this.push(batches.door, x, WALL_HEIGHT * 0.46, y - 0.44, 0, col, 0.9, 1, 1);
        } else if (c.shape === 'stair_up') {
          // Three ascending steps facing the most open side
          const rot = this.openSideRotation(x, y, isSolid);
          for (let s = 0; s < 3; s++) {
            const height = 0.12 * (s + 1);
            const off = -0.3 + s * 0.25;
            const dx = Math.sin(rot) * off;
            const dz = Math.cos(rot) * off;
            this.push(batches.step, x - dx, height / 2, y - dz, rot, col, 1, height, 1);
          }
          this.decal(ctx, f, x, y, inView);
        } else if (c.shape === 'stair_down') {
          this.decal(ctx, f, x, y, inView);
        } else if (c.shape === 'rubble' || c.shape === 'passable_rubble') {
          const count = c.shape === 'rubble' ? 3 : 2;
          for (let s = 0; s < count; s++) {
            const a = (x * 7 + y * 13 + s * 2.1) % (Math.PI * 2);
            const big = c.shape === 'rubble' ? 1.4 : 0.9;
            this.push(batches.rubble, x + Math.cos(a) * 0.22, 0.08 + s * 0.07, y + Math.sin(a) * 0.22,
              a, col, big, big * 0.8, big);
          }
        } else if (c.shape === 'shop') {
          this.shopSign(ctx, f, x, y, inView);
        }
      }
    }

    for (const b of Object.values(batches)) this.finish(b);
  }

  /** Rotation pointing away from walls, used to orient staircases */
  private openSideRotation(x: number, y: number, isSolid: (x: number, y: number) => boolean): number {
    if (!isSolid(x, y + 1)) return 0;
    if (!isSolid(x + 1, y)) return Math.PI / 2;
    if (!isSolid(x, y - 1)) return Math.PI;
    return -Math.PI / 2;
  }

  /** Lay the feature's own Gervais tile on the floor (stairs) */
  private decal(ctx: DungeonBuildContext, f: number, x: number, y: number, inView: boolean) {
    const tile = ctx.featureTiles[f]?.[0];
    if (!tile || !ctx.atlas?.loaded) return;
    const tex = ctx.atlas.texture(tile);
    if (!tex) return;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.3,
      color: inView ? 0xffffff : 0x55576a,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(this.decalGeo, mat);
    mesh.position.set(x, 0.005, y);
    this.billboards.add(mesh);
  }

  /** Shop entrances: the shop's Gervais sign as a billboard */
  private shopSign(ctx: DungeonBuildContext, f: number, x: number, y: number, inView: boolean) {
    const tile = ctx.featureTiles[f]?.[0];
    if (!tile || !ctx.atlas?.loaded) return;
    const tex = ctx.atlas.texture(tile);
    if (!tex) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      color: inView ? 0xffffff : 0x666677,
      alphaTest: 0.3,
    }));
    sprite.position.set(x, 0.5, y);
    sprite.scale.set(0.9, 0.9, 0.9);
    this.billboards.add(sprite);
  }

  dispose(): void {
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
  }
}
