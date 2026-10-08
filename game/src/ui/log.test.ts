import { describe, expect, it } from "vitest";
import { TIME } from "../data/time";
import { clockLabel } from "./format";
import { LOG_HISTORY, LogBook } from "./log";

describe("LogBook", () => {
  it("leads a plain line with the HUD clock stamp", () => {
    const line = new LogBook().add(1, { text: "Engine on", cls: "good" });
    expect(clockLabel(1)).toBe("Day 1 7:00");
    expect(line.text).toBe("Day 1 7:00 Engine on");
    expect(line.spans).toEqual([
      { text: "Day 1 7:00", cls: "log-time" },
      { text: "Engine on", cls: "good" },
    ]);
  });

  it("keeps the spans of a span line after the stamp", () => {
    const spans = [{ text: "a", cls: "x" }, { text: "b", cls: "" }];
    const line = new LogBook().add(TIME.turnsPerDay + 1, { text: "ab", cls: "bad", spans });
    expect(line.spans).toEqual([{ text: clockLabel(TIME.turnsPerDay + 1), cls: "log-time" }, ...spans]);
    expect(line.text.startsWith("Day 2 ")).toBe(true);
  });

  it("keeps the newest lines first and caps the history", () => {
    const book = new LogBook();
    for (let i = 0; i < LOG_HISTORY + 5; i++) book.add(i, { text: `n${i}`, cls: "" });
    expect(book.lines).toHaveLength(LOG_HISTORY);
    expect(book.lines[0].text.endsWith(`n${LOG_HISTORY + 4}`)).toBe(true);
    expect(book.lines[LOG_HISTORY - 1].text.endsWith("n5")).toBe(true);
    expect(book.lines.every((l) => !/^T\d+ /.test(l.text))).toBe(true);
  });
});
