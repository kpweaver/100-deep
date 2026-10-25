/**
 * Game screens.  Every action here issues a native engine command (or a
 * read-only query); the engine decides what happens.
 */
import type { CommandMessage, ItemAction, ItemInfo, StoreItem } from '@thang/protocol';
import type { InputEvent } from '../input/actions.ts';
import { PROMPTS } from '../input/actions.ts';
import type { UiContext } from './context.ts';
import { add, clear, h, paletteColor } from './dom.ts';
import { Layer } from './layer.ts';
import { ListMenu, type MenuItem } from './list-menu.ts';
import { MenuLayer, TextInputLayer, TextLayer } from './menu-layer.ts';
import { TileMap } from './minimap.ts';

const ACTION_LABELS: Record<ItemAction, string> = {
  wield: 'Wear / wield', takeoff: 'Take off', eat: 'Eat', quaff: 'Quaff', read: 'Read',
  use_staff: 'Use staff', aim_wand: 'Aim wand', zap_rod: 'Zap rod', activate: 'Activate',
  refill: 'Refuel light', fire: 'Fire', throw: 'Throw', cast: 'Cast a spell', study: 'Study',
  browse: 'Browse', drop: 'Drop', inscribe: 'Inscribe', uninscribe: 'Uninscribe', ignore: 'Ignore / unignore',
};

const fmtWeight = (w: number) => `${Math.floor(w / 10)}.${w % 10} lb`;

/* ------------------------------------------------------------------ */
/* Title and character creation                                        */
/* ------------------------------------------------------------------ */

export class TitleLayer extends Layer {
  private menu: ListMenu<string>;
  private status = h('div', { class: 'title-status' });

  constructor(private ctx: UiContext, private onNewGame: () => void) {
    super('title-layer');
    this.menu = new ListMenu<string>({ items: [], letters: false, onSelect: (i) => this.choose(i.data) });
    this.el.append(h('div', { class: 'title-panel' },
      h('h1', {}, 'THANGORODRIM'),
      h('div', { class: 'subtitle' }, 'A first-person journey through the pits of Angband'),
      this.menu.el,
      this.status,
      h('div', { class: 'credits' },
        'Game engine: Angband 4.2 (angband.github.io) · Tiles: David Gervais (CC BY 3.0) & contributors')));
    this.refresh();
  }

  refresh(): void {
    const hello = this.ctx.state.hello;
    const items: MenuItem<string>[] = [];
    if (hello?.saveExists) items.push({ label: 'Continue', detail: hello.savefile.split('/').pop(), data: 'load' });
    items.push({ label: 'New character', data: 'new' });
    items.push({ label: 'Controls', data: 'help' });
    this.menu.setItems(items);
    this.status.textContent = hello ? `${hello.engine} · protocol v${hello.protocol}` : 'Connecting to engine…';
  }

  private choose(what: string) {
    if (what === 'load') this.ctx.send({ type: 'load_game' });
    else if (what === 'new') this.onNewGame();
    else if (what === 'help') this.ctx.ui.open(new TextLayer('Controls', controlsHelp()));
  }

  handleInput(ev: InputEvent): boolean {
    this.menu.handleInput(ev);
    return true;
  }
}

const NAMES = ['Beren', 'Luthien', 'Turin', 'Hurin', 'Morwen', 'Haleth', 'Barahir', 'Idril', 'Tuor', 'Earendil', 'Galdor', 'Nienor'];

/** Character creation using the engine's own race/class lists */
export function startBirth(ctx: UiContext, onDone: () => void): void {
  const hello = ctx.state.hello;
  if (!hello) return;
  const races = [...hello.races].reverse();
  const classes = [...hello.classes].reverse();
  const choice = { race: 'Human', class: 'Warrior', name: '', stats: 'points' as 'points' | 'roll' };

  const raceLayer = new MenuLayer<string>(ctx, {
    title: 'Choose your race',
    items: races.map((r) => ({ label: r, data: r })),
    onSelect: (i) => {
      choice.race = i.data;
      ctx.ui.open(classLayer());
    },
  });

  const classLayer = () => new MenuLayer<string>(ctx, {
    title: 'Choose your class',
    subtitle: choice.race,
    items: classes.map((c) => ({ label: c, data: c })),
    onSelect: (i) => {
      choice.class = i.data;
      ctx.ui.open(new TextInputLayer(ctx, 'Name your character', NAMES[Math.floor(Math.random() * NAMES.length)], 31,
        (v) => {
          if (!v) return;
          choice.name = v.trim().slice(0, 31) || 'Adventurer';
          ctx.ui.open(statsLayer());
        },
        ctx.input.lastDevice === 'gamepad' ? NAMES : []));
    },
  });

  const statsLayer = () => new MenuLayer<'points' | 'roll'>(ctx, {
    title: 'Ability scores',
    subtitle: `${choice.name} the ${choice.race} ${choice.class}`,
    items: [
      { label: 'Point-based (recommended defaults)', data: 'points' },
      { label: 'Roll randomly', data: 'roll' },
    ],
    onSelect: (i) => {
      choice.stats = i.data;
      ctx.ui.closeAll((l) => l instanceof MenuLayer || l instanceof TextInputLayer);
      ctx.send({
        type: 'new_game', race: choice.race, class: choice.class, name: choice.name,
        stats: choice.stats, options: ctx.engineOptions,
      });
      onDone();
    },
  });

  ctx.ui.open(raceLayer);
}

/* ------------------------------------------------------------------ */
/* Inventory and equipment                                             */
/* ------------------------------------------------------------------ */

type GearTab = 'inventory' | 'equipment' | 'quiver' | 'floor';

export class InventoryLayer extends Layer {
  private tab: GearTab = 'inventory';
  private tabs = h('div', { class: 'tabs' });
  private menu: ListMenu<ItemInfo | null>;
  private detail = h('div', { class: 'menu-detail' });
  private titleExtra = h('small', {});

  constructor(private ctx: UiContext, initialTab: GearTab = 'inventory') {
    super('inventory-layer');
    this.tab = initialTab;
    this.menu = new ListMenu<ItemInfo | null>({
      items: [],
      atlas: ctx.atlas(),
      onSelect: (i) => i.data && this.itemMenu(i.data),
      onCancel: () => this.close(),
      onSecondary: (i) => i.data && ctx.send({ type: 'query', what: 'item', item: i.data.handle }),
      onFocus: (i) => this.describe(i?.data ?? null),
    });
    const p = PROMPTS[ctx.input.lastDevice];
    this.el.append(h('div', { class: 'panel wide' },
      h('div', { class: 'panel-title' }, 'Gear', this.titleExtra),
      this.tabs,
      h('div', { class: 'panel-body' }, this.menu.el, this.detail),
      h('div', { class: 'panel-footer' },
        h('span', {}, h('kbd', {}, p.confirm ?? 'Enter'), 'Use'),
        h('span', {}, h('kbd', {}, p.secondary ?? 'Shift+Enter'), 'Examine'),
        h('span', {}, h('kbd', {}, ctx.input.lastDevice === 'gamepad' ? 'LB/RB' : 'Tab'), 'Switch tab'),
        h('span', {}, h('kbd', {}, p.back ?? 'Esc'), 'Close'))));
    this.refresh();
  }

  refresh(): void {
    const s = this.ctx.state;
    const tabs: [GearTab, string][] = [
      ['inventory', `Pack (${s.inventory.length})`],
      ['equipment', 'Equipment'],
      ['quiver', `Quiver (${s.quiver.length})`],
      ['floor', `Floor (${s.floor.length})`],
    ];
    clear(this.tabs);
    for (const [t, label] of tabs) {
      this.tabs.append(h('span', { class: `tab${t === this.tab ? ' active' : ''}`, onclick: () => this.setTab(t) }, label));
    }
    const p = s.player;
    this.titleExtra.textContent = p ? `Burden ${fmtWeight(p.burden)} · ${p.gold} AU` : '';
    let items: MenuItem<ItemInfo | null>[];
    if (this.tab === 'equipment') {
      items = s.equipment.map((e) => ({
        label: e.item ? e.item.name : '(nothing)',
        detail: e.slot,
        tile: e.item?.tile,
        right: e.item ? fmtWeight(e.item.weight * e.item.number) : '',
        disabled: !e.item,
        data: e.item,
      }));
    } else {
      const list = this.tab === 'inventory' ? s.inventory : this.tab === 'quiver' ? s.quiver : s.floor;
      items = list.map((it) => ({
        label: it.name,
        detail: it.inscription ? `{${it.inscription}}` : undefined,
        tile: it.tile,
        right: fmtWeight(it.weight * it.number),
        data: it,
      }));
    }
    this.menu.setItems(items);
  }

  private setTab(t: GearTab) {
    this.tab = t;
    this.menu.index = 0;
    this.refresh();
  }

  private describe(it: ItemInfo | null) {
    clear(this.detail);
    if (!it) return;
    const at = this.ctx.atlas();
    add(this.detail, 
      at && it.tile ? h('div', { class: 'big-icon', style: at.css(it.tile, 64) }) : null,
      h('div', { class: 'detail-name' }, it.name),
      h('div', {}, `${it.tval} · ${fmtWeight(it.weight * it.number)}`),
      h('div', { class: 'detail-actions' }, it.actions.map((a) => ACTION_LABELS[a]).join(' · ')),
    );
  }

  private itemMenu(it: ItemInfo) {
    const items: MenuItem<ItemAction | 'examine'>[] = it.actions.map((a) => ({ label: ACTION_LABELS[a], data: a }));
    items.push({ label: 'Examine', data: 'examine' });
    const layer: MenuLayer<ItemAction | 'examine'> = new MenuLayer(this.ctx, {
      title: it.name,
      items,
      className: 'small',
      onSelect: (i) => {
        layer.close();
        this.doAction(it, i.data);
      },
    });
    this.ctx.ui.open(layer);
  }

  private doAction(it: ItemInfo, action: ItemAction | 'examine') {
    const ctx = this.ctx;
    if (action === 'examine') {
      ctx.send({ type: 'query', what: 'item', item: it.handle });
      return;
    }
    if (action === 'browse') {
      // Read-only, like Angband's browse command: no game time passes
      ctx.send({ type: 'query', what: 'book', item: it.handle });
      return;
    }
    if (action === 'inscribe') {
      ctx.ui.open(new TextInputLayer(ctx, `Inscribe ${it.name}`, it.inscription ?? '', 79, (v) => {
        if (v !== null) ctx.send({ type: 'command', action: 'inscribe', item: it.handle, text: v });
      }));
      return;
    }
    const cmd: CommandMessage = action === 'cast' || action === 'study'
      ? { type: 'command', action, book: it.handle }
      : { type: 'command', action, item: it.handle };
    ctx.send(cmd);
    // Turn-taking actions return to the dungeon view
    if (action !== 'ignore' && action !== 'uninscribe') this.close();
  }

  handleInput(ev: InputEvent): boolean {
    const order: GearTab[] = ['inventory', 'equipment', 'quiver', 'floor'];
    if (ev.ui === 'tabNext' || ev.ui === 'tabPrev' || ev.ui === 'right' || ev.ui === 'left') {
      const d = ev.ui === 'tabNext' || ev.ui === 'right' ? 1 : -1;
      this.setTab(order[(order.indexOf(this.tab) + d + order.length) % order.length]);
      return true;
    }
    // Letters are item shortcuts here, so only Esc/B/Start close the panel
    if (ev.ui === 'menu') {
      this.close();
      return true;
    }
    this.menu.handleInput(ev);
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Quick actions (LB)                                                  */
/* ------------------------------------------------------------------ */

export function openQuickMenu(ctx: UiContext, extra: { save: () => void }): void {
  type Q = () => void;
  const cmd = (c: Omit<CommandMessage, 'type'>): Q => () => ctx.send({ type: 'command', ...c } as CommandMessage);
  const items: MenuItem<Q>[] = [
    { label: 'Rest as needed', detail: 'until HP/SP full or disturbed', data: cmd({ action: 'rest', mode: 'as_needed' }) },
    { label: 'Rest until HP & SP full', data: cmd({ action: 'rest', mode: 'hp_sp' }) },
    { label: 'Rest 10 turns', data: cmd({ action: 'rest', mode: 'turns', turns: 10 }) },
    { label: 'Hold / wait a turn', data: cmd({ action: 'hold' }) },
    { label: 'Auto-explore', data: cmd({ action: 'explore' }) },
    { label: 'Travel to nearest down staircase', data: cmd({ action: 'navigate_down' }) },
    { label: 'Travel to nearest up staircase', data: cmd({ action: 'navigate_up' }) },
    { label: 'Go down staircase', data: cmd({ action: 'go_down' }) },
    { label: 'Go up staircase', data: cmd({ action: 'go_up' }) },
    { label: 'Fire at nearest', data: cmd({ action: 'fire_at_nearest' }) },
    { label: 'Throw an item', data: cmd({ action: 'throw' }) },
    { label: 'Cast a spell', data: cmd({ action: 'cast' }) },
    { label: 'Study a book', data: cmd({ action: 'study' }) },
    { label: 'Open (choose direction)', data: cmd({ action: 'open' }) },
    { label: 'Close a door', data: cmd({ action: 'close' }) },
    { label: 'Tunnel', data: cmd({ action: 'tunnel' }) },
    { label: 'Disarm a trap or chest', data: cmd({ action: 'disarm' }) },
    { label: 'Alter terrain', data: cmd({ action: 'alter' }) },
    { label: 'Walk into a trap (jump)', data: cmd({ action: 'jump' }) },
    { label: 'Use any item', data: cmd({ action: 'use' }) },
    { label: 'Repeat level feeling', data: cmd({ action: 'feeling' }) },
    { label: 'Toggle unignore', data: cmd({ action: 'toggle_unignore' }) },
    { label: 'Clear target', data: cmd({ action: 'target_clear' }) },
    { label: 'Save game', data: extra.save },
  ];
  const layer: MenuLayer<Q> = new MenuLayer(ctx, {
    title: 'Actions',
    items,
    letters: true,
    onSelect: (i) => {
      layer.close();
      i.data();
    },
  });
  ctx.ui.open(layer);
}

/* ------------------------------------------------------------------ */
/* Full map, character sheet, system menu                              */
/* ------------------------------------------------------------------ */

export class MapLayer extends Layer {
  private map: TileMap;
  private wrap: HTMLElement;
  private info = h('div', { class: 'map-info' });
  private cx = 0;
  private cy = 0;

  constructor(private ctx: UiContext) {
    super('map-layer');
    this.map = new TileMap(ctx.state, ctx.atlas()!);
    this.wrap = h('div', { class: 'map-wrap' }, this.map.canvas);
    this.map.canvas.addEventListener('click', (e) => {
      const r = this.map.canvas.getBoundingClientRect();
      this.cx = Math.floor((e.clientX - r.left) / this.map.cell);
      this.cy = Math.floor((e.clientY - r.top) / this.map.cell);
      this.travel();
    });
    const gp = ctx.input.lastDevice === 'gamepad';
    this.el.append(h('div', { class: 'panel full' },
      h('div', { class: 'panel-title' }, 'Map', h('small', {}, 'Your knowledge of this level')),
      this.wrap,
      this.info,
      h('div', { class: 'panel-footer' },
        h('span', {}, h('kbd', {}, gp ? 'D-pad' : 'Arrows'), 'Move cursor'),
        h('span', {}, h('kbd', {}, gp ? 'A' : 'Enter'), 'Travel here'),
        h('span', {}, h('kbd', {}, gp ? 'LT/RT' : '+/-'), 'Zoom'),
        h('span', {}, h('kbd', {}, gp ? 'B' : 'Esc'), 'Close'))));
  }

  onOpen(): void {
    const p = this.ctx.state.player;
    if (p) {
      this.cx = p.x;
      this.cy = p.y;
    }
    this.redraw(true);
  }

  /** Describe the cursor grid from the player's knowledge only */
  private describe(): string {
    const s = this.ctx.state;
    const parts: string[] = [];
    const f = s.map.featAt(this.cx, this.cy);
    if (!f) return 'Unknown';
    const mon = s.monsterAt(this.cx, this.cy);
    const obj = s.objectAt(this.cx, this.cy);
    if (s.player && s.player.x === this.cx && s.player.y === this.cy) parts.push('You');
    if (mon) parts.push(`${mon.name}${mon.status ? ` (${mon.status})` : ''}`);
    if (obj) parts.push(obj.name || 'an object');
    parts.push(s.features[f]?.name ?? '');
    return parts.join(' · ');
  }

  redraw(center = false): void {
    this.map.draw(this.ctx.facing());
    const c = this.map.cell;
    const ctx2d = this.map.canvas.getContext('2d')!;
    ctx2d.strokeStyle = '#ffd84a';
    ctx2d.lineWidth = 2;
    ctx2d.strokeRect(this.cx * c + 1, this.cy * c + 1, c - 2, c - 2);
    this.info.textContent = this.describe();
    const x = this.cx * c - this.wrap.clientWidth / 2;
    const y = this.cy * c - this.wrap.clientHeight / 2;
    if (center || Math.abs(this.wrap.scrollLeft - x) > this.wrap.clientWidth / 3) this.wrap.scrollLeft = x;
    if (center || Math.abs(this.wrap.scrollTop - y) > this.wrap.clientHeight / 3) this.wrap.scrollTop = y;
  }

  private travel(): void {
    const s = this.ctx.state;
    if (!s.map.isKnown(this.cx, this.cy)) {
      this.info.textContent = 'You do not know how to get there.';
      return;
    }
    this.ctx.send({ type: 'command', action: 'pathfind', x: this.cx, y: this.cy });
    this.close();
  }

  handleInput(ev: InputEvent): boolean {
    const s = this.ctx.state;
    const move = (dx: number, dy: number) => {
      this.cx = Math.max(0, Math.min(s.map.width - 1, this.cx + dx));
      this.cy = Math.max(0, Math.min(s.map.height - 1, this.cy + dy));
      this.redraw();
    };
    if (ev.ui === 'pageDown' || ev.key === '+' || ev.key === '=') {
      this.map.cell = Math.min(32, this.map.cell + 4);
      this.redraw(true);
    } else if (ev.ui === 'pageUp' || ev.key === '-') {
      this.map.cell = Math.max(4, this.map.cell - 4);
      this.redraw(true);
    } else if (ev.ui === 'up') move(0, -1);
    else if (ev.ui === 'down') move(0, 1);
    else if (ev.ui === 'left') move(-1, 0);
    else if (ev.ui === 'right') move(1, 0);
    else if (ev.ui === 'confirm') this.travel();
    else if (ev.ui === 'back' || ev.ui === 'menu' || ev.game === 'map') this.close();
    return true;
  }
}

export function characterSheet(ctx: UiContext): HTMLElement {
  const p = ctx.state.player;
  if (!p) return h('div', {}, 'No character.');
  const pal = ctx.state.hello?.palette;
  return h('div', { class: 'char-sheet' },
    h('div', { class: 'char-head' },
      h('div', { class: 'char-name' }, p.name),
      h('div', {}, `${p.race} ${p.class} · ${p.title}`)),
    h('table', {},
      h('tr', {}, h('td', {}, 'Level'), h('td', {}, `${p.level}${p.level < p.maxLevel ? ` (max ${p.maxLevel})` : ''}`)),
      h('tr', {}, h('td', {}, 'Experience'), h('td', {}, `${p.exp} / next ${p.expToNext || '—'}`)),
      h('tr', {}, h('td', {}, 'Hit points'), h('td', {}, `${p.hp} / ${p.maxHp}`)),
      h('tr', {}, h('td', {}, 'Spell points'), h('td', {}, `${p.sp} / ${p.maxSp}`)),
      h('tr', {}, h('td', {}, 'Armour'), h('td', {}, String(p.ac))),
      h('tr', {}, h('td', {}, 'Speed'), h('td', {}, String(p.speed))),
      h('tr', {}, h('td', {}, 'Gold'), h('td', {}, String(p.gold))),
      h('tr', {}, h('td', {}, 'Depth'), h('td', {}, `${p.depth * 50} ft (max ${p.maxDepth * 50} ft)`)),
      h('tr', {}, h('td', {}, 'Burden'), h('td', {}, fmtWeight(p.burden))),
      h('tr', {}, h('td', {}, 'Turns'), h('td', {}, `${ctx.state.turn} game turns`)),
    ),
    h('div', { class: 'stats' }, p.stats.map((st) =>
      h('div', { class: `stat${st.drained ? ' drained' : ''}` }, h('span', {}, st.name), h('b', {}, st.value)))),
    h('div', { class: 'hud-status' }, ctx.state.status.map((st) =>
      h('span', { class: 'chip', style: `color:${paletteColor(pal, st.color)}` }, st.name))),
  );
}

export function openSystemMenu(ctx: UiContext, actions: { save: () => void; quitToTitle: () => void }): void {
  type S = () => void;
  const items: MenuItem<S>[] = [
    { label: 'Resume', data: () => {} },
    { label: 'Save game', data: actions.save },
    { label: 'Options', data: () => openOptions(ctx) },
    { label: 'Controls', data: () => ctx.ui.open(new TextLayer('Controls', controlsHelp())) },
    { label: 'Message history', data: () => openMessageLog(ctx) },
    { label: 'Save and return to title', data: actions.quitToTitle },
  ];
  const layer: MenuLayer<S> = new MenuLayer(ctx, {
    title: 'Paused',
    subtitle: 'The game does not advance while menus are open',
    items,
    letters: false,
    onSelect: (i) => {
      layer.close();
      i.data();
    },
  });
  ctx.ui.open(layer);
}

function openMessageLog(ctx: UiContext) {
  const lines = ctx.state.log.slice(-200).map((m) => (m.count > 1 ? `${m.text} (x${m.count})` : m.text));
  const el = h('div', { class: 'message-log' }, lines.map((l) => h('div', {}, l)));
  const layer = new TextLayer('Messages', el);
  ctx.ui.open(layer);
  setTimeout(() => (el.parentElement!.scrollTop = 1e9), 0);
}

export function openOptions(ctx: UiContext): void {
  type O = { kind: 'client'; key: string } | { kind: 'engine'; name: string };
  const build = (): MenuItem<O>[] => {
    const s = ctx.settings;
    const items: MenuItem<O>[] = [
      { label: 'Retro pixel size', right: s.pixelScale <= 1 ? 'Off (full resolution)' : `${s.pixelScale}x`, detail: '←/→ to change', data: { kind: 'client', key: 'pixelScale' } },
      { label: 'Field of view', right: `${s.fov}°`, detail: '←/→ to change', data: { kind: 'client', key: 'fov' } },
      { label: 'Instant movement & turning', right: s.instantMovement ? 'On' : 'Off', data: { kind: 'client', key: 'instantMovement' } },
      { label: 'Keep exploring after each step', right: s.autoExploreRepeat ? 'On' : 'Off', data: { kind: 'client', key: 'autoExploreRepeat' } },
      { label: 'Minimap', right: s.showMinimap ? 'On' : 'Off', data: { kind: 'client', key: 'showMinimap' } },
      { label: 'Sound volume', right: `${Math.round(s.volume * 100)}%`, detail: '←/→ to change', data: { kind: 'client', key: 'volume' } },
    ];
    for (const o of ctx.state.hello?.options ?? []) {
      if (o.kind !== 'interface' || o.name === 'rogue_like_commands') continue;
      const value = ctx.engineOptions[o.name] ?? o.value;
      items.push({ label: o.description, detail: `Angband option: ${o.name}`, right: value ? 'Yes' : 'No', data: { kind: 'engine', name: o.name } });
    }
    return items;
  };
  const adjust = (o: O, dir: number) => {
    const s = ctx.settings;
    if (o.kind === 'engine') {
      const cur = ctx.engineOptions[o.name] ?? ctx.state.hello?.options.find((x) => x.name === o.name)?.value ?? false;
      ctx.engineOptions[o.name] = !cur;
      if (ctx.state.player) ctx.send({ type: 'options', set: { [o.name]: !cur } });
      ctx.applySettings({});
      return;
    }
    switch (o.key) {
      case 'pixelScale': {
        // Enter cycles Off -> 2x ... 6x -> Off; arrows step
        const next = dir ? s.pixelScale + dir : (s.pixelScale >= 6 ? 1 : s.pixelScale + 1);
        ctx.applySettings({ pixelScale: Math.max(1, Math.min(6, next)) });
        break;
      }
      case 'fov': ctx.applySettings({ fov: Math.max(50, Math.min(100, s.fov + (dir || 1) * 5)) }); break;
      case 'volume': ctx.applySettings({ volume: Math.max(0, Math.min(1, Math.round((s.volume + (dir || 1) * 0.1) * 10) / 10)) }); break;
      case 'instantMovement': ctx.applySettings({ instantMovement: !s.instantMovement }); break;
      case 'autoExploreRepeat': ctx.applySettings({ autoExploreRepeat: !s.autoExploreRepeat }); break;
      case 'showMinimap': ctx.applySettings({ showMinimap: !s.showMinimap }); break;
    }
  };
  const layer: MenuLayer<O> = new MenuLayer(ctx, {
    title: 'Options',
    items: build(),
    letters: false,
    onSelect: (i) => {
      adjust(i.data, 0);
      const idx = layer.menu.index;
      layer.setItems(build());
      layer.menu.index = idx;
    },
  });
  const orig = layer.handleInput.bind(layer);
  layer.handleInput = (ev: InputEvent) => {
    if (ev.ui === 'left' || ev.ui === 'right') {
      const item = layer.menu.items[layer.menu.index];
      if (item) {
        adjust(item.data, ev.ui === 'left' ? -1 : 1);
        const idx = layer.menu.index;
        layer.setItems(build());
        layer.menu.index = idx;
      }
      return true;
    }
    return orig(ev);
  };
  ctx.ui.open(layer);
}

/* ------------------------------------------------------------------ */
/* Stores                                                              */
/* ------------------------------------------------------------------ */

export class StoreLayer extends Layer {
  private mode: 'buy' | 'sell' = 'buy';
  private tabs = h('div', { class: 'tabs' });
  private header = h('div', { class: 'panel-title' });
  private menu: ListMenu<StoreItem | ItemInfo>;
  private detail = h('div', { class: 'menu-detail' });

  constructor(private ctx: UiContext) {
    super('store-layer');
    this.menu = new ListMenu<StoreItem | ItemInfo>({
      items: [],
      atlas: ctx.atlas(),
      onSelect: (i) => this.choose(i.data),
      onCancel: () => this.leave(),
      onSecondary: (i) => {
        if (this.mode === 'sell') ctx.send({ type: 'query', what: 'item', item: i.data.handle });
      },
    });
    const p = PROMPTS[ctx.input.lastDevice];
    this.el.append(h('div', { class: 'panel wide' },
      this.header,
      this.tabs,
      h('div', { class: 'panel-body' }, this.menu.el, this.detail),
      h('div', { class: 'panel-footer' },
        h('span', {}, h('kbd', {}, p.confirm ?? 'Enter'), 'Buy / sell'),
        h('span', {}, h('kbd', {}, ctx.input.lastDevice === 'gamepad' ? 'LB/RB' : 'Tab'), 'Switch'),
        h('span', {}, h('kbd', {}, p.back ?? 'Esc'), 'Leave'))));
    this.refresh();
  }

  refresh(): void {
    const st = this.ctx.state.store;
    if (!st) return;
    clear(this.header);
    this.header.append(st.name, h('small', {},
      `${st.owner ? `${st.owner} · ` : ''}You have ${this.ctx.state.player?.gold ?? 0} AU`));
    clear(this.tabs);
    const buyLabel = st.home ? 'Take' : 'Buy';
    const sellLabel = st.home ? 'Drop' : st.noSelling ? 'Give' : 'Sell';
    for (const [m, label] of [['buy', buyLabel], ['sell', sellLabel]] as const) {
      this.tabs.append(h('span', { class: `tab${m === this.mode ? ' active' : ''}`, onclick: () => this.setMode(m) }, label));
    }
    if (this.mode === 'buy') {
      this.menu.setItems(st.stock.map((it) => ({
        label: it.name,
        tile: it.tile,
        right: it.price !== undefined ? `${it.price} AU` : `x${it.number}`,
        detail: it.canUse ? undefined : "can't use",
        data: it,
      })));
    } else {
      const prices = new Map(st.sellable.map((s) => [s.handle, s.price]));
      this.menu.setItems(this.ctx.state.inventory
        .filter((it) => prices.has(it.handle))
        .map((it) => ({
          label: it.name,
          tile: it.tile,
          right: prices.get(it.handle) !== undefined && !st.noSelling ? `${prices.get(it.handle)} AU` : '',
          data: it,
        })));
    }
  }

  private setMode(m: 'buy' | 'sell') {
    this.mode = m;
    this.menu.index = 0;
    this.refresh();
  }

  private choose(it: StoreItem | ItemInfo) {
    const action = this.mode === 'buy' ? 'store_buy' : 'store_sell';
    if (it.number <= 1) {
      this.ctx.send({ type: 'command', action, item: it.handle, quantity: 1 });
      return;
    }
    // Quantity picker
    const max = it.number;
    let q = 1;
    const label = h('div', { class: 'quantity' }, '1');
    const self = this;
    class QtyLayer extends Layer {
      constructor() {
        super('prompt-layer');
        this.el.append(h('div', { class: 'panel narrow' },
          h('div', { class: 'panel-title' }, `${self.mode === 'buy' ? 'Buy' : 'Sell'} how many? (max ${max})`),
          h('div', { class: 'quantity-box' }, label, h('small', {}, '←/→ ±1 · ↑/↓ ±10'))));
      }
      handleInput(ev: InputEvent): boolean {
        if (ev.ui === 'left') q = Math.max(1, q - 1);
        else if (ev.ui === 'right') q = Math.min(max, q + 1);
        else if (ev.ui === 'up') q = Math.min(max, q + 10);
        else if (ev.ui === 'down') q = Math.max(1, q - 10);
        else if (ev.ui === 'confirm') {
          this.close();
          self.ctx.send({ type: 'command', action, item: it.handle, quantity: q });
          return true;
        } else if (ev.ui === 'back') {
          this.close();
          return true;
        }
        label.textContent = String(q);
        return true;
      }
    }
    this.ctx.ui.open(new QtyLayer());
  }

  private leave() {
    this.ctx.send({ type: 'command', action: 'store_leave' });
  }

  handleInput(ev: InputEvent): boolean {
    if (ev.ui === 'tabNext' || ev.ui === 'tabPrev' || ev.ui === 'left' || ev.ui === 'right') {
      this.setMode(this.mode === 'buy' ? 'sell' : 'buy');
      return true;
    }
    if (ev.ui === 'menu') {
      this.leave();
      return true;
    }
    this.menu.handleInput(ev);
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Death                                                               */
/* ------------------------------------------------------------------ */

export class DeathLayer extends Layer {
  private menu: ListMenu<string>;

  constructor(private ctx: UiContext, private onNewGame: () => void) {
    super('death-layer');
    const p = ctx.state.player;
    this.menu = new ListMenu<string>({
      items: [
        { label: 'New character', data: 'new' },
        { label: 'Message history', data: 'log' },
      ],
      letters: false,
      onSelect: (i) => {
        if (i.data === 'new') this.onNewGame();
        else openMessageLog(ctx);
      },
    });
    this.el.append(h('div', { class: 'tombstone' },
      h('div', { class: 'rip' }, 'R.I.P.'),
      h('div', { class: 'char-name' }, p?.name ?? ''),
      h('div', {}, p ? `the level ${p.level} ${p.race} ${p.class}` : ''),
      h('div', {}, p?.diedFrom ? `Killed by ${p.diedFrom}` : ''),
      h('div', {}, p ? `at ${p.depth * 50} feet, turn ${ctx.state.turn}` : ''),
      this.menu.el));
  }

  handleInput(ev: InputEvent): boolean {
    this.menu.handleInput(ev);
    return true;
  }
}

export function controlsHelp(): HTMLElement {
  const rows: [string, string, string][] = [
    ['Move forward / back', 'W / S, ↑ / ↓', 'Left stick, D-pad ↑/↓'],
    ['Strafe', 'A / D', 'Left stick ←/→'],
    ['Turn 45°', 'Q / E, ← / →', 'Right stick, D-pad ←/→'],
    ['Run', 'Shift + W', '—'],
    ['Interact (stairs, pick up, open, attack ahead)', 'Space / Enter', 'A'],
    ['Attack / fire at nearest', 'F', 'RT'],
    ['Auto-explore', 'X', 'X'],
    ['Cycle target', 'Tab / Shift+Tab', 'RB'],
    ['Inventory & equipment', 'I', 'Y'],
    ['Cast a spell', 'Z', 'LT'],
    ['Quick actions (rest, stairs, doors, …)', 'V', 'LB'],
    ['Rest', 'R', 'LB ▸ Rest'],
    ['Wait a turn', '. or Numpad 5', 'R3'],
    ['Map', 'M', 'Select'],
    ['Character', 'C', '—'],
    ['Stairs up / down', '< / >', 'A on stairs'],
    ['Absolute direction walk', 'Numpad 1-9', '—'],
    ['Pause / system menu', 'Esc', 'Start'],
  ];
  return h('table', { class: 'controls' },
    h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Keyboard'), h('th', {}, 'Controller')),
    rows.map(([a, k, g]) => h('tr', {}, h('td', {}, a), h('td', {}, k), h('td', {}, g))),
    h('tr', {}, h('td', { colspan: 3, class: 'note' },
      'Turning only changes your view and never takes a game turn. Every action is executed by the Angband engine.')));
}
