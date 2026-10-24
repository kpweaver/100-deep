/** A modal panel with a title, a navigable list and an optional detail pane */
import type { InputEvent } from '../input/actions.ts';
import { PROMPTS } from '../input/actions.ts';
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
    const p = PROMPTS[this.ctx.input.lastDevice];
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
export class TextInputLayer extends Layer {
  private input: HTMLInputElement;
  private menu: ListMenu<string> | null = null;

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
      h('div', { class: 'panel-text' }, this.input, this.menu ? h('div', { class: 'suggestions' }, this.menu.el) : null),
      h('div', { class: 'panel-footer' },
        h('span', {}, h('kbd', {}, 'Enter'), 'Accept'),
        h('span', {}, h('kbd', {}, 'Esc / B'), 'Cancel'))));
  }

  onOpen(): void {
    if (this.ctx.input.lastDevice === 'keyboard') setTimeout(() => this.input.focus(), 0);
  }

  onClose(): void {
    this.ctx.input.textCapture = false;
  }

  private finish(v: string | null) {
    this.close();
    this.done(v);
  }

  handleInput(ev: InputEvent): boolean {
    if (this.menu) {
      if (ev.ui === 'tertiary') {
        this.input.focus();
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
