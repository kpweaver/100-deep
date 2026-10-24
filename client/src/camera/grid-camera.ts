/**
 * First-person grid camera.
 *
 * Facing is purely presentational (Angband has no facing), so turning never
 * talks to the engine and never costs a game turn.  Position only ever
 * changes to coordinates the engine has confirmed; interpolation is visual
 * and always converges on the authoritative grid.
 */
import * as THREE from 'three';
import { FACING_TO_DIR, type Direction } from '@thang/protocol';

export const EYE_HEIGHT = 0.5;

const MOVE_TIME = 0.14;
const TURN_TIME = 0.12;

const ease = (t: number) => t * t * (3 - 2 * t);

export class GridCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** 0 = north, increasing clockwise in 45 degree steps */
  facing = 0;
  gridX = 0;
  gridY = 0;
  instant = false;

  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private moveT = 1;
  private yawFrom = 0;
  private yawTo = 0;
  private turnT = 1;
  private bumpT = 1;
  private bumpDir = new THREE.Vector3();
  private shakeT = 1;
  private bobPhase = 0;

  constructor(fov = 70) {
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 40);
    this.camera.rotation.order = 'YXZ';
  }

  /** Yaw for a facing: north looks down -z; clockwise is negative yaw in three.js */
  static yawFor(facing: number): number {
    return -facing * (Math.PI / 4);
  }

  /** Keypad direction for a move relative to facing (0 fwd, 2 right, 4 back, 6 left) */
  relativeDir(offset: number): Direction {
    return FACING_TO_DIR[(((this.facing + offset) % 8) + 8) % 8];
  }

  get busy(): boolean {
    return this.moveT < 1 || this.turnT < 1;
  }

  /** Snap to an authoritative position (level change, resync) */
  teleport(x: number, y: number): void {
    this.gridX = x;
    this.gridY = y;
    this.to.set(x, EYE_HEIGHT, y);
    this.from.copy(this.to);
    this.camera.position.copy(this.to);
    this.moveT = 1;
  }

  /** Animate to a confirmed new position */
  moveTo(x: number, y: number): void {
    const dist = Math.max(Math.abs(x - this.gridX), Math.abs(y - this.gridY));
    this.gridX = x;
    this.gridY = y;
    // Long jumps (teleport, running several steps) snap
    if (this.instant || dist > 2) {
      this.teleport(x, y);
      return;
    }
    this.from.copy(this.camera.position);
    this.from.y = EYE_HEIGHT;
    this.to.set(x, EYE_HEIGHT, y);
    this.moveT = 0;
  }

  turn(steps: number): void {
    const current = this.camera.rotation.y;
    this.facing = (((this.facing + steps) % 8) + 8) % 8;
    this.yawFrom = current;
    this.yawTo = this.yawFrom - steps * (Math.PI / 4);
    this.turnT = this.instant ? 1 : 0;
    if (this.instant) this.camera.rotation.y = this.yawTo;
  }

  /** Face an absolute keypad direction (e.g. towards a target) */
  face(dir: Direction): void {
    const idx = FACING_TO_DIR.indexOf(dir);
    if (idx < 0 || idx === this.facing) return;
    let steps = idx - this.facing;
    if (steps > 4) steps -= 8;
    if (steps < -4) steps += 8;
    this.turn(steps);
  }

  /** Lurch towards a grid we could not enter (blocked, or attacking) */
  bump(dx: number, dy: number): void {
    this.bumpDir.set(dx, 0, dy).normalize();
    this.bumpT = 0;
  }

  /** Short shake (player took damage) */
  shake(): void {
    this.shakeT = 0;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  tick(dt: number): void {
    const cam = this.camera;
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / MOVE_TIME);
      cam.position.lerpVectors(this.from, this.to, ease(this.moveT));
      this.bobPhase += dt * 14;
    } else {
      cam.position.copy(this.to);
    }
    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / TURN_TIME);
      cam.rotation.y = this.yawFrom + (this.yawTo - this.yawFrom) * ease(this.turnT);
    } else {
      cam.rotation.y = GridCamera.yawFor(this.facing);
    }
    // Head bob while walking
    if (this.moveT < 1) cam.position.y = EYE_HEIGHT + Math.abs(Math.sin(this.bobPhase)) * 0.025;
    if (this.bumpT < 1) {
      this.bumpT = Math.min(1, this.bumpT + dt / 0.18);
      const k = Math.sin(this.bumpT * Math.PI) * 0.18;
      cam.position.addScaledVector(this.bumpDir, k);
    }
    if (this.shakeT < 1) {
      this.shakeT = Math.min(1, this.shakeT + dt / 0.25);
      const k = (1 - this.shakeT) * 0.03;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
    }
  }
}
