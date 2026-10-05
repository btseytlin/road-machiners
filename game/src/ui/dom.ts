// Tiny DOM builder for the HTML overlay.

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function el(tag: string, attrs: Attrs = {}, ...children: (Node | string | null)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') node.className = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

export function uiRoot(): HTMLElement {
  const root = document.getElementById('ui');
  if (!root) throw new Error('#ui element missing from index.html');
  return root;
}

// Panels in the top left corner sit side by side in one row.
export function topLeft(): HTMLElement {
  const root = uiRoot();
  const found = root.querySelector<HTMLElement>(':scope > .top-left');
  if (found) return found;
  const row = el('div', { class: 'top-left' });
  root.append(row);
  return row;
}

// Panels in the top right corner sit side by side in one row.
export function topRight(): HTMLElement {
  const root = uiRoot();
  const found = root.querySelector<HTMLElement>(':scope > .top-right');
  if (found) return found;
  const row = el('div', { class: 'top-right' });
  root.append(row);
  return row;
}

// Panels in the right column above the log stack upward in one column. See .right-dock in style.css.
export function rightDock(): HTMLElement {
  const root = uiRoot();
  const found = root.querySelector<HTMLElement>(':scope > .right-dock');
  if (found) return found;
  const dock = el('div', { class: 'right-dock' });
  root.append(dock);
  return dock;
}

// A screen box, as getBoundingClientRect() gives.
export type Box = { left: number; top: number; right: number; bottom: number };

const isEmpty = (b: Box): boolean => b.right <= b.left || b.bottom <= b.top;

// Whether two boxes share area. Boxes that only touch do not, and an empty box, as a hidden panel measures, never does.
export function overlaps(a: Box, b: Box): boolean {
  if (isEmpty(a) || isEmpty(b)) return false;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function panel(cls: string, parent: HTMLElement = uiRoot()): HTMLElement {
  const p = el('div', { class: `panel ${cls}` });
  // Keep clicks on panels from reaching the game canvas.
  p.addEventListener('pointerdown', (e) => e.stopPropagation());
  p.addEventListener('wheel', (e) => e.stopPropagation());
  parent.append(p);
  return p;
}

// Hands the browser a file to download.
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, download: name });
  link.click();
  // The download starts after this task, so the file must outlive it.
  setTimeout(() => URL.revokeObjectURL(url));
}

// Game keys are bare keys. A keydown with Ctrl, Cmd or Alt held belongs to the browser and the OS.
export function isBrowserChord(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}
