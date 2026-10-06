import { describe, expect, it } from "vitest";
import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import { fireWeapons } from "./combat";
import { corePart, mountedParts } from "./grid";
import { advanceNpcKnockouts } from "./defeat";
import { fireGuards } from "./guards";
import { siteGates } from "./sites";
import { addVehicle, emptyWorld } from "./testkit";
import type { Vec } from "./vec";

const bowl = REGION.towns.find((t) => t.id === "bowl")!;
const gate = siteGates(bowl)[0];
// A point `d` tiles out from the gate, away from the town.
function outside(d: number): Vec {
  return {
    x: gate.x + ((gate.x - bowl.pos.x) / bowl.radius) * d,
    y: gate.y + ((gate.y - bowl.pos.y) / bowl.radius) * d,
  };
}

function raiderFiringAt(at: Vec) {
  const w = emptyWorld(outside(2));
  const victim = addVehicle(w, "traders", "hauler", [], {
    x: at.x + 1.5,
    y: at.y,
  });
  const raider = addVehicle(w, "raiders", "buggy", ["mg"], at);
  raider.weaponOrders[mountedParts(raider, "weapon")[0].id] = {
    targetId: victim.id,
    aim: "body",
  };
  return { w, raider, victim };
}

describe("town guards", () => {
  it("extends the gate gun range to twelve tiles", () => {
    expect(RULES.guards.range).toBe(12);
  });

  it("shoot a vehicle that fires within the extended gate range", () => {
    const { w, raider } = raiderFiringAt(outside(10));
    fireWeapons(w);
    fireGuards(w);
    const shots = w.events.filter((e) => e.t === "guardShot");
    expect(shots.map((e) => e.t === "guardShot" && e.target)).toEqual([
      raider.id,
    ]);
    const rounds = shots[0].t === "guardShot" ? shots[0].rounds : [];
    expect(rounds).toHaveLength(RULES.guards.rounds);
  });

  it("leave alone a truck that fires at a raider", () => {
    const { w, raider } = raiderFiringAt(outside(4));
    raider.weaponOrders = {};
    const shooter = addVehicle(w, "traders", "hauler", ["mg"], { x: raider.pos.x - 1.5, y: raider.pos.y });
    shooter.weaponOrders[mountedParts(shooter, "weapon")[0].id] = { targetId: raider.id, aim: "body" };
    fireWeapons(w);
    expect(w.events.some((e) => e.t === "shot" && e.shooter === shooter.id)).toBe(true);
    fireGuards(w);
    expect(w.events.some((e) => e.t === "guardShot")).toBe(false);
  });

  it("spare a knocked-out driver with a working cab", () => {
    const { w, raider } = raiderFiringAt(outside(4));
    fireWeapons(w);
    expect(w.events.some((e) => e.t === "shot" && e.shooter === raider.id)).toBe(true);
    raider.defeat = { phase: "out", turns: 0, unseen: 0, foes: [], gaveUp: false };
    fireGuards(w);
    expect(w.events.some((e) => e.t === "guardShot")).toBe(false);
  });

  it("spare a woken NPC retreating after a knockout", () => {
    const { w, raider } = raiderFiringAt(outside(4));
    fireWeapons(w);
    raider.defeat = { phase: "retreat", turns: 3, unseen: 0, foes: [], gaveUp: false };
    fireGuards(w);
    expect(w.events.some((e) => e.t === "guardShot")).toBe(false);
  });

  it("fire at the same raider again once its defeat ends", () => {
    const { w, raider } = raiderFiringAt(outside(4));
    fireWeapons(w);
    raider.defeat = { phase: "retreat", turns: 3, unseen: 0, foes: [], gaveUp: false };
    delete raider.defeat;
    fireGuards(w);
    expect(w.events.some((e) => e.t === "guardShot" && e.target === raider.id)).toBe(true);
  });

  it("camp guns spare a roamer they knocked out, awake or retreating, and never destroy it", () => {
    const camp = REGION.locations.find((l) => l.kind === "camp")!;
    const gunGate = siteGates(camp)[0];
    const w = emptyWorld({ x: gunGate.x + 200, y: gunGate.y });
    const roamer = addVehicle(w, "traders", "hauler", [], { x: gunGate.x + 2, y: gunGate.y });
    corePart(roamer, "cab").hp = 0;
    roamer.defeat = { phase: "out", turns: 0, unseen: 0, foes: [], gaveUp: false };
    advanceNpcKnockouts(w);
    expect(roamer.defeat?.phase).toBe("retreat");
    expect(w.events.some((e) => e.t === "npcWake" && e.vehicle === roamer.id)).toBe(true);
    for (let turn = 0; turn < 5; turn++) fireGuards(w);
    expect(w.events.some((e) => e.t === "guardShot")).toBe(false);
  });

  it("leave alone vehicles that do not fire, and fights out of range", () => {
    const near = raiderFiringAt(outside(3));
    near.raider.weaponOrders = {};
    fireWeapons(near.w);
    fireGuards(near.w);
    expect(near.w.events.some((e) => e.t === "guardShot")).toBe(false);
    const far = raiderFiringAt(outside(RULES.guards.range + 2));
    fireWeapons(far.w);
    expect(far.w.events.some((e) => e.t === "shot")).toBe(true);
    fireGuards(far.w);
    expect(far.w.events.some((e) => e.t === "guardShot")).toBe(false);
  });

  it("shoot a player fighting through on a broken cab", () => {
    const w = emptyWorld(outside(4));
    const me = w.vehicles[0];
    w.player.perks.push("fightThrough");
    corePart(me, "cab").hp = 0;
    const victim = addVehicle(w, "traders", "hauler", [], { x: me.pos.x + 1.5, y: me.pos.y });
    me.weaponOrders[mountedParts(me, "weapon")[0].id] = { targetId: victim.id, aim: "body" };
    fireWeapons(w);
    fireGuards(w);
    expect(w.events.some((e) => e.t === "guardShot" && e.target === me.id)).toBe(true);
  });
});
