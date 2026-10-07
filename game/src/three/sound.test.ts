import { describe, expect, it } from "vitest";
import type { GameEvent, ShotRound } from "../sim/types";
import { CHASSIS } from "../data/chassis";
import { engineFileFor, hornSoundFor, MIX, scorePhaseOf, SOUNDS } from "../data/sounds";
import type { Glide, SoundPlayer } from "../audio/player";
import { REGION } from "../data/region";
import { OUTPOSTS, siteGates } from "../sim/sites";
import { accentOf, CombatScore, CombatWatch, engineGlide, EngineStrain, loopLevels, musicPlaceAt, SoundDirector, SoundLoops, stingOf, strainGlides } from "./sound";
import type { CameraRig } from "./render/camera";

describe("stingOf", () => {
  it("plays the most important result only", () => {
    const events: GameEvent[] = [
      { t: "money", amount: 20, reason: "sale" },
      { t: "skillUp", skill: "driving", level: 2 },
      { t: "discover", location: "oasis" },
    ];
    expect(stingOf(events, "p")).toBe("level-up");
  });
  it("ignores spending and arrivals", () => {
    const events: GameEvent[] = [
      { t: "money", amount: -5, reason: "fuel" },
      { t: "arrived", vehicle: "npc1" },
    ];
    expect(stingOf(events, "p")).toBeNull();
    expect(stingOf([{ t: "arrived", vehicle: "p" }], "p")).toBeNull();
  });
  it("plays the defeat cue on a knockout", () => {
    expect(stingOf([{ t: "skillUp", skill: "driving", level: 2 }, { t: "knockout" }], "p")).toBe("defeat");
  });
});

describe("loopLevels", () => {
  const calm = { stormShare: 0, inCombat: false, place: null, paused: false } as const;
  const gains = (l: ReturnType<typeof loopLevels>) => [l.calmGain, l.townGain, l.outpostGain, l.abandonedGain, l.combatGain];
  it("raises the wind with the player's storm share", () => {
    expect(loopLevels(calm, MIX).windGain).toBe(MIX.wind.baseGain);
    expect(loopLevels({ ...calm, stormShare: 0.5 }, MIX).windGain).toBeCloseTo((MIX.wind.baseGain + MIX.wind.stormGain) / 2);
    expect(loopLevels({ ...calm, stormShare: 1 }, MIX).windGain).toBe(MIX.wind.stormGain);
  });
  it("switches music to combat while in combat", () => {
    expect(gains(loopLevels({ ...calm, inCombat: true }, MIX))).toEqual([0, 0, 0, 0, 1]);
    expect(gains(loopLevels(calm, MIX))).toEqual([1, 0, 0, 0, 0]);
  });
  it("finds the music place of a town, an outpost, a territory and the open road", () => {
    const territory = (id: string) => REGION.locations.find((l) => l.id === id)!.pos;
    expect(musicPlaceAt(siteGates(REGION.towns[0])[0])).toBe("town");
    expect(musicPlaceAt(siteGates(OUTPOSTS[0])[0])).toBe("outpost");
    expect(musicPlaceAt(territory("fallen-sun"))).toBe("abandoned");
    expect(musicPlaceAt(territory("orchard"))).toBe("abandoned");
    expect(musicPlaceAt({ x: 0, y: 0 })).toBeNull();
  });
  it("plays each place's own music, and combat music over it", () => {
    expect(gains(loopLevels({ ...calm, place: "town" }, MIX))).toEqual([0, 1, 0, 0, 0]);
    expect(gains(loopLevels({ ...calm, place: "outpost" }, MIX))).toEqual([0, 0, 1, 0, 0]);
    expect(gains(loopLevels({ ...calm, place: "abandoned" }, MIX))).toEqual([0, 0, 0, 1, 0]);
    for (const place of ["town", "outpost", "abandoned"] as const)
      expect(gains(loopLevels({ ...calm, place, inCombat: true }, MIX))).toEqual([0, 0, 0, 0, 1]);
  });
  it("muffles music during a pause between turns", () => {
    expect(loopLevels(calm, MIX).musicCutoffHz).toBe(MIX.music.openCutoffHz);
    expect(loopLevels({ ...calm, paused: true }, MIX).musicCutoffHz).toBe(MIX.music.pauseCutoffHz);
  });
  it("keeps the music choice when paused or near storms", () => {
    for (const inCombat of [true, false]) {
      const base = loopLevels({ ...calm, inCombat }, MIX);
      const other = loopLevels({ ...calm, inCombat, paused: true, stormShare: 1 }, MIX);
      expect([other.calmGain, other.combatGain]).toEqual([base.calmGain, base.combatGain]);
    }
  });
});

describe("accentOf", () => {
  const round = (hit: boolean, crit = false): ShotRound => ({ hit, crit, offset: 0, struck: hit ? "n" : null, hits: [], blast: [], burst: null });
  const shot = (shooter: string, target: string, rounds: ShotRound[]): GameEvent => ({
    t: "shot", shooter, weapon: "w", target, aim: "body", chance: 0.5, damageChance: 0.5, side: "front", rounds,
  });
  it("answers the player's volleys with hit, miss or crit", () => {
    expect(accentOf(shot("p", "n", [round(false), round(true)]), "p")).toBe("accent-hit");
    expect(accentOf(shot("p", "n", [round(false), round(false)]), "p")).toBe("accent-miss");
    expect(accentOf(shot("p", "n", [round(true), round(true, true)]), "p")).toBe("accent-crit");
  });
  it("answers volleys at the player with struck or crit, and enemy misses with nothing", () => {
    expect(accentOf(shot("n", "p", [round(true)]), "p")).toBe("accent-struck");
    expect(accentOf(shot("n", "p", [round(true, true)]), "p")).toBe("accent-crit");
    expect(accentOf(shot("n", "p", [round(false)]), "p")).toBeNull();
  });
  it("counts a round that strikes parts without a clean hit as struck", () => {
    const grazing: ShotRound = { hit: false, crit: false, offset: 0, struck: "n", hits: [{ part: "armor", damage: 3 }], blast: [], burst: null };
    expect(accentOf(shot("p", "n", [grazing]), "p")).toBe("accent-hit");
  });
  it("ignores fights between other trucks and answers the player's crashes", () => {
    expect(accentOf(shot("a", "b", [round(true, true)]), "p")).toBeNull();
    expect(accentOf({ t: "collision", a: "n", b: "p", hitsA: [], hitsB: [] }, "p")).toBe("accent-crash");
    expect(accentOf({ t: "collision", a: "n", b: "m", hitsA: [], hitsB: [] }, "p")).toBeNull();
  });
});

describe("engine sound assignment", () => {
  it("assigns an existing recording to every chassis", () => {
    for (const id of Object.keys(CHASSIS)) {
      expect(SOUNDS.engine.files).toContain(engineFileFor(id));
    }
    expect(engineFileFor("scout")).not.toBe(engineFileFor("hauler"));
    expect(() => engineFileFor("unknown")).toThrow("Unknown chassis");
  });

  it("changes the healthy and strained engine loops together, and only when the chassis changes", () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const glides: Record<string, Glide[]> = {};
    const player = {
      loop: (id: string, _at: unknown, file?: string) => {
        const name = file ?? id;
        if (id === "engine" || id === "engine-strain") started.push(name);
        return {
          glide: (g: Glide) => (glides[name] ??= []).push(g),
          once: () => {},
          setGain: () => {},
          stop: () => stopped.push(name),
        };
      },
    } as unknown as SoundPlayer;
    const loops = new SoundLoops(player, { setCombat: () => {}, setPaused: () => {}, tick: () => {} });
    const glide = engineGlide(0, 10, 1, MIX, false)!;

    loops.drive(glide, "scout", { from: 0, to: 0 });
    loops.drive(glide, "scout", { from: 1, to: 1 });
    loops.drive(glide, "scout", { from: 1, to: 0.5 });
    loops.drive(glide, "hauler", { from: 0, to: 0 });

    expect(started).toEqual([
      engineFileFor("scout"),
      "engine-strain",
      engineFileFor("hauler"),
      "engine-strain",
    ]);
    expect(stopped).toEqual([engineFileFor("scout"), "engine-strain"]);
    expect(glides[engineFileFor("scout")].map((g) => g.gainFrom)).toEqual([glide.gainFrom, 0, 0]);
    expect(glides["engine-strain"].map((g) => g.gainFrom)).toEqual([0, glide.gainFrom, glide.gainFrom, 0]);
  });

  it("plays the strained engine on the same bus and level as the engine, so mute and volume match", () => {
    expect(SOUNDS["engine-strain"].bus).toBe(SOUNDS.engine.bus);
    expect(SOUNDS["engine-strain"].volume).toBe(SOUNDS.engine.volume);
    expect(SOUNDS["engine-strain"].loop).toBe(true);
  });
});

describe("engine strain", () => {
  const run = (turns: [number, boolean][]) => {
    const strain = new EngineStrain();
    return turns.map(([turn, damaging]) => strain.next(turn, damaging));
  };

  it("strains fully from the start of the first damaging turn", () => {
    expect(run([[5, true]])).toEqual([{ from: 1, to: 1 }]);
  });

  it("falls back to healthy over two turns once damage stops, then stays healthy", () => {
    expect(run([[1, true], [2, false], [3, false], [4, false]])).toEqual([
      { from: 1, to: 1 },
      { from: 1, to: 1 - MIX.engine.strainRelease },
      { from: 0.5, to: 0 },
      { from: 0, to: 0 },
    ]);
  });

  it("never drops to none and back to full when damage flips every turn", () => {
    const levels = run([[1, true], [2, false], [3, true], [4, false]]);
    expect(levels.map((s) => s.to)).toEqual([1, 0.5, 1, 0.5]);
    expect(levels.every((s) => s.from > 0)).toBe(true);
  });

  it("starts healthy after a gap in turns, like a parked turn or a loaded save", () => {
    expect(run([[1, true], [3, false]])).toEqual([{ from: 1, to: 1 }, { from: 0, to: 0 }]);
    expect(run([[9, true], [2, false]])).toEqual([{ from: 1, to: 1 }, { from: 0, to: 0 }]);
  });

  it("never strains a turn without heat damage", () => {
    expect(run([[1, false], [2, false], [3, false]]).every((s) => s.from === 0 && s.to === 0)).toBe(true);
  });
});

describe("strainGlides", () => {
  const g = engineGlide(5, 15, 1, MIX, true)!;

  it("splits the engine level between the layers and keeps both rates", () => {
    const { healthy, strained } = strainGlides(g, { from: 1, to: 0.5 });
    expect(healthy.gainFrom + strained.gainFrom).toBeCloseTo(g.gainFrom);
    expect(healthy.gainTo + strained.gainTo).toBeCloseTo(g.gainTo);
    expect(strained.gainFrom).toBeCloseTo(g.gainFrom);
    expect(strained.gainTo).toBeCloseTo(g.gainTo / 2);
    for (const layer of [healthy, strained]) {
      expect([layer.rateFrom, layer.rateTo, layer.seconds, layer.fadeSeconds]).toEqual([g.rateFrom, g.rateTo, g.seconds, g.fadeSeconds]);
    }
  });

  it("leaves the strained layer silent without strain", () => {
    const { healthy, strained } = strainGlides(g, { from: 0, to: 0 });
    expect([strained.gainFrom, strained.gainTo]).toEqual([0, 0]);
    expect([healthy.gainFrom, healthy.gainTo]).toEqual([g.gainFrom, g.gainTo]);
  });
});

describe("engine strain log", () => {
  it("logs strain only on turns that have some", () => {
    const rig: Pick<CameraRig, "focus" | "screenOf"> = { focus: () => ({ x: 0, y: 0, z: 0 }), screenOf: () => ({ x: 0, y: 0 }) };
    const director = new SoundDirector({ play: () => {} }, rig, { accent: () => null });
    director.engineStrain({ from: 0, to: 0 });
    director.engineStrain({ from: 1, to: 0.5 });
    director.engineStrain({ from: 0.5, to: 0 });
    expect(director.log).toEqual(["engine-strain 1.0->0.5", "engine-strain 0.5->0.0"]);
  });
});

describe("next track", () => {
  const fake = () => {
    const calm: { file?: string; gains: number[]; stops: number[] }[] = [];
    const player = {
      setBusTone: () => {},
      loop: (id: string, _at: unknown, file?: string) => {
        const handle = { file, gains: [] as number[], stops: [] as number[] };
        if (id === "music-calm") calm.push(handle);
        return { glide: () => {}, once: () => {}, setGain: (g: number) => handle.gains.push(g), stop: (ms: number) => handle.stops.push(ms) };
      },
    } as unknown as SoundPlayer;
    return { calm, loops: new SoundLoops(player, { setCombat: () => {}, setPaused: () => {}, tick: () => {} }) };
  };

  it("crossfades the calm music to a new track at its current level", () => {
    const { calm, loops } = fake();
    loops.update({ stormShare: 1, inCombat: false, place: null, paused: false });
    loops.nextTrack();
    expect(calm).toHaveLength(2);
    expect(calm[0].stops).toEqual([MIX.music.fadeSeconds * 1000]);
    expect(calm[1].gains).toEqual([1]);
  });

  it("plays every calm track once before any repeats", () => {
    const { calm, loops } = fake();
    const files = SOUNDS["music-calm"].files;
    for (let i = 0; i < files.length; i++) loops.nextTrack();
    const cycle = calm.slice(0, files.length).map((c) => c.file);
    expect([...cycle].sort()).toEqual([...files].sort());
    expect(calm[files.length].file).toBe(cycle[0]);
  });

  it("keeps the new track silent in combat", () => {
    const { calm, loops } = fake();
    loops.update({ stormShare: 1, inCombat: true, place: null, paused: false });
    loops.nextTrack();
    expect(calm[1].gains).toEqual([0]);
  });
});

describe("horn sound assignment", () => {
  it("gives every chassis a distinct, loaded horn and rejects unknown chassis", () => {
    const sounds = Object.keys(CHASSIS).map((id) => hornSoundFor(id));
    expect(sounds.every((sound) => SOUNDS.horn.files.includes(sound.file))).toBe(true);
    expect(new Set(sounds.map((sound) => `${sound.file}:${sound.rate}`)).size).toBe(sounds.length);
    expect(() => hornSoundFor("unknown")).toThrow("Unknown chassis");
  });

  it("plays the assigned horn at the vehicle's position after its delay", () => {
    const calls: unknown[][] = [];
    const player: Pick<SoundPlayer, "play"> = { play: (...args) => { calls.push(args); } };
    const rig: Pick<CameraRig, "focus" | "screenOf"> = {
      focus: () => ({ x: 0, y: 0, z: 0 }),
      screenOf: () => ({ x: 50, y: 50 }),
    };
    const width = globalThis.window?.innerWidth;
    Object.defineProperty(globalThis, "window", { value: { innerWidth: 100 }, configurable: true });
    try {
      const director = new SoundDirector(player, rig, { accent: () => { throw new Error("no accent here"); } });
      director.honk({ x: 0, y: 0, z: 0 }, 500, "scout");
      expect(calls).toEqual([["horn", { pan: 0, gain: 1 }, 500, hornSoundFor("scout")]]);
    } finally {
      if (width === undefined) Reflect.deleteProperty(globalThis, "window");
      else Object.defineProperty(globalThis, "window", { value: { innerWidth: width }, configurable: true });
    }
  });
});

describe("engineGlide", () => {
  const e = MIX.engine;
  it("stays silent while standing still", () => {
    expect(engineGlide(0, 0, 1, MIX, false)).toBeNull();
  });
  it("revs up while speeding up and holds while cruising", () => {
    const up = engineGlide(0, e.topSpeedMs * 2, 1, MIX, false)!;
    expect([up.rateFrom, up.rateTo]).toEqual([e.idleRate, e.topRate + e.revUp]);
    expect([up.gainFrom, up.gainTo]).toEqual([e.idleGain, 1 + e.loadGain]);
    expect(up.brake).toBe(false);
    const cruise = engineGlide(10, 10, 1, MIX, false)!;
    expect(cruise.rateTo).toBe(cruise.rateFrom);
  });
  it("drops revs while slowing", () => {
    const g = engineGlide(10, 10 - e.loadMs, 1, MIX, false)!;
    expect(g.rateFrom - g.rateTo).toBeGreaterThan(e.revDown);
  });
  it("adds the air brake on a hard slowdown only", () => {
    expect(engineGlide(10, 10 - e.brakeMs, 1, MIX, false)!.brake).toBe(true);
    expect(engineGlide(10, 10 - e.brakeMs / 2, 1, MIX, false)!.brake).toBe(false);
  });
  it("is louder in overdrive at the same revs", () => {
    const normal = engineGlide(5, 10, 1, MIX, false)!;
    const over = engineGlide(5, 10, 1, MIX, true)!;
    expect(over.rateTo).toBe(normal.rateTo);
    expect(over.gainFrom).toBeCloseTo(normal.gainFrom * e.overdriveGain);
    expect(over.gainTo).toBeCloseTo(normal.gainTo * e.overdriveGain);
  });
});

describe("CombatWatch", () => {
  it("flags a hostile when it comes into sight after a whole turn out of it", () => {
    const watch = new CombatWatch();
    expect(watch.observe(1, ["a"]).sighted).toBe(true);
    expect(watch.observe(1, ["a"]).sighted).toBe(false);
    expect(watch.observe(2, []).sighted).toBe(false);
    expect(watch.observe(4, ["a"]).sighted).toBe(true);
  });
  it("ignores sight flicker inside a turn and into the next", () => {
    const watch = new CombatWatch();
    watch.observe(1, ["a"]);
    watch.observe(1, []);
    expect(watch.observe(1, ["a"]).sighted).toBe(false);
    watch.observe(2, []);
    expect(watch.observe(2, ["a"]).sighted).toBe(false);
  });
});

describe("CombatScore", () => {
  type BaseId = "score-drums" | "score-bass" | "score-horns" | "score-trombone";
  type Call = { id: BaseId; file: string; when: number; offset: number; gains: number[]; tones: number[]; ducks: number[] };
  type Play = [string, { pan: number; gain: number }, number, { file: string; rate: number }?];
  const fakePlayer = () => {
    const loops: Call[] = [];
    const plays: Play[] = [];
    const clock = { now: 2 };
    const player = {
      now: () => clock.now,
      play: (...args: Play) => { plays.push(args); },
      chooseWithPeak: (id: string) => ({ file: `${id}-1.ogg`, peak: 0.1 }),
      beatLoop: (id: BaseId, file: string, when: number, offset: number) => {
        const call: Call = { id, file, when, offset, gains: [], tones: [], ducks: [] };
        loops.push(call);
        // One second per beat for every base.
        const duration = SOUNDS[id].beat!.bars * 4;
        return {
          duration,
          setGain: (g: number) => call.gains.push(g),
          setTone: (hz: number) => call.tones.push(hz),
          glide: () => {},
          once: () => {},
          stop: () => {},
          duck: (t: number) => call.ducks.push(t),
        };
      },
    } as unknown as SoundPlayer;
    return { player, loops, plays, clock };
  };
  const run = (score: CombatScore, clock: { now: number }, seconds: number) => {
    for (let t = 0; t < seconds * 20; t++) {
      clock.now += 0.05;
      score.tick();
    }
  };
  const s = MIX.score;

  it("starts every base silent at one time, each at its first beat", () => {
    const { player, loops } = fakePlayer();
    new CombatScore(player, () => 0);
    expect(loops.map((l) => l.id)).toEqual(["score-drums", "score-bass", "score-horns", "score-trombone"]);
    expect(new Set(loops.map((l) => l.when)).size).toBe(1);
    expect(loops.map((l) => l.offset)).toEqual(loops.map((l) => scorePhaseOf(l.file)));
    expect(loops.every((l) => l.gains.length === 0)).toBe(true);
  });

  it("plays one random base per battle, quiet and muffled with no heat, and fades it out after", () => {
    const { player, loops } = fakePlayer();
    const rolls = [0.3, 0, 0, 0.1];
    const score = new CombatScore(player, () => rolls.shift() ?? 0);
    score.setCombat(true, 3);
    score.setCombat(true, 3);
    score.setCombat(false, 3);
    score.setCombat(true, 3);
    expect(loops.map((l) => l.gains)).toEqual([[s.quietGain], [s.quietGain, 0], [], []]);
    expect(loops[1].tones).toEqual([s.quietCutoffHz]);
  });

  it("ignores accents outside a battle", () => {
    const { player, plays } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    expect(score.accent("accent-crash", 0)).toBeNull();
    score.setCombat(true, 3);
    score.setCombat(false, 3);
    expect(score.accent("accent-crash", 0)).toBeNull();
    expect(plays).toEqual([]);
  });

  it("stabs an event with the sound's peak on it, then its tail on the lead, ducking the base under each hit", () => {
    const { player, loops, plays, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    expect(score.accent("accent-sighted", 1000)).toMatchObject({ cue: "accent-sighted", offer: "played" });
    expect(plays[0][2]).toBeCloseTo(900); // peak 0.1 s into the take, event 1 s ahead
    expect(plays[0][3]).toEqual({ file: "accent-sighted-1.ogg", rate: 1 });
    run(score, clock, 6);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((p) => p[0] === "accent-sighted" && p[1].pan === 0)).toBe(true);
    expect(loops[0].ducks).toHaveLength(plays.length);
  });

  it("ducks the base when a late stab sounds, never before now", () => {
    const { player, loops, plays, clock } = fakePlayer();
    clock.now = 0.05;
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    score.accent("accent-sighted", 0); // peak 0.1 s into the take, so its ideal start is already past
    expect(loops[0].ducks[0]).toBeCloseTo(clock.now + plays[0][2] / 1000);
  });

  it("plays light events on the secondary, to one side, without ducking the base", () => {
    const { player, loops, plays, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    score.accent("accent-hit", 0);
    run(score, clock, 6);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((p) => p[0] === "accent-hit" && p[1].pan === -s.secondaryPan)).toBe(true);
    expect(loops[0].ducks).toEqual([]);
  });

  it("opens the base as heat rises, on the next bar", () => {
    const { player, loops, clock } = fakePlayer();
    const score = new CombatScore(player, () => 0);
    score.setCombat(true, 3);
    for (let i = 0; i < 3; i++) score.accent("accent-crash", 0);
    run(score, clock, 4);
    expect(loops[0].gains.at(-1)).toBeGreaterThan(s.quietGain);
    expect(loops[0].tones.at(-1)).toBeGreaterThan(s.quietCutoffHz);
  });
});
