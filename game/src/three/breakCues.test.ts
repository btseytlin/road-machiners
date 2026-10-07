import { describe, expect, it } from "vitest";
import { fireWeapons } from "../sim/combat";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import type { GameEvent, GridItem, PartInstance, ShotRound } from "../sim/types";
import { breakRounds, BreakCues, shownItems, type ShotLike } from "./breakCues";

const round = (hits: { part: string; damage: number }[] = [], blast: ShotRound["blast"] = [], struck: string | null = "t"): ShotRound => ({
  hit: hits.length > 0, crit: false, offset: 0, struck, hits, blast,
});
const shot = (rounds: ShotRound[]): ShotLike => ({ t: "shot", shooter: "s", weapon: "mg", target: "t", aim: "center", chance: 1, damageChance: 1, side: "front", rounds }) as ShotLike;
const off = (part: string, vehicle = "t"): GameEvent => ({ t: "partDisabled", vehicle, part });
const dmg = (part: string, damage = 3) => ({ part, damage });

describe("breakRounds", () => {
  it("names the last round that damaged the part", () => {
    const s = shot([round([dmg("gun")]), round(), round([dmg("gun")])]);
    const [b] = breakRounds([off("gun"), s]);
    expect(b.owner).toBe(s);
    expect(b.round).toBe(2);
  });

  it("gives one round both parts it broke", () => {
    const s = shot([round([dmg("a"), dmg("b")])]);
    expect(breakRounds([off("a"), off("b"), s]).map((b) => b.round)).toEqual([0, 0]);
  });

  it("finds a blast-only break on the blasted truck", () => {
    const s = shot([round(), round([], [{ vehicle: "t", hits: [dmg("a")] }], null)]);
    expect(breakRounds([off("a"), s])[0].round).toBe(1);
  });

  it("gives a collision break and an unowned break no round", () => {
    const c: GameEvent = { t: "collision", a: "t", b: "x", hitsA: [dmg("a")], hitsB: [] };
    expect(breakRounds([off("a"), c]).map((b) => [b.owner, b.round])).toEqual([[null, null]]);
    expect(breakRounds([off("a")]).map((b) => b.round)).toEqual([null]);
  });

  it("throws when the shot never damaged the part", () => {
    expect(() => breakRounds([off("a"), shot([round([dmg("b")])])])).toThrow();
    expect(() => breakRounds([off("a", "other"), shot([round([dmg("a")])])])).toThrow();
  });

  it("matches the events the sim writes", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const pos = { x: 33, y: 30 };
    const buggy = addVehicle(w, "raiders", "buggy", ["mg", "stockEngine"], pos, Math.PI);
    buggy.brain = npcBrain("buggy", pos, ["raider"]);
    const gun = buggy.items.find((i) => i.kind === "part" && i.part.defId === "mg");
    const mg = me.items.find((i) => i.kind === "part" && i.part.defId === "mg");
    if (!gun || gun.kind !== "part" || !mg || mg.kind !== "part") throw new Error("no mg");
    gun.part.hp = 1;
    me.weaponOrders[mg.part.id] = { targetId: buggy.id, aim: gun.part.id };
    for (let i = 0; i < 20 && w.events.every((e) => e.t !== "partDisabled"); i++) fireWeapons(w);
    const found = breakRounds(w.events);
    expect(found.length).toBeGreaterThan(0);
    for (const b of found) {
      expect(b.owner?.t).toBe("shot");
      expect(b.owner!.rounds[b.round!].hits.some((h) => h.part === b.brk.part && h.damage > 0)).toBe(true);
    }
  });
});

describe("BreakCues", () => {
  const s = shot([round([dmg("a")]), round([dmg("b")])]);
  const c: GameEvent = { t: "collision", a: "t", b: "x", hitsA: [], hitsB: [] };
  const events = [off("a"), off("b"), s, off("z"), c];

  it("hands each break out once", () => {
    const cues = new BreakCues(events);
    expect(cues.ofRound(s, 0)).toEqual([{ vehicle: "t", part: "a" }]);
    expect(cues.ofRound(s, 0)).toEqual([]);
    expect(cues.rest()).toEqual([{ vehicle: "t", part: "b" }, { vehicle: "t", part: "z" }]);
    expect(cues.rest()).toEqual([]);
  });

  it("gives a round nothing once rest took its break", () => {
    const cues = new BreakCues(events);
    cues.rest();
    expect(cues.ofRound(s, 1)).toEqual([]);
  });

  it("lists only played parts", () => {
    const cues = new BreakCues(events);
    cues.ofRound(s, 1);
    expect([...cues.shown("t")]).toEqual(["b"]);
    expect([...cues.shown("other")]).toEqual([]);
  });
});

describe("shownItems", () => {
  const part = (id: string, hp: number): GridItem => ({ id, x: 0, y: 0, rot: 0, kind: "part", part: { id, defId: "mg", hp } as PartInstance });
  it("swaps only played parts and keeps the before place", () => {
    const before = [part("a", 5), part("b", 5)];
    const after = [{ ...part("a", 0), x: 3, y: 2 } as GridItem, part("b", 0)];
    const out = shownItems(before, after, new Set(["a"]));
    expect(out[0]).toMatchObject({ x: 0, y: 0, part: { hp: 0 } });
    expect(out[1]).toBe(before[1]);
    expect(shownItems(before, after, new Set())).toBe(before);
  });
});
