// Dev sound board: every cue and variant through the game's mixer, each beside its bus anchor, for
// auditioning by ear. Opened with npm run sfx:board.

import { MIX, SOUNDS, type Bus, type Cue } from "../data/sounds";
import { devEl as el } from "../ui/dom";
import { loadBank, type Bank } from "./bank";
import { Mixer } from "./mixer";

const BUSES: Bus[] = ["ui", "sfx", "ambient", "music"];
const sounds: Record<string, Cue> = SOUNDS;
const anchors: Partial<Record<Bus, string>> = MIX.anchors;

const root = document.getElementById("board");
if (!root) throw new Error("#board element missing from sound.html");
const mixer = new Mixer(MIX);
mixer.unlockOn(window);
const bank = await loadBank(mixer.ctx, sounds);
let playing: AudioBufferSourceNode | null = null;
const rejected = new Set<string>();

function play(id: string, file: string): void {
  playing?.stop();
  const cue = sounds[id];
  const src = mixer.ctx.createBufferSource();
  src.buffer = bank.get(file)!;
  src.loop = cue.loop;
  const gain = mixer.ctx.createGain();
  gain.gain.value = cue.volume;
  src.connect(gain).connect(mixer.input(cue.bus));
  src.start();
  playing = src;
}

function stats(buf: AudioBuffer): string {
  const d = buf.getChannelData(0);
  let peak = 0;
  for (const x of d) peak = Math.max(peak, Math.abs(x));
  return `${buf.duration.toFixed(2)}s peak ${(20 * Math.log10(peak)).toFixed(1)} dB`;
}

function cueRow(id: string, anchor: string | undefined): HTMLElement {
  const cue = sounds[id];
  const variants = cue.files.map((f) =>
    el("div", { class: "row" }, el("button", { onclick: () => play(id, f) }, "play"), rejectButton(f), `${f}  ${stats(bank.get(f)!)}`),
  );
  const anchorButton = anchor && anchor !== id ? el("button", { onclick: () => play(anchor, sounds[anchor].files[0]) }, `anchor ${anchor}`) : null;
  return el(
    "div",
    { class: "cue" },
    el("div", { class: "row" }, el("b", {}, id), cue.loop ? "loop" : "one-shot", anchorButton),
    cue.prompts ? el("div", { class: "prompt" }, cue.prompts.join(" | ")) : null,
    ...(variants.length ? variants : [el("div", { class: "missing" }, "no files yet")]),
  );
}

function rejectButton(file: string): HTMLElement {
  const b = el("button", {}, "reject");
  b.addEventListener("click", () => {
    if (rejected.has(file)) rejected.delete(file);
    else rejected.add(file);
    b.classList.toggle("on", rejected.has(file));
    copyButton.textContent = `copy ${rejected.size} rejects`;
  });
  return b;
}

const copyButton = el("button", { onclick: () => void navigator.clipboard.writeText([...rejected].sort().join(" ")) }, "copy 0 rejects");
root.append(el("div", { class: "row" }, el("button", { onclick: () => playing?.stop() }, "stop"), copyButton));
for (const bus of BUSES) {
  const ids = Object.keys(sounds).filter((id) => sounds[id].bus === bus);
  root.append(el("h2", {}, `${bus}  bus volume ${MIX.busVolume[bus]}  target ${MIX.level[bus]} dB RMS`));
  for (const id of ids) root.append(cueRow(id, anchors[bus]));
}
