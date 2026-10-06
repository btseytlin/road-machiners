import { describe, expect, it } from "vitest";
import type { Break, Crash, Landing } from "../phys/drive";
import { addVehicle, emptyWorld } from "../sim/testkit";
import type { GameEvent, ShotRound } from "../sim/types";
import type { V3 } from "../phys/frames";
import { BreakCues, type PartBreak, type ShotLike } from "./breakCues";
import { CollisionCues, collisionSteps, playCrashes, playUtilitySounds, playVolley, type CombatHost, type VolleyHost } from "./volley";

const hit = (a: string, b: string): GameEvent => ({ t: "collision", a, b, hitsA: [], hitsB: [] });
const crash = (a: string, b: string, step: number) => ({ a, b, impact: 5, step }) as Crash;
const smash = (prop: string, vehicle: string, step: number): Break => ({ prop, vehicle, step });
const land = (vehicle: string, step: number): Landing => ({ vehicle, impact: 3, step });
const none = { crashes: [], breaks: [], landings: [] };

describe("collisionSteps", () => {
  it("matches a truck crash by pair in either order", () => {
    const timed = collisionSteps([hit("b", "a")], { ...none, crashes: [crash("a", "b", 12)] });
    expect(timed.map((t) => t.step)).toEqual([12]);
  });

  it("matches a ground crash and a landing of one truck once each", () => {
    const timed = collisionSteps([hit("a", "ground"), hit("a", "ground")], { ...none, crashes: [crash("a", "ground", 30)], landings: [land("a", 20)] });
    expect(timed.map((t) => t.step)).toEqual([30, 20]);
  });

  it("matches a break by prop and truck", () => {
    const timed = collisionSteps([hit("a", "fence1")], { ...none, breaks: [smash("fence1", "a", 7)] });
    expect(timed.map((t) => t.step)).toEqual([7]);
  });

  it("gives a far break no step", () => {
    expect(collisionSteps([hit("a", "fence1")], none).map((t) => t.step)).toEqual([null]);
  });

  it("takes each candidate once", () => {
    const timed = collisionSteps([hit("a", "b"), hit("a", "b")], { ...none, crashes: [crash("a", "b", 4)] });
    expect(timed.map((t) => t.step)).toEqual([4, null]);
  });
});

describe("collisionSteps with claymore blasts", () => {
  const blast = (vehicle: string, other: string): GameEvent => ({ t: "claymore", vehicle, other, pos: { x: 0, y: 0 }, hits: [], selfHits: [] });

  it("times each blast at the step of the crash it follows", () => {
    const timed = collisionSteps([hit("a", "b"), blast("a", "b"), blast("b", "a")], { ...none, crashes: [crash("a", "b", 12)] });
    expect(timed.map((t) => [t.event.t, t.step])).toEqual([["collision", 12], ["claymore", 12], ["claymore", 12]]);
  });

  it("throws on a blast that follows no crash of its trucks", () => {
    expect(() => collisionSteps([hit("a", "c"), blast("a", "b")], { ...none, crashes: [crash("a", "c", 3)] })).toThrow(/follows no crash/);
  });
});

describe("playCrashes with claymore blasts", () => {
  const blast = (other: string): GameEvent => ({ t: "claymore", vehicle: "a", other, pos: { x: 30, y: 30 }, hits: [], selfHits: [] });

  // The fx and sounds one blast plays, with these trucks seen.
  function played(e: GameEvent, seen: string[]): string[] {
    const out: string[] = [];
    const host = {
      world: emptyWorld(),
      fx: { claymoreBlast: () => out.push("fx"), crash: () => out.push("crash") },
      sound: { at: (cue: string) => out.push(cue) },
      eventPoint: (id: string) => (seen.includes(id) ? { x: 0, y: 0, z: 0 } : null),
    } as unknown as CombatHost;
    playCrashes(host, new CollisionCues([{ event: e as never, step: null }]), null);
    return out;
  }

  it("shows a blast against an obstacle when its truck is seen", () => {
    expect(played(blast("rock1"), ["a"])).toEqual(["fx", "explosion"]);
  });

  it("shows no blast when neither truck in it is seen", () => {
    expect(played(blast("b"), [])).toEqual([]);
  });
});

describe("CollisionCues", () => {
  it("returns each event once, when its step is reached, and the rest when movement ends", () => {
    const [e1, e2, e3] = [hit("a", "b"), hit("a", "c"), hit("a", "d")];
    const cues = new CollisionCues([
      { event: e1 as never, step: 5 },
      { event: e2 as never, step: 9 },
      { event: e3 as never, step: null },
    ]);
    expect(cues.due(4)).toEqual([]);
    expect(cues.due(6)).toEqual([e1]);
    expect(cues.due(6)).toEqual([]);
    expect(cues.due(null)).toEqual([e2, e3]);
    expect(cues.due(null)).toEqual([]);
  });
});

describe("playUtilitySounds", () => {
  const use = (vehicle: string, effect: "mortar" | "flare" | "sprout" | "claymore"): GameEvent => ({ t: "utility", vehicle, part: `${vehicle}-p`, effect, point: null });
  const pulse = (vehicle: string): GameEvent => ({ t: "pulse", vehicle, pos: { x: 0, y: 0 }, hit: [] });
  const seen: Record<string, V3> = { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } };

  function played(events: GameEvent[]): { cue: string; p: V3 }[] {
    const out: { cue: string; p: V3 }[] = [];
    playUtilitySounds({ world: { events }, eventPoint: (id) => seen[id] ?? null, sound: { at: (cue, p) => out.push({ cue, p }) } });
    return out;
  }

  it("plays the cannon cue for a mortar or flare launch and the spark cue for a pulse, at the user", () => {
    expect(played([use("a", "mortar"), use("b", "flare"), pulse("b")])).toEqual([
      { cue: "cannon-fire", p: seen.a },
      { cue: "cannon-fire", p: seen.b },
      { cue: "part-broken", p: seen.b },
    ]);
  });

  it("stays silent for unseen users and for utilities whose sound plays elsewhere or not at all", () => {
    expect(played([use("hidden", "mortar"), pulse("hidden"), use("a", "sprout"), use("a", "claymore")])).toEqual([]);
  });

  it("snaps a torn harpoon line at the truck it held, and stays silent when that truck is unseen", () => {
    const torn = (vehicle: string): GameEvent => ({ t: "lineTorn", line: "l1", vehicle, part: `${vehicle}-p`, damage: 12 });
    expect(played([torn("a"), torn("hidden")])).toEqual([{ cue: "line-tear", p: seen.a }]);
  });
});

describe("playVolley sounds", () => {
  // The cues one round of this gun plays as it fires and lands, striking the target or not.
  function cuesOf(weapon: string, struck: boolean): string[] {
    const cues: string[] = [];
    const p = { x: 0, y: 0, z: 0 };
    const round: ShotRound = { hit: struck, crit: false, offset: 0, struck: struck ? "t" : null, hits: [], blast: [] };
    const event = { t: "shot", shooter: "s", weapon: "w", target: "t", aim: "center", chance: 1, damageChance: 1, side: "front", rounds: [round] } as ShotLike;
    const fly = (_s: unknown, _m: unknown, _p: unknown, _r: unknown, c: { fired: (m: never) => void; landed: () => void }) => {
      c.fired({ pos: p } as never);
      c.landed();
    };
    const host = { world: emptyWorld(), fx: { shot: fly, label: () => {} }, sound: { at: (cue: string) => cues.push(cue) }, eventPoint: () => p, breakPart: () => {} } as unknown as VolleyHost;
    playVolley(host, p, () => ({ pos: p, dir: { x: 1, y: 0, z: 0 } }) as never, { x: 5, y: 0, z: 0 }, event, new BreakCues([event]), weapon, "t", new Map(), false);
    return cues;
  }

  it("fires and hooks with the harpoon's own cues", () => {
    expect(cuesOf("harpoon", true)).toEqual(["harpoon-fire", "harpoon-hook"]);
  });

  it("lets a harpoon miss like any round, and keeps every other gun on its look's cues", () => {
    expect(cuesOf("harpoon", false)).toEqual(["harpoon-fire", "miss"]);
    expect(cuesOf("mg", true)).toEqual(["mg-fire", "hit-metal"]);
  });
});

describe("playVolley breaks", () => {
  const rd = (hits: { part: string; damage: number }[]): ShotRound => ({ hit: hits.length > 0, crit: false, offset: 0, struck: hits.length ? "t" : null, hits, blast: [] });
  const GUN = (() => { const w = emptyWorld(); const v = addVehicle(w, "raiders", "buggy", ["mg", "stockEngine"], { x: 33, y: 30 }, 0); const it = v.items.find((i) => i.kind === "part" && i.part.defId === "mg"); return it && it.kind === "part" ? it.part.id : ""; })();
  const event = { t: "shot", shooter: "s", weapon: "mg", target: "t", aim: "center", chance: 1, damageChance: 1, side: "front", rounds: [rd([]), rd([{ part: GUN, damage: 2 }]), rd([{ part: GUN, damage: 3 }])] } as ShotLike;
  const partOff: GameEvent = { t: "partDisabled", vehicle: "t", part: GUN };

  function play() {
    const landed: (() => void)[] = [];
    const broken: PartBreak[] = [];
    const p = { x: 0, y: 0, z: 0 };
    const world = emptyWorld();
    const target = addVehicle(world, "raiders", "buggy", ["mg", "stockEngine"], { x: 33, y: 30 }, 0);
    target.id = "t";
    const host = {
      world,
      fx: { shot: (_s: unknown, _m: unknown, _p: unknown, _r: unknown, cues: { landed: () => void }) => landed.push(cues.landed), label: () => {} },
      sound: { at: () => {} },
      eventPoint: () => p,
      breakPart: (b: PartBreak) => broken.push(b),
    } as unknown as VolleyHost;
    return { landed, broken, host };
  }

  it("breaks the part as its breaking round lands, once", () => {
    const { landed, broken, host } = play();
    const breaks = new BreakCues([partOff, event]);
    playVolley(host, { x: 0, y: 0, z: 0 }, () => ({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 1, y: 0, z: 0 } }) as never, { x: 5, y: 0, z: 0 }, event, breaks, "mg", "t", new Map(), false);
    expect(landed).toHaveLength(3);
    landed[0]();
    landed[1]();
    expect(broken).toEqual([]);
    landed[2]();
    landed[2]();
    expect(broken).toEqual([{ vehicle: "t", part: GUN }]);
  });
});
