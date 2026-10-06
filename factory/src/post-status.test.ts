import { describe, expect, it } from 'vitest';
import { pruneCaptions, withStatus } from './post-status';
import { EMPTY_STATE } from './state';
import { CAPTION_LIMIT } from './stages/checks';

describe('withStatus', () => {
  it('adds the status on its own line under the caption', () => {
    expect(withStatus('Post', '✅ Approved by Ann')).toBe('Post\n\n✅ Approved by Ann');
  });

  it('cuts the caption body, never the status, to stay inside the caption limit', () => {
    const caption = withStatus('x'.repeat(CAPTION_LIMIT), '✅ Approved by Ann');
    expect(caption.length).toBe(CAPTION_LIMIT);
    expect(caption.endsWith('…\n\n✅ Approved by Ann')).toBe(true);
  });
});

describe('pruneCaptions', () => {
  it('keeps the captions of open approval posts and the current candidate only', () => {
    const release = { issue: 3, branch: 'release/x', day: 'x', postId: 30, removed: [] };
    const state = { ...structuredClone(EMPTY_STATE), approvalPosts: { 10: 1 }, release, postCaptions: { 10: 'a', 20: 'gone', 30: 'rc' } };
    expect(pruneCaptions(state).postCaptions).toEqual({ 10: 'a', 30: 'rc' });
  });
});
