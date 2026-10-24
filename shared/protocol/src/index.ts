/**
 * Thangorodrim engine protocol, version 1.
 *
 * Transport: one JSON object per line on the engine's stdin/stdout, relayed
 * unchanged over a WebSocket by the bridge.  The engine is authoritative for
 * all game state; the client only renders what the engine sends and issues
 * commands that map 1:1 onto native Angband commands.
 *
 * See docs/protocol.md for the narrative description.  Keep this file in
 * sync with engine/adapter/src (snapshot.c, hooks.c, commands.c, store.c).
 */

export const PROTOCOL_VERSION = 1;

/** [row, column] in the tileset atlas, in cells */
export type Tile = [number, number];

/* ------------------------------------------------------------------ */
/* Engine -> client                                                    */
/* ------------------------------------------------------------------ */

export interface FeatureInfo {
  idx: number;
  name: string;
  /** Angband terrain flags, lower-cased (e.g. "wall", "passable", "door_closed") */
  flags: string[];
  /** Tiles per lighting level: [los, torch, lit, dark] */
  tiles: (Tile | null)[];
}

export interface OptionInfo {
  name: string;
  description: string;
  kind: 'interface' | 'birth';
  value: boolean;
}

export interface HelloMessage {
  type: 'hello';
  protocol: number;
  engine: string;
  savefile: string;
  saveExists: boolean;
  races: string[];
  classes: string[];
  options: OptionInfo[];
  tileset: {
    id: number;
    name: string;
    /** Path relative to the bridge's HTTP root, e.g. "tiles/gervais/32x32.png" */
    url: string;
    cellWidth: number;
    cellHeight: number;
  };
  /** Indexed by feature index; null for unused indices */
  features: (FeatureInfo | null)[];
  playerTile: Tile | null;
  /** Angband colour table as [r, g, b], indexed by COLOUR_* */
  palette: [number, number, number][];
}

/** Lighting levels, as Angband's enum grid_light_level */
export const LIGHT_LOS = 0;
export const LIGHT_TORCH = 1;
export const LIGHT_LIT = 2;
export const LIGHT_DARK = 3;

/** [x, y, featureIdx, lighting, inView(0|1), trapTile|null] */
export type MapCell = [number, number, number, number, number, Tile | null];

export interface MapUpdate {
  width: number;
  height: number;
  /** When true the client must discard its map before applying cells */
  full: boolean;
  /** Changed cells only (feature 0 = no longer known) */
  cells: MapCell[];
}

export interface StatusEntry {
  name: string;
  effect?: string;
  color: number;
  pct?: number;
}

export interface StatEntry {
  name: string;
  value: string;
  drained: boolean;
}

export interface PlayerState {
  name: string;
  race: string;
  class: string;
  title: string;
  x: number;
  y: number;
  depth: number;
  maxDepth: number;
  level: number;
  maxLevel: number;
  exp: number;
  maxExp: number;
  expToNext: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  gold: number;
  ac: number;
  speed: number;
  light: number;
  burden: number;
  resting: boolean;
  repeats: number;
  dead: boolean;
  diedFrom?: string;
  canCast: boolean;
  canStudy: boolean;
  spellNoun?: string;
  stats: StatEntry[];
  terrain: string;
  levelFeeling?: string;
}

export type ItemAction =
  | 'takeoff' | 'wield' | 'eat' | 'quaff' | 'read' | 'use_staff' | 'aim_wand'
  | 'zap_rod' | 'activate' | 'refill' | 'fire' | 'throw' | 'cast' | 'study'
  | 'browse' | 'drop' | 'inscribe' | 'uninscribe' | 'ignore';

export interface ItemInfo {
  /** "inven:N" | "equip:N" | "quiver:N" | "floor:N" */
  handle: string;
  name: string;
  number: number;
  weight: number;
  tval: string;
  tile: Tile | null;
  inscription?: string;
  actions: ItemAction[];
}

export interface EquipSlot {
  slot: string;
  item: ItemInfo | null;
}

export interface MonsterInfo {
  id: number;
  x: number;
  y: number;
  tile: Tile | null;
  name: string;
  /** Race name (absent while hallucinating) */
  race?: string;
  status: string;
  inView: boolean;
  unique: boolean;
  asleep: boolean;
  /** Only present for the tracked monster, as the stock health bar */
  healthPct?: number;
  targeted: boolean;
}

export interface ObjectPile {
  x: number;
  y: number;
  tile: Tile | null;
  name: string;
  count: number;
  pile: boolean;
  seen: boolean;
}

export interface GameMessage {
  text: string;
  /** Angband MSG_* type */
  type: number;
  sound?: string;
}

export type Effect =
  | { kind: 'bolt' | 'beam'; proj: number; color: number; x: number; y: number; fromX: number; fromY: number }
  | { kind: 'missile'; x: number; y: number; tile?: Tile }
  | { kind: 'explosion'; proj: number; color: number; x: number; y: number; grids: [number, number, number][] };

export interface StoreItem {
  handle: string;
  name: string;
  number: number;
  weight: number;
  price?: number;
  canUse: boolean;
  tile: Tile | null;
}

export interface StoreState {
  name: string;
  home: boolean;
  owner?: string;
  maxCost?: number;
  noSelling: boolean;
  stock: StoreItem[];
  sellable: { handle: string; price?: number }[];
}

export type Phase = 'menu' | 'game' | 'dead';

export interface StateMessage {
  type: 'state';
  seq: number;
  phase: Phase;
  turn?: number;
  playerTurns?: number;
  levelId?: number;
  player?: PlayerState;
  status?: StatusEntry[];
  map?: MapUpdate;
  objects?: ObjectPile[];
  monsters?: MonsterInfo[];
  inventory?: ItemInfo[];
  equipment?: EquipSlot[];
  quiver?: ItemInfo[];
  floor?: ItemInfo[];
  target?: { x: number; y: number; monster?: number };
  store?: StoreState;
  messages: GameMessage[];
  effects: Effect[];
}

export interface SpellInfo {
  index: number;
  name: string;
  level: number;
  mana: number;
  fail: number;
  info: string;
  description: string;
  learned: boolean;
  allowed: boolean;
  book?: string;
}

export interface TargetCandidate {
  id: number;
  x: number;
  y: number;
  name: string;
  distance: number;
}

interface PromptBase {
  type: 'prompt';
  id: number;
  prompt: string;
}

export type PromptMessage = PromptBase & (
  | { kind: 'confirm' }
  | { kind: 'string'; default: string; maxLength: number }
  | { kind: 'quantity'; max: number; default: number }
  | { kind: 'key' }
  | { kind: 'direction'; allowNone: boolean }
  | { kind: 'aim'; hasTarget: boolean; targets: TargetCandidate[] }
  | { kind: 'item'; command: number; verb: string; items: ItemInfo[] }
  | { kind: 'spell'; verb: string; spells: SpellInfo[] }
  | { kind: 'curse'; choices: { value: number; name: string; power: number }[] }
  | { kind: 'choice'; choices: { value: number; name: string }[] }
);

export type PromptKind = PromptMessage['kind'];

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface InfoMessage {
  type: 'info';
  what: 'item' | 'monster' | 'book';
  title: string;
  text: string;
}

export interface SavedMessage {
  type: 'saved';
  ok: boolean;
}

export interface PongMessage {
  type: 'pong';
  id: number;
}

/** Sent by the bridge itself, never by the engine */
export interface BridgeMessage {
  type: 'bridge';
  event: 'engine_started' | 'engine_exit' | 'engine_failed' | 'replaced';
  code?: number | null;
  signal?: string | null;
  message?: string;
}

export type EngineMessage =
  | HelloMessage
  | StateMessage
  | PromptMessage
  | ErrorMessage
  | InfoMessage
  | SavedMessage
  | PongMessage
  | BridgeMessage;

/* ------------------------------------------------------------------ */
/* Client -> engine                                                    */
/* ------------------------------------------------------------------ */

/** Angband keypad directions: 1-9, 5 = here */
export type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type GameAction =
  | 'walk' | 'run' | 'jump' | 'hold' | 'go_up' | 'go_down' | 'explore'
  | 'navigate_up' | 'navigate_down'
  | 'open' | 'close' | 'tunnel' | 'disarm' | 'alter' | 'steal'
  | 'pickup' | 'autopickup' | 'wield' | 'takeoff' | 'drop' | 'eat' | 'quaff'
  | 'read' | 'use_staff' | 'aim_wand' | 'zap_rod' | 'activate' | 'use'
  | 'refill' | 'fire' | 'throw' | 'inscribe' | 'uninscribe' | 'study' | 'cast'
  | 'rest'
  | 'target_closest' | 'target_next' | 'target_prev' | 'target_clear'
  | 'target_monster' | 'fire_at_nearest' | 'ignore' | 'toggle_unignore'
  | 'feeling'
  | 'store_buy' | 'store_sell' | 'store_leave';

export interface CommandMessage {
  type: 'command';
  action: GameAction;
  dir?: Direction;
  item?: string;
  quantity?: number;
  useTarget?: boolean;
  monster?: number;
  book?: string;
  spell?: number;
  text?: string;
  mode?: 'as_needed' | 'hp_sp' | 'hp_or_sp' | 'turns';
  turns?: number;
}

export interface AnswerMessage {
  type: 'answer';
  id: number;
  value?: boolean | number | string;
  book?: string;
  monster?: number;
  useTarget?: boolean;
}

export interface CancelMessage {
  type: 'cancel';
  id: number;
}

export interface NewGameMessage {
  type: 'new_game';
  race: string;
  class: string;
  name: string;
  stats?: 'points' | 'roll';
  birthOptions?: Record<string, boolean>;
  options?: Record<string, boolean>;
}

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'ping'; id: number }
  | NewGameMessage
  | { type: 'load_game' }
  | CommandMessage
  | AnswerMessage
  | CancelMessage
  | { type: 'save' }
  | { type: 'quit' }
  | { type: 'options'; set: Record<string, boolean> }
  | { type: 'query'; what: 'item'; item: string }
  | { type: 'query'; what: 'book'; item: string }
  | { type: 'query'; what: 'monster'; monster: number };

/* ------------------------------------------------------------------ */
/* Direction helpers (Angband keypad layout)                           */
/* ------------------------------------------------------------------ */

/** Grid offsets for each keypad direction */
export const DIR_OFFSETS: Record<Direction, [number, number]> = {
  1: [-1, 1], 2: [0, 1], 3: [1, 1],
  4: [-1, 0], 5: [0, 0], 6: [1, 0],
  7: [-1, -1], 8: [0, -1], 9: [1, -1],
};

/** Facing index 0..7 clockwise from north, as keypad directions */
export const FACING_TO_DIR: Direction[] = [8, 9, 6, 3, 2, 1, 4, 7];

export function dirFromOffset(dx: number, dy: number): Direction | null {
  for (const [d, [ox, oy]] of Object.entries(DIR_OFFSETS)) {
    if (ox === Math.sign(dx) && oy === Math.sign(dy)) return Number(d) as Direction;
  }
  return null;
}
