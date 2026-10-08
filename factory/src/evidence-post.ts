import type { Evidence } from './evidence';
import type { Ctx, InlineButton } from './types';

export type PostTracking = { add: (id: number) => void; drop: (id: number) => void };

export async function postWithEvidence(ctx: Ctx, evidence: Evidence, caption: string, buttons: InlineButton[][], track: PostTracking): Promise<number> {
  const [primary, ...supplements] = evidence.images;
  const id = await ctx.telegram.sendPhoto(ctx.cfg.committeeChat, primary!.path, caption, buttons);
  track.add(id);
  if (supplements.length === 0) return id;
  const total = evidence.images.length;
  const photos = supplements.map((image, i) => ({ path: image.path, caption: `${i + 2}/${total} ${image.description}` }));
  try {
    await ctx.telegram.sendPhotos(ctx.cfg.committeeChat, photos, id);
  } catch (error) {
    track.drop(id);
    await ctx.telegram.editCaption(ctx.cfg.committeeChat, id, 'Superseded. Its extra images did not upload, so the factory posts this again.').catch(() => undefined);
    throw error;
  }
  return id;
}
