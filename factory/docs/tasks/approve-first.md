# Approve before the heavy testing

## Context
- Today a card goes Implementation, then the full Testing stage, then the committee post. Testing is the verify agent with up:uverify and up:ureview, then the blocking /code-review gate, then the factory checks. The verify agent and the review take hours.
- Feedback often sends a card back to Design, like #81. Then all that testing was wasted on a version the committee did not want.
- Goal: the committee sees a feature that is tested enough to play, sooner. Review, nitpicks, optimization and heavy testing run only after Approve.
- Balance: the committee never gets a build that fails the tests, crashes on boot or does not build. The factory checks still gate every post.

## Desired design
New order for a normal card:
1. Implementation, as today.
2. Preview round in Testing. The verify agent merges the base, plays the feature end to end, fixes what blocks it, does the visual comparison and captures the evidence and `approval.json`. No up:uverify, no up:ureview, no /code-review.
3. Factory checks, as today: full tests, typecheck, CPU playtest, build. A failure gets the existing one fix round.
4. Approval post, as today.
5. Approve no longer merges a previewed card. It records the approver in `approvedResolving`, drops the post, moves the card back to Testing and comments on the issue.
6. Hardening round in Testing. The verify agent runs up:uverify, up:ureview, fixes nitpicks and checks the change for performance cost. Then the /code-review gate runs, as today.
7. Factory checks again. With an approver recorded, checks already skip the post and queue the merge. This is the existing path for an approved card that hit a merge conflict.
8. Approve merges into the base and the chat gets the usual "merged into dev" message.

Mode rules, decided by state and labels:
- Hotfix: the full round before the post, as the user chose. Hardening first, then the review gate, then the preview round, so the evidence comes from the final code. Approve ships at once, as today.
- Maintenance release task: hardening only, no post. It already has the approver "the factory".
- A card with an approver in `approvedResolving`: hardening only.
- Every other card: preview only.

After approval, a second /code-review FAIL sends the card back to Design and drops the approval, as the user chose. The redesigned card gets a new preview and a new post.

Out of scope: release candidates, ship, patches. A patch already goes to checks and then a post, and that stays.

## Invariants and principles
- Every committee post comes after passing factory checks on the posted commit. Check: `post()` is only reached after `checkPatiently()` returns null.
- A merge into the base only happens after the hardening round and passing checks, except hotfixes, which harden before their post. Check: `approve()` merges only when the issue has an approver recorded or is a hotfix.
- The approver survives a merge conflict. The existing conflict path in `mergeOrResolve()` keeps working.
- A hardening round never needs evidence or `approval.json`, since no post follows. A preview round always needs both.
- One owner for the mode: one function in `stages/verify.ts` decides preview, harden or full.

## Implementation plan
### Phase 1: modes in verify
- `src/stages/verify.ts`: add `testMode(ctx, issue, labels)` returning `'preview' | 'harden' | 'full'` from the hotfix base, the maintenance labels and `approvedResolving`.
- `runStage()`: preview runs the `test` round. Harden runs the `harden` round, then `reviewGate()`. Full runs harden, the review gate, then the `test` round. Each ends in `setPhase(ctx, issue, 'checks')`.
- `agentRound()`: read `approval.json` and the evidence only in preview and full rounds.
- `fixRound()`: pass the mode to the `test-fix` prompt, so a hardening fix is not asked for evidence.
- `src/stages/review.ts` `reviewGate()`: when it sends the card to Design, drop the issue from `approvedResolving`.

### Phase 2: approve records, checks merge
- `src/stages/approval.ts` `approve()`: for a non-hotfix card with no approver recorded, call `forgetPosts()`, set `approvedResolving[issue] = by`, comment that review and heavy testing run now and it merges by itself after, and move the card to Testing. Otherwise merge as today.
- `src/stages/checks.ts` `runStage()`: compute the approver first. Read the approval and evidence only when a post follows, before the checks run, so a bad manifest still fails fast.

### Phase 3: prompts and docs
- `prompts/test.md` becomes the preview prompt. It keeps the merge conflicts, the visual comparison, the evidence, `approval.json`, the factory checks note, save migrations and the committee stop. It drops up:uverify and says review and polish come after approval.
- New `prompts/harden.md`: merge conflicts, then up:uverify and up:ureview on the task file, fix nitpicks, then check the change against "no hot full scans" and the other rules in `docs/architecture/principles.md`, with the factory checks note, save migrations and the committee stop. No evidence.
- `prompts/test-fix.md`: its evidence block becomes a `{{evidenceRules}}` var, empty for a hardening fix.
- `README.md` steps 5 and 6 and `hermes/SOUL.md` step 7 describe the new order.

## Verification
- Focused tests in `factory/`: `npx vitest run src/stages/verify.test.ts src/stages/checks.test.ts src/stages/approval.test.ts src/stages/testing-flow.test.ts src/stages/review.test.ts` if they exist, plus new cases:
  - a preview round runs only the `test` prompt and sets phase checks;
  - a card with an approver runs `harden` and the review gate, with no evidence read;
  - a hotfix runs harden, review, then test;
  - `approve()` on a previewed card records the approver and moves it to Testing, with no merge;
  - `approve()` on a card with an approver merges;
  - a second review FAIL after approval drops the approver.
- `npm run typecheck` in `factory/`.
- Manual try, positive: in `testing-flow.test.ts` style, walk one card from Implementation through preview, checks, post, approve, hardening, checks and merge, and see exactly one post and one merge.
- Manual try, negative: a card whose hardening review fails twice lands in Design with no approver, and its next preview gets a new post.

## Result
- Done. A new card previews, passes the factory checks and is posted. Approve records the approver and sends the card back to Testing to harden. Hardening, the review and the checks then queue the merge with no new post. Hotfixes harden before their post and merge on Approve.
- Checks: the focused factory tests in `src/stages`, `src/sessions.test.ts`, `src/tick.test.ts` and `src/inbox.test.ts` pass, 354 of 354. `npm run typecheck` passes. The Hermes plugin tests pass, 121 of 121.
- Manual try, positive: one card walked preview, checks, post, approve, hardening, review, checks and merge. It got one post, one merge into dev, and the card ended in Done.
- Manual try, negative: a hardening review that failed twice sent the card to Design, dropped the approval and merged nothing.
