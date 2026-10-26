/**
 * Camera-facing billboards for monsters, objects and traps, using the
 * Gervais tiles chosen by the engine.  Only entities the engine reports are
 * drawn, so fog of war is preserved by construction.
 */
import * as THREE from 'three';
import type { MonsterInfo, ObjectPile, Tile } from '@thang/protocol';
import type { TileAtlas } from '../sprites/atlas.ts';

interface MonsterSprite {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  tileKey: string;
  flash: number;
}

const MONSTER_SIZE = 0.8;
const OBJECT_SIZE = 0.5;
const MOVE_TIME = 0.16;

const tileKey = (t: Tile | null) => (t ? `${t[0]},${t[1]}` : 'none');

export class EntityLayer {
  readonly group = new THREE.Group();
  private monsters = new Map<number, MonsterSprite>();
  private objects = new Map<string, THREE.Sprite>();
  private traps = new Map<number, THREE.Sprite>();
  private targetRing: THREE.Mesh;
  /** Look/aim cursor: a box outline drawn through walls */
  private cursor: THREE.LineSegments;
  private fallback: THREE.Texture;
  instant = false;

  constructor(private atlas: TileAtlas) {
    const ringGeo = new THREE.RingGeometry(0.34, 0.42, 24).rotateX(-Math.PI / 2);
    this.targetRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xff3020, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
    }));
    this.targetRing.visible = false;
    this.group.add(this.targetRing);
    this.cursor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.96, 0.96)),
      new THREE.LineBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    this.group.add(this.cursor);

    // Visible question mark if a tile is missing (should not happen)
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f0f';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('?', 4, 13);
    this.fallback = new THREE.CanvasTexture(c);
  }

  private material(tile: Tile | null, opacity = 1): THREE.SpriteMaterial {
    const map = (tile && this.atlas.texture(tile)) || this.fallback;
    return new THREE.SpriteMaterial({
      map,
      // Alpha-to-coverage (with MSAA) keeps outlines smooth as sprites shrink
      alphaToCoverage: true,
      // Visible means visible: atmosphere never hides what Angband shows
      fog: false,
      alphaTest: 0.05,
      transparent: opacity < 1,
      opacity,
    });
  }

  setCursor(at: { x: number; y: number } | null): void {
    this.cursor.visible = !!at;
    if (at) this.cursor.position.set(at.x, 0.48, at.y);
  }

  updateMonsters(list: MonsterInfo[], target: { x: number; y: number; monster?: number } | null): void {
    const targetId = target?.monster ?? null;
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m.id);
      const key = tileKey(m.tile);
      let ms = this.monsters.get(m.id);
      const pos = new THREE.Vector3(m.x, MONSTER_SIZE / 2, m.y);
      // Monsters sensed but not in line of sight (telepathy, detection) are ghostly
      const opacity = m.inView ? 1 : 0.45;
      if (!ms) {
        const sprite = new THREE.Sprite(this.material(m.tile, opacity));
        sprite.scale.set(MONSTER_SIZE, MONSTER_SIZE, MONSTER_SIZE);
        sprite.position.copy(pos);
        this.group.add(sprite);
        ms = { sprite, from: pos.clone(), to: pos.clone(), t: 1, tileKey: key, flash: 0 };
        this.monsters.set(m.id, ms);
      } else {
        if (ms.tileKey !== key) {
          ms.sprite.material.dispose();
          ms.sprite.material = this.material(m.tile, opacity);
          ms.tileKey = key;
        }
        const mat = ms.sprite.material;
        mat.opacity = opacity;
        mat.transparent = opacity < 1;
        if (!ms.to.equals(pos)) {
          ms.from.copy(ms.sprite.position);
          ms.to.copy(pos);
          ms.t = this.instant ? 1 : 0;
        }
      }
    }
    for (const [id, ms] of this.monsters) {
      if (!seen.has(id)) {
        this.group.remove(ms.sprite);
        ms.sprite.material.dispose();
        this.monsters.delete(id);
      }
    }
    const t = targetId !== null ? this.monsters.get(targetId) : undefined;
    // A monster target follows the monster; a location target marks its grid
    this.targetRing.visible = !!t || (!!target && targetId === null);
    if (t) this.targetRing.position.set(t.to.x, 0.02, t.to.z);
    else if (target) this.targetRing.position.set(target.x, 0.02, target.y);
  }

  updateObjects(list: ObjectPile[], playerX: number, playerY: number): void {
    const seen = new Set<string>();
    for (const o of list) {
      const key = `${o.x},${o.y},${tileKey(o.tile)}`;
      seen.add(key);
      let s = this.objects.get(key);
      if (!s) {
        s = new THREE.Sprite(this.material(o.tile));
        s.scale.set(OBJECT_SIZE, OBJECT_SIZE, OBJECT_SIZE);
        s.position.set(o.x, OBJECT_SIZE / 2, o.y);
        this.group.add(s);
        this.objects.set(key, s);
      }
      // Remembered-but-unseen objects are dimmed, as on the stock map
      s.material.color.setScalar(o.seen ? 1 : 0.45);
      // Items underfoot would fill the screen; shrink them out of the way
      const under = o.x === playerX && o.y === playerY;
      s.visible = !under;
    }
    for (const [key, s] of this.objects) {
      if (!seen.has(key)) {
        this.group.remove(s);
        s.material.dispose();
        this.objects.delete(key);
      }
    }
  }

  updateTraps(traps: Map<number, Tile>, width: number, inView: Uint8Array): void {
    for (const [i, s] of this.traps) {
      if (!traps.has(i)) {
        this.group.remove(s);
        s.material.dispose();
        this.traps.delete(i);
      }
    }
    for (const [i, tile] of traps) {
      let s = this.traps.get(i);
      if (!s) {
        s = new THREE.Sprite(this.material(tile));
        s.scale.set(0.55, 0.55, 0.55);
        s.position.set(i % width, 0.2, Math.floor(i / width));
        this.group.add(s);
        this.traps.set(i, s);
      }
      s.material.color.setScalar(inView[i] ? 1 : 0.45);
    }
  }

  /** Flash a monster red (it was hit) */
  flashMonster(id: number): void {
    const ms = this.monsters.get(id);
    if (ms) ms.flash = 0.25;
  }

  clear(): void {
    for (const ms of this.monsters.values()) {
      this.group.remove(ms.sprite);
      ms.sprite.material.dispose();
    }
    for (const s of [...this.objects.values(), ...this.traps.values()]) {
      this.group.remove(s);
      s.material.dispose();
    }
    this.monsters.clear();
    this.objects.clear();
    this.traps.clear();
    this.targetRing.visible = false;
    this.cursor.visible = false;
  }

  tick(dt: number, time: number): void {
    for (const ms of this.monsters.values()) {
      if (ms.t < 1) {
        ms.t = Math.min(1, ms.t + dt / MOVE_TIME);
        const k = ms.t * ms.t * (3 - 2 * ms.t);
        ms.sprite.position.lerpVectors(ms.from, ms.to, k);
        // Small hop while moving
        ms.sprite.position.y = MONSTER_SIZE / 2 + Math.sin(ms.t * Math.PI) * 0.05;
      }
      if (ms.flash > 0) {
        ms.flash = Math.max(0, ms.flash - dt);
        ms.sprite.material.color.setRGB(1, 1 - ms.flash * 3, 1 - ms.flash * 3);
      } else {
        ms.sprite.material.color.setScalar(1);
      }
    }
    if (this.targetRing.visible) {
      const s = 1 + Math.sin(time * 6) * 0.08;
      this.targetRing.scale.set(s, 1, s);
    }
  }
}
