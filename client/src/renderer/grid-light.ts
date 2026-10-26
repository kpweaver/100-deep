/**
 * Old-school, per-grid terrain lighting.  Every grid square is lit as one
 * block, in a few discrete steps, like the first-person dungeon crawlers of
 * the 80s and 90s:
 *  - torch: brightness falls off in steps with the square's distance from
 *    the player, sized by the player's own light radius (torch, lantern,
 *    artifact: Angband's cur_light).  Without light, a Necromancer's
 *    Unlight shows the adjacent squares in a cold, dim light;
 *  - room light: squares with Angband's room light (SQUARE_GLOW, sent with
 *    each known grid) are lit evenly; remembered ones only dimly;
 *  - darkness: distant squares fade to black in steps (instead of fog);
 *  - faces: walls facing north/south and east/west, floors and ceilings get
 *    fixed shades, so corners read without smooth shading.
 * It replaces the lighting of the terrain materials it patches; monsters,
 * objects and effects are drawn by other layers and always stay visible.
 */
import * as THREE from 'three';
import type { KnownMap } from '../state/known-map.ts';

/** Room light of a glowing square in view, and of one only remembered */
const IN_VIEW = 255;
const REMEMBERED = 100;

export type LightMode = 'dungeon' | 'night' | 'day';

export class GridLight {
  readonly uniforms = {
    roomLight: { value: null as THREE.DataTexture | null },
    roomLightSize: { value: new THREE.Vector2(1, 1) },
    /** The player's grid (the light follows the camera, snapped to squares) */
    lightCentre: { value: new THREE.Vector2(0, 0) },
    torchRadius: { value: 2 },
    torchColor: { value: new THREE.Color(1.2, 0.95, 0.65) },
    /** 0 dungeon, 1 town at night, 2 town by day */
    lightMode: { value: 0 },
  };
  private data = new Uint8Array(1);
  private tex: THREE.DataTexture | null = null;

  constructor() {
    // Something to sample before the first level arrives
    const blank = new THREE.DataTexture(this.data, 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    blank.needsUpdate = true;
    this.uniforms.roomLight.value = blank;
  }

  /**
   * Angband lights squares within cur_light - 1 of the player (intensity
   * falling by one per square); the stepped falloff here keeps those bright
   * and lets one more square fade out.  Unlight (Necromancers) sees the
   * adjacent squares without light.
   */
  setTorch(radius: number, unlight: boolean): void {
    const u = this.uniforms;
    if (radius > 0) {
      u.torchRadius.value = radius;
      u.torchColor.value.setRGB(1.2, 0.95, 0.65);
    } else if (unlight) {
      u.torchRadius.value = 1;
      u.torchColor.value.setRGB(0.42, 0.42, 0.62);
    } else {
      u.torchRadius.value = 0;
    }
  }

  setMode(mode: LightMode): void {
    this.uniforms.lightMode.value = mode === 'day' ? 2 : mode === 'night' ? 1 : 0;
  }

  /** Centre the torch on a map position (rounded to its square) */
  setCentre(x: number, y: number): void {
    this.uniforms.lightCentre.value.set(Math.round(x), Math.round(y));
  }

  /** Rebuild the room light from the known map (one byte per grid) */
  update(map: KnownMap): void {
    const w = Math.max(1, map.width), h = Math.max(1, map.height);
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.data = new Uint8Array(w * h);
      this.tex = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      // One value per square: no blending between squares
      this.tex.magFilter = THREE.NearestFilter;
      this.tex.minFilter = THREE.NearestFilter;
      this.tex.generateMipmaps = false;
      // One byte per grid: rows are not 4-byte aligned (levels are 198 wide)
      this.tex.unpackAlignment = 1;
      this.uniforms.roomLight.value = this.tex;
      this.uniforms.roomLightSize.value.set(w, h);
    }
    const n = map.width * map.height;
    for (let i = 0; i < n; i++) {
      this.data[i] = map.feat[i] && map.glow[i] ? (map.inView[i] ? IN_VIEW : REMEMBERED) : 0;
    }
    this.tex.needsUpdate = true;
  }

  /** Replace a Lambert material's lighting with the per-grid model */
  patch(material: THREE.MeshLambertMaterial): void {
    material.fog = false;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGrid;\nvarying vec3 vFaceNormal;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 gridWorld = vec4(transformed, 1.0);
          vec3 faceNormal = objectNormal;
          #ifdef USE_INSTANCING
            gridWorld = instanceMatrix * gridWorld;
            faceNormal = mat3(instanceMatrix) * faceNormal;
          #endif
          vGrid = (modelMatrix * gridWorld).xz;
          vFaceNormal = normalize(mat3(modelMatrix) * faceNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vGrid;
          varying vec3 vFaceNormal;
          uniform sampler2D roomLight;
          uniform vec2 roomLightSize;
          uniform vec2 lightCentre;
          uniform float torchRadius;
          uniform vec3 torchColor;
          uniform int lightMode;`)
        .replace('#include <opaque_fragment>', `
          // The square this fragment belongs to (nudged off wall faces, so a
          // wall face is lit like the square in front of it)
          vec2 cell = floor(vGrid + 0.5 + vFaceNormal.xz * 0.02);
          float dist = length(cell - lightCentre);
          float room = texture2D(roomLight, (cell + 0.5) / roomLightSize).r;

          // Torch: four steps, reaching one square past what the engine lights
          float torch = 0.0;
          if (torchRadius > 0.0) {
            torch = clamp(1.0 - dist / (torchRadius + 1.0), 0.0, 1.0);
            torch = ceil(torch * 4.0) / 4.0;
          }

          vec3 light;
          float fade;
          if (lightMode == 2) {
            light = vec3(1.0);
            fade = 1.0;
          } else {
            float ambient = lightMode == 1 ? 0.3 : 0.06;
            light = vec3(ambient) + torch * torchColor + room * vec3(0.6, 0.48, 0.34);
            // Darkness in steps of whole squares
            fade = exp(-pow(dist * (lightMode == 1 ? 0.045 : 0.075), 2.0));
            fade = ceil(fade * 6.0) / 6.0;
          }

          // Fixed face shades: N/S walls, E/W walls, floor, ceiling
          float face = abs(vFaceNormal.y) > 0.5 ? (vFaceNormal.y > 0.0 ? 1.0 : 0.72)
            : (abs(vFaceNormal.x) > 0.5 ? 0.82 : 0.95);

          outgoingLight = diffuseColor.rgb * light * face * fade + totalEmissiveRadiance;
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'grid-light';
  }
}
