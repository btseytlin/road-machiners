import { describe, expect, it } from "vitest";
import { clockLabel } from "./format";
import { slotDetail, slotRealTime } from "./save-panel";

describe("save slot row", () => {
  it("shows the game clock in the HUD form, without the real date", () => {
    const detail = slotDetail({ slot: "slot1", savedAt: Date.UTC(2026, 9, 9), turn: 0 });
    expect(detail).toEqual({ text: clockLabel(0), tone: "num" });
    expect(detail.text).toMatch(/^Day \d+ \d{1,2}:\d{2}$/);
  });

  it("keeps the real time for the tooltip", () => {
    const savedAt = Date.UTC(2026, 9, 9, 16, 22, 50);
    expect(slotRealTime({ slot: "slot1", savedAt, turn: 0 })).toBe(new Date(savedAt).toLocaleString());
  });

  it("reads an empty slot as faint and gives no tooltip", () => {
    expect(slotDetail(null)).toEqual({ text: "Empty", tone: "dim" });
    expect(slotRealTime(null)).toBe("");
  });

  it("reads a damaged save as a failure", () => {
    expect(slotDetail({ slot: "auto", savedAt: 0, turn: null })).toEqual({ text: "Old or damaged save", tone: "bad" });
    expect(slotRealTime({ slot: "auto", savedAt: 0, turn: null })).toBe("");
  });
});
