// Web Audio graph: one bus per sound group, each through a low-pass tone filter, into a master gain. The effects bus runs through a compressor
// and a short reverb, so sounds from different sources sit in one space.

import { MIX, type Bus } from "../data/sounds";

type Mix = typeof MIX;

export class Mixer {
  readonly ctx = new AudioContext();
  private master = this.ctx.createGain();
  private buses: Record<Bus, GainNode>;
  private tones = new Map<Bus, BiquadFilterNode>();

  constructor(mix: Mix) {
    this.master.connect(this.ctx.destination);
    this.buses = {
      ui: this.bus("ui", mix.busVolume.ui, this.master),
      sfx: this.bus("sfx", mix.busVolume.sfx, this.effectsChain(mix)),
      ambient: this.bus("ambient", mix.busVolume.ambient, this.master),
      music: this.bus("music", mix.busVolume.music, this.master),
    };
  }

  input(bus: Bus): AudioNode {
    return this.buses[bus];
  }

  setBusVolume(bus: Bus, volume: number): void {
    this.buses[bus].gain.value = volume;
  }

  setBusTone(bus: Bus, cutoffHz: number, rampSeconds: number): void {
    const tone = this.tones.get(bus);
    if (!tone) throw new Error(`Bus ${bus} has no tone filter`);
    tone.frequency.setTargetAtTime(cutoffHz, this.ctx.currentTime, rampSeconds / 3);
  }

  setMuted(muted: boolean): void {
    this.master.gain.value = muted ? 0 : 1;
  }

  unlockOn(target: EventTarget): void {
    const resume = () => void this.ctx.resume();
    target.addEventListener("pointerdown", resume, { once: true });
    target.addEventListener("keydown", resume, { once: true });
  }

  private bus(bus: Bus, volume: number, out: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = volume;
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = this.ctx.sampleRate / 2;
    g.connect(tone).connect(out);
    this.tones.set(bus, tone);
    return g;
  }

  private effectsChain(mix: Mix): AudioNode {
    const c = mix.compressor;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = c.threshold;
    comp.knee.value = c.knee;
    comp.ratio.value = c.ratio;
    comp.attack.value = c.attack;
    comp.release.value = c.release;
    comp.connect(this.master);
    const verb = this.ctx.createConvolver();
    verb.buffer = this.impulse(mix.reverb.seconds, mix.reverb.decay);
    const wet = this.ctx.createGain();
    wet.gain.value = mix.reverb.wet;
    comp.connect(verb).connect(wet).connect(this.master);
    return comp;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const n = Math.round(seconds * this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }
}
