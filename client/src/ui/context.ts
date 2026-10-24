/** Services shared by UI screens */
import type { ClientMessage } from '@thang/protocol';
import type { GameState } from '../state/game-state.ts';
import type { TileAtlas } from '../sprites/atlas.ts';
import type { InputManager } from '../input/input-manager.ts';
import type { UiManager } from './layer.ts';

export interface Settings {
  pixelScale: number;
  instantMovement: boolean;
  fov: number;
  volume: number;
  autoExploreRepeat: boolean;
  showMinimap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  pixelScale: 3,
  instantMovement: false,
  fov: 70,
  volume: 0.5,
  autoExploreRepeat: true,
  showMinimap: true,
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
