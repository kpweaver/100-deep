/** Tiny DOM helpers (no framework needed for this UI) */

type Attrs = Record<string, string | number | boolean | undefined | null | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Append children, skipping null/undefined/false (Element.append would print "null") */
export function add(parent: HTMLElement, ...children: Child[]): void {
  for (const c of children) if (c !== null && c !== undefined && c !== false) parent.append(c);
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** CSS rgb() for an Angband palette colour index */
export function paletteColor(palette: [number, number, number][] | undefined, idx: number): string {
  const c = palette?.[idx];
  return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#ccc';
}
