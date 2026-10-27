/**
 * Controller button glyphs.  While a controller is in use, every <kbd>
 * button prompt anywhere in the UI ("A", "Hold LT", "LB/RB", "D-pad ↑/↓")
 * is drawn as the buttons themselves: coloured face buttons (Xbox green A,
 * red B, blue X, yellow Y; PlayStation's coloured shapes; Nintendo's plain
 * letters), shaped bumpers and triggers, sticks and the d-pad.  Screens
 * keep writing plain labels; a MutationObserver restyles them as they
 * appear, and everything is redrawn when the device or family changes.
 */
import type { GlyphStyle } from '../input/actions.ts';
import { h } from './dom.ts';

type Kind = 'face' | 'bumper' | 'trigger' | 'stick' | 'menu' | 'dpad';

/** Button label -> glyph kind and colour class, per controller family */
const BUTTONS: Record<GlyphStyle, Record<string, [Kind, string?]>> = {
  xbox: {
    A: ['face', 'green'], B: ['face', 'red'], X: ['face', 'blue'], Y: ['face', 'yellow'],
    LB: ['bumper'], RB: ['bumper'], LT: ['trigger'], RT: ['trigger'], L3: ['stick'], R3: ['stick'],
    Start: ['menu'], Select: ['menu'],
  },
  playstation: {
    '✕': ['face', 'ps-blue'], '○': ['face', 'ps-red'], '□': ['face', 'ps-pink'], '△': ['face', 'ps-green'],
    L1: ['bumper'], R1: ['bumper'], L2: ['trigger'], R2: ['trigger'], L3: ['stick'], R3: ['stick'],
    Options: ['menu'], Share: ['menu'],
  },
  nintendo: {
    A: ['face', 'mono'], B: ['face', 'mono'], X: ['face', 'mono'], Y: ['face', 'mono'],
    L: ['bumper'], R: ['bumper'], ZL: ['trigger'], ZR: ['trigger'], LS: ['stick'], RS: ['stick'],
    '+': ['menu'], '−': ['menu'],
  },
};

const ARROWS = /^[↑↓←→]+$/;

/** Glyph pieces for a label, or null if any part is not a button (a keyboard key) */
export function parseLabel(label: string, style: GlyphStyle): (string | [Kind, string, string?])[] | null {
  const out: (string | [Kind, string, string?])[] = [];
  const table = BUTTONS[style];
  for (const word of label.trim().split(/\s+/)) {
    if (word === 'Hold') { out.push('Hold'); continue; }
    if (word === 'D-pad') { out.push(['dpad', '']); continue; }
    for (const piece of word.split(/(\/)/)) {
      if (!piece) continue;
      if (piece === '/' || ARROWS.test(piece)) { out.push(piece); continue; }
      // Sticks pushed a way: "L↑", "R←"
      const stick = /^([LR])([↑↓←→])$/.exec(piece);
      if (stick) { out.push(['stick', stick[1]], stick[2]); continue; }
      const b = table[piece];
      if (!b) return null;
      out.push([b[0], piece, b[1]]);
    }
  }
  return out.some((p) => typeof p !== 'string') ? out : null;
}

function decorate(kbd: HTMLElement, style: GlyphStyle | null): void {
  const label = kbd.dataset.label ?? kbd.textContent ?? '';
  const parts = style ? parseLabel(label, style) : null;
  if (!parts) {
    // Back to plain text (the keyboard took over)
    if (kbd.dataset.label !== undefined) {
      kbd.textContent = label;
      kbd.classList.remove('pad');
      delete kbd.dataset.label;
    }
    return;
  }
  kbd.dataset.label = label;
  kbd.classList.add('pad');
  kbd.replaceChildren(...parts.map((p) => typeof p === 'string'
    ? h('span', { class: p === 'Hold' ? 'g-hold' : 'g-sep' }, p)
    : h('span', { class: `g g-${p[0]}${p[2] ? ` g-${p[2]}` : ''}`, title: p[1] }, p[0] === 'dpad' ? '' : p[1])));
}

/**
 * Restyle button prompts while `style()` returns a family (a controller is
 * in use), and plain keys otherwise.  Returns a function to call when the
 * device or family changes.
 */
export function installPadGlyphs(root: HTMLElement, style: () => GlyphStyle | null): () => void {
  const all = () => root.querySelectorAll<HTMLElement>('kbd');
  new MutationObserver((records) => {
    const s = style();
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.tagName === 'KBD') decorate(n, s);
        else n.querySelectorAll<HTMLElement>('kbd').forEach((k) => decorate(k, s));
      }
      // A label rewritten in place (its text node replaced)
      const k = r.target instanceof HTMLElement && r.target.tagName === 'KBD' ? r.target : null;
      if (k && !k.querySelector('.g, .g-hold, .g-sep')) {
        delete k.dataset.label;
        decorate(k, s);
      }
    }
  }).observe(root, { childList: true, subtree: true });
  return () => {
    const s = style();
    all().forEach((k) => decorate(k, s));
  };
}
