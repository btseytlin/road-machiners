// Pure choices behind each play: which variant, where it sits in the stereo field, and whether a voice is free.

// Variant index for a roll in [0, 1). Never repeats the last variant when there is a choice.
export function pickVariant(n: number, last: number | null, roll: number): number {
  if (n < 1) throw new Error(`Cue has no variants`);
  if (n === 1) return 0;
  if (last === null) return Math.floor(roll * n);
  const i = Math.floor(roll * (n - 1));
  return i >= last ? i + 1 : i;
}

export function spatial(screenX: number, width: number, distance: number, halfGainMeters: number, panWidth: number): { pan: number; gain: number } {
  const side = Math.min(1, Math.max(-1, (screenX / width) * 2 - 1));
  return { pan: side * panWidth, gain: 1 / (1 + distance / halfGainMeters) };
}

export class VoiceLimiter {
  private ends = new Map<string, number[]>();

  admit(cue: string, maxVoices: number, now: number, endsAt: number): boolean {
    const live = (this.ends.get(cue) ?? []).filter((t) => t > now);
    const free = live.length < maxVoices;
    if (free) live.push(endsAt);
    this.ends.set(cue, live);
    return free;
  }
}

export function loudestAt(samples: Float32Array, sampleRate: number, windowSeconds: number): number {
  const n = Math.max(1, Math.round(windowSeconds * sampleRate));
  let best = 0;
  let bestAt = 0;
  for (let start = 0; start < samples.length; start += n) {
    let sum = 0;
    const end = Math.min(samples.length, start + n);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    if (sum > best) [best, bestAt] = [sum, start + (end - start) / 2];
  }
  return bestAt / sampleRate;
}
