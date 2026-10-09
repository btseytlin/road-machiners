import { el } from "./dom";

export interface SwitchOptions {
  on: string;
  off: string;
  checked: boolean;
  key?: string;
  title: string;
  disabled?: boolean;
  onclick: () => void;
}

export function createSwitch(o: SwitchOptions): HTMLElement {
  const option = (name: string, chosen: boolean) =>
    el(
      "span",
      { class: chosen ? "switch-option chosen" : "switch-option" },
      name,
      chosen && o.key ? el("kbd", {}, `[${o.key}]`) : null,
    );
  return el(
    "button",
    {
      class: "switch",
      role: "switch",
      "aria-checked": String(o.checked),
      disabled: o.disabled,
      title: o.title,
      onclick: o.onclick,
    },
    option(o.on, o.checked),
    el(
      "span",
      { class: o.checked ? "switch-lever up" : "switch-lever down" },
      el("span", { class: "switch-nut" }),
      el("span", { class: "switch-bat" }),
    ),
    option(o.off, !o.checked),
  );
}
