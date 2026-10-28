/**
 * Controls screen: every bindable action with its key and controller
 * button, rebindable in place.  Choose a row, then press the new key or
 * button (hold a button to bind it as a hold).  Rebinding a key that is in
 * use swaps the two actions.
 */
import type { GameAction, InputEvent } from '../input/actions.ts';
import {
  BINDABLE, FIXED_BUTTONS, bindKey, bindPad, defaultBindings, keyLabel, keysFor, padLabel, presetKeys, unbind,
  type Bindings,
} from '../input/bindings.ts';
import type { RawInput } from '../input/input-manager.ts';
import type { UiContext } from './context.ts';
import { clear, h } from './dom.ts';
import { Layer } from './layer.ts';
import { ListMenu, type MenuItem } from './list-menu.ts';

type Tab = 'keyboard' | 'gamepad';
type Row = { kind: 'action'; action: GameAction; label: string } | { kind: 'preset' } | { kind: 'reset' } | { kind: 'heading' };

const LABELS = new Map(BINDABLE.map(([, a, l]) => [a, l]));

/** Keys and buttons that are not rebindable, shown under the list */
const FIXED: Record<Tab, string> = {
  keyboard: 'Fixed: arrows, Enter, Esc, Tab and PageUp/PageDown in menus; numpad 1–9 walks in map directions; letters pick items in menus.',
  gamepad: 'Fixed: left stick moves, right stick turns, B goes back, Start opens the menu; in menus A selects, LB/RB switch tabs, LT/RT page.',
};

export class ControlsLayer extends Layer {
  private tab: Tab;
  private b: Bindings;
  private tabs = h('div', { class: 'tabs' });
  private menu: ListMenu<Row>;
  private status = h('div', { class: 'controls-status' });
  private fixed = h('div', { class: 'controls-fixed' });
  private footer = h('div', { class: 'panel-footer' });
  private capturing: GameAction | null = null;

  constructor(private ctx: UiContext) {
    super('controls-layer');
    this.tab = ctx.input.lastDevice === 'gamepad' ? 'gamepad' : 'keyboard';
    this.b = structuredClone(ctx.input.getBindings());
    this.menu = new ListMenu<Row>({
      items: [],
      letters: false,
      onSelect: (i) => this.select(i.data),
      onCancel: () => this.close(),
      onSecondary: (i) => this.clearRow(i.data),
    });
    this.el.append(h('div', { class: 'panel wide controls-panel' },
      h('div', { class: 'panel-title' }, 'Controls', h('small', {}, 'Choose an action, then press its new key or button')),
      this.tabs,
      h('div', { class: 'panel-body' }, this.menu.el),
      this.status,
      this.fixed,
      this.footer));
    this.render();
  }

  onClose(): void {
    this.ctx.input.capture = null;
  }

  private rows(): MenuItem<Row>[] {
    const style = this.ctx.input.style;
    const items: MenuItem<Row>[] = [];
    if (this.tab === 'keyboard') {
      items.push({
        label: 'Keyboard layout',
        right: this.b.preset === 'wasd' ? 'WASD' : 'Angband',
        detail: this.b.preset === 'wasd'
          ? 'WASD moves, Q/E turn; Angband commands on those letters are in the menus'
          : "Angband's own keys; arrows walk and turn",
        data: { kind: 'preset' },
      });
    }
    items.push({ label: 'Reset to defaults', data: { kind: 'reset' } });
    let group = '';
    for (const [g, action, label] of BINDABLE) {
      if (g !== group) {
        group = g;
        items.push({ label: g, disabled: true, data: { kind: 'heading' } });
      }
      let right: string;
      if (this.tab === 'keyboard') right = keysFor(this.b, action).map(keyLabel).join('  ') || '—';
      else right = this.b.pad[action] ? padLabel(this.b.pad[action]!, style) : '—';
      if (this.capturing === action) right = this.tab === 'keyboard' ? 'Press a key…' : 'Press a button…';
      items.push({ label, right, data: { kind: 'action', action, label } });
    }
    return items;
  }

  private render(status?: string) {
    const p = this.ctx.input.prompts();
    clear(this.tabs);
    for (const t of ['keyboard', 'gamepad'] as const) {
      this.tabs.append(h('div', { class: `tab${t === this.tab ? ' active' : ''}` }, t === 'keyboard' ? 'Keyboard' : 'Controller'));
    }
    this.menu.setItems(this.rows());
    if (status !== undefined) this.status.textContent = status;
    this.fixed.textContent = FIXED[this.tab];
    clear(this.footer);
    if (this.capturing) {
      this.footer.append(h('span', {}, this.tab === 'keyboard'
        ? 'Press the new key · Esc cancels'
        : 'Press the new button (hold it to bind a hold) · B cancels'));
      return;
    }
    this.footer.append(
      h('span', {}, h('kbd', {}, p.confirm ?? 'Enter'), 'Rebind'),
      h('span', {}, h('kbd', {}, p.secondary ?? 'Shift+Enter'), 'Clear'),
      h('span', {}, h('kbd', {}, p.tabs ?? 'Tab'), 'Keyboard / controller'),
      h('span', {}, h('kbd', {}, p.back ?? 'Esc'), 'Done'));
  }

  private save(status: string) {
    this.ctx.saveBindings(structuredClone(this.b));
    this.render(status);
  }

  private select(r: Row) {
    if (r.kind === 'preset') {
      this.b.preset = this.b.preset === 'wasd' ? 'angband' : 'wasd';
      this.b.keys = presetKeys(this.b.preset);
      this.save(`Keyboard layout: ${this.b.preset === 'wasd' ? 'WASD' : 'Angband'}.`);
    } else if (r.kind === 'reset') {
      const d = defaultBindings(this.b.preset);
      if (this.tab === 'keyboard') this.b.keys = d.keys;
      else this.b.pad = d.pad;
      this.save(`${this.tab === 'keyboard' ? 'Keyboard' : 'Controller'} controls reset.`);
    } else if (r.kind === 'action') {
      this.capturing = r.action;
      this.ctx.input.capture = (raw) => this.captured(raw);
      this.render('');
    }
  }

  private clearRow(r: Row) {
    if (r.kind !== 'action') return;
    unbind(this.b, r.action, this.tab);
    this.save(`${r.label}: unbound.`);
  }

  private captured(raw: RawInput) {
    const action = this.capturing;
    if (!action) return;
    const device: Tab = raw.kind === 'key' ? 'keyboard' : 'gamepad';
    const cancel = raw.kind === 'key' ? raw.id === 'Escape' : raw.bind.button === 1;
    if (device !== this.tab && !cancel) return;
    this.capturing = null;
    this.ctx.input.capture = null;
    if (cancel) {
      this.render('');
      return;
    }
    let displaced: GameAction | null;
    let name: string;
    if (raw.kind === 'key') {
      if (raw.id === 'Escape') return;
      displaced = bindKey(this.b, action, raw.id);
      name = keyLabel(raw.id);
    } else {
      if (FIXED_BUTTONS.has(raw.bind.button)) {
        this.render('That button is reserved for going back and the menu.');
        return;
      }
      displaced = bindPad(this.b, action, raw.bind);
      name = padLabel(raw.bind, this.ctx.input.style);
    }
    const label = LABELS.get(action) ?? action;
    const swapped = displaced ? ` (swapped with ${LABELS.get(displaced) ?? displaced})` : '';
    this.save(`${label}: ${name}${swapped}.`);
  }

  handleInput(ev: InputEvent): boolean {
    if (this.capturing) return true;
    if (ev.ui === 'tabNext' || ev.ui === 'tabPrev') {
      this.tab = this.tab === 'keyboard' ? 'gamepad' : 'keyboard';
      this.menu.index = 0;
      this.render('');
      return true;
    }
    const cur = this.menu.items[this.menu.index]?.data;
    if ((ev.ui === 'left' || ev.ui === 'right') && cur?.kind === 'preset') {
      this.select(cur);
      return true;
    }
    if (ev.ui === 'menu') {
      this.close();
      return true;
    }
    // Letters are not shortcuts here, so a menu key can't rebind by accident
    this.menu.handleInput({ ...ev, key: undefined });
    return true;
  }
}
