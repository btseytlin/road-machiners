// Tiny DOM builder for the HTML overlay.
import { bindAttr, TEXT_ATTRS, textNode, type TextAttr } from '../text/language';
import { Msg } from '../text/msg';

// Text attributes take only a Msg, so every word a player reads goes through the catalog.
type TextAttrs = { [K in TextAttr]?: Msg };
type Attrs = TextAttrs & Record<string, string | number | boolean | Msg | ((e: Event) => void) | undefined>;
export type Child = Node | Msg | null;

// A Msg child becomes a bound text node, and a Msg title, aria-label, placeholder or alt a bound attribute, so a
// language switch rewrites them in place.
export function el(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) setAttr(node, k, v);
  for (const c of children) if (c !== null) node.append(Msg.is(c) ? textNode(c) : c);
  return node;
}

// The builder for dev pages and the debug console, which stay English and take plain strings. See
// docs/architecture/text.md for the surfaces it may serve.
export function devEl(tag: string, attrs: Record<string, string | number | boolean | ((e: Event) => void) | undefined> = {}, ...children: (Node | string | null)[]): HTMLElement {
  const node = el(tag, attrs);
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

function setAttr(node: HTMLElement, k: string, v: Attrs[string]): void {
  if (v === undefined || v === false) return;
  if (Msg.is(v)) return bindText(node, k, v);
  if (typeof v === 'function') return node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
  setPlainAttr(node, k, v);
}

function setPlainAttr(node: HTMLElement, k: string, v: string | number | true): void {
  if (k === 'class') node.className = String(v);
  else if (v === true) node.setAttribute(k, '');
  else node.setAttribute(k, String(v));
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

// The instruments and weapons in the bottom left corner flow in one wrapping row.
export function bottomLeft(): HTMLElement {
  const root = uiRoot();
  const found = root.querySelector<HTMLElement>(':scope > .bottom-left');
  if (found) return found;
  const row = el('div', { class: 'bottom-left' });
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

// Game keys are bare keys. A keydown with Ctrl, Cmd or Alt held belongs to the browser and the OS.
export function isBrowserChord(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

function bindText(node: HTMLElement, k: string, msg: Msg): void {
  const attr = TEXT_ATTRS.find((a) => a === k);
  if (!attr) throw new Error(`Attribute "${k}" does not take text`);
  bindAttr(node, attr, msg);
}
