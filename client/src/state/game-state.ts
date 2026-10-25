/**
 * Client mirror of the engine's authoritative state.  Nothing here is
 * simulated; every field is replaced by engine messages.
 */
import type {
  EquipSlot, FeatureInfo, GameMessage, HelloMessage, InfoMessage, ItemInfo,
  MonsterInfo, ObjectPile, Phase, PlayerState, PromptMessage, StateMessage,
  StatusEntry, StoreState, Effect,
} from '@thang/protocol';
import { classifyAll, type FeatureClass } from './features.ts';
import { KnownMap } from './known-map.ts';

export interface LoggedMessage extends GameMessage {
  turn: number;
  /** Repeat count for consecutive identical messages, as the stock UI */
  count: number;
}

export interface StateChange {
  hello?: boolean;
  map?: boolean;
  levelChanged?: boolean;
  player?: boolean;
  entities?: boolean;
  gear?: boolean;
  prompt?: boolean;
  store?: boolean;
  phase?: boolean;
  messages?: GameMessage[];
  effects?: Effect[];
  /** Player grid position before this update, if it changed */
  moved?: { fromX: number; fromY: number };
}

type Listener = (change: StateChange) => void;

const MAX_LOG = 400;

export class GameState {
  hello: HelloMessage | null = null;
  features: (FeatureInfo | null)[] = [];
  featureClasses: FeatureClass[] = [];
  phase: Phase = 'menu';
  seq = 0;
  turn = 0;
  levelId = -1;
  player: PlayerState | null = null;
  status: StatusEntry[] = [];
  map = new KnownMap();
  monsters: MonsterInfo[] = [];
  objects: ObjectPile[] = [];
  inventory: ItemInfo[] = [];
  equipment: EquipSlot[] = [];
  quiver: ItemInfo[] = [];
  floor: ItemInfo[] = [];
  target: StateMessage['target'] | null = null;
  store: StoreState | null = null;
  prompt: PromptMessage | null = null;
  log: LoggedMessage[] = [];
  lastInfo: InfoMessage | null = null;

  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(change: StateChange) {
    for (const l of this.listeners) l(change);
  }

  applyHello(msg: HelloMessage): void {
    this.hello = msg;
    this.seq = 0;
    this.features = msg.features;
    this.featureClasses = classifyAll(msg.features);
    this.emit({ hello: true });
  }

  applyState(msg: StateMessage): void {
    const change: StateChange = {};
    if (msg.seq <= this.seq) {
      // Duplicate or out-of-order; sequence restarts after every hello
      return;
    }
    this.seq = msg.seq;

    if (msg.phase !== this.phase) {
      this.phase = msg.phase;
      change.phase = true;
      if (msg.phase === 'menu') {
        // Leaving a game: forget its level so the next one starts fresh
        this.map = new KnownMap();
        this.levelId = -1;
        this.monsters = [];
        this.objects = [];
        this.inventory = [];
        this.equipment = [];
        this.quiver = [];
        this.floor = [];
        this.target = null;
        this.store = null;
        this.status = [];
      }
    }
    // A new state always supersedes any prompt (the engine re-sends prompts)
    if (this.prompt) {
      this.prompt = null;
      change.prompt = true;
    }

    if (msg.player) {
      const prev = this.player;
      if (prev && (prev.x !== msg.player.x || prev.y !== msg.player.y)) {
        change.moved = { fromX: prev.x, fromY: prev.y };
      }
      this.player = msg.player;
      this.status = msg.status ?? [];
      change.player = true;
    } else if (msg.phase === 'menu') {
      this.player = null;
    }
    if (msg.turn !== undefined) this.turn = msg.turn;

    if (msg.levelId !== undefined && msg.levelId !== this.levelId) {
      this.levelId = msg.levelId;
      change.levelChanged = true;
      change.moved = undefined;
    }
    if (msg.map && this.map.apply(msg.map)) change.map = true;

    if (msg.monsters) {
      this.monsters = msg.monsters;
      change.entities = true;
    }
    if (msg.objects) {
      this.objects = msg.objects;
      change.entities = true;
    }
    if (msg.inventory) {
      this.inventory = msg.inventory;
      this.equipment = msg.equipment ?? [];
      this.quiver = msg.quiver ?? [];
      this.floor = msg.floor ?? [];
      change.gear = true;
    }
    this.target = msg.target ?? null;

    const store = msg.store ?? null;
    if (store || this.store) change.store = true;
    this.store = store;

    if (msg.messages.length) {
      change.messages = msg.messages;
      for (const m of msg.messages) this.addLog(m);
    }
    if (msg.effects.length) change.effects = msg.effects;
    this.emit(change);
  }

  applyPrompt(msg: PromptMessage): void {
    this.prompt = msg;
    this.emit({ prompt: true });
  }

  clearPrompt(): void {
    if (!this.prompt) return;
    this.prompt = null;
    this.emit({ prompt: true });
  }

  /** Local message (connection status etc.), shown in the log */
  note(text: string): void {
    const m: GameMessage = { text, type: 0 };
    this.addLog(m);
    this.emit({ messages: [m] });
  }

  private addLog(m: GameMessage) {
    const last = this.log[this.log.length - 1];
    if (last && last.text === m.text && last.turn === this.turn) {
      last.count++;
      return;
    }
    this.log.push({ ...m, turn: this.turn, count: 1 });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  monsterAt(x: number, y: number): MonsterInfo | undefined {
    return this.monsters.find((m) => m.x === x && m.y === y);
  }

  objectAt(x: number, y: number): ObjectPile | undefined {
    return this.objects.find((o) => o.x === x && o.y === y);
  }

  featureClassAt(x: number, y: number): FeatureClass {
    return this.featureClasses[this.map.featAt(x, y)] ?? this.featureClasses[0];
  }
}
