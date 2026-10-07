import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { appendLedger } from './ledger';
import { CAPTION_LIMIT } from './stages/checks';
import { readState, updateState } from './state';
import type { Ctx, ReleasePost } from './types';

// The draft post in the committee chat carries this button. Its issue is the release tracking issue.
export function publishButton(issue: number): { text: string; data: string } {
  return { text: 'Publish', data: `factory:publish:${issue}` };
}

export function releasePostDir(home: string, day: string): string {
  return join(home, 'release-posts', day);
}

function requireReleasePost(ctx: Ctx): ReleasePost {
  const post = readState(ctx.statePath).releasePost;
  if (post === null) throw new Error('No shipped release waits for its public post.');
  return post;
}

// Posts Hermes's draft to the committee chat with a Publish button. A new draft replaces the last one, whose button goes.
// The first draft also shows the screenshot that goes out with it.
export async function postDraft(ctx: Ctx, text: string): Promise<string> {
  const post = requireReleasePost(ctx);
  const draft = text.trim();
  if (!draft) throw new Error('The release post draft is empty.');
  const chat = ctx.cfg.committeeChat;
  if (post.postId === null) await ctx.telegram.sendPhoto(chat, post.screenshot, `Draft of the public post of release ${post.day}. The text below goes to the channel with this screenshot. Reply to the text to change it.`);
  const id = await ctx.telegram.sendButtons(chat, draft, [[publishButton(post.issue)]]);
  await retireDraft(ctx, post);
  recordDraft(ctx, post, id, draft);
  return `Draft of the release ${post.day} post is in the committee chat.`;
}

// Drops the buttons of the draft a new one replaced. The old draft cannot publish anyway, since only the current post id publishes.
async function retireDraft(ctx: Ctx, post: ReleasePost): Promise<void> {
  if (post.postId === null || post.draft === null) return;
  try {
    await ctx.telegram.editText(ctx.cfg.committeeChat, post.postId, `${post.draft}\n\nReplaced by a newer draft.`);
  } catch (error) {
    ctx.log('tick', post.issue, `could not mark the old release post draft: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// The draft's caption is recorded like an approval post's, so Publish can add its status line.
function recordDraft(ctx: Ctx, post: ReleasePost, id: number, draft: string): void {
  const old = post.postId === null ? null : String(post.postId);
  updateState(ctx.statePath, (state) => {
    const postCaptions = Object.fromEntries(Object.entries(state.postCaptions).filter(([key]) => key !== old));
    return {
      ...state,
      releasePost: state.releasePost && { ...state.releasePost, postId: id, draft },
      postCaptions: { ...postCaptions, [String(id)]: draft },
      textPosts: [...state.textPosts.filter((key) => key !== old), String(id)],
    };
  });
}

// Posts the current draft to the public channel as it is. A press on an older draft publishes nothing.
export async function publishPost(ctx: Ctx, postId: number): Promise<string> {
  const post = requireReleasePost(ctx);
  if (post.postId !== postId || post.draft === null) throw new Error('This release post draft is out of date.');
  const channel = ctx.cfg.publicChannel;
  const draft = post.draft;
  // A caption holds at most CAPTION_LIMIT characters, so a longer post goes as the screenshot and a text under it.
  const id = draft.length <= CAPTION_LIMIT
    ? await ctx.telegram.sendPhoto(channel, post.screenshot, draft)
    : (await ctx.telegram.sendPhoto(channel, post.screenshot, ''), await ctx.telegram.sendMessage(channel, draft));
  appendLedger(ctx.cfg.home, { kind: 'post', id, channel, text: draft, at: ctx.now().toISOString() });
  updateState(ctx.statePath, (state) => ({ ...state, releasePost: null }));
  rmSync(releasePostDir(ctx.cfg.home, post.day), { recursive: true, force: true });
  return `The release ${post.day} post is on the public channel.`;
}
