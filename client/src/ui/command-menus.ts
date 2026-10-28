/**
 * Command menus that make every engine command reachable from a controller
 * (and the keyboard): the Use menu (X / U) and All commands (Select / V),
 * grouped by category.  Commands that need an item, a direction or a
 * target ask for it through the engine's own prompts.
 */
import type { CommandMessage } from '@thang/protocol';
import type { UiContext } from './context.ts';
import type { Layer } from './layer.ts';
import type { MenuItem } from './list-menu.ts';
import { MenuLayer } from './menu-layer.ts';

type Run = () => void;

export interface CommandMenuExtras {
  save: () => void;
  panels: (which: 'monsterList' | 'itemList' | 'recall' | 'character') => void;
  map: () => void;
  look: () => void;
  aim: () => void;
  messages: () => void;
  system: () => void;
}

function cmd(ctx: UiContext, c: Omit<CommandMessage, 'type'>): Run {
  return () => ctx.send({ type: 'command', ...c } as CommandMessage);
}

/** A list of commands; picking one closes it (and the list it came from) before running it */
function open(ctx: UiContext, title: string, items: MenuItem<Run>[], subtitle?: string, parent?: Layer) {
  const layer: MenuLayer<Run> = new MenuLayer(ctx, {
    title,
    subtitle,
    items,
    letters: true,
    onSelect: (i) => {
      layer.close();
      parent?.close();
      i.data();
    },
  });
  ctx.ui.open(layer);
}

/** X / U: spells and every kind of item use, the things you reach for in a fight */
export function openUseMenu(ctx: UiContext): void {
  const p = ctx.state.player;
  const c = (x: Omit<CommandMessage, 'type'>) => cmd(ctx, x);
  const items: MenuItem<Run>[] = [];
  if (p?.canCast) {
    items.push({ label: p.spellNoun ? `Cast a ${p.spellNoun}` : 'Cast a spell', data: c({ action: 'cast' }) });
    items.push({ label: 'Study a book', detail: 'learn a new spell', data: c({ action: 'study' }) });
  }
  items.push(
    { label: 'Quaff a potion', data: c({ action: 'quaff' }) },
    { label: 'Read a scroll', data: c({ action: 'read' }) },
    { label: 'Aim a wand', data: c({ action: 'aim_wand' }) },
    { label: 'Use a staff', data: c({ action: 'use_staff' }) },
    { label: 'Zap a rod', data: c({ action: 'zap_rod' }) },
    { label: 'Activate an item', data: c({ action: 'activate' }) },
    { label: 'Fire a missile', data: c({ action: 'fire' }) },
    { label: 'Throw an item', data: c({ action: 'throw' }) },
    { label: 'Eat something', data: c({ action: 'eat' }) },
    { label: 'Use any item', data: c({ action: 'use' }) },
  );
  open(ctx, 'Use', items);
}

/** Select / V: every command, by category */
export function openCommandMenu(ctx: UiContext, x: CommandMenuExtras): void {
  const c = (m: Omit<CommandMessage, 'type'>) => cmd(ctx, m);
  const p = ctx.state.player;
  const categories: [string, string, MenuItem<Run>[]][] = [
    ['Move & explore', 'stairs, travel, running, resting', [
      { label: 'Auto-explore', data: c({ action: 'explore' }) },
      { label: 'Travel to the nearest down staircase', data: c({ action: 'navigate_down' }) },
      { label: 'Travel to the nearest up staircase', data: c({ action: 'navigate_up' }) },
      { label: 'Go down a staircase', data: c({ action: 'go_down' }) },
      { label: 'Go up a staircase', data: c({ action: 'go_up' }) },
      { label: 'Run (choose direction)', data: c({ action: 'run' }) },
      { label: 'Walk into a trap (jump)', detail: 'step without disarming', data: c({ action: 'jump' }) },
      { label: 'Hold / wait a turn', data: c({ action: 'hold' }) },
      { label: 'Rest as needed', detail: 'until HP/SP full or disturbed', data: c({ action: 'rest', mode: 'as_needed' }) },
      { label: 'Rest until HP & SP full', data: c({ action: 'rest', mode: 'hp_sp' }) },
      { label: 'Rest until HP or SP full', data: c({ action: 'rest', mode: 'hp_or_sp' }) },
      { label: 'Rest 10 turns', data: c({ action: 'rest', mode: 'turns', turns: 10 }) },
      { label: 'Rest 100 turns', data: c({ action: 'rest', mode: 'turns', turns: 100 }) },
    ]],
    ['Doors & terrain', 'open, close, dig, disarm', [
      { label: 'Open a door or chest', data: c({ action: 'open' }) },
      { label: 'Close a door', data: c({ action: 'close' }) },
      { label: 'Tunnel / dig', data: c({ action: 'tunnel' }) },
      { label: 'Disarm a trap or chest', data: c({ action: 'disarm' }) },
      { label: 'Alter terrain', detail: 'the right action for what is there', data: c({ action: 'alter' }) },
      ...(p?.class === 'Rogue'
        ? [{ label: 'Steal from a monster', data: c({ action: 'steal' }) }] : []),
    ]],
    ['Items', 'use, wear, carry, inscribe', [
      { label: 'Use any item', data: c({ action: 'use' }) },
      { label: 'Quaff a potion', data: c({ action: 'quaff' }) },
      { label: 'Read a scroll', data: c({ action: 'read' }) },
      { label: 'Eat something', data: c({ action: 'eat' }) },
      { label: 'Aim a wand', data: c({ action: 'aim_wand' }) },
      { label: 'Use a staff', data: c({ action: 'use_staff' }) },
      { label: 'Zap a rod', data: c({ action: 'zap_rod' }) },
      { label: 'Activate an item', data: c({ action: 'activate' }) },
      { label: 'Wear or wield', data: c({ action: 'wield' }) },
      { label: 'Take off', data: c({ action: 'takeoff' }) },
      { label: 'Drop an item', data: c({ action: 'drop' }) },
      { label: 'Pick up', data: c({ action: 'pickup' }) },
      { label: 'Pick up what you would auto-pick-up', data: c({ action: 'autopickup' }) },
      { label: 'Refill your light', detail: 'oil flask or another torch', data: c({ action: 'refill' }) },
      { label: 'Inscribe an item', data: c({ action: 'inscribe' }) },
      { label: 'Remove an inscription', data: c({ action: 'uninscribe' }) },
      { label: 'Show or hide ignored items', data: c({ action: 'toggle_unignore' }) },
    ]],
    ['Combat & magic', 'targets, missiles, spells', [
      { label: 'Aim and fire', detail: 'pick a target first', data: x.aim },
      { label: 'Fire at the nearest monster', data: c({ action: 'fire_at_nearest' }) },
      { label: 'Fire a missile', data: c({ action: 'fire' }) },
      { label: 'Throw an item', data: c({ action: 'throw' }) },
      { label: 'Target the closest monster', data: c({ action: 'target_closest' }) },
      { label: 'Clear the target', data: c({ action: 'target_clear' }) },
      ...(p?.canCast ? [
        { label: p.spellNoun ? `Cast a ${p.spellNoun}` : 'Cast a spell', data: c({ action: 'cast' }) },
        { label: 'Study a book', data: c({ action: 'study' }) },
      ] : []),
    ]],
    ['Look & knowledge', 'examine, lists, map, character', [
      { label: 'Examine (look around)', data: x.look },
      { label: 'Visible monsters', data: () => x.panels('monsterList') },
      { label: 'Visible items', data: () => x.panels('itemList') },
      { label: 'Recall (tracked monster or item)', data: () => x.panels('recall') },
      { label: 'Level map', data: x.map },
      { label: 'Character sheet', data: () => x.panels('character') },
      { label: 'Message history', data: x.messages },
      { label: 'Repeat the level feeling', data: c({ action: 'feeling' }) },
    ]],
    ['System', ctx.canQuit ? 'save, options, quit' : 'save, options', [
      { label: 'Save game', data: x.save },
      ...(p?.winner ? [{ label: 'Retire', detail: 'end the game as a winner', data: c({ action: 'retire' }) }] : []),
      { label: ctx.canQuit ? 'Options, controls and quit…' : 'Options and controls…', data: x.system },
    ]],
  ];
  const layer: MenuLayer<Run> = new MenuLayer(ctx, {
    title: 'All commands',
    items: categories.map(([label, detail, items]) => ({
      label, detail, data: () => open(ctx, label, items, undefined, layer),
    })),
    letters: true,
    onSelect: (i) => i.data(),
  });
  ctx.ui.open(layer);
}
