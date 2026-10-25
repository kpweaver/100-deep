/** Services shared by UI screens */
import type { ClientMessage } from '@thang/protocol';
import type { GameState } from '../state/game-state.ts';
import type { TileAtlas } from '../sprites/atlas.ts';
import type { InputManager } from '../input/input-manager.ts';
import type { UiManager } from './layer.ts';

export interface Settings {
  /** Bumped when defaults change in a way that should override saved values */
  version: number;
  /** 1 = full-resolution rendering; 2-6 = optional retro pixel upscaling */
  pixelScale: number;
  instantMovement: boolean;
  fov: number;
  volume: number;
  autoExploreRepeat: boolean;
  showMinimap: boolean;
  /** Side panels: stock monster list, item list and recall */
  showSidebar: boolean;
}

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  pixelScale: 1,
  instantMovement: false,
  fov: 70,
  volume: 0.5,
  autoExploreRepeat: true,
  showMinimap: true,
  showSidebar: true,
};

export interface UiContext {
  state: GameState;
  ui: UiManager;
  input: InputManager;
  atlas(): TileAtlas | null;
  send(msg: ClientMessage): void;
  settings: Settings;
  applySettings(s: Partial<Settings>): void;
  /** Interface options to push to the engine for every character */
  engineOptions: Record<string, boolean>;
  facing(): number;
}
