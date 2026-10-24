/**
 * Keyboard/controller navigable list: up/down to move, confirm to choose,
 * back to cancel, letter keys as shortcuts (like Angband's a-z menus).
 */
import type { Tile } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import type { TileAtlas } from '../sprites/atlas.ts';
import { clear, h } from './dom.ts';

export interface MenuItem<T = unknown> {
  label: string;
  detail?: string;
  right?: string;
  tile?: Tile | null;
  disabled?: boolean;
  data: T;
}

export interface ListMenuOptions<T> {
  items: MenuItem<T>[];
  atlas?: TileAtlas | null;
  letters?: boolean;
  onSelect: (item: MenuItem<T>, index: number) => void;
  onCancel?: () => void;
  onFocus?: (item: MenuItem<T> | undefined, index: number) => void;
  /** Secondary action (X / Shift+Enter), e.g. examine */
  onSecondary?: (item: MenuItem<T>, index: number) => void;
  emptyText?: string;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export class ListMenu<T = unknown> {
  readonly el: HTMLElement;
  index = 0;
  private rows: HTMLElement[] = [];

  constructor(private opts: ListMenuOptions<T>) {
    this.el = h('div', { class: 'list-menu', role: 'listbox' });
    this.index = Math.max(0, opts.items.findIndex((i) => !i.disabled));
    this.render();
  }

  get items(): MenuItem<T>[] {
    return this.opts.items;
  }

  setItems(items: MenuItem<T>[]): void {
    this.opts.items = items;
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
    this.render();
  }

  private render(): void {
    clear(this.el);
    const { items, atlas, letters } = this.opts;
    if (!items.length) {
      this.el.append(h('div', { class: 'menu-empty' }, this.opts.emptyText ?? 'Nothing here.'));
      this.rows = [];
      this.opts.onFocus?.(undefined, -1);
      return;
    }
    this.rows = items.map((item, i) => {
      const icon = item.tile && atlas ? h('span', { class: 'tile-icon', style: atlas.css(item.tile, 32) }) : null;
      const row = h('div', {
        class: `menu-row${item.disabled ? ' disabled' : ''}`,
        role: 'option',
        onclick: () => {
          this.index = i;
          this.highlight();
          if (!item.disabled) this.opts.onSelect(item, i);
        },
        onmouseenter: () => {
          this.index = i;
          this.highlight();
        },
      },
      letters !== false && i < LETTERS.length ? h('span', { class: 'menu-letter' }, `${LETTERS[i]})`) : null,
      icon,
      h('span', { class: 'menu-label' }, item.label, item.detail ? h('small', {}, item.detail) : null),
      item.right ? h('span', { class: 'menu-right' }, item.right) : null);
      this.el.append(row);
      return row;
    });
    this.highlight();
  }

  private highlight(): void {
    this.rows.forEach((r, i) => r.classList.toggle('selected', i === this.index));
    this.rows[this.index]?.scrollIntoView({ block: 'nearest' });
    this.opts.onFocus?.(this.opts.items[this.index], this.index);
  }

  private move(delta: number): void {
    const n = this.opts.items.length;
    if (!n) return;
    this.index = (this.index + delta + n) % n;
    this.highlight();
  }

  handleInput(ev: InputEvent): boolean {
    const items = this.opts.items;
    switch (ev.ui) {
      case 'up': this.move(-1); return true;
      case 'down': this.move(1); return true;
      case 'pageUp': this.move(-Math.min(8, this.index || items.length)); return true;
      case 'pageDown': this.move(8); return true;
      case 'confirm': {
        const item = items[this.index];
        if (item && !item.disabled) this.opts.onSelect(item, this.index);
        return true;
      }
      case 'secondary': {
        const item = items[this.index];
        if (item && this.opts.onSecondary) this.opts.onSecondary(item, this.index);
        return true;
      }
      case 'back': this.opts.onCancel?.(); return true;
    }
    // Letter shortcuts, as in Angband's menus
    if (ev.key && ev.key.length === 1 && this.opts.letters !== false) {
      const i = LETTERS.indexOf(ev.key);
      if (i >= 0 && i < items.length) {
        this.index = i;
        this.highlight();
        if (!items[i].disabled) this.opts.onSelect(items[i], i);
        return true;
      }
    }
    return false;
  }
}
