/**
 * Action wheels: eight actions round a hub, held open on a controller
 * button (LT combat, LB gear by default).  Push either stick towards a
 * slice and let go of the button to do it; let go with the stick centred
 * to cancel.  A also picks the highlighted slice and B cancels.  The slices
 * never move, so the flick for each action becomes muscle memory; ones with
 * nothing to act on are dimmed but still work (the engine says why not).
 *
 * Opened from the keyboard (if bound) or the mouse, the wheel stays open:
 * arrows turn the highlight, 1-8 or a click pick, Enter confirms, Esc cancels.
 */
import type { CommandMessage, ItemAction } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import { padLabel } from '../input/bindings.ts';
import type { UiContext } from './context.ts';
import { clear, h } from './dom.ts';
import { Layer } from './layer.ts';

export interface WheelSlice {
  label: string;
  /** Count shown under the label (items it could use) */
  count?: number;
  disabled?: boolean;
  run: () => void;
}

/** Slices clockwise from the top: N, NE, E, SE, S, SW, W, NW */
export type Slices = [WheelSlice, WheelSlice, WheelSlice, WheelSlice, WheelSlice, WheelSlice, WheelSlice, WheelSlice];

const STICK = 0.5;

const SVG = 'http://www.w3.org/2000/svg';
/** Ring geometry in a 200x200 view box */
const R_OUT = 98, R_IN = 50, GAP = 1.6;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** An annular wedge centred on `deg` (0 = up, clockwise), `span` degrees wide */
function wedge(deg: number, span: number, rIn: number, rOut: number): string {
  const pt = (r: number, d: number) => {
    const a = (d * Math.PI) / 180;
    return `${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
  };
  const a0 = deg - span / 2, a1 = deg + span / 2;
  return `M ${pt(rOut, a0)} A ${rOut} ${rOut} 0 0 1 ${pt(rOut, a1)} L ${pt(rIn, a1)} A ${rIn} ${rIn} 0 0 0 ${pt(rIn, a0)} Z`;
}

export class WheelLayer extends Layer {
  private sel = -1;
  private segs: SVGPathElement[] = [];
  private labels: HTMLElement[] = [];
  private hub: HTMLElement;
  private pointer: SVGPathElement;
  private raf = 0;

  /** `button`: the controller button holding the wheel open, if any */
  constructor(private ctx: UiContext, private title: string, private slices: Slices, private button?: number) {
    super('wheel-layer');
    this.hub = h('div', { class: 'wheel-hub' });
    const ring = h('div', { class: 'wheel-ring' });
    const art = svg('svg', { viewBox: '0 0 200 200', class: 'wheel-art' });
    const defs = svg('defs', {});
    defs.innerHTML = `
      <radialGradient id="wheel-seg" cx="100" cy="100" r="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset="${R_IN / R_OUT}" stop-color="#17140f" stop-opacity="0.92"/>
        <stop offset="1" stop-color="#2a241a" stop-opacity="0.92"/>
      </radialGradient>
      <radialGradient id="wheel-sel" cx="100" cy="100" r="${R_OUT}" gradientUnits="userSpaceOnUse">
        <stop offset="${R_IN / R_OUT}" stop-color="#3b2f1e"/>
        <stop offset="1" stop-color="#8a6a32"/>
      </radialGradient>`;
    art.append(defs);
    slices.forEach((s, i) => {
      const seg = svg('path', { d: wedge(i * 45, 45 - GAP, R_IN, R_OUT), class: `wheel-seg${s.disabled ? ' dim' : ''}` });
      seg.addEventListener('mouseenter', () => this.highlight(i));
      seg.addEventListener('click', () => this.pick(i));
      this.segs.push(seg);
      art.append(seg);
      const a = (i * Math.PI) / 4, r = ((R_IN + R_OUT) / 2 / 200) * 100;
      const label = h('div', {
        class: `wheel-label${s.disabled ? ' dim' : ''}`,
        style: `left:${50 + r * Math.sin(a)}%;top:${50 - r * Math.cos(a)}%`,
      }, h('span', {}, s.label), s.count ? h('small', {}, `×${s.count}`) : null);
      this.labels.push(label);
      ring.append(label);
    });
    // The stick's direction, as a notch on the hub's rim
    art.append(svg('circle', { cx: 100, cy: 100, r: R_IN - 4, class: 'wheel-hub-rim' }));
    this.pointer = svg('path', { d: 'M 100 50 L 106 58 L 94 58 Z', class: 'wheel-pointer' });
    art.append(this.pointer);
    ring.prepend(art);
    ring.append(this.hub);
    this.el.append(ring);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.renderHub();
  }

  onOpen(): void {
    if (this.button !== undefined) this.raf = requestAnimationFrame(() => this.poll());
  }

  onClose(): void {
    cancelAnimationFrame(this.raf);
  }

  /** The highlighted slice, or -1 */
  get selected(): number {
    return this.sel;
  }

  private poll(): void {
    if (!this.isOpen) return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected && p.buttons[this.button!]?.pressed);
    if (!pad) {
      // The button was let go: do the highlighted slice, or nothing
      return this.sel >= 0 ? this.pick(this.sel) : this.close();
    }
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    // The right stick wins; the left works too (one-handed on the d-pad side)
    const [x, y] = Math.hypot(rx, ry) >= Math.hypot(lx, ly) ? [rx, ry] : [lx, ly];
    if (Math.hypot(x, y) > STICK) this.highlight(sliceAt(x, y));
    this.raf = requestAnimationFrame(() => this.poll());
  }

  private highlight(i: number): void {
    if (i === this.sel) return;
    this.segs[this.sel]?.classList.remove('sel');
    this.labels[this.sel]?.classList.remove('sel');
    this.sel = i;
    this.segs[i]?.classList.add('sel');
    this.labels[i]?.classList.add('sel');
    this.pointer.classList.toggle('on', i >= 0);
    this.pointer.setAttribute('transform', `rotate(${i * 45} 100 100)`);
    if (i >= 0) this.ctx.input.rumble(0.15, 30);
    this.renderHub();
  }

  private renderHub(): void {
    clear(this.hub);
    const s = this.slices[this.sel];
    const p = this.ctx.input.prompts();
    this.hub.append(
      h('div', { class: 'wheel-title' }, this.title),
      h('div', { class: 'wheel-pick' }, s ? s.label : this.button !== undefined ? 'Flick and release' : 'Choose'),
    );
    const release = this.button !== undefined ? padLabel({ button: this.button }, this.ctx.input.style) : null;
    this.hub.append(h('div', { class: 'wheel-keys' },
      release ? h('span', {}, 'Release ', h('kbd', {}, release)) : null,
      h('span', {}, h('kbd', {}, p.back ?? 'Esc'), 'Cancel')));
  }

  private pick(i: number): void {
    const s = this.slices[i];
    this.close();
    s?.run();
  }

  handleInput(ev: InputEvent): boolean {
    if (ev.ui === 'back' || ev.ui === 'menu' || ev.game === 'cancel') {
      this.close();
      return true;
    }
    if (ev.ui === 'confirm') {
      if (this.sel >= 0) this.pick(this.sel);
      return true;
    }
    // Sticks and the d-pad steer through polling while held; keys turn the highlight
    if (ev.device === 'keyboard') {
      if (ev.key && /^[1-8]$/.test(ev.key)) this.pick(Number(ev.key) - 1);
      else if (ev.ui === 'right' || ev.ui === 'down') this.highlight((this.sel + 1 + 8) % 8);
      else if (ev.ui === 'left' || ev.ui === 'up') this.highlight(((this.sel < 0 ? 0 : this.sel) + 7) % 8);
    }
    return true;
  }
}

/** Slice index (0 = up, clockwise) for a stick vector (y down) */
export function sliceAt(x: number, y: number): number {
  return ((Math.round(Math.atan2(x, -y) / (Math.PI / 4)) % 8) + 8) % 8;
}

/** How many carried items a command could use */
function countFor(ctx: UiContext, action: ItemAction, where: 'pack' | 'worn' | 'both' = 'pack'): number {
  const s = ctx.state;
  const pack = where === 'worn' ? [] : [...s.inventory, ...s.quiver];
  const worn = where === 'pack' ? [] : s.equipment.flatMap((e) => (e.item ? [e.item] : []));
  return [...pack, ...worn].filter((i) => i.actions.includes(action)).reduce((n, i) => n + (where === 'worn' ? 1 : i.number), 0);
}

function slice(ctx: UiContext, label: string, action: CommandMessage['action'], count?: number): WheelSlice {
  return {
    label,
    count,
    disabled: count === 0,
    run: () => ctx.send({ type: 'command', action } as CommandMessage),
  };
}

/** Hold LT: everything you use against monsters */
export function combatWheel(ctx: UiContext, button?: number): WheelLayer {
  const p = ctx.state.player;
  const cast = p?.canCast
    ? slice(ctx, p.spellNoun ? `Cast a ${p.spellNoun}` : 'Cast', 'cast')
    : { ...slice(ctx, 'Cast', 'cast'), disabled: true };
  return new WheelLayer(ctx, 'Combat', [
    cast,
    slice(ctx, 'Quaff', 'quaff', countFor(ctx, 'quaff')),
    slice(ctx, 'Aim wand', 'aim_wand', countFor(ctx, 'aim_wand')),
    slice(ctx, 'Zap rod', 'zap_rod', countFor(ctx, 'zap_rod')),
    slice(ctx, 'Use staff', 'use_staff', countFor(ctx, 'use_staff')),
    slice(ctx, 'Activate', 'activate', countFor(ctx, 'activate', 'both')),
    slice(ctx, 'Throw', 'throw'),
    slice(ctx, 'Read', 'read', countFor(ctx, 'read')),
  ], button);
}

export interface GearWheelExtras {
  inventory: () => void;
  equipment: () => void;
}

/** Hold LB: everything you do with your stuff */
export function gearWheel(ctx: UiContext, x: GearWheelExtras, button?: number): WheelLayer {
  const s = ctx.state;
  return new WheelLayer(ctx, 'Gear', [
    { label: 'Inventory', run: x.inventory },
    { label: 'Equipment', run: x.equipment },
    slice(ctx, 'Pick up', 'pickup', s.floor.reduce((n, i) => n + i.number, 0)),
    slice(ctx, 'Wear / wield', 'wield', countFor(ctx, 'wield')),
    slice(ctx, 'Eat', 'eat', countFor(ctx, 'eat')),
    slice(ctx, 'Refuel', 'refill', countFor(ctx, 'refill')),
    { ...slice(ctx, 'Inscribe', 'inscribe'), disabled: !s.inventory.length && !s.equipment.some((e) => e.item) },
    { ...slice(ctx, 'Drop', 'drop'), disabled: !s.inventory.length },
  ], button);
}
