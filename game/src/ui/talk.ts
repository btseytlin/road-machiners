// The People tab of a town screen: the town's locals. Picking one starts their ink quest, which the talk window
// in src/ui/quest-screen.ts shows.

import { localsAt } from "../sim/dialogue-rules";
import { QUESTS, startQuest } from "../sim/quests";
import type { World } from "../sim/types";
import { createIcon } from "./cards";
import { el } from "./dom";

export function peopleList(town: string, run: (cmd: (w: World) => World) => void): HTMLElement {
  return el(
    "div",
    { class: "people" },
    ...localsAt(town).map((l) =>
      el(
        "button",
        { class: "person", "data-local": l.id, onclick: () => run((w) => startQuest(w, QUESTS, l.quest, "start")) },
        createIcon("driver"),
        el("b", {}, l.name),
        el("span", { class: "dim" }, l.role),
      ),
    ),
  );
}
