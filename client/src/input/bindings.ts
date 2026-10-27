/**
 * Rebindable controls: which key or button does each game action.
 *
 * The default keyboard layout is Angband's own (original keyset): q quaffs,
 * r reads, m casts, l looks, * targets, R rests, Enter opens the command
 * menu, and so on, with arrows to walk and turn in first person.  A WASD
 * preset moves with WASD/QE instead, leaving the letters it takes to the
 * Use, gear and command menus.  UI keys (arrows, Enter, Esc in menus) and
 * the controller's menu buttons (B back, Start menu) are fixed.
 */
import { restyle, type GameAction, type GlyphStyle } from './actions.ts';

/** Keyboard binding id: a printable key ('q', 'Q', '*'), a named key ('Tab', 'Shift+ArrowUp', 'Numpad8') or 'Ctrl+p' */
export type KeyId = string;

/** A controller button, as a tap or a hold */
export interface PadBind { button: number; hold?: boolean }

export type KeyPreset = 'angband' | 'wasd';

export interface Bindings {
  version: 1;
  preset: KeyPreset;
  keys: Record<KeyId, GameAction>;
  pad: Partial<Record<GameAction, PadBind>>;
}

/** Standard gamepad mapping indices */
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
export const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
/** B always backs out and Start always opens the menu */
export const FIXED_BUTTONS = new Set([BTN.B, BTN.START]);

/** Actions shown on the controls screen, in order, by group */
export const BINDABLE: [group: string, action: GameAction, label: string][] = [
  ['Move', 'moveForward', 'Step forward'],
  ['Move', 'moveBack', 'Step back'],
  ['Move', 'strafeLeft', 'Step left'],
  ['Move', 'strafeRight', 'Step right'],
  ['Move', 'turnLeft', 'Turn left'],
  ['Move', 'turnRight', 'Turn right'],
  ['Move', 'runForward', 'Run forward'],
  ['Move', 'explore', 'Auto-explore'],
  ['Move', 'goUp', 'Go up a staircase'],
  ['Move', 'goDown', 'Go down a staircase'],
  ['Move', 'wait', 'Hold still a turn'],
  ['Move', 'rest', 'Rest as needed'],
  ['Move', 'cmd:jump', 'Walk into a trap'],
  ['Act', 'interact', 'Interact (stairs, doors, pick up, attack ahead)'],
  ['Act', 'attack', 'Fire at nearest (melee when adjacent, else close in)'],
  ['Act', 'aim', 'Aim / target, then fire'],
  ['Act', 'cmd:target_closest', 'Target the closest monster'],
  ['Act', 'cmd:fire_at_nearest', 'Fire at the nearest monster'],
  ['Act', 'cmd:fire', 'Fire a missile'],
  ['Act', 'cmd:throw', 'Throw an item'],
  ['Act', 'spells', 'Cast a spell'],
  ['Act', 'study', 'Study a book'],
  ['Act', 'cmd:open', 'Open a door or chest'],
  ['Act', 'cmd:close', 'Close a door'],
  ['Act', 'cmd:tunnel', 'Tunnel'],
  ['Act', 'cmd:disarm', 'Disarm'],
  ['Act', 'cmd:alter', 'Alter terrain'],
  ['Act', 'cmd:steal', 'Steal'],
  ['Items', 'useMenu', 'Use menu (spells, devices, potions…)'],
  ['Items', 'inventory', 'Inventory'],
  ['Items', 'equipment', 'Equipment'],
  ['Items', 'quiver', 'Quiver'],
  ['Items', 'cmd:quaff', 'Quaff a potion'],
  ['Items', 'cmd:read', 'Read a scroll'],
  ['Items', 'cmd:eat', 'Eat'],
  ['Items', 'cmd:aim_wand', 'Aim a wand'],
  ['Items', 'cmd:use_staff', 'Use a staff'],
  ['Items', 'cmd:zap_rod', 'Zap a rod'],
  ['Items', 'cmd:activate', 'Activate an item'],
  ['Items', 'cmd:refill', 'Refuel your light'],
  ['Items', 'cmd:wield', 'Wear or wield'],
  ['Items', 'cmd:takeoff', 'Take off'],
  ['Items', 'cmd:drop', 'Drop'],
  ['Items', 'cmd:pickup', 'Pick up'],
  ['Items', 'cmd:inscribe', 'Inscribe'],
  ['Items', 'cmd:uninscribe', 'Uninscribe'],
  ['Items', 'cmd:toggle_unignore', 'Show or hide ignored items'],
  ['Look', 'look', 'Look / examine'],
  ['Look', 'map', 'Level map'],
  ['Look', 'character', 'Character sheet'],
  ['Look', 'monsterList', 'Visible monsters'],
  ['Look', 'itemList', 'Visible items'],
  ['Look', 'recall', 'Monster recall'],
  ['Look', 'messages', 'Message history'],
  ['Look', 'cmd:feeling', 'Level feeling'],
  ['Look', 'toggleSidebar', 'Show or hide the side panels'],
  ['System', 'commands', 'All commands menu'],
  ['System', 'save', 'Save'],
  ['System', 'saveQuit', 'Save and quit'],
  ['System', 'help', 'Controls'],
];

/** Angband's original keyset, plus first-person movement and a few extras */
const ANGBAND_KEYS: Record<KeyId, GameAction> = {
  ArrowUp: 'moveForward', ArrowDown: 'moveBack', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
  'Shift+ArrowLeft': 'strafeLeft', 'Shift+ArrowRight': 'strafeRight', 'Shift+ArrowUp': 'runForward',
  Numpad1: 'walkDir1', Numpad2: 'walkDir2', Numpad3: 'walkDir3', Numpad4: 'walkDir4', Numpad5: 'wait',
  Numpad6: 'walkDir6', Numpad7: 'walkDir7', Numpad8: 'walkDir8', Numpad9: 'walkDir9',
  Space: 'interact', Enter: 'commands', NumpadEnter: 'commands', Escape: 'menu',
  ',': 'wait', R: 'rest', p: 'cmd:pickup', g: 'cmd:pickup', '<': 'goUp', '>': 'goDown', W: 'cmd:jump',
  i: 'inventory', I: 'inventory', e: 'equipment', '|': 'quiver',
  m: 'spells', b: 'spells', S: 'study',
  q: 'cmd:quaff', r: 'cmd:read', E: 'cmd:eat', a: 'cmd:aim_wand', u: 'cmd:use_staff', z: 'cmd:zap_rod',
  A: 'cmd:activate', U: 'useMenu', f: 'cmd:fire', v: 'cmd:throw', F: 'cmd:refill',
  w: 'cmd:wield', t: 'cmd:takeoff', d: 'cmd:drop', '{': 'cmd:inscribe', '}': 'cmd:uninscribe',
  K: 'cmd:toggle_unignore',
  o: 'cmd:open', c: 'cmd:close', T: 'cmd:tunnel', D: 'cmd:disarm', '+': 'cmd:alter', s: 'cmd:steal',
  l: 'look', x: 'explore', '*': 'aim', "'": 'cmd:target_closest', h: 'cmd:fire_at_nearest', Tab: 'attack',
  C: 'character', M: 'map', '[': 'monsterList', ']': 'itemList', '/': 'recall', '\\': 'toggleSidebar',
  'Ctrl+p': 'messages', 'Ctrl+f': 'cmd:feeling', 'Ctrl+s': 'save', 'Ctrl+x': 'saveQuit', '?': 'help',
};

/** WASD movement; the Angband letters it takes (w a s d q e) live in the menus instead */
const WASD_KEYS: Record<KeyId, GameAction> = (() => {
  const k: Record<KeyId, GameAction> = { ...ANGBAND_KEYS };
  for (const id of ['w', 'a', 's', 'd', 'q', 'e', 'W']) delete k[id];
  Object.assign(k, {
    w: 'moveForward', s: 'moveBack', a: 'strafeLeft', d: 'strafeRight', q: 'turnLeft', e: 'turnRight',
    W: 'runForward', E: 'equipment', Q: 'cmd:quaff',
  });
  return k;
})();

/** Orbrun-style controller layout */
const PAD_DEFAULTS: Partial<Record<GameAction, PadBind>> = {
  interact: { button: BTN.A },
  useMenu: { button: BTN.X },
  inventory: { button: BTN.Y },
  wait: { button: BTN.LB },
  rest: { button: BTN.LB, hold: true },
  aim: { button: BTN.RB },
  explore: { button: BTN.LT },
  attack: { button: BTN.RT },
  commands: { button: BTN.SELECT },
  look: { button: BTN.L3 },
  map: { button: BTN.R3 },
  moveForward: { button: BTN.UP },
  moveBack: { button: BTN.DOWN },
  turnLeft: { button: BTN.LEFT },
  turnRight: { button: BTN.RIGHT },
};

export function presetKeys(preset: KeyPreset): Record<KeyId, GameAction> {
  return { ...(preset === 'wasd' ? WASD_KEYS : ANGBAND_KEYS) };
}

export function defaultBindings(preset: KeyPreset = 'angband'): Bindings {
  return { version: 1, preset, keys: presetKeys(preset), pad: structuredClone(PAD_DEFAULTS) };
}

/** Saved bindings, or the defaults if missing or from another version */
export function loadBindings(raw: unknown): Bindings {
  const b = raw as Partial<Bindings> | null;
  if (!b || b.version !== 1 || typeof b.keys !== 'object' || typeof b.pad !== 'object') return defaultBindings();
  const keys = { ...b.keys };
  // p was a second cast key before it became pick up
  if (keys.p === 'spells' && keys.m === 'spells') keys.p = 'cmd:pickup';
  return { version: 1, preset: b.preset === 'wasd' ? 'wasd' : 'angband', keys, pad: { ...b.pad } };
}

/** The binding id for a key event (case and symbols follow the keyboard layout) */
export function keyIdFromEvent(e: KeyboardEvent): KeyId {
  if (e.ctrlKey && e.key.length === 1) return `Ctrl+${e.key.toLowerCase()}`;
  // Numpad by position, so walking works with Num Lock either way
  if (e.code.startsWith('Numpad') && e.code !== 'NumpadEnter' && /^Numpad\d$/.test(e.code)) return e.code;
  if (e.code === 'NumpadEnter') return 'NumpadEnter';
  if (e.key === ' ') return 'Space';
  if (e.key.length === 1) return e.key;
  return `${e.shiftKey ? 'Shift+' : ''}${e.key}`;
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', NumpadEnter: 'Enter',
};

export function keyLabel(id: KeyId): string {
  return id
    .replace(/^Numpad(\d)$/, 'Num $1')
    .replace(/Arrow(Up|Down|Left|Right)|Escape|NumpadEnter/g, (t) => KEY_NAMES[t] ?? t);
}

export function padLabel(b: PadBind, style: GlyphStyle): string {
  const name = restyle(BUTTON_NAMES[b.button] ?? `Button ${b.button}`, style);
  return b.hold ? `Hold ${name}` : name;
}

/** Keys bound to an action, in a stable order (single letters first) */
export function keysFor(b: Bindings, action: GameAction): KeyId[] {
  return Object.keys(b.keys).filter((k) => b.keys[k] === action)
    .sort((x, y) => (x.length === 1 ? 0 : 1) - (y.length === 1 ? 0 : 1));
}

/**
 * Bind a key to an action.  The action's old keys go; if the key belonged
 * to another action, that action takes over the old key (a swap).
 * Returns the action that was displaced, if any.
 */
export function bindKey(b: Bindings, action: GameAction, id: KeyId): GameAction | null {
  const old = keysFor(b, action);
  const displaced = b.keys[id] && b.keys[id] !== action ? b.keys[id] : null;
  for (const k of old) delete b.keys[k];
  if (displaced && old[0] && old[0] !== id) b.keys[old[0]] = displaced;
  b.keys[id] = action;
  return displaced;
}

/** Bind a controller button (tap or hold) to an action, swapping as for keys */
export function bindPad(b: Bindings, action: GameAction, bind: PadBind): GameAction | null {
  const same = (p?: PadBind) => !!p && p.button === bind.button && !!p.hold === !!bind.hold;
  const old = b.pad[action];
  let displaced: GameAction | null = null;
  for (const [a, p] of Object.entries(b.pad) as [GameAction, PadBind][]) {
    if (a !== action && same(p)) {
      displaced = a;
      if (old) b.pad[a] = old;
      else delete b.pad[a];
    }
  }
  b.pad[action] = { ...bind };
  return displaced;
}

export function unbind(b: Bindings, action: GameAction, device: 'keyboard' | 'gamepad'): void {
  if (device === 'gamepad') delete b.pad[action];
  else for (const k of keysFor(b, action)) delete b.keys[k];
}

/** Per button: the action on tap and on hold */
export function padTable(b: Bindings): Map<number, { tap?: GameAction; hold?: GameAction }> {
  const t = new Map<number, { tap?: GameAction; hold?: GameAction }>();
  for (const [a, p] of Object.entries(b.pad) as [GameAction, PadBind][]) {
    if (!p) continue;
    const e = t.get(p.button) ?? {};
    if (p.hold) e.hold = a;
    else e.tap = a;
    t.set(p.button, e);
  }
  return t;
}
