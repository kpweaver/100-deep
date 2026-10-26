/**
 * Aim (RB / T) and Examine (L3 / L): light modes over the game view.
 *
 * Aim picks the closest monster with the engine's own targeting, cycles
 * targets with RB/LB (or left/right), and fires the first missile in the
 * quiver at the target with A (or throws, without a launcher).
 *
 * Examine steps through the visible monsters and objects, nearest first,
 * turning to face each; A shows a monster's recall.  Neither mode takes a
 * game turn until you fire.
 */
import type { MonsterInfo, ObjectPile } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import type { UiContext } from './context.ts';
import { h } from './dom.ts';
import { Layer } from './layer.ts';

export interface TargetingHooks {
  /** Turn the camera toward a map position */
  face(x: number, y: number): void;
  /** Show the recall panel for the tracked monster */
  recall(): void;
}

function bar(title: string) {
  const name = h('div', { class: 'aim-name' });
  const help = h('div', { class: 'aim-help' });
  return { el: h('div', { class: 'aim-bar' }, h('div', { class: 'aim-title' }, title), name, help), name, help };
}

export class AimLayer extends Layer {
  private bar = bar('Aim');
  private off: (() => void) | null = null;

  constructor(private ctx: UiContext, private hooks: TargetingHooks) {
    super('aim-layer');
    this.el.append(this.bar.el);
  }

  onOpen(): void {
    this.ctx.send({ type: 'command', action: 'target_closest' });
    this.off = this.ctx.state.subscribe(() => this.refresh());
    this.refresh();
  }

  onClose(): void {
    this.off?.();
  }

  private target(): MonsterInfo | undefined {
    const t = this.ctx.state.target;
    return t?.monster !== undefined ? this.ctx.state.monsters.find((m) => m.id === t.monster) : undefined;
  }

  private refresh() {
    const s = this.ctx.state;
    const pr = this.ctx.input.prompts();
    const m = this.target();
    const visible = s.monsters.some((mm) => mm.inView);
    this.bar.name.textContent = m ? `${m.name}${m.asleep ? ' (asleep)' : ''}` : visible ? 'Choosing a target…' : 'Nothing to aim at';
    const canFire = s.equipment.some((e) => e.slot === 'shooting' && e.item) && s.quiver.length > 0;
    this.bar.help.replaceChildren(
      h('span', {}, h('kbd', {}, pr.confirm ?? 'A'), canFire ? `Fire ${s.quiver[0].name}` : 'Throw'),
      h('span', {}, h('kbd', {}, pr.tabs ?? 'LB/RB'), 'Next target'),
      h('span', {}, h('kbd', {}, pr.back ?? 'B'), 'Cancel'));
    if (m) this.hooks.face(m.x, m.y);
  }

  private cycle(step: 1 | -1) {
    this.ctx.send({ type: 'command', action: step > 0 ? 'target_next' : 'target_prev' });
  }

  private fire() {
    const s = this.ctx.state;
    if (!this.target()) return;
    const launcher = s.equipment.some((e) => e.slot === 'shooting' && e.item);
    this.close();
    if (launcher && s.quiver.length) {
      this.ctx.send({ type: 'command', action: 'fire', item: s.quiver[0].handle, useTarget: true });
    } else {
      // Choose what to throw; the engine's prompt asks for the item
      this.ctx.send({ type: 'command', action: 'throw', useTarget: true });
    }
  }

  handleInput(ev: InputEvent): boolean {
    if (ev.ui === 'tabNext' || ev.ui === 'right' || ev.ui === 'down' || ev.game === 'aim') this.cycle(1);
    else if (ev.ui === 'tabPrev' || ev.ui === 'left' || ev.ui === 'up') this.cycle(-1);
    else if (ev.ui === 'confirm' || ev.game === 'attack') this.fire();
    else if (ev.ui === 'back' || ev.ui === 'menu') this.close();
    return true;
  }
}

type Thing = { kind: 'monster'; m: MonsterInfo; d: number } | { kind: 'object'; o: ObjectPile; d: number };

export class LookLayer extends Layer {
  private bar = bar('Examine');
  private things: Thing[] = [];
  private index = 0;

  constructor(private ctx: UiContext, private hooks: TargetingHooks) {
    super('aim-layer');
    this.el.append(this.bar.el);
  }

  onOpen(): void {
    const s = this.ctx.state;
    const p = s.player;
    if (!p) return;
    const dist = (x: number, y: number) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
    this.things = [
      ...s.monsters.filter((m) => m.inView).map((m) => ({ kind: 'monster' as const, m, d: dist(m.x, m.y) })),
      ...s.objects.filter((o) => o.seen).map((o) => ({ kind: 'object' as const, o, d: dist(o.x, o.y) })),
    ].sort((a, b) => a.d - b.d);
    this.show();
  }

  private show() {
    const pr = this.ctx.input.prompts();
    const t = this.things[this.index];
    if (!t) {
      this.bar.name.textContent = 'Nothing interesting in view';
      this.bar.help.replaceChildren(h('span', {}, h('kbd', {}, pr.back ?? 'B'), 'Close'));
      return;
    }
    const where = t.d === 0 ? 'here' : `${t.d} away`;
    this.bar.name.textContent = t.kind === 'monster'
      ? `${t.m.name}${t.m.asleep ? ' (asleep)' : ''} · ${where}`
      : `${t.o.name} · ${where}`;
    const n = `${this.index + 1}/${this.things.length}`;
    this.bar.help.replaceChildren(
      ...(t.kind === 'monster' ? [h('span', {}, h('kbd', {}, pr.confirm ?? 'A'), 'Recall')] : []),
      h('span', {}, h('kbd', {}, pr.tabs ?? 'LB/RB'), `Next (${n})`),
      h('span', {}, h('kbd', {}, pr.back ?? 'B'), 'Close'));
    const x = t.kind === 'monster' ? t.m.x : t.o.x;
    const y = t.kind === 'monster' ? t.m.y : t.o.y;
    if (t.d > 0) this.hooks.face(x, y);
  }

  private step(d: number) {
    if (!this.things.length) return;
    this.index = (this.index + d + this.things.length) % this.things.length;
    this.show();
  }

  handleInput(ev: InputEvent): boolean {
    const t = this.things[this.index];
    if (ev.ui === 'tabNext' || ev.ui === 'right' || ev.ui === 'down' || ev.game === 'look') this.step(1);
    else if (ev.ui === 'tabPrev' || ev.ui === 'left' || ev.ui === 'up') this.step(-1);
    else if (ev.ui === 'confirm' && t?.kind === 'monster') {
      // Track the monster (as looking does in Angband), then show its recall
      this.ctx.send({ type: 'command', action: 'target_monster', monster: t.m.id });
      this.hooks.recall();
    } else if (ev.ui === 'back' || ev.ui === 'menu') this.close();
    return true;
  }
}
