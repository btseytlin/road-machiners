This is the hardening round of the testing stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built. Its plan is in {{taskFile}}.
The committee already played this change and approved it. Now it gets the full verification before it merges.
Keep what the committee approved. Do not change how the feature looks or plays, unless a fix needs it.

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The factory removes installed packages from clones between stages, and the commit hook needs them.

The factory merged the current base branch into your branch before you started.
If `.factory/merge-conflicts.md` exists, that merge stopped on conflicts in the files it lists.
Resolve them first.
Keep what both sides meant, not just one side.
Then commit the merge with `git commit --no-edit`.
The factory fails the stage if the merge is left unfinished.

Run up:uverify on {{taskFile}}.
Fix what it finds.
Then run up:ureview on {{taskFile}}.
Fix what it finds, small findings included: naming, dead code, comments that no longer match, duplicated logic.
Then check what the change costs at run time.
Read `docs/architecture/principles.md`.
Look for a full scan in hot code, work repeated every frame or turn that could run once, and allocations in a loop.
Fix each cost the change added.
Commit the fixes on the current branch.

This machine is shared and slow. Keep checks focused.

No post follows this round, so do not write `.factory/approval.json`, `.factory/evidence.json` or screenshots.
The factory reviews the change after you. That review blocks the merge when it finds a break.

The factory checks your branch after you finish.
It runs `npm test`, `npm run typecheck` and `{{playtest}}` against the dev server.
Every test must pass, not only the tests for this issue.
Do not run the full suite or the playtest yourself.
Run the tests near your changes with `npx vitest run <files>`, and `npm run typecheck`.
If the factory's checks fail, you get one round to fix them, with the failure log in `.factory/check-failure.md`.

A failure blocks the task even when your change did not cause it.
Fix every failure you find, also ones already broken on `dev`.
Put each such fix in its own commit.
Name it in the task file under Conclusion.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.
Only a major save bump goes to the committee.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.

Never push.
