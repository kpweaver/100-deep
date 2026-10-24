/**
 * Presents a native engine prompt (item, direction, target, spell, ...) and
 * returns the player's answer.  The engine produced the candidate list and
 * re-validates whatever comes back, so this is purely a selection UI.
 */
import { FACING_TO_DIR, type Direction, type ItemInfo, type PromptMessage, type SpellInfo } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import type { UiContext } from './context.ts';
import { clear, h } from './dom.ts';
import { Layer } from './layer.ts';
import { ListMenu, type MenuItem } from './list-menu.ts';
import { TextInputLayer } from './menu-layer.ts';

/** Relative grid cells (row, col) -> facing offset (0 = ahead, clockwise) */
const REL_GRID: (number | null)[][] = [
  [7, 0, 1],
  [6, null, 2],
  [5, 4, 3],
];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

type AnswerFn = (answer: Record<string, unknown> | null) => void;

export class PromptLayer extends Layer {
  private menu: ListMenu<unknown> | null = null;
  private body = h('div', { class: 'panel-body' });
  private detail = h('div', { class: 'menu-detail' });
  private dirCursor: [number, number] | null = null;
  private dirCells: HTMLElement[][] = [];
  private quantity = 1;
  private qtyEl: HTMLElement | null = null;
  private answered = false;

  constructor(private ctx: UiContext, readonly prompt: PromptMessage) {
    super('prompt-layer');
    const title = prompt.prompt.trim() || 'Choose';
    this.el.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, title),
      this.body,
      h('div', { class: 'panel-footer' },
        h('span', {}, h('kbd', {}, ctx.input.lastDevice === 'gamepad' ? 'A' : 'Enter'), 'Choose'),
        prompt.kind === 'item' ? h('span', {}, h('kbd', {}, ctx.input.lastDevice === 'gamepad' ? 'X' : 'Shift+Enter'), 'Examine') : null,
        h('span', {}, h('kbd', {}, ctx.input.lastDevice === 'gamepad' ? 'B' : 'Esc'), 'Cancel'))));
    this.build();
  }

  private answer: AnswerFn = (a) => {
    if (this.answered) return;
    this.answered = true;
    if (a) this.ctx.send({ type: 'answer', id: this.prompt.id, ...a } as never);
    else this.ctx.send({ type: 'cancel', id: this.prompt.id });
    this.close();
  };

  private list<T>(items: MenuItem<T>[], onSelect: (item: MenuItem<T>) => void,
    describe?: (item: MenuItem<T> | undefined) => string, onSecondary?: (item: MenuItem<T>) => void) {
    const menu = new ListMenu<T>({
      items,
      atlas: this.ctx.atlas(),
      onSelect,
      onCancel: () => this.answer(null),
      onSecondary,
      onFocus: describe ? (item) => {
        clear(this.detail);
        const d = describe(item);
        if (d) this.detail.append(h('pre', {}, d));
      } : undefined,
    });
    this.menu = menu as ListMenu<unknown>;
    this.body.append(menu.el);
    if (describe) {
      this.body.append(this.detail);
      menu.setItems(items);
    }
  }

  private build() {
    const p = this.prompt;
    switch (p.kind) {
      case 'confirm':
        this.list([
          { label: 'Yes', data: true },
          { label: 'No', data: false },
        ], (i) => this.answer({ value: i.data }));
        break;
      case 'item':
        this.list<ItemInfo>(p.items.map((it) => ({
          label: it.name, tile: it.tile, right: weight(it), data: it,
        })), (i) => this.answer({ value: i.data.handle }), undefined,
        (i) => this.ctx.send({ type: 'query', what: 'item', item: i.data.handle }));
        break;
      case 'spell':
        this.list<SpellInfo>(p.spells.map((sp) => ({
          label: sp.name,
          detail: sp.info,
          right: `L${sp.level} ${sp.mana}sp ${sp.fail}%`,
          disabled: !sp.allowed,
          data: sp,
        })), (i) => this.answer({ value: i.data.index, book: i.data.book }),
        (i) => i ? `${i.data.name}\nLevel ${i.data.level}, ${i.data.mana} mana, ${i.data.fail}% fail\n${i.data.info}\n\n${i.data.description}` : '');
        break;
      case 'aim': {
        const items: MenuItem<Record<string, unknown> | 'dir'>[] = [];
        if (p.hasTarget) items.push({ label: 'At current target', data: { useTarget: true } });
        for (const t of p.targets) {
          items.push({ label: t.name, right: `${t.distance} away`, data: { monster: t.id } });
        }
        items.push({ label: 'In a direction…', data: 'dir' });
        this.list(items, (i) => {
          if (i.data === 'dir') this.showDirections(false);
          else this.answer(i.data);
        });
        break;
      }
      case 'direction':
        this.showDirections(p.allowNone);
        break;
      case 'quantity':
        this.quantity = Math.min(p.max, Math.max(1, p.default));
        this.qtyEl = h('div', { class: 'quantity' });
        this.body.append(h('div', { class: 'quantity-box' },
          this.qtyEl,
          h('small', {}, `max ${p.max} · ←/→ ±1 · ↑/↓ ±10`)));
        this.renderQty();
        break;
      case 'curse':
        this.list(p.choices.map((c) => ({ label: c.name, right: `power ${c.power}`, data: c.value })),
          (i) => this.answer({ value: i.data }));
        break;
      case 'choice':
        this.list(p.choices.map((c) => ({ label: c.name, data: c.value })),
          (i) => this.answer({ value: i.data }));
        break;
      case 'string':
      case 'key':
        // Handled as a separate text layer once opened
        break;
    }
  }

  onOpen(): void {
    const p = this.prompt;
    if (p.kind === 'string' || p.kind === 'key') {
      const max = p.kind === 'string' ? p.maxLength : 1;
      const initial = p.kind === 'string' ? p.default : '';
      this.ctx.ui.open(new TextInputLayer(this.ctx, p.prompt, initial, max, (v) => {
        if (v === null || (p.kind === 'key' && !v)) this.answer(null);
        else this.answer({ value: v });
      }));
    }
  }

  private showDirections(allowNone: boolean) {
    clear(this.body);
    this.menu = null;
    const grid = h('div', { class: 'dir-grid' });
    this.dirCells = REL_GRID.map((row, r) => row.map((off, c) => {
      const label = off === null ? (allowNone ? '•' : '') : ARROWS[off];
      const cell = h('div', {
        class: `dir-cell${off === null && !allowNone ? ' disabled' : ''}`,
        onclick: () => {
          this.dirCursor = [r, c];
          this.pickDir();
        },
      }, label);
      grid.append(cell);
      return cell;
    }));
    this.dirCursor = [0, 1];
    this.body.append(h('div', { class: 'dir-wrap' }, grid, h('small', {}, 'Directions are relative to where you face')));
    this.renderDir();
  }

  private renderDir() {
    this.dirCells.forEach((row, r) => row.forEach((cell, c) =>
      cell.classList.toggle('selected', !!this.dirCursor && this.dirCursor[0] === r && this.dirCursor[1] === c)));
  }

  private pickDir() {
    if (!this.dirCursor) return;
    const off = REL_GRID[this.dirCursor[0]][this.dirCursor[1]];
    if (off === null) {
      if (this.prompt.kind === 'direction' && this.prompt.allowNone) this.answer({ value: 5 });
      return;
    }
    const dir: Direction = FACING_TO_DIR[(this.ctx.facing() + off) % 8];
    this.answer({ value: dir });
  }

  private renderQty() {
    if (this.qtyEl) this.qtyEl.textContent = String(this.quantity);
  }

  handleInput(ev: InputEvent): boolean {
    const p = this.prompt;
    if (ev.ui === 'menu') {
      this.answer(null);
      return true;
    }
    if (this.dirCursor) {
      // Absolute keypad digits work too, as in the stock game
      if (ev.key && /^[1-9]$/.test(ev.key)) {
        const d = Number(ev.key) as Direction;
        if (d !== 5 || (p.kind === 'direction' && p.allowNone)) this.answer({ value: d });
        return true;
      }
      const [r, c] = this.dirCursor;
      if (ev.ui === 'up') this.dirCursor = [Math.max(0, r - 1), c];
      else if (ev.ui === 'down') this.dirCursor = [Math.min(2, r + 1), c];
      else if (ev.ui === 'left') this.dirCursor = [r, Math.max(0, c - 1)];
      else if (ev.ui === 'right') this.dirCursor = [r, Math.min(2, c + 1)];
      else if (ev.ui === 'confirm') this.pickDir();
      else if (ev.ui === 'back') this.answer(null);
      this.renderDir();
      return true;
    }
    if (p.kind === 'quantity') {
      const max = p.max;
      if (ev.ui === 'left') this.quantity = Math.max(1, this.quantity - 1);
      else if (ev.ui === 'right') this.quantity = Math.min(max, this.quantity + 1);
      else if (ev.ui === 'up') this.quantity = Math.min(max, this.quantity + 10);
      else if (ev.ui === 'down') this.quantity = Math.max(1, this.quantity - 10);
      else if (ev.ui === 'pageUp') this.quantity = max;
      else if (ev.ui === 'confirm') this.answer({ value: this.quantity });
      else if (ev.ui === 'back') this.answer(null);
      else if (ev.key && /^[0-9]$/.test(ev.key)) {
        this.quantity = Math.min(max, Math.max(1, Number(`${this.quantity}${ev.key}`.slice(-4))));
      }
      this.renderQty();
      return true;
    }
    if (p.kind === 'confirm' && ev.key) {
      if (ev.key === 'y' || ev.key === 'Y') { this.answer({ value: true }); return true; }
      if (ev.key === 'n' || ev.key === 'N') { this.answer({ value: false }); return true; }
    }
    if (this.menu) {
      // Shift+Enter examines on keyboard
      if (ev.device === 'keyboard' && ev.key === 'Enter' && ev.ui === 'confirm' && (window.event as KeyboardEvent | undefined)?.shiftKey) {
        return this.menu.handleInput({ ...ev, ui: 'secondary' });
      }
      return this.menu.handleInput(ev) || true;
    }
    return true;
  }

  /** The engine moved on (new state); close without answering */
  dismiss(): void {
    this.answered = true;
    this.close();
  }
}

function weight(it: ItemInfo): string {
  const w = it.weight * it.number;
  return `${Math.floor(w / 10)}.${w % 10} lb`;
}
