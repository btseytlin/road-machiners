// The People tab of a town screen: the town's locals, and a conversation with one of them. Which topics are on
// offer, what work a local names and what asking changes all come from src/sim/locals.ts. This view keeps only
// who the player is talking to and the last thing they said.

import { LOCAL_TOPICS, type LocalId, type LocalTopicId } from "../data/locals";
import { askLocal, localDef, localsAt, localTopics, localWork, takeLocalWork, workLine } from "../sim/dialogue-rules";
import type { Contract } from "../sim/market";
import type { World } from "../sim/types";
import { createIcon } from "./cards";
import { el } from "./dom";
import { contractSummary, contractWindow } from "./format";
import { moneyText } from "./units";

// A local's offer line with the contract's terms in place of `{terms}`.
export function offerText(line: string, c: Contract): string {
  return line.replace("{terms}", `${contractSummary(c)}, pays ${moneyText(c.reward)}, within ${contractWindow(c)}.`);
}

type Said = { topic: LocalTopicId; ask: string; line: string; offer: Contract | null };

export class PeopleView {
  private local: LocalId | null = null;
  private said: Said | null = null;

  // run applies a command and redraws the town screen, showing a refused command's reason there.
  constructor(private run: (cmd: (w: World) => World) => void, private redraw: () => void) {}

  // Leaving the town screen ends the conversation.
  reset(): void {
    this.local = null;
    this.said = null;
  }

  render(w: World, town: string): HTMLElement {
    if (this.local === null) return this.people(town);
    return this.conversation(w, this.local);
  }

  private people(town: string): HTMLElement {
    return el(
      "div",
      { class: "people" },
      ...localsAt(town).map((l) =>
        el(
          "button",
          { class: "person", "data-local": l.id, onclick: () => this.open(l.id) },
          createIcon("driver"),
          el("b", {}, l.name),
          el("span", { class: "dim" }, l.role),
        ),
      ),
    );
  }

  private conversation(w: World, localId: LocalId): HTMLElement {
    const local = localDef(localId);
    return el(
      "div",
      { class: "talk" },
      el("div", { class: "talk-head" }, createIcon("driver"), el("b", {}, local.name), el("span", { class: "dim" }, local.role)),
      el("div", { class: "talk-line" }, local.greeting),
      this.said ? el("div", { class: "talk-ask" }, this.said.ask) : null,
      this.said ? el("div", { class: "talk-line" }, this.said.line) : null,
      this.said?.offer ? this.offerButtons(localId, this.said.offer) : null,
      el(
        "div",
        { class: "talk-topics" },
        ...localTopics(w, localId).map(({ id, topic }) => el("button", { "data-topic": id, onclick: () => this.ask(localId, id) }, topic.ask)),
        el("button", { class: "talk-back", onclick: () => this.back() }, "Back"),
      ),
    );
  }

  private offerButtons(localId: LocalId, offer: Contract): HTMLElement {
    return el(
      "div",
      { class: "talk-offer" },
      el("button", { "data-offer": "take", onclick: () => this.take(localId, offer.id) }, "I'll take it"),
      el("button", { onclick: () => this.decline() }, "Not now"),
    );
  }

  private open(localId: LocalId): void {
    this.local = localId;
    this.said = null;
    this.redraw();
  }

  private back(): void {
    this.reset();
    this.redraw();
  }

  private ask(localId: LocalId, topicId: LocalTopicId): void {
    const topic = LOCAL_TOPICS[topicId];
    this.run((w) => {
      const next = askLocal(w, localId, topicId);
      this.said = topic.work ? this.workSaid(next, localId, topicId) : { topic: topicId, ask: topic.ask, line: topic.answer, offer: null };
      return next;
    });
  }

  private workSaid(w: World, localId: LocalId, topicId: LocalTopicId): Said {
    const offer = localWork(w, localId);
    const line = workLine(w, localId, topicId);
    return { topic: topicId, ask: LOCAL_TOPICS[topicId].ask, line: offer ? offerText(line, offer) : line, offer };
  }

  private take(localId: LocalId, contractId: string): void {
    this.run((w) => {
      const next = takeLocalWork(w, localId, contractId);
      this.said = null;
      return next;
    });
  }

  private decline(): void {
    this.said = null;
    this.redraw();
  }
}
