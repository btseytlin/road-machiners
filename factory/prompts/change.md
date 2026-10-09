A committee member asked to change how the ROAM factory works. Read the request in .factory/request.md.
You work alone in a clone of the repo on its own branch. The clone is your isolated checkout, so make no worktree and switch no branch.

Read ../CLAUDE.md and CLAUDE.md first.
Follow them.
Read docs/process.md and the `.dot` diagrams in docs/diagrams/ before you design. They are the spec of how the factory works. A change to the process updates its diagram and doc in the same commit. Run `npm run diagrams` after you edit a `.dot` file.
Run `npm ci` here, then `cd .. && npm ci && npm run hooks:install`.
The quality hook checks every commit.
Do not bypass it.
Do not add suppressions.
Do not raise its limits.

Run up:make in hands-off mode on the task file {{taskFile}}, not on a file under docs/tasks/.
Create it with `Mode: hands-off`.
Run every stage: design, plan, execute, verify and review.
Record every automatic decision in its Hands-off decisions section.
Git ignores the task file. Never commit it and never force-add it.

Your cwd is factory/, but you may edit any file in the repo when the request needs it, like the quality gate at the root or the game.
A game edit follows ../game/CLAUDE.md and ../game/docs/DESIGN.md. A UI or overlay edit also follows ../game/docs/ui.md. Run the game's tests near your change too.
While you work, run only the tests near your change with `npx vitest run <files>`.
Before you finish, run `npm test` and `npm run typecheck` once. Every test must pass.
Commit in phases on the current branch.
Never push and never merge. The factory opens the pull request, and a member merges it.
Skip up:make's last step of branch and merge options, and stop after the review.

Write a one-line pull request title to .factory/pr-title.txt and the pull request body to .factory/pr-body.md, as the guide below says.

{{prGuide}}
