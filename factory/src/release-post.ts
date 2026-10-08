import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { appendLedger } from './ledger';
import { readPhoto } from './photo-file';
import { CAPTION_LIMIT } from './stages/checks';
import { readState, updateState } from './state';
import type { Ctx, ReleasePost } from './types';

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

export async function postDraft(ctx: Ctx, text: string, image: string | null | undefined): Promise<string> {
  const post = requireReleasePost(ctx);
  const draft = text.trim();
  if (!draft) throw new Error('The release post draft is empty.');
  const screenshot = image == null ? post.screenshot : takeImage(ctx.cfg.home, post.day, image);
  const chat = ctx.cfg.committeeChat;
  if (post.postId === null || screenshot !== post.screenshot) await ctx.telegram.sendPhoto(chat, screenshot, `Picture of the public post of release ${post.day}. The text below goes to the channel with it. Reply to the text to change it.`);
  const id = await ctx.telegram.sendButtons(chat, draft, [[publishButton(post.issue)]]);
  await retireDraft(ctx, post);
  recordDraft(ctx, post, id, draft, screenshot);
  return `Draft of the release ${post.day} post is in the committee chat.`;
}

function takeImage(home: string, day: string, image: string): string {
  const media = join(home, 'inbox', 'media');
  const source = resolve(media, image);
  if (!source.startsWith(`${media}/`)) throw new Error(`Release post image ${image} is outside the inbox media folder.`);
  readPhoto(source);
  const target = join(releasePostDir(home, day), basename(source));
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  return target;
}

async function retireDraft(ctx: Ctx, post: ReleasePost): Promise<void> {
  if (post.postId === null || post.draft === null) return;
  try {
    await ctx.telegram.editText(ctx.cfg.committeeChat, post.postId, `${post.draft}\n\nReplaced by a newer draft.`);
  } catch (error) {
    ctx.log('tick', post.issue, `could not mark the old release post draft: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function recordDraft(ctx: Ctx, post: ReleasePost, id: number, draft: string, screenshot: string): void {
  const old = post.postId === null ? null : String(post.postId);
  updateState(ctx.statePath, (state) => {
    const postCaptions = Object.fromEntries(Object.entries(state.postCaptions).filter(([key]) => key !== old));
    return {
      ...state,
      releasePost: state.releasePost && { ...state.releasePost, postId: id, draft, screenshot },
      postCaptions: { ...postCaptions, [String(id)]: draft },
      textPosts: [...state.textPosts.filter((key) => key !== old), String(id)],
    };
  });
}

export async function publishPost(ctx: Ctx, postId: number): Promise<string> {
  const post = requireReleasePost(ctx);
  if (post.postId !== postId || post.draft === null) throw new Error('This release post draft is out of date.');
  const channel = ctx.cfg.publicChannel;
  const draft = post.draft;
  const id = draft.length <= CAPTION_LIMIT
    ? await ctx.telegram.sendPhoto(channel, post.screenshot, draft)
    : (await ctx.telegram.sendPhoto(channel, post.screenshot, ''), await ctx.telegram.sendMessage(channel, draft));
  appendLedger(ctx.cfg.home, { kind: 'post', id, channel, text: draft, at: ctx.now().toISOString() });
  updateState(ctx.statePath, (state) => ({ ...state, releasePost: null }));
  rmSync(releasePostDir(ctx.cfg.home, post.day), { recursive: true, force: true });
  return `The release ${post.day} post is on the public channel.`;
}
