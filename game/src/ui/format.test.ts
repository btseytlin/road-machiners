import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { CONDITION } from "../data/wear";
import type { Contract } from "../sim/market";
import { partDef, PARTS } from "../data/parts";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import type { GameEvent, World, Job, PartInstance, ShotRound } from "../sim/types";
import { makePart } from "../sim/factory";
import { mountPart } from "../sim/inventory";
import { maxHp } from "../sim/wear";
import { workOf, addState } from "../sim/states";
import { startAid } from "../sim/aid";
import { contractDue, heldContractDue, workLabel, contractSummary, contractWindow, eventText, jobLabel, roundLabel, vehicleName, wearLabel, conditionTier, conditionStatus, showsCondition, CRATE_NOTE, GOODS_COLUMNS, PROFIT_HEAD_TITLE, saleEstimate, estimateText, estimateTitle, lotTitle } from "./format";
import { mountedParts } from "../sim/grid";
import { fuelLiters, kg } from "./units";
import { CRATE_MASS } from "../data/goods";
import { wreckVehicle } from "../sim/combat";
import { partName, vehicleTitle } from "../text/names";
import { t, type Msg } from "../text/msg";
import { resolve } from "../text/resolve";

// English words of a message, or null for none.
function en(msg: Msg): string;
function en(msg: Msg | null | undefined): string | null;
function en(msg: Msg | null | undefined): string | null {
  return msg ? resolve(msg, "en") : null;
}

function logEn(world: World, e: GameEvent): { text: string; cls: string } | null {
  const line = eventText(world, e);
  return line ? { text: en(line.text), cls: line.cls } : null;
}

function part(wear: number): PartInstance {
  return { id: "p1", defId: "mg", hp: 10, wear };
}

describe("wearLabel", () => {
  it("reads a wear-0 part as pristine", () => {
    expect(en(wearLabel(part(0)))).toBe("pristine");
  });

  it("counts rebuilds for a part that has broken and been rebuilt before", () => {
    expect(en(wearLabel(part(1)))).toBe("rebuilt x1");
    expect(en(wearLabel(part(2)))).toBe("rebuilt x2");
  });

  it("reads a part past the last wear step as junk", () => {
    expect(en(wearLabel(part(CONDITION.maxWear + 1)))).toBe("junk");
  });
});

// The Russian condition words sit beside a part name of any gender, so each must read right on all of them.
describe("Russian part condition on every gender", () => {
  const ru = (msg: Msg) => resolve(msg, "ru");
  const PARTS_BY_GENDER = { m: "shotgun", f: "mg", n: "recoilless", pl: "plates" } as const;
  // A working part shows its HP, which needs no agreement.
  const HP = /^\d+\/\d+ прочн\.$/;
  const cases: [string, Partial<PartInstance>, string, string | RegExp][] = [
    ["pristine", { wear: 0 }, "без износа", HP],
    ["rebuilt once", { wear: 1 }, "1 капремонт", HP],
    ["rebuilt twice", { wear: 2 }, "2 капремонта", HP],
    ["rebuilt four times", { wear: CONDITION.maxWear }, `${CONDITION.maxWear} капремонта`, HP],
    ["broken", { wear: 1, hp: 0 }, "1 капремонт", "не работает"],
    ["junk", { wear: CONDITION.maxWear + 1, hp: 0 }, "лом", "только на лом"],
  ];
  for (const [gender, defId] of Object.entries(PARTS_BY_GENDER)) {
    for (const [state, fields, wear, status] of cases) {
      it(`${state} on a ${gender} part`, () => {
        const p: PartInstance = { id: "p1", defId, hp: 10, wear: 0, ...fields };
        expect(ru(wearLabel(p))).toBe(wear);
        expect(ru(conditionStatus(p).text)).toMatch(status);
      });
    }
  }

  it("counts five rebuilds with the many form", () => {
    expect(ru(t("cond.rebuilt", { n: 5 }))).toBe("5 капремонтов");
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
    expect(en(s.text)).toMatch(/HP$/);
  });

  it("reads a broken rebuildable part as broken, never junk", () => {
    expect(conditionStatus({ ...part(2), hp: 0 }).tone).toBe("bad");
    expect(en(conditionStatus({ ...part(2), hp: 0 }).text)).toBe("broken");
    expect(en(conditionStatus({ ...part(CONDITION.maxWear), hp: 0 }).text)).toBe("broken");
  });

  it("reads junk as scrap only", () => {
    const junk = conditionStatus({ ...part(CONDITION.maxWear + 1), hp: 0 });
    expect([en(junk.text), junk.tone]).toEqual(["scrap only", "dim"]);
  });
});

describe("contract text", () => {
  const bounty: Contract = { id: "c1", shop: "bowl", kind: "bounty", template: "buggy", reward: 100, deadline: 100, window: 100, tier: 1, fulfilled: false };
  const fetch: Contract = { id: "c2", shop: "bowl", kind: "fetch", defId: "mg", reward: 100, deadline: 100, window: 100, tier: 1 };

  it("shows the deadline as the game time the contract fails", () => {
    expect(en(contractDue(bounty))).toBe("by Day 1 12:19");
  });

  it("names any truck of the bounty's type and the shop that pays it", () => {
    expect(en(contractSummary(bounty))).toBe("Knock out or wreck any Raider outrider, claim at Bowl");
  });

  it("reads a met bounty as beaten and ready to claim", () => {
    const met: Contract = { ...bounty, fulfilled: true };
    expect(en(contractSummary(met))).toBe("Raider outrider beaten, claim at Bowl");
    expect(en(heldContractDue(met))).toBe("Ready");
    expect(en(heldContractDue(bounty))).toBe(en(contractDue(bounty)));
    expect(en(heldContractDue(fetch))).toBe(en(contractDue(fetch)));
  });

  it("logs a met bounty with its reward and where to claim it", () => {
    const line = eventText(emptyWorld(), { t: "contract", contract: { ...bounty, fulfilled: true }, outcome: "fulfilled" })!;
    expect([en(line.text), line.cls]).toEqual(["Bounty met: Raider outrider beaten, claim 1 M at Bowl", "good"]);
  });

  it("says the hand-in part must still work and be rebuilt at most once", () => {
    expect(en(contractSummary(fetch))).toBe("Bring MG turret to Bowl: working, rebuilt at most once");
  });

  it("starts a rush haul's summary with Rush and leaves a standard haul plain", () => {
    const haul: Contract = { id: "c3", shop: "bowl", kind: "haul", good: "salt", units: 3, to: "nose", reward: 100, deadline: 100, window: 100, rush: false, tier: 1 };
    expect(en(contractSummary(haul)).startsWith("Haul 3")).toBe(true);
    expect(en(contractSummary({ ...haul, rush: true })).startsWith("Rush: Haul 3")).toBe(true);
  });

  it("counts a haul in crates", () => {
    const haul: Contract = { id: "c4", shop: "bowl", kind: "haul", good: "salt", units: 5, to: "nose", reward: 100, deadline: 100, window: 100, rush: false, tier: 1 };
    expect(en(contractSummary(haul))).toBe("Haul 5 crates of Salt to Nose");
    expect(en(contractSummary({ ...haul, units: 1 }))).toBe("Haul 1 crate of Salt to Nose");
  });

  it("shows the window in whole game hours, at least one", () => {
    expect(en(contractWindow({ ...bounty, window: 525 }))).toBe("28 h");
    expect(en(contractWindow({ ...bounty, window: 1 }))).toBe("1 h");
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
    expect(en(jobLabel(w, me, job))).toBe(`Remove ${en(partName("mg"))} from ${en(vehicleTitle(w, buggy))}`);
    buggy.items = buggy.items.filter((it) => it.id !== gun.id);
    me.items.push({ ...gun, id: "new" });
    expect(en(jobLabel(w, me, job))).toBe(`Remove ${en(partName("mg"))} from ${en(vehicleTitle(w, buggy))}`);
  });

  it("names the parts a refit moves on the player's own grid", () => {
    const { w, me } = downedBuggy();
    const gun = me.items.find((it) => it.kind === "part" && partDef(it.part.defId).kind === "weapon")!;
    const job: Job = { kind: "refit", moves: [{ itemId: gun.id, from: { x: gun.x, y: gun.y, rot: gun.rot }, to: { x: 0, y: 0, rot: 0 } }], pickup: null, turnsLeft: 3, total: 3 };
    expect(en(jobLabel(w, me, job))).toBe(`Refit ${en(partName(gun.kind === "part" ? gun.part.defId : ""))}`);
  });
});

describe("roundLabel", () => {
  const w = emptyWorld();
  const v = addVehicle(w, "raiders", "buggy", ["mg"], { x: 10, y: 10 });
  const idOf = (kind: string) => mountedParts(v).find((p) => partDef(p.defId).kind === kind || (partDef(p.defId) as { role?: string }).role === kind)!.id;
  
  it("names each damaged part short with its damage", () => {
    expect(en(roundLabel(w, v.id, [{ part: idOf("weapon"), damage: 3 }, { part: idOf("cab"), damage: 4.2 }], false))).toBe("Gun: 3, Cab: 5");
  });

  it("marks a crit", () => {
    expect(en(roundLabel(w, v.id, [{ part: idOf("wheel"), damage: 5 }], true))).toBe("Crit! Whl: 5");
  });

  it("shows nothing for a round that damaged no part", () => {
    expect(en(roundLabel(w, v.id, [{ part: idOf("wheel"), damage: 0 }], false))).toBeNull();
  });
});

describe("utility log", () => {
  it("logs no line for a utility use, so smoke never reads as mechanical state", () => {
    const w = emptyWorld();
    expect(eventText(w, { t: "utility", vehicle: w.player.vehicleId, part: "p1", effect: "sprout", point: null })).toBeNull();
  });
});

describe("harpoon log", () => {
  function harpooned(rounds: ShotRound[]) {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const harpoon = makePart(w, "harpoon", 0);
    if (!mountPart(w, me, harpoon)) throw new Error("No deck room for the harpoon");
    const trader = addVehicle(w, "traders", "hauler", ["stockEngine"], { x: 33, y: 30 });
    const engine = mountedParts(trader, "engine")[0];
    const shot: GameEvent = { t: "shot", shooter: me.id, weapon: harpoon.id, target: trader.id, aim: "body", chance: 0.4, damageChance: 0.3, side: "left", rounds };
    return { w, me, harpoon, trader, engine, shot };
  }

  it("names the part the player's line holds", () => {
    const s = harpooned([]);
    s.w.lines = [{ id: "l1", from: s.me.id, fromPart: s.harpoon.id, to: s.trader.id, toPart: s.engine.id, length: 10, turnsLeft: 3 }];
    s.shot = { ...(s.shot as Extract<GameEvent, { t: "shot" }>), rounds: [{ hit: true, crit: false, offset: 0, struck: s.trader.id, hits: [{ part: s.engine.id, damage: 2 }], blast: [], burst: null }] };

    expect(logEn(s.w, s.shot)?.text).toBe(`Harpoon → ${en(vehicleName(s.w, s.trader.id))}: line on Stock engine (40%): Stock engine −2`);
  });

  it("reads a harpoon that holds nothing as a miss", () => {
    const s = harpooned([{ hit: false, crit: false, offset: 3, struck: null, hits: [], blast: [], burst: null }]);

    expect(logEn(s.w, s.shot)?.text).toBe(`Harpoon → ${en(vehicleName(s.w, s.trader.id))}: missed (40%)`);
  });

  it("tells the player its truck tore free of a line", () => {
    const s = harpooned([]);
    const mine = mountedParts(s.me, "engine")[0];

    expect(logEn(s.w, { t: "lineTorn", line: "l1", vehicle: s.me.id, part: mine.id, damage: 12 })).toMatchObject({ text: `You tear free of a harpoon line: ${en(partName(mine.defId))} −12`, cls: "bad" });
  });
});

describe("emitter pulse log", () => {
  it("names the trucks the player's pulse shuts down", () => {
    const w = emptyWorld();
    const me = w.player.vehicleId;
    const trader = addVehicle(w, "traders", "hauler", [], { x: 33, y: 30 });

    expect(logEn(w, { t: "pulse", vehicle: me, pos: { x: 30, y: 30 }, hit: [trader.id] })).toEqual({ text: `Your emitter pulse shuts down ${en(vehicleName(w, trader.id))}`, cls: "good" });
    expect(logEn(w, { t: "pulse", vehicle: me, pos: { x: 30, y: 30 }, hit: [] })).toEqual({ text: "Your emitter pulse catches nobody", cls: "dim" });
  });

  it("tells the player its truck is shut down and for how long", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    me.shutDown = { from: w.turn + 1, until: w.turn + 2 };

    expect(logEn(w, { t: "pulse", vehicle: raider.id, pos: { x: 33, y: 30 }, hit: [me.id] })).toEqual({ text: `${en(vehicleName(w, raider.id))}'s emitter pulse shuts your truck down for 2 turns`, cls: "bad" });
  });

  it("logs nothing for a pulse between other trucks", () => {
    const w = emptyWorld();
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    const trader = addVehicle(w, "traders", "hauler", [], { x: 35, y: 30 });

    expect(logEn(w, { t: "pulse", vehicle: raider.id, pos: { x: 33, y: 30 }, hit: [trader.id] })).toBeNull();
  });
});

describe("claymore log", () => {
  it("names the truck the player's claymore ram blasts and the damage it took", () => {
    const w = emptyWorld();
    const trader = addVehicle(w, "traders", "hauler", ["stockEngine"], { x: 33, y: 30 });
    const engine = mountedParts(trader, "engine")[0];
    const hits = [{ part: engine.id, damage: 20 }];

    expect(logEn(w, { t: "claymore", vehicle: w.player.vehicleId, part: "ram", other: trader.id, pos: { x: 32, y: 30 }, hits, selfHits: [] })).toMatchObject({ text: `Your claymore ram blasts ${en(vehicleName(w, trader.id))}: Stock engine −20`, cls: "good" });
  });

  it("tells the player a claymore ram blasted its truck", () => {
    const w = emptyWorld();
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    const engine = mountedParts(w.vehicles[0], "engine")[0];
    const hits = [{ part: engine.id, damage: 20 }];

    expect(logEn(w, { t: "claymore", vehicle: raider.id, part: "ram", other: w.player.vehicleId, pos: { x: 31, y: 30 }, hits, selfHits: [] })).toMatchObject({ text: `${en(vehicleName(w, raider.id))}'s claymore ram blasts your truck: ${en(partName(engine.defId))} −20`, cls: "bad" });
  });

  it("logs a seen blast between other trucks and nothing for one out of sight", () => {
    const w = emptyWorld();
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    const trader = addVehicle(w, "traders", "hauler", [], { x: 35, y: 30 });
    const far = addVehicle(w, "raiders", "hauler", [], { x: 200, y: 200 });
    const farTrader = addVehicle(w, "traders", "hauler", [], { x: 202, y: 200 });

    expect(logEn(w, { t: "claymore", vehicle: raider.id, part: "ram", other: trader.id, pos: { x: 34, y: 30 }, hits: [], selfHits: [] })).toMatchObject({ text: `${en(vehicleName(w, raider.id))}'s claymore ram blasts ${en(vehicleName(w, trader.id))}`, cls: "dim" });
    expect(logEn(w, { t: "claymore", vehicle: far.id, part: "ram", other: farTrader.id, pos: { x: 201, y: 200 }, hits: [], selfHits: [] })).toBeNull();
  });
});

describe("caltrops log", () => {
  const wheelHits = (v: { items: { kind: string; part?: PartInstance }[] }) =>
    v.items.flatMap((i) => (i.part && partDef(i.part.defId).kind === "core" && i.part.defId.includes("wheel") ? [{ part: i.part.id, damage: 8 }] : []));

  it("lists the player's wheel damage like a hit", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const hits = wheelHits(me);

    const line = logEn(w, { t: "caltrops", vehicle: me.id, field: "g1", source: me.id, hits });

    expect(hits).toHaveLength(4);
    expect(line).toMatchObject({ cls: "bad", text: expect.stringMatching(/^You drive into caltrops: (.+ −8, ){3}.+ −8$/) });
  });

  it("names a seen truck that drives into the player's caltrops, with its wheel damage", () => {
    const w = emptyWorld();
    const trader = addVehicle(w, "traders", "hauler", [], { x: 33, y: 30 });

    const line = logEn(w, { t: "caltrops", vehicle: trader.id, field: "g1", source: w.player.vehicleId, hits: wheelHits(trader) });

    expect(line).toMatchObject({ cls: "good", text: expect.stringMatching(new RegExp(`^${en(vehicleName(w, trader.id))} drives into caltrops: .*−8`)) });
  });

  it("logs a caltrops event from an old save with no wheel numbers", () => {
    const w = emptyWorld();
    const me = w.player.vehicleId;

    expect(logEn(w, { t: "caltrops", vehicle: me, field: "g1", source: me, hits: [] })).toMatchObject({ text: "You drive into caltrops", cls: "bad" });
  });

  it("logs nothing for a truck out of sight", () => {
    const w = emptyWorld();
    const trader = addVehicle(w, "traders", "hauler", [], { x: 200, y: 200 });

    expect(logEn(w, { t: "caltrops", vehicle: trader.id, field: "g1", source: trader.id, hits: [] })).toBeNull();
  });
});

describe("collision log", () => {
  it("tells the log the title of a note written into the journal", () => {
    const w = emptyWorld();

    expect(logEn(w, { t: "note", id: "greenPit" })).toEqual({ text: "Noted in your journal: Clean water at Green Pit.", cls: "good" });
  });

  it("logs no crash, whether into a standing obstacle or through a fence", () => {
    const w = emptyWorld();
    const me = w.player.vehicleId;
    const fence = { id: "fence-3", pos: { x: 33, y: 30 }, r: 0.5, kind: "landmark" as const, look: "fence" as const, yaw: 0 };
    w.broken = [{ obstacle: fence, turn: w.turn }];
    expect(logEn(w, { t: "collision", a: me, b: "fence-3", hitsA: [], hitsB: [] })).toBeNull();
    expect(logEn(w, { t: "collision", a: me, b: "rock7", hitsA: [{ part: "x", damage: 4 }], hitsB: [] })).toBeNull();
  });
});

describe("cargo spill log", () => {
  it("names the player's broken cargo part and how many items fell out", () => {
    const w = emptyWorld();
    const panniers = mountedParts(w.vehicles[0], "cargo")[0];
    const line = logEn(w, { t: "cargoSpilled", vehicle: w.player.vehicleId, part: panniers.id, pile: "spill-1", units: 6 });
    expect(line).toEqual({ text: "Panniers broke. 6 items fell out.", cls: "bad" });
  });

  it("names the NPC whose cargo spilled", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "traders", "hauler", ["rack"], { x: 40, y: 30 });
    const line = logEn(w, { t: "cargoSpilled", vehicle: npc.id, part: mountedParts(npc, "cargo")[0].id, pile: "spill-2", units: 1 });
    expect(line).toEqual({ text: `${en(vehicleName(w, npc.id))}: cargo spilled on the ground`, cls: "good" });
  });
});

describe("patch log", () => {
  it("says a broken patch is off, naming the driver", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "scavengers", "scout", ["stockEngine"], { x: 40, y: 30 });
    const line = eventText(w, { t: "patch", patcher: w.player.vehicleId, client: npc.id, outcome: "broken" });
    expect(en(line?.text)).toBe(`The patch with ${en(vehicleName(w, npc.id))} is off.`);
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
      rounds: [{ hit: false, crit: false, offset: 3, struck: me.id, hits: [{ part: cab.id, damage: 4 }], blast: [], burst: null }],
    };
    const line = eventText(w, e);
    expect(en(line?.text)).toContain(", stray fire hits ");
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
      rounds: Array.from({ length: rounds }, (_, i) => ({ hit: i === 0, crit: false, offset: 0, struck: raider.id, hits: i === 0 ? hits : [], blast: [], burst: null })),
    });
    return { w, raider, cab, armor, shot };
  }

  it("reads who shot whom, hits, chance and damage per part", () => {
    const { w, raider, cab, shot } = duel();
    cab.hp = maxHp(cab);
    const line = eventText(w, shot([{ part: cab.id, damage: 2 }]))!;
    expect(en(line.text)).toMatch(/^.+ → .+, 1\/2 hit \(40%\): .+ −2$/);
    expect(en(line.text)).toContain(en(vehicleTitle(w, raider)));
  });

  it("marks a part with no HP left as broken in the bad color", () => {
    const { w, cab, shot } = duel();
    cab.hp = 0;
    const line = eventText(w, shot([{ part: cab.id, damage: 5 }]))!;
    expect(line.spans!.find((s) => en(s.text).endsWith(" broken"))?.cls).toBe("bad");
  });

  it("puts inner parts before armor and dims the armor", () => {
    const { w, cab, armor, shot } = duel();
    if (!armor) throw new Error('The raider has no armor');
    armor.hp = maxHp(armor);
    cab.hp = maxHp(cab);
    const line = eventText(w, shot([{ part: armor.id, damage: 1 }, { part: cab.id, damage: 2 }]))!;
    const names = line.spans!.map((s) => en(s.text));
    expect(names.findIndex((t) => t.startsWith(en(partName(cab.defId))))).toBeLessThan(names.findIndex((t) => t.startsWith(en(partName(armor.defId)))));
    expect(line.spans!.find((s) => en(s.text).startsWith(en(partName(armor.defId))))?.cls).toBe("dim");
  });

  it("names the parts a shot hit on a truck it wrecked, which went onto the wreck's stock", () => {
    const { w, raider, armor, shot } = duel();
    if (!armor) throw new Error('The raider has no armor');
    const e = shot([{ part: armor.id, damage: 3 }]);
    w.events.push(e);
    wreckVehicle(w, raider);
    expect(en(eventText(w, e)!.text)).toContain(`${en(partName(armor.defId))} −3`);
    expect(en(roundLabel(w, raider.id, [{ part: armor.id, damage: 3 }], false))).toBe("Arm: 3");
  });

  it("logs a shot with no damage without a damage list", () => {
    const { w, shot } = duel();
    expect(en(eventText(w, shot([]))!.text)).not.toContain("−");
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
    expect(en(eventText(w, offer)?.text)).toMatch(/^Roamer Silas Kane offers to tow you to /);
    w.vehicles = w.vehicles.filter((v) => v !== npc);
    w.removed.push(npc);
    expect(en(eventText(w, offer)?.text)).toMatch(/^Roamer Silas Kane offers/);
    expect(en(vehicleName(w, w.player.vehicleId))).toBe("You");
  });
});

describe("money text", () => {
  it("reads a money event in M with its sign", () => {
    const w = emptyWorld();
    const gain = eventText(w, { t: "money", amount: 4067, reason: { kind: "contract" } })!;
    const loss = eventText(w, { t: "money", amount: -100, reason: { kind: "failedHaul" } })!;
    expect([en(gain.text), gain.cls]).toEqual(["+41 M's: contract", "good"]);
    expect([en(loss.text), loss.cls]).toEqual(["\u22121 M: failed haul contract", "bad"]);
  });
});

describe("tow text", () => {
  it("reads the currency as M's in money lines and one-unit fees", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, "traders", "scout", ["stockEngine"], { x: 34, y: 30 });
    const town = REGION.towns[0].id;
    expect(en(eventText(w, { t: "money", amount: 12000, reason: { kind: "contract" } })!.text)).toBe("+120 M's: contract");
    expect(en(eventText(w, { t: "money", amount: -4000, reason: { kind: "failedHaul" } })!.text)).toBe("\u221240 M's: failed haul contract");
    expect(en(eventText(w, { t: "towOffer", by: npc.id, town, fee: 100 })!.text)).toMatch(/ for 1 M\.$/);
  });
  it("says free for a fee of 0 and keeps the price otherwise", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, "traders", "scout", ["stockEngine"], { x: 34, y: 30 });
    const town = REGION.towns[0].id;
    expect(en(eventText(w, { t: "towOffer", by: npc.id, town, fee: 0 })?.text)).toMatch(/ for free\.$/);
    expect(en(eventText(w, { t: "towOffer", by: npc.id, town, fee: 4000 })?.text)).toMatch(/ for 40 M's\.$/);
    const free = eventText(w, { t: "towDone", by: npc.id, client: w.player.vehicleId, fee: 0 })!;
    expect([en(free.text), free.cls]).toEqual([expect.stringMatching(/tows you into town for free\.$/), ""]);
    const paid = eventText(w, { t: "towDone", by: npc.id, client: w.player.vehicleId, fee: 4067 })!;
    expect([en(paid.text), paid.cls]).toEqual([expect.stringMatching(/takes 41 M's\.$/), "bad"]);
    const other = addVehicle(w, "roamers", "buggy", ["stockEngine"], { x: 50, y: 30 });
    expect(en(eventText(w, { t: "towDone", by: npc.id, client: other.id, fee: 0 })?.text)).toMatch(/ in for free\.$/);
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
    expect(en(workLabel(next, mine, workOf(next, mine)!))).toMatch(/^Giving .* to /);
    const theirs = next.vehicles.find((v) => v.id === npc.id)!;
    expect(en(workLabel(next, theirs, workOf(next, theirs)!))).toMatch(/^Taking .* from you$/);
    expect(en(eventText(next, next.events.find((e) => e.t === "aidStarted")!)?.text)).toMatch(/^You start handing/);
  });
});

describe("found log", () => {
  it("lists the goods, parts, fuel and supplies a search turn found", () => {
    const w = emptyWorld();
    const e: GameEvent = { t: "found", vehicle: w.player.vehicleId, stock: "rich", goods: { scrap: 3 }, parts: ["mg"], fuel: 2, supplies: 1 };

    expect(logEn(w, e)).toEqual({ text: `Found Scrap metal ×3, ${en(partName("mg"))}, ${fuelLiters(2)} L of fuel and 1 supply.`, cls: "good" });
  });
});

describe("saleEstimate", () => {
  it("words a loss per unit against the average cost", () => {
    const e = saleEstimate(11, 1200, 2000);
    expect(e).toEqual({ kind: "loss", perUnit: 800, avgCost: 2000 });
    expect(en(estimateText(e))).toBe("\u22128");
    expect(en(estimateTitle(e))).toBe("Avg cost 20 M's");
  });

  it("words a gain", () => {
    expect(en(estimateText(saleEstimate(1, 3800, 500)))).toBe("+33");
  });

  it("calls a rounded zero even, never -0", () => {
    for (const basis of [3700, 3700.4]) {
      const e = saleEstimate(2, 3700, basis);
      expect(e.kind).toBe("even");
      expect(en(estimateText(e))).toBe("0");
    }
  });

  it("says when no cost is on record", () => {
    const e = saleEstimate(1, 42, undefined);
    expect(en(estimateText(e))).toBe("?");
    expect(en(estimateTitle(e))).toBe("No cost on record");
  });

  it("has nothing to say when nothing is held", () => {
    const e = saleEstimate(0, 37, 45);
    expect(e.kind).toBe("none");
    expect(estimateText(e)).toBeNull();
  });

  it("keeps multi-digit values whole", () => {
    expect(en(estimateText(saleEstimate(12, 98700, 123400)))).toBe("\u2212247");
  });

  it("only ever gives a signed number, ? or nothing", () => {
    for (const e of [saleEstimate(11, 3700, 4500), saleEstimate(3, 3700, 3000), saleEstimate(2, 3700, 3700), saleEstimate(2, 3700, undefined), saleEstimate(0, 3700, 100)]) {
      expect(en(estimateText(e)) ?? "").toMatch(/^([+\u2212]\d[\d,]*|0|\?|)$/);
    }
  });

  it("fails loud on impossible input", () => {
    expect(() => saleEstimate(-1, 37, 45)).toThrow();
    expect(() => saleEstimate(1.5, 37, 45)).toThrow();
    expect(() => saleEstimate(1, NaN, 45)).toThrow();
    expect(() => saleEstimate(1, 37, -1)).toThrow();
    expect(() => saleEstimate(1, 37, Infinity)).toThrow();
  });
});

describe("goods table words", () => {
  it("has terse column heads", () => {
    expect(Object.fromEntries(Object.entries(GOODS_COLUMNS).map(([k, v]) => [k, en(v)]))).toEqual({ good: "Good", theirs: "Theirs", buy: "Buy", sell: "Sell", held: "Held", profit: "Profit/crate" });
  });

  it("says prices are per crate of the one crate mass", () => {
    expect(en(CRATE_NOTE)).toBe(`Prices are per ${en(kg(CRATE_MASS))} crate. One crate fills one cargo cell.`);
    expect(en(CRATE_NOTE)).toContain("50 kg");
  });

  it("explains the profit head in a hover title without turns", () => {
    expect(en(PROFIT_HEAD_TITLE)).toContain("Per unit");
    expect(en(PROFIT_HEAD_TITLE)).toContain("average cost");
    expect(en(PROFIT_HEAD_TITLE)).toContain("usual value");
    expect(en(PROFIT_HEAD_TITLE)).not.toMatch(/turn/i);
  });

  it("words lot totals", () => {
    expect(en(lotTitle("buy", 5, 180))).toBe("Buy 5 for 2 M's total");
    expect(en(lotTitle("sell", 11, 31200))).toBe("Sell all 11 for 312 M's total");
  });
});

describe("wake-up log", () => {
  it("says an NPC regains consciousness, so the line does not read as cut off", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "scavengers", "scout", ["stockEngine"], { x: 40, y: 30 });
    const line = eventText(w, { t: "npcWake", vehicle: npc.id });
    expect(en(line?.text)).toBe(`${en(vehicleName(w, npc.id))} regains consciousness`);
    expect(line?.cls).toBe("dim");
  });
});

describe("loot argument log", () => {
  it("tells how an argument between two drivers the player sees ended", () => {
    const w = emptyWorld();
    const warner = addVehicle(w, "raiders", "scout", ["stockEngine"], { x: 32, y: 30 });
    const looter = addVehicle(w, "scavengers", "scout", ["stockEngine"], { x: 33, y: 30 });
    const [a, b] = [en(vehicleName(w, warner.id)), en(vehicleName(w, looter.id))];
    const argument = (end: "yielded" | "backedOff" | "fight", place: "wreck" | "truck" = "wreck"): GameEvent => ({ t: "lootArgument", warner: warner.id, looter: looter.id, place, end });
    const said = (event: GameEvent) => {
      const line = eventText(w, event)!;
      return { text: en(line.text), cls: line.cls };
    };
    expect(said(argument("yielded"))).toEqual({ text: `${a} warns ${b} off the wreck. ${b} rolls on.`, cls: "dim" });
    expect(said(argument("backedOff", "truck")).text).toBe(`${a} warns ${b} off the truck. ${b} stays put, and ${a} rolls on.`);
    expect(said(argument("fight"))).toEqual({ text: `${a} warns ${b} off the wreck. They fight over it.`, cls: "bad" });
  });

  it("logs nothing when the player notices neither driver", () => {
    const w = emptyWorld();
    const warner = addVehicle(w, "raiders", "scout", ["stockEngine"], { x: 230, y: 230 });
    const looter = addVehicle(w, "scavengers", "scout", ["stockEngine"], { x: 231, y: 230 });
    expect(eventText(w, { t: "lootArgument", warner: warner.id, looter: looter.id, place: "pile", end: "yielded" })).toBeNull();
  });
});
