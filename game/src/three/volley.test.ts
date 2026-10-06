import { describe, expect, it } from "vitest";
import type { Break, Crash, Landing } from "../phys/drive";
import { addVehicle, emptyWorld } from "../sim/testkit";
import type { GameEvent, ShotRound } from "../sim/types";
import { BreakCues, type PartBreak, type ShotLike } from "./breakCues";
import { CollisionCues, collisionSteps, playShotFx, playVolley, type CombatHost, type VolleyHost } from "./volley";

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

describe("playVolley breaks", () => {
  const rd = (hits: { part: string; damage: number }[]): ShotRound => ({ hit: hits.length > 0, crit: false, offset: 0, struck: hits.length ? "t" : null, hits, blast: [] });
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
  const plain = (struck: string | null, blast: ShotRound["blast"] = []): ShotRound => ({ hit: struck === "t", crit: false, offset: 3, struck, hits: [], blast });

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
