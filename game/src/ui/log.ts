import { bindAttr } from "../text/language";
import { t } from "../text/msg";
import { el, panel } from "./dom";
import { clock, type LogLine } from "./format";

export const LOG_HISTORY = 200;

// The session's log lines, newest first, each led by the game day and time. Lines keep their messages, not their
// words, so the whole history follows a language switch.
export class LogBook {
  private history: LogLine[] = [];

  get lines(): readonly LogLine[] {
    return this.history;
  }

  add(turn: number, line: LogLine): LogLine {
    const stamp = clock(turn).full;
    const stamped: LogLine = {
      text: t("log.stamped", { time: stamp, line: line.text }),
      cls: line.cls,
      spans: [{ text: stamp, cls: "log-time" }, ...(line.spans ?? [{ text: line.text, cls: line.cls }])],
    };
    this.history.unshift(stamped);
    if (this.history.length > LOG_HISTORY) this.history.length = LOG_HISTORY;
    return stamped;
  }
}

function lineRow(l: LogLine): HTMLElement {
  const spans = l.spans ?? [{ text: l.text, cls: "" }];
  return el(
    "div",
    { class: l.cls },
    ...spans.map((sp) => el("span", { class: sp.cls }, sp.text)),
  );
}

// The log panel. New lines go on top, and a reader scrolled back in the history keeps their place.
export class LogPanel {
  private book = new LogBook();
  private root = panel("log");
  private box = el("div", { class: "log-lines", tabindex: 0 });
  private toggle = el(
    "button",
    {
      class: "log-expand",
      title: t("log.expand"),
      "aria-label": t("log.expand"),
      onclick: () => this.flip(),
    },
    t("log.expandMark"),
  );

  constructor() {
    bindAttr(this.root, "aria-label", t("log.panel"));
    this.root.append(
      el("div", { class: "log-head" }, el("h3", {}, t("log.title")), this.toggle),
      this.box,
    );
  }

  add(turn: number, lines: LogLine[]): void {
    if (lines.length === 0) return;
    const reading = this.box.scrollTop > 0;
    const before = this.box.scrollHeight;
    for (const line of lines) {
      this.box.prepend(lineRow(this.book.add(turn, line)));
    }
    while (this.box.children.length > this.book.lines.length) this.box.lastElementChild?.remove();
    if (reading) this.box.scrollTop += this.box.scrollHeight - before;
  }

  private flip(): void {
    const expanded = this.root.classList.toggle("expanded");
    const title = expanded ? t("log.shrink") : t("log.expand");
    bindAttr(this.toggle, "title", title);
    bindAttr(this.toggle, "aria-label", title);
  }
}
