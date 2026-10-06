import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { CONDITION } from "../data/wear";
import type { Contract } from "../sim/market";
import { partDef, PARTS } from "../data/parts";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import type { GameEvent, Job, PartInstance } from "../sim/types";
import { maxHp } from "../sim/wear";
import { workOf, addState } from "../sim/states";
import { startAid } from "../sim/aid";
import { contractDue, workLabel, contractSummary, contractWindow, eventText, jobLabel, roundLabel, vehicleName, wearLabel, conditionTier, conditionStatus, showsCondition } from "./format";
import { mountedParts } from "../sim/grid";

function part(wear: number): PartInstance {
  return { id: "p1", defId: "mg", hp: 10, wear };
}

describe("wearLabel", () => {
  it("reads a wear-0 part as pristine", () => {
    expect(wearLabel(part(0))).toBe("pristine");
  });

  it("counts rebuilds for a part that has broken and been rebuilt before", () => {
    expect(wearLabel(part(1))).toBe("rebuilt x1");
    expect(wearLabel(part(2))).toBe("rebuilt x2");
  });

  it("reads a part past the last wear step as junk", () => {
    expect(wearLabel(part(CONDITION.maxWear + 1))).toBe("junk");
  });
});

describe("conditionTier", () => {
  it("gives one tier per wear step and junk past the last", () => {
    expect(conditionTier(part(0))).toBe("pristine");
    expect(conditionTier(part(1))).toBe("w1");
    expect(conditionTier(part(CONDITION.maxWear))).toBe(`w${CONDITION.maxWear}`);
    expect(conditionTier(part(CONDITION.maxWear + 1))).toBe("junk");
  });
});

describe("showsCondition", () => {
  it("is false for built-in core parts and true for every other part", () => {
    for (const def of Object.values(PARTS)) {
      expect(showsCondition({ ...part(0), defId: def.id })).toBe(def.kind !== "core");
    }
    expect(showsCondition({ ...part(0), defId: "cab" })).toBe(false);
  });
});

describe("conditionStatus", () => {
  it("shows HP for a working part", () => {
    const s = conditionStatus(part(1));
    expect(s.tone).toBe("dim");
    expect(s.text).toMatch(/HP$/);
  });

  it("reads a broken rebuildable part as broken, never junk", () => {
    expect(conditionStatus({ ...part(2), hp: 0 })).toEqual({ text: "broken", tone: "bad" });
    expect(conditionStatus({ ...part(CONDITION.maxWear), hp: 0 }).text).toBe("broken");
  });

  it("reads junk as scrap only", () => {
    expect(conditionStatus({ ...part(CONDITION.maxWear + 1), hp: 0 })).toEqual({ text: "scrap only", tone: "dim" });
  });
});

describe("contract text", () => {
  const bounty: Contract = { id: "c1", shop: "bowl", kind: "bounty", template: "buggy", targetName: "Raider outrider", reward: 100, deadline: 100, window: 100, tier: 1 };
  const fetch: Contract = { id: "c2", shop: "bowl", kind: "fetch", defId: "mg", reward: 100, deadline: 100, window: 100, tier: 1 };

  it("shows the deadline as the game time the contract fails", () => {
    expect(contractDue(bounty)).toBe("by Day 1 12:19");
  });

  it("names any truck of the bounty's type", () => {
    expect(contractSummary(bounty)).toBe("Knock out or wreck any Raider outrider");
  });

  it("says the hand-in part must still work and be rebuilt at most once", () => {
    expect(contractSummary(fetch)).toBe("Bring MG turret to Bowl: working, rebuilt at most once");
  });

  it("starts a rush haul's summary with Rush and leaves a standard haul plain", () => {
    const haul: Contract = { id: "c3", shop: "bowl", kind: "haul", good: "salt", units: 3, to: "nose", reward: 100, deadline: 100, window: 100, rush: false, tier: 1 };
    expect(contractSummary(haul).startsWith("Haul 3")).toBe(true);
    expect(contractSummary({ ...haul, rush: true }).startsWith("Rush: Haul 3")).toBe(true);
  });

  it("shows the window in whole game hours, at least one", () => {
    expect(contractWindow({ ...bounty, window: 525 })).toBe("28 h");
    expect(contractWindow({ ...bounty, window: 1 })).toBe("1 h");
  });
});

describe("jobLabel", () => {
  function downedBuggy() {
    const w = emptyWorld();
    const buggy = addVehicle(w, "raiders", "buggy", ["mg", "stockEngine"], { x: 33, y: 30 });
    buggy.brain = npcBrain("buggy", buggy.pos, ["raider"]);
    const gun = buggy.items.find((it) => it.kind === "part" && it.part.defId === "mg");
    if (gun?.kind !== "part") throw new Error("Expected a gun");
    return { w, me: w.vehicles[0], buggy, gun };
  }

  it("names the part and the truck of a removal, before and after it is done", () => {
    const { w, me, buggy, gun } = downedBuggy();
    const job: Job = { kind: "refit", moves: [], pickup: { from: "truck", vehicleId: buggy.id, partId: gun.part.id, itemId: "new", to: { x: 0, y: 0, rot: 0 } }, turnsLeft: 3, total: 3 };
    expect(jobLabel(w, me, job)).toBe(`Remove ${partDef("mg").name} from ${buggy.name}`);
    buggy.items = buggy.items.filter((it) => it.id !== gun.id);
    me.items.push({ ...gun, id: "new" });
    expect(jobLabel(w, me, job)).toBe(`Remove ${partDef("mg").name} from ${buggy.name}`);
  });

  it("names the parts a refit moves on the player's own grid", () => {
    const { w, me } = downedBuggy();
    const gun = me.items.find((it) => it.kind === "part" && partDef(it.part.defId).kind === "weapon")!;
    const job: Job = { kind: "refit", moves: [{ itemId: gun.id, from: { x: gun.x, y: gun.y, rot: gun.rot }, to: { x: 0, y: 0, rot: 0 } }], pickup: null, turnsLeft: 3, total: 3 };
    expect(jobLabel(w, me, job)).toBe(`Refit ${partDef(gun.kind === "part" ? gun.part.defId : "").name}`);
  });
});

describe("roundLabel", () => {
  const w = emptyWorld();
  const v = addVehicle(w, "raiders", "buggy", ["mg"], { x: 10, y: 10 });
  const idOf = (kind: string) => mountedParts(v).find((p) => partDef(p.defId).kind === kind || (partDef(p.defId) as { role?: string }).role === kind)!.id;
  
  it("names each damaged part short with its damage", () => {
    expect(roundLabel(w, v.id, [{ part: idOf("weapon"), damage: 3 }, { part: idOf("cab"), damage: 4.2 }], false)).toBe("Gun: 3, Cab: 5");
  });

  it("marks a crit", () => {
    expect(roundLabel(w, v.id, [{ part: idOf("wheel"), damage: 5 }], true)).toBe("Crit! Whl: 5");
  });

  it("shows nothing for a round that damaged no part", () => {
    expect(roundLabel(w, v.id, [{ part: idOf("wheel"), damage: 0 }], false)).toBeNull();
  });
});

describe("collision log", () => {
  it("logs no crash, whether into a standing obstacle or through a fence", () => {
    const w = emptyWorld();
    const me = w.player.vehicleId;
    const fence = { id: "fence-3", pos: { x: 33, y: 30 }, r: 0.5, kind: "landmark" as const, look: "fence" as const, yaw: 0 };
    w.broken = [{ obstacle: fence, turn: w.turn }];
    expect(eventText(w, { t: "collision", a: me, b: "fence-3", hitsA: [], hitsB: [] })).toBeNull();
    expect(eventText(w, { t: "collision", a: me, b: "rock7", hitsA: [{ part: "x", damage: 4 }], hitsB: [] })).toBeNull();
  });
});

describe("patch log", () => {
  it("says a broken patch is off, naming the driver", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "scavengers", "scout", ["stockEngine"], { x: 40, y: 30 });
    const line = eventText(w, { t: "patch", patcher: w.player.vehicleId, client: npc.id, outcome: "broken" });
    expect(line?.text).toBe(`The patch with ${vehicleName(w, npc.id)} is off.`);
    expect(line?.cls).toBe("dim");
  });
});

describe("shot log", () => {
  it("names stray fire that hits the player in a shot between other trucks", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, "raiders", "buggy", ["mg"], { x: 40, y: 40 });
    const trader = addVehicle(w, "traders", "hauler", ["stockEngine"], { x: 44, y: 40 });
    const cab = mountedParts(me).find((p) => (partDef(p.defId) as { role?: string }).role === "cab")!;
    const e: GameEvent = {
      t: "shot", shooter: raider.id, weapon: mountedParts(raider, "weapon")[0].id, target: trader.id, aim: "body", chance: 0.5, damageChance: 0.5, side: "front",
      rounds: [{ hit: false, crit: false, offset: 3, struck: me.id, hits: [{ part: cab.id, damage: 4 }], blast: [] }],
    };
    const line = eventText(w, e);
    expect(line?.text).toContain(" · stray fire hits ");
    expect(line?.cls).toBe("bad");
  });

  function duel() {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, "raiders", "buggy", ["mg", "steelPlate"], { x: 40, y: 40 });
    const parts = mountedParts(raider);
    const cab = parts.find((p) => (partDef(p.defId) as { role?: string }).role === "cab")!;
    const armor = parts.find((p) => partDef(p.defId).kind === "armor");
    const shot = (hits: { part: string; damage: number }[], rounds = 2): GameEvent => ({
      t: "shot", shooter: me.id, weapon: mountedParts(me, "weapon")[0].id, target: raider.id, aim: "body", chance: 0.4, damageChance: 0.4, side: "front",
      rounds: Array.from({ length: rounds }, (_, i) => ({ hit: i === 0, crit: false, offset: 0, struck: raider.id, hits: i === 0 ? hits : [], blast: [] })),
    });
    return { w, raider, cab, armor, shot };
  }

  it("reads who shot whom, hits, chance and damage per part", () => {
    const { w, raider, cab, shot } = duel();
    cab.hp = maxHp(cab);
    const line = eventText(w, shot([{ part: cab.id, damage: 2 }]))!;
    expect(line.text).toMatch(/^.+ → .+ · 1\/2 hit \(40%\) · .+ −2$/);
    expect(line.text).toContain(raider.name);
  });

  it("marks a part with no HP left as broken in the bad color", () => {
    const { w, cab, shot } = duel();
    cab.hp = 0;
    const line = eventText(w, shot([{ part: cab.id, damage: 5 }]))!;
    expect(line.spans!.find((s) => s.text.endsWith(" broken"))?.cls).toBe("bad");
  });

  it("puts inner parts before armor and dims the armor", () => {
    const { w, cab, armor, shot } = duel();
    if (!armor) throw new Error('The raider has no armor');
    armor.hp = maxHp(armor);
    cab.hp = maxHp(cab);
    const line = eventText(w, shot([{ part: armor.id, damage: 1 }, { part: cab.id, damage: 2 }]))!;
    const names = line.spans!.map((s) => s.text);
    expect(names.findIndex((t) => t.startsWith(partDef(cab.defId).name))).toBeLessThan(names.findIndex((t) => t.startsWith(partDef(armor.defId).name)));
    expect(line.spans!.find((s) => s.text.startsWith(partDef(armor.defId).name))?.cls).toBe("dim");
  });

  it("logs a shot with no damage without a damage list", () => {
    const { w, shot } = duel();
    expect(eventText(w, shot([]))!.text).not.toContain("−");
  });
});

describe("empty gun log", () => {
  it("leaves a gun running dry out of the log", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const gun = mountedParts(me, "weapon")[0];
    expect(eventText(w, { t: "empty", vehicle: me.id, weapon: gun.id })).toBeNull();
  });
});

describe("NPC names in the log", () => {
  it("names an NPC by profession and driver, also after it was removed, and the player as You", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "roamers", "buggy", ["mg", "stockEngine"], { x: 20, y: 20 });
    npc.brain = { ...npcBrain("roamer", npc.pos, ["roamer"]), driver: "Silas Kane" };
    const offer: GameEvent = { t: "towOffer", by: npc.id, town: REGION.towns[0].id, fee: 40 };
    expect(eventText(w, offer)?.text).toMatch(/^Roamer Silas Kane offers to tow you to /);
    w.vehicles = w.vehicles.filter((v) => v !== npc);
    w.removed.push(npc);
    expect(eventText(w, offer)?.text).toMatch(/^Roamer Silas Kane offers/);
    expect(vehicleName(w, w.player.vehicleId)).toBe("You");
  });
});

describe("tow text", () => {
  it("says free for a fee of 0 and keeps the price otherwise", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, "traders", "scout", ["stockEngine"], { x: 34, y: 30 });
    const town = REGION.towns[0].id;
    expect(eventText(w, { t: "towOffer", by: npc.id, town, fee: 0 })?.text).toMatch(/ for free\.$/);
    expect(eventText(w, { t: "towOffer", by: npc.id, town, fee: 40 })?.text).toMatch(/ for 40\.$/);
    expect(eventText(w, { t: "towDone", by: npc.id, client: w.player.vehicleId, fee: 0 })).toMatchObject({ text: expect.stringMatching(/tows you into town for free\.$/), cls: "" });
    expect(eventText(w, { t: "towDone", by: npc.id, client: w.player.vehicleId, fee: 40 })).toMatchObject({ text: expect.stringMatching(/takes 40\.$/), cls: "bad" });
    const other = addVehicle(w, "roamers", "buggy", ["stockEngine"], { x: 50, y: 30 });
    expect(eventText(w, { t: "towDone", by: npc.id, client: other.id, fee: 0 })?.text).toMatch(/ in for free\.$/);
  });
});

describe("aid handover text", () => {
  it("labels the work for both trucks and logs its start", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, "traders", "scout", ["stockEngine"], { x: 34, y: 30 });
    npc.brain = npcBrain("trader", npc.pos, ["trader"]);
    addState(w, "aid", npc.id, w.player.vehicleId, { kind: "aid", giver: "player", fuel: 5, supplies: 0, price: 0, free: true, agreed: true, started: false, work: 1, workLeft: 1 });
    const next = startAid(w, npc.id);
    const mine = next.vehicles[0];
    expect(workLabel(next, mine, workOf(next, mine)!)).toMatch(/^Giving .* to /);
    const theirs = next.vehicles.find((v) => v.id === npc.id)!;
    expect(workLabel(next, theirs, workOf(next, theirs)!)).toMatch(/^Taking .* from you$/);
    expect(eventText(next, next.events.find((e) => e.t === "aidStarted")!)?.text).toMatch(/^You start handing/);
  });
});
