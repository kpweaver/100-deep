import type { GameAction as EngineAction } from '@thang/protocol';

/**
 * Semantic input actions.  Devices map onto these; game and UI code only
 * ever see actions, which makes rebinding and button prompts device-agnostic.
 */
export type GameAction =
  | 'moveForward' | 'moveBack' | 'strafeLeft' | 'strafeRight'
  | 'turnLeft' | 'turnRight'
  | 'interact'      // contextual: stairs, pick up, open door ahead
  | 'attack'        // melee: strike an adjacent foe, else step toward the nearest
  | 'fire'          // fire the launcher at the nearest foe
  | 'contextMenu'   // everything you can do here or with what is ahead
  | 'combatWheel' | 'gearWheel'
  | 'travelDown'    // travel to the nearest down staircase
  | 'explore'
  | 'wait'
  | 'rest'
  | 'targetNext' | 'targetPrev'
  | 'inventory' | 'spells' | 'map' | 'character' | 'menu'
  | 'cancel'
  | 'runForward'
  | 'walkDir1' | 'walkDir2' | 'walkDir3' | 'walkDir4' | 'walkDir6'
  | 'walkDir7' | 'walkDir8' | 'walkDir9'
  | 'goUp' | 'goDown'
  | 'study'
  | 'monsterList' | 'itemList' | 'recall' | 'toggleSidebar'
  | 'useMenu'       // spells, magic devices, potions, scrolls, missiles
  | 'commands'      // every command, by category
  | 'aim'           // pick and cycle a target, then fire at it
  | 'look'          // examine what you see, or any grid with a free cursor
  | 'equipment' | 'quiver' | 'messages' | 'save' | 'saveQuit' | 'help'
  /** An engine command sent as is; the engine asks for any item, direction or target */
  | `cmd:${EngineAction}`;

export type UiAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'confirm' | 'back' | 'secondary' | 'tertiary'
  | 'pageUp' | 'pageDown' | 'tabNext' | 'tabPrev'
  | 'menu';

export type Device = 'keyboard' | 'gamepad' | 'touch';

export interface InputEvent {
  game?: GameAction;
  ui?: UiAction;
  /** Raw key for text entry / letter shortcuts (keyboard, or a tapped key prompt) */
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

/** Extra prompt keys used by screen footers */
export type PromptKey = GameAction | UiAction | 'tabs' | 'zoom' | 'dpad' | 'scroll' | 'page';

/**
 * Labels for button prompts, per device (gamepad labels are Xbox-style).
 * Touch shows the keyboard's labels: a tapped prompt presses that key.
 */
export const PROMPTS: Record<Exclude<Device, 'touch'>, Partial<Record<PromptKey, string>>> = {
  keyboard: {
    interact: 'Space', attack: 'Tab', fire: 'h', explore: 'x', wait: ',', rest: 'R',
    inventory: 'i', spells: 'm', map: 'M',
    useMenu: 'U', commands: 'Enter', aim: '*', look: 'l',
    character: 'C', menu: 'Esc', confirm: 'Enter', back: 'Esc',
    secondary: 'Shift+Enter', tertiary: '?', moveForward: '↑', turnLeft: '←', turnRight: '→',
    goUp: '<', goDown: '>',
    tabs: 'Tab', zoom: '+/-', dpad: 'Arrows', scroll: '↑/↓', page: '←/→',
  },
  gamepad: {
    interact: 'A', contextMenu: 'Hold A', attack: 'RT', fire: 'RB', explore: 'X', travelDown: 'Hold X',
    wait: 'Y', rest: 'Hold Y', aim: 'LT', combatWheel: 'Hold LT', inventory: 'LB', gearWheel: 'Hold LB',
    map: 'R3', commands: 'Select', look: 'L3',
    character: 'Start', menu: 'Start', confirm: 'A', back: 'B',
    secondary: 'X', tertiary: 'Y', moveForward: 'L↑', turnLeft: 'R←', turnRight: 'R→',
    goUp: 'A', goDown: 'A',
    tabs: 'LB/RB', zoom: 'LT/RT', dpad: 'D-pad', scroll: 'D-pad ↑/↓', page: 'D-pad ←/→',
  },
};

/** Controller families with different button labels */
export type GlyphStyle = 'xbox' | 'playstation' | 'nintendo';

/** Xbox label -> other families (by position in the standard mapping) */
const RESTYLE: Record<Exclude<GlyphStyle, 'xbox'>, Record<string, string>> = {
  playstation: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', L3: 'L3', R3: 'R3', Start: 'Options', Select: 'Share' },
  // Nintendo's bottom button is labelled B, right A, left Y, top X
  nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', L3: 'LS', R3: 'RS', Start: '+', Select: '−' },
};

/** An Xbox-style button label in another controller family's names */
export function restyle(label: string, style: GlyphStyle): string {
  if (style === 'xbox') return label;
  const map = RESTYLE[style];
  return label.replace(/\b(LB|RB|LT|RT|L3|R3|Start|Select|A|B|X|Y)\b/g, (t) => map[t] ?? t);
}

export function promptsFor(device: Device, style: GlyphStyle): Partial<Record<PromptKey, string>> {
  const base = PROMPTS[device === 'touch' ? 'keyboard' : device];
  if (device !== 'gamepad' || style === 'xbox') return base;
  const out: Partial<Record<PromptKey, string>> = {};
  for (const [k, label] of Object.entries(base)) out[k as PromptKey] = restyle(label, style);
  return out;
}

/** Guess the family from the Gamepad API id string (vendor ids / names) */
export function glyphStyleFromId(id: string): GlyphStyle {
  // Xbox first: "Xbox Wireless Controller" would otherwise match the DS4's
  // generic name "Wireless Controller"
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  if (/054c|dualsense|dualshock|playstation|wireless controller/i.test(id)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}
