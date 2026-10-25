/**
 * Modal UI layers.  Each open layer sits on the input stack; the topmost
 * receives all input.  Only the topmost layer is drawn: layers beneath it
 * are hidden until it closes, so menus never pile up on screen.
 */
import type { InputEvent, InputHandler } from '../input/actions.ts';
import type { InputManager } from '../input/input-manager.ts';
import { h } from './dom.ts';

export abstract class Layer implements InputHandler {
  readonly el: HTMLElement;
  private manager: UiManager | null = null;

  constructor(className: string) {
    this.el = h('div', { class: `layer ${className}` });
  }

  abstract handleInput(ev: InputEvent): boolean;

  /** Called after the layer is attached */
  onOpen(): void {}
  onClose(): void {}

  get isOpen(): boolean {
    return this.manager !== null;
  }

  attach(m: UiManager | null): void {
    this.manager = m;
  }

  close(): void {
    this.manager?.close(this);
  }
}

export class UiManager {
  private layers: Layer[] = [];

  constructor(private root: HTMLElement, private input: InputManager) {}

  open(layer: Layer): void {
    if (this.layers.includes(layer)) return;
    this.top?.el.classList.add('covered');
    this.layers.push(layer);
    layer.attach(this);
    this.root.append(layer.el);
    this.input.push(layer);
    layer.onOpen();
  }

  close(layer: Layer): void {
    const i = this.layers.indexOf(layer);
    if (i < 0) return;
    this.layers.splice(i, 1);
    layer.el.remove();
    layer.el.classList.remove('covered');
    this.input.remove(layer);
    layer.attach(null);
    this.top?.el.classList.remove('covered');
    layer.onClose();
  }

  closeAll(predicate: (l: Layer) => boolean = () => true): void {
    for (const l of [...this.layers].reverse()) if (predicate(l)) this.close(l);
  }

  get top(): Layer | undefined {
    return this.layers[this.layers.length - 1];
  }

  has(predicate: (l: Layer) => boolean): boolean {
    return this.layers.some(predicate);
  }
}
