/**
 * Look (l / L3) and Aim (* / RB): a cursor over the 3D view, like
 * Angband's look and targeting modes.
 *
 * The cursor starts on the nearest interesting thing.  Next/previous
 * (Space, +/-, Tab, LB/RB) step through interesting things nearest first;
 * arrows, the d-pad or the stick move the cursor freely one grid at a time
 * relative to the view, and the numpad moves it in map directions.
 *
 * Look describes the grid; on a monster, Enter/A (or r) shows its recall,
 * and g (or Y) travels to the grid.  Aim fires the first missile in the
 * quiver at the grid (or throws, without a launcher) with Enter/A/t, or
 * just sets the target with Shift+Enter/X, for spells and wands.  Neither
 * mode takes a game turn until you fire or travel.
 */
import { DIR_OFFSETS, FACING_TO_DIR, type Direction } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import type { GameState } from '../state/game-state.ts';
import type { UiContext } from './context.ts';
import { h } from './dom.ts';
import { Layer } from './layer.ts';

export interface TargetingHooks {
  /** Turn the camera toward a map position */
  face(x: number, y: number): void;
  /** Show the recall panel for the tracked monster */
  recall(): void;
  /** Show the 3D cursor on a grid, or hide it */
  cursor(at: { x: number; y: number } | null): void;
}

/** What the player knows is at a grid, from their knowledge only */
export function describeGrid(s: GameState, x: number, y: number): string {
  const f = s.map.featAt(x, y);
  if (!f) return 'Unknown grid';
  const parts: string[] = [];
  const mon = s.monsterAt(x, y);
  const obj = s.objectAt(x, y);
  if (s.player && s.player.x === x && s.player.y === y) parts.push('You');
  if (mon) parts.push(`${mon.name}${mon.status ? ` (${mon.status})` : ''}`);
  if (obj) parts.push(obj.name || 'an object');
  parts.push(s.features[f]?.name ?? '');
  return parts.filter(Boolean).join(' · ');
}

interface Spot { x: number; y: number; d: number }

abstract class CursorLayer extends Layer {
  protected x = 0;
  protected y = 0;
  protected spots: Spot[] = [];
  protected index = -1;
  private title = h('div', { class: 'aim-title' });
  protected name = h('div', { class: 'aim-name' });
  protected help = h('div', { class: 'aim-help' });

  constructor(protected ctx: UiContext, protected hooks: TargetingHooks, title: string) {
    super('aim-layer');
    this.title.textContent = title;
    this.el.append(h('div', { class: 'aim-bar' }, this.title, this.name, this.help));
  }

  /** Interesting grids for this mode */
  protected abstract findSpots(): { x: number; y: number }[];
  protected abstract renderHelp(): void;
  protected abstract act(ev: InputEvent): boolean;

  protected dist(x: number, y: number): number {
    const p = this.ctx.state.player;
    return p ? Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) : 0;
  }

  onOpen(): void {
    const p = this.ctx.state.player;
    if (!p) return;
    this.spots = this.findSpots().map((s) => ({ ...s, d: this.dist(s.x, s.y) })).sort((a, b) => a.d - b.d);
    if (this.spots.length) this.snap(0);
    else {
      // Nothing interesting: start on the grid ahead
      const [dx, dy] = DIR_OFFSETS[FACING_TO_DIR[this.ctx.facing()]];
      this.moveTo(p.x + dx, p.y + dy);
    }
  }

  onClose(): void {
    this.hooks.cursor(null);
  }

  protected snap(i: number) {
    if (!this.spots.length) return;
    this.index = (i + this.spots.length) % this.spots.length;
    const s = this.spots[this.index];
    this.moveTo(s.x, s.y, true);
  }

  protected moveTo(x: number, y: number, face = false) {
    const m = this.ctx.state.map;
    this.x = Math.max(0, Math.min(m.width - 1, x));
    this.y = Math.max(0, Math.min(m.height - 1, y));
    this.hooks.cursor({ x: this.x, y: this.y });
    const p = this.ctx.state.player;
    if (p && (this.x !== p.x || this.y !== p.y)) {
      // Turn when snapping to something, or when the cursor leaves the view
      const ang = Math.atan2(this.x - p.x, -(this.y - p.y));
      const facing = (this.ctx.facing() * Math.PI) / 4;
      const off = Math.abs(Math.atan2(Math.sin(ang - facing), Math.cos(ang - facing)));
      if (face || off > (Math.PI * 3) / 8) this.hooks.face(this.x, this.y);
    }
    this.show();
  }

  /** One grid relative to the view: 0 forward, 2 right, 4 back, 6 left */
  private step(offset: number) {
    const [dx, dy] = DIR_OFFSETS[FACING_TO_DIR[(this.ctx.facing() + offset) % 8]];
    this.index = -1;
    this.moveTo(this.x + dx, this.y + dy);
  }

  protected show() {
    const s = this.ctx.state;
    const d = this.dist(this.x, this.y);
    const where = d === 0 ? 'here' : `${d} away`;
    const seen = s.map.isInView(this.x, this.y) ? '' : ' · out of sight';
    this.name.textContent = `${describeGrid(s, this.x, this.y)} · ${where}${seen}`;
    this.renderHelp();
  }

  protected visibleMonsterHere() {
    const m = this.ctx.state.monsterAt(this.x, this.y);
    return m?.inView ? m : undefined;
  }

  protected kbd(label: string | undefined, fallback: string, text: string) {
    return h('span', {}, h('kbd', {}, label ?? fallback), text);
  }

  handleInput(ev: InputEvent): boolean {
    const g = ev.game;
    if (ev.ui === 'back' || ev.ui === 'menu') {
      this.close();
      return true;
    }
    if (ev.ui === 'tabNext' || ev.key === ' ' || ev.key === '+') {
      this.snap(this.index + 1);
      return true;
    }
    if (ev.ui === 'tabPrev' || ev.key === '-') {
      this.snap(this.index - 1);
      return true;
    }
    if (this.act(ev)) return true;
    // Numpad: map directions
    if (g?.startsWith('walkDir')) {
      const [dx, dy] = DIR_OFFSETS[Number(g.slice(-1)) as Direction];
      this.index = -1;
      this.moveTo(this.x + dx, this.y + dy);
      return true;
    }
    if (ev.ui === 'up' || g === 'moveForward') this.step(0);
    else if (ev.ui === 'down' || g === 'moveBack') this.step(4);
    else if (ev.ui === 'left' || g === 'strafeLeft' || g === 'turnLeft') this.step(6);
    else if (ev.ui === 'right' || g === 'strafeRight' || g === 'turnRight') this.step(2);
    return true;
  }
}

export class LookLayer extends CursorLayer {
  constructor(ctx: UiContext, hooks: TargetingHooks) {
    super(ctx, hooks, 'Look');
  }

  protected findSpots() {
    const s = this.ctx.state;
    const out: { x: number; y: number }[] = [];
    for (const m of s.monsters) if (m.inView) out.push(m);
    for (const o of s.objects) if (o.seen) out.push(o);
    // Stairs and shops in view, as Angband's look shows interesting terrain
    const p = s.player;
    if (p) {
      for (let y = Math.max(0, p.y - 20); y <= Math.min(s.map.height - 1, p.y + 20); y++) {
        for (let x = Math.max(0, p.x - 20); x <= Math.min(s.map.width - 1, p.x + 20); x++) {
          if (!s.map.isInView(x, y) || (x === p.x && y === p.y)) continue;
          const shape = s.featureClassAt(x, y).shape;
          if ((shape === 'stair_up' || shape === 'stair_down' || shape === 'shop') && !out.some((o) => o.x === x && o.y === y)) out.push({ x, y });
        }
      }
    }
    return out;
  }

  protected renderHelp() {
    const pr = this.ctx.input.prompts();
    const kb = this.ctx.input.lastDevice === 'keyboard';
    const m = this.visibleMonsterHere();
    this.help.replaceChildren(
      ...(m ? [this.kbd(pr.confirm, 'Enter', 'Recall')] : []),
      ...(this.ctx.state.map.isKnown(this.x, this.y) ? [this.kbd(kb ? 'g' : pr.tertiary, 'Y', 'Travel here')] : []),
      this.kbd(kb ? 'Space/-' : pr.tabs, 'LB/RB', this.spots.length ? `Next (${this.index + 1 || '–'}/${this.spots.length})` : 'Next'),
      this.kbd(kb ? '↑↓←→' : pr.dpad, 'D-pad', 'Move cursor'),
      this.kbd(pr.back, 'Esc', 'Close'));
  }

  protected act(ev: InputEvent): boolean {
    if (ev.ui === 'confirm' || ev.key === 'r' || ev.game === 'recall') {
      const m = this.visibleMonsterHere();
      if (m) {
        // Track the monster (as looking does in Angband), then show its recall
        this.ctx.send({ type: 'command', action: 'target_monster', monster: m.id });
        this.hooks.recall();
      }
      return true;
    }
    if (ev.ui === 'tertiary' || ev.key === 'g') {
      if (this.ctx.state.map.isKnown(this.x, this.y)) {
        this.close();
        this.ctx.send({ type: 'command', action: 'pathfind', x: this.x, y: this.y });
      }
      return true;
    }
    if (ev.game === 'look') {
      this.snap(this.index + 1);
      return true;
    }
    return false;
  }
}

export class AimLayer extends CursorLayer {
  constructor(ctx: UiContext, hooks: TargetingHooks) {
    super(ctx, hooks, 'Aim');
  }

  protected findSpots() {
    return this.ctx.state.monsters.filter((m) => m.inView);
  }

  private launcher() {
    const s = this.ctx.state;
    return s.equipment.some((e) => e.slot === 'shooting' && e.item) && s.quiver.length > 0;
  }

  protected renderHelp() {
    const pr = this.ctx.input.prompts();
    const kb = this.ctx.input.lastDevice === 'keyboard';
    const s = this.ctx.state;
    this.help.replaceChildren(
      this.kbd(kb ? 't' : pr.confirm, 'A', this.launcher() ? `Fire ${s.quiver[0].name}` : 'Throw'),
      this.kbd(kb ? 'Shift+Enter' : pr.secondary, 'X', 'Set target'),
      this.kbd(kb ? 'Space/-' : pr.tabs, 'LB/RB', 'Next target'),
      this.kbd(kb ? '↑↓←→' : pr.dpad, 'D-pad', 'Move cursor'),
      this.kbd(pr.back, 'Esc', 'Cancel'));
  }

  /** Make the cursor grid the engine's target: the monster there, or the grid itself */
  private setTarget() {
    const m = this.visibleMonsterHere();
    if (m) this.ctx.send({ type: 'command', action: 'target_monster', monster: m.id });
    else this.ctx.send({ type: 'command', action: 'target_location', x: this.x, y: this.y });
  }

  protected act(ev: InputEvent): boolean {
    const p = this.ctx.state.player;
    const onSelf = !!p && p.x === this.x && p.y === this.y;
    if (ev.ui === 'confirm' || ev.key === 't' || ev.key === '5' || ev.game === 'attack') {
      if (onSelf) return true;
      this.setTarget();
      this.close();
      if (this.launcher()) {
        this.ctx.send({ type: 'command', action: 'fire', item: this.ctx.state.quiver[0].handle, useTarget: true });
      } else {
        // Choose what to throw; the engine's prompt asks for the item
        this.ctx.send({ type: 'command', action: 'throw', useTarget: true });
      }
      return true;
    }
    if (ev.ui === 'secondary') {
      if (onSelf) return true;
      this.setTarget();
      this.close();
      return true;
    }
    if (ev.game === 'aim') {
      this.snap(this.index + 1);
      return true;
    }
    return false;
  }
}
