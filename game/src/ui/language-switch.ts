// The language control: a label and one button per language, each named in its own language. The active one is
// pressed. A click switches the language at once. Language owns the choice and tells the game to redraw.

import { type Language } from "../text/language";
import { LOCALES, t, type Locale } from "../text/msg";
import { el } from "./dom";

export class LanguageSwitch {
  readonly root: HTMLElement;
  private readonly buttons: Map<Locale, HTMLElement>;

  constructor(parent: HTMLElement, private readonly language: Language) {
    this.buttons = new Map(LOCALES.map((locale) => [locale, this.button(locale)]));
    this.root = el("div", { class: "language-switch", role: "group", "aria-label": t("language.label") },
      el("span", { class: "language-label" }, t("language.label")),
      ...this.buttons.values(),
    );
    parent.append(this.root);
    this.mark();
    language.subscribe(() => this.mark());
  }

  private button(locale: Locale): HTMLElement {
    return el("button", { class: "language-option", lang: locale, "data-lang": locale, onclick: () => this.language.set(locale) }, t(`language.${locale}`));
  }

  // The pressed button follows the active language, also when another control switched it.
  private mark(): void {
    for (const [locale, button] of this.buttons) button.setAttribute("aria-pressed", String(locale === this.language.current()));
  }
}
