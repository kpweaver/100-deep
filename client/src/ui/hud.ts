/**
 * Always-visible HUD: vitals, depth, status effects, message log, target,
 * contextual button prompts and minimap.  Everything shown comes from the
 * engine's state; nothing is computed beyond presentation.
 */
import type { GameMessage } from '@thang/protocol';
import type { GameState } from '../state/game-state.ts';
import type { TileAtlas } from '../sprites/atlas.ts';
import { add, clear, h, paletteColor } from './dom.ts';
import { Minimap } from './minimap.ts';

export interface ContextHint {
  button: string;
  label: string;
}

function bar(cls: string): { el: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const fill = h('div', { class: 'bar-fill' });
  const text = h('div', { class: 'bar-text' });
  const el = h('div', { class: `bar ${cls}` }, fill, text);
  return { el, fill, text };
}

export class Hud {
  readonly el: HTMLElement;
  readonly minimap: Minimap;
  private hp = bar('hp');
  private sp = bar('sp');
  private xp = bar('xp');
  private info = h('div', { class: 'hud-info' });
  private statusEl = h('div', { class: 'hud-status' });
  private log = h('div', { class: 'hud-log' });
  private hints = h('div', { class: 'hud-hints' });
  private target = h('div', { class: 'hud-target' });
  private monsters = h('div', { class: 'hud-monsters' });
  private banner = h('div', { class: 'hud-banner' });
  private vignette = h('div', { class: 'hud-vignette' });
  private recent: { el: HTMLElement; at: number }[] = [];

  constructor(private state: GameState, private atlas: () => TileAtlas | null) {
    this.minimap = new Minimap(state);
    this.el = h('div', { class: 'hud' },
      this.vignette,
      h('div', { class: 'hud-top-left' }, this.hp.el, this.sp.el, this.xp.el, this.info, this.statusEl),
      h('div', { class: 'hud-top-right' }, this.minimap.canvas, this.monsters),
      this.target,
      this.banner,
      this.log,
      this.hints,
      h('div', { class: 'crosshair' }),
    );
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
  }

  update(): void {
    const s = this.state;
    const p = s.player;
    if (!p) return;
    const pal = s.hello?.palette;
    const setBar = (b: ReturnType<typeof bar>, cur: number, max: number, label: string) => {
      b.fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0}%`;
      b.text.textContent = `${label} ${cur}/${max}`;
    };
    setBar(this.hp, p.hp, p.maxHp, 'HP');
    this.hp.el.classList.toggle('low', p.hp <= p.maxHp * 0.3);
    this.sp.el.classList.toggle('hidden', p.maxSp <= 0);
    setBar(this.sp, p.sp, p.maxSp, 'SP');
    const xpPct = p.expToNext > 0 ? p.exp / p.expToNext : 1;
    this.xp.fill.style.width = `${Math.min(100, xpPct * 100)}%`;
    this.xp.text.textContent = `Lv ${p.level}${p.level < p.maxLevel ? ` (${p.maxLevel})` : ''}  ·  ${p.exp} xp`;

    const depth = p.depth === 0 ? 'Town' : `${p.depth * 50} ft (L${p.depth})`;
    clear(this.info);
    add(this.info, 
      h('span', {}, depth),
      h('span', {}, `AC ${p.ac}`),
      h('span', {}, `${p.gold} AU`),
      p.speed !== 0 ? h('span', { class: p.speed > 0 ? 'good' : 'bad' }, `Speed ${p.speed > 0 ? '+' : ''}${p.speed}`) : null,
      p.levelFeeling ? h('span', {}, p.levelFeeling) : null,
      p.resting ? h('span', { class: 'good' }, 'Resting') : null,
    );

    clear(this.statusEl);
    for (const st of s.status) {
      this.statusEl.append(h('span', { class: 'chip', style: `color:${paletteColor(pal, st.color)}` },
        st.pct !== undefined ? `${st.name} ${st.pct}%` : st.name));
    }

    // Tracked/targeted monster
    clear(this.target);
    const tgt = s.target?.monster !== undefined ? s.monsters.find((m) => m.id === s.target!.monster) : undefined;
    const tracked = tgt ?? s.monsters.find((m) => m.healthPct !== undefined);
    if (tracked) {
      const at = this.atlas();
      add(this.target, 
        at && tracked.tile ? h('span', { class: 'tile-icon', style: at.css(tracked.tile, 24) }) : null,
        h('span', { class: 'target-name' }, tracked.name + (tgt ? ' (target)' : '')),
        tracked.status ? h('small', {}, tracked.status) : null,
      );
      if (tracked.healthPct !== undefined) {
        add(this.target, h('div', { class: 'bar mini' }, h('div', { class: 'bar-fill', style: `width:${tracked.healthPct}%` })));
      }
    }

    // Visible monster list (like Angband's monster list subwindow)
    clear(this.monsters);
    const at = this.atlas();
    const counts = new Map<string, { n: number; tile: [number, number] | null; inView: boolean }>();
    for (const m of s.monsters) {
      const c = counts.get(m.name) ?? { n: 0, tile: m.tile, inView: false };
      c.n++;
      c.inView ||= m.inView;
      counts.set(m.name, c);
    }
    for (const [name, c] of [...counts].slice(0, 8)) {
      this.monsters.append(h('div', { class: `mon-row${c.inView ? '' : ' sensed'}` },
        at && c.tile ? h('span', { class: 'tile-icon', style: at.css(c.tile, 20) }) : null,
        h('span', {}, c.n > 1 ? `${c.n} × ${name}` : name)));
    }

    // Fade the oldest messages
    const now = performance.now();
    for (const r of this.recent) r.el.classList.toggle('old', now - r.at > 8000);
  }

  addMessages(msgs: GameMessage[]): void {
    const now = performance.now();
    for (const m of msgs) {
      if (!m.text.trim()) continue;
      const last = this.recent[this.recent.length - 1];
      if (last && last.el.dataset.text === m.text && now - last.at < 1500) {
        const n = Number(last.el.dataset.count ?? '1') + 1;
        last.el.dataset.count = String(n);
        last.el.textContent = `${m.text} (x${n})`;
        last.at = now;
        last.el.classList.remove('old');
        continue;
      }
      const el = h('div', { class: 'log-line' }, m.text);
      el.dataset.text = m.text;
      this.log.append(el);
      this.recent.push({ el, at: now });
      while (this.recent.length > 6) this.recent.shift()!.el.remove();
    }
  }

  setHints(hints: ContextHint[]): void {
    clear(this.hints);
    for (const hint of hints) {
      this.hints.append(h('span', { class: 'hint' }, h('kbd', {}, hint.button), hint.label));
    }
  }

  showBanner(text: string, ms = 2200): void {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  hurt(): void {
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }

  drawMinimap(facing: number): void {
    this.minimap.draw(facing);
  }
}
