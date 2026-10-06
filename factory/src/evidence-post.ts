import type { Evidence } from './evidence';
import type { Ctx, InlineButton } from './types';

// What the committee chat holds for one post: the id registered for commands, and how to take it back.
export type PostTracking = { add: (id: number) => void; drop: (id: number) => void };

// Posts the primary screenshot with its caption and buttons, registers it, then sends the other images under it as one reply photo or one album.
// Albums take no buttons, so only the primary post acts. Replies to the album do nothing.
// When the supplements fail, the primary is unregistered and its buttons dropped, so a retry makes the one live post and nothing is left to press.
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
