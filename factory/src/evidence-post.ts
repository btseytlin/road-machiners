import type { Evidence } from './evidence';
import type { Ctx, InlineButton, Stage } from './types';

export type PostTracking = { add: (id: number) => void };

export async function postWithEvidence(ctx: Ctx, evidence: Evidence, caption: string, buttons: InlineButton[][], track: PostTracking, where: { stage: Stage; issue: number }): Promise<number> {
  const [primary, ...supplements] = evidence.images;
  const id = await ctx.telegram.sendPhoto(ctx.cfg.committeeChat, primary!.path, caption, buttons);
  track.add(id);
  if (supplements.length === 0) return id;
  const total = evidence.images.length;
  const photos = supplements.map((image, i) => ({ path: image.path, caption: `${i + 2}/${total} ${image.description}` }));
  try {
    await ctx.telegram.sendPhotos(ctx.cfg.committeeChat, photos, id);
  } catch (error) {
    ctx.log(where.stage, where.issue, `the extra images of post ${id} did not upload, and the post stays without them: ${error instanceof Error ? error.message : String(error)}`);
  }
  return id;
}
