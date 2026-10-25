/**
 * Keyboard + Gamepad API input, mapped to semantic actions and routed to
 * the topmost handler (UI layers first, then the game view).
 */
import type { Device, GameAction, InputEvent, InputHandler, UiAction } from './actions.ts';

interface KeyBinding { game?: GameAction; ui?: UiAction }

/**
 * Default keyboard bindings (rebindable later via settings).  In menus,
 * letters are Angband-style item shortcuts, so WASD only moves in play and
 * arrow keys navigate menus.
 */
const KEYS: Record<string, KeyBinding> = {
  KeyW: { game: 'moveForward' },
  ArrowUp: { game: 'moveForward', ui: 'up' },
  KeyS: { game: 'moveBack' },
  ArrowDown: { game: 'moveBack', ui: 'down' },
  KeyA: { game: 'strafeLeft' },
  KeyD: { game: 'strafeRight' },
  KeyQ: { game: 'turnLeft' },
  ArrowLeft: { game: 'turnLeft', ui: 'left' },
  KeyE: { game: 'turnRight' },
  ArrowRight: { game: 'turnRight', ui: 'right' },
  Space: { game: 'interact', ui: 'confirm' },
  Enter: { game: 'interact', ui: 'confirm' },
  NumpadEnter: { game: 'interact', ui: 'confirm' },
  Escape: { game: 'menu', ui: 'back' },
  Backspace: { ui: 'back' },
  KeyF: { game: 'attack' },
  KeyX: { game: 'explore' },
  Period: { game: 'wait' },
  Numpad5: { game: 'wait' },
  KeyR: { game: 'rest' },
  Tab: { game: 'targetNext', ui: 'tabNext' },
  KeyI: { game: 'inventory' },
  KeyZ: { game: 'spells' },
  KeyV: { game: 'quick' },
  KeyM: { game: 'map' },
  KeyC: { game: 'character' },
  PageUp: { ui: 'pageUp' },
  PageDown: { ui: 'pageDown' },
  Numpad1: { game: 'walkDir1' }, Numpad2: { game: 'walkDir2' }, Numpad3: { game: 'walkDir3' },
  Numpad4: { game: 'walkDir4' }, Numpad6: { game: 'walkDir6' }, Numpad7: { game: 'walkDir7' },
  Numpad8: { game: 'walkDir8' }, Numpad9: { game: 'walkDir9' },
};

/* Standard gamepad mapping indices */
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const PAD_BUTTONS: Record<number, KeyBinding> = {
  [B.A]: { game: 'interact', ui: 'confirm' },
  [B.B]: { game: 'cancel', ui: 'back' },
  [B.X]: { game: 'explore', ui: 'secondary' },
  [B.Y]: { game: 'inventory', ui: 'tertiary' },
  [B.LB]: { game: 'quick', ui: 'tabPrev' },
  [B.RB]: { game: 'targetNext', ui: 'tabNext' },
  [B.LT]: { game: 'spells', ui: 'pageUp' },
  [B.RT]: { game: 'attack', ui: 'pageDown' },
  [B.SELECT]: { game: 'map', ui: 'back' },
  [B.START]: { game: 'menu', ui: 'menu' },
  [B.R3]: { game: 'wait' },
  [B.UP]: { game: 'moveForward', ui: 'up' },
  [B.DOWN]: { game: 'moveBack', ui: 'down' },
  [B.LEFT]: { game: 'turnLeft', ui: 'left' },
  [B.RIGHT]: { game: 'turnRight', ui: 'right' },
};

const DEADZONE = 0.45;
const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 0.12;
/** Actions that keep firing while held */
const REPEATABLE = new Set<string>([
  'moveForward', 'moveBack', 'strafeLeft', 'strafeRight', 'turnLeft', 'turnRight',
  'up', 'down', 'left', 'right', 'pageUp', 'pageDown',
]);

interface HeldState { binding: KeyBinding; time: number; next: number }

export class InputManager {
  private stack: InputHandler[] = [];
  private padHeld = new Map<string, HeldState>();
  private keyHeld = new Set<string>();
  lastDevice: Device = 'keyboard';
  onDeviceChange: ((d: Device) => void) | null = null;
  onGamepadConnected: ((name: string) => void) | null = null;
  /** Text inputs grab the keyboard while focused */
  textCapture = false;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keyHeld.delete(e.code));
    window.addEventListener('blur', () => this.keyHeld.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.onGamepadConnected?.((e as GamepadEvent).gamepad.id);
    });
  }

  push(h: InputHandler): void {
    this.stack.push(h);
  }

  remove(h: InputHandler): void {
    const i = this.stack.lastIndexOf(h);
    if (i >= 0) this.stack.splice(i, 1);
  }

  get top(): InputHandler | undefined {
    return this.stack[this.stack.length - 1];
  }

  private setDevice(d: Device) {
    if (d !== this.lastDevice) {
      this.lastDevice = d;
      this.onDeviceChange?.(d);
    }
  }

  private dispatch(ev: InputEvent): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].handleInput(ev)) return;
      // Only the top layer gets input unless it is transparent (returns false)
      break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.textCapture) return;
    this.setDevice('keyboard');
    let binding = KEYS[e.code] ?? {};
    // Shift+forward runs; Shift+Tab cycles targets backwards; < and > use stairs
    if (e.shiftKey && e.code === 'KeyW') binding = { game: 'runForward' };
    if (e.shiftKey && e.code === 'ArrowUp') binding = { game: 'runForward', ui: 'up' };
    if (e.shiftKey && e.code === 'Tab') binding = { game: 'targetPrev', ui: 'tabPrev' };
    if (e.shiftKey && (e.code === 'Enter' || e.code === 'NumpadEnter')) binding = { game: 'interact', ui: 'secondary' };
    if (e.shiftKey && e.code === 'KeyZ') binding = { game: 'study' };
    // Angband's own keys for the visible monster and item lists
    if (e.key === '[') binding = { game: 'monsterList' };
    if (e.key === ']') binding = { game: 'itemList' };
    if (e.key === '\\') binding = { game: 'toggleSidebar' };
    if (e.key === '<') binding = { game: 'goUp' };
    if (e.key === '>') binding = { game: 'goDown' };
    if (binding.game || binding.ui || e.key.length === 1) {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Backspace') e.preventDefault();
    }
    if (e.metaKey || e.ctrlKey) return;
    const repeat = e.repeat;
    if (repeat && !REPEATABLE.has(binding.game ?? binding.ui ?? '')) return;
    if (!repeat) this.keyHeld.add(e.code);
    this.dispatch({ ...binding, key: e.key, device: 'keyboard', repeat });
  }

  /** Continuous movement: actions currently held on any device */
  heldGameActions(): Set<GameAction> {
    const out = new Set<GameAction>();
    for (const code of this.keyHeld) {
      const g = KEYS[code]?.game;
      if (g) out.add(g);
    }
    for (const h of this.padHeld.values()) if (h.binding.game) out.add(h.binding.game);
    return out;
  }

  /** Poll gamepads; call once per frame */
  poll(dt: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const active = new Map<string, KeyBinding>();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      pad.buttons.forEach((b, i) => {
        if (b.pressed && PAD_BUTTONS[i]) active.set(`b${i}`, PAD_BUTTONS[i]);
      });
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      // Left stick: move relative to facing; dominant axis wins
      if (Math.abs(ly) > DEADZONE || Math.abs(lx) > DEADZONE) {
        if (Math.abs(ly) >= Math.abs(lx)) {
          active.set(ly < 0 ? 'ly-' : 'ly+', ly < 0 ? { game: 'moveForward', ui: 'up' } : { game: 'moveBack', ui: 'down' });
        } else {
          active.set(lx < 0 ? 'lx-' : 'lx+', lx < 0 ? { game: 'strafeLeft', ui: 'left' } : { game: 'strafeRight', ui: 'right' });
        }
      }
      // Right stick: turn in 45 degree steps
      if (Math.abs(rx) > DEADZONE && Math.abs(rx) > Math.abs(ry)) {
        active.set(rx < 0 ? 'rx-' : 'rx+', rx < 0 ? { game: 'turnLeft', ui: 'left' } : { game: 'turnRight', ui: 'right' });
      }
    }

    for (const [id, binding] of active) {
      const held = this.padHeld.get(id);
      if (!held) {
        this.setDevice('gamepad');
        this.padHeld.set(id, { binding, time: 0, next: REPEAT_DELAY });
        this.dispatch({ ...binding, device: 'gamepad', repeat: false });
      } else {
        held.time += dt;
        const name = binding.game ?? binding.ui ?? '';
        if (REPEATABLE.has(name) && held.time >= held.next) {
          held.next += REPEAT_RATE;
          this.dispatch({ ...binding, device: 'gamepad', repeat: true });
        }
      }
    }
    for (const id of [...this.padHeld.keys()]) if (!active.has(id)) this.padHeld.delete(id);
  }

  /** Light rumble on supported controllers */
  rumble(strength = 0.5, ms = 120): void {
    for (const pad of navigator.getGamepads?.() ?? []) {
      const act = (pad as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength / 2 }).catch(() => {});
    }
  }
}
