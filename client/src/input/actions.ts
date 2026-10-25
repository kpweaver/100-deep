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
  | 'study'
  | 'monsterList' | 'itemList' | 'recall' | 'toggleSidebar';

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

/** Extra prompt keys used by screen footers */
export type PromptKey = GameAction | UiAction | 'tabs' | 'zoom' | 'dpad' | 'scroll' | 'page';

/** Labels for button prompts, per device (gamepad labels are Xbox-style) */
export const PROMPTS: Record<Device, Partial<Record<PromptKey, string>>> = {
  keyboard: {
    interact: 'Space', attack: 'F', explore: 'X', wait: '.', rest: 'R',
    targetNext: 'Tab', inventory: 'I', spells: 'Z', quick: 'V', map: 'M',
    character: 'C', menu: 'Esc', confirm: 'Enter', back: 'Esc',
    secondary: 'Shift+Enter', tertiary: '?', moveForward: 'W', turnLeft: 'Q', turnRight: 'E',
    goUp: '<', goDown: '>',
    tabs: 'Tab', zoom: '+/-', dpad: 'Arrows', scroll: '↑/↓', page: '←/→',
  },
  gamepad: {
    interact: 'A', attack: 'RT', explore: 'X', wait: 'R3', rest: 'LB▸Rest',
    targetNext: 'RB', inventory: 'Y', spells: 'LT', quick: 'LB', map: 'Select',
    character: 'Select', menu: 'Start', confirm: 'A', back: 'B',
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

export function promptsFor(device: Device, style: GlyphStyle): Partial<Record<PromptKey, string>> {
  const base = PROMPTS[device];
  if (device === 'keyboard' || style === 'xbox') return base;
  const map = RESTYLE[style];
  const out: Partial<Record<PromptKey, string>> = {};
  for (const [k, label] of Object.entries(base)) {
    out[k as PromptKey] = label.replace(/\b(LB|RB|LT|RT|L3|R3|Start|Select|A|B|X|Y)\b/g, (t) => map[t] ?? t);
  }
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
