/**
 * Classify Angband terrain features (from the engine's feature table) into
 * the handful of shapes the renderer knows how to build.
 */
import type { FeatureInfo } from '@thang/protocol';

export type Shape =
  | 'unknown'
  | 'floor'
  | 'wall'
  | 'door_closed'
  | 'door_open'
  | 'stair_up'
  | 'stair_down'
  | 'rubble'
  | 'shop'
  | 'lava'
  | 'passable_rubble';

export type WallMaterial = 'granite' | 'permanent' | 'magma' | 'quartz';

export interface FeatureClass {
  shape: Shape;
  material: WallMaterial;
  treasure: boolean;
  passable: boolean;
  blocksView: boolean;
  name: string;
}

const UNKNOWN: FeatureClass = {
  shape: 'unknown', material: 'granite', treasure: false, passable: false, blocksView: true, name: '',
};

export function classifyFeature(f: FeatureInfo | null | undefined): FeatureClass {
  if (!f || f.idx === 0) return UNKNOWN;
  const has = (flag: string) => f.flags.includes(flag);
  let shape: Shape;
  if (has('shop')) shape = 'shop';
  else if (has('upstair')) shape = 'stair_up';
  else if (has('downstair')) shape = 'stair_down';
  else if (has('wall')) shape = 'wall';
  else if (has('door_closed')) shape = 'door_closed';
  else if (has('door')) shape = 'door_open';
  else if (has('fiery')) shape = 'lava';
  else if (has('rock')) shape = has('passable') ? 'passable_rubble' : 'rubble';
  else if (has('passable') || has('floor')) shape = 'floor';
  else shape = 'wall';

  let material: WallMaterial = 'granite';
  if (has('permanent')) material = 'permanent';
  else if (has('magma')) material = 'magma';
  else if (has('quartz')) material = 'quartz';

  return {
    shape,
    material,
    treasure: has('gold'),
    passable: has('passable'),
    blocksView: !has('los'),
    name: f.name,
  };
}

export function classifyAll(features: (FeatureInfo | null)[]): FeatureClass[] {
  return features.map((f) => classifyFeature(f));
}
