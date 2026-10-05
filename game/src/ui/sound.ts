// Sound settings: mute and one volume knob per group on the radio, kept in local storage apart from the game save.

import { MIX, type Bus } from "../data/sounds";
import type { Mixer } from "../audio/mixer";
import { el } from "./dom";
import { createSwitch } from "./switch";

const KEY = "roam-sound";
const BUSES: Bus[] = ["music", "sfx", "ambient", "ui"];
const LABEL: Record<Bus, string> = { music: "Music", sfx: "Effects", ambient: "Wind", ui: "Interface" };

type Settings = { muted: boolean; volume: Record<Bus, number> };

function defaults(): Settings {
  return { muted: false, volume: { ...MIX.busVolume } };
}

// Invalid stored settings stop the boot, like an invalid save.
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return defaults();
  const s = JSON.parse(raw);
  const ok = typeof s?.muted === "boolean" && BUSES.every((b) => typeof s.volume?.[b] === "number" && s.volume[b] >= 0 && s.volume[b] <= 1);
  if (!ok) throw new Error(`Stored sound settings are invalid: ${raw}`);
  return s;
}

// Knob steps from silent to full volume.
const STEPS = 20;
// A knob's pointer swings this many degrees each side of straight up.
const SWEEP = 135;
// Pixels of vertical drag for one step.
const DRAG_PX = 6;

// A volume turned some steps, clamped to the knob's range and snapped to whole steps.
export function turned(value: number, steps: number): number {
  return Math.min(1, Math.max(0, Math.round(value * STEPS + steps) / STEPS));
}

// The pointer angle of a knob at a volume, from -SWEEP at 0 to +SWEEP at full.
export function knobAngle(value: number): number {
  return (value * 2 - 1) * SWEEP;
}

const KNOB_KEYS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

export class SoundSettings {
  private settings: Settings;
  private muteSwitch: HTMLElement;
  private knobs = new Map<Bus, HTMLElement>();

  // The controls live on the radio's faceplate.
  constructor(private mixer: Mixer, private storage: Storage, faceplate: HTMLElement) {
    this.settings = parseSettings(storage.getItem(KEY));
    this.muteSwitch = el("div", { class: "radio-mute" });
    faceplate.append(...BUSES.map((b) => this.knob(b)), this.muteSwitch);
    for (const b of BUSES) this.applyVolume(b);
    this.applyMute();
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.applyMute();
    this.save();
  }

  // Turns by vertical drag, the wheel or the arrow keys while focused. Handled keys stay off the game.
  private knob(bus: Bus): HTMLElement {
    const dial = el("div", { class: "knob-dial" }, el("span", { class: "knob-notch" }));
    const knob = el("div", { class: "knob", role: "slider", tabindex: 0, "aria-label": `${LABEL[bus]} volume`, "aria-valuemin": 0, "aria-valuemax": 100 }, dial);
    this.knobs.set(bus, knob);
    let drag: { y: number; value: number } | null = null;
    knob.addEventListener("pointerdown", (e) => {
      knob.setPointerCapture(e.pointerId);
      knob.focus();
      drag = { y: e.clientY, value: this.settings.volume[bus] };
    });
    knob.addEventListener("pointermove", (e) => {
      if (drag) this.setVolume(bus, turned(drag.value, Math.round((drag.y - e.clientY) / DRAG_PX)));
    });
    knob.addEventListener("pointerup", () => (drag = null));
    knob.addEventListener("pointercancel", () => (drag = null));
    knob.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.setVolume(bus, turned(this.settings.volume[bus], -Math.sign(e.deltaY)));
    });
    knob.addEventListener("keydown", (e) => {
      const steps = KNOB_KEYS[e.code];
      if (steps === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      this.setVolume(bus, turned(this.settings.volume[bus], steps));
    });
    return el("div", { class: "knob-cell" }, knob, el("span", { class: "knob-label" }, LABEL[bus]));
  }

  private setVolume(bus: Bus, value: number): void {
    if (value === this.settings.volume[bus]) return;
    this.settings.volume[bus] = value;
    this.applyVolume(bus);
    this.save();
  }

  private applyVolume(bus: Bus): void {
    const volume = this.settings.volume[bus];
    this.mixer.setBusVolume(bus, volume);
    const knob = this.knobs.get(bus)!;
    knob.setAttribute("aria-valuenow", String(Math.round(volume * 100)));
    knob.style.setProperty("--knob-angle", `${knobAngle(volume)}deg`);
  }

  // The switch is rebuilt only when the mute flips, not on a knob turn.
  private applyMute(): void {
    this.mixer.setMuted(this.settings.muted);
    const muted = this.settings.muted;
    this.muteSwitch.replaceChildren(
      createSwitch({ on: "Mute", off: "Sound", checked: muted, key: "M", title: muted ? "Unmute [M]" : "Mute [M]", onclick: () => this.toggleMute() }),
    );
  }

  // Only the player's own changes are stored, so untouched groups follow new mix defaults.
  private save(): void {
    this.storage.setItem(KEY, JSON.stringify(this.settings));
  }
}
