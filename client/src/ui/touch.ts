/**
 * On-screen controls for phones and tablets, shown while touch is the
 * input device.  They press the same semantic actions as the keyboard and
 * controller, so the game never knows a finger did it.
 *
 *  - Left: a dungeon-crawler movement pad (turn / step / turn over
 *    strafe / back / strafe).  Held buttons repeat; holding forward runs.
 *  - Right: the contextual action (Descend, Attack, Open…; hold for every
 *    action here), with Advance (melee the nearest), Fire and Aim in a fight, or Explore, Rest
 *    and Look when it is quiet, plus Cast (for casters) and the Use and
 *    Gear wheels.
 *  - Top: full screen (where the browser allows it), the map, the
 *    command list and the menu.
 *  - Swiping across the view turns the way the finger moves (or the other
 *    way, as an option) or steps (up: forward, down: back).
 *
 * Menus need nothing extra: their rows take taps (a long press is the
 * secondary action), every layer gets a close button, and the key prompts
 * in footers and help bars press their keys when tapped (installPromptTaps).
 */
import type { GameAction, InputEvent } from '../input/actions.ts';
import { HOLD_TIME, REPEAT_DELAY, REPEAT_RATE, RUN_HOLD_TIME, type InputManager } from '../input/input-manager.ts';
import { h } from './dom.ts';

/** What the action buttons should offer right now (from App.updateHints) */
export interface TouchContext {
  /** The contextual action's name (Descend, Attack, Open door…), if any */
  primary: string | null;
  /** Monsters in view: Advance, Fire and Aim instead of Explore, Rest and Look */
  fight: boolean;
  ammo: boolean;
  exploring: boolean;
  /** The character can cast: a Cast button straight to the spell list */
  cast: boolean;
  /** A new spell can be learned: Study in place of Look */
  study: boolean;
}

interface ButtonSpec {
  label: string;
  tap: GameAction;
  /** Done instead of the tap after a long press */
  hold?: GameAction;
  /** Fires on press and again while held */
  repeat?: boolean;
  /** Holding this long switches to running (forward) */
  run?: boolean;
  cls?: string;
}

/** Swipes shorter than this (px) are taps */
const SWIPE = 36;

export class TouchControls {
  readonly el: HTMLElement;
  private primary: HTMLElement;
  private slots: HTMLElement[] = [];
  private actions: HTMLElement;
  private shown = true;

  constructor(private input: InputManager, view: HTMLElement, private invertSwipe: () => boolean = () => false) {
    const pad = h('div', { class: 'touch-pad' },
      this.button({ label: '↶', tap: 'turnLeft', repeat: true }),
      this.button({ label: '↑', tap: 'moveForward', repeat: true, run: true }),
      this.button({ label: '↷', tap: 'turnRight', repeat: true }),
      this.button({ label: '⇠', tap: 'strafeLeft', repeat: true }),
      this.button({ label: '↓', tap: 'moveBack', repeat: true }),
      this.button({ label: '⇢', tap: 'strafeRight', repeat: true }));
    this.primary = this.button({ label: 'Act', tap: 'interact', hold: 'contextMenu', cls: 'touch-primary' });
    // Three slots that change with the situation, then the two wheels
    for (let i = 0; i < 3; i++) this.slots.push(h('div', { class: 'touch-slot' }));
    const actions = this.actions = h('div', { class: 'touch-actions' },
      ...this.slots,
      this.button({ label: 'Cast', tap: 'spells', cls: 'touch-cast' }),
      this.button({ label: 'Use', tap: 'combatWheel', cls: 'touch-use' }),
      this.button({ label: 'Gear', tap: 'gearWheel', cls: 'touch-gear' }),
      this.primary);
    const top = h('div', { class: 'touch-top' },
      canFullscreen() ? h('button', { class: 'touch-btn small touch-full', type: 'button', onclick: () => void enterFullscreen() }, 'Full') : null,
      this.button({ label: 'Map', tap: 'map', cls: 'small' }),
      this.button({ label: '⋯', tap: 'commands', cls: 'small glyph' }),
      this.button({ label: '≡', tap: 'menu', cls: 'small glyph' }));
    this.el = h('div', { class: 'touch-ui' }, pad, actions, top);
    this.installSwipe(view);
    this.update({ primary: null, fight: false, ammo: false, exploring: false, cast: false, study: false });
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.el.classList.toggle('hidden', !v);
  }

  update(c: TouchContext): void {
    // "Attack Large white snake" fits as "Attack"; "Pick up 3 items" as "Pick up"
    const label = c.primary?.replace(/^(Attack|Pick up|Enter|Clear) .*/, '$1') ?? 'Act';
    this.primary.querySelector('span')!.textContent = label;
    this.primary.classList.toggle('idle', !c.primary);
    this.actions.classList.toggle('caster', c.cast);
    const specs: ButtonSpec[] = c.fight
      ? [{ label: 'Advance', tap: 'attack' }, { label: c.ammo ? 'Fire' : 'Throw', tap: c.ammo ? 'fire' : 'cmd:throw' }, { label: 'Aim', tap: 'aim' }]
      : [{ label: c.exploring ? 'Stop' : 'Explore', tap: 'explore', hold: 'travelDown' }, { label: 'Rest', tap: 'rest', hold: 'wait' }, c.study ? { label: 'Study', tap: 'study' } : { label: 'Look', tap: 'look' }];
    specs.forEach((s, i) => {
      const key = `${s.tap}|${s.label}`;
      if (this.slots[i].dataset.key === key) return;
      this.slots[i].dataset.key = key;
      this.slots[i].replaceChildren(this.button(s));
    });
  }

  private press(game: GameAction, repeat = false): void {
    if (!repeat) navigator.vibrate?.(8);
    const ev: Omit<InputEvent, 'device' | 'repeat'> = { game };
    this.input.press(ev, repeat);
  }

  /**
   * A button: repeating ones act on press and keep going while held; ones
   * with a hold action wait to see whether the finger stays down; the rest
   * act on release, and not if the finger slid off.
   */
  private button(spec: ButtonSpec): HTMLElement {
    const el = h('button', { class: `touch-btn ${spec.cls ?? ''}`, type: 'button' }, h('span', {}, spec.label));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let held = false;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      el.classList.remove('down');
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      held = false;
      if (spec.repeat) {
        this.press(spec.tap);
        const start = performance.now();
        const again = () => {
          if (spec.run && performance.now() - start >= RUN_HOLD_TIME * 1000) {
            // Holding forward runs once; the run continues in the engine
            held = true;
            this.press('runForward');
            return;
          }
          this.press(spec.tap, true);
          timer = setTimeout(again, REPEAT_RATE * 1000);
        };
        timer = setTimeout(again, (spec.run ? RUN_HOLD_TIME : REPEAT_DELAY) * 1000);
      } else if (spec.hold) {
        timer = setTimeout(() => {
          held = true;
          timer = null;
          this.press(spec.hold!);
        }, HOLD_TIME * 1000);
      }
    });
    el.addEventListener('pointerup', (e) => {
      const inside = document.elementFromPoint(e.clientX, e.clientY)?.closest('.touch-btn') === el;
      stop();
      if (!spec.repeat && !held && inside) this.press(spec.tap);
    });
    el.addEventListener('pointercancel', stop);
    // No click after the touch: it would land on whatever the press just
    // opened there (≡ sits where the menu's close button appears)
    el.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    // No long-press menu or text selection on the buttons
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  /** Swipe across the 3D view: sideways turns, up steps forward, down steps back */
  private installSwipe(view: HTMLElement): void {
    let start: { x: number; y: number; id: number } | null = null;
    view.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.shown) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    view.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
      // Turn the way the finger moves, as mobile 3D games look around;
      // inverted, dragging the world left turns you right (Street View)
      if (Math.abs(dx) > Math.abs(dy)) this.press((dx > 0) !== this.invertSwipe() ? 'turnRight' : 'turnLeft');
      else this.press(dy < 0 ? 'moveForward' : 'moveBack');
    });
    view.addEventListener('pointercancel', () => (start = null));
  }
}

/** iPhones have no fullscreen API, and an installed web app or native shell is full screen already */
function canFullscreen(): boolean {
  return !!document.fullscreenEnabled && !matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
}

/** Full screen, turned to landscape where the browser can lock it (Android) */
async function enterFullscreen(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* refused, or no orientation lock: playable as it is */
  }
}

/**
 * Tapping or clicking a key prompt (<kbd>) in a footer or help bar presses
 * that key, so every screen's listed actions are buttons on touch.  Only
 * while the prompts show keys: controller glyphs name buttons, not keys.
 */
export function installPromptTaps(root: HTMLElement, input: InputManager): void {
  root.addEventListener('click', (e) => {
    if (!input.keyboardLike) return;
    const target = e.target as HTMLElement;
    const hit = target.closest('.panel-footer > span, .aim-help > span, .wheel-keys > span');
    const kbd = hit?.querySelector('kbd');
    if (!kbd) return;
    const device = (e as PointerEvent).pointerType === 'touch' || input.lastDevice === 'touch' ? 'touch' : 'keyboard';
    if (input.pressLabel(kbd.dataset.label ?? kbd.textContent ?? '', device)) e.preventDefault();
  });
}
