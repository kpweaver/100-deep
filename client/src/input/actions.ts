/**
 * Semantic input actions.  Devices map onto these; game and UI code only
 * ever see actions, which makes rebinding and button prompts device-agnostic.
 */
export type GameAction =
  | 'moveForward' | 'moveBack' | 'strafeLeft' | 'strafeRight'
  | 'turnLeft' | 'turnRight'
  | 'interact'      // contextual: stairs, pick up, open door ahead
  | 'attack'        // fire at nearest if possible, otherwise melee ahead
  | 'explore'
  | 'wait'
  | 'rest'
  | 'targetNext' | 'targetPrev'
  | 'inventory' | 'spells' | 'quick' | 'map' | 'character' | 'menu'
  | 'cancel'
  | 'runForward'
  | 'walkDir1' | 'walkDir2' | 'walkDir3' | 'walkDir4' | 'walkDir6'
  | 'walkDir7' | 'walkDir8' | 'walkDir9'
  | 'goUp' | 'goDown'
  | 'study';

export type UiAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'confirm' | 'back' | 'secondary' | 'tertiary'
  | 'pageUp' | 'pageDown' | 'tabNext' | 'tabPrev'
  | 'menu';

export type Device = 'keyboard' | 'gamepad';

export interface InputEvent {
  game?: GameAction;
  ui?: UiAction;
  /** Raw key for text entry / letter shortcuts (keyboard only) */
  key?: string;
  device: Device;
  repeat: boolean;
}

/** A consumer of input; return true if handled */
export interface InputHandler {
  handleInput(ev: InputEvent): boolean;
  /** Called every frame with held game actions (for continuous movement) */
  handleHeld?(held: Set<GameAction>): void;
}

/** Labels for button prompts, per device */
export const PROMPTS: Record<Device, Partial<Record<GameAction | UiAction, string>>> = {
  keyboard: {
    interact: 'Space', attack: 'F', explore: 'X', wait: '.', rest: 'R',
    targetNext: 'Tab', inventory: 'I', spells: 'Z', quick: 'V', map: 'M',
    character: 'C', menu: 'Esc', confirm: 'Enter', back: 'Esc',
    secondary: 'Shift+Enter', tertiary: '?', moveForward: 'W', turnLeft: 'Q', turnRight: 'E',
    goUp: '<', goDown: '>',
  },
  gamepad: {
    interact: 'A', attack: 'RT', explore: 'X', wait: 'R3', rest: 'LB▸Rest',
    targetNext: 'RB', inventory: 'Y', spells: 'LT', quick: 'LB', map: 'Select',
    character: 'Select', menu: 'Start', confirm: 'A', back: 'B',
    secondary: 'X', tertiary: 'Y', moveForward: 'L↑', turnLeft: 'R←', turnRight: 'R→',
    goUp: 'A', goDown: 'A',
  },
};
