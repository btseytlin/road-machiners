import { describe, expect, it } from "vitest";
import type { Break, Crash, Landing } from "../phys/drive";
import { addVehicle, emptyWorld } from "../sim/testkit";
import type { GameEvent, ShotRound } from "../sim/types";
import { groundPoint, type V3 } from "../phys/frames";
import { FLARE_LOOK, SHELL } from "./render/hazards";
import { BreakCues, type PartBreak, type ShotLike } from "./breakCues";
import { CollisionCues, collisionSteps, playCrashes, playShotFx, playUtilitySounds, playVolley, type CombatHost, type VolleyHost } from "./volley";

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
  const blast = (vehicle: string, other: string): GameEvent => ({ t: "claymore", vehicle, part: "ram", other, pos: { x: 0, y: 0 }, hits: [], selfHits: [] });

  it("times each blast at the step of the crash it follows", () => {
    const timed = collisionSteps([hit("a", "b"), blast("a", "b"), blast("b", "a")], { ...none, crashes: [crash("a", "b", 12)] });
    expect(timed.map((t) => [t.event.t, t.step])).toEqual([["collision", 12], ["claymore", 12], ["claymore", 12]]);
  });

  it("throws on a blast that follows no crash of its trucks", () => {
    expect(() => collisionSteps([hit("a", "c"), blast("a", "b")], { ...none, crashes: [crash("a", "c", 3)] })).toThrow(/follows no crash/);
  });
});

describe("playCrashes with claymore blasts", () => {
  const blast = (other: string): GameEvent => ({ t: "claymore", vehicle: "a", part: "ram", other, pos: { x: 30, y: 30 }, hits: [], selfHits: [] });

  const RAM_AT = { x: 7, y: 2, z: 9 };
  const drawn = (ram: boolean) => new Map([["a", { hasPart: (id: string) => ram && id === "ram", partPoint: () => RAM_AT }]]);

  function played(e: GameEvent, seen: string[], views = drawn(true)): (string | V3)[] {
    const out: (string | V3)[] = [];
    const world = emptyWorld();
    const host = {
      world,
      views,
      fx: { claymoreBlast: (p: V3) => out.push(p), crash: () => out.push("crash") },
      sound: { at: (cue: string) => out.push(cue) },
      eventPoint: (id: string) => (seen.includes(id) ? { x: 0, y: 0, z: 0 } : null),
    } as unknown as CombatHost;
    playCrashes(host, new CollisionCues([{ event: e as never, step: null }]), null);
    return out;
  }

  it("shows the blast at the ram on its drawn truck, also against an obstacle", () => {
    expect(played(blast("rock1"), ["a"])).toEqual([RAM_AT, "explosion"]);
    expect(played(blast("b"), ["b"])).toEqual([RAM_AT, "explosion"]);
  });

  it("shows the blast at the ram's saved face when the view does not draw the ram", () => {
    const g = groundPoint(emptyWorld().terrain, { x: 30, y: 30 });
    expect(played(blast("b"), ["a"], drawn(false))[0]).toEqual({ x: g.x, y: g.y + 1, z: g.z });
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
  type Effect = "mortar" | "flare" | "sprout" | "caltrops" | "oil" | "claymore";
  const use = (vehicle: string, effect: Effect, point: { x: number; y: number } | null = null): GameEvent => ({ t: "utility", vehicle, part: `${vehicle}-p`, effect, point });
  const pulse = (vehicle: string): GameEvent => ({ t: "pulse", vehicle, pos: { x: 0, y: 0 }, hit: [] });
  const seen: Record<string, V3> = { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } };
  const terrain = emptyWorld().terrain;

  function played(events: GameEvent[]): { cue: string; p: V3; delayMs: number }[] {
    const out: { cue: string; p: V3; delayMs: number }[] = [];
    playUtilitySounds({ world: { events, terrain }, eventPoint: (id) => seen[id] ?? null, sound: { at: (cue, p, delayMs) => out.push({ cue, p, delayMs }) } });
    return out;
  }

  it("plays each utility's own cue at its user as it is used, and the pulse's crack", () => {
    expect(played([use("a", "mortar"), use("b", "flare"), use("a", "sprout"), use("a", "caltrops"), use("b", "oil"), pulse("b")]).map((s) => [s.cue, s.p, s.delayMs])).toEqual([
      ["mortar-fire", seen.a, 0],
      ["flare-fire", seen.b, 0],
      ["smoke-burst", seen.a, 0],
      ["caltrops-drop", seen.a, 0],
      ["oil-spill", seen.b, 0],
      ["emitter-pulse", seen.b, 0],
    ]);
  });

  it("booms the mortar's shell where it lands and bursts the flare at its point, when each flight ends", () => {
    const point = { x: 40, y: 30 };
    const ground = groundPoint(terrain, point);
    expect(played([use("a", "mortar", point), use("a", "flare", point)]).filter((s) => s.delayMs > 0)).toEqual([
      { cue: "cannon-fire", p: ground, delayMs: SHELL.flightMs },
      { cue: "flare-burst", p: ground, delayMs: FLARE_LOOK.flightMs },
    ]);
  });

  it("bursts a tire on a truck that drives into caltrops", () => {
    expect(played([{ t: "caltrops", vehicle: "b", field: "g1", source: "a", hits: [] }])).toEqual([{ cue: "caltrops-hit", p: seen.b, delayMs: 0 }]);
  });

  it("stays silent for unseen users and for a claymore, whose blast plays with its crash", () => {
    expect(played([use("hidden", "mortar", { x: 40, y: 30 }), pulse("hidden"), use("a", "claymore")])).toEqual([]);
  });

  it("snaps a torn harpoon line at the truck it held, and stays silent when that truck is unseen", () => {
    const torn = (vehicle: string): GameEvent => ({ t: "lineTorn", line: "l1", vehicle, part: `${vehicle}-p`, damage: 12 });
    expect(played([torn("a"), torn("hidden")])).toEqual([{ cue: "line-tear", p: seen.a, delayMs: 0 }]);
  });
});

describe("playVolley sounds", () => {
  function cuesOf(weapon: string, struck: boolean): string[] {
    const cues: string[] = [];
    const p = { x: 0, y: 0, z: 0 };
    const round: ShotRound = { hit: struck, crit: false, offset: 0, struck: struck ? "t" : null, hits: [], blast: [], burst: null };
    const event = { t: "shot", shooter: "s", weapon: "w", target: "t", aim: "center", chance: 1, damageChance: 1, side: "front", rounds: [round] } as ShotLike;
    const fly = (_s: unknown, _m: unknown, _p: unknown, _r: unknown, c: { fired: (m: never) => void; landed: () => void }) => {
      c.fired({ pos: p } as never);
      c.landed();
    };
    const host = { world: emptyWorld(), fx: { shot: fly, label: () => {} }, sound: { at: (cue: string) => cues.push(cue) }, eventPoint: () => p, breakPart: () => {} } as unknown as VolleyHost;
    playVolley(host, p, () => ({ pos: p, dir: { x: 1, y: 0, z: 0 } }) as never, { x: 5, y: 0, z: 0 }, () => p, event, new BreakCues([event]), weapon, "t", new Map(), false);
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
  const rd = (hits: { part: string; damage: number }[]): ShotRound => ({ hit: hits.length > 0, crit: false, offset: 0, struck: hits.length ? "t" : null, hits, blast: [], burst: null });
  const GUN = (() => { const w = emptyWorld(); const v = addVehicle(w, "raiders", "buggy", ["mg", "stockEngine"], { x: 33, y: 30 }, 0); const it = v.items.find((i) => i.kind === "part" && i.part.defId === "mg"); return it && it.kind === "part" ? it.part.id : ""; })();
  const event = { t: "shot", shooter: "s", weapon: "mg", target: "t", aim: "center", chance: 1, damageChance: 1, side: "front", rounds: [rd([]), rd([{ part: GUN, damage: 2 }]), rd([{ part: GUN, damage: 3 }])] } as ShotLike;
  const partOff: GameEvent = { t: "partDisabled", vehicle: "t", part: GUN };

  function play(eventPoint: (id: string) => { x: number; y: number; z: number } | null = () => ({ x: 0, y: 0, z: 0 })) {
    const landed: (() => void)[] = [];
    const sounds: string[] = [];
    const broken: PartBreak[] = [];
    const world = emptyWorld();
    const target = addVehicle(world, "raiders", "buggy", ["mg", "stockEngine"], { x: 33, y: 30 }, 0);
    target.id = "t";
    const host = {
      world,
      fx: { shot: (_s: unknown, _m: unknown, _p: unknown, _r: unknown, cues: { landed: () => void }) => landed.push(cues.landed), label: () => {} },
      sound: { at: (cue: string) => sounds.push(cue) },
      eventPoint,
      breakPart: (b: PartBreak) => broken.push(b),
    } as unknown as VolleyHost;
    return { landed, broken, sounds, host };
  }

  it("breaks the part as its breaking round lands, once", () => {
    const { landed, broken, host } = play();
    const breaks = new BreakCues([partOff, event]);
    playVolley(host, { x: 0, y: 0, z: 0 }, () => ({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 1, y: 0, z: 0 } }) as never, { x: 5, y: 0, z: 0 }, (o) => ({ x: 5, y: 0, z: o }), event, breaks, "mg", "t", new Map(), false);
    expect(landed).toHaveLength(3);
    landed[0]();
    landed[1]();
    expect(broken).toEqual([]);
    landed[2]();
    landed[2]();
    expect(broken).toEqual([{ vehicle: "t", part: GUN }]);
  });

  const volley = (rounds: ShotRound[], eventPoint?: (id: string) => { x: number; y: number; z: number } | null) => {
    const played = play(eventPoint);
    const ev = { ...event, rounds } as ShotLike;
    playVolley(played.host, { x: 0, y: 0, z: 0 }, () => ({ pos: { x: 0, y: 1, z: 0 }, dir: { x: 1, y: 0, z: 0 } }) as never, { x: 5, y: 0, z: 0 }, (o) => ({ x: 5, y: 0, z: o }), ev, new BreakCues([ev]), "mg", "t", new Map(), false);
    played.landed.forEach((l) => l());
    return played.sounds;
  };
  const plain = (struck: string | null, blast: ShotRound["blast"] = []): ShotRound => ({ hit: struck === "t", crit: false, offset: 3, struck, hits: [], blast, burst: null });

  it("sounds a ground miss as a miss and a hit as metal", () => {
    expect(volley([plain(null)])).toEqual(["miss"]);
    expect(volley([plain("t")])).toEqual(["hit-metal"]);
  });

  it("sounds a ground miss whose blast damaged a truck as metal", () => {
    expect(volley([plain(null, [{ vehicle: "o", hits: [] }])])).toEqual(["hit-metal"]);
  });

  it("sounds nothing for a stray into a truck that is not shown", () => {
    expect(volley([plain("o")], (id) => (id === "o" ? null : { x: 0, y: 0, z: 0 }))).toEqual([]);
  });

  it("throws when a shot names a truck that is in neither list", () => {
    const { host } = play();
    const e = { ...event, t: "shot" } as unknown as GameEvent;
    host.world.events = [e];
    expect(() => playShotFx(host as unknown as CombatHost, new BreakCues([]))).toThrow(/unknown vehicle/);
  });
});
