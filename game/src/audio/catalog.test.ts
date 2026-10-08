import { describe, expect, it } from "vitest";
import { filesOf, SOUNDS } from "../data/sounds";

const onDisk = Object.keys(import.meta.glob("/public/sfx/*")).map((p) => p.split("/").pop()!);

describe("sound catalog", () => {
  it("claims every file in public/sfx", () => {
    const claimed = Object.values(SOUNDS).flatMap((c) => c.files);
    expect([...claimed].sort()).toEqual([...onDisk].sort());
  });
  it("matches variants by exact cue name, in number order", () => {
    const files = ["mg-fire-10.ogg", "mg-fire-2.ogg", "mg-fire-x.ogg", "big-mg-fire-1.ogg", "mg-fire-1.wav"];
    expect(filesOf("mg-fire", files)).toEqual(["mg-fire-2.ogg", "mg-fire-10.ogg"]);
  });
});
