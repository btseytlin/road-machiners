import { t, type Msg } from "../text/msg";
import { el } from "./dom";

export interface SwitchOptions {
  // The option named above the lever, chosen while `on` is true.
  on: Msg;
  // The option named below the lever, chosen while `on` is false.
  off: Msg;
  checked: boolean;
  // The shortcut letter, shown next to the chosen option. Omit when the switch has none.
  key?: string;
  title: Msg;
  disabled?: boolean;
  onclick: () => void;
}

// A metal toggle switch for a binary choice. The lever leans toward the chosen option, which glows.
export function createSwitch(o: SwitchOptions): HTMLElement {
  const option = (name: Msg, chosen: boolean) =>
    el(
      "span",
      { class: chosen ? "switch-option chosen" : "switch-option" },
      name,
      chosen && o.key ? el("kbd", {}, t("ui.key", { key: o.key })) : null,
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
