// Sound settings: mute, one volume knob per group and the next track key on the radio, kept in local storage apart from the game save.

import { MIX, type Bus } from "../data/sounds";
import type { Mixer } from "../audio/mixer";
import { bindAttr, setText } from "../text/language";
import { t, type Msg } from "../text/msg";
import { el } from "./dom";
import { createSwitch } from "./switch";

const KEY = "roam-sound";
const BUSES: Bus[] = ["music", "sfx", "ambient", "ui"];
const LABEL: Record<Bus, Msg> = { music: t("sound.music"), sfx: t("sound.sfx"), ambient: t("sound.ambient"), ui: t("sound.ui") };

type Settings = { muted: boolean; volume: Record<Bus, number> };

function defaults(): Settings {
  return { muted: false, volume: { ...MIX.busVolume } };
}

export function parseSettings(raw: string | null): Settings {
  if (raw === null) return defaults();
  const s = JSON.parse(raw);
  const ok = typeof s?.muted === "boolean" && BUSES.every((b) => typeof s.volume?.[b] === "number" && s.volume[b] >= 0 && s.volume[b] <= 1);
  if (!ok) throw new Error(`Stored sound settings are invalid: ${raw}`);
  return s;
}

const STEPS = 20;
const SWEEP = 135;
const DRAG_FULL_PX = 160;
const DRAG_DEAD_PX = 3;
const DRAG_STEPS = 100;

export function dragged(start: number, dx: number, dy: number): number {
  if (Math.abs(dx) + Math.abs(dy) < DRAG_DEAD_PX) return start;
  const value = Math.round((start + (dx - dy) / DRAG_FULL_PX) * DRAG_STEPS) / DRAG_STEPS;
  return Math.min(1, Math.max(0, value));
}

export function turned(value: number, steps: number): number {
  return Math.min(1, Math.max(0, Math.round(value * STEPS + steps) / STEPS));
}

export function knobAngle(value: number): number {
  return (value * 2 - 1) * SWEEP;
}

function nextButton(onclick: () => void): HTMLElement {
  const button = el("button", { class: "radio-next", title: t("sound.next"), "aria-label": t("sound.next"), onclick });
  button.innerHTML = `<svg viewBox="0 0 14 8" focusable="false"><path d="M0 0L5 4L0 8ZM5 0L10 4L5 8Z"/><rect x="10.5" width="1.6" height="8"/></svg>`;
  return button;
}

const KNOB_KEYS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

export class SoundSettings {
  private settings: Settings;
  private muteSwitch: HTMLElement;
  private knobs = new Map<Bus, HTMLElement>();
  private readouts = new Map<Bus, HTMLElement>();

  constructor(private mixer: Mixer, private storage: Storage, faceplate: HTMLElement, keys: HTMLElement, nextTrack: () => void) {
    this.settings = parseSettings(storage.getItem(KEY));
    this.muteSwitch = el("div", { class: "radio-mute" });
    faceplate.append(...BUSES.map((b) => this.knob(b)), this.muteSwitch);
    keys.append(nextButton(nextTrack));
    for (const b of BUSES) this.applyVolume(b);
    this.applyMute();
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.applyMute();
    this.save();
  }

  private knob(bus: Bus): HTMLElement {
    const dial = el("div", { class: "knob-dial" }, el("span", { class: "knob-notch" }));
    const knob = el("div", { class: "knob", role: "slider", tabindex: 0, "aria-label": t("sound.volume", { bus: LABEL[bus] }), "aria-valuemin": 0, "aria-valuemax": 100 }, dial);
    this.knobs.set(bus, knob);
    const readout = el("span", { class: "knob-readout" });
    this.readouts.set(bus, readout);
    const cell = el("div", { class: "knob-cell" }, knob, el("span", { class: "knob-labels" }, el("span", { class: "knob-label" }, LABEL[bus]), readout));
    this.bindDrag(cell, bus);
    this.bindWheel(cell, bus);
    this.bindKeys(knob, bus);
    return cell;
  }

  private bindDrag(cell: HTMLElement, bus: Bus): void {
    let drag: { pointerId: number; x: number; y: number; value: number } | null = null;
    cell.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      cell.setPointerCapture(e.pointerId);
      drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, value: this.settings.volume[bus] };
      cell.classList.add("turning");
    });
    cell.addEventListener("pointermove", (e) => {
      if (drag?.pointerId === e.pointerId) this.setVolume(bus, dragged(drag.value, e.clientX - drag.x, e.clientY - drag.y));
    });
    cell.addEventListener("lostpointercapture", (e) => {
      if (drag?.pointerId !== e.pointerId) return;
      drag = null;
      cell.classList.remove("turning");
    });
  }

  private bindWheel(cell: HTMLElement, bus: Bus): void {
    cell.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.setVolume(bus, turned(this.settings.volume[bus], -Math.sign(e.deltaY)));
    });
  }

  private bindKeys(knob: HTMLElement, bus: Bus): void {
    knob.addEventListener("keydown", (e) => {
      const steps = KNOB_KEYS[e.code];
      if (steps === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      this.setVolume(bus, turned(this.settings.volume[bus], steps));
    });
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
    const percent = Math.round(volume * 100);
    knob.setAttribute("aria-valuenow", String(percent));
    bindAttr(knob, "aria-valuetext", t("sound.percent", { n: percent }));
    setText(this.readouts.get(bus)!, t("sound.percent", { n: percent }));
    knob.style.setProperty("--knob-angle", `${knobAngle(volume)}deg`);
  }

  private applyMute(): void {
    this.mixer.setMuted(this.settings.muted);
    const muted = this.settings.muted;
    this.muteSwitch.replaceChildren(
      createSwitch({ on: t("sound.on"), off: t("sound.mute"), checked: !muted, key: "M", title: muted ? t("sound.unmuteTitle") : t("sound.muteTitle"), onclick: () => this.toggleMute() }),
    );
  }

  private save(): void {
    this.storage.setItem(KEY, JSON.stringify(this.settings));
  }
}
