// Turns game events into sound cues. Positioned cues use the same points as the visual effects, so fog of
// war silences what the player may not see.

import { BEATS_PER_BAR, engineFileFor, engineStrainFileFor, hornSoundFor, MIX, scorePhaseOf, SOUNDS, type CueId } from "../data/sounds";
import { Fading, SoundDesigner, type Grid, type Hit, type Offer } from "../audio/designer";
import { shuffled, spatial } from "../audio/pick";
import type {
  BeatLoopHandle,
  Glide,
  LoopHandle,
  Placement,
  SoundPlayer,
} from "../audio/player";
import type { V3, VehicleFrame } from "../phys/frames";
import { PHYSICS } from "../data/physics";
import type { GameEvent, ShotRound } from "../sim/types";
import { isInTerritory, isNearOutpost, isNearTown } from "../sim/sites";
import type { Vec } from "../sim/vec";
import type { CameraRig } from "./render/camera";

const CENTER: Placement = { pan: 0, gain: 1 };
const LOG_SIZE = 100; // recent cues kept for debugging, enough for several busy turns

// Turn result stings, most important first. Only the first one found plays, so a busy turn stays readable.
const STINGS: {
  cue: CueId;
  match: (e: GameEvent, playerId: string) => boolean;
}[] = [
  { cue: "defeat", match: (e) => e.t === "knockout" },
  { cue: "level-up", match: (e) => e.t === "skillUp" },
  { cue: "discover", match: (e) => e.t === "discover" },
  { cue: "money", match: (e) => e.t === "money" && e.amount > 0 },
];

export function stingOf(events: GameEvent[], playerId: string): CueId | null {
  return (
    STINGS.find((s) => events.some((e) => s.match(e, playerId)))?.cue ?? null
  );
}

// Combat score: one random base loop per battle, and two accent lines that SoundDesigner plays on its beat.
export type AccentCue = Extract<CueId, `accent-${string}`>;
const BASE_CUES = ["score-drums", "score-bass", "score-horns", "score-trombone"] as const;
type BaseCue = (typeof BASE_CUES)[number];
type Base = { loop: BeatLoopHandle; grid: Grid };

const START_LEAD_SECONDS = 0.1; // bases are scheduled to start this far ahead, so each starts on its first beat
const ACCENT_LEAD_SECONDS = 0.02; // earliest accent start from now, so Web Audio never gets a time in the past
const LOOKAHEAD_SECONDS = 0.15; // hits are scheduled this far ahead, several frames, so none is missed


// What the score did with one accent request, for the sound log.
export type AccentResult = { cue: AccentCue; offer: Offer["result"]; heat: number };

export class CombatScore {
  private bases: Base[];
  private active: Base | null = null;
  private designer: SoundDesigner | null = null;
  private heat = new Fading(MIX.score.heatHalfLifeSeconds);
  private lastBar = -Infinity;
  private paused = false;

  constructor(
    private player: Pick<SoundPlayer, "beatLoop" | "now" | "play" | "chooseWithPeak">,
    private roll: () => number,
  ) {
    const start = player.now() + START_LEAD_SECONDS;
    this.bases = BASE_CUES.map((id) => this.base(id, start));
  }

  // A battle starts on one random base with fresh lines. Heat carries over, so a quick second fight starts warm.
  setCombat(on: boolean, fadeSeconds: number): void {
    if (on === (this.active !== null)) return;
    this.active?.loop.setGain(0, fadeSeconds);
    this.active = on ? this.bases[Math.floor(this.roll() * this.bases.length)] : null;
    this.designer = null;
    if (!this.active) return;
    const now = this.player.now();
    this.designer = new SoundDesigner(this.active.grid, MIX.score, this.roll, now + ACCENT_LEAD_SECONDS);
    this.lastBar = this.barAt(this.active, now);
    this.setIntensity(this.active, now, fadeSeconds);
  }

  // In a turn pause the lead repeats its last phrase a few times, then only the base plays.
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // Called every frame: schedules the lines' hits just ahead, and on each bar moves the base toward the heat.
  tick(): void {
    const base = this.active;
    if (!base || !this.designer) return;
    const now = this.player.now();
    const hits = this.designer.step(now + ACCENT_LEAD_SECONDS, now + LOOKAHEAD_SECONDS, this.paused, this.heat.read(now));
    for (const h of hits) this.sound(base, h, now);
    const bar = this.barAt(base, now);
    if (bar <= this.lastBar) return;
    this.lastBar = bar;
    this.setIntensity(base, now, base.grid.beat * base.grid.beatsPerBar);
  }

  // Outside a battle the score is silent and events are ignored. In one, the event adds heat, and its stab plays
  // with the sound's loudest moment delayMs from now, or as soon as it can when that is too soon.
  accent(cue: AccentCue, delayMs: number): AccentResult | null {
    const base = this.active;
    if (!base || !this.designer) return null;
    const now = this.player.now();
    const plan = MIX.score.accents[cue];
    this.heat.add(now, plan.weight);
    const take = this.player.chooseWithPeak(cue);
    const offer = this.designer.offer(cue, plan, now + delayMs / 1000, take.peak, this.heat.read(now));
    if (offer.stab) this.sound(base, offer.stab, now, take.file);
    return { cue, offer: offer.result, heat: this.heat.read(now) };
  }

  // A hit whose time is too soon or already past sounds as soon as it can, and the base ducks when it sounds.
  private sound(base: Base, h: Hit, now: number, file?: string): void {
    const start = now + Math.max(ACCENT_LEAD_SECONDS, h.time - now);
    this.player.play(h.cue as AccentCue, { pan: h.pan, gain: h.gain }, (start - now) * 1000, file === undefined ? undefined : { file, rate: 1 });
    const s = MIX.score;
    if (h.line === "lead") base.loop.duck(start, s.duckGain, s.duckAttackSeconds, base.grid.beat * s.duckReleaseBeats);
  }

  // Quiet heat leaves the base lower and muffled; fullHeat opens it.
  private setIntensity(base: Base, now: number, rampSeconds: number): void {
    const s = MIX.score;
    const t = Math.min(1, this.heat.read(now) / s.fullHeat);
    base.loop.setGain(s.quietGain + (1 - s.quietGain) * t, rampSeconds);
    base.loop.setTone(s.quietCutoffHz * (s.openCutoffHz / s.quietCutoffHz) ** t, rampSeconds);
  }

  private barAt(base: Base, time: number): number {
    return Math.floor((time - base.grid.start) / (base.grid.beat * base.grid.beatsPerBar));
  }

  // Every base starts silent at one time from its first beat, so its grid is known from then on.
  private base(id: BaseCue, start: number): Base {
    const files = SOUNDS[id].files;
    const beat = SOUNDS[id].beat;
    if (files.length !== 1) throw new Error(`Score base ${id} needs exactly one file, has ${files.length}`);
    if (!beat) throw new Error(`Score base ${id} needs a beat`);
    const loop = this.player.beatLoop(id, files[0], start, scorePhaseOf(files[0]));
    return { loop, grid: { start, beat: loop.duration / (beat.bars * BEATS_PER_BAR), beatsPerBar: BEATS_PER_BAR } };
  }
}

// A volley or crash the score answers.
export function accentOf(e: GameEvent, playerId: string): AccentCue | null {
  if (e.t === "collision") return [e.a, e.b].includes(playerId) ? "accent-crash" : null;
  if (e.t === "shot") return volleyAccent(e.rounds, e.shooter === playerId, e.target === playerId);
  return null;
}

// Crits by or at the player win over plain hits. Enemy misses get none.
function volleyAccent(rounds: ShotRound[], mine: boolean, atPlayer: boolean): AccentCue | null {
  if (!mine && !atPlayer) return null;
  if (rounds.some((r) => r.crit)) return "accent-crit";
  return plainAccent(rounds.some((r) => r.hit || r.hits.length > 0), mine);
}

function plainAccent(struck: boolean, mine: boolean): AccentCue | null {
  if (mine) return struck ? "accent-hit" : "accent-miss";
  return struck ? "accent-struck" : null;
}

export type CombatSigns = { sighted: boolean };

// Remembers the last turn each hostile was in sight.
export class CombatWatch {
  private seen = new Map<string, number>();

  // sighted is true when a hostile in sight now was out of sight for a whole turn. Sight flickers from frame
  // to frame while a turn plays, so a gap inside one turn does not count.
  observe(turn: number, hostiles: string[]): CombatSigns {
    const sighted = hostiles.some((id) => (this.seen.get(id) ?? -Infinity) < turn - 1);
    for (const [id, last] of this.seen) if (last < turn - 1) this.seen.delete(id);
    for (const id of hostiles) this.seen.set(id, turn);
    return { sighted };
  }
}

export class SoundDirector {
  readonly log: string[] = []; // recent cue ids and accent decisions, newest last; read it from __ROAM__ in dev

  constructor(
    private player: Pick<SoundPlayer, "play">,
    private rig: Pick<CameraRig, "focus" | "screenOf">,
    private score: Pick<CombatScore, "accent">,
  ) {}

  // Logs what the score did with every accent request, and the heat after it.
  accent(cue: AccentCue, delayMs: number): void {
    const r = this.score.accent(cue, delayMs);
    if (!r) return;
    this.record(`${cue} ${r.offer} heat${r.heat.toFixed(1)}`);
  }

  // delayOf gives when each event's moment comes, or null to skip the event in this call.
  accents(events: GameEvent[], playerId: string, delayOf: (e: GameEvent) => number | null): void {
    for (const e of events) {
      const cue = accentOf(e, playerId);
      const delay = cue && delayOf(e);
      if (cue && delay !== null) this.accent(cue, delay);
    }
  }

  at(cue: CueId, p: V3, delayMs: number): void {
    this.record(cue);
    this.player.play(cue, this.place(p), delayMs);
  }

  honk(p: V3, delayMs: number, chassisId: string): void {
    this.record("horn");
    this.player.play("horn", this.place(p), delayMs, hornSoundFor(chassisId));
  }

  ui(cue: CueId): void {
    this.record(cue);
    this.player.play(cue, CENTER, 0);
  }

  // Logs the engine strain of a turn that has any.
  engineStrain(s: Strain): void {
    if (s.from > 0 || s.to > 0) this.record(`engine-strain ${s.from.toFixed(1)}->${s.to.toFixed(1)}`);
  }

  private record(cue: string): void {
    this.log.push(cue);
    if (this.log.length > LOG_SIZE) this.log.shift();
  }

  private place(p: V3): Placement {
    const f = this.rig.focus();
    const distance = Math.hypot(p.x - f.x, p.z - f.z);
    return spatial(
      this.rig.screenOf(p).x,
      window.innerWidth,
      distance,
      MIX.halfGainMeters,
      MIX.panWidth,
    );
  }
}

// A place with its own music, or null on the open road.
export type MusicPlace = "town" | "outpost" | "abandoned" | null;

// Town music plays near town gates, outpost music near outpost gates, and abandoned music inside territories.
export function musicPlaceAt(pos: Vec): MusicPlace {
  if (isNearTown(pos, MIX.music.musicReachTiles)) return "town";
  if (isNearOutpost(pos, MIX.music.musicReachTiles)) return "outpost";
  return isInTerritory(pos) ? "abandoned" : null;
}

// What the loops respond to each frame.
// stormShare is the player's storm exposure in [0, 1], from stormShare() in src/sim/weather.ts; it sets the storm's share of the wind.
export type LoopState = { stormShare: number; inCombat: boolean; place: MusicPlace; paused: boolean };

export type LoopLevels = {
  windGain: number;
  calmGain: number;
  townGain: number;
  outpostGain: number;
  abandonedGain: number;
  combatGain: number;
  musicCutoffHz: number;
  paused: boolean;
};

// Which music plays: combat wins, then the place's music, then calm road music.
function musicOf(s: LoopState): "calm" | "combat" | NonNullable<MusicPlace> {
  if (s.inCombat) return "combat";
  return s.place ?? "calm";
}

export function loopLevels(s: LoopState, mix: typeof MIX): LoopLevels {
  const w = mix.wind;
  const near = s.stormShare;
  const music = musicOf(s);
  return {
    windGain: w.baseGain + (w.stormGain - w.baseGain) * near,
    calmGain: Number(music === "calm"),
    townGain: Number(music === "town"),
    outpostGain: Number(music === "outpost"),
    abandonedGain: Number(music === "abandoned"),
    combatGain: Number(music === "combat"),
    musicCutoffHz: s.paused ? mix.music.pauseCutoffHz : mix.music.openCutoffHz,
    paused: s.paused,
  };
}

// Engine over one turn from the player's speed at its start and end, in m/s, or null when standing still.
export function computeEngineGlide(
  frames: VehicleFrame[],
  seconds: number,
  mix: typeof MIX,
  overdrive: boolean,
): ReturnType<typeof engineGlide> {
  return engineGlide(
    computeStepSpeed(frames, 1),
    computeStepSpeed(frames, frames.length - 1),
    seconds,
    mix,
    overdrive,
  );
}

function computeStepSpeed(
  frames: VehicleFrame[] | undefined,
  step: number,
): number {
  if (!frames || step < 1 || step >= frames.length) return 0;
  const a = frames[step - 1].pos;
  const b = frames[step].pos;
  return Math.hypot(b.x - a.x, b.z - a.z) * PHYSICS.stepsPerSecond;
}

export function engineGlide(
  from: number,
  to: number,
  seconds: number,
  mix: typeof MIX,
  overdrive: boolean,
): (Glide & { brake: boolean }) | null {
  const e = mix.engine;
  if (Math.max(from, to) < e.movingMs) return null;
  const share = (v: number) => Math.min(1, v / e.topSpeedMs);
  const rate = (v: number) => e.idleRate + (e.topRate - e.idleRate) * share(v);
  const gain = (v: number) => e.idleGain + (1 - e.idleGain) * share(v);
  const load = Math.max(-1, Math.min(1, (to - from) / e.loadMs));
  const loud = overdrive ? e.overdriveGain : 1;
  return {
    rateFrom: rate(from),
    rateTo: rate(to) + load * (load > 0 ? e.revUp : e.revDown),
    gainFrom: gain(from) * loud,
    gainTo: (gain(to) + load * e.loadGain) * loud,
    seconds,
    fadeSeconds: e.fadeSeconds,
    brake: from - to >= e.brakeMs,
  };
}

// How strained the engine note is over one turn, from 0 healthy to 1 fully strained, at its start and end.
export type Strain = { from: number; to: number };

// Strain level between turns. A turn with heat damage is fully strained from its start; a turn without it falls by
// MIX.engine.strainRelease, so the note comes back over two turns and never flips between full and none when damage
// comes and goes. A turn that does not follow the last played one, like after a parked turn or a load, starts healthy.
export class EngineStrain {
  private turn: number | null = null;
  private level = 0;

  next(turn: number, damaging: boolean): Strain {
    const before = this.turn === turn - 1 ? this.level : 0;
    const s = damaging ? { from: 1, to: 1 } : { from: before, to: Math.max(0, before - MIX.engine.strainRelease) };
    this.turn = turn;
    this.level = s.to;
    return s;
  }
}

// Splits one engine glide between the healthy and strained loops: same rates, and levels that add up to the glide's.
export function strainGlides(g: Glide, s: Strain): { healthy: Glide; strained: Glide } {
  const level = (from: number, to: number): Glide => ({ ...g, gainFrom: g.gainFrom * from, gainTo: g.gainTo * to });
  return { healthy: level(1 - s.from, 1 - s.to), strained: level(s.from, s.to) };
}

// Engine, wind, calm music and the combat score bases run for the whole session. Wind and music change gain;
// the engine sounds only while a turn plays.
export class SoundLoops {
  private engine: { healthy: LoopHandle; strained: LoopHandle } | null = null;
  private engineChassis: string | null = null;
  private player: SoundPlayer;
  private wind: LoopHandle;
  private calm: LoopHandle;
  // Each place's music loop, by the LoopLevels gain that drives it.
  private places: [LoopHandle, "townGain" | "outpostGain" | "abandonedGain"][];
  // Calm tracks play in a playlist shuffled once per session, so every track plays before any repeats.
  private playlist = shuffled(SOUNDS["music-calm"].files, Math.random);
  private track = 0;
  private last: LoopLevels | null = null;

  constructor(player: SoundPlayer, private score: Pick<CombatScore, "setCombat" | "setPaused" | "tick">) {
    this.player = player;
    const silent = { pan: 0, gain: 0 };
    this.wind = player.loop("wind", silent);
    this.calm = player.loop("music-calm", silent, this.playlist[0]);
    this.places = [
      [player.loop("music-town", silent), "townGain"],
      [player.loop("music-outpost", silent), "outpostGain"],
      [player.loop("music-abandoned", silent), "abandonedGain"],
    ];
  }

  // The healthy and strained engine loops start together and take the same rates each turn.
  drive(g: Glide, chassisId: string, strain: Strain): void {
    let engine = this.engine;
    if (this.engineChassis !== chassisId || !engine) {
      engine?.healthy.stop(0);
      engine?.strained.stop(0);
      const silent = { pan: 0, gain: 0 };
      engine = {
        healthy: this.player.loop("engine", silent, engineFileFor(chassisId)),
        strained: this.player.loop("engine-strain", silent, engineStrainFileFor(chassisId)),
      };
      this.engine = engine;
      this.engineChassis = chassisId;
    }
    const layers = strainGlides(g, strain);
    engine.healthy.glide(layers.healthy);
    engine.strained.glide(layers.strained);
  }

  // A throttle blip on the chassis's own engine note when overdrive comes on.
  rev(chassisId: string): void {
    this.player.loop("engine", { pan: 0, gain: 0 }, engineFileFor(chassisId)).once(MIX.rev);
  }

  // Sends only changed targets, so ramps are not restarted every frame.
  update(s: LoopState): void {
    const l = loopLevels(s, MIX);
    const was = this.last;
    this.last = l;
    if (was?.windGain !== l.windGain)
      this.wind.setGain(l.windGain, MIX.wind.fadeSeconds);
    this.updateMusic(l, was);
    this.score.tick();
  }

  // Calm music comes back after a fight or a place with its own music as the next playlist track.
  private updateMusic(l: LoopLevels, was: LoopLevels | null): void {
    this.updateCalm(l.calmGain, was);
    this.updatePlaces(l, was);
    if (was?.musicCutoffHz !== l.musicCutoffHz) this.player.setBusTone("music", l.musicCutoffHz, MIX.music.toneSeconds);
    this.score.setPaused(l.paused);
    if (was?.combatGain !== l.combatGain) this.score.setCombat(l.combatGain > 0, MIX.music.fadeSeconds);
  }

  private updateCalm(gain: number, was: LoopLevels | null): void {
    const fade = MIX.music.fadeSeconds;
    if (was?.calmGain === gain) return;
    if (was?.calmGain === 0) this.nextCalm(fade);
    this.calm.setGain(gain, fade);
}

  private updatePlaces(l: LoopLevels, was: LoopLevels | null): void {
    for (const [loop, key] of this.places) if (was?.[key] !== l[key]) loop.setGain(l[key], MIX.music.fadeSeconds);
  }

  // The radio's next button crossfades to another calm track at the current calm level.
  nextTrack(): void {
    const fade = MIX.music.fadeSeconds;
    this.nextCalm(fade);
    this.calm.setGain(this.last?.calmGain ?? 0, fade);
  }

  private nextCalm(fadeSeconds: number): void {
    this.calm.stop(fadeSeconds * 1000);
    this.track = (this.track + 1) % this.playlist.length;
    this.calm = this.player.loop("music-calm", { pan: 0, gain: 0 }, this.playlist[this.track]);
  }
}
