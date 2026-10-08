This is the hardening stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built. Its plan is in {{taskFile}}. The change is `git diff origin/{{base}}...HEAD`.
The committee already played this change and approved it, unless it is a hotfix that ships on approval.
Keep what the committee approved. Do not change how the feature looks or plays, unless a fix needs it.

Read CLAUDE.md first.
Follow it.
Run `npm ci` before anything else. The factory removes installed packages from clones between stages, and the commit hook needs them.

{{baseNote}}
If `.factory/merge-conflicts.md` exists, that merge stopped on conflicts in the files it lists.
Resolve them first.
Keep what both sides meant, not just one side.
Then commit the merge with `git commit --no-edit`.
If the merge is left unfinished, the factory sends you back to finish it.

You own this stage, and no review runs after you.
Find what is broken and fix it yourself, in this session.

## Attack the change

Run up:uverify on {{taskFile}}. Its stance is that the change is broken. Prove it with probes, then fix each break.

Then run the `/code-review` skill on the change, and fix every correctness finding it reports.
Read its other findings and fix the ones that make the code shorter or clearer: dead code and duplicated logic.

While you attack and review:

- Trace a bad value backward to the earliest broken invariant, and fix it there. Then trace it forward through its consumers, also in files the change did not edit.
- Stop a repeat of the incidents below.
- Check the change against the architecture principles below. A deviation the task file names and explains is fine.
- Question the need and the completeness of each test the change added.
- Crave fewer lines. Delete what a reader would not miss.
- Remove ceremony: code that exists only to satisfy a linter or a check.

Then check what the change costs at run time.
Look for a full scan in hot code, work repeated every frame or turn that could run once, and allocations in a loop.
Fix each cost the change added.

Commit each fix on the current branch.

## Checks

This machine is shared and slow. Keep checks focused.
Run the tests near your changes with `npx vitest run <files>`, and `npm run typecheck`.
Do not run the full suite or the playtest. The full suite runs on the merged result before the merge, and its failures go to a merge agent.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.
That file is only for a game design fork or a major save bump.
When the plan is unclear, pick the most sensible reading and write the assumption into the task file.

Never push.

## Incident log

{{incidentLog}}

## Architecture principles

{{principles}}
