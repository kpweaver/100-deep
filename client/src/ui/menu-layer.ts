/** A modal panel with a title, a navigable list and an optional detail pane */
import type { InputEvent } from '../input/actions.ts';
import type { UiContext } from './context.ts';
import { add, clear, h } from './dom.ts';
import { Layer } from './layer.ts';
import { ListMenu, type MenuItem } from './list-menu.ts';

export interface MenuLayerOptions<T> {
  title: string;
  subtitle?: string;
  items: MenuItem<T>[];
  onSelect: (item: MenuItem<T>, layer: MenuLayer<T>) => void;
  onCancel?: (layer: MenuLayer<T>) => void;
  onSecondary?: (item: MenuItem<T>, layer: MenuLayer<T>) => void;
  secondaryLabel?: string;
  describe?: (item: MenuItem<T> | undefined) => string | HTMLElement | null;
  letters?: boolean;
  className?: string;
  emptyText?: string;
}

export class MenuLayer<T = unknown> extends Layer {
  readonly menu: ListMenu<T>;
  private detail = h('div', { class: 'menu-detail' });
  private footer = h('div', { class: 'panel-footer' });

  constructor(protected ctx: UiContext, protected opts: MenuLayerOptions<T>) {
    super(`menu-layer ${opts.className ?? ''}`);
    this.menu = new ListMenu<T>({
      items: opts.items,
      atlas: ctx.atlas(),
      letters: opts.letters,
      emptyText: opts.emptyText,
      onSelect: (item) => opts.onSelect(item, this),
      onCancel: () => (opts.onCancel ? opts.onCancel(this) : this.close()),
      onSecondary: opts.onSecondary ? (item) => opts.onSecondary!(item, this) : undefined,
      onFocus: (item) => this.showDetail(item),
    });
    const panel = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, opts.title, opts.subtitle ? h('small', {}, opts.subtitle) : null),
      h('div', { class: 'panel-body' }, this.menu.el, opts.describe ? this.detail : null),
      this.footer);
    this.el.append(panel);
    this.renderFooter();
    this.showDetail(opts.items[this.menu.index]);
  }

  setItems(items: MenuItem<T>[]): void {
    this.menu.setItems(items);
  }

  private showDetail(item: MenuItem<T> | undefined) {
    if (!this.opts.describe) return;
    clear(this.detail);
    const d = this.opts.describe(item);
    if (typeof d === 'string') this.detail.append(h('pre', {}, d));
    else if (d) this.detail.append(d);
  }

  renderFooter(): void {
    const p = this.ctx.input.prompts();
    clear(this.footer);
    add(this.footer, 
      h('span', {}, h('kbd', {}, p.confirm ?? 'Enter'), 'Select'),
      this.opts.onSecondary ? h('span', {}, h('kbd', {}, p.secondary ?? 'X'), this.opts.secondaryLabel ?? 'More') : null,
      h('span', {}, h('kbd', {}, p.back ?? 'Esc'), 'Back'),
    );
  }

  handleInput(ev: InputEvent): boolean {
    if (ev.ui === 'menu') {
      this.opts.onCancel ? this.opts.onCancel(this) : this.close();
      return true;
    }
    this.menu.handleInput(ev);
    return true;
  }
}

/** A simple modal text panel (item/monster recall, help) */
export class TextLayer extends Layer {
  private body: HTMLElement;
  constructor(title: string, text: string | HTMLElement, private onDone?: () => void) {
    super('text-layer');
    this.body = h('div', { class: 'panel-text' }, typeof text === 'string' ? h('pre', {}, text) : text);
    this.el.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, title),
      this.body,
      h('div', { class: 'panel-footer' }, h('span', {}, h('kbd', {}, 'Esc / B'), 'Close'))));
  }

  handleInput(ev: InputEvent): boolean {
    if (ev.ui === 'back' || ev.ui === 'confirm' || ev.ui === 'menu') {
      this.close();
      this.onDone?.();
    } else if (ev.ui === 'down' || ev.ui === 'pageDown') {
      this.body.scrollTop += ev.ui === 'down' ? 40 : 300;
    } else if (ev.ui === 'up' || ev.ui === 'pageUp') {
      this.body.scrollTop -= ev.ui === 'up' ? 40 : 300;
    }
    return true;
  }
}

/**
 * Text entry usable with keyboard (type) or controller (pick from
 * suggestions, which the caller provides).
 */
/** On-screen keyboard rows (controller text entry); special keys are named */
const OSK_ROWS = [
  'abcdefghij'.split(''),
  'klmnopqrst'.split(''),
  'uvwxyz@!=#'.split(''),
  '1234567890'.split(''),
  ['Shift', 'Space', 'Del', 'Done'],
];

export class TextInputLayer extends Layer {
  private input: HTMLInputElement;
  private menu: ListMenu<string> | null = null;
  /** On-screen keyboard, for controllers (A types, X deletes, Y shift, Start done) */
  private osk = h('div', { class: 'osk hidden' });
  private oskOn = false;
  private oskRow = 0;
  private oskCol = 0;
  private shift = false;

  constructor(private ctx: UiContext, title: string, initial: string, maxLength: number,
    private done: (value: string | null) => void, suggestions: string[] = []) {
    super('text-input-layer');
    this.input = h('input', { type: 'text', maxlength: maxLength, value: initial, spellcheck: 'false' });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.finish(this.input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finish(null); }
      e.stopPropagation();
    });
    this.input.addEventListener('focus', () => (ctx.input.textCapture = true));
    this.input.addEventListener('blur', () => (ctx.input.textCapture = false));
    if (suggestions.length) {
      this.menu = new ListMenu<string>({
        items: suggestions.map((s) => ({ label: s, data: s })),
        letters: false,
        onSelect: (item) => {
          this.input.value = item.data;
          this.finish(item.data);
        },
        onCancel: () => this.finish(null),
      });
    }
    this.el.append(h('div', { class: 'panel narrow' },
      h('div', { class: 'panel-title' }, title),
      h('div', { class: 'panel-text' }, this.input, this.menu ? h('div', { class: 'suggestions' }, this.menu.el) : null, this.osk),
      h('div', { class: 'panel-footer' },
        h('span', {}, h('kbd', {}, 'Enter'), 'Accept'),
        h('span', {}, h('kbd', {}, 'Esc / B'), 'Cancel'))));
  }

  onOpen(): void {
    // Selected, so typing replaces the suggested name instead of adding to it
    if (this.ctx.input.keyboardLike) setTimeout(() => { this.input.focus(); this.input.select(); }, 0);
    // With a controller and nothing to pick from, type on the on-screen keyboard
    else if (!this.menu) this.showOsk(true);
  }

  private showOsk(on: boolean) {
    this.oskOn = on;
    this.osk.classList.toggle('hidden', !on);
    this.menu?.el.parentElement?.classList.toggle('hidden', on);
    this.renderOsk();
  }

  private renderOsk() {
    if (!this.oskOn) return;
    this.osk.replaceChildren(...OSK_ROWS.map((row, r) => h('div', { class: 'osk-row' },
      ...row.map((k, c) => h('span', {
        class: `osk-key${k.length > 1 ? ' wide' : ''}${r === this.oskRow && c === this.oskCol ? ' selected' : ''}${k === 'Shift' && this.shift ? ' on' : ''}`,
        onclick: () => { this.oskRow = r; this.oskCol = c; this.press(); },
      }, k.length > 1 ? k : this.shift ? k.toUpperCase() : k)))),
      h('div', { class: 'osk-help' }, 'A type · X delete · Y shift · Start done · B cancel'));
  }

  private type(s: string) {
    const max = this.input.maxLength > 0 ? this.input.maxLength : 1e9;
    if (this.input.value.length < max) this.input.value += s;
  }

  private press() {
    const k = OSK_ROWS[this.oskRow][this.oskCol];
    if (k === 'Shift') this.shift = !this.shift;
    else if (k === 'Space') this.type(' ');
    else if (k === 'Del') this.input.value = this.input.value.slice(0, -1);
    else if (k === 'Done') return this.finish(this.input.value);
    else this.type(this.shift ? k.toUpperCase() : k);
    this.renderOsk();
  }

  private oskInput(ev: InputEvent): boolean {
    const rows = OSK_ROWS.length;
    if (ev.ui === 'up' || ev.ui === 'down') {
      this.oskRow = (this.oskRow + (ev.ui === 'up' ? -1 : 1) + rows) % rows;
      this.oskCol = Math.min(this.oskCol, OSK_ROWS[this.oskRow].length - 1);
    } else if (ev.ui === 'left' || ev.ui === 'right') {
      const n = OSK_ROWS[this.oskRow].length;
      this.oskCol = (this.oskCol + (ev.ui === 'left' ? -1 : 1) + n) % n;
    } else if (ev.ui === 'confirm') return this.press(), true;
    else if (ev.ui === 'secondary') this.input.value = this.input.value.slice(0, -1);
    else if (ev.ui === 'tertiary') this.shift = !this.shift;
    else if (ev.ui === 'menu') { this.finish(this.input.value); return true; }
    else if (ev.ui === 'back') {
      if (this.menu) this.showOsk(false);
      else this.finish(null);
      return true;
    }
    this.renderOsk();
    return true;
  }

  onClose(): void {
    this.ctx.input.textCapture = false;
  }

  private finish(v: string | null) {
    this.close();
    this.done(v);
  }

  handleInput(ev: InputEvent): boolean {
    if (this.oskOn) return this.oskInput(ev);
    if (this.menu) {
      if (ev.ui === 'tertiary') {
        // Type your own: keyboard players get the text box, controllers the on-screen keyboard
        if (ev.device === 'gamepad') this.showOsk(true);
        else this.input.focus();
        return true;
      }
      this.menu.handleInput(ev);
      return true;
    }
    if (ev.ui === 'confirm') this.finish(this.input.value);
    else if (ev.ui === 'back') this.finish(null);
    return true;
  }
}
