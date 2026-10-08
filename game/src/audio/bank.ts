// Decodes every catalog file at boot. A missing or broken file stops the boot with its name.

import type { Cue } from "../data/sounds";

export type Bank = Map<string, AudioBuffer>;

export const SFX_DIR = `${import.meta.env.BASE_URL}sfx/`;

export async function loadBank(ctx: BaseAudioContext, sounds: Record<string, Cue>): Promise<Bank> {
  const files = Object.values(sounds).flatMap((c) => c.files);
  const buffers = await Promise.all(files.map((f) => decodeFile(ctx, f)));
  return new Map(files.map((f, i) => [f, buffers[i]]));
}

async function decodeFile(ctx: BaseAudioContext, file: string): Promise<AudioBuffer> {
  const res = await fetch(SFX_DIR + file);
  if (!res.ok) throw new Error(`Sound ${file} failed to load: HTTP ${res.status}`);
  try {
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    throw new Error(`Sound ${file} failed to decode: ${e}`);
  }
}
