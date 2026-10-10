// The active language and the live text bound to it. Language alone owns which language the player reads. It is a
// display setting: it lives under its own storage key, never in the World or a save.
import { sameMsg, type DevLocale, type Locale, LOCALES, type Msg } from './msg';
import { resolve } from './resolve';

export const LANGUAGE_KEY = 'roam.lang';

type LangStore = Pick<Storage, 'getItem' | 'setItem'>;

export class Language {
  #current: DevLocale;
  readonly #subscribers = new Set<() => void>();

  constructor(
    initial: DevLocale,
    private readonly storage: LangStore | null,
    private readonly root: { lang: string } | null,
  ) {
    this.#current = initial;
    if (root) root.lang = initial === 'pseudo' ? 'en' : initial;
  }

  current(): DevLocale {
    return this.#current;
  }

  // Switches the language, stores the choice and tells every subscriber. Picking the active language does nothing.
  set(locale: DevLocale): void {
    if (locale === this.#current) return;
    this.#current = locale;
    if (locale === 'pseudo') this.#mark('en');
    else this.#store(locale);
    for (const fn of this.#subscribers) fn();
  }

  #store(locale: Locale): void {
    this.storage?.setItem(LANGUAGE_KEY, locale);
    this.#mark(locale);
  }

  #mark(lang: string): void {
    if (this.root) this.root.lang = lang;
  }

  subscribe(fn: () => void): () => void {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }
}

let active = new Language('en', null, null);

// English unless the stored choice says otherwise. ?lang=pseudo picks the pseudo locale in dev only, and it is never
// stored.
export function loadLanguage(storage: LangStore, search: string, dev: boolean, root: { lang: string } | null): Language {
  const asked = new URLSearchParams(search).get('lang');
  const stored = storage.getItem(LANGUAGE_KEY);
  const saved = LOCALES.find((l) => l === stored) ?? 'en';
  active = new Language(dev && asked === 'pseudo' ? 'pseudo' : saved, storage, root);
  return active;
}

export function language(): Language {
  return active;
}

// The words of a message in the active language, for text that cannot stay bound: confirm(), canvas and dates.
export function say(msg: Msg): string {
  return resolve(msg, active.current());
}

export type TextAttr = 'title' | 'aria-label' | 'aria-valuetext' | 'placeholder' | 'alt' | 'data-reason';
export const TEXT_ATTRS: readonly TextAttr[] = ['title', 'aria-label', 'aria-valuetext', 'placeholder', 'alt', 'data-reason'];

const boundText = new WeakMap<Text, Msg>();
const boundAttrs = new WeakMap<Element, Map<TextAttr, Msg>>();
const shown = new WeakMap<Element, { msg: Msg; locale: DevLocale }>();

// A text node that relocalize() rewrites on a language switch.
export function textNode(msg: Msg): Text {
  const node = document.createTextNode(say(msg));
  boundText.set(node, msg);
  return node;
}

export function bindAttr(el: Element, name: TextAttr, msg: Msg): void {
  const attrs = boundAttrs.get(el) ?? new Map<TextAttr, Msg>();
  attrs.set(name, msg);
  boundAttrs.set(el, attrs);
  el.setAttribute(name, say(msg));
}

export function unbindAttr(el: Element, name: TextAttr): void {
  boundAttrs.get(el)?.delete(name);
  el.removeAttribute(name);
}

// Replaces an element's content with a bound message. A view that redraws every frame calls it freely, since an
// unchanged message writes nothing.
export function setText(el: Element, msg: Msg): void {
  const last = shown.get(el);
  const locale = active.current();
  if (last && last.locale === locale && sameMsg(last.msg, msg) && el.firstChild && boundText.has(el.firstChild as Text)) return;
  shown.set(el, { msg, locale });
  el.replaceChildren(textNode(msg));
}

// Rewrites every bound text node and text attribute under root in the active language. It runs once per switch.
export function relocalize(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) relocalizeNode(node);
}

function relocalizeNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const msg = boundText.get(node as Text);
    if (msg) node.textContent = say(msg);
    return;
  }
  const attrs = boundAttrs.get(node as Element);
  if (!attrs) return;
  for (const [name, msg] of attrs) (node as Element).setAttribute(name, say(msg));
}

// Whether a text node shows a bound message, for the layout checker's leak test.
export function boundMsg(node: Text): Msg | undefined {
  return boundText.get(node);
}
