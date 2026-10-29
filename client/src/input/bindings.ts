/**
 * Rebindable controls: which key or button does each game action.
 *
 * The default keyboard layout is Angband's own original keyset, key for key
 * wherever the command exists here (q quaffs, r reads, m casts, G gains a
 * spell, l looks, * targets, h and Tab fire at the nearest, p explores, g
 * picks up, R rests...), with first-person movement: arrows step and turn,
 * and on the numpad 8/2 step forward and back, 4/6 step sideways, 7/9 turn
 * and 1/3 step back diagonally.  Enter opens the command menu and Space
 * does the contextual action, which Angband leaves free.  A WASD
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
  /** Controller layout the saved buttons were made for (absent: the old Orbrun-style one) */
  padLayout?: 2;
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
  ['Move', 'moveBackLeft', 'Step back and left'],
  ['Move', 'moveBackRight', 'Step back and right'],
  ['Move', 'turnLeft', 'Turn left'],
  ['Move', 'turnRight', 'Turn right'],
  ['Move', 'runForward', 'Run forward'],
  ['Move', 'explore', 'Auto-explore'],
  ['Move', 'travelDown', 'Travel to the nearest down staircase'],
  ['Move', 'goUp', 'Go up a staircase'],
  ['Move', 'goDown', 'Go down a staircase'],
  ['Move', 'wait', 'Hold still a turn'],
  ['Move', 'rest', 'Rest as needed'],
  ['Move', 'cmd:jump', 'Walk into a trap'],
  ['Act', 'interact', 'Interact (stairs, doors, pick up, attack ahead)'],
  ['Act', 'contextMenu', 'Context menu (everything you can do here)'],
  ['Act', 'attack', 'Melee (strike adjacent, else close in)'],
  ['Act', 'fire', 'Fire at the nearest monster'],
  ['Act', 'combatWheel', 'Combat wheel (cast, quaff, read, devices…)'],
  ['Act', 'aim', 'Aim / target, then fire'],
  ['Act', 'cmd:target_closest', 'Target the closest monster'],
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
  ['Items', 'gearWheel', 'Gear wheel (wear, eat, drop, inscribe…)'],
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
  ['Items', 'cmd:ignore', 'Ignore an item'],
  ['Items', 'cmd:toggle_unignore', 'Show or hide ignored items'],
  ['Items', 'cmd:autopickup', 'Pick up what you would auto-pick-up'],
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
  ['System', 'options', 'Options'],
  ['System', 'help', 'Controls'],
];

/** Angband's original keyset, plus first-person movement and a few extras */
const ANGBAND_KEYS: Record<KeyId, GameAction> = {
  ArrowUp: 'moveForward', ArrowDown: 'moveBack', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
  'Shift+ArrowLeft': 'strafeLeft', 'Shift+ArrowRight': 'strafeRight', 'Shift+ArrowUp': 'runForward',
  Numpad8: 'moveForward', Numpad2: 'moveBack', Numpad4: 'strafeLeft', Numpad6: 'strafeRight',
  Numpad7: 'turnLeft', Numpad9: 'turnRight', Numpad1: 'moveBackLeft', Numpad3: 'moveBackRight', Numpad5: 'wait',
  Space: 'interact', Enter: 'commands', NumpadEnter: 'commands', Escape: 'menu',
  // Moving
  ',': 'wait', '.': 'runForward', R: 'rest', p: 'explore', x: 'explore', '<': 'goUp', '>': 'goDown',
  W: 'cmd:jump', '-': 'cmd:jump',
  // Items
  g: 'cmd:pickup', 'Ctrl+g': 'cmd:autopickup', i: 'inventory', I: 'inventory', e: 'equipment', '|': 'quiver',
  q: 'cmd:quaff', r: 'cmd:read', E: 'cmd:eat', a: 'cmd:aim_wand', u: 'cmd:use_staff', z: 'cmd:zap_rod',
  A: 'cmd:activate', U: 'useMenu', F: 'cmd:refill', w: 'cmd:wield', t: 'cmd:takeoff', d: 'cmd:drop',
  '{': 'cmd:inscribe', '}': 'cmd:uninscribe', k: 'cmd:ignore', 'Ctrl+d': 'cmd:ignore', K: 'cmd:toggle_unignore',
  // Magic
  m: 'spells', b: 'spells', G: 'study',
  // Fighting and other actions
  f: 'cmd:fire', v: 'cmd:throw', h: 'fire', Tab: 'fire', 'Shift+Tab': 'attack',
  '*': 'aim', "'": 'cmd:target_closest',
  o: 'cmd:open', c: 'cmd:close', T: 'cmd:tunnel', D: 'cmd:disarm', '+': 'cmd:alter', s: 'cmd:steal',
  // Looking
  l: 'look', M: 'map', L: 'map', C: 'character', '[': 'monsterList', ']': 'itemList', '/': 'recall',
  'Ctrl+e': 'toggleSidebar', '\\': 'toggleSidebar', 'Ctrl+f': 'cmd:feeling', 'Ctrl+p': 'messages', 'Ctrl+o': 'messages',
  // System
  '=': 'options', 'Ctrl+s': 'save', 'Ctrl+x': 'saveQuit', '?': 'help',
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

/**
 * Action wheels: the constant actions on their own buttons (RT melee, RB
 * fire, X explore, Y wait), the fight's items and spells on the LT wheel,
 * gear on the LB wheel, and the rest in A's context menu and Select's
 * command list.  Held buttons do the second, rarer action.
 */
const PAD_DEFAULTS: Partial<Record<GameAction, PadBind>> = {
  interact: { button: BTN.A },
  contextMenu: { button: BTN.A, hold: true },
  explore: { button: BTN.X },
  travelDown: { button: BTN.X, hold: true },
  wait: { button: BTN.Y },
  rest: { button: BTN.Y, hold: true },
  aim: { button: BTN.LT },
  combatWheel: { button: BTN.LT, hold: true },
  inventory: { button: BTN.LB },
  gearWheel: { button: BTN.LB, hold: true },
  attack: { button: BTN.RT },
  fire: { button: BTN.RB },
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
  return { version: 1, padLayout: 2, preset, keys: presetKeys(preset), pad: structuredClone(PAD_DEFAULTS) };
}

/** Saved bindings, or the defaults if missing or from another version */
export function loadBindings(raw: unknown): Bindings {
  const b = raw as Partial<Bindings> | null;
  if (!b || b.version !== 1 || typeof b.keys !== 'object' || typeof b.pad !== 'object') return defaultBindings();
  const keys = { ...b.keys };
  // p was a second cast key before it became pick up
  if (keys.p === 'spells' && keys.m === 'spells') keys.p = 'cmd:pickup';
  // h fired at the nearest monster as an engine command; Fire is its own action now
  for (const k of Object.keys(keys)) if (keys[k] === 'cmd:fire_at_nearest') keys[k] = 'fire';
  // Keys that once differed from Angband's own and still hold the old default
  // follow Angband now (p explores, G studies, Tab fires, the numpad moves
  // relative to the view)
  if (keys.p === 'cmd:pickup') keys.p = 'explore';
  if (keys.S === 'study' && !keys.G) (delete keys.S, (keys.G = 'study'));
  if (keys.Tab === 'attack' && !keys['Shift+Tab']) (keys.Tab = 'fire', (keys['Shift+Tab'] = 'attack'));
  const relative: Record<string, GameAction> = { Numpad8: 'moveForward', Numpad2: 'moveBack', Numpad4: 'strafeLeft', Numpad6: 'strafeRight', Numpad7: 'turnLeft', Numpad9: 'turnRight', Numpad1: 'moveBackLeft', Numpad3: 'moveBackRight' };
  for (const [id, a] of Object.entries(relative)) if (keys[id] === `walkDir${id.slice(-1)}`) keys[id] = a;
  // Buttons saved for the old layout give way to the wheels
  const pad = b.padLayout === 2 ? { ...b.pad } : structuredClone(PAD_DEFAULTS);
  return { version: 1, padLayout: 2, preset: b.preset === 'wasd' ? 'wasd' : 'angband', keys, pad };
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

const LABEL_KEYS: Record<string, string> = Object.fromEntries(Object.entries(KEY_NAMES).filter(([k]) => k !== 'NumpadEnter').map(([k, v]) => [v, k]));

/**
 * The key a prompt label names ('Esc', 'Shift+Enter', 'Esc / B', 'Space/-'),
 * or null for labels naming several keys or none ('↑↓←→', 'Arrows').  The
 * first alternative wins.  Touch uses it to press a tapped prompt's key.
 */
export function keyIdFromLabel(label: string): KeyId | null {
  let l = label.trim().split(' / ')[0];
  // 'Space/-', '+/-': the first of two keys (but '/' alone is a key)
  if (l.length > 1 && l.includes('/')) l = l.split('/')[0];
  const num = /^Num (\d)$/.exec(l);
  if (num) return `Numpad${num[1]}`;
  const id = l.replace(/[↑↓←→]|Esc/g, (t) => LABEL_KEYS[t] ?? t);
  // Several arrows ('↑↓←→') or a word that is no key
  if (/(Arrow\w+){2}/.test(id) || l === 'Arrows' || l === '') return null;
  return id;
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
