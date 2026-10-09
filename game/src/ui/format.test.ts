import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { CONDITION } from "../data/wear";
import type { Contract } from "../sim/market";
import { partDef, PARTS } from "../data/parts";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import type { GameEvent, Job, PartInstance, ShotRound } from "../sim/types";
import { makePart } from "../sim/factory";
import { mountPart } from "../sim/inventory";
import { maxHp } from "../sim/wear";
import { workOf, addState } from "../sim/states";
import { startAid } from "../sim/aid";
import { contractDue, heldContractDue, workLabel, contractSummary, contractWindow, eventText, jobLabel, roundLabel, vehicleName, wearLabel, conditionTier, conditionStatus, showsCondition, GOODS_COLUMNS, PROFIT_HEAD_TITLE, saleEstimate, estimateText, estimateTitle, lotTitle } from "./format";
import { mountedParts } from "../sim/grid";
import { fuelLiters } from "./units";
import { wreckVehicle } from "../sim/combat";

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
  const bounty: Contract = { id: "c1", shop: "bowl", kind: "bounty", template: "buggy", targetName: "Raider outrider", reward: 100, deadline: 100, window: 100, tier: 1, fulfilled: false };
  const fetch: Contract = { id: "c2", shop: "bowl", kind: "fetch", defId: "mg", reward: 100, deadline: 100, window: 100, tier: 1 };

  it("shows the deadline as the game time the contract fails", () => {
    expect(contractDue(bounty)).toBe("by Day 1 12:19");
  });

  it("names any truck of the bounty's type and the shop that pays it", () => {
    expect(contractSummary(bounty)).toBe("Knock out or wreck any Raider outrider, claim at Bowl");
  });

  it("reads a met bounty as beaten and ready to claim", () => {
    const met: Contract = { ...bounty, fulfilled: true };
    expect(contractSummary(met)).toBe("Raider outrider beaten, claim at Bowl");
    expect(heldContractDue(met)).toBe("Ready");
    expect(heldContractDue(bounty)).toBe(contractDue(bounty));
    expect(heldContractDue(fetch)).toBe(contractDue(fetch));
  });

  it("logs a met bounty with its reward and where to claim it", () => {
    const line = eventText(emptyWorld(), { t: "contract", contract: { ...bounty, fulfilled: true }, outcome: "fulfilled" });
    expect(line).toEqual({ text: "Bounty met: Raider outrider beaten, claim 1 M at Bowl", cls: "good" });
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

    expect(eventText(s.w, s.shot)?.text).toBe(`Harpoon fires at ${vehicleName(s.w, s.trader.id)}: line on Stock engine (40%): Stock engine −2`);
  });

  it("reads a harpoon that holds nothing as a miss", () => {
    const s = harpooned([{ hit: false, crit: false, offset: 3, struck: null, hits: [], blast: [], burst: null }]);

    expect(eventText(s.w, s.shot)?.text).toBe(`Harpoon fires at ${vehicleName(s.w, s.trader.id)}: missed (40%)`);
  });

  it("tells the player its truck tore free of a line", () => {
    const s = harpooned([]);
    const mine = mountedParts(s.me, "engine")[0];

    expect(eventText(s.w, { t: "lineTorn", line: "l1", vehicle: s.me.id, part: mine.id, damage: 12 })).toMatchObject({ text: `You tear free of a harpoon line: ${partDef(mine.defId).name} −12`, cls: "bad" });
  });
});

describe("emitter pulse log", () => {
  it("names the trucks the player's pulse shuts down", () => {
    const w = emptyWorld();
    const me = w.player.vehicleId;
    const trader = addVehicle(w, "traders", "hauler", [], { x: 33, y: 30 });

    expect(eventText(w, { t: "pulse", vehicle: me, pos: { x: 30, y: 30 }, hit: [trader.id] })).toEqual({ text: `Your emitter pulse shuts down ${vehicleName(w, trader.id)}`, cls: "good" });
    expect(eventText(w, { t: "pulse", vehicle: me, pos: { x: 30, y: 30 }, hit: [] })).toEqual({ text: "Your emitter pulse catches nobody", cls: "dim" });
  });

  it("tells the player its truck is shut down and for how long", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    me.shutDown = { from: w.turn + 1, until: w.turn + 2 };

    expect(eventText(w, { t: "pulse", vehicle: raider.id, pos: { x: 33, y: 30 }, hit: [me.id] })).toEqual({ text: `${vehicleName(w, raider.id)}'s emitter pulse shuts your truck down for 2 turns`, cls: "bad" });
  });

  it("logs nothing for a pulse between other trucks", () => {
    const w = emptyWorld();
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    const trader = addVehicle(w, "traders", "hauler", [], { x: 35, y: 30 });

    expect(eventText(w, { t: "pulse", vehicle: raider.id, pos: { x: 33, y: 30 }, hit: [trader.id] })).toBeNull();
  });
});

describe("claymore log", () => {
  it("names the truck the player's claymore ram blasts and the damage it took", () => {
    const w = emptyWorld();
    const trader = addVehicle(w, "traders", "hauler", ["stockEngine"], { x: 33, y: 30 });
    const engine = mountedParts(trader, "engine")[0];
    const hits = [{ part: engine.id, damage: 20 }];

    expect(eventText(w, { t: "claymore", vehicle: w.player.vehicleId, part: "ram", other: trader.id, pos: { x: 32, y: 30 }, hits, selfHits: [] })).toMatchObject({ text: `Your claymore ram blasts ${vehicleName(w, trader.id)}: Stock engine −20`, cls: "good" });
  });

  it("tells the player a claymore ram blasted its truck", () => {
    const w = emptyWorld();
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    const engine = mountedParts(w.vehicles[0], "engine")[0];
    const hits = [{ part: engine.id, damage: 20 }];

    expect(eventText(w, { t: "claymore", vehicle: raider.id, part: "ram", other: w.player.vehicleId, pos: { x: 31, y: 30 }, hits, selfHits: [] })).toMatchObject({ text: `${vehicleName(w, raider.id)}'s claymore ram blasts your truck: ${partDef(engine.defId).name} −20`, cls: "bad" });
  });

  it("logs a seen blast between other trucks and nothing for one out of sight", () => {
    const w = emptyWorld();
    const raider = addVehicle(w, "raiders", "hauler", [], { x: 33, y: 30 });
    const trader = addVehicle(w, "traders", "hauler", [], { x: 35, y: 30 });
    const far = addVehicle(w, "raiders", "hauler", [], { x: 200, y: 200 });
    const farTrader = addVehicle(w, "traders", "hauler", [], { x: 202, y: 200 });

    expect(eventText(w, { t: "claymore", vehicle: raider.id, part: "ram", other: trader.id, pos: { x: 34, y: 30 }, hits: [], selfHits: [] })).toMatchObject({ text: `${vehicleName(w, raider.id)}'s claymore ram blasts ${vehicleName(w, trader.id)}`, cls: "dim" });
    expect(eventText(w, { t: "claymore", vehicle: far.id, part: "ram", other: farTrader.id, pos: { x: 201, y: 200 }, hits: [], selfHits: [] })).toBeNull();
  });
});

describe("caltrops log", () => {
  const wheelHits = (v: { items: { kind: string; part?: PartInstance }[] }) =>
    v.items.flatMap((i) => (i.part && partDef(i.part.defId).kind === "core" && i.part.defId.includes("wheel") ? [{ part: i.part.id, damage: 8 }] : []));

  it("lists the player's wheel damage like a hit", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const hits = wheelHits(me);

    const line = eventText(w, { t: "caltrops", vehicle: me.id, field: "g1", source: me.id, hits });

    expect(hits).toHaveLength(4);
    expect(line).toMatchObject({ cls: "bad", text: expect.stringMatching(/^You drive into caltrops: (.+ −8, ){3}.+ −8$/) });
  });

  it("names a seen truck that drives into the player's caltrops, with its wheel damage", () => {
    const w = emptyWorld();
    const trader = addVehicle(w, "traders", "hauler", [], { x: 33, y: 30 });

    const line = eventText(w, { t: "caltrops", vehicle: trader.id, field: "g1", source: w.player.vehicleId, hits: wheelHits(trader) });

    expect(line).toMatchObject({ cls: "good", text: expect.stringMatching(new RegExp(`^${vehicleName(w, trader.id)} drives into caltrops: .*−8`)) });
  });

  it("logs a caltrops event from an old save with no wheel numbers", () => {
    const w = emptyWorld();
    const me = w.player.vehicleId;

    expect(eventText(w, { t: "caltrops", vehicle: me, field: "g1", source: me, hits: [] })).toMatchObject({ text: "You drive into caltrops", cls: "bad" });
  });

  it("logs nothing for a truck out of sight", () => {
    const w = emptyWorld();
    const trader = addVehicle(w, "traders", "hauler", [], { x: 200, y: 200 });

    expect(eventText(w, { t: "caltrops", vehicle: trader.id, field: "g1", source: trader.id, hits: [] })).toBeNull();
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

describe("cargo spill log", () => {
  it("names the player's broken cargo part and how many items fell out", () => {
    const w = emptyWorld();
    const panniers = mountedParts(w.vehicles[0], "cargo")[0];
    const line = eventText(w, { t: "cargoSpilled", vehicle: w.player.vehicleId, part: panniers.id, pile: "spill-1", units: 6 });
    expect(line).toEqual({ text: "Your panniers broke. 6 items fell out.", cls: "bad" });
  });

  it("names the NPC whose cargo spilled", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "traders", "hauler", ["rack"], { x: 40, y: 30 });
    const line = eventText(w, { t: "cargoSpilled", vehicle: npc.id, part: mountedParts(npc, "cargo")[0].id, pile: "spill-2", units: 1 });
    expect(line).toEqual({ text: `${vehicleName(w, npc.id)}: cargo spilled on the ground`, cls: "good" });
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
      rounds: [{ hit: false, crit: false, offset: 3, struck: me.id, hits: [{ part: cab.id, damage: 4 }], blast: [], burst: null }],
    };
    const line = eventText(w, e);
    expect(line?.text).toContain(", stray fire hits ");
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
    expect(line.text).toMatch(/^.+ fires at .+, 1\/2 hit \(40%\): .+ −2$/);
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

  it("names the parts a shot hit on a truck it wrecked, which went onto the wreck's stock", () => {
    const { w, raider, armor, shot } = duel();
    if (!armor) throw new Error('The raider has no armor');
    const e = shot([{ part: armor.id, damage: 3 }]);
    w.events.push(e);
    wreckVehicle(w, raider);
    expect(eventText(w, e)!.text).toContain(`${partDef(armor.defId).name} −3`);
    expect(roundLabel(w, raider.id, [{ part: armor.id, damage: 3 }], false)).toBe("Arm: 3");
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

describe("money text", () => {
  it("reads a money event in M with its sign", () => {
    const w = emptyWorld();
    expect(eventText(w, { t: "money", amount: 4067, reason: "Sold salt" })).toEqual({ text: "+41 M: Sold salt", cls: "good" });
    expect(eventText(w, { t: "money", amount: -100, reason: "Fuel" })).toEqual({ text: "−1 M: Fuel", cls: "bad" });
  });
});

describe("tow text", () => {
  it("says free for a fee of 0 and keeps the price otherwise", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, "traders", "scout", ["stockEngine"], { x: 34, y: 30 });
    const town = REGION.towns[0].id;
    expect(eventText(w, { t: "towOffer", by: npc.id, town, fee: 0 })?.text).toMatch(/ for free\.$/);
    expect(eventText(w, { t: "towOffer", by: npc.id, town, fee: 4000 })?.text).toMatch(/ for 40 M\.$/);
    expect(eventText(w, { t: "towDone", by: npc.id, client: w.player.vehicleId, fee: 0 })).toMatchObject({ text: expect.stringMatching(/tows you into town for free\.$/), cls: "" });
    expect(eventText(w, { t: "towDone", by: npc.id, client: w.player.vehicleId, fee: 4067 })).toMatchObject({ text: expect.stringMatching(/takes 41 M\.$/), cls: "bad" });
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

describe("found log", () => {
  it("lists the goods, parts, fuel and supplies a search turn found", () => {
    const w = emptyWorld();
    const e: GameEvent = { t: "found", vehicle: w.player.vehicleId, stock: "rich", goods: { scrap: 3 }, parts: ["mg"], fuel: 2, supplies: 1 };

    expect(eventText(w, e)).toEqual({ text: `Found 3 Scrap metal, ${partDef("mg").name}, ${fuelLiters(2)} L of fuel and 1 supply.`, cls: "good" });
  });
});

describe("saleEstimate", () => {
  it("words a loss per unit against the average cost", () => {
    const e = saleEstimate(11, 1200, 2000);
    expect(e).toEqual({ kind: "loss", perUnit: 800, avgCost: 2000 });
    expect(estimateText(e)).toBe("\u22128 M");
    expect(estimateTitle(e)).toBe("Avg cost 20 M");
  });

  it("words a gain", () => {
    expect(estimateText(saleEstimate(1, 3800, 500))).toBe("+33 M");
  });

  it("calls a rounded zero even, never -0", () => {
    for (const basis of [3700, 3700.4]) {
      const e = saleEstimate(2, 3700, basis);
      expect(e.kind).toBe("even");
      expect(estimateText(e)).toBe("0");
    }
  });

  it("says when no cost is on record", () => {
    const e = saleEstimate(1, 42, undefined);
    expect(estimateText(e)).toBe("?");
    expect(estimateTitle(e)).toBe("No cost on record");
  });

  it("has nothing to say when nothing is held", () => {
    const e = saleEstimate(0, 37, 45);
    expect(e.kind).toBe("none");
    expect(estimateText(e)).toBe("");
  });

  it("keeps multi-digit values whole", () => {
    expect(estimateText(saleEstimate(12, 98700, 123400))).toBe("\u2212247 M");
  });

  it("only ever gives a signed number, ? or nothing", () => {
    for (const e of [saleEstimate(11, 3700, 4500), saleEstimate(3, 3700, 3000), saleEstimate(2, 3700, 3700), saleEstimate(2, 3700, undefined), saleEstimate(0, 3700, 100)]) {
      expect(estimateText(e)).toMatch(/^([+\u2212]\d[\d,]* M|0|\?|)$/);
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
    expect(GOODS_COLUMNS).toEqual({ good: "Good", theirs: "Theirs", buy: "Buy", sell: "Sell", held: "Held", profit: "Profit/unit" });
  });

  it("explains the profit head in a hover title without turns", () => {
    expect(PROFIT_HEAD_TITLE).toContain("average cost");
    expect(PROFIT_HEAD_TITLE).toContain("usual value");
    expect(PROFIT_HEAD_TITLE).not.toMatch(/turn/i);
  });

  it("words lot totals", () => {
    expect(lotTitle("buy", 5, 180)).toBe("Buy 5 for 2 M total");
    expect(lotTitle("sell", 11, 31200)).toBe("Sell all 11 for 312 M total");
  });
});

describe("wake-up log", () => {
  it("says an NPC regains consciousness, so the line does not read as cut off", () => {
    const w = emptyWorld();
    const npc = addVehicle(w, "scavengers", "scout", ["stockEngine"], { x: 40, y: 30 });
    const line = eventText(w, { t: "npcWake", vehicle: npc.id });
    expect(line?.text).toBe(`${vehicleName(w, npc.id)} regains consciousness`);
    expect(line?.cls).toBe("dim");
  });
});
