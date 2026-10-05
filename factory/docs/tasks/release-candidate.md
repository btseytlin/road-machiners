# Release candidate

**Status:** executing
**Branch:** game-factory
**Worktree:** .worktrees/game-factory
**Goal:** A release waits for the committee. The factory cuts a release branch, runs cleanup tasks on it, posts a playable candidate with a changelog, lets the committee remove features or add release tasks, and ships only on Ship with no open release task.
**Mode:** hands-off

## Context

- Today `release` merges all of `dev` into `main` every `FACTORY_RELEASE_DAYS` and ships it. Nobody approves the whole, and a bad feature cannot be left out.
- Daily `maintenance` plans one small fix on `dev`.
- Every approved feature is one `--no-ff` merge commit on `dev` with the subject `Merge issue #N: <title>` (`src/stages/approval.ts`).

## Design

Flow:

1. Cut. When a release is due and no release is open, the `release` job syncs and reads the feature merges on `dev` missing from `main`. None means it records `lastRelease` and stops, as today. Otherwise it creates branch `release/<day>` from `dev` and pushes it. It opens a tracking issue `Release <day>` with label `release` and adds its card to Approval. It opens two cleanup issues with labels `release-task` and `maintenance`, one for optimization and one for code janitor work, with bodies from `prompts/release-optimize.md` and `prompts/release-janitor.md`, and adds their cards to Design. It sets `state.release`.
2. Release tasks. An issue with label `release-task` runs the normal stages with base branch `state.release.branch` instead of `dev`. Cleanup tasks (also labeled `maintenance`) skip the committee: after the host checks pass, testing merges them into the release branch itself. Other release tasks post for approval as usual, and approve merges them into the release branch. Release task cards go before other cards in the tick.
3. Candidate. When `state.release` is set, `postId` is null, the tracking issue is not stuck and no `release-task` card is outside Done, the tick starts job `candidate` for the tracking issue. It clones the release branch fresh, runs the CPU playtest for a screenshot, lets the release agent write the notes, builds and deploys scope `rc`, records the build under the tracking issue, opens or reuses the pull request from the release branch to `main`, comments the notes and full feature list on the tracking issue, and posts one photo to the committee chat with a Ship button. The caption holds the play link, the pull request, the notes, one line per feature `#N title`, and how to act. It stores the photo id in `state.release.postId`.
4. Committee replies to the candidate post, routed by the Hermes plugin:
   - `ship` or the Ship button queues `ship`.
   - `remove #N` or `remove N` queues a removal of feature N with the text.
   - Any other reply opens a release task: a new issue labeled `release-task` with the reply as body, card in Design. It sets `postId` to null.
5. Remove job. It reverts the merge of issue N with `git revert -m 1` on the release branch, and on `dev` when `dev` has that merge. It throws when neither has it or a revert conflicts. It pushes both, deploys `/dev`, deletes branch `factory/issue-N` locally and on GitHub and the issue work clone, so a redo starts fresh from `dev`. It reopens issue N, comments who removed it and the text under the feedback heading, and moves its card to Design. It adds N to `state.release.removed` and sets `postId` to null.
6. Ship job. It checks the itch keys first, then that a release is open with a post and no open release task. It merges the release branch into `main` (subject `Release <day>`), pushes, builds `main` in a fresh clone with an empty save scope, runs `butler push`, posts the candidate screenshot and notes with the changelog to the public channel, merges `main` into `dev`, pushes, deploys `/dev`, closes the tracking issue, moves its card to Done, clears `state.release`, sets `lastRelease` and tells the committee.
7. Daily maintenance goes away: the stage, its prompt, `lastMaintenance` and `FACTORY_MAINTENANCE_HOURS`.

Changelog: first-parent merges `main..<release branch>` with subject `Merge issue #N: <title>`, minus `state.release.removed`.

### Invariants

- IV1: Nothing reaches `main` without a Ship from a committee member on the current candidate post.
- IV2: No step retries on its own. A failed cut, candidate or ship labels the tracking issue `factory-stuck` through the normal failure path. A failed removal labels issue N. The tick skips a stuck tracking issue.
- IV3: Ship refuses while any `release-task` card is outside Done or `postId` is null.
- IV4: A removed feature leaves both the release branch and `dev`, and its old branch is gone.
- IV5: The ship button and replies act only on the current candidate post. The plugin answers a press on an old post with a toast and queues nothing.
- IV6: A release task never merges into `dev` directly. `dev` gets release work from the `main` merge at ship.

### Contract between host and plugin

- `state.json` gets `release: { issue: number; branch: string; day: string; postId: number | null; removed: number[] } | null` and `pendingShip: string | null` (Telegram user who shipped) and `pendingRemovals: { issue: number; by: string; text: string }[]`.
- Inbox kinds grow by `ship` (issue = tracking issue, text null), `remove` (issue = N, text = the whole reply) and `release-task` (issue null, text = the reply).
- Button data `factory:ship:<tracking issue>`. Pattern `^factory:(approve|deny|ship):\d+$`.

## Plan

- [ ] PH1 Host (TypeScript, `factory/src`, `factory/prompts`). Types, state, config without maintenance hours, GitHub `reopen`, HostRepo `sync(...extra)` fast-forwarding extra branches, `createBranch`, `revertIssueMerge`, `deleteBranch`, base branch per issue in design, implement, testing and approval, cleanup auto-merge in testing, stages cut, candidate, remove and ship replacing release and maintenance, tick picks, job dispatch and clearing, inbox kinds, cleanup prompts, tests for each.
- [ ] PH2 Plugin and docs (`factory/hermes`, `factory/README.md`). Plugin routes replies to `state.release.postId`, the Ship button with the stale-post toast, tests. SOUL.md and README describe the new release flow and drop daily maintenance. `.env.example` drops `FACTORY_MAINTENANCE_HOURS`.

## Conclusion

### Hands-off decisions

- Cleanup tasks merge without a committee post. The committee plays them as part of the candidate.
- Removal deletes the feature branch, since git would skip reverted commits on a second merge.
- The release is a tracking issue, so stuck handling and the board work as for cards.
