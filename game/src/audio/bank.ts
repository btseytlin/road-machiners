// Decodes every catalog file at boot. A missing or broken file stops the boot with its name.

import type { Cue } from "../data/sounds";

export type Bank = Map<string, AudioBuffer>;

export const SFX_DIR = `${import.meta.env.BASE_URL}sfx/`;

// progress gets (0, total) first, then (done, total) after each file is decoded.
export async function loadBank(
  ctx: BaseAudioContext,
  sounds: Record<string, Cue>,
  progress?: (done: number, total: number) => void,
): Promise<Bank> {
  const files = Object.values(sounds).flatMap((c) => c.files);
  let done = 0;
  progress?.(0, files.length);
  const buffers = await Promise.all(
    files.map(async (f) => {
      const buffer = await decodeFile(ctx, f);
      progress?.(++done, files.length);
      return buffer;
    }),
  );
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
