/**
 * Keyboard + Gamepad API input, mapped to semantic actions and routed to
 * the topmost handler (UI layers first, then the game view).
 */
import { glyphStyleFromId, promptsFor, type Device, type GameAction, type GlyphStyle, type InputEvent, type InputHandler, type PromptKey, type UiAction } from './actions.ts';
import { BINDABLE, BTN, defaultBindings, keyIdFromEvent, keyLabel, keysFor, padLabel, padTable, type Bindings, type KeyId, type PadBind } from './bindings.ts';

interface KeyBinding { game?: GameAction; ui?: UiAction }

/**
 * Menu keys: fixed, separate from the rebindable game keys.  In menus,
 * letters are Angband-style item shortcuts (passed through as the raw key).
 */
const UI_KEYS: Record<KeyId, UiAction> = {
  ArrowUp: 'up', 'Shift+ArrowUp': 'up', Numpad8: 'up',
  ArrowDown: 'down', 'Shift+ArrowDown': 'down', Numpad2: 'down',
  ArrowLeft: 'left', 'Shift+ArrowLeft': 'left', Numpad4: 'left',
  ArrowRight: 'right', 'Shift+ArrowRight': 'right', Numpad6: 'right',
  Space: 'confirm', Enter: 'confirm', NumpadEnter: 'confirm', 'Shift+Enter': 'secondary',
  Escape: 'back', Backspace: 'back',
  Tab: 'tabNext', 'Shift+Tab': 'tabPrev',
  PageUp: 'pageUp', PageDown: 'pageDown',
};

/** Menu meaning of each controller button: fixed, whatever the game bindings */
const PAD_UI: Record<number, UiAction> = {
  [BTN.A]: 'confirm', [BTN.B]: 'back', [BTN.X]: 'secondary', [BTN.Y]: 'tertiary',
  [BTN.LB]: 'tabPrev', [BTN.RB]: 'tabNext', [BTN.LT]: 'pageUp', [BTN.RT]: 'pageDown',
  [BTN.SELECT]: 'back', [BTN.START]: 'menu',
  [BTN.UP]: 'up', [BTN.DOWN]: 'down', [BTN.LEFT]: 'left', [BTN.RIGHT]: 'right',
};
/** B cancels and Start opens the menu in play too; these are not rebindable */
const PAD_FIXED_GAME: Record<number, GameAction> = { [BTN.B]: 'cancel', [BTN.START]: 'menu' };

/** A button with a hold action fires its tap action on release, if released this soon */
const HOLD_TIME = 0.45;
/** Holding forward (stick or d-pad) this long starts a run */
const RUN_HOLD_TIME = 0.5;

/** What a rebinding screen receives while capturing */
export type RawInput = { kind: 'key'; id: KeyId } | { kind: 'pad'; bind: PadBind };

const DEADZONE = 0.45;
const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 0.12;
/** Actions that keep firing while held */
const REPEATABLE = new Set<string>([
  'moveForward', 'moveBack', 'strafeLeft', 'strafeRight', 'turnLeft', 'turnRight',
  'up', 'down', 'left', 'right', 'pageUp', 'pageDown',
]);

interface HeldState { binding: KeyBinding; time: number; next: number; button?: number; held?: boolean; ran?: boolean; tap?: GameAction; hold?: GameAction; captured?: boolean }

export class InputManager {
  private stack: InputHandler[] = [];
  private padHeld = new Map<string, HeldState>();
  /** Physical key code -> binding id, for keys held down (continuous movement) */
  private keyHeld = new Map<string, KeyId>();
  private bindings: Bindings = defaultBindings();
  private pad = padTable(this.bindings);
  /** While set, raw keys and buttons go here instead of the game (rebinding) */
  capture: ((raw: RawInput) => void) | null = null;
  lastDevice: Device = 'keyboard';
  /** Detected controller family, for button prompts */
  padStyle: GlyphStyle = 'xbox';
  /** User override from Options ('auto' = detect) */
  glyphOverride: GlyphStyle | 'auto' = 'auto';
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

  get style(): GlyphStyle {
    return this.glyphOverride === 'auto' ? this.padStyle : this.glyphOverride;
  }

  getBindings(): Bindings {
    return this.bindings;
  }

  setBindings(b: Bindings): void {
    this.bindings = b;
    this.pad = padTable(b);
    this.onDeviceChange?.(this.lastDevice);
  }

  /** Label for the key or button bound to an action, if any */
  labelFor(action: GameAction, device: Device = this.lastDevice): string | undefined {
    if (device === 'gamepad') {
      const p = this.bindings.pad[action];
      return p ? padLabel(p, this.style) : undefined;
    }
    const k = keysFor(this.bindings, action)[0];
    return k ? keyLabel(k) : undefined;
  }

  /** Button-prompt labels for the current device and controller family, following the bindings */
  prompts(): Partial<Record<PromptKey, string>> {
    const out: Record<string, string> = { ...promptsFor(this.lastDevice, this.style) };
    for (const [, action] of BINDABLE) {
      const l = this.labelFor(action);
      if (l) out[action] = l;
      else delete out[action];
    }
    return out;
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
    if (e.metaKey || (e.ctrlKey && e.key.length !== 1)) return;
    const id = keyIdFromEvent(e);
    if (this.capture) {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || e.repeat) return;
      e.preventDefault();
      this.capture({ kind: 'key', id });
      return;
    }
    const binding: KeyBinding = { game: this.bindings.keys[id], ui: UI_KEYS[id] };
    if (e.ctrlKey && !binding.game) return;
    // Bound keys never reach the browser (Tab focus, Space scroll, ' and / quick find, Ctrl+S...)
    if (binding.game || binding.ui) e.preventDefault();
    const repeat = e.repeat;
    if (repeat && !REPEATABLE.has(binding.game ?? binding.ui ?? '')) return;
    if (!repeat) this.keyHeld.set(e.code, id);
    this.dispatch({ ...binding, key: e.key, device: 'keyboard', repeat });
  }

  /** Continuous movement: actions currently held on any device */
  heldGameActions(): Set<GameAction> {
    const out = new Set<GameAction>();
    for (const id of this.keyHeld.values()) {
      const g = this.bindings.keys[id];
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
      const before = active.size;
      pad.buttons.forEach((b, i) => {
        if (!b.pressed) return;
        const t = this.pad.get(i);
        const fixed = PAD_FIXED_GAME[i];
        // A button with a hold action decides its game action on release or hold
        active.set(`b${i}`, { game: fixed ?? (t?.hold ? undefined : t?.tap), ui: PAD_UI[i] });
      });
      if (active.size > before) this.notePad(pad);
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
      const button = id.startsWith('b') ? Number(id.slice(1)) : undefined;
      if (!held) {
        this.setDevice('gamepad');
        const t = button !== undefined && !PAD_FIXED_GAME[button] ? this.pad.get(button) : undefined;
        this.padHeld.set(id, { binding, time: 0, next: REPEAT_DELAY, button, tap: t?.hold ? t.tap : undefined, hold: t?.hold, captured: !!this.capture });
        if (!this.capture) this.dispatch({ ...binding, device: 'gamepad', repeat: false });
      } else {
        held.time += dt;
        if (this.capture) continue;
        if (held.hold && !held.held && held.time >= HOLD_TIME) {
          held.held = true;
          this.dispatch({ game: held.hold, device: 'gamepad', repeat: false });
        }
        const name = binding.game ?? binding.ui ?? '';
        // Holding forward runs (once); the run then continues in the engine
        if (name === 'moveForward' && !held.ran && held.time >= RUN_HOLD_TIME) {
          held.ran = true;
          this.dispatch({ game: 'runForward', device: 'gamepad', repeat: false });
        }
        if (REPEATABLE.has(name) && !held.ran && held.time >= held.next) {
          held.next += REPEAT_RATE;
          this.dispatch({ ...binding, device: 'gamepad', repeat: true });
        }
      }
    }
    for (const [id, held] of [...this.padHeld]) {
      if (active.has(id)) continue;
      this.padHeld.delete(id);
      if (this.capture) {
        // Only presses that began while capturing (not the A that opened it)
        if (held.button !== undefined && held.captured) this.capture({ kind: 'pad', bind: { button: held.button, hold: held.time >= HOLD_TIME } });
        continue;
      }
      // A short press of a tap/hold button does its tap action on release
      if (held.hold && !held.held && held.tap) this.dispatch({ game: held.tap, device: 'gamepad', repeat: false });
    }
  }

  private notePad(pad: Gamepad) {
    const style = glyphStyleFromId(pad.id);
    if (style !== this.padStyle) {
      this.padStyle = style;
      this.onDeviceChange?.(this.lastDevice);
    }
  }

  /** Light rumble on supported controllers */
  rumble(strength = 0.5, ms = 120): void {
    for (const pad of navigator.getGamepads?.() ?? []) {
      const act = (pad as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength / 2 }).catch(() => {});
    }
  }
}
