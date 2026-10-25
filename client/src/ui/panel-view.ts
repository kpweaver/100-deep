/**
 * Renders a stock Angband subwindow (as captured by the engine) in a
 * monospace grid: coloured text runs in Angband's palette, with tile glyphs
 * drawn as Gervais icons occupying one character cell.
 */
import type { Panel, PanelSegment } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import type { TileAtlas } from '../sprites/atlas.ts';
import type { UiContext } from './context.ts';
import { clear, h, paletteColor } from './dom.ts';
import { Layer } from './layer.ts';

const isTile = (seg: PanelSegment): seg is [[number, number]] => Array.isArray(seg[0]);

export function renderPanel(
  el: HTMLElement,
  panel: Panel | null | undefined,
  palette: [number, number, number][] | undefined,
  atlas: TileAtlas | null,
  empty = '',
): void {
  clear(el);
  if (!panel || !panel.lines.length) {
    if (empty) el.append(h('div', { class: 'panel-empty' }, empty));
    return;
  }
  for (const line of panel.lines) {
    const row = h('div', { class: 'pv-line' });
    for (const seg of line) {
      if (isTile(seg)) {
        // Exactly one character cell, like a tile in a stock graphics
        // terminal, so columns (e.g. the character sheet's flag grid) align
        row.append(h('span', { class: 'pv-tile', style: atlas?.cssFit(seg[0]) ?? '' }));
      } else {
        const [text, color] = seg;
        row.append(h('span', { style: `color:${paletteColor(palette, color)}` }, text));
      }
    }
    if (!line.length) row.append(' ');
    el.append(row);
  }
}

/**
 * Full-screen popup for one or more panels (character sheet pages, the
 * monster/item lists, recall).  Left/right switches pages when there are
 * several; up/down scrolls.
 */
export class PanelLayer extends Layer {
  private body = h('div', { class: 'panel-text pv-body' });
  private titleEl = h('div', { class: 'panel-title' });
  private page = 0;

  constructor(
    private ctx: UiContext,
    private pages: { title: string; panel: () => Panel | null | undefined; empty?: string; gridAligned?: boolean }[],
    private onPage?: (page: number) => void,
  ) {
    super('panel-layer');
    const p = ctx.input.prompts();
    this.el.append(h('div', { class: 'panel wide' },
      this.titleEl,
      this.body,
      h('div', { class: 'panel-footer' },
        pages.length > 1 ? h('span', {}, h('kbd', {}, p.page ?? '←/→'), 'Page') : null,
        h('span', {}, h('kbd', {}, p.scroll ?? '↑/↓'), 'Scroll'),
        h('span', {}, h('kbd', {}, p.back ?? 'Esc'), 'Close'))));
    this.refresh();
  }

  setPage(page: number): void {
    this.page = (page + this.pages.length) % this.pages.length;
    this.onPage?.(this.page);
    this.refresh();
  }

  refresh(): void {
    const p = this.pages[this.page];
    clear(this.titleEl);
    this.titleEl.append(p.title, this.pages.length > 1 ? h('small', {}, `${this.page + 1} / ${this.pages.length}`) : '');
    // Grid-aligned pages (character sheet) keep tiles to one cell
    this.body.classList.toggle('pv-wide-tiles', !p.gridAligned);
    renderPanel(this.body, p.panel(), this.ctx.state.hello?.palette, this.ctx.atlas(), p.empty ?? 'Nothing to show.');
  }

  handleInput(ev: InputEvent): boolean {
    if (ev.ui === 'left' || ev.ui === 'tabPrev') this.setPage(this.page - 1);
    else if (ev.ui === 'right' || ev.ui === 'tabNext') this.setPage(this.page + 1);
    else if (ev.ui === 'down' || ev.ui === 'pageDown') this.body.scrollTop += ev.ui === 'down' ? 40 : 300;
    else if (ev.ui === 'up' || ev.ui === 'pageUp') this.body.scrollTop -= ev.ui === 'up' ? 40 : 300;
    else if (ev.ui === 'back' || ev.ui === 'menu' || ev.ui === 'confirm') this.close();
    return true;
  }
}
