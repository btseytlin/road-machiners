// Sound settings: mute and one volume slider per group, kept in local storage apart from the game save.

import { MIX, type Bus } from "../data/sounds";
import type { Mixer } from "../audio/mixer";
import { el, panel, topRight } from "./dom";

const KEY = "roam-sound";
const BUSES: Bus[] = ["music", "sfx", "ambient", "ui"];
const LABEL: Record<Bus, string> = { music: "Music", sfx: "Effects", ambient: "Wind", ui: "Interface" };

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

export class SoundSettings {
  private settings: Settings;
  private root = panel("sound", topRight());
  private body: HTMLElement;
  private muteButton: HTMLElement;

  constructor(private mixer: Mixer, private storage: Storage) {
    this.settings = parseSettings(storage.getItem(KEY));
    this.muteButton = el("button", { onclick: () => this.toggleMute() });
    this.body = el("div", { class: "sound-sliders" }, ...BUSES.map((b) => this.slider(b)));
    this.body.hidden = true;
    this.root.append(
      el("div", { class: "row" }, el("button", { onclick: () => (this.body.hidden = !this.body.hidden) }, "Sound"), this.muteButton),
      this.body,
    );
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape") this.body.hidden = true;
    });
    this.apply();
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.apply();
    this.save();
  }

  private slider(bus: Bus): HTMLElement {
    const input = el("input", { type: "range", min: 0, max: 1, step: 0.05, value: this.settings.volume[bus] }) as HTMLInputElement;
    input.addEventListener("input", () => {
      this.settings.volume[bus] = Number(input.value);
      this.apply();
      this.save();
    });
    return el("label", {}, LABEL[bus], input);
  }

  private apply(): void {
    for (const b of BUSES) this.mixer.setBusVolume(b, this.settings.volume[b]);
    this.mixer.setMuted(this.settings.muted);
    this.muteButton.textContent = this.settings.muted ? "Unmute [M]" : "Mute [M]";
  }

  private save(): void {
    this.storage.setItem(KEY, JSON.stringify(this.settings));
  }
}
